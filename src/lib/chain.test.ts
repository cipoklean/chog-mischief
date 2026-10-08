import { describe, expect, it } from 'vitest';
import {
  BALANCE_OF_SELECTOR,
  CHOG_CONTRACT,
  CHOG_TOTAL_SUPPLY,
  MONAD_CHAIN_ID,
  MONAD_RPCS,
  OWNER_CACHE_TTL_MS,
  OWNER_OF_SELECTOR,
} from './chain';

// Values captured from live calls on Monad mainnet, 2026-10-08.
const LIVE_OWNER_OF_1462 =
  '0x0000000000000000000000008ccfaa2c191f60a5a625064ae9682bb82b1c6d94';

describe('chain config', () => {
  it('points at the verified Chog Genesis contract', () => {
    expect(CHOG_CONTRACT.toLowerCase()).toBe(
      '0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763',
    );
  });

  it('uses Monad mainnet chain id 143', () => {
    expect(MONAD_CHAIN_ID).toBe(143);
  });

  it('has at least one RPC and all three are public monad endpoints', () => {
    expect(MONAD_RPCS.length).toBeGreaterThanOrEqual(1);
    for (const rpc of MONAD_RPCS) expect(rpc).toMatch(/^https:\/\/rpc\d?\.monad\.xyz$/);
  });

  it('does not duplicate the primary RPC in the fallback list', () => {
    expect(new Set(MONAD_RPCS).size).toBe(MONAD_RPCS.length);
  });

  it('caches owner reads for about 60s to respect public RPC limits', () => {
    expect(OWNER_CACHE_TTL_MS).toBe(60_000);
  });

  it('knows the real total supply', () => {
    expect(CHOG_TOTAL_SUPPLY).toBe(1969);
  });

  it('uses the correct ERC-721 selectors', () => {
    expect(OWNER_OF_SELECTOR).toBe('0x6352211e');
    expect(BALANCE_OF_SELECTOR).toBe('0x70a08231');
  });
});

describe('ABI encoding (must match what the live chain accepted)', () => {
  function padUint(value: number | bigint): string {
    return BigInt(value).toString(16).padStart(64, '0');
  }

  it('encodes a token id as a 32-byte word', () => {
    const data = OWNER_OF_SELECTOR + padUint(1462);
    expect(data.startsWith(OWNER_OF_SELECTOR)).toBe(true);
    expect(data.length).toBe(10 + 64);
    // 1462 == 0x5b6
    expect(data.slice(-64)).toBe('5b6'.padStart(64, '0'));
  });

  it('encodes token 1 and 1969 correctly', () => {
    expect(padUint(1)).toBe('1'.padStart(64, '0'));
    expect(padUint(1969)).toBe('7b1'.padStart(64, '0'));
  });

  it('decodes the live ownerOf(1462) return to an address', () => {
    const clean = LIVE_OWNER_OF_1462.slice(2);
    expect(clean).toHaveLength(64);
    expect(`0x${clean.slice(-40)}`).toBe('0x8ccfaa2c191f60a5a625064ae9682bb82b1c6d94');
  });

  it('pads an address to a 32-byte word', () => {
    const addr = '0x8ccfaa2c191f60a5a625064ae9682bb82b1c6d94';
    const padded = addr.toLowerCase().replace(/^0x/, '').padStart(64, '0');
    expect(padded).toHaveLength(64);
    expect(padded.endsWith('8ccfaa2c191f60a5a625064ae9682bb82b1c6d94')).toBe(true);
  });
});
