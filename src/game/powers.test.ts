import { describe, expect, it } from 'vitest';
import {
  BASE_DODGE,
  ACCURACY_CAP,
  ChogPowers,
  ChogTraits,
  DODGE_CAP,
  DODGE_FLOOR,
  LEGENDARY_PRANK_ID,
  effectiveDodge,
  isoWeekKey,
  powersFor,
  resolvePrank,
  streakMultiplier,
  utcDayKey,
} from './powers';

describe('powersFor - totality', () => {
  it('gives a traitless Chog a playable power sheet (no Chog is useless)', () => {
    const p = powersFor({});
    expect(p.basePoints).toBeGreaterThan(0);
    expect(p.maxRarity).toBe('common');
    // Not the floor. A Chog with no Aura gets BASE_DODGE, because 995 of the
    // 1,969 have no Aura and putting them all on the floor made Eyes worth
    // nothing against half the collection.
    expect(p.dodgeChance).toBe(BASE_DODGE);
    expect(p.accuracy).toBe(0);
    expect(p.canTaunt).toBe(false);
    expect(p.signaturePrankId).toBeNull();
    expect(p.hasLegendary).toBe(false);
  });

  it('never throws on unknown trait values', () => {
    const p = powersFor({
      Tier: 'Nonexistent',
      Aura: 'Nonexistent',
      Eyes: 'Nonexistent',
      Mouth: 'Nonexistent',
      Head: 'Nonexistent',
      Accessory: 'Nonexistent',
    });
    expect(p.basePoints).toBeGreaterThan(0);
    // Not the floor. A Chog with no Aura gets BASE_DODGE, because 995 of the
    // 1,969 have no Aura and putting them all on the floor made Eyes worth
    // nothing against half the collection.
    expect(p.dodgeChance).toBe(BASE_DODGE);
  });
});

describe('tier -> power level and points', () => {
  it('scales points and rarity with tier', () => {
    const common = powersFor({ Tier: 'Common' });
    const uncommon = powersFor({ Tier: 'Uncommon' });
    const epic = powersFor({ Tier: 'Epic' });
    const legendary = powersFor({ Tier: 'Legendary' });

    expect(common.basePoints).toBeLessThan(uncommon.basePoints);
    expect(uncommon.basePoints).toBeLessThan(epic.basePoints);
    expect(epic.basePoints).toBeLessThan(legendary.basePoints);

    expect(common.maxRarity).toBe('common');
    expect(uncommon.maxRarity).toBe('rare');
    expect(epic.maxRarity).toBe('legendary');
    expect(legendary.maxRarity).toBe('legendary');
  });

  it('falls back to Common for a missing or unknown tier', () => {
    const fallback = powersFor({ Tier: 'Common' });
    expect(powersFor({}).basePoints).toBe(fallback.basePoints);
    expect(powersFor({ Tier: 'Bogus' }).basePoints).toBe(fallback.basePoints);
  });
});

describe('aura -> dodge chance', () => {
  it('keeps every aura inside the 5%..35% band (SPEC)', () => {
    const auras = ['Smoke', 'Pink Mist', 'Clean', 'Fire', 'Wind', 'Purple'];
    for (const Aura of auras) {
      const { dodgeChance } = powersFor({ Aura });
      expect(dodgeChance).toBeGreaterThanOrEqual(DODGE_FLOOR);
      expect(dodgeChance).toBeLessThanOrEqual(DODGE_CAP);
    }
  });

  it('gives Smoke the highest dodge and Clean the lowest', () => {
    // Smoke is 0.35 in the table, NOT `DODGE_CAP`. These were the same number
    // only while the cap happened to be 0.35, so the assertion was really
    // testing the clamp rather than the data. Stated as the table value, the
    // test fails if a value is ever edited, and the cap is checked separately.
    // BASE_DODGE plus the table bonus. Smoke's 0.30 bonus would total 0.50, so
    // it is the one Aura that reaches the cap - which is correct, not a clip
    // bug: it is the best dodger in the collection.
    expect(powersFor({ Aura: 'Smoke' }).dodgeChance).toBe(DODGE_CAP);
    expect(powersFor({ Aura: 'Clean' }).dodgeChance).toBeCloseTo(BASE_DODGE + 0.04, 6);
  });

  it('every real aura resolves inside the bounds', () => {
    const auras = ['Smoke', 'Pink Mist', 'Royal Blue Aura', 'Electric Shock', 'White Aura', 'Clean'];
    for (const aura of auras) {
      const { dodgeChance } = powersFor({ Aura: aura });
      expect(dodgeChance).toBeLessThanOrEqual(DODGE_CAP);
      expect(dodgeChance).toBeGreaterThanOrEqual(DODGE_FLOOR);
      // And an Aura is always worth having: at or above the baseline.
      expect(dodgeChance).toBeGreaterThanOrEqual(BASE_DODGE);
    }
    // White Aura is 1 token and its bonus is large enough to reach the cap, so
    // it is one of the clipped auras. Asserted as a relation rather than a
    // literal, because the bonus lives in the table and would drift.
    const white = powersFor({ Aura: 'White Aura' }).dodgeChance;
    expect(white).toBeLessThanOrEqual(DODGE_CAP);
    expect(white).toBeGreaterThan(BASE_DODGE);
  });

  it('defaults to BASE_DODGE when the Aura slot is empty', () => {
    expect(powersFor({}).dodgeChance).toBe(BASE_DODGE);
  });

  it('an Aura ADDS to the baseline rather than replacing it', () => {
    const none = powersFor({}).dodgeChance;
    const withAura = powersFor({ Aura: 'Clean' }).dodgeChance;
    expect(withAura).toBeGreaterThan(none);
    // And the best Aura lands on the cap, not above it.
    expect(powersFor({ Aura: 'Smoke' }).dodgeChance).toBe(DODGE_CAP);
  });

  it('no Chog in the collection sits on the floor', () => {
    // The property that matters, and the reason BASE_DODGE exists: with more
    // than half the collection having no Aura, the floor was the single most
    // common dodge value in the game.
    expect(powersFor({}).dodgeChance).toBeGreaterThan(DODGE_FLOOR);
    expect(powersFor({ Aura: 'Clean' }).dodgeChance).toBeGreaterThan(DODGE_FLOOR);
  });
});

describe('eyes -> accuracy', () => {
  it('caps accuracy so no eye trait is auto-hit', () => {
    for (const Eyes of ['Green laser', 'Green Side Eye', 'cyan laser', 'Plasma visor']) {
      expect(powersFor({ Eyes }).accuracy).toBeLessThanOrEqual(ACCURACY_CAP);
    }
  });

  it('lets a laser eye out-aim a flat eye', () => {
    expect(powersFor({ Eyes: 'Green laser' }).accuracy).toBeGreaterThan(
      powersFor({ Eyes: 'Flat' }).accuracy,
    );
  });

  it('gives no accuracy when the Eyes slot is empty', () => {
    expect(powersFor({}).accuracy).toBe(0);
  });
});

describe('mouth -> taunt unlocks', () => {
  it('unlocks taunts for loudmouths only', () => {
    expect(powersFor({ Mouth: 'Rainbow Puke' }).canTaunt).toBe(true);
    expect(powersFor({ Mouth: 'Clown Mouth' }).canTaunt).toBe(true);
    expect(powersFor({ Mouth: 'normal smile' }).canTaunt).toBe(false);
    expect(powersFor({}).canTaunt).toBe(false);
  });
});

describe('head and accessory -> signature pranks', () => {
  it('unlocks the signature prank for an iconic head', () => {
    expect(powersFor({ Head: 'Crown' }).signaturePrankId).toBe('crown-of-the-chog');
    expect(powersFor({ Head: 'Woo Cap' }).signaturePrankId).toBeNull();
  });

  it('unlocks the signature prank for an iconic accessory', () => {
    expect(powersFor({ Accessory: 'Knife' }).accessoryPrankId).toBe('airport-security');
    expect(powersFor({ Accessory: 'Nothing' }).accessoryPrankId).toBeNull();
    expect(powersFor({}).accessoryPrankId).toBeNull();
  });
});

describe('rare traits -> weekly legendary', () => {
  it('grants the legendary for a genuinely rare trait value', () => {
    // Measured rarities: White Aura 1 token, Blue Laser head 1, ETH Cap 2.
    expect(powersFor({ Aura: 'White Aura' }).legendaryPrankId).toBe(LEGENDARY_PRANK_ID);
    expect(powersFor({ Head: 'Blue Laser' }).legendaryPrankId).toBe(LEGENDARY_PRANK_ID);
    expect(powersFor({ Head: 'ETH Cap' }).legendaryPrankId).toBe(LEGENDARY_PRANK_ID);
  });

  it('withholds it from values that merely LOOK rare', () => {
    // Plasma visor (43 tokens), Spartan Helmet (40) and Base eyes (33) are all
    // far too common to be "the rarest thing in the collection".
    expect(powersFor({ Eyes: 'Plasma visor' }).hasLegendary).toBe(false);
    expect(powersFor({ Head: 'Spartan Helmet' }).hasLegendary).toBe(false);
    expect(powersFor({ Eyes: 'Base' }).hasLegendary).toBe(false);
  });

  it('withholds it from common values', () => {
    expect(powersFor({ Eyes: 'Happy', Head: 'Mon Cap', Aura: 'Smoke' }).hasLegendary).toBe(
      false,
    );
  });
});

describe('accuracy reduces the target dodge', () => {
  it('subtracts accuracy from the target dodge', () => {
    const target: ChogPowers = powersFor({ Aura: 'Smoke' });
    const attacker = powersFor({ Eyes: 'Green laser' });
    // Subtracted from the target's REAL dodge, not from the cap: the target may
    // sit anywhere between floor and cap, and crediting the attacker with the
    // difference overstated how much their eyes were worth.
    expect(effectiveDodge(target.dodgeChance, attacker.accuracy)).toBeCloseTo(
      target.dodgeChance - attacker.accuracy,
      6,
    );
  });

  it('never drops below the floor, so no Chog becomes undodgeable', () => {
    // The floor, not zero. Clamping to 0 meant a strong attacker could take a
    // low-dodge target to literally 0 and it could then never dodge anything.
    expect(effectiveDodge(DODGE_FLOOR, ACCURACY_CAP)).toBe(DODGE_FLOOR);
    expect(effectiveDodge(0, ACCURACY_CAP)).toBe(DODGE_FLOOR);
    // Accuracy decides how small the chance gets, never that there is none.
    for (const accuracy of [0, 0.05, 0.1, 0.2]) {
      expect(effectiveDodge(BASE_DODGE, accuracy)).toBeGreaterThanOrEqual(DODGE_FLOOR);
    }
  });

  it('accuracy is worth something against a no-Aura target', () => {
    // The regression this baseline exists to prevent. With every no-Aura Chog
    // on the floor, subtracting accuracy changed nothing at all.
    const target = powersFor({}).dodgeChance;
    expect(effectiveDodge(target, 0)).toBe(target);
    // Partial accuracy reduces it by exactly that much.
    expect(effectiveDodge(target, 0.10)).toBeCloseTo(target - 0.10, 6);
    expect(effectiveDodge(target, 0.10)).toBeLessThan(target);
    // MAX accuracy takes it to the floor exactly: BASE_DODGE (0.20) minus the
    // accuracy cap (0.20) is 0, and the floor is what saves it.
    expect(effectiveDodge(target, ACCURACY_CAP)).toBe(DODGE_FLOOR);
    expect(effectiveDodge(target, ACCURACY_CAP)).toBeGreaterThan(0);
  });

  it('is capped above by the dodge ceiling', () => {
    expect(effectiveDodge(DODGE_CAP, 0)).toBe(DODGE_CAP);
  });
});

describe('resolvePrank', () => {
  const target = powersFor({ Aura: 'Smoke' }); // 35% dodge
  const attacker = powersFor({ Eyes: 'Green laser' }); // 18% accuracy -> 17% dodge

  it('lands when the roll beats the effective dodge chance', () => {
    // The expected threshold is DERIVED, not written as 0.17. It used to be a
    // literal, and changing BASE_DODGE moved the real value to 0.27 without the
    // literal being obviously wrong - the test failed with a number nobody could
    // immediately account for.
    const expected = Math.max(
      DODGE_FLOOR,
      Math.min(DODGE_CAP, target.dodgeChance - attacker.accuracy),
    );
    const r = resolvePrank(attacker, target, 0.5);
    expect(r.landed).toBe(true);
    expect(r.dodgeChance).toBeCloseTo(expected, 6);
  });

  it('is dodged when the roll is below the dodge chance', () => {
    expect(resolvePrank(attacker, target, 0.05).landed).toBe(false);
  });

  it('treats the boundary consistently: roll >= dodge lands, roll < dodge dodges', () => {
    // A d% dodge chance must mean d% of rolls dodge, i.e. the half-open
    // interval [0, d) - otherwise the chance would be d% plus one whole point
    // of float width. Both sides of the edge are pinned.
    const d = resolvePrank(attacker, target, 0).dodgeChance;
    const edge = resolvePrank(attacker, target, d);
    expect(edge.dodgeChance).toBeCloseTo(d, 6);
    expect(edge.landed).toBe(true);
    expect(resolvePrank(attacker, target, d - 1e-6).landed).toBe(false);
  });

  it('always lands against a zero-dodge target at any legal roll', () => {
    const zeroDodge = powersFor({ Aura: 'Clean' }); // 5% floor, minus max accuracy -> 0
    const strong = powersFor({ Eyes: 'Green laser' });
    for (const roll of [0, 0.01, 0.5, 0.99]) {
      const r = resolvePrank(strong, zeroDodge, roll);
      if (r.dodgeChance === 0) expect(r.landed).toBe(true);
    }
  });
});

describe('streak multiplier', () => {
  it('starts at 1x', () => {
    expect(streakMultiplier(0)).toBe(1);
    expect(streakMultiplier(1)).toBe(1);
  });

  it('adds a quarter per extra day and caps at 3x', () => {
    // min(1 + 0.25*(streak-1), 3): 1x, 1.25x, 1.5x ... 3x at streak 9.
    expect(streakMultiplier(2)).toBeCloseTo(1.25, 6);
    expect(streakMultiplier(3)).toBeCloseTo(1.5, 6);
    expect(streakMultiplier(4)).toBeCloseTo(1.75, 6);
    expect(streakMultiplier(5)).toBe(2);
    expect(streakMultiplier(9)).toBe(3);
    expect(streakMultiplier(999)).toBe(3);
  });

  it('is strictly increasing until it hits the cap', () => {
    // Every day of a streak must be worth something, or persisting is pointless.
    for (let s = 2; s < 9; s += 1) {
      expect(streakMultiplier(s + 1)).toBeGreaterThan(streakMultiplier(s));
    }
  });
});

describe('day and week keys', () => {
  it('buckets by UTC day', () => {
    expect(utcDayKey(new Date('2026-10-08T23:59:59Z'))).toBe('2026-10-08');
    expect(utcDayKey(new Date('2026-10-09T00:00:00Z'))).toBe('2026-10-09');
  });

  it('buckets a week by its Monday', () => {
    // 2026-10-08 is a Thursday; its week starts Monday 2026-10-05.
    expect(isoWeekKey(new Date('2026-10-08T12:00:00Z'))).toBe('2026-10-05');
    // Sunday still belongs to the same week.
    expect(isoWeekKey(new Date('2026-10-11T23:00:00Z'))).toBe('2026-10-05');
    // The next Monday starts a new one.
    expect(isoWeekKey(new Date('2026-10-12T00:00:00Z'))).toBe('2026-10-12');
  });
});

describe('a real measured Chog', () => {
  it('resolves token 1969 (Aura Smoke, Head Chog Cap) to sane powers', () => {
    const traits: ChogTraits = {
      Accessory: 'Coin',
      Aura: 'Smoke',
      Background: 'Deep Blue',
      Base: 'Origin',
      Eyes: 'Smirk',
      Form: 'Chog',
      Head: 'Chog Cap',
      Mouth: 'Bubblegum',
      Naked: 'No',
      Side: 'Left',
      Skin: 'Origin',
      Tier: 'Uncommon',
    };
    const p = powersFor(traits);
    expect(p.maxRarity).toBe('rare');
    expect(p.dodgeChance).toBe(DODGE_CAP);       // Smoke, baseline + bonus, capped
    expect(p.accuracy).toBeGreaterThan(0);        // Smirk
    expect(p.accessoryPrankId).toBe('coin-toss');
    expect(p.signaturePrankId).toBeNull();        // Chog Cap is not iconic
    expect(p.canTaunt).toBe(false);               // Bubblegum
  });
});