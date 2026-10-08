import { describe, expect, it } from 'vitest';
import {
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

describe('powersFor — totality', () => {
  it('gives a traitless Chog a playable power sheet (no Chog is useless)', () => {
    const p = powersFor({});
    expect(p.basePoints).toBeGreaterThan(0);
    expect(p.maxRarity).toBe('common');
    expect(p.dodgeChance).toBe(DODGE_FLOOR);
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
    expect(p.dodgeChance).toBe(DODGE_FLOOR);
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
    expect(powersFor({ Aura: 'Smoke' }).dodgeChance).toBe(DODGE_CAP);
    expect(powersFor({ Aura: 'Clean' }).dodgeChance).toBe(DODGE_FLOOR);
  });

  it('defaults to the floor when the Aura slot is empty', () => {
    expect(powersFor({}).dodgeChance).toBe(DODGE_FLOOR);
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
    expect(effectiveDodge(target.dodgeChance, attacker.accuracy)).toBeCloseTo(
      DODGE_CAP - attacker.accuracy,
      6,
    );
  });

  it('never goes below zero', () => {
    expect(effectiveDodge(0.05, ACCURACY_CAP)).toBe(0);
    expect(effectiveDodge(0.02, ACCURACY_CAP)).toBe(0);
  });

  it('is capped above by the dodge ceiling', () => {
    expect(effectiveDodge(DODGE_CAP, 0)).toBe(DODGE_CAP);
  });
});

describe('resolvePrank', () => {
  const target = powersFor({ Aura: 'Smoke' }); // 35% dodge
  const attacker = powersFor({ Eyes: 'Green laser' }); // 18% accuracy -> 17% dodge

  it('lands when the roll beats the effective dodge chance', () => {
    const r = resolvePrank(attacker, target, 0.5);
    expect(r.landed).toBe(true);
    expect(r.dodgeChance).toBeCloseTo(0.17, 6);
  });

  it('is dodged when the roll is below the dodge chance', () => {
    expect(resolvePrank(attacker, target, 0.05).landed).toBe(false);
  });

  it('treats the boundary consistently: roll >= dodge lands, roll < dodge dodges', () => {
    // Effective dodge here is 0.35 - 0.18 = 0.17. A 17% dodge chance must mean
    // 17% of rolls dodge, i.e. the half-open interval [0, 0.17) — otherwise the
    // chance would be 17% plus one whole point of float width.
    const edge = resolvePrank(attacker, target, 0.17);
    expect(edge.dodgeChance).toBeCloseTo(0.17, 6);
    expect(edge.landed).toBe(true);
    expect(resolvePrank(attacker, target, 0.169999).landed).toBe(false);
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

  it('caps at 3x', () => {
    expect(streakMultiplier(2)).toBe(2);
    expect(streakMultiplier(3)).toBe(3);
    expect(streakMultiplier(4)).toBe(3);
    expect(streakMultiplier(999)).toBe(3);
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
    expect(p.dodgeChance).toBe(DODGE_CAP);       // Smoke
    expect(p.accuracy).toBeGreaterThan(0);        // Smirk
    expect(p.accessoryPrankId).toBe('coin-toss');
    expect(p.signaturePrankId).toBeNull();        // Chog Cap is not iconic
    expect(p.canTaunt).toBe(false);               // Bubblegum
  });
});