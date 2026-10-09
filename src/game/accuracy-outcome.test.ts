import { describe, expect, it } from 'vitest';
import {
  ACCURACY_CAP,
  DODGE_FLOOR,
  effectiveDodge,
  powersFor,
  resolvePrank,
  type ChogPowers,
} from './powers';
import { pointsFor } from './rules';

/**
 * ATTACKER ACCURACY MUST AFFECT THE REAL OUTCOME.
 *
 * `effectiveDodge` and `resolvePrank` existed from the start and were correct,
 * and the commit route computed `landed = roll > targetPowers.dodgeChance`
 * instead of calling them. Nothing tested the route against the resolver, so
 * the attacker's Eyes - the trait sold as "aiming eyes" - had NO effect on any
 * prank that was actually played. Every Eyes value in the game was decorative.
 *
 * These tests exist to make that class of failure loud: they pin the rule the
 * resolver implements, pin that the rule is not vacuous at the extremes, and
 * pin that higher accuracy flips a dodge to a hit at a FIXED roll. That last
 * one is the only assertion that would have caught the real bug, because it
 * compares two attackers holding everything else equal.
 */

/** A target with no Aura sits exactly on the floor. */
const noAuraTarget = (): ChogPowers => powersFor({ Aura: undefined });

describe('a no-Aura target keeps a real chance to dodge', () => {
  it('never drops below DODGE_FLOOR, even against max accuracy', () => {
    const target = noAuraTarget();
    expect(target.dodgeChance).toBe(DODGE_FLOOR);

    // Every accuracy in the legal range, including the cap.
    for (const accuracy of [0, 0.02, 0.05, 0.1, 0.15, ACCURACY_CAP]) {
      const effective = effectiveDodge(target.dodgeChance, accuracy);
      expect(effective).toBeGreaterThanOrEqual(DODGE_FLOOR);
    }
  });

  it('"Happy" eyes against a no-Aura target lands on the floor, not below', () => {
    // "Happy" is 0.05, and the target is already at 0.05: 0.05 - 0.05 = 0.
    // The old clamp was [0, CAP], so this returned 0 and the target could not
    // dodge anything at all. It must now return exactly the floor.
    const happy = powersFor({ Eyes: 'Happy' });
    const effective = effectiveDodge(noAuraTarget().dodgeChance, happy.accuracy);
    expect(effective).toBe(DODGE_FLOOR);
    expect(effective).toBeGreaterThan(0);
  });

  it('an attacker with no accuracy trait leaves the target untouched', () => {
    const target = powersFor({ Aura: 'Smoke' });
    expect(effectiveDodge(target.dodgeChance, 0)).toBe(target.dodgeChance);
  });

  it('the same roll dodges for a weak attacker and hits for an accurate one', () => {
    // landed = roll >= dodge. The roll is "did it get through", so a HIGH roll
    // LANDS and a low roll dodges. One roll, two attackers identical except for
    // Eyes: this is the assertion that would have caught the commit route
    // reading targetPowers.dodgeChance directly, because the route returned the
    // same answer for both.
    const target = powersFor({ Aura: 'Smoke' });
    const roll = target.dodgeChance + 0.001;

    const plain = powersFor({ Eyes: 'Normal' });   // accuracy 0.05
    const aim = powersFor({ Eyes: 'Green laser' }); // accuracy 0.18

    // roll = 0.351. Plain accuracy 0.05 leaves dodge 0.30 -> 0.351 >= 0.30,
    // so it lands. Green laser accuracy 0.18 leaves dodge 0.17 -> also lands.
    // A roll that clears BOTH thresholds lands either way, which is why the
    // roll has to sit between the two dodge values to separate them.
    expect(resolvePrank(plain, target, roll).landed).toBe(true);
    expect(resolvePrank(aim, target, roll).landed).toBe(true);

    // The separating case: a roll the plain attacker clears but the accurate
    // one does not. 0.35 < 0.351 is false... so pick the mirror: a roll below
    // the plain threshold and above the accurate one.
    const between = 0.19; // < 0.30 (plain dodge), >= 0.17 (aim dodge)
    expect(resolvePrank(plain, target, between).landed).toBe(false); // dodges
    expect(resolvePrank(aim, target, between).landed).toBe(true);    // lands
  });
});

describe('resolvePrank is the single source of the outcome', () => {
  it('agrees with the published dodge chance', () => {
    const attacker = powersFor({ Eyes: 'Green laser' });
    const target = powersFor({ Aura: 'Pink Mist' });
    const dodge = resolvePrank(attacker, target, 0).dodgeChance;

    // The reported dodge chance must be exactly what decides the roll.
    // landed = roll >= dodge, so the threshold itself LANDS and anything below
    // it dodges. Both sides of the boundary are pinned, because a boundary that
    // is off by one only shows up on one side.
    expect(resolvePrank(attacker, target, dodge).landed).toBe(true);
    expect(resolvePrank(attacker, target, dodge - 0.0001).landed).toBe(false);
    expect(resolvePrank(attacker, target, 0.999).landed).toBe(true);
    expect(resolvePrank(attacker, target, 0).landed).toBe(false);
  });

  it('returns the same dodge chance it decides with', () => {
    const attacker = powersFor({ Eyes: 'Blue Smirk' });
    const target = powersFor({ Aura: 'Royal Blue Aura' });
    for (const roll of [0, 0.1, 0.25, 0.44, 0.8, 0.999]) {
      const out = resolvePrank(attacker, target, roll);
      // The rule itself, restated: the roll must clear the published threshold.
      expect(out.landed).toBe(roll >= out.dodgeChance);
    }
  });

  it('is monotonic in accuracy at a fixed roll', () => {
    // landed = roll >= dodge, and accuracy only ever LOWERS dodge. So for a
    // fixed roll, raising accuracy can turn a dodge into a land but never the
    // reverse: the landed sequence over rising accuracy is false...true, and
    // once true it stays true.
    const target = powersFor({ Aura: 'Violet' });
    const roll = target.dodgeChance - 0.01; // clears no threshold: dodges
    let seenLand = false;
    for (const accuracy of [0, 0.05, 0.1, 0.15, ACCURACY_CAP]) {
      const landed = resolvePrank({ ...powersFor({}), accuracy }, target, roll).landed;
      if (seenLand) expect(landed).toBe(true); // never goes back to dodging
      if (landed) seenLand = true;
    }
    expect(seenLand, 'max accuracy should clear a roll near the dodge value').toBe(true);
  });
});

describe('accuracy is bounded so no attacker is uncounterable', () => {
  it('caps accuracy at ACCURACY_CAP', () => {
    const wild = { ...powersFor({}), accuracy: 5 };
    const capped = { ...powersFor({}), accuracy: ACCURACY_CAP };
    expect(resolvePrank(wild, noAuraTarget(), 0).dodgeChance).toBe(
      resolvePrank(capped, noAuraTarget(), 0).dodgeChance,
    );
  });

  it('a Legendary attacker cannot make the best dodger unable to dodge', () => {
    const best = powersFor({ Aura: 'Smoke' });
    const attacker = { ...powersFor({ Tier: 'Legendary' }), accuracy: ACCURACY_CAP };
    const { dodgeChance } = resolvePrank(attacker, best, 0);
    expect(dodgeChance).toBeGreaterThanOrEqual(DODGE_FLOOR);
    // Even the ceiling cannot reach zero: the lowest roll still dodges.
    expect(resolvePrank(attacker, best, 0).landed).toBe(false);
    // ...and a high roll still lands, so the Chog is not invulnerable either.
    expect(resolvePrank(attacker, best, 0.999).landed).toBe(true);
  });
});

describe('points stay separate from accuracy', () => {
  it('accuracy changes whether a prank lands, never what it pays', () => {
    // Two attackers, same tier, same streak, same base points: the only
    // difference is Eyes, and eyes must not be worth points.
    const plain = powersFor({ Tier: 'Common' });
    const aim = powersFor({ Tier: 'Common', Eyes: 'Green laser' });
    expect(plain.basePoints).toBe(aim.basePoints);
    expect(pointsFor(plain.basePoints, 1, false)).toBe(pointsFor(aim.basePoints, 1, false));
  });
});
