/**
 * Chog Mischief - trait -> power mapping.
 *
 * DESIGN RULE (from SPEC "balance it so no Chog is useless"):
 * every power trait is ADDITIVE WITH A DEFAULT. A Chog with no Aura still
 * dodges at the floor; a Chog with no Accessory still gets the common pranks.
 * No power trait is ever a requirement, because the real collection has
 * optional slots (measured: 49.5% of tokens have an Aura, only 9.9% have an
 * Accessory).
 *
 * The numbers below come from the measured distribution in
 * `data/cache/trait-report.md` (1,969 tokens). They are deliberately rounded
 * and hand-tuned for FUN, not derived from a formula: a player should be able
 * to read the table and predict the outcome.
 *
 * Pure module: no I/O, no randomness except an injected roll. Everything the
 * game rules need is derivable from a token's traits alone.
 */

export type PrankRarity = 'common' | 'rare' | 'legendary';

export interface ChogTraits {
  Tier?: string;
  Aura?: string;
  Eyes?: string;
  Mouth?: string;
  Head?: string;
  Accessory?: string;
  [category: string]: string | undefined;
}

export interface ChogPowers {
  /** Highest prank rarity this Chog can pull. */
  maxRarity: PrankRarity;
  /** Base chaos points for a landed prank, before streak multiplier. */
  basePoints: number;
  /** 0..1 chance the target's prank is dodged, BEFORE attacker accuracy. */
  dodgeChance: number;
  /** 0..1 how much this Chog lowers the target's dodge chance. */
  accuracy: number;
  /** True when the Mouth trait unlocks taunt pranks. */
  canTaunt: boolean;
  /** Signature prank unlocked by Head, if this Chog has one. */
  signaturePrankId: string | null;
  /** Signature prank unlocked by Accessory, if this Chog has one. */
  accessoryPrankId: string | null;
  /** Once-per-week legendary granted by holding a rare trait value. */
  legendaryPrankId: string | null;
  /** True when any trait qualifies for the weekly legendary. */
  hasLegendary: boolean;
}

// ---------------------------------------------------------------------------
// TIER -> power level + base points
// Measured: Common 1279, Uncommon 590, Rare 60, Epic 30, Legendary 10.
//
// Flattened from 10/18/26/40/60. The old spread was a 6x gap between Common
// and Legendary, and it compounded with the streak multiplier (up to 3x) and
// the revenge multiplier (2x) - so the same three rules produced a 36x swing
// in points for two players who did exactly the same thing. A Legendary's
// advantage is supposed to be its extra pranks and its legendary unlock, not
// a points multiplier on top of both. The rarity reward lives in
// maxRarity (what you may pull) and in prank rarity, which the base points do
// not have to double.
// ---------------------------------------------------------------------------
// Flattened twice now, from 10/18/26/40/60 to 10/12/15/18/22 and then to
// 10/11/12/13/14. The second pass was driven by the balance simulation: at
// 10/12/15/18/22 a 7-day top 10 was 5 Legendary and 5 Epic, because with
// everyone pranking once a day the leaderboard simply ranks by tier and a
// Common cannot climb out of the bottom 1,929 places.
//
// Tier now means a bigger prank pool, via maxRarity, rather than more points.
// Points are near-flat, so the leaderboard measures who actually played well
// instead of who happens to hold a scarce token.
const TIER_TABLE: Record<string, { maxRarity: PrankRarity; basePoints: number }> = {
  Common: { maxRarity: 'common', basePoints: 10 },
  Uncommon: { maxRarity: 'rare', basePoints: 11 },
  Rare: { maxRarity: 'rare', basePoints: 12 },
  Epic: { maxRarity: 'legendary', basePoints: 13 },
  Legendary: { maxRarity: 'legendary', basePoints: 14 },
};

const TIER_FALLBACK = TIER_TABLE.Common;

/**
 * Ordinal rank of a tier, for the target bonus. Ordered by the collection's
 * own rarity, so "higher tier" means the same thing in the bonus as it does on
 * a Chog page. Missing or unknown tiers rank 0 (Common), which is also the
 * fallback tier, so an unrecognised value can never outrank a real one.
 */
export const TIER_ORDER: readonly string[] = [
  'Common',
  'Uncommon',
  'Rare',
  'Epic',
  'Legendary',
];

export function tierRank(tier: string | undefined | null): number {
  const key = normaliseTrait(tier);
  if (!key) return 0;
  for (let i = 0; i < TIER_ORDER.length; i += 1) {
    if (normaliseTrait(TIER_ORDER[i]) === key) return i;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// AURA -> a dodge BONUS, added to BASE_DODGE.
// Measured auras are mostly flavour words, so the table is thematic rather
// than ordinal: "fiery" auras dodge well, "clean" ones badly.
// The total chance is BASE_DODGE + this value, clamped to [DODGE_FLOOR,
// DODGE_CAP] after attacker accuracy is subtracted.
// ---------------------------------------------------------------------------
const AURA_DODGE: Record<string, number> = {
  // These are BONUSES on top of BASE_DODGE, not the dodge chance itself. The
  // table used to hold whole dodge values in 0.05..0.35, which only worked
  // while a Chog with no Aura sat at 0. Adding BASE_DODGE would have pushed the
  // top of the table past DODGE_CAP and silently clipped every good Aura, so
  // the values are rescaled to 0.04..0.30 and the total range is 0.19..0.45.
  Smoke: 0.30,           // hard to see coming
  'Pink Mist': 0.29,
  'Royal Blue Aura': 0.27,
  'Royal Aura': 0.27,
  'Burning Aura': 0.26,
  'Cool Aura': 0.25,
  Purple: 0.24,
  Violet: 0.23,
  'Light Purple': 0.22,
  Wind: 0.21,
  'Mint': 0.19,
  'Aqua Aura': 0.21,
  'Rose Aura': 0.20,
  'Fiery Aura': 0.18,
  Fire: 0.17,
  'Yellow Aura': 0.15,
  'Green Aura': 0.15,
  'Rose Scent': 0.16,      // 5 tokens - faint, weak
  'Royal Blue': 0.27,      // 3 tokens - distinct from "Royal Blue Aura"
  'Electric Shock': 0.28,  // 2 tokens - rare, evasive
  'White Aura': 0.26,      // 1 token - the rarest aura in the collection
  Clean: 0.04,             // a clean aura is barely an aura at all
};


/**
 * Dodge every Chog has before its Aura is counted.
 *
 * 995 of the 1,969 Chogs Genesis carry NO Aura trait at all, so with a zero
 * baseline they sat exactly on DODGE_FLOOR and more than half the collection
 * had an identical 5% dodge. Two things followed from that, both bad:
 *
 *   - Eyes did nothing against them. Accuracy subtracts from dodge but is
 *     clamped so it can never take a target below DODGE_FLOOR, so against a
 *     floored target the attacker's eyes were worth literally zero. Half the
 *     collection made the whole Eyes trait decorative again.
 *   - Raising DODGE_CAP changed nothing, because the number that mattered was
 *     the floor, not the cap. The highest dodge actually reached stayed 35%.
 *
 * A baseline puts the real range at roughly 0.20 to 0.45, so Aura is something
 * you have rather than something you may or may not have, and accuracy is worth
 * something against everyone. The floor still holds after accuracy, so no Chog
 * becomes undodgeable.
 *
 * 0.20 rather than 0.15: at 0.15 the simulated hit rate was 83.5%, which is
 * still a game where dodging is the exception. 0.20 brings it to roughly 76%,
 * so three pranks in four land and a miss means something.
 */
export const BASE_DODGE = 0.20;

/**
 * The absolute floor, applied AFTER attacker accuracy is subtracted.
 *
 * 0.05 rather than 0 so a target always keeps a real, if small, chance. At 0 a
 * strong attacker could make a Chog literally undodgeable, which turns "this
 * Chog dodges" into a lie.
 */
export const DODGE_FLOOR = 0.05;
/**
 * 0.45, raised from 0.35.
 *
 * The cap silently rewrote the rarest Auras downward: the AURA_DODGE table
 * tops out at 0.33 ("Electric Shock", 2 tokens) and 0.31 ("Royal Blue", 3), so
 * a 0.35 cap meant the top of the table was never quite reachable and the
 * spread between a no-Aura Chog and the collection's best dodger was narrower
 * than the data says. At 0.45 every measured Aura value survives the clamp, so
 * what a holder was sold is what they get.
 */
export const DODGE_CAP = 0.45;

// ---------------------------------------------------------------------------
// EYES -> accuracy (lowers the target's dodge chance).
// Measured: 58 values, from "Happy" (121) down to singletons.
// ---------------------------------------------------------------------------
const EYES_ACCURACY: Record<string, number> = {
  // aiming eyes
  'Green laser': 0.18, 'Green Side Eye': 0.18, 'purple laser': 0.17,
  'fire laser': 0.17, 'cyan laser': 0.16, 'Plasma visor': 0.16,
  'Gradient visor': 0.15, 'Side Eye': 0.14, 'BTC Glass': 0.13,
  '3D Glass': 0.13, 'Anime Glass': 0.12, 'Classic VR': 0.12,
  'Modern VR': 0.11, 'Chog Viper': 0.12, Thug: 0.10,
  Smirk: 0.10, XD: 0.09, 'Sunset visor': 0.14, 'Retro Glass': 0.12,
  'Blue Smirk': 0.10, 'Green Smirk': 0.10, 'Mixed Side Eye': 0.13,
  MOG: 0.08, Up: 0.04, Tired: 0.03, Vertical: 0.03, Heart: 0.05,
  Angry: 0.06, Normal: 0.05,
  // ordinary eyes
  'Normal Eye': 0.06, Round: 0.06, 'Round Eye': 0.05, Happy: 0.05,
  'Round Tear': 0.05, Teary: 0.05, Worried: 0.04, Dead: 0.04,
  'Round Crying': 0.03, 'Closed Eye Crying': 0.03, Flat: 0.03,
  'Blue Flat': 0.03, 'Red Flat': 0.03, 'Blue Happy': 0.05,
  'Green Happy': 0.05, 'Mixed Happy': 0.05, 'Blue Round Eye': 0.05,
  'Green Round Eye': 0.05, 'Mixed Round Eye': 0.05,
  Base: 0.02, Frog: 0.02, 'Clown Eye': 0.02, 'Clown Eye Mix': 0.02,
};

/*
 * NOTE ON OFFENSIVE TRAIT VALUES
 *
 * Some on-chain trait values are slurs - "Retard" appears as an Eyes value on
 * 24 of the 1,969 Chogs. Three deliberate decisions:
 *
 *   1. They are NOT in EYES_ACCURACY above. No prank, no power and no
 *      leaderboard entry keys off a slur; an unmapped value falls through to 0
 *      accuracy, which is the same as having ordinary eyes.
 *   2. They are NOT rendered. displayTrait() in lib/traits.ts replaces them with
 *      "[hidden]" everywhere the UI shows a trait - the Chog page, the profile,
 *      and the share card metadata - because a player should not have to read
 *      one to see what their own NFT is.
 *   3. They are NOT in the rarity sets, so they cannot unlock a prank.
 *
 * The art itself is the NFT's own and is not ours to redact.
 */

export const ACCURACY_CAP = 0.20;

// ---------------------------------------------------------------------------
// MOUTH -> unlocks taunt pranks.
// Measured 15 values; the loudmouths get taunts.
// ---------------------------------------------------------------------------
const TAUNT_MOUTHS = new Set([
  'Rainbow Puke', 'Clown Mouth', 'Grit', 'wo', 'Drooling',
  'BTC Coin', 'Mon coin', 'Gold Tooth',
]);

// ---------------------------------------------------------------------------
// HEAD / ACCESSORY -> one signature prank each.
// Only the most iconic values get one; the long tail does not, which is what
// makes a signature prank feel like a discovery.
// ---------------------------------------------------------------------------
// Exported so the prank UI can explain WHY a prank is locked ("Needs trait:
// Crown") without re-deriving the mapping. The maps themselves are the
// single source of truth - a second copy would drift.
export const HEAD_SIGNATURE: Record<string, string> = {
  Crown: 'crown-of-the-chog',
  'Wizard Hat': 'wizard-of-chog',
  'Spartan Helmet': 'spartan-shield',
  'Boob Cap': 'boob-cap-bounce',
  'BOOB Cap': 'boob-cap-bounce',
  'Blue Bucket Cap': 'bucket-over-head',
  'Gray Bucket Cap': 'bucket-over-head',
  'Cloud Cap': 'raincloud-drench',
  'BTC Cap': 'btc-brain',
  'Dollar Cap': 'money-printer',
  'Buttcoin Cap': 'buttcoin-blast',
  'Horny Cap': 'horniness-field',
  'Durag': 'durag-drip',
  'Russian Hat': 'ushanka-slam',
  'Mon Cap': 'monopoly-monopoly',
};

export const ACCESSORY_SIGNATURE: Record<string, string> = {
  Cigar: 'cigar-smoke',
  Knife: 'airport-security',
  'Green Candle': 'candle-wax',
  'Red Candle': 'candle-wax',
  Coin: 'coin-toss',
  Fwog: 'fwogged',
  SB: 'sb-splash',
  PEPE: 'pepe-rain',
  Heart: 'heart-eye',
};

// ---------------------------------------------------------------------------
// RARE TRAIT VALUES -> once-per-week legendary prank.
//
// MEASURED counts (1,969 tokens), NOT guesses. The first version of this list
// included values like `Base` eyes (33 tokens) and `Frog` (29) and shipped a
// "rare" legendary to 30% of the collection - a coverage test caught it.
// Only values at or under ~0.20% (~4 tokens) qualify now, which lands the
// legendary on roughly 2% of Chogs. Every entry below is a COUNTED rarity.
// ---------------------------------------------------------------------------
const RARE_EYES = new Set([
  'Mixed Side Eye',    // 2
  'Mixed Happy',       // 2
  'Blue Happy',        // 1
  'Blue Smirk',        // 1
  'Green Smirk',       // 1
  'Green Side Eye',    // 3
  'Red Round Eye',     // 4
]);
const RARE_AURA = new Set([
  'White Aura',        // 1 - the single rarest aura in the collection
  'Electric Shock',    // 2
  'Pink Mist',         // 3
  'Royal Blue',        // 3
]);
const RARE_HEAD = new Set([
  'Blue Laser',        // 1
  'Poison Shroom',     // 1
  'Devil Horn',        // 1
  'Peace Cap',         // 1
  'Mafia Hat',         // 1
  'Head Wrap',         // 1
  '8 Ball Beanie',     // 1
  'Diamond',           // 2
  'Red Bandana',       // 2
  'Taped Banana',      // 2
  'Silver Thorn',      // 2
  'Void Horn',         // 2
  'ETH Cap',           // 2
  'Purple Horn',       // 2
  'Demon Horn',        // 3
  'Holy Seal',         // 3
  'Gold Thorn',        // 3
  '3rd Eye',           // 4
  'Silver wreath',     // 4
  'Red Horn',          // 5
]);

export const LEGENDARY_PRANK_ID = 'chog-god-mode';

/**
 * Normalise a trait value for table lookup.
 *
 * MEASURED, not hypothetical: the collection ships real case duplicates of the
 * same trait (`JEET Cap` AND `Jeet Cap`, `purple laser` AND `Purple laser`).
 * A case-sensitive table silently drops half of one trait's players, which
 * looks exactly like "this Chog has no signature prank". Lowercase + collapse
 * whitespace so one table entry serves every spelling of a value.
 */
export function normaliseTrait(value: string | undefined | null): string {
  return (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Normalised lookup tables, built ONCE at module load.
 *
 * `lookup` used to walk `Object.entries(table)` and re-normalise every key on
 * every call, so resolving one Chog's powers meant normalising all 58 Eyes
 * values, then all 22 Aura values, then all 16 Head values and so on. The
 * target grid resolves powers for every visible tile, and the balance sim does
 * it 1,969 times per roll, so this was the hot path of the whole rules layer
 * and it was quadratic in table size for no reason.
 *
 * The tables never change after load, so the map is built once and every lookup
 * after that is a single hash hit. `WeakMap` keyed on the table object means a
 * table added later is normalised on its first use rather than needing a
 * registry edit here - the cache is derived state, not a second source of
 * truth, so it cannot drift from the table it was built from.
 */
const NORMALISED = new WeakMap<object, Map<string, unknown>>();

function normalisedTable<T>(table: Record<string, T>): Map<string, T> {
  let built = NORMALISED.get(table) as Map<string, T> | undefined;
  if (built) return built;

  built = new Map<string, T>();
  for (const [key, value] of Object.entries(table)) {
    // First writer wins on a collision, matching the old loop: it returned the
    // FIRST key whose normalised form matched, not the last.
    const normalised = normaliseTrait(key);
    if (!built.has(normalised)) built.set(normalised, value);
  }
  NORMALISED.set(table, built as Map<string, unknown>);
  return built;
}

/** Case-insensitive lookup over a table keyed by display-cased trait values. */
function lookup<T>(table: Record<string, T>, value: string | undefined | null): T | undefined {
  const key = normaliseTrait(value);
  if (!key) return undefined;
  return normalisedTable(table).get(key);
}

/** Pre-normalised membership test, same table-once discipline as `lookup`. */
const NORMALISED_SETS = new WeakMap<object, Set<string>>();

function normalisedSet(set: Set<string>): Set<string> {
  let built = NORMALISED_SETS.get(set);
  if (built) return built;

  built = new Set<string>();
  for (const key of set) built.add(normaliseTrait(key));
  NORMALISED_SETS.set(set, built);
  return built;
}

function lookupSet(set: Set<string>, value: string | undefined | null): boolean {
  const key = normaliseTrait(value);
  if (!key) return false;
  return normalisedSet(set).has(key);
}

/**
 * Derive every power for one Chog from its traits. Pure and total: a Chog with
 * no traits at all still returns a playable power sheet.
 */
export function powersFor(traits: ChogTraits): ChogPowers {
  const tier = lookup(TIER_TABLE, traits.Tier) ?? TIER_FALLBACK;

  const auraRaw = lookup(AURA_DODGE, traits.Aura);
  // Every Chog gets BASE_DODGE; a real Aura adds on top. An absent Aura is the
  // common case (995 of 1,969), not an error case, so it must not collapse to
  // the floor.
  const dodgeChance = clamp(
    BASE_DODGE + (auraRaw === undefined ? 0 : auraRaw),
    DODGE_FLOOR,
    DODGE_CAP,
  );

  const eyeRaw = lookup(EYES_ACCURACY, traits.Eyes);
  const accuracy = clamp(eyeRaw === undefined ? 0 : eyeRaw, 0, ACCURACY_CAP);

  const signaturePrankId = lookup(HEAD_SIGNATURE, traits.Head) ?? null;
  const accessoryPrankId = lookup(ACCESSORY_SIGNATURE, traits.Accessory) ?? null;

  const hasLegendary =
    lookupSet(RARE_EYES, traits.Eyes) ||
    lookupSet(RARE_AURA, traits.Aura) ||
    lookupSet(RARE_HEAD, traits.Head);

  return {
    maxRarity: tier.maxRarity,
    basePoints: tier.basePoints,
    dodgeChance,
    accuracy,
    canTaunt: lookupSet(TAUNT_MOUTHS, traits.Mouth),
    signaturePrankId,
    accessoryPrankId,
    legendaryPrankId: hasLegendary ? LEGENDARY_PRANK_ID : null,
    hasLegendary,
  };
}

/**
 * Effective dodge chance of the TARGET against an attacker with `accuracy`.
 *
 * Accuracy lowers the target's dodge, and the result is clamped to
 * [DODGE_FLOOR, DODGE_CAP] - not to [0, DODGE_CAP].
 *
 * The floor used to be 0, which meant a high-accuracy attacker could make a
 * target UNDODGEABLE: "Happy" eyes (0.05) against a no-Aura target (already at
 * the floor) subtracted to exactly 0, and a stronger pair went negative and
 * clamped there. A target could then never dodge anything, which turns "this
 * Chog dodges" into a lie and removes the whole reason to pick an Aura. Every
 * Chog keeps a real, if small, chance; accuracy decides how small, never zero.
 */
export function effectiveDodge(targetDodge: number, attackerAccuracy: number): number {
  return clamp(
    targetDodge - clamp(attackerAccuracy, 0, ACCURACY_CAP),
    DODGE_FLOOR,
    DODGE_CAP,
  );
}

/**
 * Resolve a prank attempt. `roll` is injected so the maths is testable - the
 * caller supplies a value in [0,1).
 */
export function resolvePrank(
  attacker: ChogPowers,
  target: ChogPowers,
  roll: number,
): { landed: boolean; dodgeChance: number } {
  const dodge = effectiveDodge(target.dodgeChance, attacker.accuracy);
  return { landed: roll >= dodge, dodgeChance: dodge };
}

/** Streak multiplier cap, 3x (SPEC). */
export const STREAK_MULTIPLIER_CAP = 3;
/** Each consecutive day past the first adds this much, not a whole 1x. */
export const STREAK_STEP = 0.25;

/**
 * Streak multiplier: min(1 + 0.25 * (streak - 1), 3), so 1x, 1.25x, 1.5x, ...
 * reaching the 3x cap at streak 9.
 *
 * The old rule was min(floor(streak), 3): a streak of 2 paid a flat 2x. The
 * first repeat day therefore paid DOUBLE a first day, which made any streak
 * worth more than the reward of persisting and made a 3-day streak identical to
 * a 9-day one. The step curve keeps the cap while making each extra day worth
 * exactly one step.
 */
export function streakMultiplier(currentStreak: number): number {
  if (!Number.isFinite(currentStreak) || currentStreak <= 1) return 1;
  return Math.min(1 + STREAK_STEP * (currentStreak - 1), STREAK_MULTIPLIER_CAP);
}

export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(Math.max(value, min), max);
}

/** UTC day key - the daily-limit identity. */
export function utcDayKey(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/** Start of the ISO week (Monday, UTC) - the leaderboard reset key. */
export function isoWeekKey(d: Date = new Date()): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (t.getUTCDay() + 6) % 7; // Monday = 0
  t.setUTCDate(t.getUTCDate() - dayNum);
  return t.toISOString().slice(0, 10);
}