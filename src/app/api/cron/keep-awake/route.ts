import { db } from '@/lib/db';

/**
 * Vercel cron: one request a day to /api/health.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * A Supabase free-tier project is paused after a period of inactivity, and a
 * paused project refuses queries. The existing verifiers clean up after
 * themselves, so the project genuinely can go quiet for weeks - and then the
 * first real player to sign in gets a failed ownership check.
 *
 * A daily request that WRITES is what keeps it awake. This route used to rely on
 * the reads inside /api/health, and that failed silently: the auth gate above
 * returns before any query is sent, so while the secret was unset the cron fired
 * daily and touched nothing at all. It now upserts a heartbeat row and reports
 * when it last did. Needs no money: Hobby allows daily crons, and neither the
 * request nor the row costs anything.
 *
 * ── Why /api/health and not a trivial endpoint ──────────────────────────────
 * The cron must actually touch Supabase, or it keeps nothing awake. /api/health
 * runs a real `select` against `chogs` and a real read of the `recent_chaos`
 * view, so the request that wakes the project is also the request that would
 * notice the project is misconfigured. A ping to `/` would wake the database
 * and check nothing at all.
 *
 * ── Timing ─────────────────────────────────────────────────────────────────
 * `0 6 * * *` - once a day at 06:00 UTC. Cron frequency is capped by plan, not
 * by CPU, so once a day is free on Hobby. It is deliberately not hourly: an
 * hourly cron is the usual reason a free project gets paused in the first place,
 * and 24 hours of quiet is comfortably inside Supabase's inactivity window.
 *
 * If Supabase's window is ever shortened, this becomes `0 * * * *` and nothing
 * else has to change.
 */

/** The only sources we will record, so a query param cannot put arbitrary text
 * in the table. The value is authenticated, but an allowlist keeps the column
 * meaningful - "what beats this project and what does it mean" stays answerable. */
const BEAT_SOURCES = ['vercel-cron', 'gh-action', 'manual'] as const;

/**
 * Which scheduler called: `?source=...`, allowlisted.
 *
 * Defaults to 'vercel-cron' because that is the caller that sends no param, and
 * a beat from an unknown source is recorded as 'manual' rather than stored
 * verbatim - the column should stay a small closed set.
 */
function beatSource(request: Request): string {
  const raw = new URL(request.url).searchParams.get('source')?.trim().toLowerCase();
  if (!raw) return 'vercel-cron';
  return (BEAT_SOURCES as readonly string[]).includes(raw) ? raw : 'manual';
}

/**
 * Write the heartbeat: one row, always row 1, always now().
 *
 * This is the reason the keep-awake works at all. Reads were supposed to be
 * enough, but the auth gate returns before any query is sent, so a
 * misconfigured secret produces a route that fires daily and touches nothing -
 * which looks identical to being switched off. A write cannot be mistaken for
 * no-op, and recording `beat_at` in a readable place turns the next silent
 * failure into something /api/health can show.
 *
 * Never throws. A keep-awake that fails because its own bookkeeping failed is
 * worse than one with no bookkeeping: the point is to reach the database, and
 * reaching it already counted.
 */
async function beat(source: string): Promise<{ ok: boolean; beatAt: string | null }> {
  try {
    const { error } = await db()
      .from('heartbeat')
      .upsert({ id: 1, beat_at: new Date().toISOString(), source }, { onConflict: 'id' });

    if (error) {
      console.error('[cron] heartbeat write failed:', error.message);
      return { ok: false, beatAt: null };
    }
    return { ok: true, beatAt: new Date().toISOString() };
  } catch (error) {
    console.error('[cron] heartbeat write threw:', error);
    return { ok: false, beatAt: null };
  }
}

async function verifyAndWarm(request: Request): Promise<Response> {
  // The deployment's own origin, from the request Vercel sends, so a preview
  // deploy pings itself rather than production. VERCEL_URL is the preview host
  // on preview deployments and the production host on production ones.
  const forwardedHost = request.headers.get('host');
  const base =
    process.env.CRON_TARGET_URL?.trim() ||
    (forwardedHost ? `https://${forwardedHost}` : process.env.VERCEL_URL);

  if (!base || base.includes('undefined')) {
    console.error('[cron] no target URL: set VERCEL_URL or CRON_TARGET_URL');
    return Response.json({ ok: false, reason: 'no target url' }, { status: 503 });
  }

  const started = Date.now();
  try {
    const response = await fetch(`${base.replace(/\/$/, '')}/api/health`, {
      // Never let a cold start eat the whole cron window.
      signal: AbortSignal.timeout(60_000),
      headers: { 'user-agent': 'chog-mischief-cron' },
      cache: 'no-store',
    });

    const body = (await response.json()) as Record<string, unknown>;
    const ok = response.ok && body.ok === true;

    // Only AFTER the health check. The order matters: the health read is what
    // proves the database answered, so a beat is only recorded on a request
    // that genuinely reached it. Beating first would record a heartbeat even
    // when Supabase was unreachable, which is the one thing a heartbeat must
    // never do.
    const source = beatSource(request);
    const beatResult = await beat(source);

    console.log(
      `[cron] ${new Date().toISOString()} ${base}/api/health -> ${response.status} ` +
        `ok=${String(body.ok)} supabase=${String(body.supabaseOk)} view=${String(body.viewOk)} ` +
        `rpc=${String(body.rpcOk)} beat=${String(beatResult.ok)} source=${source} ` +
        `in ${Date.now() - started}ms`,
    );

    if (!ok) {
      // Reported in the response rather than thrown. A thrown error surfaces as
      // a failed deployment notification every single day, and the body already
      // says which dependency is unhappy - which is the actionable part.
      console.warn('[cron] a dependency is unhealthy; see the flags above');
    }
    return Response.json({
      ok,
      healthOk: body.ok === true,
      beatAt: beatResult.beatAt,
      beatSource: source,
      ...body,
    });
  } catch (error) {
    console.error('[cron] health request failed:', error);
    return Response.json({ ok: false, reason: String(error) }, { status: 502 });
  }
}

/**
 * GET /api/cron/keep-awake
 *
 * Exported as a route handler rather than a bare function: a Vercel cron is an
 * HTTP request, and Next's type checker rejects a default export that is not a
 * route handler - it caught this at build time.
 */
export async function GET(request: Request): Promise<Response> {
  // ── AUTH ──────────────────────────────────────────────────────────────────
  // This route exists only to be called by Vercel's scheduler, which sends
  // `Authorization: Bearer $CRON_SECRET`. Without the check it is a public
  // endpoint that spends an outbound request on every call, which is exactly
  // the kind of thing that gets a free-tier deployment flagged.
  //
  // Comparison is length-checked and constant-time-ish rather than `===` on
  // the whole header: an attacker who can time the comparison learns the secret
  // a byte at a time. It is not a substitute for keeping the secret out of the
  // repo, which it is.
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected) {
    // Fail closed. An unset secret must not mean "no auth required", which is
    // the failure mode that makes an auth check theatre.
    console.error('[cron] CRON_SECRET is not set - refusing the request');
    return Response.json({ error: 'cron auth not configured' }, { status: 503 });
  }

  const header = request.headers.get('authorization') ?? '';
  const presented = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!presented.length || presented.length !== expected.length || !timingSafeEqualStr(presented, expected)) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  return verifyAndWarm(request);
}

/** Content-constant comparison for two equal-length strings. */
function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
