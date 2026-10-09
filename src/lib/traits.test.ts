import { describe, expect, it } from 'vitest';
import {
  HIDDEN_TRAIT_LABEL,
  HIDDEN_TRAIT_VALUES,
  displayTrait,
  displayTraits,
  isHiddenTraitValue,
} from './traits';
import { collectionAvailable, loadCollection } from '@/lib/collection';
import { powersFor, ACCURACY_CAP } from '@/game/powers';

/**
 * A SLUR MUST NEVER BE RENDERED.
 *
 * "Retard" is a real Eyes value on 24 of the 1,969 Chogs Genesis. It cannot be
 * removed from the chain, so the only decision available is what this app shows
 * - and it shows "[hidden]".
 *
 * The reason this is a module rather than a habit: the Chog page is shareable,
 * the profile carries an OG image, and both are things people screenshot. A
 * mask applied by remembering at each call site is one forgotten call site away
 * from leaking, so the mask is applied by construction instead.
 */
describe('a masked value never renders', () => {
  it('hides the known value', () => {
    expect(displayTrait('Retard')).toBe(HIDDEN_TRAIT_LABEL);
    expect(isHiddenTraitValue('Retard')).toBe(true);
  });

  it('hides it whatever the casing or spacing', () => {
    // The collection ships case duplicates of the same value elsewhere, so a
    // case-sensitive blocklist would miss half of any variant that exists.
    for (const variant of ['retard', 'RETARD', 'Retard', '  Retard  ', 'ReTaRd']) {
      expect(displayTrait(variant), variant).toBe(HIDDEN_TRAIT_LABEL);
    }
  });

  it('leaves every ordinary trait value alone', () => {
    const ordinary = [
      'Happy', 'Side Eye', 'Green laser', 'Base', 'Frog', 'Smirk', 'Thug',
      'Crown', 'Cigar', 'White Aura', 'Clean', 'Dead', 'Heart',
    ];
    for (const value of ordinary) {
      expect(displayTrait(value), value).toBe(value);
      expect(isHiddenTraitValue(value), value).toBe(false);
    }
  });

  it('does not mask a value that merely CONTAINS a hidden substring', () => {
    // A substring rule would be simpler and would also hide legitimate values.
    // Only the exact value is masked.
    expect(displayTrait('Retarded')).toBe('Retarded');
    expect(displayTrait('Not Retard')).toBe('Not Retard');
  });

  it('renders nothing for a missing value, never the word undefined', () => {
    expect(displayTrait(undefined)).toBe('');
    expect(displayTrait(null)).toBe('');
    expect(displayTrait('')).toBe('');
  });

  it('the blocklist is explicit and non-empty', () => {
    // An empty list would make every test above pass vacuously.
    expect(HIDDEN_TRAIT_VALUES.length).toBeGreaterThan(0);
    for (const value of HIDDEN_TRAIT_VALUES) {
      expect(value.trim()).not.toBe('');
      expect(value).toBe(value.trim());
    }
  });
});

describe('a whole trait bag is masked by construction', () => {
  it('masks one value and keeps the rest', () => {
    const rendered = displayTraits({
      Accessory: 'Cigar',
      Eyes: 'Retard',
      Head: 'Crown',
      Tier: 'Rare',
    });
    expect(rendered).toEqual([
      { key: 'Accessory', label: 'Accessory', value: 'Cigar' },
      { key: 'Eyes', label: 'Eyes', value: HIDDEN_TRAIT_LABEL },
      { key: 'Head', label: 'Head', value: 'Crown' },
      { key: 'Tier', label: 'Tier', value: 'Rare' },
    ]);
  });

  it('drops internal marker keys', () => {
    // `__`-prefixed keys are harvest bookkeeping, not traits, and were never
    // meant to render.
    const rendered = displayTraits({ Eyes: 'Happy', __source: 'opensea', __id: '7' });
    expect(rendered.map((r) => r.key)).toEqual(['Eyes']);
  });

  it('handles a missing or empty bag', () => {
    expect(displayTraits(undefined)).toEqual([]);
    expect(displayTraits(null)).toEqual([]);
    expect(displayTraits({})).toEqual([]);
  });

  it('stringifies a non-string value rather than printing [object Object]', () => {
    expect(displayTraits({ Weird: 42 })[0].value).toBe('42');
  });
});

// ---------------------------------------------------------------------------

const hasCollection = collectionAvailable();
const { entries }: { entries: Record<string, import('@/lib/collection').CollectionEntry> } =
  hasCollection ? loadCollection() : { entries: {} };
const chogs = Object.values(entries).map((e) => ({
  tokenId: e.token_id ?? 0,
  attributes: (e.attributes ?? {}) as Record<string, string>,
}));

describe.skipIf(!hasCollection)('against the real 1,969 Chogs', () => {
  it('no Chog renders a masked value anywhere in its traits', () => {
    const offenders: string[] = [];
    for (const chog of chogs) {
      for (const { key, value } of displayTraits(chog.attributes)) {
        if (isHiddenTraitValue(chog.attributes[key]) && value !== HIDDEN_TRAIT_LABEL) {
          offenders.push(`#${chog.tokenId} ${key} rendered "${value}"`);
        }
      }
    }
    expect(offenders, offenders.slice(0, 5).join('; ')).toEqual([]);
  });

  it('the mask actually fires on real data, so it is not dead code', () => {
    // The other direction: if nothing in the collection matched, every test
    // above would be asserting against a value that does not exist.
    const affected = chogs.filter((c) =>
      Object.values(c.attributes).some((v) => isHiddenTraitValue(v)),
    );
    expect(affected.length, 'no Chog carries a masked trait value').toBeGreaterThan(0);
    console.log(`  ${affected.length} of ${chogs.length} Chogs carry a masked trait value`);
  });

  it('a masked trait grants no power and unlocks no prank', () => {
    // Belt and braces. Even if a future harvest changed the mapping, a masked
    // value must not become a way to be stronger.
    const withMasked = chogs.filter((c) =>
      Object.values(c.attributes).some((v) => isHiddenTraitValue(v)),
    );
    for (const chog of withMasked.slice(0, 50)) {
      const powers = powersFor(chog.attributes);
      expect(powers.accuracy).toBeGreaterThanOrEqual(0);
      expect(powers.accuracy).toBeLessThanOrEqual(ACCURACY_CAP);
      // And it unlocks nothing at all.
      expect(powers.hasLegendary).toBe(false);
    }
  });

  it('a masked Eyes value resolves to the same power as having no Eyes trait', () => {
    // The strongest statement of "it grants nothing": identical output.
    const withMasked = chogs.filter((c) => isHiddenTraitValue(c.attributes.Eyes));
    expect(withMasked.length).toBeGreaterThan(0);
    for (const chog of withMasked.slice(0, 20)) {
      const masked = powersFor(chog.attributes);
      const without = powersFor({ ...chog.attributes, Eyes: undefined });
      expect(masked.accuracy).toBe(without.accuracy);
    }
  });
});
