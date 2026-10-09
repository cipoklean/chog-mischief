/**
 * The prank catalogue.
 *
 * Every id referenced by powers.ts MUST exist here, or a Chog with a Crown
 * silently has no signature prank. `pranks.test.ts` enforces that by parsing
 * powers.ts rather than trusting a hand-kept list to stay in sync.
 *
 * PURE DATA. No randomness, no clock, no chain. Picking a prank from a Chog's
 * roll is a function of (roll, powers) only, so a prank can be replayed and
 * verified - which is what makes a leaderboard worth trusting.
 *
 * SVG is stored as a short overlay key, not a raw <svg> string: the UI renders
 * it, and keeping markup out of game logic means the catalogue can be unit
 * tested without a DOM and shipped without an HTML-injection surface.
 */

import type { PrankRarity } from './powers';

export type PrankKind = 'taunt' | 'silly' | 'cursed' | 'cosmic';

export interface Prank {
  id: string;
  name: string;
  rarity: PrankRarity;
  kind: PrankKind;
  /** One line. Shown on the victim's card; this is the joke. */
  caption: string;
  /** Overlay renderer key - see src/components/PrankOverlay.tsx. */
  overlay: string;
  /** Base chaos points before the streak multiplier in rules.ts. */
  points: number;
}

export const PRANKS: readonly Prank[] = [
  // ---------------------------------------------------------------- common
  { id: 'bonk', name: 'Bonk', rarity: 'common', kind: 'silly',
    caption: 'Bonked. No notes.', overlay: 'bonk', points: 10 },
  { id: 'no-money-no-bounce', name: 'No Money, No Bounce', rarity: 'common', kind: 'silly',
    caption: 'Bounced off your balance.', overlay: 'coin-bounce', points: 10 },
  { id: 'gas-fee-theft', name: 'Gas Fee Theft', rarity: 'common', kind: 'silly',
    caption: 'Ransomed your remaining MON for a bean.', overlay: 'gas-theft', points: 12 },
  { id: 'airplane-mode', name: 'Airplane Mode', rarity: 'common', kind: 'silly',
    caption: 'Turned your notifications off. Forever.', overlay: 'airplane', points: 11 },
  { id: 'wet-bread', name: 'Wet Bread', rarity: 'common', kind: 'silly',
    caption: 'Left wet bread on your counter. No explanation.', overlay: 'bread', points: 10 },
  { id: 'shouldve-read-the-tos', name: "Should've Read The ToS",
    rarity: 'common', kind: 'taunt',
    caption: 'Nobody reads the ToS. That is the whole scam.', overlay: 'scroll-tos', points: 13 },
  { id: 'touch-grass', name: 'Touch Grass', rarity: 'common', kind: 'taunt',
    caption: 'Go outside. The chain will still be broken when you get back.',
    overlay: 'grass', points: 12 },
  { id: 'gm', name: 'GM', rarity: 'common', kind: 'taunt',
    caption: 'GM. Said it. Still no help.', overlay: 'gm', points: 10 },

  // ------------------------------------------------------------------ rare
  { id: 'wizard-of-chog', name: 'Wizard Of Chog', rarity: 'rare', kind: 'cosmic',
    caption: 'Turned your Chog into a toad. Reversible? Ask a wizard.',
    overlay: 'wizard', points: 22 },
  { id: 'crown-of-the-chog', name: 'Crown Of The Chog', rarity: 'rare', kind: 'cosmic',
    caption: 'Stole your crown. It looks better on me.',
    overlay: 'crown', points: 24 },
  { id: 'spartan-shield', name: 'Spartan Shield', rarity: 'rare', kind: 'silly',
    caption: '300. That is the whole joke.', overlay: 'spartan', points: 21 },
  { id: 'bucket-over-head', name: 'Bucket Over Head', rarity: 'rare', kind: 'silly',
    caption: 'You cannot solve gas fees blind. Nobody can.',
    overlay: 'bucket', points: 20 },
  { id: 'raincloud-drench', name: 'Raincloud Drench', rarity: 'rare', kind: 'silly',
    caption: 'It is not raining. It is raining AT you.',
    overlay: 'raincloud', points: 20 },
  { id: 'btc-brain', name: 'BTC Brain', rarity: 'rare', kind: 'cursed',
    caption: 'Replaced one brain cell with a chart.', overlay: 'btc-brain', points: 23 },
  { id: 'money-printer', name: 'Money Printer', rarity: 'rare', kind: 'cursed',
    caption: 'Printed fake dollars. They are worthless. You still want them.',
    overlay: 'printer', points: 25 },
  { id: 'buttcoin-blast', name: 'Buttcoin Blast', rarity: 'rare', kind: 'cursed',
    caption: 'Deployed your entire treasury to the wrong chain.',
    overlay: 'buttcoin', points: 26 },
  { id: 'durag-drip', name: 'Durag Drip', rarity: 'rare', kind: 'silly',
    caption: 'Compressed your headspace to 4KB.', overlay: 'durag', points: 19 },
  { id: 'horniness-field', name: 'Horniness Field', rarity: 'rare', kind: 'cursed',
    caption: 'Aura now emits a frequency. You feel it in your wallet.',
    overlay: 'horniness', points: 27 },
  { id: 'ushanka-slam', name: 'Ushanka Slam', rarity: 'rare', kind: 'silly',
    caption: 'Introduced your Chog to the Cold War.', overlay: 'ushanka', points: 20 },
  { id: 'monopoly-monopoly', name: 'Monopoly Money', rarity: 'rare', kind: 'cursed',
    caption: 'Your balance is now denominated in Monopoly money.',
    overlay: 'monopoly', points: 24 },
  { id: 'boob-cap-bounce', name: 'Boob Cap Bounce', rarity: 'rare', kind: 'silly',
    caption: 'Bounced off the ceiling. Twice.', overlay: 'boob-bounce', points: 18 },

  // -------------------------------------------------------------- legendary
  // MEASURED distribution over 1,969 Chogs: Legendary tier traits are 10 tokens
  // (0.5%), and the weekly legendary unlock fires on ~2% via counted rare traits.
  // So the LEGENDARY catalogue is deliberately ONE prank. Everything unlocked by
  // simply wearing a trait sits in `rare` - a Crown holder getting a good prank is
  // a discovery, not a once-a-week event. The first draft had nine legendaries,
  // which hands top-tier content to far too many wallets.
  { id: 'chog-god-mode', name: 'Chog God Mode', rarity: 'legendary', kind: 'cosmic',
    caption: 'Your Chog briefly achieved enlightenment, then spent it on you.',
    overlay: 'god-mode', points: 60 },
  { id: 'fwogged', name: 'Fwogged', rarity: 'rare', kind: 'cosmic',
    caption: 'The Fwog has entered your token. He does not leave.',
    overlay: 'fwog', points: 55 },
  { id: 'pepe-rain', name: 'Pepe Rain', rarity: 'rare', kind: 'cosmic',
    caption: 'It is raining Pepe. Nobody knows why. Nobody is asking.',
    overlay: 'pepe', points: 58 },
  { id: 'sb-splash', name: 'SB Splash', rarity: 'rare', kind: 'cosmic',
    caption: 'SPLASH. Your DEX route was suboptimal all along.',
    overlay: 'splash', points: 52 },
  { id: 'cigar-smoke', name: 'Cigar Smoke', rarity: 'rare', kind: 'cosmic',
    caption: 'The smoke settles. Your conviction does not.',
    overlay: 'cigar', points: 50 },
  { id: 'heart-eye', name: 'Heart Eye', rarity: 'rare', kind: 'cosmic',
    caption: 'Your Chog is in love. With you. Specifically.',
    overlay: 'heart', points: 54 },
  { id: 'airport-security', name: 'Airport Security', rarity: 'rare', kind: 'silly',
    caption: 'Your token is now a controlled item. It will be screened forever.',
    overlay: 'tsa', points: 48 },
  { id: 'candle-wax', name: 'Candle Wax', rarity: 'rare', kind: 'cursed',
    caption: 'Sealed your position in wax. It is still liquid. That is the problem.',
    overlay: 'candle', points: 56 },
  { id: 'coin-toss', name: 'Coin Toss', rarity: 'rare', kind: 'cursed',
    caption: 'Heads: you win. Tails: you lose. It is always tails.',
    overlay: 'coin', points: 49 },
] as const;

const BY_ID = new Map(PRANKS.map((p) => [p.id, p]));

export function getPrank(id: string | null | undefined): Prank | null {
  if (!id) return null;
  return BY_ID.get(id) ?? null;
}

export function pranksByRarity(rarity: PrankRarity): Prank[] {
  return PRANKS.filter((p) => p.rarity === rarity);
}

/**
 * Which pranks a Chog may actually pull, given its power sheet.
 *
 * The tier cap governs the BULK pool - what you get by rolling. A signature
 * prank granted by a trait is NOT subject to it, because otherwise the trait
 * system is decorative for most of the collection.
 *
 * MEASURED (1,969 Chogs, via pranks.coverage.test.ts): 682 Chogs are granted a
 * signature prank, and 551 of those are Common-tier. A Common Chog can only
 * roll common pranks, so capping the grant too meant 81% of all signature
 * unlocks - 28% of the entire collection - resolved to a prank their owner could
 * never use. The first version of this function did exactly that, and the unit
 * tests were green because they only checked single hand-picked inputs.
 *
 * So: tier caps the roll, a trait grants the signature. The LEGENDARY weekly
 * unlock is the one exception that stays capped, because it is explicitly a
 * once-a-week event in the brief, not a trait-granted signature.
 */
export function pranksForPowers(
  powers: { maxRarity: PrankRarity; canTaunt: boolean },
  signaturePrankId?: string | null,
  accessoryPrankId?: string | null,
  legendaryPrankId?: string | null,
): Prank[] {
  const order: Record<PrankRarity, number> = { common: 0, rare: 1, legendary: 2 };
  const cap = order[powers.maxRarity];
  const roll = PRANKS.filter((p) => order[p.rarity] <= cap);

  // No taunt trait means no taunt pranks - that is the whole point of the Mouth
  // gate, so it filters the pool rather than merely unlocking it.
  const pool = powers.canTaunt ? roll : roll.filter((p) => p.kind !== 'taunt');

  const out = [...pool];
  for (const id of [signaturePrankId, accessoryPrankId]) {
    const prank = getPrank(id);
    if (prank && !out.includes(prank)) out.push(prank);
  }

  // The weekly legendary keeps the cap: it is a once-a-week privilege, not a
  // permanent trait signature.
  const weekly = getPrank(legendaryPrankId);
  if (weekly && order[weekly.rarity] <= cap && !out.includes(weekly)) out.push(weekly);

  return out;
}

/**
 * Deterministic pick: same roll and same powers must always give the same prank.
 *
 * Takes the roll from the caller rather than generating one, so a prank can be
 * re-derived from a stored roll during a dispute or a test.
 */
export function pickPrank(
  pool: readonly Prank[],
  roll: number,
): Prank | null {
  if (pool.length === 0) return null;
  const index = Math.min(pool.length - 1, Math.max(0, Math.floor(roll * pool.length)));
  return pool[index] ?? pool[0] ?? null;
}

/** Total points available at each rarity, for balance review. */
export function pointsBudgetByRarity(): Record<PrankRarity, number> {
  const out: Record<PrankRarity, number> = { common: 0, rare: 0, legendary: 0 };
  for (const p of PRANKS) out[p.rarity] += p.points;
  return out;
}