/**
 * Chog Mischief — trait -> power mapping.
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
// ---------------------------------------------------------------------------
const TIER_TABLE: Record<string, { maxRarity: PrankRarity; basePoints: number }> = {
  Common: { maxRarity: 'common', basePoints: 10 },
  Uncommon: { maxRarity: 'rare', basePoints: 18 },
  Rare: { maxRarity: 'rare', basePoints: 26 },
  Epic: { maxRarity: 'legendary', basePoints: 40 },
  Legendary: { maxRarity: 'legendary', basePoints: 60 },
};

const TIER_FALLBACK = TIER_TABLE.Common;

// ---------------------------------------------------------------------------
// AURA -> dodge chance, 5% floor to 35% cap (SPEC).
// Measured auras are mostly flavour words, so the table is thematic rather
// than ordinal: "fiery" auras dodge well, "clean" ones badly.
// ---------------------------------------------------------------------------
const AURA_DODGE: Record<string, number> = {
  Smoke: 0.35,           // hard to see coming
  'Pink Mist': 0.34,
  'Royal Blue Aura': 0.32,
  'Royal Aura': 0.31,
  'Burning Aura': 0.30,
  'Cool Aura': 0.29,
  Purple: 0.28,
  Violet: 0.27,
  'Light Purple': 0.26,
  Wind: 0.25,
  Mint: 0.22,
  'Aqua Aura': 0.24,
  'Rose Aura': 0.23,
  'Fiery Aura': 0.21,
  Fire: 0.20,
  'Yellow Aura': 0.18,
  'Green Aura': 0.17,
  'Rose Scent': 0.19,      // 5 tokens — faint, weak
  'Royal Blue': 0.31,      // 3 tokens — distinct from "Royal Blue Aura"
  'Electric Shock': 0.33,  // 2 tokens — rare, evasive
  'White Aura': 0.30,      // 1 token — the rarest aura in the collection
  Clean: 0.05,             // a clean aura is no aura at all
};

export const DODGE_FLOOR = 0.05;
export const DODGE_CAP = 0.35;

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
// NOTE: values containing an offensive slur exist in the on-chain trait data
// (e.g. "Retard"). They are deliberately NOT mapped: no prank, no power, no
// leaderboard entry keys off a slur. They fall through to 0 accuracy, and the
// UI shows the raw trait text because the NFT's own art already does.
  };

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
const HEAD_SIGNATURE: Record<string, string> = {
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

const ACCESSORY_SIGNATURE: Record<string, string> = {
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
// "rare" legendary to 30% of the collection — a coverage test caught it.
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
  'White Aura',        // 1 — the single rarest aura in the collection
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

/** Case-insensitive lookup over a table keyed by display-cased trait values. */
function lookup<T>(table: Record<string, T>, value: string | undefined | null): T | undefined {
  const key = normaliseTrait(value);
  if (!key) return undefined;
  for (const [k, v] of Object.entries(table)) {
    if (normaliseTrait(k) === key) return v;
  }
  return undefined;
}

function lookupSet(set: Set<string>, value: string | undefined | null): boolean {
  const key = normaliseTrait(value);
  if (!key) return false;
  for (const k of set) {
    if (normaliseTrait(k) === key) return true;
  }
  return false;
}

/**
 * Derive every power for one Chog from its traits. Pure and total: a Chog with
 * no traits at all still returns a playable power sheet.
 */
export function powersFor(traits: ChogTraits): ChogPowers {
  const tier = lookup(TIER_TABLE, traits.Tier) ?? TIER_FALLBACK;

  const auraRaw = lookup(AURA_DODGE, traits.Aura);
  const dodgeChance = clamp(
    auraRaw === undefined ? DODGE_FLOOR : auraRaw,
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
 * Accuracy lowers the target's dodge but can never take it below 0.
 */
export function effectiveDodge(targetDodge: number, attackerAccuracy: number): number {
  return clamp(targetDodge - clamp(attackerAccuracy, 0, ACCURACY_CAP), 0, DODGE_CAP);
}

/**
 * Resolve a prank attempt. `roll` is injected so the maths is testable — the
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

/** Streak multiplier, capped at 3x (SPEC). */
export const STREAK_MULTIPLIER_CAP = 3;

export function streakMultiplier(currentStreak: number): number {
  if (!Number.isFinite(currentStreak) || currentStreak <= 1) return 1;
  return Math.min(Math.floor(currentStreak), STREAK_MULTIPLIER_CAP);
}

export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(Math.max(value, min), max);
}

/** UTC day key — the daily-limit identity. */
export function utcDayKey(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/** Start of the ISO week (Monday, UTC) — the leaderboard reset key. */
export function isoWeekKey(d: Date = new Date()): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (t.getUTCDay() + 6) % 7; // Monday = 0
  t.setUTCDate(t.getUTCDate() - dayNum);
  return t.toISOString().slice(0, 10);
}