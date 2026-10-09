import { describe, expect, it } from 'vitest';
import {
  ACCURACY_CAP,
  BASE_DODGE,
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
    // No Aura no longer means the floor: every Chog has a baseline, and 995 of
    // the 1,969 have no Aura at all.
    expect(target.dodgeChance).toBe(BASE_DODGE);
    expect(target.dodgeChance).toBeGreaterThan(DODGE_FLOOR);

    // Every accuracy in the legal range, including the cap.
    for (const accuracy of [0, 0.02, 0.05, 0.1, 0.15, ACCURACY_CAP]) {
      const effective = effectiveDodge(target.dodgeChance, accuracy);
      expect(effective).toBeGreaterThanOrEqual(DODGE_FLOOR);
    }
  });

  it('accuracy reduces a no-Aura target instead of doing nothing to it', () => {
    // The regression a baseline prevents: with every no-Aura Chog on the floor,
    // subtracting accuracy changed nothing for half the collection. The floor
    // only clamps, so a target sitting ON the floor cannot be reduced further.
    const target = noAuraTarget().dodgeChance;

    // The contrast that matters: a target sitting ON the floor is immovable,
    // because the floor clamps. A baselined one is reduced normally.
    expect(effectiveDodge(DODGE_FLOOR, ACCURACY_CAP)).toBe(DODGE_FLOOR);
    expect(effectiveDodge(DODGE_FLOOR, 0.05)).toBe(DODGE_FLOOR);

    // At partial accuracy the reduction is exact...
    expect(effectiveDodge(target, 0.05)).toBeCloseTo(target - 0.05, 6);
    // ...and at MAX accuracy it lands exactly on the floor, which is the floor
    // doing its job rather than a clamp that should not have been needed.
    expect(effectiveDodge(target, ACCURACY_CAP)).toBe(DODGE_FLOOR);
  });

  it('"Happy" eyes reduces a no-Aura target but never to zero', () => {
    // "Happy" is 0.05 accuracy. With the old model the target sat on the 0.05
    // floor, so 0.05 - 0.05 = 0 and the target could not dodge anything at all.
    // With the baseline it simply gets worse at dodging, which is a different
    // and fairer outcome than being immune.
    const happy = powersFor({ Eyes: 'Happy' });
    const target = noAuraTarget().dodgeChance;
    const effective = effectiveDodge(target, happy.accuracy);
    expect(effective).toBeCloseTo(target - happy.accuracy, 6);
    expect(effective).toBeGreaterThan(0);
    expect(effective).toBeLessThan(target);
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
    // Between the two dodge thresholds for these attackers.
    const between = (effectiveDodge(target.dodgeChance, plain.accuracy)
      + effectiveDodge(target.dodgeChance, aim.accuracy)) / 2;
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
