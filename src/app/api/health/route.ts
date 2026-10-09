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

  const [supabase, view, rpc, noncesScoped, commitsTable, fairness] = await Promise.all([
    checkSupabase(),
    checkView(),
    checkRpc(),
    checkNonceScope(),
    checkCommitsTable(),
    checkFairnessState(),
  ]);

  const sessionSecretSet = Boolean(process.env.SESSION_SECRET?.trim());
  const walletProjectIdSet = Boolean(process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim());

  // Healthy means every dependency answered AND the schema matches what the
  // code expects.
  //
  // `noncesScoped` and `commitsTable` are part of `ok` because their absence is
  // not cosmetic. A missing nonce column makes /prepare return 500 for every
  // player, so reporting "healthy" while it is true would be a lie that delays
  // the fix by exactly as long as nobody checks a player's error.
  const healthy = supabase.ok && view.ok && rpc && sessionSecretSet && noncesScoped && commitsTable;

  if (!noncesScoped || !commitsTable) {
    console.error(
      `[health] schema out of date: noncesScoped=${noncesScoped} commitsTable=${commitsTable}. ` +
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
       * Why the commitment store is not durable, when it is not. A string, not a
       * value: 'table-missing' means a migration has not been run,
       * 'read-failed' means the table is there and could not be read.
       */
      fairnessDegraded: fairness?.degraded ?? 'read-failed',
      chogRowsSampled: supabase.rows,
      chaosRowsSampled: view.rows,
    },
    {
      status: healthy ? 200 : 503,
      headers: { 'cache-control': 'no-store' },
    },
  );
}
