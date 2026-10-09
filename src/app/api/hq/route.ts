import { connection } from 'next/server';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifySession } from '@/lib/siwe';
import { db } from '@/lib/db';
import { getChog } from '@/lib/chogs';
import { dayFor } from '@/game/rules';

/**
 * GET /api/hq - the signed-in player's dashboard data.
 *
 * Everything the HQ screen renders, in one round trip: the active Chog's
 * totals, whether today's prank is still available, the recent history in
 * both directions, the badges, and the overlays still sitting on the Chog
 * (the Inbox's "clean" queue).
 *
 * WHY IT EXISTS: the HQ is the screen a returning player lands on, and it
 * is also the entry point for the prank flow. Shipping it as one endpoint
 * keeps the page a thin renderer and makes the whole screen testable with
 * a mocked session, the same way /prank is.
 *
 * Token identity, not wallet identity: every row is keyed on the token id,
 * so a Chog keeps its record when it changes hands.
 */

const SESSION_COOKIE = 'chog_session';

const RECENT_LIMIT = 6;

interface SessionLike {
  address: string;
  tokenIds: number[];
}

export async function GET() {
  await connection();

  const secret = process.env.SESSION_SECRET;
  if (!secret) return NextResponse.json({ authenticated: false });

  const jar = await cookies();
  const session = verifySession(jar.get(SESSION_COOKIE)?.value, secret) as SessionLike | null;
  if (!session || session.tokenIds.length === 0) {
    return NextResponse.json({ authenticated: false });
  }

  const supabase = db();
  const today = dayFor(Date.now());

  // The held Chogs, with their metadata, so the switcher and the hero card
  // render from one source.
  const chogs = session.tokenIds
    .map((id) => getChog(id))
    .filter((c): c is NonNullable<typeof c> => c !== null)
    .map((c) => ({
      tokenId: c.tokenId,
      name: c.name,
      imageUrl: c.imageUrl,
      traits: c.traits,
    }));

  if (chogs.length === 0) return NextResponse.json({ authenticated: false });

  const tokenIds = chogs.map((c) => c.tokenId);

  // Points are not stored as a running total: they are the sum of the prank
  // log, which is the same number the rules produce and cannot drift.
  const [pointsRows, streakRows, badgeRows, todayRows, overlays] = await Promise.all([
    supabase.from('pranks').select('from_token_id, points').in('from_token_id', tokenIds),
    supabase
      .from('streaks')
      .select('token_id, current_streak, longest_streak, last_prank_day, consecutive_dodges')
      .in('token_id', tokenIds),
    supabase.from('badges').select('token_id, badge').in('token_id', tokenIds),
    supabase.from('pranks').select('from_token_id').in('from_token_id', tokenIds).eq('day', today),
    supabase.from('overlays_active').select('token_id, prank_id, caption, created_at').in('token_id', tokenIds),
  ]);

  const pointsByToken = new Map<number, number>();
  for (const row of pointsRows.data ?? []) {
    const id = row.from_token_id as number;
    pointsByToken.set(id, (pointsByToken.get(id) ?? 0) + ((row.points as number) ?? 0));
  }

  const prankedToday = new Set((todayRows.data ?? []).map((r) => r.from_token_id as number));

  // Recent history in both directions, newest first.
  const { data: outgoing } = await supabase
    .from('pranks')
    .select('id, from_token_id, to_token_id, prank_id, landed, points, revenge, created_at')
    .in('from_token_id', tokenIds)
    .order('created_at', { ascending: false })
    .limit(RECENT_LIMIT);

  const { data: incoming } = await supabase
    .from('pranks')
    .select('id, from_token_id, to_token_id, prank_id, landed, points, revenge, created_at')
    .in('to_token_id', tokenIds)
    .order('created_at', { ascending: false })
    .limit(RECENT_LIMIT);

  // Names for every other Chog involved, so a row reads "CHOG #12 pranked you"
  // rather than an id.
  const otherIds = new Set<number>();
  for (const row of [...(outgoing ?? []), ...(incoming ?? [])]) {
    otherIds.add(row.from_token_id as number);
    otherIds.add(row.to_token_id as number);
  }
  for (const id of tokenIds) otherIds.delete(id);

  let names = new Map<number, string>();
  if (otherIds.size > 0) {
    const { data: nameRows } = await supabase
      .from('chogs')
      .select('token_id, name')
      .in('token_id', [...otherIds]);
    names = new Map((nameRows ?? []).map((r) => [r.token_id as number, r.name as string]));
  }
  const nameOf = (id: number) => names.get(id) ?? getChog(id)?.name ?? `CHOG #${id}`;

  const byToken = (tokenId: number) => ({
    tokenId,
    points: pointsByToken.get(tokenId) ?? 0,
    prankedToday: prankedToday.has(tokenId),
    streak:
      (streakRows.data ?? []).find((r) => r.token_id === tokenId)
        ? {
            currentStreak: ((streakRows.data ?? []).find((r) => r.token_id === tokenId)!.current_streak as number) ?? 0,
            longestStreak: ((streakRows.data ?? []).find((r) => r.token_id === tokenId)!.longest_streak as number) ?? 0,
          }
        : { currentStreak: 0, longestStreak: 0 },
    badges: (badgeRows.data ?? []).filter((r) => r.token_id === tokenId).map((r) => r.badge as string),
    overlays: (overlays.data ?? [])
      .filter((r) => r.token_id === tokenId)
      .map((r) => ({ prankId: r.prank_id as string, caption: (r.caption as string) ?? '' })),
  });

  return NextResponse.json({
    authenticated: true,
    address: session.address,
    chogs,
    today,
    stats: chogs.map((c) => byToken(c.tokenId)),
    recentOutgoing: (outgoing ?? []).map((r) => ({
      id: r.id as string,
      fromTokenId: r.from_token_id as number,
      fromName: nameOf(r.from_token_id as number),
      toTokenId: r.to_token_id as number,
      toName: nameOf(r.to_token_id as number),
      prankId: r.prank_id as string,
      landed: Boolean(r.landed),
      points: (r.points as number) ?? 0,
      revenge: Boolean(r.revenge),
      createdAt: r.created_at as string,
    })),
    recentIncoming: (incoming ?? []).map((r) => ({
      id: r.id as string,
      fromTokenId: r.from_token_id as number,
      fromName: nameOf(r.from_token_id as number),
      toTokenId: r.to_token_id as number,
      toName: nameOf(r.to_token_id as number),
      prankId: r.prank_id as string,
      landed: Boolean(r.landed),
      points: (r.points as number) ?? 0,
      revenge: Boolean(r.revenge),
      createdAt: r.created_at as string,
    })),
  });
}
