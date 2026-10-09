/**
 * Vercel cron: one request a day to /api/health.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * A Supabase free-tier project is paused after a period of inactivity, and a
 * paused project refuses queries. The existing verifiers clean up after
 * themselves, so the project genuinely can go quiet for weeks - and then the
 * first real player to sign in gets a failed ownership check.
 *
 * One authenticated read a day is enough to keep it awake, and this needs no
 * money: Hobby allows daily crons, and the request touches no paid resource.
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

    console.log(
      `[cron] ${new Date().toISOString()} ${base}/api/health -> ${response.status} ` +
        `ok=${String(body.ok)} supabase=${String(body.supabaseOk)} view=${String(body.viewOk)} ` +
        `rpc=${String(body.rpcOk)} in ${Date.now() - started}ms`,
    );

    if (!ok) {
      // Reported in the response rather than thrown. A thrown error surfaces as
      // a failed deployment notification every single day, and the body already
      // says which dependency is unhappy - which is the actionable part.
      console.warn('[cron] a dependency is unhealthy; see the flags above');
    }
    return Response.json({ ok, ...body });
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
  return verifyAndWarm(request);
}
