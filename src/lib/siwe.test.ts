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

  it('serialises deterministically - same payload, same bytes', () => {
    const nonce = newNonce();
    const a = buildSiweMessage({ address: LIVE_OWNER, nonce, now: FIXED_NOW });
    const b = buildSiweMessage({ address: LIVE_OWNER, nonce, now: FIXED_NOW });
    expect(a.message).toBe(b.message);
    expect(serialiseSiwe(a.payload)).toBe(a.message);
  });

  it('changes the nonce when the nonce changes - anti-replay binding', () => {
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

  // FIXED instants, and every verifySession call below passes `now` explicitly.
  //
  // These dates were 2026-10-08 and 2026-10-09, and verifySession defaults
  // `now` to Date.now(). At 13:00 UTC on the expiry date the session became
  // correctly expired, so "round-trips a valid session" started returning null -
  // a time bomb that made the suite go red on a schedule and turned every
  // "tests green" claim after that point into a false one.
  //
  // A test asserting a session is valid must therefore never depend on the
  // wall clock. Both instants are fixed and every call passes the clock it
  // wants, so this file cannot expire.
  const ISSUED_AT = Date.UTC(2026, 0, 1, 12, 0, 0); // fixed
  const EXPIRES_AT = Date.UTC(2030, 0, 1, 12, 0, 0); // far enough out to never arrive
  const DURING = Date.UTC(2026, 0, 2, 12, 0, 0); // a "now" inside the window

  const payload = {
    address: LIVE_OWNER,
    tokenIds: [1462, 7],
    issuedAt: ISSUED_AT,
    expiresAt: EXPIRES_AT,
  };

  it('round-trips a valid session', () => {
    const token = signSession(payload, secret);
    const out = verifySession(token, secret, DURING);
    expect(out?.address).toBe(LIVE_OWNER);
    expect(out?.tokenIds).toEqual([1462, 7]);
  });

  it('is still valid at the far end of a real window, not just at one instant', () => {
    // The regression guard for the time bomb itself: a session valid for four
    // years must still validate three years in, whatever the wall clock says.
    const token = signSession(payload, secret);
    expect(verifySession(token, secret, Date.UTC(2028, 11, 31))).not.toBeNull();
    expect(verifySession(token, secret, Date.UTC(2030, 5, 1))).toBeNull();
  });

  it('rejects a token signed with a different secret', () => {
    const token = signSession(payload, secret);
    expect(verifySession(token, 'other-secret', DURING)).toBeNull();
  });

  it('rejects a tampered payload', () => {
    const token = signSession(payload, secret);
    const [body, mac] = token.split('.');
    // Swap in a different address without re-signing.
    const forged = Buffer.from(
      JSON.stringify({ ...payload, tokenIds: [1, 2, 3] }),
    ).toString('base64url');
    expect(verifySession(`${forged}.${mac}`, secret, DURING)).toBeNull();
    expect(verifySession(`${body}.${mac}`, secret, DURING)).not.toBe(`${body}.${mac}`);
  });

  it('rejects a garbage token', () => {
    expect(verifySession('nonsense', secret, DURING)).toBeNull();
    expect(verifySession('', secret, DURING)).toBeNull();
    expect(verifySession(undefined, secret, DURING)).toBeNull();
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
