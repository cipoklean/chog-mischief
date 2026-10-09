/**
 * Nonce store, backed by the Supabase `nonces` table.
 *
 * Replaces the in-memory Map. Why it had to move: on Vercel Serverless each
 * invocation may get a fresh instance, so a nonce issued in one request was
 * unknown in the next. The old store failed CLOSED - sign-in was refused,
 * never wrongly granted - which is the safe direction, but it presented as
 * intermittent sign-in bugs. The table is shared, so a nonce issued on one
 * instance is visible on the next.
 *
 * THE SHAPE CHANGED, and callers must not skip it: every function here is
 * async. That is not cosmetic - `consumeNonce` must be a single atomic
 * conditional UPDATE, because "read then write" would let two concurrent
 * requests both observe an unused nonce and both consume it, which is exactly
 * the replay this table exists to prevent. A synchronous wrapper around an
 * async call would reintroduce the race it appears to fix.
 *
 * The in-memory implementation is kept as a fallback for local dev and tests
 * with no SUPABASE_URL, so the suite still runs with no credentials at all.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { NONCE_TTL_MS, newNonce } from './siwe';

interface Entry {
  address: string;
  expiresAt: number;
  usedAt: number | null;
}

function supabaseConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL);
}

/** Cached client - one per instance, not one per request. */
let client: SupabaseClient | null = null;

function db(): SupabaseClient | null {
  if (!supabaseConfigured()) return null;
  if (client) return client;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  client = createClient(process.env.SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

// ---------------------------------------------------------------------------
// Fallback: in-memory, single instance only
// ---------------------------------------------------------------------------

const store = new Map<string, Entry>();

/** Cap the map so an unauthenticated flood cannot grow it without bound. */
const MAX_ENTRIES = 10_000;

function sweep(now: number): void {
  for (const [nonce, entry] of store) {
    if (now > entry.expiresAt + NONCE_TTL_MS) store.delete(nonce);
  }
  // If it is still oversized, drop the oldest insertions.
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next();
    if (oldest.done) break;
    store.delete(oldest.value);
  }
}

function issueInMemory(address: string, now: number): string {
  sweep(now);
  const nonce = newNonce();
  store.set(nonce, { address, expiresAt: now + NONCE_TTL_MS, usedAt: null });
  return nonce;
}

function peekInMemory(
  nonce: string,
  address: string,
  now: number,
): { ok: boolean; reason?: string } {
  const entry = store.get(nonce);
  if (!entry) return { ok: false, reason: 'unknown or already-consumed nonce' };
  if (entry.usedAt !== null) return { ok: false, reason: 'nonce already used' };
  if (now > entry.expiresAt) return { ok: false, reason: 'nonce expired' };
  if (entry.address.toLowerCase() !== address.toLowerCase()) {
    return { ok: false, reason: 'nonce was issued to a different address' };
  }
  return { ok: true };
}

function consumeInMemory(nonce: string, now: number): boolean {
  const entry = store.get(nonce);
  if (!entry || entry.usedAt !== null || now > entry.expiresAt) return false;
  entry.usedAt = now;
  return true;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Issue a nonce for `address`, valid for NONCE_TTL_MS. */
export async function issueNonce(address: string, now = Date.now()): Promise<string> {
  const supabase = db();
  if (!supabase) return issueInMemory(address, now);

  const nonce = newNonce();
  const expiresAt = new Date(now + NONCE_TTL_MS).toISOString();
  const { error } = await supabase.from('nonces').insert({
    nonce,
    address: address.toLowerCase(),
    expires_at: expiresAt,
    used_at: null,
  });
  if (error) {
    // Fail closed rather than silently issuing an untracked nonce: an
    // unrecorded nonce could be reused, which is worse than a refusal.
    throw new Error(`could not issue nonce: ${error.message}`);
  }
  return nonce;
}

/**
 * Check a nonce WITHOUT consuming it. Signature verification is async and may
 * fail; burning the nonce first would let an attacker invalidate a legitimate
 * user's pending signature by requesting the same nonce once.
 */
export async function peekNonce(
  nonce: string,
  address: string,
  now = Date.now(),
): Promise<{ ok: boolean; reason?: string }> {
  const supabase = db();
  if (!supabase) return peekInMemory(nonce, address, now);

  const { data, error } = await supabase
    .from('nonces')
    .select('address, expires_at, used_at')
    .eq('nonce', nonce)
    .maybeSingle();

  if (error) return { ok: false, reason: `nonce lookup failed: ${error.message}` };
  if (!data) return { ok: false, reason: 'unknown or already-consumed nonce' };
  if (data.used_at) return { ok: false, reason: 'nonce already used' };
  if (now > new Date(data.expires_at).getTime()) return { ok: false, reason: 'nonce expired' };
  if ((data.address as string).toLowerCase() !== address.toLowerCase()) {
    return { ok: false, reason: 'nonce was issued to a different address' };
  }
  return { ok: true };
}

/**
 * Consume a nonce. Single use, enforced by the database.
 *
 * This is ONE conditional UPDATE, not a read followed by a write. The
 * `used_at is null` predicate is what makes two concurrent requests safe:
 * exactly one can match the row, and the other matches nothing and is
 * refused. Doing `peek` then `update` here would let both requests observe an
 * unused nonce and both succeed - a working replay.
 */
export async function consumeNonce(nonce: string, now = Date.now()): Promise<boolean> {
  const supabase = db();
  if (!supabase) return consumeInMemory(nonce, now);

  const { data, error } = await supabase
    .from('nonces')
    .update({ used_at: new Date(now).toISOString() })
    .eq('nonce', nonce)
    .is('used_at', null)
    .gt('expires_at', new Date(now).toISOString())
    .select('nonce');

  if (error) return false;
  // No returned row means someone else consumed it first, or it never existed.
  return Array.isArray(data) && data.length > 0;
}