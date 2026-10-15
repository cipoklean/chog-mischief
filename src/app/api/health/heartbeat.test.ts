import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

/**
 * HEALTH MUST REPORT THE HEARTBEAT.
 *
 * Two fields, and the pair is the diagnostic that was missing. When the
 * keep-awake silently stopped touching Supabase, every flag on this endpoint
 * read healthy - because a keep-awake that does not wake anything reports no
 * error. The only symptom was an email from Supabase a week later.
 *
 *   heartbeatTable - the table exists, so its migration has been run
 *   lastBeatAt     - when the cron last WROTE, or null if it never has
 *
 * `lastBeatAt` is deliberately NOT part of `ok`: this cron reads /api/health and
 * only then writes its beat, so the body it reads always carries the previous
 * beat. Folding staleness into `ok` would fail the workflow on the first run
 * after any gap, at the exact moment it was fixing the problem.
 */

const HEARTBEAT_AT = '2026-10-15T06:00:00.000Z';

let heartbeatResult: { data: unknown; error: unknown } = {
  data: { beat_at: HEARTBEAT_AT },
  error: null,
};

/** A chainable stand-in for the PostgREST builder, resolved as a promise. */
function chain(result: { data: unknown; error: unknown }) {
  // `order` is in here because checkView calls it: without it the read throws,
  // viewOk is false, and every assertion about `ok` in this file would pass for
  // the wrong reason - which is exactly what happened on the first run.
  const builder: Record<string, unknown> = {
    select: () => builder,
    limit: () => builder,
    eq: () => builder,
    order: () => builder,
    maybeSingle: async () => result,
    then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  return builder;
}

const from = vi.fn((table: string) => {
  if (table === 'heartbeat') return chain(heartbeatResult);
  if (table === 'chogs') return chain({ data: [{ id: 1 }], error: null });
  if (table === 'recent_chaos') return chain({ data: [], error: null });
  return chain({ data: [], error: null });
});

vi.mock('@/lib/db', () => ({
  db: () => ({ from }),
  supabaseConfigured: () => true,
}));

vi.mock('@/lib/fairness-store', () => ({
  assertCommitment: async () => ({ ok: true, stored: true }),
}));

vi.mock('next/server', () => ({ connection: async () => undefined }));

async function health(): Promise<Record<string, unknown>> {
  vi.stubGlobal(
    'fetch',
    // checkRpc compares against chainId 143 read back as hex: 0x8f. A generic
    // 200 would leave rpcOk false and quietly poison every `ok` assertion here.
    vi.fn(async () => new Response(JSON.stringify({ result: '0x8f' }), { status: 200 })),
  );
  const { GET } = await import('./route');
  const response = await GET();
  return (await response.json()) as Record<string, unknown>;
}

describe('/api/health reports the heartbeat', () => {
  beforeEach(() => {
    from.mockClear();
    process.env.SESSION_SECRET = 'test-secret';
    process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID = 'test-project';
    heartbeatResult = { data: { beat_at: HEARTBEAT_AT }, error: null };
  });
  afterEach(() => vi.unstubAllGlobals());

  it('the healthy baseline is ACTUALLY healthy, or nothing here means anything', async () => {
    // Guard against the false pass this file shipped with on its first run:
    // viewOk and rpcOk were both false, so `ok` was false whatever the
    // heartbeat did, and "a missing table makes it unhealthy" passed without
    // proving anything. Every other assertion about `ok` depends on this.
    const body = await health();

    expect(body.viewOk).toBe(true);
    expect(body.rpcOk).toBe(true);
    expect(body.ok).toBe(true);
  });

  it('reports heartbeatTable true and the timestamp when it has beaten', async () => {
    const body = await health();

    expect(body.heartbeatTable).toBe(true);
    expect(body.lastBeatAt).toBe(HEARTBEAT_AT);
  });

  it('reports lastBeatAt null when the table exists but was never written', async () => {
    // The exact state that precedes a Supabase pause: the migration is run, the
    // table is there, and nothing has ever beaten. Without this field that state
    // is invisible.
    heartbeatResult = { data: null, error: null };

    const body = await health();

    expect(body.heartbeatTable).toBe(true);
    expect(body.lastBeatAt).toBeNull();
  });

  it('reports heartbeatTable false when the migration has not been run', async () => {
    heartbeatResult = { data: null, error: { code: '42P01', message: 'relation does not exist' } };

    const body = await health();

    expect(body.heartbeatTable).toBe(false);
    expect(body.lastBeatAt).toBeNull();
  });

  it('a missing heartbeat table makes the deployment UNHEALTHY', async () => {
    // Part of `ok`, like noncesScoped and commitsTable, because its absence is
    // not cosmetic: no heartbeat means the project pauses mid-judging. This is
    // also what makes the keep-awake workflow fail loudly.
    heartbeatResult = { data: null, error: { code: '42P01', message: 'relation does not exist' } };

    const body = await health();

    expect(body.ok).toBe(false);
  });

  it('a STALE beat does not make it unhealthy', async () => {
    // Staleness must not fail the gate, because the cron reads this endpoint
    // before it writes its own beat: judging staleness here would fail the run
    // that was about to fix it.
    heartbeatResult = { data: { beat_at: '2026-01-01T00:00:00.000Z' }, error: null };

    const body = await health();

    expect(body.ok).toBe(true);
    expect(body.lastBeatAt).toBe('2026-01-01T00:00:00.000Z');
  });
});
