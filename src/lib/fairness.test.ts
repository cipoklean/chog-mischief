import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  commitForSeed,
  fairnessDay,
  getFairness,
  rollFromSeed,
  seedForDay,
  verifyReveal,
  FAIRNESS_RULE,
} from './fairness';
import { powersFor, effectiveDodge, resolvePrank } from '@/game/powers';

/**
 * THE ROLL MUST BE PUBLICLY VERIFIABLE.
 *
 * The roll was HMAC(SESSION_SECRET, from|to|day): unpredictable, so nobody
 * could shop for a target that would dodge in their favour. But unpredictable
 * also means uncheckable, and a player who lost had no way to do anything but
 * take the server's word for it.
 *
 * The daily seed fixes that without giving up the first property. The seed is
 * HMAC(secret, day) - so it cannot be predicted today - but its HASH is
 * published at 00:00 and the SEED is revealed when the day ends. So today's
 * outcomes are unknowable in advance and checkable afterwards.
 *
 * The tests below pin the three properties that make it worth anything:
 *   1. hidden while the day runs, revealed once it ends, and the reveal MATCHES
 *      the hash published before any prank landed
 *   2. a verifier can recompute the roll from public inputs alone
 *   3. the recomputed roll produces the same hit or dodge
 */

const SECRET = 'test-session-secret-not-a-real-one';

/** 2026-10-09T12:00:00Z - mid-day, so the seed must still be secret. */
const MID_DAY = Date.UTC(2026, 9, 9, 12, 0, 0);
/** 2026-10-10T00:00:01Z - the day has rolled over, so it must be revealed. */
const NEXT_DAY = Date.UTC(2026, 9, 10, 0, 0, 1);

describe('the seed is per day and not guessable', () => {
  it('gives the same seed for the same day', () => {
    expect(seedForDay(SECRET, '2026-10-09')).toBe(seedForDay(SECRET, '2026-10-09'));
  });

  it('gives a different seed each day', () => {
    expect(seedForDay(SECRET, '2026-10-09')).not.toBe(seedForDay(SECRET, '2026-10-10'));
  });

  it('gives a different seed under a different secret', () => {
    // So a seed cannot be precomputed on another deployment, or by anyone who
    // does not have this one's session secret.
    expect(seedForDay(SECRET, '2026-10-09')).not.toBe(seedForDay('other', '2026-10-09'));
  });

  it('is 32 bytes of hex, so it carries 256 bits of entropy', () => {
    expect(seedForDay(SECRET, '2026-10-09')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('commit-reveal: hidden now, checkable later', () => {
  it('publishes only the HASH while the day is running', () => {
    const state = getFairness(SECRET, MID_DAY);
    expect(state.day).toBe('2026-10-09');
    expect(state.revealed).toBe(false);
    expect(state.verifiable).toBe(true);
    // The seed itself is withheld: this is what stops anyone precomputing
    // today's outcomes.
    expect(state.seed).toBeNull();
    // But the commitment is public, and is the hash of the real seed.
    expect(state.commitHash).toBe(commitForSeed(seedForDay(SECRET, '2026-10-09')));
    // History is unaffected: the days before this one were already over, so
    // they are checkable now.
    expect(state.history[0].day).toBe('2026-10-08');
    expect(state.history).toHaveLength(7);
  });

  it("never reveals TODAY's seed, however long the day has run", () => {
    // The boundary is a property of the CALENDAR, not of elapsed time. At
    // 00:00:01 on the 10th, the 10th has barely started, so its seed is still
    // secret - and it must be, because pranks are still being decided with it.
    const state = getFairness(SECRET, NEXT_DAY);
    expect(state.day).toBe('2026-10-10');
    expect(state.revealed).toBe(false);
    expect(state.seed).toBeNull();
    // One second into the new day, yesterday is NOT available yet: its seed is
    // still inside the reveal delay, and a nonce minted at 23:59 is still live.
    // This is the whole reason the delay exists.
    expect(state.history.map((h) => h.day)).not.toContain('2026-10-09');
  });

  it("reveals a day's seed once that day AND the reveal delay are over", () => {
    // At 00:00 the day is over but the delay has not elapsed. At 00:31 it has.
    const atMidnight = getFairness(SECRET, Date.UTC(2026, 9, 10, 0, 0, 0));
    expect(atMidnight.history.map((h) => h.day)).not.toContain('2026-10-09');

    const afterDelay = getFairness(SECRET, Date.UTC(2026, 9, 10, 0, 31, 0));
    const yesterday = afterDelay.history.find((h) => h.day === '2026-10-09');
    expect(yesterday?.seed).toBe(seedForDay(SECRET, '2026-10-09'));
  });

  it('the revealed seed MATCHES the hash published while that day was running', () => {
    // The assertion the whole scheme rests on. Publish during the day, reveal
    // after it, check they agree: if they ever disagreed, the server could roll
    // with one seed and reveal another, and every recomputation would silently
    // differ from what actually happened.
    const during = getFairness(SECRET, MID_DAY); // day 9, hash only
    // Past the delay, so day 9 is in history and checkable.
    const after = getFairness(SECRET, Date.UTC(2026, 9, 10, 1, 0, 0));

    const yesterday = after.history.find((h) => h.day === '2026-10-09');
    expect(yesterday).toBeDefined();
    // The seed revealed for day 9 hashes to the hash published for day 9.
    expect(verifyReveal(yesterday!.seed, yesterday!.day, during.commitHash)).toBe(true);
    // And a new day means a new commitment, so nothing is carried over.
    expect(after.commitHash).not.toBe(during.commitHash);
  });

  it('refuses a reveal whose seed does not match its hash', () => {
    const real = seedForDay(SECRET, '2026-10-09');
    expect(verifyReveal(real, '2026-10-09', commitForSeed(real))).toBe(true);
    // A swapped seed is caught, which is what stops the commitment being
    // decorative.
    expect(verifyReveal(seedForDay('other', '2026-10-09'), '2026-10-09', commitForSeed(real))).toBe(
      false,
    );
    expect(verifyReveal(real, '2026-10-09', commitForSeed(seedForDay('other', '2026-10-09')))).toBe(
      false,
    );
  });

  it('the reveal boundary is a calculation, not a timer that can fail', () => {
    // No cron, no scheduled job. The moment a day becomes checkable is derived
    // from the calendar every time it is asked for, so it cannot fail to fire.
    const afterMidnight = getFairness(SECRET, Date.UTC(2026, 9, 10, 0, 0, 1));
    expect(afterMidnight.day).toBe('2026-10-10');
    // Still delayed, 30 minutes to wait.
    expect(afterMidnight.history.map((h) => h.day)).not.toContain('2026-10-09');

    const thirtyOneMinutesIn = getFairness(SECRET, Date.UTC(2026, 9, 10, 0, 31, 0));
    expect(thirtyOneMinutesIn.history[0].day).toBe('2026-10-09');
    expect(thirtyOneMinutesIn.history[0].seed).toBe(seedForDay(SECRET, '2026-10-09'));
  });

  it('keeps a week of history, newest first', () => {
    // Well past every reveal delay, so a full week is present.
    const state = getFairness(SECRET, Date.UTC(2026, 9, 16, 12, 0, 0));
    expect(state.history).toHaveLength(7);
    expect(state.history[0].day).toBe('2026-10-15');
    expect(state.history[6].day).toBe('2026-10-09');
    // Every historical seed verifies against its own published hash.
    for (const entry of state.history) {
      expect(verifyReveal(entry.seed, entry.day, entry.commitHash)).toBe(true);
    }
  });
});

describe('a verifier can recompute any roll from public inputs', () => {
  it('matches an independent HMAC of the published formula', () => {
    // Recomputed here from the published rule string, NOT by calling
    // rollFromSeed, so this test would catch a change to the function that the
    // rule text no longer describes.
    const seed = seedForDay(SECRET, '2026-10-09');
    const hex = createHmac('sha256', seed)
      .update('412|88|2026-10-09')
      .digest('hex')
      .slice(0, 16);
    const expected = Number(BigInt(`0x${hex}`)) / 2 ** 64;

    expect(rollFromSeed(seed, 412, 88, '2026-10-09')).toBe(expected);
  });

  it('is deterministic, so there is nothing to reroll', () => {
    const seed = seedForDay(SECRET, '2026-10-09');
    const first = rollFromSeed(seed, 412, 88, '2026-10-09');
    // Rejecting a signature and asking again returns the same number.
    for (let i = 0; i < 5; i += 1) {
      expect(rollFromSeed(seed, 412, 88, '2026-10-09')).toBe(first);
    }
  });

  it('lands in [0,1) and varies by participant and by day', () => {
    const seed = seedForDay(SECRET, '2026-10-09');
    const roll = rollFromSeed(seed, 412, 88, '2026-10-09');
    expect(roll).toBeGreaterThanOrEqual(0);
    expect(roll).toBeLessThan(1);

    expect(rollFromSeed(seed, 413, 88, '2026-10-09')).not.toBe(roll);
    expect(rollFromSeed(seed, 412, 89, '2026-10-09')).not.toBe(roll);
    expect(rollFromSeed(seedForDay(SECRET, '2026-10-10'), 412, 88, '2026-10-10')).not.toBe(roll);
  });

  it('produces the same hit or dodge the server decided', () => {
    // The end-to-end claim: given the revealed seed and the two Chogs, the
    // outcome is reproducible. Attacker accuracy is included, because omitting
    // it would make the check disagree on exactly the pairs that matter.
    const day = '2026-10-09';
    const seed = seedForDay(SECRET, day);
    const cases = [
      { from: 412, to: 88, attacker: { Eyes: 'Green laser' }, target: { Aura: 'Smoke' } },
      { from: 70, to: 561, attacker: { Eyes: 'Normal' }, target: { Aura: 'Smoke' } },
      { from: 3, to: 9, attacker: { Tier: 'Legendary' }, target: { Aura: 'Clean' } },
      { from: 900, to: 1000, attacker: { Eyes: 'Blue Smirk' }, target: {} },
    ];

    for (const c of cases) {
      const attacker = powersFor(c.attacker);
      const target = powersFor(c.target);
      const roll = rollFromSeed(seed, c.from, c.to, day);

      const outcome = resolvePrank(attacker, target, roll);
      // Recomputed the way a verifier would: straight from the published rule.
      const threshold = effectiveDodge(target.dodgeChance, attacker.accuracy);
      expect(outcome.landed).toBe(roll >= threshold);
      expect(threshold).toBeGreaterThanOrEqual(0.05);
      expect(threshold).toBeLessThanOrEqual(0.45);
    }
  });

  it('the published rule is complete enough to reimplement', () => {
    // If a rule omits the byte order, the encoding or the mapping, a verifier
    // cannot reproduce it and the whole claim is decoration.
    expect(FAIRNESS_RULE.commit).toContain('SHA256(seed)');
    expect(FAIRNESS_RULE.roll).toContain('HMAC-SHA256(seed');
    expect(FAIRNESS_RULE.roll).toContain('fromTokenId');
    expect(FAIRNESS_RULE.roll).toContain('toTokenId');
    expect(FAIRNESS_RULE.roll).toContain('2^64');
    expect(FAIRNESS_RULE.seedFor).toContain('chog-fairness');
    // And the interpretation, because a roll number means nothing without it.
    expect(FAIRNESS_RULE.interpretation).toContain('effectiveDodge');
    expect(FAIRNESS_RULE.interpretation).toContain('0.05');
    expect(FAIRNESS_RULE.interpretation).toContain('0.45');
  });
});

describe('the day key is UTC, like the daily limit', () => {
  it('rolls over at 00:00 UTC, not at local midnight', () => {
    expect(fairnessDay(new Date('2026-10-09T23:59:59Z'))).toBe('2026-10-09');
    expect(fairnessDay(new Date('2026-10-10T00:00:00Z'))).toBe('2026-10-10');
    // A player in a different timezone still shares the same day boundary, so
    // two players cannot be pranking on different seeds by accident.
    expect(fairnessDay(new Date('2026-10-10T02:00:00+05:00'))).toBe('2026-10-09');
  });
});
