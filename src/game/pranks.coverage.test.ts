import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { pranksForPowers, pranksByRarity } from './pranks';
import { powersFor, type ChogTraits } from './powers';

/**
 * Runs the REAL powers + catalogue over all 1,969 harvested Chogs.
 *
 * Skipped on a fresh clone (data/cache/ is gitignored) - run
 * `python3 scripts/harvest-traits.py --concurrency 6` first.
 *
 * Why this exists: per-input tests cannot see a DISTRIBUTION. The legendary
 * prank shipped to 30% of the collection before this kind of check existed, and
 * every unit test was green the whole time.
 */

interface Cached {
  token_id: number;
  attributes: ChogTraits;
}

const cachePath = join(process.cwd(), 'data', 'cache', 'chogs.json');
const hasCache = existsSync(cachePath);

describe.skipIf(!hasCache)('catalogue over the real collection', () => {
  const raw = JSON.parse(readFileSync(cachePath, 'utf8')) as
    | Record<string, Cached>
    | Cached[];

  const tokens: Cached[] = Array.isArray(raw) ? raw : Object.values(raw);

  it('loaded the whole collection', () => {
    expect(tokens.length).toBe(1969);
  });

  it('every real Chog can pull at least one prank', () => {
    // A traitless or low-tier Chog must still be playable - that was an explicit
    // design constraint, and an empty pool is the failure mode.
    const empty = tokens.filter((t) => {
      const p = powersFor(t.attributes);
      return (
        pranksForPowers(p, p.signaturePrankId, p.accessoryPrankId, p.legendaryPrankId)
          .length === 0
      );
    });
    expect(empty.length, `${empty.length} Chogs have no prank available`).toBe(0);
  });

  it('NO granted trait signature is unusable by its owner', () => {
    // This is the assertion that matters, and the first draft got it backwards:
    // it asserted every grant resolves, failed on 551 Common Chogs, and the
    // instinct was to "fix" the code. Measuring first showed the code was
    // capping trait grants by tier - 81% of signature unlocks were dead content.
    //
    // Now the rule is absolute: a trait that grants a signature prank makes it
    // usable. Only the weekly legendary may be withheld, and only by the cap.
    const deadSignatures: string[] = [];
    let withheldWeekly = 0;

    for (const t of tokens) {
      const p = powersFor(t.attributes);
      const inPool = new Set(
        pranksForPowers(p, p.signaturePrankId, p.accessoryPrankId, p.legendaryPrankId).map((x) => x.id),
      );

      for (const id of [p.signaturePrankId, p.accessoryPrankId]) {
        if (id && !inPool.has(id)) deadSignatures.push(`${t.attributes.Tier ?? '?'}:${id}`);
      }
      if (p.legendaryPrankId && !inPool.has(p.legendaryPrankId)) withheldWeekly += 1;
    }

    expect(
      deadSignatures.slice(0, 10),
      `${deadSignatures.length} trait grants are unusable by their owner`,
    ).toEqual([]);
    expect(withheldWeekly, 'weekly legendaries withheld by the tier cap').toBeGreaterThanOrEqual(0);
  });

  it('a large share of the collection actually gets a signature prank', () => {
    // If this ever collapses toward zero, the trait system is decorative again.
    const withSignature = tokens.filter((t) => {
      const p = powersFor(t.attributes);
      return Boolean(p.signaturePrankId ?? p.accessoryPrankId);
    }).length;
    const pct = (withSignature / tokens.length) * 100;
    console.log(`signature prank granted to ${withSignature}/${tokens.length} (${pct.toFixed(1)}%)`);
    expect(pct).toBeGreaterThan(25);
  });

  it('legendary pranks stay rare across the collection', () => {
    let legendaryChogs = 0;
    for (const t of tokens) {
      const p = powersFor(t.attributes);
      if (p.hasLegendary) legendaryChogs += 1;
    }
    const pct = (legendaryChogs / tokens.length) * 100;
    // Measured target is ~2%. Allow headroom for the coverage test to be a
    // guard rail, not a tripwire on a two-token difference.
    expect(pct, `${legendaryChogs}/${tokens.length} Chogs qualify`).toBeLessThan(6);
  });

  it('taunt-gated Chogs are a minority, so the Mouth gate means something', () => {
    const taunters = tokens.filter((t) => powersFor(t.attributes).canTaunt).length;
    const pct = (taunters / tokens.length) * 100;
    expect(pct).toBeGreaterThan(1);
    expect(pct).toBeLessThan(75);
  });

  it('the catalogue is reachable: no prank is dead content', () => {
    // Every prank should be pullable by at least one real Chog.
    const reachable = new Set<string>();
    for (const t of tokens) {
      const p = powersFor(t.attributes);
      for (const prank of pranksForPowers(
        p,
        p.signaturePrankId,
        p.accessoryPrankId,
        p.legendaryPrankId,
      )) {
        reachable.add(prank.id);
      }
    }
    const unreachable = [
      ...new Set([
        ...pranksByRarity('common'),
        ...pranksByRarity('rare'),
        ...pranksByRarity('legendary'),
      ]),
    ]
      .map((p) => p.id)
      .filter((id) => !reachable.has(id));

    expect(unreachable, 'pranks no real Chog can pull').toEqual([]);
  });
});