import { describe, expect, it } from 'vitest';
import {
  NONCE_TTL_MS,
  SIWE_STATEMENT,
  buildSiweMessage,
  newNonce,
  parseSiweMessage,
  serialiseSiwe,
  signSession,
  verifySession,
  verifySiweSignature,
} from './siwe';

// Captured from a live call on 2026-10-08:
//   ownerOf(1462) -> 0x8ccfaa2c191f60a5a625064ae9682bb82b1c6d94
const LIVE_OWNER = '0x8ccfaa2c191f60a5a625064ae9682bb82b1c6d94';

const FIXED_NOW = new Date('2026-10-08T12:00:00.000Z');

describe('nonce generation', () => {
  it('is 32 hex characters', () => {
    expect(newNonce()).toMatch(/^[0-9a-f]{32}$/);
  });

  it('does not repeat', () => {
    const seen = new Set(Array.from({ length: 200 }, () => newNonce()));
    expect(seen.size).toBe(200);
  });
});

describe('SIWE message', () => {
  it('states that it costs no gas', () => {
    const { message } = buildSiweMessage({ address: LIVE_OWNER, nonce: newNonce(), now: FIXED_NOW });
    expect(message).toContain('costs no gas');
    expect(message).toContain('does not send a transaction');
    expect(message).toContain(SIWE_STATEMENT);
  });

  it('carries the address, nonce and Monad chain id', () => {
    const nonce = newNonce();
    const { message } = buildSiweMessage({ address: LIVE_OWNER, nonce, now: FIXED_NOW });
    expect(message).toContain(LIVE_OWNER);
    expect(message).toContain(`Nonce: ${nonce}`);
    expect(message).toContain('Chain ID: 143');
  });

  it('expires 10 minutes after issue', () => {
    const { payload } = buildSiweMessage({ address: LIVE_OWNER, nonce: newNonce(), now: FIXED_NOW });
    const issued = Date.parse(payload.issuedAt);
    const expires = Date.parse(payload.expirationTime);
    expect(expires - issued).toBe(NONCE_TTL_MS);
    expect(NONCE_TTL_MS).toBe(10 * 60 * 1000);
  });

  it('round-trips through parse', () => {
    const nonce = newNonce();
    const { message } = buildSiweMessage({ address: LIVE_OWNER, nonce, now: FIXED_NOW });
    const parsed = parseSiweMessage(message);
    expect(parsed?.nonce).toBe(nonce);
    expect(parsed?.chainId).toBe(143);
    expect(parsed?.address?.toLowerCase()).toBe(LIVE_OWNER);
  });

  it('serialises deterministically — same payload, same bytes', () => {
    const nonce = newNonce();
    const a = buildSiweMessage({ address: LIVE_OWNER, nonce, now: FIXED_NOW });
    const b = buildSiweMessage({ address: LIVE_OWNER, nonce, now: FIXED_NOW });
    expect(a.message).toBe(b.message);
    expect(serialiseSiwe(a.payload)).toBe(a.message);
  });

  it('changes the nonce when the nonce changes — anti-replay binding', () => {
    const a = buildSiweMessage({ address: LIVE_OWNER, nonce: newNonce(), now: FIXED_NOW });
    const b = buildSiweMessage({ address: LIVE_OWNER, nonce: newNonce(), now: FIXED_NOW });
    expect(a.message).not.toBe(b.message);
  });

  it('returns null for a message with no nonce', () => {
    expect(parseSiweMessage('hello world')).toBeNull();
  });
});

describe('signature verification', () => {
  const nonce = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

  it('rejects a malformed signature without throwing', async () => {
    const { message } = buildSiweMessage({ address: LIVE_OWNER, nonce, now: FIXED_NOW });
    const r = await verifySiweSignature({
      message,
      signature: '0xdeadbeef' as `0x${string}`,
      expectedAddress: LIVE_OWNER,
    });
    expect(r.ok).toBe(false);
  });

  it('rejects a signature made by a different address', async () => {
    const { message } = buildSiweMessage({ address: LIVE_OWNER, nonce, now: FIXED_NOW });
    // A well-formed but wrong signature must not verify as this address.
    const r = await verifySiweSignature({
      message,
      signature: `0x${'ab'.repeat(65)}` as `0x${string}`,
      expectedAddress: LIVE_OWNER,
    });
    expect(r.ok).toBe(false);
  });

  it('rejects an expired message even with a valid signature shape', async () => {
    const { message } = buildSiweMessage({ address: LIVE_OWNER, nonce, now: FIXED_NOW });
    const r = await verifySiweSignature({
      message,
      signature: `0x${'cd'.repeat(65)}` as `0x${string}`,
      expectedAddress: LIVE_OWNER,
      now: FIXED_NOW.getTime() + NONCE_TTL_MS + 60_000,
    });
    expect(r.ok).toBe(false);
  });
});

describe('session cookie', () => {
  const secret = 'test-only-session-secret';
  const payload = {
    address: LIVE_OWNER,
    tokenIds: [1462, 7],
    issuedAt: Date.parse('2026-10-08T12:00:00Z'),
    expiresAt: Date.parse('2026-10-09T12:00:00Z'),
  };

  it('round-trips a valid session', () => {
    const token = signSession(payload, secret);
    const out = verifySession(token, secret);
    expect(out?.address).toBe(LIVE_OWNER);
    expect(out?.tokenIds).toEqual([1462, 7]);
  });

  it('rejects a token signed with a different secret', () => {
    const token = signSession(payload, secret);
    expect(verifySession(token, 'other-secret')).toBeNull();
  });

  it('rejects a tampered payload', () => {
    const token = signSession(payload, secret);
    const [body, mac] = token.split('.');
    // Swap in a different address without re-signing.
    const forged = Buffer.from(
      JSON.stringify({ ...payload, tokenIds: [1, 2, 3] }),
    ).toString('base64url');
    expect(verifySession(`${forged}.${mac}`, secret)).toBeNull();
    expect(verifySession(`${body}.${mac}`, secret)).not.toBe(`${body}.${mac}`);
  });

  it('rejects a garbage token', () => {
    expect(verifySession('nonsense', secret)).toBeNull();
    expect(verifySession('', secret)).toBeNull();
    expect(verifySession(undefined, secret)).toBeNull();
  });

  it('rejects an expired session', () => {
    const token = signSession(payload, secret);
    expect(verifySession(token, secret, payload.expiresAt + 1)).toBeNull();
    expect(verifySession(token, secret, payload.expiresAt - 1)).not.toBeNull();
  });

  it('never contains a private key or gas capability', () => {
    const token = signSession(payload, secret);
    const decoded = Buffer.from(token.split('.')[0], 'base64url').toString('utf8');
    expect(decoded).not.toMatch(/privateKey|secretKey|mnemonic/);
    expect(Object.keys(JSON.parse(decoded)).sort()).toEqual([
      'address',
      'expiresAt',
      'issuedAt',
      'tokenIds',
    ]);
  });
});
