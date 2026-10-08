/**
 * Chog Mischief — game rules.
 *
 * Everything here is PURE and deterministic: the same state and inputs always
 * produce the same decision. No database, no chain reads, no clock of its own
 * (the caller passes `now`), no randomness except an injected roll. That makes
 * the rules unit-testable and keeps the server's authority over money-free but
 * reputation-bearing state honest: a rule that can be re-derived from its inputs
 * can be checked by anyone.
 *
 * THE CORE IDENTITY RULE: everything keys on `token_id`, never on a wallet.
 * Sell the Chog and its reputation, its grudges and its badges go with it. That
 * is the whole reason the NFT is essential, so it is enforced here rather than
 * left to convention.
 */

import { PrankRarity, streakMultiplier, utcDayKey } from './powers';

// ---------------------------------------------------------------------------
// Limits and constants (SPEC §3, §5)
// ---------------------------------------------------------------------------

export const DAILY_PRANKS_PER_TOKEN = 1;
export const DAILY_CLEANS_PER_TOKEN = 1;
export const MAX_ACTIVE_OVERLAYS = 3;
export const REVENGE_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours
export const REVENGE_MULTIPLIER = 2;
export const NONCE_TTL_MS = 10 * 60 * 1000; // 10 minutes
export const STREAK_CAP = 3;

/** Badges (SPEC §3 retention mechanics). */
export type Badge =
  | 'first_blood'   // first prank ever dealt
  | 'payback'       // revenged within the window
  | 'untouchable'   // 5 dodges in a row
  | 'most_wanted';  // pranked by 10 different Chogs

export const UNTOUCHABLE_DODGE_STREAK = 5;
export const MOST_WANTED_DISTINCT_ATTACKERS = 10;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface PrankRecord {
  id: string;
  fromTokenId: number;
  toTokenId: number;
  prankId: string;
  day: string;          // UTC day key
  landed: boolean;
  points: number;
  revenge: boolean;
  createdAt: number;    // epoch ms
}

export interface CleanRecord {
  tokenId: number;
  prankId: string;
  day: string;
  createdAt: number;
}

export interface OverlayRecord {
  tokenId: number;
  prankId: string;      // the prank record id
  caption: string;
  createdAt: number;
}

export interface StreakRecord {
  tokenId: number;
  currentStreak: number;
  longestStreak: number;
  lastPrankDay: string | null;
  /** Consecutive dodges suffered, for the Untouchable badge. */
  consecutiveDodges: number;
}

export interface GameState {
  pranks: PrankRecord[];
  cleans: CleanRecord[];
  overlays: OverlayRecord[];
  streaks: Record<number, StreakRecord>;
  badges: Record<number, Badge[]>;
}

// ---------------------------------------------------------------------------
// Outcomes
// ---------------------------------------------------------------------------

export type RuleRefusal =
  | 'ALREADY_PRANKED_TODAY'
  | 'SELF_PRANK'
  | 'SAME_WALLET'
  | 'TOKEN_NOT_FOUND'
  | 'PRANK_NOT_ALLOWED_FOR_TIER'
  | 'NO_OVERLAY_TO_CLEAN'
  | 'ALREADY_CLEANED_TODAY'
  | 'NONCE_EXPIRED'
  | 'NONCE_USED'
  | 'LEGENDARY_ALREADY_USED_THIS_WEEK';

export type RuleResult<T> =
  | { ok: true; value: T }
  | { ok: false; refusal: RuleRefusal; detail?: string };

const refuse = <T>(refusal: RuleRefusal, detail?: string): RuleResult<T> => ({
  ok: false,
  refusal,
  detail,
});

/** UTC day key for an epoch-ms instant. */
export function dayFor(now: number): string {
  return utcDayKey(new Date(now));
}

/** ISO week key (Monday, UTC) for an epoch-ms instant. */
export function weekFor(now: number): string {
  const t = new Date(now);
  const monday = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  return monday.toISOString().slice(0, 10);
}

/** Whole days between two UTC day keys (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round(
    (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000,
  );
}

// ---------------------------------------------------------------------------
// Daily limits
// ---------------------------------------------------------------------------

export function pranksUsedToday(state: GameState, tokenId: number, now: number): number {
  const day = dayFor(now);
  return state.pranks.filter((p) => p.fromTokenId === tokenId && p.day === day).length;
}

export function cleansUsedToday(state: GameState, tokenId: number, now: number): number {
  const day = dayFor(now);
  return state.cleans.filter((c) => c.tokenId === tokenId && c.day === day).length;
}

export function hasPrankedToday(state: GameState, tokenId: number, now: number): boolean {
  return pranksUsedToday(state, tokenId, now) >= DAILY_PRANKS_PER_TOKEN;
}

export function hasCleanedToday(state: GameState, tokenId: number, now: number): boolean {
  return cleansUsedToday(state, tokenId, now) >= DAILY_CLEANS_PER_TOKEN;
}

// ---------------------------------------------------------------------------
// Pranking
// ---------------------------------------------------------------------------

export interface PrankInput {
  fromTokenId: number;
  toTokenId: number;
  prankId: string;
  prankRarity: PrankRarity;
  attackerMaxRarity: PrankRarity;
  landed: boolean;
  basePoints: number;
  /** True when this prank is a revenge for an attack within the window. */
  revenge: boolean;
  now: number;
  /** Optional: today's UTC day, injectable for tests. */
  day?: string;
  knownTokens?: Set<number>;
  /** Wallets that hold each token, for the same-wallet rule. */
  walletOf?: (tokenId: number) => string | undefined;
}

const RARITY_ORDER: Record<PrankRarity, number> = { common: 0, rare: 1, legendary: 2 };

export function canUsePrank(
  prankRarity: PrankRarity,
  attackerMaxRarity: PrankRarity,
): boolean {
  return RARITY_ORDER[prankRarity] <= RARITY_ORDER[attackerMaxRarity];
}

/**
 * Validate a prank attempt WITHOUT mutating anything. The server calls this
 * first, and the unique index on (from_token_id, day) is the real enforcement —
 * this returns a friendly message instead of a constraint violation.
 */
export function validatePrank(state: GameState, input: PrankInput): RuleResult<true> {
  const { fromTokenId, toTokenId, now } = input;

  if (fromTokenId === toTokenId) return refuse('SELF_PRANK');

  if (input.knownTokens) {
    if (!input.knownTokens.has(fromTokenId)) return refuse('TOKEN_NOT_FOUND', `unknown ${fromTokenId}`);
    if (!input.knownTokens.has(toTokenId)) return refuse('TOKEN_NOT_FOUND', `unknown ${toTokenId}`);
  }

  if (input.walletOf) {
    const a = input.walletOf(fromTokenId);
    const b = input.walletOf(toTokenId);
    if (a && b && a.toLowerCase() === b.toLowerCase()) return refuse('SAME_WALLET');
  }

  if (hasPrankedToday(state, fromTokenId, now)) return refuse('ALREADY_PRANKED_TODAY');

  if (!canUsePrank(input.prankRarity, input.attackerMaxRarity)) {
    return refuse('PRANK_NOT_ALLOWED_FOR_TIER', `${input.prankRarity} > ${input.attackerMaxRarity}`);
  }

  return { ok: true, value: true };
}

/** Points a landed prank is worth, including streak and revenge multipliers. */
export function pointsFor(
  basePoints: number,
  currentStreak: number,
  revenge: boolean,
): number {
  const streak = streakMultiplier(currentStreak);
  const revengeMul = revenge ? REVENGE_MULTIPLIER : 1;
  return Math.round(basePoints * streak * revengeMul);
}

/**
 * Apply a validated prank. Returns a NEW state (no mutation) plus the derived
 * streak and any badges the prank earned.
 *
 * A DODGED prank still counts against the daily limit and still advances
 * nothing for the attacker — it is a real attempt, not a free retry.
 */
export function applyPrank(
  state: GameState,
  input: PrankInput,
): RuleResult<{ state: GameState; record: PrankRecord; streak: StreakRecord; newBadges: Badge[] }> {
  const check = validatePrank(state, input);
  if (!check.ok) return check as never;

  const day = input.day ?? dayFor(input.now);
  const prev = state.streaks[input.fromTokenId] ?? {
    tokenId: input.fromTokenId,
    currentStreak: 0,
    longestStreak: 0,
    lastPrankDay: null,
    consecutiveDodges: 0,
  };

  // Streak advances only on a LANDED prank, and only if the previous prank was
  // on the immediately preceding UTC day. Missing a day resets to 1.
  let currentStreak: number;
  if (prev.lastPrankDay === null) {
    currentStreak = 1;
  } else {
    const gap = daysBetween(prev.lastPrankDay, day);
    currentStreak = gap === 1 ? prev.currentStreak + 1 : 1;
  }
  const longestStreak = Math.max(prev.longestStreak, currentStreak);

  // Points use the streak BEFORE this prank counts, so the first prank of a
  // streak is worth 1x rather than jumping straight to 2x.
  const points = input.landed ? pointsFor(input.basePoints, prev.currentStreak, input.revenge) : 0;

  const record: PrankRecord = {
    id: `${input.fromTokenId}-${input.toTokenId}-${day}-${state.pranks.length}`,
    fromTokenId: input.fromTokenId,
    toTokenId: input.toTokenId,
    prankId: input.prankId,
    day,
    landed: input.landed,
    points,
    revenge: input.revenge,
    createdAt: input.now,
  };

  const attackerStreak: StreakRecord = {
    tokenId: input.fromTokenId,
    currentStreak,
    longestStreak,
    lastPrankDay: day,
    consecutiveDodges: prev.consecutiveDodges,
  };

  // The victim's dodge streak only advances on consecutive dodges.
  const victimPrev = state.streaks[input.toTokenId] ?? {
    tokenId: input.toTokenId,
    currentStreak: 0,
    longestStreak: 0,
    lastPrankDay: null,
    consecutiveDodges: 0,
  };
  const victimStreak: StreakRecord = {
    ...victimPrev,
    consecutiveDodges: input.landed ? 0 : victimPrev.consecutiveDodges + 1,
  };

  const streaks: Record<number, StreakRecord> = {
    ...state.streaks,
    [input.fromTokenId]: attackerStreak,
    [input.toTokenId]: victimStreak,
  };

  const newBadges: Badge[] = [];
  // Work on a COPY of the badge map. Mutating `state.badges` in place would make
  // applyPrank impure: a rejected or discarded prank would still leave badges on
  // the caller's state, and a retry would see a badge that was never granted.
  const badges: Record<number, Badge[]> = { ...state.badges };
  const attackerBadges = new Set(badges[input.fromTokenId] ?? []);

  if (state.pranks.filter((p) => p.fromTokenId === input.fromTokenId).length === 0) {
    attackerBadges.add('first_blood');
    newBadges.push('first_blood');
  }
  if (input.revenge && input.landed) {
    attackerBadges.add('payback');
    newBadges.push('payback');
  }
  if (victimStreak.consecutiveDodges >= UNTOUCHABLE_DODGE_STREAK) {
    const victimBadges = new Set(badges[input.toTokenId] ?? []);
    if (!victimBadges.has('untouchable')) newBadges.push('untouchable');
    victimBadges.add('untouchable');
    badges[input.toTokenId] = [...victimBadges];
  }

  const distinctAttackers = new Set(
    state.pranks.filter((p) => p.toTokenId === input.toTokenId).map((p) => p.fromTokenId),
  );
  if (input.landed) distinctAttackers.add(input.fromTokenId);
  if (distinctAttackers.size >= MOST_WANTED_DISTINCT_ATTACKERS) {
    const victimBadges = new Set(badges[input.toTokenId] ?? []);
    if (!victimBadges.has('most_wanted')) newBadges.push('most_wanted');
    victimBadges.add('most_wanted');
    badges[input.toTokenId] = [...victimBadges];
  }

  if (newBadges.some((b) => b === 'first_blood' || b === 'payback')) {
    badges[input.fromTokenId] = [...attackerBadges];
  }

  const overlays = input.landed
    ? addOverlay(
        state.overlays,
        input.toTokenId,
        record.id,
        captionFor(input.toTokenId, input.fromTokenId, input.prankId),
        input.now,
      )
    : state.overlays;

  return {
    ok: true,
    value: {
      state: { pranks: [...state.pranks, record], cleans: state.cleans, overlays, streaks, badges },
      record,
      streak: attackerStreak,
      newBadges,
    },
  };
}

export function captionFor(toTokenId: number, fromTokenId: number, prankId: string): string {
  return `#${toTokenId} got ${prankId.replace(/-/g, ' ')} by #${fromTokenId}`;
}

// ---------------------------------------------------------------------------
// Overlays — max 3 per victim, a 4th replaces the oldest
// ---------------------------------------------------------------------------

export function addOverlay(
  overlays: OverlayRecord[],
  tokenId: number,
  prankRecordId: string,
  caption: string,
  now: number,
): OverlayRecord[] {
  const existing = overlays.filter((o) => o.tokenId === tokenId);
  const others = overlays.filter((o) => o.tokenId !== tokenId);
  const mine = [
    ...existing,
    { tokenId, prankId: prankRecordId, caption, createdAt: now },
  ];
  // Keep the newest MAX_ACTIVE_OVERLAYS; the rest are replaced.
  const kept = mine
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(-MAX_ACTIVE_OVERLAYS);
  return [...others, ...kept];
}

export function activeOverlays(overlays: OverlayRecord[], tokenId: number): OverlayRecord[] {
  return overlays
    .filter((o) => o.tokenId === tokenId)
    .sort((a, b) => a.createdAt - b.createdAt);
}

// ---------------------------------------------------------------------------
// Cleans
// ---------------------------------------------------------------------------

export interface CleanInput {
  tokenId: number;
  prankRecordId: string;
  now: number;
  day?: string;
}

/**
 * Remove one overlay. A clean costs the daily clean allowance, whether or not an
 * overlay was actually there — otherwise a player could bank cleans by spamming.
 */
export function applyClean(state: GameState, input: CleanInput): RuleResult<{ state: GameState }> {
  if (hasCleanedToday(state, input.tokenId, input.now)) {
    return refuse('ALREADY_CLEANED_TODAY');
  }
  const target = state.overlays.find((o) => o.prankId === input.prankRecordId);
  if (!target) return refuse('NO_OVERLAY_TO_CLEAN');
  if (target.tokenId !== input.tokenId) return refuse('NO_OVERLAY_TO_CLEAN', 'not your overlay');

  const day = input.day ?? dayFor(input.now);
  return {
    ok: true,
    value: {
      state: {
        ...state,
        overlays: state.overlays.filter((o) => o.prankId !== input.prankRecordId),
        cleans: [
          ...state.cleans,
          { tokenId: input.tokenId, prankId: input.prankRecordId, day, createdAt: input.now },
        ],
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Revenge window
// ---------------------------------------------------------------------------

/**
 * True when `target` may revenge `attack` right now: the attack landed, it was
 * against this target, and it is within REVENGE_WINDOW_MS.
 */
export function canRevenge(
  state: GameState,
  attack: PrankRecord,
  targetTokenId: number,
  now: number,
): boolean {
  if (!attack.landed) return false;
  if (attack.toTokenId !== targetTokenId) return false;
  const age = now - attack.createdAt;
  return age >= 0 && age <= REVENGE_WINDOW_MS;
}

/** Most recent landed attack on a token that is still revenge-eligible. */
export function revengeTarget(
  state: GameState,
  targetTokenId: number,
  now: number,
): PrankRecord | null {
  const candidates = state.pranks
    .filter((p) => canRevenge(state, p, targetTokenId, now))
    .sort((a, b) => b.createdAt - a.createdAt);
  return candidates[0] ?? null;
}

export function revengeWindowRemaining(now: number, attackCreatedAt: number): number {
  return Math.max(0, REVENGE_WINDOW_MS - (now - attackCreatedAt));
}

// ---------------------------------------------------------------------------
// Nonces
// ---------------------------------------------------------------------------

export interface NonceRecord {
  nonce: string;
  address: string;
  expiresAt: number;
  usedAt: number | null;
}

export function validateNonce(
  record: NonceRecord | undefined,
  address: string,
  now: number,
): RuleResult<true> {
  if (!record) return refuse('NONCE_EXPIRED', 'unknown nonce');
  if (record.usedAt !== null) return refuse('NONCE_USED');
  if (now > record.expiresAt) return refuse('NONCE_EXPIRED');
  if (record.address.toLowerCase() !== address.toLowerCase()) {
    return refuse('NONCE_EXPIRED', 'nonce issued to a different address');
  }
  return { ok: true, value: true };
}

export function burnNonce(record: NonceRecord, now: number): NonceRecord {
  return { ...record, usedAt: now };
}

// ---------------------------------------------------------------------------
// Transfer behaviour — the reason the NFT is essential
// ---------------------------------------------------------------------------

/**
 * Reputation follows the TOKEN, not the wallet. Selling a Chog changes who can
 * PLAY it, never who it IS: the new owner inherits the pranks, the badges and
 * the grudges, and the old owner keeps none of it.
 *
 * Returns the token's state unchanged — the point of the test is that nothing
 * needs migrating, because nothing was ever keyed on the wallet.
 */
export function stateForToken(state: GameState, tokenId: number) {
  return {
    pranksDealt: state.pranks.filter((p) => p.fromTokenId === tokenId),
    pranksReceived: state.pranks.filter((p) => p.toTokenId === tokenId),
    cleans: state.cleans.filter((c) => c.tokenId === tokenId),
    overlays: activeOverlays(state.overlays, tokenId),
    streak: state.streaks[tokenId] ?? null,
    badges: state.badges[tokenId] ?? [],
  };
}

/** Points a Chog has dealt, all time. */
export function totalPointsDealt(state: GameState, tokenId: number): number {
  return state.pranks
    .filter((p) => p.fromTokenId === tokenId)
    .reduce((sum, p) => sum + p.points, 0);
}

export function emptyState(): GameState {
  return { pranks: [], cleans: [], overlays: [], streaks: {}, badges: {} };
}
