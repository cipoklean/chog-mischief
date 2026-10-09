import { connection } from 'next/server';
import { db } from '@/lib/db';
import { listChogs } from '@/lib/chogs';

/**
 * GET /api/chogs - the target grid for the prank flow.
 *
 * WHY IT READS THE HARVESTED CACHE, NOT SUPABASE: the grid needs all 1,969
 * real Chogs with names and art. The Supabase `chogs` table holds only the
 * rows the game has actually written (sparse), while the cache is the
 * complete, public, on-chain-derived collection. The RIVALRY FILTERS, which
 * are per-player history, do come from Supabase - that is the part only the
 * DB can answer. (A Vercel deploy has no data/cache/ - the known deploy
 * blocker, documented in AGENTS.md.)
 *
 * The list itself is public data (the /chog/<id> pages are public), so no
 * session is required for the default list. The session only scopes the
 * rivalry filters, and it is read here server-side so the client never has
 * to send an address.
 *
 * Query params:
 *   q        free-text search over name and #id
 *   filter   all | rivals | recent
 *   exclude  comma-separated token ids to hide (the caller's own Chogs)
 *   limit    page size (default 24, max 96)
 *   offset   paging offset
 */

const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 96;

interface SessionLike {
  address: string;
  tokenIds: number[];
}

/** Read the session cookie without pulling in the whole SIWE module twice. */
async function readSession(request: Request): Promise<SessionLike | null> {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return null;
  const cookie = request.headers.get('cookie') ?? '';
  const match = /(?:^|;\s*)chog_session=([^;]+)/.exec(cookie);
  if (!match) return null;
  try {
    const { verifySession } = await import('@/lib/siwe');
    return verifySession(decodeURIComponent(match[1]), secret);
  } catch {
    return null;
  }
}

/** Token ids with prank history against `me`, newest first, capped. */
async function historyTokenIds(me: number, mode: 'rivals' | 'recent'): Promise<number[]> {
  const supabase = db();

  const { data, error } = await supabase
    .from('pranks')
    .select('from_token_id, to_token_id, created_at')
    .or(`from_token_id.eq.${me},to_token_id.eq.${me}`)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error || !data) return [];

  // Typed locally: the Supabase client types rows loosely, and indexing it
  // with computed column names is where a typo would silently read undefined.
  const rows = data as { from_token_id: number; to_token_id: number }[];

  const ids = new Set<number>();
  for (const row of rows) {
    if (mode === 'recent') {
      // "Got you recently": pranks that landed ON me, the attacker's id.
      if (Number(row.to_token_id) === me) ids.add(Number(row.from_token_id));
    } else {
      // "Rivals": anyone on either side of any prank with me.
      const other =
        Number(row.from_token_id) === me ? Number(row.to_token_id) : Number(row.from_token_id);
      if (other !== me) ids.add(other);
    }
    if (ids.size >= DEFAULT_LIMIT) break;
  }
  return [...ids];
}

export async function GET(request: Request) {
  // A per-request route: the grid is personalised by the caller's session
  // and history. Without this, Cache Components would prerender it.
  await connection();

  const url = new URL(request.url);
  const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();
  const filter = url.searchParams.get('filter') ?? 'all';
  const exclude = new Set(
    (url.searchParams.get('exclude') ?? '')
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n)),
  );
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number(url.searchParams.get('limit')) || DEFAULT_LIMIT),
  );
  const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);

  const all = listChogs();
  if (all.length === 0) {
    // A fresh clone with no harvest - say so rather than rendering an empty
    // grid that looks like a bug.
    return Response.json({ rows: [], total: 0, cacheReady: false });
  }

  let candidates = all.filter((c) => !exclude.has(c.tokenId));

  if (filter === 'rivals' || filter === 'recent') {
    const session = await readSession(request);
    if (session && session.tokenIds.length > 0) {
      // History is per ACTIVE Chog. The client says which one with active=;
      // it must be one the session actually holds, or the session's first
      // held Chog is used. Without a session the filter has nothing to
      // scope to and returns nothing.
      const activeParam = Number(url.searchParams.get('active'));
      const active =
        Number.isInteger(activeParam) && session.tokenIds.includes(activeParam)
          ? activeParam
          : session.tokenIds[0];
      const ids = await historyTokenIds(active, filter);
      const wanted = new Set(ids);
      candidates = candidates.filter((c) => wanted.has(c.tokenId));
    } else {
      candidates = [];
    }
  }

  if (q) {
    candidates = candidates.filter((c) => {
      const byName = c.name.toLowerCase().includes(q);
      const byId = String(c.tokenId).includes(q.replace('#', ''));
      return byName || byId;
    });
  }

  const total = candidates.length;
  const rows = candidates.slice(offset, offset + limit);

  return Response.json({ rows, total, cacheReady: true });
}
