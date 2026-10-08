/**
 * Nonce store.
 *
 * SPEC requires nonces to be single-use and to expire after 10 minutes. Until
 * Supabase exists (David's free project is not created yet) this is an in-memory
 * store, which is correct for a single Vercel instance and for local dev.
 *
 * WHAT THIS CANNOT DO, and it must be replaced before the real launch: on
 * Vercel Serverless each invocation may get a fresh instance, so a nonce issued
 * in one request may be unknown in the next. That fails CLOSED (sign-in is
 * refused, never wrongly granted), which is the safe direction to fail, but it
 * will look like intermittent sign-in bugs. Move to the `nonces` table as soon
 * as Supabase is available — the interface here is already the shape that table
 * expects.
 */

import { NONCE_TTL_MS, newNonce } from './siwe';

interface Entry {
  address: string;
  expiresAt: number;
  usedAt: number | null;
}

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

export function issueNonce(address: string, now = Date.now()): string {
  sweep(now);
  const nonce = newNonce();
  store.set(nonce, { address, expiresAt: now + NONCE_TTL_MS, usedAt: null });
  return nonce;
}

/**
 * Check a nonce WITHOUT consuming it. Signature verification is async and may
 * fail; burning the nonce first would let an attacker invalidate a legitimate
 * user's pending signature by requesting the same nonce once.
 */
export function peekNonce(
  nonce: string,
  address: string,
  now = Date.now(),
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

/** Consume a nonce. Single use, enforced here. */
export function consumeNonce(nonce: string, now = Date.now()): boolean {
  const entry = store.get(nonce);
  if (!entry || entry.usedAt !== null || now > entry.expiresAt) return false;
  entry.usedAt = now;
  return true;
}
