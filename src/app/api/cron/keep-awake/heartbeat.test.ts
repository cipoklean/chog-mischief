import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

/**
 * THE KEEP-AWAKE MUST WRITE.
 *
 * This exists because the previous one did not, and nothing said so. The route
 * hit /api/health, which does real reads, and the reads were supposed to be
 * enough. They never happened: the auth gate returns before any query is sent,
 * so while CRON_SECRET was unset the cron fired daily and touched nothing. The
 * deployment looked healthy the whole time. A week later Supabase sent the
 * pause warning.
 *
 * So these tests exercise the REAL route handler rather than re-implementing
 * its logic. The project has been burned more than once by a test that agreed
 * with a hand-written stand-in and disagreed with the code it was describing -
 * the only way to catch "the write never happens" is to call the handler and
 * watch for the write.
 */

// Signature-typed rather than parameter-typed: vitest infers `calls[0]` from
// the mock's signature, so a no-argument mock makes `calls[0][0]` a type error
// while the assertions are perfectly valid. Declaring the shape this way keeps
// the call arguments typed without adding parameters the implementation does
// not read.
type UpsertFn = (
  row: Record<string, unknown>,
  opts?: Record<string, unknown>,
) => Promise<{ error: { message: string } | null }>;

const upsert = vi.fn<UpsertFn>(async () => ({ error: null }));
const from = vi.fn(() => ({ upsert }));

vi.mock('@/lib/db', () => ({
  db: () => ({ from }),
  supabaseConfigured: () => true,
}));

const SECRET = 'b'.repeat(64);

/** A request the way Vercel sends one: a real URL, a Host header, a bearer. */
function cronRequest(opts: { secret?: string | null; source?: string } = {}): Request {
  const url = new URL('https://chog-mischief.vercel.app/api/cron/keep-awake');
  if (opts.source) url.searchParams.set('source', opts.source);

  const headers = new Headers({ host: 'chog-mischief.vercel.app' });
  if (opts.secret !== null && opts.secret !== undefined) {
    headers.set('authorization', `Bearer ${opts.secret}`);
  }
  return new Request(url, { headers });
}

/** Stub the route's outbound call to its own /api/health. */
function stubHealth(body: Record<string, unknown> = { ok: true, supabaseOk: true }): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
}

describe('keep-awake records a heartbeat', () => {
  const original = process.env.CRON_SECRET;

  beforeEach(() => {
    upsert.mockClear();
    from.mockClear();
    process.env.CRON_SECRET = SECRET;
    stubHealth();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    if (original === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = original;
  });

  it('WRITES on an authorized request - the whole point of the route', async () => {
    const { GET } = await import('./route');
    const response = await GET(cronRequest({ secret: SECRET }));

    expect(response.status).toBe(200);
    // The regression this pins: a keep-awake that only reads keeps nothing
    // awake, and reports no error while doing it.
    expect(from).toHaveBeenCalledWith('heartbeat');
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert.mock.calls[0][0]).toMatchObject({ id: 1 });
  });

  it('beats on row 1, so the table stays one row however often it runs', async () => {
    const { GET } = await import('./route');
    await GET(cronRequest({ secret: SECRET }));

    const payload = upsert.mock.calls[0][0] as { id: number; beat_at: string; source: string };
    // A single row is the design: an append-only log would grow forever and
    // "when did we last beat" would become a query instead of a row.
    expect(payload.id).toBe(1);
    expect(typeof payload.beat_at).toBe('string');
    expect(Number.isNaN(Date.parse(payload.beat_at))).toBe(false);
    expect(upsert.mock.calls[0][1]).toMatchObject({ onConflict: 'id' });
  });

  it('records the scheduler it came from', async () => {
    const { GET } = await import('./route');
    await GET(cronRequest({ secret: SECRET, source: 'gh-action' }));

    expect((upsert.mock.calls[0][0] as { source: string }).source).toBe('gh-action');
  });

  it('refuses an unknown source rather than storing it verbatim', async () => {
    const { GET } = await import('./route');
    await GET(cronRequest({ secret: SECRET, source: 'someone-else' }));

    // The column must stay a small closed set, so "what beats this project"
    // remains answerable.
    expect((upsert.mock.calls[0][0] as { source: string }).source).toBe('manual');
  });

  it('defaults to vercel-cron, which is the caller that sends no param', async () => {
    const { GET } = await import('./route');
    await GET(cronRequest({ secret: SECRET }));

    expect((upsert.mock.calls[0][0] as { source: string }).source).toBe('vercel-cron');
  });

  it('does NOT beat before the health check has answered', async () => {
    // The order is the correctness condition, not a detail: the health read is
    // what proves the database answered. Beating first would record a
    // heartbeat while Supabase was unreachable, which is the one thing a
    // heartbeat must never do.
    const order: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        order.push('health');
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }),
    );
    upsert.mockImplementationOnce(async () => {
      order.push('beat');
      return { error: null };
    });

    const { GET } = await import('./route');
    await GET(cronRequest({ secret: SECRET }));

    expect(order).toEqual(['health', 'beat']);
  });

  it('reports beatAt and healthOk, so the caller can tell a write happened', async () => {
    const { GET } = await import('./route');
    const response = await GET(cronRequest({ secret: SECRET }));
    const body = (await response.json()) as Record<string, unknown>;

    expect(body.healthOk).toBe(true);
    expect(typeof body.beatAt).toBe('string');
    expect(body.beatSource).toBe('vercel-cron');
  });

  it('still succeeds when the beat FAILS - reaching the database already counted', async () => {
    // A keep-awake that fails because its own bookkeeping failed is worse than
    // one with no bookkeeping: the request did reach Supabase, which is what
    // keeps the project awake.
    upsert.mockImplementationOnce(async () => ({ error: { message: 'table missing' } }));

    const { GET } = await import('./route');
    const response = await GET(cronRequest({ secret: SECRET }));
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.beatAt).toBeNull();
  });
});

describe('keep-awake still refuses everything but its scheduler', () => {
  const original = process.env.CRON_SECRET;

  beforeEach(() => {
    upsert.mockClear();
    from.mockClear();
    process.env.CRON_SECRET = SECRET;
    stubHealth();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    if (original === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = original;
  });

  it('401s without a header, AND WRITES NOTHING', async () => {
    const { GET } = await import('./route');
    const response = await GET(cronRequest({ secret: null }));

    expect(response.status).toBe(401);
    // The auth check must not be a speed bump that still writes: an
    // unauthenticated caller cannot be allowed to drive the heartbeat, or
    // anyone could keep the project awake (or look awake) at will.
    expect(upsert).not.toHaveBeenCalled();
  });

  it('401s on a wrong secret, AND WRITES NOTHING', async () => {
    const { GET } = await import('./route');
    const response = await GET(cronRequest({ secret: 'c'.repeat(64) }));

    expect(response.status).toBe(401);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('503s and writes nothing when the secret is unset', async () => {
    delete process.env.CRON_SECRET;

    const { GET } = await import('./route');
    const response = await GET(cronRequest({ secret: SECRET }));

    expect(response.status).toBe(503);
    expect(upsert).not.toHaveBeenCalled();
  });
});
