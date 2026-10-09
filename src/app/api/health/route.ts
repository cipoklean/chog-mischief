import { connection } from 'next/server';
import { db, supabaseConfigured } from '@/lib/db';
import { VIEW_COLUMNS } from '@/lib/chaos-view';
import { MONAD_CHAIN_ID, MONAD_RPCS } from '@/lib/chain';

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

export async function GET() {
  // Dynamic on purpose: a health check that answers from a prerender is worse
  // than useless, because it reports the state of the build machine.
  await connection();

  const [supabase, view, rpc] = await Promise.all([
    checkSupabase(),
    checkView(),
    checkRpc(),
  ]);

  const sessionSecretSet = Boolean(process.env.SESSION_SECRET?.trim());
  const walletProjectIdSet = Boolean(process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim());

  // Healthy means every dependency answered. viewOk is included deliberately:
  // a deployment that quietly reads the base tables still works, but it is not
  // the deployment the privacy design assumes, so it must read as unhealthy.
  const healthy = supabase.ok && view.ok && rpc && sessionSecretSet;

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
      chogRowsSampled: supabase.rows,
      chaosRowsSampled: view.rows,
    },
    {
      status: healthy ? 200 : 503,
      headers: { 'cache-control': 'no-store' },
    },
  );
}
