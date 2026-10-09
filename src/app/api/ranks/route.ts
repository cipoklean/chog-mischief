import { connection } from 'next/server';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifySession } from '@/lib/siwe';
import { db } from '@/lib/db';
import { getChog } from '@/lib/chogs';

/**
 * GET /api/ranks - the three leaderboards.
 *
 * Weekly (the three schema views), All-time (the same sums without a week
 * filter, straight off the prank log) and Rivalries (head-to-head records
 * between the viewer's Chogs and everyone else).
 *
 * Token identity, not wallet identity: every row keys on the token id, so a
 * Chog keeps its rank when it changes hands. The viewer's own Chogs are
 * flagged so the UI can highlight them, and a viewer with no rank yet gets a
 * pinned Unranked row rather than an empty board.
 *
 * No addresses anywhere: the rows are token ids plus names from `chogs`.
 */

const SESSION_COOKIE = 'chog_session';

interface SessionLike {
  address: string;
  tokenIds: number[];
}

const LIMIT = 20;

interface RankRow {
  tokenId: number;
  name: string;
  imageUrl: string | null;
  points: number;
  pranks: number;
  mine: boolean;
}

export async function GET() {
  await connection();

  const secret = process.env.SESSION_SECRET;
  let mine = new Set<number>();
  if (secret) {
    const jar = await cookies();
    const session = verifySession(jar.get(SESSION_COOKIE)?.value, secret) as SessionLike | null;
    if (session) mine = new Set(session.tokenIds);
  }

  const supabase = db();

  // Weekly boards, from the three views.
  const [chaotic, bullied, dodger] = await Promise.all([
    supabase.from('weekly_most_chaotic').select('token_id, points, pranks').limit(LIMIT),
    supabase.from('weekly_most_bullied').select('token_id, pranks_received').limit(LIMIT),
    supabase.from('weekly_best_dodger').select('token_id, dodges').limit(LIMIT),
  ]);

  // All-time: the same sums over the whole log, computed here rather than in
  // another view so the weekly views stay the only schema dependency.
  const { data: allTime } = await supabase
    .from('pranks')
    .select('from_token_id, to_token_id, landed, points')
    .limit(5000);

  const allTimePoints = new Map<number, number>();
  const allTimePranks = new Map<number, number>();
  for (const row of allTime ?? []) {
    const from = row.from_token_id as number;
    const to = row.to_token_id as number;
    const landed = Boolean(row.landed);
    if (landed) {
      allTimePoints.set(from, (allTimePoints.get(from) ?? 0) + ((row.points as number) ?? 0));
      allTimePranks.set(from, (allTimePranks.get(from) ?? 0) + 1);
    } else {
      allTimePranks.set(to, (allTimePranks.get(to) ?? 0) + 1);
    }
  }

  // Names for every token that appears anywhere on the boards.
  const ids = new Set<number>();
  for (const rows of [chaotic.data, bullied.data, dodger.data]) {
    for (const r of rows ?? []) ids.add(r.token_id as number);
  }
  for (const id of allTimePoints.keys()) ids.add(id);
  for (const id of allTimePranks.keys()) ids.add(id);

  let names = new Map<number, string>();
  let images = new Map<number, string | null>();
  if (ids.size > 0) {
    const { data: chogRows } = await supabase
      .from('chogs')
      .select('token_id, name')
      .in('token_id', [...ids]);
    names = new Map((chogRows ?? []).map((r) => [r.token_id as number, r.name as string]));
    // Names that are not in the DB still render from the harvested collection.
    for (const id of ids) {
      if (!names.has(id)) {
        const meta = getChog(id);
        if (meta) {
          names.set(id, meta.name);
          images.set(id, meta.imageUrl);
        }
      }
    }
  }
  const nameOf = (id: number) => names.get(id) ?? `CHOG #${id}`;

  const row = (tokenId: number, points: number, pranks: number): RankRow => ({
    tokenId,
    name: nameOf(tokenId),
    imageUrl: images.get(tokenId) ?? getChog(tokenId)?.imageUrl ?? null,
    points,
    pranks,
    mine: mine.has(tokenId),
  });

  const weekly = {
    chaotic: (chaotic.data ?? []).map((r) => row(r.token_id as number, (r.points as number) ?? 0, (r.pranks as number) ?? 0)),
    bullied: (bullied.data ?? []).map((r) => row(r.token_id as number, 0, (r.pranks_received as number) ?? 0)),
    dodger: (dodger.data ?? []).map((r) => row(r.token_id as number, 0, (r.dodges as number) ?? 0)),
  };

  const allTimeSorted = [...allTimePoints.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, LIMIT)
    .map(([tokenId, points]) => row(tokenId, points, allTimePranks.get(tokenId) ?? 0));

  // Rivalries: head-to-head between my Chogs and theirs.
  const rivalries: {
    opponentTokenId: number;
    opponentName: string;
    mine: number;
    theirs: number;
    myTokenId: number;
  }[] = [];
  if (mine.size > 0) {
    const myIds = [...mine];
    const { data: vsRows } = await supabase
      .from('pranks')
      .select('from_token_id, to_token_id, landed')
      .or(`from_token_id.in.(${myIds.join(',')}),to_token_id.in.(${myIds.join(',')})`)
      .limit(2000);

    const pair = new Map<string, { mine: number; theirs: number; myTokenId: number }>();
    for (const r of vsRows ?? []) {
      const from = r.from_token_id as number;
      const to = r.to_token_id as number;
      const fromMine = mine.has(from);
      const toMine = mine.has(to);
      if (fromMine === toMine) continue; // my Chog vs my Chog, or neither
      const [myToken, theirToken] = fromMine ? [from, to] : [to, from];
      const key = `${myToken}|${theirToken}`;
      const entry = pair.get(key) ?? { mine: 0, theirs: 0, myTokenId: myToken };
      if (fromMine) entry.mine += 1;
      else entry.theirs += 1;
      pair.set(key, entry);
    }
    for (const [key, e] of pair) {
      const theirToken = Number(key.split('|')[1]);
      rivalries.push({
        opponentTokenId: theirToken,
        opponentName: nameOf(theirToken),
        mine: e.mine,
        theirs: e.theirs,
        myTokenId: e.myTokenId,
      });
    }
    rivalries.sort((a, b) => b.mine + b.theirs - (a.mine + a.theirs));
  }

  return NextResponse.json({
    myTokenIds: [...mine],
    weekly,
    allTime: allTimeSorted,
    rivalries: rivalries.slice(0, LIMIT),
  });
}
