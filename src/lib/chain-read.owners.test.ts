import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * findHeldTokens is the gate that makes the NFT essential, so it is tested
 * against the failure modes that would actually let a non-player in:
 *
 *   - a wallet whose token ids sit ABOVE the fallback scan depth
 *   - a snapshot listing an address it should not
 *   - live balanceOf disagreeing with the snapshot
 *
 * Only `fetch` and the snapshot path are stubbed. The logic under test is the
 * real module, imported fresh per test so the mtime cache cannot leak.
 */

const OWNER_OF = '0x6352211e';
const BALANCE_OF = '0x70a08231';

/** tokenId -> owner, as the "chain" believes it. */
let chain = new Map<number, string>();

// Real 20-byte addresses: the module left-pads whatever it is given, so a short
// placeholder like 0xaaa would misalign a naive arg parse and silently read as
// a different address.
const A = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const WHALE = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const NEW = '0xcccccccccccccccccccccccccccccccccccccccc';
const GHOST = '0xdddddddddddddddddddddddddddddddddddddddd';

function encodeWord(value: bigint | number): string {
  return BigInt(value).toString(16).padStart(64, '0');
}

/** Split the calldata back into method + first argument word. */
function parseCalldata(data: string): { selector: string; arg: string } {
  return { selector: data.slice(0, 10), arg: data.slice(10, 74) };
}

function mockChain() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as {
        method: string;
        params: [{ to: string; data: string }];
      };
      const { selector, arg } = parseCalldata(body.params[0].data);

      if (selector === BALANCE_OF) {
        const address = '0x' + arg.slice(24);
        const count = [...chain.values()].filter(
          (o) => o.toLowerCase() === address.toLowerCase(),
        ).length;
        return jsonRpcOk(encodeWord(count));
      }

      if (selector === OWNER_OF) {
        const tokenId = Number(BigInt('0x' + arg));
        const owner = chain.get(tokenId);
        if (!owner) return jsonRpcError('execution reverted', 3);
        return jsonRpcOk('0x' + encodeWord(0) + owner.slice(2));
      }

      return jsonRpcError(`unsupported ${selector}`, -32601);
    }),
  );
}

function jsonRpcOk(result: string) {
  return { ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, result }) } as Response;
}

function jsonRpcError(message: string, code: number) {
  return {
    ok: true,
    json: async () => ({ jsonrpc: '2.0', id: 1, error: { message, code } }),
  } as Response;
}

let snapshotDir = '';

function writeSnapshot(owners: Record<string, number[]>, opts: { supply?: number; missing?: number } = {}) {
  writeFileSync(
    join(snapshotDir, 'owners.json'),
    JSON.stringify({
      generatedAt: '2026-10-08T00:00:00.000Z',
      contract: '0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763',
      totalSupply: opts.supply ?? 1969,
      holderCount: Object.keys(owners).length,
      missing: opts.missing ?? 0,
      owners,
    }),
  );
}

/** Fresh import so the snapshot mtime cache starts empty. */
async function freshModule() {
  vi.resetModules();
  return import('./chain-read');
}

beforeEach(() => {
  chain = new Map();
  snapshotDir = mkdtempSync(join(tmpdir(), 'chog-snap-'));
  process.env.CHOG_SNAPSHOT_PATH = join(snapshotDir, 'owners.json');
  mockChain();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.CHOG_SNAPSHOT_PATH;
});

afterAll(() => {
  if (snapshotDir) rmSync(snapshotDir, { recursive: true, force: true });
});

describe('findHeldTokens', () => {
  it('returns the snapshot ids for a known holder', async () => {
    chain.set(1, A);
    chain.set(2, A);
    writeSnapshot({ [A]: [1, 2] });

    const { findHeldTokens } = await freshModule();
    expect(await findHeldTokens(A)).toEqual([1, 2]);
  });

  it('is case-insensitive on the address', async () => {
    chain.set(7, A);
    writeSnapshot({ [A]: [7] });

    const { findHeldTokens } = await freshModule();
    expect(await findHeldTokens(A.toUpperCase().replace('0X','0x'))).toEqual([7]);
  });

  it('finds ids far above the fallback scan depth', async () => {
    // The reason the snapshot exists: 1,850 is invisible to a 200-deep scan.
    chain.set(1850, A);
    writeSnapshot({ [A]: [1850] }, { supply: 1969 });

    const { findHeldTokens } = await freshModule();
    expect(await findHeldTokens(A)).toEqual([1850]);
  });

  it('returns every id for a holder with many Chogs', async () => {
    for (const id of [1, 2, 3, 4, 5]) chain.set(id, WHALE);
    writeSnapshot({ [WHALE]: [1, 2, 3, 4, 5] });

    const { findHeldTokens } = await freshModule();
    expect(await findHeldTokens(WHALE)).toEqual([1, 2, 3, 4, 5]);
  });

  it('returns [] for a wallet that owns nothing', async () => {
    chain.set(1, A);
    writeSnapshot({ [A]: [1] });

    const { findHeldTokens } = await freshModule();
    expect(await findHeldTokens('0xnobody')).toEqual([]);
  });

  it('REFUSES to trust the snapshot when live balanceOf says zero', async () => {
    // The safety property that matters: a stale or tampered snapshot must never
    // grant access, because balanceOf is read live and decides alone.
    writeSnapshot({ [GHOST]: [2] }); // chain says this wallet holds nothing

    const { findHeldTokens } = await freshModule();
    expect(await findHeldTokens(GHOST)).toEqual([]);
  });

  it('falls back to a live scan when the address is missing from the snapshot', async () => {
    // A Chog minted after the snapshot was built: low id, so the scan finds it.
    chain.set(3, NEW);
    writeSnapshot({ [A]: [1] });

    const { findHeldTokens } = await freshModule();
    expect(await findHeldTokens(NEW)).toEqual([3]);
  });

  it('throws a clear error when balanceOf is positive but no id is found', async () => {
    // Live balanceOf says 1, the scan finds nothing: the snapshot is stale.
    writeSnapshot({ [A]: [1] });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as { params: [{ data: string }] };
        const { selector } = parseCalldata(body.params[0].data);
        if (selector === BALANCE_OF) return jsonRpcOk(encodeWord(1));
        return jsonRpcError('execution reverted', 3);
      }),
    );

    const { findHeldTokens } = await freshModule();
    await expect(findHeldTokens(GHOST)).rejects.toThrow(/harvest:owners/i);
  });

  it('works with no snapshot file at all', async () => {
    // A fresh clone with no harvested cache must not crash the app.
    chain.set(2, A);

    const { findHeldTokens } = await freshModule();
    expect(await findHeldTokens(A)).toEqual([2]);
  });
});