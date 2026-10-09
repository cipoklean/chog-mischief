import { dayFor } from '@/game/rules';
import { REVEAL_DELAY_MS } from './fairness';

/**
 * THE DAY CHECK, in one place.
 *
 * ── The attack this closes ──────────────────────────────────────────────────
 * Every commit route accepted whatever `day` was inside the signed intent, and
 * a nonce lives 5-10 minutes. So a player could, at 23:56 UTC:
 *
 *   1. call /prepare for many targets, keeping each nonce (no limit existed)
 *   2. wait for 00:00 UTC, when /api/fairness reveals the PREVIOUS day's seed
 *   3. recompute rollFromSeed for every prepared target OFFLINE, for free
 *   4. commit only the target that lands
 *
 * The result was a guaranteed hit at 2x, chosen after the roll was known. The
 * daily-limit index could not stop it, because the intent still carried the old
 * day and the player got a normal prank on the new day as well.
 *
 * The fix is the obvious one and it has to be on the SERVER, because the day is
 * inside the signature: a commit is only valid on the day it was prepared for.
 *
 * ── Why this is a shared helper ─────────────────────────────────────────────
 * Three routes each need it, and a day check copied three times is a day check
 * that will be missing from the fourth. It returns a refusal rather than
 * throwing so the caller decides the status code.
 */

/**
 * How long after a day ends its seed stays unrevealed.
 *
 * Re-exported from lib/fairness, which owns it. Two copies of a security
 * constant is two chances to change one and not the other, and the day-check
 * module asserts on it precisely because it must be longer than a nonce TTL.
 */
export { REVEAL_DELAY_MS };

/** The machine-readable refusal. Same string on every route. */
export const DAY_ROLLED_OVER = 'DAY_ROLLED_OVER';

/** At most this many unused nonces may be outstanding per token per day. */
export const MAX_OUTSTANDING_NONCES = 3;

export interface DayCheck {
  ok: boolean;
  /** Today, UTC, as the daily limit defines it. */
  today: string;
  /** The day that was signed, for the message. */
  claimed: string;
}

/**
 * True when `claimedDay` is still the current UTC day.
 *
 * `now` is injected so the boundary is testable: the whole bug lives in a
 * 30-second window at midnight, and a test that cannot control the clock cannot
 * test it.
 */
export function checkActionDay(claimedDay: string, now: number = Date.now()): DayCheck {
  const today = dayFor(now);
  return { ok: claimedDay === today, today, claimed: claimedDay };
}

/** The player-facing sentence, shared so all three routes say the same thing. */
export function dayRolledOverMessage(): string {
  return 'day rolled over, prepare again';
}
