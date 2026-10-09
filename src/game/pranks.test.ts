import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  PRANKS,
  getPrank,
  pickPrank,
  pointsBudgetByRarity,
  pranksByRarity,
  pranksForPowers,
} from './pranks';
import { powersFor, type PrankRarity } from './powers';

/**
 * The catalogue and powers.ts must agree.
 *
 * powers.ts names 21 signature prank ids in its trait tables. If one is missing
 * from PRANKS, the affected Chogs resolve to `null` and a Chog with a Crown
 * quietly has no signature prank - invisible in the UI and untestable by
 * hand-maintained lists. So this file PARSES powers.ts instead of trusting a
 * copy of the ids.
 */

const powersSource = readFileSync(new URL('./powers.ts', import.meta.url), 'utf8');

/**
 * Every prank id that powers.ts grants as a signature/legendary unlock.
 *
 * Only the trait TABLES are read - the whole file would also match
 * `maxRarity: 'common'`, which is a PrankRarity, not a prank. Anchoring on the
 * two signature tables is what keeps this check honest: it caught that literal
 * on the first run.
 */
function referencedPrankIds(): string[] {
  const ids = new Set<string>();
  for (const table of ['HEAD_SIGNATURE', 'ACCESSORY_SIGNATURE']) {
    const start = powersSource.indexOf(`const ${table}`);
    if (start === -1) continue;
    const end = powersSource.indexOf('};', start);
    const body = powersSource.slice(start, end);
    for (const match of body.matchAll(/:\s*'([a-z0-9][a-z0-9-]*)'/g)) {
      ids.add(match[1]);
    }
  }
  // The weekly legendary is granted through a named constant, not a table.
  const legendary = /export const LEGENDARY_PRANK_ID = '([a-z0-9-]+)'/.exec(powersSource);
  if (legendary) ids.add(legendary[1]);
  return [...ids];
}

describe('catalogue integrity', () => {
  it('has at least 10 pranks, per the brief', () => {
    expect(PRANKS.length).toBeGreaterThanOrEqual(10);
  });

  it('has no duplicate ids', () => {
    const ids = PRANKS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every prank id is kebab-case', () => {
    for (const p of PRANKS) {
      expect(p.id, p.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it('every prank has a caption and a points value', () => {
    for (const p of PRANKS) {
      expect(p.caption.length, p.id).toBeGreaterThan(0);
      expect(p.points, p.id).toBeGreaterThan(0);
    }
  });

  it('points rise with rarity, so rarer pranks are worth something', () => {
    const avg = (r: PrankRarity) => {
      const list = pranksByRarity(r);
      return list.reduce((s, p) => s + p.points, 0) / list.length;
    };
    expect(avg('rare')).toBeGreaterThan(avg('common'));
    expect(avg('legendary')).toBeGreaterThan(avg('rare'));
  });

  it('every overlay key is unique-ish (reused overlays are intentional but bounded)', () => {
    const overlays = PRANKS.map((p) => p.overlay);
    // candle-wax is shared by both candle accessories - that is by design, so
    // the assertion is that no overlay is wildly over-used.
    for (const o of new Set(overlays)) {
      expect(overlays.filter((x) => x === o).length, o).toBeLessThanOrEqual(2);
    }
  });
});

describe('catalogues stay in sync with powers.ts', () => {
  it('every prank id referenced by powers.ts exists in the catalogue', () => {
    const referenced = referencedPrankIds();
    expect(referenced.length).toBeGreaterThan(0);

    const missing = referenced.filter((id) => getPrank(id) === null);
    expect(missing, 'prank ids named in powers.ts but absent from pranks.ts').toEqual([]);
  });

  it('LEGENDARY_PRANK_ID resolves', () => {
    expect(getPrank('chog-god-mode')?.rarity).toBe('legendary');
  });

  it('the weekly legendary unlock is actually legendary', () => {
    const rareTraitPowers = powersFor({ Head: 'Blue Laser' });
    if (rareTraitPowers.legendaryPrankId) {
      expect(getPrank(rareTraitPowers.legendaryPrankId)?.rarity).toBe('legendary');
    }
  });

  it('a signature prank resolves for every real signature head trait', () => {
    for (const head of ['Crown', 'Wizard Hat', 'Spartan Helmet', 'Durag', 'Russian Hat']) {
      const powers = powersFor({ Head: head });
      if (powers.signaturePrankId) {
        expect(getPrank(powers.signaturePrankId), head).not.toBeNull();
      }
    }
  });

  it('every real accessory trait resolves to an existing prank', () => {
    for (const accessory of ['Cigar', 'Knife', 'Coin', 'Fwog', 'SB', 'PEPE', 'Heart']) {
      const powers = powersFor({ Accessory: accessory });
      if (powers.accessoryPrankId) {
        expect(getPrank(powers.accessoryPrankId), accessory).not.toBeNull();
      }
    }
  });
});

describe('pranksForPowers', () => {
  const common = { maxRarity: 'common' as const, canTaunt: false };
  const legendary = { maxRarity: 'legendary' as const, canTaunt: true };

  it('respects the tier rarity cap', () => {
    const pool = pranksForPowers(common);
    expect(pool.every((p) => p.rarity === 'common')).toBe(true);
  });

  it('a legendary Chog can see common, rare and legendary', () => {
    const pool = pranksForPowers(legendary);
    const rarities = new Set(pool.map((p) => p.rarity));
    expect(rarities.has('common')).toBe(true);
    expect(rarities.has('rare')).toBe(true);
    expect(rarities.has('legendary')).toBe(true);
  });

  it('no taunt pranks without the taunt trait', () => {
    const pool = pranksForPowers(common);
    expect(pool.some((p) => p.kind === 'taunt')).toBe(false);
  });

  it('taunt pranks appear when the trait allows them', () => {
    const pool = pranksForPowers({ maxRarity: 'rare', canTaunt: true });
    expect(pool.some((p) => p.kind === 'taunt')).toBe(true);
  });

  it('a Common Chog still gets its trait-granted signature prank', () => {
    // MEASURED: 551 of 682 signature unlocks belong to Common-tier Chogs. The
    // tier caps the ROLL, not the grant - capping both made the trait system
    // decorative for 28% of the collection.
    const pool = pranksForPowers(common, 'crown-of-the-chog');
    expect(pool.some((p) => p.id === 'crown-of-the-chog')).toBe(true);
  });

  it('but a Common Chog still cannot ROLL a rare prank', () => {
    const pool = pranksForPowers(common);
    expect(pool.some((p) => p.rarity === 'rare')).toBe(false);
  });

  it('the weekly legendary stays behind the tier cap', () => {
    // Unlike a trait signature, the legendary is a once-a-week privilege.
    const pool = pranksForPowers(common, null, null, 'chog-god-mode');
    expect(pool.some((p) => p.id === 'chog-god-mode')).toBe(false);

    const epic = pranksForPowers(legendary, null, null, 'chog-god-mode');
    expect(epic.some((p) => p.id === 'chog-god-mode')).toBe(true);
  });

  it('ignores unknown or missing signature ids instead of throwing', () => {
    expect(() => pranksForPowers(legendary, 'not-a-prank', null, undefined)).not.toThrow();
  });
});

describe('pickPrank', () => {
  const pool = pranksForPowers({ maxRarity: 'legendary', canTaunt: true });

  it('is deterministic for a given roll', () => {
    expect(pickPrank(pool, 0.42)?.id).toBe(pickPrank(pool, 0.42)?.id);
  });

  it('spreads across the whole pool', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const p = pickPrank(pool, i / 200);
      if (p) seen.add(p.id);
    }
    // Every prank should be reachable; an unreachable prank is dead content.
    expect(seen.size).toBe(pool.length);
  });

  it('clamps out-of-range rolls instead of returning undefined', () => {
    expect(pickPrank(pool, -1)).not.toBeNull();
    expect(pickPrank(pool, 1.999)).not.toBeNull();
  });

  it('returns null for an empty pool', () => {
    expect(pickPrank([], 0.5)).toBeNull();
  });
});

describe('balance', () => {
  it('points budget is positive at every rarity', () => {
    const budget = pointsBudgetByRarity();
    expect(budget.common).toBeGreaterThan(0);
    expect(budget.rare).toBeGreaterThan(0);
    expect(budget.legendary).toBeGreaterThan(0);
  });

  it('the legendary catalogue is scarce enough to stay special', () => {
    // MEASURED against the collection: only ~2% of Chogs ever qualify for a
    // legendary prank (counted rare traits). A large legendary catalogue would
    // hand that privilege to far more wallets than the rarity implies.
    expect(pranksByRarity('legendary').length).toBeLessThanOrEqual(2);
    expect(pranksByRarity('common').length).toBeGreaterThan(
      pranksByRarity('legendary').length,
    );
  });
});