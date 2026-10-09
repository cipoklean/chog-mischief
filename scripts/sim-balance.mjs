#!/usr/bin/env node
/**
 * BALANCE SIMULATION over the real 1,969 Chogs.
 *
 * Every number the game produces comes out of `powers.ts` and `rules.ts`, both
 * pure functions. That makes the balance question answerable without running a
 * single prank: take the real harvested traits, roll a lot of pranks through the
 * real rule functions, and print what actually happens.
 *
 * THIS IS NOT A GAMEPLAY SIMULATION. It does not model who pranks whom, and it
 * is not a prediction of a live season. It answers three narrow questions:
 *
 *   1. HIT RATE - what fraction of pranks land across the whole collection?
 *      A hit rate near 100% makes dodge meaningless; near 0% makes the game
 *      feel broken. This is the number that says whether the cap and the floor
 *      are in the right place.
 *   2. AVERAGE POINTS BY TIER - does rarity still pay, and by how much?
 *      Flattening the base points was meant to remove a 6x gap while leaving
 *      rarity meaningful through pranks and target bonuses.
 *   3. TOP-10 TIER MIX - who actually ends up on the leaderboard. A board that
 *      is all Legendary means rarity is the whole game; one that is all Common
 *      means the tiers are cosmetic.
 *
 * The roll is drawn from a real HMAC of (from, to, day) - the same function
 * production uses - so the distribution is the one players will meet, not a
 * Math.random that could flatter or ruin the numbers.
 *
 *   node --import ./scripts/ts-resolve.mjs scripts/sim-balance.mjs
 */

import { readFileSync, existsSync } from 'node:fs';
import { createHmac } from 'node:crypto';

const SECRET = process.env.SESSION_SECRET ?? 'balance-sim-not-a-real-secret';

/** How many prank attempts to run. Enough to be stable, small enough to be fast. */
const TRIALS = 20_000;

function loadTraits() {
  // Live cache when present, committed snapshot otherwise: the simulation must
  // run on a fresh clone, not only on the machine that harvested the chain.
  for (const path of ['data/cache/chogs.json', 'data/snapshot/chogs.json']) {
    if (!existsSync(path)) continue;
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    // Both files key Chogs BY TOKEN ID ("1": {...}), so an Array check finds
    // nothing and the script exits as if no data existed. Normalise here once.
    const rows = Array.isArray(parsed)
      ? parsed
      : Object.values(parsed).flatMap((entry) => (Array.isArray(entry) ? entry : [entry]));
    if (rows.length > 0) {
      console.log(`reading ${rows.length} Chogs from ${path}`);
      return rows;
    }
  }
  console.error(
    'No Chog data found. Run `npm run snapshot:chogs` (needs the public Monad RPC).',
  );
  process.exit(1);
}

/** The production roll: HMAC(secret, from|to|day) mapped to [0,1). */
function roll(from, to, day) {
  const hex = createHmac('sha256', SECRET).update(`${from}|${to}|${day}`).digest('hex').slice(0, 16);
  return Number(BigInt(`0x${hex}`)) / 2 ** 64;
}

const chogs = loadTraits();
const { powersFor, resolvePrank, effectiveDodge, streakMultiplier, tierRank } = await import(
  '../src/game/powers.ts'
);
const { pointsFor, targetBonus } = await import('../src/game/rules.ts');

const DAY = '2026-10-09';

const powers = chogs.map((c) => powersFor(c.attributes ?? c.traits ?? {}));
const tiers = chogs.map((c) => (c.attributes ?? c.traits ?? {}).Tier ?? 'Common');

// ---------------------------------------------------------------------------
// 1. HIT RATE
// ---------------------------------------------------------------------------

let landed = 0;
let attempts = 0;
const dodgeHistogram = new Map();

for (let i = 0; i < TRIALS; i += 1) {
  const a = i % powers.length;
  const b = (i * 7919 + 13) % powers.length;
  if (a === b) continue; // a Chog cannot prank itself
  attempts += 1;

  const r = roll(a, b, DAY);
  const out = resolvePrank(powers[a], powers[b], r);
  if (out.landed) landed += 1;

  const bucket = (Math.floor(out.dodgeChance * 20) / 20).toFixed(2);
  dodgeHistogram.set(bucket, (dodgeHistogram.get(bucket) ?? 0) + 1);
}

const hitRate = landed / attempts;

// ---------------------------------------------------------------------------
// 2. AVERAGE POINTS BY TIER
//
// Points depend on streak and revenge, so both are varied deliberately: a
// player on a cold streak, one on a 5-day streak, and one getting revenge. The
// average is across those, plus a target bonus sampled from real pairs.
// ---------------------------------------------------------------------------

const STREAKS = [1, 1, 1, 3, 5, 9];
const pointsByTier = new Map();

for (const tier of ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary']) {
  const index = powers.findIndex((_, i) => normalise(tiers[i]) === normalise(tier));
  if (index === -1) continue;

  const samples = [];
  for (let i = 0; i < 400; i += 1) {
    const target = (i * 131 + 7) % powers.length;
    if (target === index) continue;
    const streak = STREAKS[i % STREAKS.length];
    const revenge = i % 3 === 0;
    const bonus = targetBonus({
      targetTierRank: tierRank(tiers[target]),
      attackerTierRank: tierRank(tiers[index]),
      targetCurrentStreak: (i * 7) % 8,
    });
    samples.push(
      pointsFor(powers[index].basePoints, streak, revenge, {
        targetTierRank: tierRank(tiers[target]),
        attackerTierRank: tierRank(tiers[index]),
        targetCurrentStreak: (i * 7) % 8,
      }),
    );
    void bonus;
  }
  pointsByTier.set(tier, {
    base: powers[index].basePoints,
    average: samples.reduce((s, v) => s + v, 0) / samples.length,
    min: Math.min(...samples),
    max: Math.max(...samples),
  });
}

// ---------------------------------------------------------------------------
// 3. TOP-10 TIER MIX
//
// The leaderboard is "most points from landed pranks this week". So simulate
// exactly that: everyone pranks a random other Chog every day for a week, and
// rank by total points.
// ---------------------------------------------------------------------------

const SEASON_DAYS = 7;
const totals = new Array(powers.length).fill(0);

for (let d = 0; d < SEASON_DAYS; d += 1) {
  const day = `2026-10-${String(9 + d).padStart(2, '0')}`;
  for (let a = 0; a < powers.length; a += 1) {
    const b = (a * 7919 + d * 104729 + 13) % powers.length;
    if (a === b) continue;
    if (!resolvePrank(powers[a], powers[b], roll(a, b, day)).landed) continue;

    const streak = d + 1;
    totals[a] += pointsFor(powers[a].basePoints, streak, false, {
      targetTierRank: tierRank(tiers[b]),
      attackerTierRank: tierRank(tiers[a]),
      targetCurrentStreak: 0,
    });
  }
}

const ranked = totals
  .map((points, i) => ({ i, points }))
  .sort((x, y) => y.points - x.points);
const top10 = ranked.slice(0, 10);

// ---------------------------------------------------------------------------

function normalise(v) {
  return String(v ?? '').trim().toLowerCase();
}

function pad(s, n) {
  return String(s).padEnd(n);
}
function padL(s, n) {
  return String(s).padStart(n);
}

console.log('');
console.log('='.repeat(66));
console.log('BALANCE SIMULATION - ' + chogs.length + ' real Chogs, ' + attempts.toLocaleString() + ' prank attempts');
console.log('='.repeat(66));

console.log('');
console.log('HIT RATE');
console.log('  overall                 ' + (hitRate * 100).toFixed(1) + '% landed');
const dodgedRate = (1 - hitRate) * 100;
console.log('  dodged                  ' + dodgedRate.toFixed(1) + '%');
// Two DIFFERENT questions, previously conflated into one number:
//   - how many Chogs sit on the floor because they have no Aura at all (a
//     property of the collection: the Aura trait is simply absent)
//   - how many are pushed to the floor by a max-accuracy attacker (a property
//     of the strongest attacker in the game, not of the defender)
const onFloor = powers.filter((p) => p.dodgeChance <= 0.0501).length;
const atFloorVsBest = powers.filter(
  (p) => effectiveDodge(p.dodgeChance, 0.2) <= 0.0501,
).length;
console.log('  Chogs on the 5% floor (no Aura trait)         ' + onFloor +
            ' (' + ((onFloor / powers.length) * 100).toFixed(1) + '%)');
console.log('  ...and at the floor vs a MAX-accuracy attacker ' + atFloorVsBest +
            ' (' + ((atFloorVsBest / powers.length) * 100).toFixed(1) + '%)');

console.log('');
console.log('  effective dodge distribution (attacker accuracy 0):');
const dodgeValues = powers.map((p) => effectiveDodge(p.dodgeChance, 0)).sort((a, b) => a - b);
const pct = (p) => dodgeValues[Math.min(dodgeValues.length - 1, Math.floor(dodgeValues.length * p))];
console.log('    min ' + (dodgeValues[0] * 100).toFixed(1) + '%   p25 ' + (pct(0.25) * 100).toFixed(1) +
            '%   median ' + (pct(0.5) * 100).toFixed(1) + '%   p75 ' + (pct(0.75) * 100).toFixed(1) +
            '%   max ' + (dodgeValues[dodgeValues.length - 1] * 100).toFixed(1) + '%');

console.log('');
console.log('POINTS BY TIER (across streaks 1/1/1/3/5/9, some with revenge and a target bonus)');
console.log('  ' + pad('tier', 12) + padL('base', 6) + padL('avg', 8) + padL('min', 6) + padL('max', 6));
for (const [tier, s] of pointsByTier) {
  console.log('  ' + pad(tier, 12) + padL(s.base, 6) + padL(s.average.toFixed(1), 8) +
              padL(s.min, 6) + padL(s.max, 6));
}

const tierAvgs = [...pointsByTier.entries()].map(([t, s]) => ({ t, avg: s.average }));
if (tierAvgs.length > 1) {
  const common = tierAvgs.find((x) => x.t === 'Common')?.avg ?? 1;
  const legend = tierAvgs.find((x) => x.t === 'Legendary')?.avg ?? 1;
  console.log('  Legendary / Common average ratio   ' + (legend / common).toFixed(2) + 'x');
}

console.log('');
console.log('TOP 10 AFTER ' + SEASON_DAYS + ' DAYS (everyone pranks once a day)');
console.log('  ' + pad('#', 4) + pad('tier', 12) + padL('points', 8) + '  token');
const mix = new Map();
for (let n = 0; n < top10.length; n += 1) {
  const { i, points } = top10[n];
  const tier = tiers[i] ?? 'Common';
  mix.set(tier, (mix.get(tier) ?? 0) + 1);
  console.log('  ' + padL(n + 1, 4) + pad(tier, 12) + padL(points, 8) + '  #' + (i + 1));
}
console.log('');
console.log('  tier mix: ' + [...mix.entries()].map(([t, n]) => `${t} ${n}`).join(', '));

const overall = new Map();
for (let i = 0; i < tiers.length; i += 1) {
  const t = tiers[i] ?? 'Common';
  overall.set(t, (overall.get(t) ?? 0) + 1);
}
console.log('  collection mix: ' + [...overall.entries()]
  .sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t} ${n}`).join(', '));

console.log('');
console.log('STREAK MULTIPLIER');
console.log('  ' + [1, 2, 3, 5, 9, 12].map((s) => `${s}d=${streakMultiplier(s).toFixed(2)}x`).join('  '));
console.log('');
