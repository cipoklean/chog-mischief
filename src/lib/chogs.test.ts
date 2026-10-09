import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getChog, TOTAL_SUPPLY, getOwnerFromSnapshot } from './chogs';
import { loadCollection } from './collection';

/**
 * These run against the REAL harvested cache and the REAL owner snapshot, not
 * fixtures. Every bug this file guards was found by rendering a live page, not
 * by reading code, so a hand-written fixture would have agreed with the bug.
 */

// Read lazily through the helper (live cache, else the committed snapshot):
// a module-level read threw on a fresh clone before any guard could fire.
const cache = loadCollection().entries;

describe('the harvested cache is complete', () => {
  it('has an entry for every token in the collection', () => {
    expect(Object.keys(cache).length).toBe(TOTAL_SUPPLY);
  });

  it('keys each entry by the same id as its token_id field', () => {
    // A shifted mapping would silently show the wrong art and traits.
    for (const [key, value] of Object.entries(cache)) {
      expect(Number(key), `key ${key} vs token_id ${value.token_id}`).toBe(value.token_id);
    }
  });
});

describe('display names belong to their own token', () => {
  it('never returns the collection-wide default for a different token', () => {
    // OpenSea serves every asset page "CHOG #1462". If getChog trusted that
    // field, all 1,969 pages would be titled as token 1462.
    const chog1462 = getChog(1462)!;
    const chog1 = getChog(1)!;
    expect(chog1.name).not.toBe(chog1462.name);
  });

  it('includes the token id in every name', () => {
    for (const id of [1, 3, 61, 70, 561, 900, 1462, 1969]) {
      expect(getChog(id)!.name, `token ${id}`).toContain(String(id));
    }
  });

  it('renders the recovered descriptive names for the 10 named Chogs', () => {
    // These are the only Chogs in the collection with real names.
    expect(getChog(561)!.name).toBe('561 - Blaze');
    expect(getChog(900)!.name).toBe('900 - Burning Skully');
    expect(getChog(1881)!.name).toBe('1881 - Midas');
  });

  it('never invents a name for a token that is not in the cache', () => {
    expect(getChog(0)).toBeNull();
    expect(getChog(TOTAL_SUPPLY + 1)).toBeNull();
  });
});

describe('every Chog has what a shareable page needs', () => {
  it('gives all 1,969 a name, art and traits', () => {
    const missingName: number[] = [];
    const missingImage: number[] = [];
    const noTier: number[] = [];

    for (let id = 1; id <= TOTAL_SUPPLY; id++) {
      const chog = getChog(id);
      if (!chog) continue;
      // A page whose <h1> is empty looks broken, which is how the name bug
      // first showed up in the browser.
      if (!chog.name) missingName.push(id);
      // A card with a broken image looks broken.
      if (!chog.imageUrl) missingImage.push(id);
      // Tier drives points and the rarity cap; a Chog without one cannot play.
      if (!chog.traits.Tier) noTier.push(id);
    }

    expect(missingName).toEqual([]);
    expect(missingImage).toEqual([]);
    expect(noTier).toEqual([]);
  });

  it('spans the full tier range, so the homepage can show a Legendary', () => {
    const tiers = new Set(
      Object.values(cache).map((c) => c.attributes.Tier).filter(Boolean),
    );
    expect(tiers.size).toBeGreaterThan(1);
    expect(tiers.has('Legendary')).toBe(true);
  });
});

describe('the owner snapshot', () => {
  it('resolves a real holder for a token it covers', () => {
    const owners = JSON.parse(
      readFileSync(join(process.cwd(), 'data', 'owners.json'), 'utf8'),
    ) as { owners: Record<string, number[]> };

    const knownToken = Object.values(owners.owners).flat()[0];
    const owner = getOwnerFromSnapshot(knownToken);
    expect(owner).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it('returns null rather than throwing when a token is not covered', () => {
    expect(getOwnerFromSnapshot(TOTAL_SUPPLY + 500)).toBeNull();
  });
});