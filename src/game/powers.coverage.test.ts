/**
 * Coverage check against the REAL harvested trait data.
 *
 * Runs only when `data/cache/chogs.json` exists (it is gitignored, so a fresh
 * clone skips this file rather than failing). Its job: prove that every trait
 * value a real Chog can have resolves to a real power, and print the
 * distribution of the resulting power sheet so the balance is visible.
 *
 * Run: npm run test   (or)   npx vitest run src/game/powers.coverage.test.ts
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { powersFor } from './powers';

const CACHE = join(process.cwd(), 'data', 'cache', 'chogs.json');
const hasCache = existsSync(CACHE);

describe.skipIf(!hasCache)('powers vs the real collection', () => {
  const raw = JSON.parse(readFileSync(CACHE, 'utf8')) as Record<
    string,
    { token_id: number; attributes: Record<string, string> }
  >;
  const chogs = Object.values(raw);

  it('harvested the whole collection', () => {
    expect(chogs.length).toBe(1969);
  });

  it('gives every real Chog a usable power sheet', () => {
    const broken: string[] = [];
    for (const c of chogs) {
      const p = powersFor(c.attributes);
      if (
        p.basePoints <= 0 ||
        p.maxRarity === undefined ||
        p.dodgeChance <= 0 ||
        p.dodgeChance > 0.35 ||
        p.accuracy < 0
      ) {
        broken.push(`#${c.token_id}`);
      }
    }
    expect(broken).toEqual([]);
  });

  it('never throws on any real trait value', () => {
    for (const c of chogs) {
      expect(() => powersFor(c.attributes)).not.toThrow();
    }
  });

  it('gives every Chog at least one usable prank', () => {
    // maxRarity must always be set, and a Common Chog still gets common pranks,
    // so nobody is locked out of the game.
    for (const c of chogs) {
      expect(powersFor(c.attributes).maxRarity).toMatch(/common|rare|legendary/);
    }
  });

  it('keeps dodge inside the 5%..35% band for every Chog', () => {
    for (const c of chogs) {
      const { dodgeChance } = powersFor(c.attributes);
      expect(dodgeChance).toBeGreaterThanOrEqual(0.05);
      expect(dodgeChance).toBeLessThanOrEqual(0.35);
    }
  });

  it('reports the resulting balance distribution', () => {
    const tiers: Record<string, number> = {};
    let withSignature = 0;
    let withAccessory = 0;
    let withLegendary = 0;
    let withTaunt = 0;

    for (const c of chogs) {
      const p = powersFor(c.attributes);
      tiers[c.attributes.Tier ?? 'none'] = (tiers[c.attributes.Tier ?? 'none'] ?? 0) + 1;
      if (p.signaturePrankId) withSignature++;
      if (p.accessoryPrankId) withAccessory++;
      if (p.hasLegendary) withLegendary++;
      if (p.canTaunt) withTaunt++;
    }

    const n = chogs.length;
    const pct = (x: number) => `${((100 * x) / n).toFixed(1)}%`;
    // eslint-disable-next-line no-console
    console.log('\n  --- balance over the real 1,969 Chogs ---');
    for (const [t, k] of Object.entries(tiers).sort((a, b) => b[1] - a[1])) {
      // eslint-disable-next-line no-console
      console.log(`  tier ${t.padEnd(10)} ${String(k).padStart(4)}  ${pct(k)}`);
    }
    // eslint-disable-next-line no-console
    console.log(`  signature prank (Head)  ${String(withSignature).padStart(4)}  ${pct(withSignature)}`);
    // eslint-disable-next-line no-console
    console.log(`  signature prank (Acc)   ${String(withAccessory).padStart(4)}  ${pct(withAccessory)}`);
    // eslint-disable-next-line no-console
    console.log(`  taunt (Mouth)           ${String(withTaunt).padStart(4)}  ${pct(withTaunt)}`);
    // eslint-disable-next-line no-console
    console.log(`  weekly legendary        ${String(withLegendary).padStart(4)}  ${pct(withLegendary)}`);

    // Sanity on the shape of the distribution, not on exact counts.
    expect(withSignature).toBeGreaterThan(n * 0.05); // some Chogs get one
    expect(withSignature).toBeLessThan(n * 0.95); // but not all, or it is not rare
    expect(withLegendary).toBeGreaterThan(0);
    expect(withLegendary).toBeLessThan(n * 0.25); // genuinely rare
  });
});