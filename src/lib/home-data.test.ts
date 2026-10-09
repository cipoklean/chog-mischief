import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { POWER_GROUPS, FEATURED, FEATURED_TOTAL } from './home-data';
import { TOTAL_SUPPLY } from './chogs';

/**
 * The homepage makes factual claims about the collection ("87%", "628 Chogs",
 * "41 Chogs"). Those are easy to leave behind after a re-harvest, and a stale
 * number on a judge-facing page is worse than no number. This pins the copy to
 * the data it describes.
 */

const cache = JSON.parse(
  readFileSync(join(process.cwd(), 'data', 'cache', 'chogs.json'), 'utf8'),
) as Record<string, { attributes: Record<string, string> }>;

const attributes = Object.values(cache).map((c) => c.attributes);
const total = attributes.length;

function countWith(category: string): number {
  return attributes.filter((a) => Boolean(a[category])).length;
}

describe('the featured Chogs are real and playable', () => {
  it('is not empty - a missing cache would otherwise blank the homepage', () => {
    expect(FEATURED_TOTAL).toBeGreaterThan(0);
  });

  it('links only to tokens that exist', () => {
    for (const chog of FEATURED) {
      expect(chog.tokenId, `#${chog.tokenId}`).toBeGreaterThanOrEqual(1);
      expect(chog.tokenId, `#${chog.tokenId}`).toBeLessThanOrEqual(TOTAL_SUPPLY);
      expect(cache[String(chog.tokenId)], `#${chog.tokenId} missing from cache`).toBeDefined();
    }
  });

  it('shows every Chog with art, so no card renders broken', () => {
    for (const chog of FEATURED) {
      expect(chog.imageUrl, `#${chog.tokenId}`).toMatch(/^https:\/\//);
      expect(chog.name, `#${chog.tokenId}`).not.toBe('');
    }
  });

  it('includes a Legendary Chog, or the rarest content is hidden', () => {
    // The first hand-picked list was 7 Common and 5 Uncommon - no Rare, no
    // Epic, no Legendary, on a page whose whole pitch is trait-based powers.
    const tiers = new Set(FEATURED.map((c) => c.tier));
    expect(tiers.has('Legendary'), `tiers shown: ${[...tiers].join(', ')}`).toBe(true);
    expect(tiers.has('Epic')).toBe(true);
    expect(tiers.has('Rare')).toBe(true);
  });

  it('has no duplicate tokens', () => {
    const ids = FEATURED.map((c) => c.tokenId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('the trait copy matches the real collection', () => {
  const detail = (trait: string) =>
    POWER_GROUPS.find((g) => g.trait === trait)?.detail ?? '';

  it('states the real head-trait count', () => {
    // 87% of Chogs HAVE a head; the copy must not imply a head == a signature.
    expect(countWith('Head') / total).toBeCloseTo(0.872, 2);
    expect(detail('Head')).toContain('87%');
  });

  it('states the real accessory count', () => {
    expect(countWith('Accessory') / total).toBeCloseTo(0.099, 2);
    expect(detail('Accessory')).toContain('41 Chogs');
  });

  it('states the real aura and mouth counts', () => {
    expect(countWith('Aura')).toBe(974);
    expect(countWith('Mouth')).toBe(1804);
    expect(detail('Aura')).toContain('974');
    expect(detail('Mouth')).toContain('1,804');
  });

  it('never claims a percentage that no longer holds', () => {
    // Guards against the copy drifting away from the data silently.
    expect(detail('Head')).not.toContain('a third');
    expect(detail('Accessory')).not.toContain('about a tenth');
  });
});