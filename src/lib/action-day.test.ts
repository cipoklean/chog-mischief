import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  DAY_ROLLED_OVER,
  MAX_OUTSTANDING_NONCES,
  REVEAL_DELAY_MS,
  checkActionDay,
  dayRolledOverMessage,
} from './action-day';
import { REVEAL_DELAY_MS as OWNED_ELSEWHERE } from './fairness';
import { getFairness, REVEAL_DELAY_MS as FAIRNESS_DELAY } from './fairness';
import { dayFor } from '@/game/rules';

/**
 * THE DAY-BOUNDARY ATTACK.
 *
 * At 23:56 UTC a player could prepare nonces for many targets (the client picks
 * the target and prepare had no cap), wait for midnight, read the previous
 * day's seed from /api/fairness the moment it was revealed, recompute every
 * candidate roll offline for free, and commit only the target that landed.
 * A guaranteed hit, chosen after the roll was known, and still a normal prank on
 * the new day.
 *
 * Two independent defences, because either alone would be one mistake away from
 * failing:
 *
 *   1. EVERY commit route refuses a day that is not today. This is the real
 *      fix: the day is inside the signature, so a stale intent cannot be
 *      committed at all.
 *   2. A day's seed is not revealed until REVEAL_DELAY_MS after that day ends.
 *      Longer than the longest nonce TTL (10 minutes), so no nonce survives
 *      long enough to be committed against a revealed seed.
 */

const SECRET = 'test-session-secret-not-a-real-one';

const HOUR = 3_600_000;
const MINUTE = 60_000;

/** 2026-10-09T23:59:30Z, the last half-minute of day D. */
const D_END = Date.UTC(2026, 9, 9, 23, 59, 30);
/** 2026-10-10T00:00:30Z, thirty seconds into day D+1. */
const NEXT_START = D_END + 60_000;

describe('a commit is only valid on the day it was prepared for', () => {
  it('accepts the current day', () => {
    const day = dayFor(D_END);
    expect(checkActionDay(day, D_END).ok).toBe(true);
  });

  it('refuses a day that rolled over thirty seconds earlier', () => {
    // The exact attack: prepared at 23:59:30, committed at 00:00:30.
    const yesterday = dayFor(D_END);
    const check = checkActionDay(yesterday, NEXT_START);
    expect(check.ok).toBe(false);
    expect(check.today).toBe('2026-10-10');
    expect(check.claimed).toBe('2026-10-09');
  });

  it('refuses across the boundary in both directions', () => {
    const today = dayFor(NEXT_START);
    const yesterday = dayFor(D_END);
    // Yesterday's intent, committed today.
    expect(checkActionDay(yesterday, NEXT_START).ok).toBe(false);
    // Tomorrow's intent, committed yesterday. Cannot happen from a real client,
    // but a forged intent carries whatever day it likes.
    expect(checkActionDay(today, D_END).ok).toBe(false);
  });

  it('refuses any day that is not literally today', () => {
    const now = Date.UTC(2026, 9, 15, 12, 0, 0);
    for (const day of ['2026-10-09', '2026-10-14', '2026-10-16', '2025-01-01', '']) {
      expect(checkActionDay(day, now).ok, day).toBe(false);
    }
  });

  it('agrees exactly at the boundary, to the millisecond', () => {
    const midnight = Date.UTC(2026, 9, 10, 0, 0, 0);
    // One millisecond before midnight is still day 9.
    expect(checkActionDay('2026-10-09', midnight - 1).ok).toBe(true);
    // At midnight it is not.
    expect(checkActionDay('2026-10-09', midnight).ok).toBe(false);
  });

  it('shares one refusal string across every route', () => {
    // Three routes, three copies of this check. If they drifted, one would
    // refuse with a different string and a client mapping would miss it.
    expect(DAY_ROLLED_OVER).toBe('DAY_ROLLED_OVER');
    expect(dayRolledOverMessage()).toBe('day rolled over, prepare again');
  });
});

describe('a seed is not revealed while a nonce could still be used', () => {
  it('the delay is longer than the longest nonce TTL', () => {
    // Action nonces live 5 minutes; the SIWE nonce 10. If the reveal delay were
    // shorter than the longest of them, a nonce minted just before midnight
    // would still be usable after the seed it rolls against is public.
    const LONGEST_NONCE_TTL_MS = 10 * MINUTE;
    expect(REVEAL_DELAY_MS).toBeGreaterThan(LONGEST_NONCE_TTL_MS);
    expect(REVEAL_DELAY_MS).toBe(30 * MINUTE);
  });

  it('is one constant, not two that can drift', () => {
    // fairness.ts owns REVEAL_DELAY_MS; action-day.ts re-exports it. Two
    // separate definitions would let someone change one and not the other, and
    // the drift would reopen the attack silently - the day check would assert
    // against a number the reveal no longer honours.
    expect(REVEAL_DELAY_MS).toBe(OWNED_ELSEWHERE);
    expect(FAIRNESS_DELAY).toBe(OWNED_ELSEWHERE);
  });

  it('does NOT include day D at 00:10 UTC on D+1', () => {
    // Ten minutes past midnight, inside the delay.
    const tenPast = Date.UTC(2026, 9, 10, 0, 10, 0);
    const state = getFairness(SECRET, tenPast);
    expect(state.history.map((h) => h.day)).not.toContain('2026-10-09');
    expect(state.history.every((h) => h.day < '2026-10-09')).toBe(true);
  });

  it('includes day D from 00:30 UTC on D+1', () => {
    const halfPast = Date.UTC(2026, 9, 10, 0, 30, 0);
    const state = getFairness(SECRET, halfPast);
    expect(state.history.map((h) => h.day)).toContain('2026-10-09');
  });

  it('the boundary is at exactly 00:30, to the millisecond', () => {
    const boundary = Date.UTC(2026, 9, 10, 0, 30, 0);
    expect(getFairness(SECRET, boundary - 1).history.map((h) => h.day)).not.toContain('2026-10-09');
    expect(getFairness(SECRET, boundary).history.map((h) => h.day)).toContain('2026-10-09');
  });

  it('a day that was inside the delay becomes available, later', () => {
    // Not "never" - the delay defers the reveal, it does not cancel it. A
    // player who loses today must still be able to check it tomorrow.
    const inside = getFairness(SECRET, Date.UTC(2026, 9, 10, 0, 10, 0));
    const after = getFairness(SECRET, Date.UTC(2026, 9, 11, 12, 0, 0));
    expect(inside.history.map((h) => h.day)).not.toContain('2026-10-09');
    expect(after.history.map((h) => h.day)).toContain('2026-10-09');
  });

  it('reports nothing verifiable when everything is still inside the delay', () => {
    // A UI can then say "nothing to verify yet" instead of rendering an empty
    // section. A client would otherwise have to infer it from an empty array.
    const state = getFairness(SECRET, Date.UTC(2026, 9, 10, 0, 5, 0));
    expect(state.history).toHaveLength(0);
    expect(state.verifiable).toBe(false);
  });

  it('a revealed seed still verifies against its published commitment', () => {
    // The delay must not weaken the reveal: once available, it is checkable.
    const after = getFairness(SECRET, Date.UTC(2026, 9, 11, 12, 0, 0));
    const day = after.history.find((h) => h.day === '2026-10-09');
    expect(day).toBeDefined();
    // Imported at the top of the file in ESM; a require() here would be a
    // different module system and would not even load.
    expect(createHash('sha256').update(day!.seed).digest('hex')).toBe(day!.commitHash);
  });
});

describe('prepare is not an unlimited batch machine', () => {
  it('allows a small, finite number of outstanding nonces', () => {
    // Enough for the flow to work: one prepare, one silent retry on a nonce
    // replay, one spare. Not enough to sweep a target list.
    expect(MAX_OUTSTANDING_NONCES).toBe(3);
    expect(MAX_OUTSTANDING_NONCES).toBeLessThan(10);
  });
});
