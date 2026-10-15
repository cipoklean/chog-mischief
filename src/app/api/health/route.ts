import { connection } from 'next/server';
import { db, supabaseConfigured } from '@/lib/db';
import { VIEW_COLUMNS } from '@/lib/chaos-view';
import { MONAD_CHAIN_ID, MONAD_RPCS } from '@/lib/chain';
import { assertCommitment } from '@/lib/fairness-store';
import { dayFor } from '@/game/rules';

/**
 * GET /api/health - is the deployment actually wired up?
 *
 * ── The rule ─────────────────────────────────────────────────────────────────
 * BOOLEANS ONLY. Never a URL, never a key, never a fragment of one, never the
 * view's column list, never an error message that could echo a value back.
 *
 * A health endpoint is unauthenticated by definition, so anything it returns
 * is public. `SUPABASE_SECRET_KEY` starts with `sb_secret_`, so returning "the
 * key is set" as `true` leaks nothing, but returning the key, or an error
 * string containing it, would hand the whole database to anyone who curls
 * this route. The failures that matter are all observable as booleans:
 *
 *   supabaseOk   - the URL and key are both present AND a real query answered
 *   viewOk       - the recent_chaos view answered (it is NOT falling back)
 *   rpcOk        - the public Monad RPC answered, so token reads can work
 *   sessionSecretSet - a session can be signed and verified at all
 *
 * Two more, added because of a deploy-order hazard rather than a bug:
 *
 *   noncesScoped  - nonces has from_token_id and day. /api/prank/prepare writes
 *                   and filters on both, so a deployment that lands before its
 *                   migration 500s on every prepare. This reports the column
 *                   state instead of letting a player discover it.
 *   commitsTable  - daily_commits exists. Its absence degrades /api/fairness to
 *                   a derived hash rather than breaking anything, so it would
 *                   otherwise be silent.
 *
 * Both are booleans about schema shape, never values.
 *
 * ── Why /api/chaos answered empty in production ─────────────────────────────
 * It was not a broken feed. `pranks` had zero rows, so the view correctly
 * returned zero rows, and the bot padding took over as designed. This route
 * exists so that distinction is checkable in one curl instead of by reading
 * logs: `viewOk: true` with `chaosRows: 0` means "wired correctly, no prank has
 * happened yet", while `viewOk: false` means "silently reading the base tables".
 */

/** Row counts are a boolean-shaped fact about wiring, never a value leak. */
async function checkSupabase(): Promise<{ ok: boolean; rows: number }> {
  if (!supabaseConfigured()) return { ok: false, rows: 0 };
  try {
    const { data, error } = await db()
      .from('chogs')
      .select('token_id')
      .limit(1);
    if (error) return { ok: false, rows: 0 };
    return { ok: true, rows: data?.length ?? 0 };
  } catch {
    return { ok: false, rows: 0 };
  }
}

async function checkView(): Promise<{ ok: boolean; rows: number }> {
  if (!supabaseConfigured()) return { ok: false, rows: 0 };
  try {
    // The same projection the feed uses, so this answers "would /api/chaos be
    // reading the view" rather than a different question.
    const { data, error } = await db()
      .from('recent_chaos')
      .select(VIEW_COLUMNS)
      .order('created_at', { ascending: false })
      .limit(1);
    if (error) return { ok: false, rows: 0 };
    return { ok: true, rows: data?.length ?? 0 };
  } catch {
    return { ok: false, rows: 0 };
  }
}

/**
 * Any of the app's own Monad endpoints answers chainId 143.
 *
 * It walks the SAME MONAD_RPCS list the app uses, not a hardcoded URL, so
 * "rpcOk" means "token reads can work" rather than "one host I named happens
 * to be up". Monad is chain 143 = 0x8f; the value is checked, never returned.
 */
async function checkRpc(): Promise<boolean> {
  for (const url of MONAD_RPCS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_chainId',
          params: [],
        }),
        signal: AbortSignal.timeout(4000),
        cache: 'no-store',
      });
      if (!res.ok) continue;
      const body = (await res.json()) as { result?: string };
      if (body.result === `0x${MONAD_CHAIN_ID.toString(16)}`) return true;
    } catch {
      // Try the next endpoint: the list is a fallback list on purpose.
    }
  }
  return false;
}

/**
 * Does `nonces` carry the two scoping columns?
 *
 * Reported rather than assumed because of a deploy-order hazard: /prepare
 * selects and inserts `from_token_id` and `day`, so a deployment that lands
 * before its migration returns 500 on every prepare. A health check that says
 * nothing about schema lets that present as "the game is down".
 *
 * Probed by SELECTING the columns: if they are absent PostgREST answers 42703,
 * which is the signal. Nothing is written.
 */
async function checkNonceScope(): Promise<boolean> {
  if (!supabaseConfigured()) return false;
  try {
    const { error } = await db()
      .from('nonces')
      .select('nonce, from_token_id, day')
      .limit(1);
    return !error;
  } catch {
    return false;
  }
}

/** Does `daily_commits` exist? Same probe, single column. */
async function checkCommitsTable(): Promise<boolean> {
  if (!supabaseConfigured()) return false;
  try {
    const { error } = await db()
      .from('daily_commits')
      .select('day, commit_hash')
      .limit(1);
    return !error;
  } catch {
    return false;
  }
}

/**
 * Does `heartbeat` exist, and when was it last beaten?
 *
 * Two fields, because the pair is what makes a silent keep-awake failure
 * visible. This is the check that would have caught the real problem: the cron
 * was scheduled, ran daily, and returned before it touched Supabase at all,
 * because the auth gate bails before any query. Nothing was unhealthy, so
 * nothing reported unhealthy - and a week later Supabase sent the pause warning.
 *
 *   heartbeatTable  - the table exists, so the migration has been run
 *   lastBeatAt      - when the cron last WROTE. Null means it has never written,
 *                     which is the state that precedes a pause.
 *
 * `lastBeatAt` is an ISO timestamp, not a value: the only fact it carries is
 * "this project was alive at 06:00 today". Deliberately reported, unlike the
 * things this route refuses to return, because a stale timestamp IS the alarm.
 */
async function checkHeartbeat(): Promise<{ table: boolean; lastBeatAt: string | null }> {
  if (!supabaseConfigured()) return { table: false, lastBeatAt: null };
  try {
    const { data, error } = await db()
      .from('heartbeat')
      .select('beat_at')
      .eq('id', 1)
      .maybeSingle();

    if (error) return { table: false, lastBeatAt: null };
    const beatAt = (data as { beat_at?: string } | null)?.beat_at ?? null;
    return { table: true, lastBeatAt: beatAt };
  } catch {
    return { table: false, lastBeatAt: null };
  }
}

/**
 * Is today's commitment durable, and if not, why.
 *
 * `assertCommitment` deliberately fails OPEN when the store is unreadable, so
 * nothing here can report unhealthy on that account - the game keeps running.
 * This surfaces the degradation instead of leaving it invisible in a log line.
 */
async function checkFairnessState(): Promise<{
  durable: boolean;
  degraded?: 'table-missing' | 'read-failed' | 'not-yet-written';
}> {
  const secret = process.env.SESSION_SECRET;
  const day = dayFor(Date.now());
  if (!secret) return { durable: false, degraded: 'read-failed' };
  try {
    const check = await assertCommitment(secret, day);
    return { durable: !check.degraded, degraded: check.degraded };
  } catch {
    return { durable: false, degraded: 'read-failed' };
  }
}

export async function GET() {
  // Dynamic on purpose: a health check that answers from a prerender is worse
  // than useless, because it reports the state of the build machine.
  await connection();

  const [supabase, view, rpc, noncesScoped, commitsTable, fairness, heartbeat] =
    await Promise.all([
      checkSupabase(),
      checkView(),
      checkRpc(),
      checkNonceScope(),
      checkCommitsTable(),
      checkFairnessState(),
      checkHeartbeat(),
    ]);

  const sessionSecretSet = Boolean(process.env.SESSION_SECRET?.trim());
  const walletProjectIdSet = Boolean(process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim());

  // Healthy means every dependency answered AND the schema matches what the
  // code expects.
  //
  // `noncesScoped`, `commitsTable` and `heartbeatTable` are part of `ok` because
  // their absence is not cosmetic. A missing nonce column makes /prepare return
  // 500 for every player, so reporting "healthy" while it is true would be a lie
  // that delays the fix by exactly as long as nobody checks a player's error. A
  // missing heartbeat table means the keep-awake writes nothing, which ends with
  // the project paused mid-judging - the loudest possible failure to be quiet
  // about.
  //
  // `lastBeatAt` is deliberately NOT part of `ok`, and the reason is an ordering
  // trap: this cron reads /api/health and only THEN writes its beat, so the body
  // it reads always carries the PREVIOUS beat. Folding staleness into `ok` would
  // make the first run after any gap report unhealthy and fail the workflow at
  // the exact moment it was fixing the problem. The timestamp is reported so the
  // age is visible; judging it is the reader's job.
  const healthy =
    supabase.ok && view.ok && rpc && sessionSecretSet && noncesScoped && commitsTable && heartbeat.table;

  if (!noncesScoped || !commitsTable || !heartbeat.table) {
    console.error(
      `[health] schema out of date: noncesScoped=${noncesScoped} commitsTable=${commitsTable} ` +
        `heartbeatTable=${heartbeat.table}. ` +
        'Run the migrations in supabase/migrations/ in the Supabase SQL editor.',
    );
  }

  return Response.json(
    {
      ok: healthy,
      supabaseOk: supabase.ok,
      viewOk: view.ok,
      rpcOk: rpc,
      sessionSecretSet,
      walletProjectIdSet,
      // Counts, not content: "the view answered and it is empty" is the fact
      // that distinguishes "no pranks yet" from "not wired".
      noncesScoped,
      commitsTable,
      /**
       * Why the commitment store is not durable, when it is not. `null` when it
       * IS durable, which is the normal case.
       *
       * The `?? 'read-failed'` default that used to be here was wrong in a way
       * only production could show: `checkFairnessState` returns
       * `{ durable: true, degraded: undefined }` on the healthy path, so the
       * default fired and a perfectly healthy deployment reported
       * `read-failed`. A diagnostic that cries wolf on the good case is worse
       * than no diagnostic, because it trains you to ignore it.
       */
      fairnessDegraded: fairness?.degraded ?? null,

      /** The heartbeat table exists (its migration has been run). */
      heartbeatTable: heartbeat.table,

      /**
       * When the keep-awake cron last WROTE to Supabase, or null if it never
       * has. Null with `heartbeatTable: true` means the cron is not reaching the
       * database - which is the failure that let the project go quiet for a week
       * while every flag here read healthy.
       */
      lastBeatAt: heartbeat.lastBeatAt,
      chogRowsSampled: supabase.rows,
      chaosRowsSampled: view.rows,
    },
    {
      status: healthy ? 200 : 503,
      headers: { 'cache-control': 'no-store' },
    },
  );
}
