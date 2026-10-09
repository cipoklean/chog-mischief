/**
 * Game state loader - hydrates the pure rules engine from Supabase.
 *
 * The rules in src/game/rules.ts are pure and know nothing about the database.
 * This module is the only place that translates rows into the shape those rules
 * consume, so a column rename has exactly one blast radius.
 *
 * READ-ONLY BY DESIGN. Nothing here writes. The prank route runs the rules,
 * then persists the single row the rules produced - and the daily-limit
 * constraint in Postgres, not this code, is what stops a double prank.
 */

import { db } from './db';
import { emptyState, type Badge, type GameState, type PrankRecord } from '@/game/rules';

/**
 * Load only what the rules need for one attacker and one target.
 *
 * Loading every prank ever would be correct but absurd; the rules ask two
 * questions - "has this token pranked today" and "what attacked this token" -
 * and both are answerable from a narrow slice. `since` bounds the query so a
 * long-running game does not grow without limit.
 */
export async function loadGameState(
  attackerTokenId: number,
  targetTokenId: number,
  sinceDays = 30,
): Promise<GameState> {
  const supabase = db();
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString();

  const { data: prankRows, error } = await supabase
    .from('pranks')
    .select('id, from_token_id, to_token_id, prank_id, day, landed, points, revenge, created_at')
    .or(`from_token_id.eq.${attackerTokenId},to_token_id.eq.${targetTokenId}`)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) {
    throw new Error(`could not load pranks: ${error.message}`);
  }

  const pranks: PrankRecord[] = (prankRows ?? []).map((r) => ({
    id: r.id as string,
    fromTokenId: r.from_token_id as number,
    toTokenId: r.to_token_id as number,
    prankId: r.prank_id as string,
    day: String(r.day).slice(0, 10),
    landed: Boolean(r.landed),
    points: (r.points as number) ?? 0,
    revenge: Boolean(r.revenge),
    createdAt: new Date(r.created_at as string).getTime(),
  }));

  // Streaks and badges are per-token derived state. The table is authoritative;
  // an absent row simply means "no streak yet", which the rules handle.
  const tokenIds = [...new Set([attackerTokenId, targetTokenId])];
  const { data: streakRows } = await supabase
    .from('streaks')
    .select('token_id, current_streak, longest_streak, last_prank_day, consecutive_dodges')
    .in('token_id', tokenIds);

  const { data: badgeRows } = await supabase
    .from('badges')
    .select('token_id, badge')
    .in('token_id', tokenIds);

  const { data: overlayRows } = await supabase
    .from('overlays_active')
    .select('token_id, prank_id, caption, created_at')
    .in('token_id', tokenIds);

  const state: GameState = emptyState();

  for (const r of streakRows ?? []) {
    const tokenId = r.token_id as number;
    state.streaks[tokenId] = {
      tokenId,
      currentStreak: (r.current_streak as number) ?? 0,
      longestStreak: (r.longest_streak as number) ?? 0,
      lastPrankDay: r.last_prank_day ? String(r.last_prank_day).slice(0, 10) : null,
      consecutiveDodges: (r.consecutive_dodges as number) ?? 0,
    };
  }

  // Badges are a closed union in the rules engine, so a value the database
  // returns that the engine does not know is DROPPED rather than cast in.
  // Casting an arbitrary string into the union is how an unrecognised badge
  // silently becomes real game state. Keep this list equal to `export type
  // Badge` in src/game/rules.ts - a name here that does not exist there is a
  // badge no code will ever award.
  const knownBadges = new Set<string>([
    'first_blood',
    'payback',
    'untouchable',
    'most_wanted',
  ]);

  for (const r of badgeRows ?? []) {
    const badge = r.badge as string;
    if (!knownBadges.has(badge)) continue;
    const tokenId = r.token_id as number;
    state.badges[tokenId] = [...(state.badges[tokenId] ?? []), badge as Badge];
  }

  state.pranks = pranks;
  state.overlays = (overlayRows ?? []).map((r) => ({
    tokenId: r.token_id as number,
    prankId: r.prank_id as string,
    caption: r.caption as string,
    createdAt: new Date(r.created_at as string).getTime(),
  }));

  return state;
}