/**
 * Chog Mischief — read-side chain access.
 *
 * Server-side only (it uses the service-role Supabase key and caches reads), so
 * every function here is called from a route handler or server action, never
 * from a client component.
 *
 * The cache is a module-level Map with a 60s TTL, per SPEC: free public Monad
 * RPCs are shared infrastructure and a busy demo page would otherwise hammer
 * them. A cache miss costs one read; a hit costs nothing.
 */

import {
  BALANCE_OF_SELECTOR,
  CHOG_CONTRACT,
  MONAD_CHAIN_ID,
  MONAD_RPCS,
  OWNER_CACHE_TTL_MS,
  OWNER_OF_SELECTOR,
} from './chain';

import { join } from 'node:path';

interface CacheEntry {
  value: string | null;
  expiresAt: number;
}

const ownerCache = new Map<number, CacheEntry>();
let rpcIndex = 0;

function nextRpc(): string {
  // Round-robin across the fallbacks so no single public RPC gets hammered.
  const rpc = MONAD_RPCS[rpcIndex % MONAD_RPCS.length];
  rpcIndex += 1;
  return rpc;
}

interface RpcRevert extends Error {
  isRevert?: boolean;
}

/**
 * Minimal JSON-RPC call with failover across the configured RPCs.
 *
 * A REVERT is treated as a definitive answer, not a transient failure: verified
 * live, `ownerOf` on a nonexistent token id reverts with `execution reverted`
 * (and a custom error 0x7e273289), it does not return a zero word. Retrying a
 * revert across all three RPCs triples the cost of every miss, and a collection
 * scan hits misses constantly. So reverts short-circuit and return null.
 */
async function rpc<T>(method: string, params: unknown[], timeoutMs = 12_000): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < MONAD_RPCS.length; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(nextRpc(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: controller.signal,
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`rpc ${res.status}`);
      const json = (await res.json()) as {
        result?: T;
        error?: { message?: string; code?: number };
      };
      if (json.error) {
        const message = json.error.message ?? 'rpc error';
        if (/revert|execution reverted/i.test(message) || json.error.code === 3) {
          const err: RpcRevert = new Error(message);
          err.isRevert = true;
          throw err;
        }
        throw new Error(message);
      }
      if (json.result === undefined) throw new Error('rpc returned no result');
      return json.result;
    } catch (err) {
      // A revert is the chain answering definitively. Do not ask the next RPC.
      if ((err as RpcRevert)?.isRevert) throw err;
      lastError = err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof Error ? lastError : new Error('all RPCs failed');
}

function padAddress(address: string): string {
  return address.toLowerCase().replace(/^0x/, '').padStart(64, '0');
}

function padUint(value: number | bigint): string {
  return BigInt(value).toString(16).padStart(64, '0');
}

function decodeAddress(hex: string): `0x${string}` {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  return `0x${clean.slice(-40)}`.toLowerCase() as `0x${string}`;
}

function decodeUint(hex: string): bigint {
  return BigInt(hex === '0x' ? '0x0' : hex);
}

/** Current owner of a token, or null if the token does not exist. */
export async function ownerOf(tokenId: number): Promise<`0x${string}` | null> {
  const cached = ownerCache.get(tokenId);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.value as `0x${string}` | null;

  let value: `0x${string}` | null;
  try {
    const result = await rpc<string>('eth_call', [
      { to: CHOG_CONTRACT, data: OWNER_OF_SELECTOR + padUint(tokenId) },
      'latest',
    ]);
    // Belt and braces: a zero word would mean unminted even though live calls
    // revert instead. Handle both so a future contract cannot return a silent 0.
    value =
      !result || result === '0x' || BigInt(result) === 0n ? null : decodeAddress(result);
  } catch (err) {
    if ((err as RpcRevert)?.isRevert) {
      // Definitively not a real token. Cache the negative so a scan does not
      // re-ask for it on every page load.
      ownerCache.set(tokenId, { value: null, expiresAt: now + OWNER_CACHE_TTL_MS });
      return null;
    }
    throw err;
  }

  ownerCache.set(tokenId, { value, expiresAt: now + OWNER_CACHE_TTL_MS });
  return value;
}

/** How many Chogs an address holds. */
export async function balanceOf(address: string): Promise<bigint> {
  const result = await rpc<string>('eth_call', [
    { to: CHOG_CONTRACT, data: BALANCE_OF_SELECTOR + padAddress(address) },
    'latest',
  ]);
  return decodeUint(result);
}

export { MONAD_CHAIN_ID };

/**
 * Fallback scan depth, used ONLY when no snapshot entry exists. It is a bound,
 * not a limit of the game: the snapshot is what makes the whole collection
 * visible. A wallet whose id sits above this depth still plays once the
 * snapshot is rebuilt.
 */
export const MAX_SCAN = 200;

/**
 * The owner snapshot (built by scripts/harvest-owners.mjs) and where it lives.
 *
 * Reloaded when the file's mtime changes, so a rebuilt snapshot takes effect
 * without restarting the dev server.
 *
 * The path is overridable because the default does not exist in every
 * environment: the tests point it at
 * a temp file instead of rewriting the real one. With no snapshot the app
 * degrades to a bounded live scan rather than failing outright.
 */
function snapshotPath(): string {
  // Resolved per call, NOT captured at module load: the tests (and a dev server
  // restarted with new env) set CHOG_SNAPSHOT_PATH after this module is imported,
  // and a captured constant would silently keep reading the old path.
  return process.env.CHOG_SNAPSHOT_PATH ?? join(process.cwd(), 'data', 'owners.json');
}

let snapshotCache: { path: string; mtimeMs: number; data: OwnerSnapshot } | null = null;

async function loadSnapshot(): Promise<OwnerSnapshot | null> {
  const path = snapshotPath();
  try {
    const { statSync, readFileSync } = await import('node:fs');
    const mtimeMs = statSync(path).mtimeMs;
    if (snapshotCache?.path === path && snapshotCache.mtimeMs === mtimeMs) {
      return snapshotCache.data;
    }
    const data = JSON.parse(readFileSync(path, 'utf8')) as OwnerSnapshot;
    snapshotCache = { path, mtimeMs, data };
    return data;
  } catch {
    // No snapshot yet — the caller falls back to a bounded live scan.
    return null;
  }
}

export interface OwnerSnapshot {
  generatedAt: string;
  contract: string;
  totalSupply: number;
  holderCount: number;
  missing: number;
  owners: Record<string, number[]>;
}

/**
 * Every token id this address holds.
 *
 * balanceOf is ALWAYS read live from the chain first — that call alone decides
 * whether someone is a player. The snapshot only ever answers "which ids", so
 * a stale or forged entry cannot grant access to a wallet that holds nothing.
 */
export async function findHeldTokens(address: string): Promise<number[]> {
  const live = await balanceOf(address);
  if (Number(live) === 0) return [];

  const snapshot = await loadSnapshot();
  // Normalise BOTH sides. An all-lowercase address like 0xaaaa... can be
  // upper-cased by a caller or a wallet, and a mixed-case checksummed address
  // differs again — so comparing the raw key silently misses holders who
  // genuinely own Chogs. Found by the case-insensitivity test.
  const fromSnapshot = snapshot?.owners[address.toLowerCase()] ?? null;
  if (fromSnapshot && fromSnapshot.length > 0) return [...fromSnapshot].sort((a, b) => a - b);

  // No snapshot entry: fall back to scanning, bounded so a cold cache cannot
  // turn one sign-in into a 40-second hang.
  const scanned = await scanForOwner(address, MAX_SCAN);
  if (scanned.length > 0) return scanned;

  throw new Error(
    'balanceOf says this wallet holds a Chog but no token was found. ' +
      'The owner snapshot is stale — re-run: npm run harvest:owners',
  );
}

async function scanForOwner(address: string, maxScan: number): Promise<number[]> {
  const held: number[] = [];
  let cursor = 1;

  const worker = async (): Promise<void> => {
    while (cursor <= maxScan) {
      const tokenId = cursor;
      cursor += 1;
      const owner = await ownerOf(tokenId).catch(() => null);
      if (owner && owner.toLowerCase() === address.toLowerCase()) held.push(tokenId);
    }
  };

  await Promise.all(Array.from({ length: 8 }, worker));
  return held.sort((a, b) => a - b);
}

/** Drop cached owners — call after a transfer so the next read is fresh. */
export function invalidateOwnerCache(): void {
  ownerCache.clear();
}
