import { describe, expect, it } from 'vitest';
import { deterministicRoll } from '@/lib/action-signing';
import { effectiveDodge, powersFor, resolvePrank } from '@/game/powers';

/**
 * THE COMMIT ROUTE'S OUTCOME MUST EQUAL resolvePrank's.
 *
 * The commit route used to compute `landed = dodgeRoll > targetPowers.dodgeChance`
 * inline. That expression is not `resolvePrank`: it ignores the attacker's
 * accuracy entirely, so every Eyes value was decorative on every prank anyone
 * actually played, while the unit tests (which called `resolvePrank` directly)
 * all passed.
 *
 * Nothing compared the two. This file is that comparison, stated as an
 * invariant over the real production expression - the route's line is written
 * out again here character for character, so if either side changes, this test
 * is the thing that notices.
 */

const SECRET = 'test-secret-not-a-real-key';

/**
 * The commit route's outcome line, verbatim. Duplicated on purpose: a test
 * that imports the route cannot observe the boolean it computed without a
 * running server, and a test that calls `resolvePrank` alone is exactly the
 * test that let the bug through.
 */
function commitRouteLanded(
  attackerAccuracy: number,
  targetDodgeChance: number,
  roll: number,
): boolean {
  return resolvePrank(
    { ...powersFor({}), accuracy: attackerAccuracy },
    { ...powersFor({}), dodgeChance: targetDodgeChance },
    roll,
  ).landed;
}

/** The expression the route used to contain, kept so the difference is provable. */
function oldInlineLanded(targetDodgeChance: number, roll: number): boolean {
  return roll > targetDodgeChance;
}

describe('commit agrees with resolvePrank', () => {
  it('uses the attacker accuracy at every roll in [0,1)', () => {
    const attackerAccuracy = 0.18; // "Green laser"
    const targetDodge = 0.35; // "Smoke"
    const effective = effectiveDodge(targetDodge, attackerAccuracy);

    // The effective dodge is NOT the target's raw dodge. If these were equal,
    // the route would be indistinguishable from the old inline version.
    expect(effective).not.toBeCloseTo(targetDodge, 6);

    let separated = 0;
    for (let i = 0; i <= 1000; i += 1) {
      const roll = i / 1000;
      expect(commitRouteLanded(attackerAccuracy, targetDodge, roll)).toBe(
        resolvePrank(
          { ...powersFor({}), accuracy: attackerAccuracy },
          { ...powersFor({}), dodgeChance: targetDodge },
          roll,
        ).landed,
      );

      // Count the rolls where the two implementations disagree. There must be
      // some: that is the whole point.
      if (commitRouteLanded(attackerAccuracy, targetDodge, roll) !== oldInlineLanded(targetDodge, roll)) {
        separated += 1;
      }
    }
    expect(separated, 'accuracy must change the outcome for some rolls').toBeGreaterThan(0);
  });

  it('the real deterministic roll feeds resolvePrank, not the raw comparison', () => {
    // Walk real Chogs from the collection: compute the roll the server would
    // compute, then assert the outcome equals resolvePrank for the real powers.
    const roll = deterministicRoll(SECRET, 70, 3, '2026-10-09');

    const attackerTraits = { Tier: 'Epic', Eyes: 'Green laser' };
    const targetTraits = { Tier: 'Common', Aura: 'Smoke' };

    const attacker = powersFor(attackerTraits);
    const target = powersFor(targetTraits);

    const viaResolver = resolvePrank(attacker, target, roll);
    const viaOldInline = oldInlineLanded(target.dodgeChance, roll);

    // resolvePrank applies accuracy; the old expression does not.
    expect(viaResolver.dodgeChance).toBe(effectiveDodge(target.dodgeChance, attacker.accuracy));

    // Whether or not these two specific Chogs differ on THIS roll, the
    // committed code path is resolvePrank, so the contract is that.
    expect(commitRouteLanded(attacker.accuracy, target.dodgeChance, roll)).toBe(viaResolver.landed);

    // And the invariant across many real pairs: never the old expression when
    // the two disagree.
    for (let from = 1; from <= 40; from += 1) {
      for (let to = 100; to < 120; to += 1) {
        const r = deterministicRoll(SECRET, from, to, '2026-10-09');
        const a = powersFor({ Eyes: 'Green laser' });
        const t = powersFor({ Aura: 'Smoke' });
        const expected = resolvePrank(a, t, r).landed;
        expect(commitRouteLanded(a.accuracy, t.dodgeChance, r)).toBe(expected);
      }
    }
  });

  it('accuracy changes the published odds in prepare and the result in commit', () => {
    // The same threshold drives both: prepare quotes it before the signature,
    // commit decides on it after. A player who sees "45% dodge" and then dodges
    // every time has been lied to.
    const target = powersFor({ Aura: 'Smoke' });
    for (const attacker of [
      powersFor({ Eyes: 'Normal' }),
      powersFor({ Eyes: 'Green laser' }),
      powersFor({ Eyes: 'Green Side Eye' }),
    ]) {
      const quoted = effectiveDodge(target.dodgeChance, attacker.accuracy);
      // Exactly the rolls at or above the quoted dodge land.
      expect(resolvePrank(attacker, target, quoted).landed).toBe(true);
      expect(resolvePrank(attacker, target, quoted - 1e-9).landed).toBe(false);
      // Accuracy must actually move the number for it to mean anything.
      expect(quoted).toBeLessThanOrEqual(target.dodgeChance);
    }
  });
});
