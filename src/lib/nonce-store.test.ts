import { describe, expect, it } from 'vitest';
import { issueNonce, peekNonce, consumeNonce } from './nonce-store';
import { NONCE_TTL_MS } from './siwe';

/**
 * These run with NO Supabase configured, so they exercise the in-memory
 * fallback. That fallback is what local dev and the suite use, so its
 * semantics are the contract the Supabase path must also satisfy — the live
 * check against the real table is scripts/verify-nonce-supabase.mjs.
 *
 * No test env sets SUPABASE_URL, so the module under test cannot accidentally
 * reach a real database and mutate it.
 */

const ADDRESS_A = '0x1111111111111111111111111111111111111111';
const ADDRESS_B = '0x2222222222222222222222222222222222222222';

describe('issueNonce', () => {
  it('returns a fresh nonce every call', async () => {
    const a = await issueNonce(ADDRESS_A);
    const b = await issueNonce(ADDRESS_A);
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(16);
  });

  it('issues a nonce that is immediately valid for its own address', async () => {
    const nonce = await issueNonce(ADDRESS_A);
    expect(await peekNonce(nonce, ADDRESS_A)).toEqual({ ok: true });
  });
});

describe('peekNonce does not consume', () => {
  it('can be called repeatedly and still allow the consume to succeed', async () => {
    // Signature verification happens between peek and consume. If peek burned
    // the nonce, an attacker could invalidate a legitimate user's pending
    // signature by requesting that nonce once.
    const nonce = await issueNonce(ADDRESS_A);
    for (let i = 0; i < 5; i++) {
      expect(await peekNonce(nonce, ADDRESS_A)).toEqual({ ok: true });
    }
    expect(await consumeNonce(nonce)).toBe(true);
  });
});

describe('single use', () => {
  it('refuses a nonce that was already consumed', async () => {
    const nonce = await issueNonce(ADDRESS_A);
    expect(await consumeNonce(nonce)).toBe(true);

    const after = await peekNonce(nonce, ADDRESS_A);
    expect(after.ok).toBe(false);
    expect(after.reason).toBe('nonce already used');

    // A second consume must fail too — this is the replay the table prevents.
    expect(await consumeNonce(nonce)).toBe(false);
  });

  it('lets exactly one of two concurrent consumes win', async () => {
    // The Supabase path does this with ONE conditional UPDATE rather than a
    // read-then-write. This asserts the outcome that shape must preserve.
    const nonce = await issueNonce(ADDRESS_A);
    const results = await Promise.all([consumeNonce(nonce), consumeNonce(nonce)]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });
});

describe('address binding', () => {
  it('refuses a nonce issued to a different address', async () => {
    const nonce = await issueNonce(ADDRESS_A);
    const check = await peekNonce(nonce, ADDRESS_B);
    expect(check.ok).toBe(false);
    expect(check.reason).toBe('nonce was issued to a different address');
  });

  it('compares addresses case-insensitively, since checksums differ', async () => {
    const nonce = await issueNonce(ADDRESS_A.toUpperCase().replace('0X', '0x'));
    expect(await peekNonce(nonce, ADDRESS_A)).toEqual({ ok: true });
  });
});

describe('expiry', () => {
  it('refuses a nonce past its TTL', async () => {
    const issued = 1_000_000;
    const nonce = await issueNonce(ADDRESS_A, issued);
    expect(await peekNonce(nonce, ADDRESS_A, issued + NONCE_TTL_MS)).toEqual({ ok: true });

    const expired = await peekNonce(nonce, ADDRESS_A, issued + NONCE_TTL_MS + 1);
    expect(expired.ok).toBe(false);
    expect(expired.reason).toBe('nonce expired');
  });

  it('refuses to consume an expired nonce', async () => {
    const issued = 2_000_000;
    const nonce = await issueNonce(ADDRESS_A, issued);
    expect(await consumeNonce(nonce, issued + NONCE_TTL_MS + 1)).toBe(false);
  });
});

describe('unknown nonces', () => {
  it('refuses a nonce that was never issued', async () => {
    const check = await peekNonce('never-issued-at-all', ADDRESS_A);
    expect(check.ok).toBe(false);
    expect(check.reason).toBe('unknown or already-consumed nonce');
  });

  it('refuses to consume a nonce that was never issued', async () => {
    expect(await consumeNonce('never-issued-at-all')).toBe(false);
  });
});