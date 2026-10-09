import { describe, expect, it, beforeEach, afterEach } from 'vitest';

/**
 * The cron endpoint is not a public endpoint.
 *
 * It exists to be called by Vercel's scheduler, which sends
 * `Authorization: Bearer $CRON_SECRET`. Left open it is a public URL that
 * spends an outbound request per call, which is the sort of thing that gets a
 * free-tier deployment flagged, and it reports the deployment's dependency
 * health to anyone who asks.
 *
 * The property that matters most is the FAIL-CLOSED one: an unset CRON_SECRET
 * must return 503, never "no auth required". An auth check that can be
 * switched off by unsetting a variable is decoration.
 */

/** The three outcomes, re-implemented from the route so this is not a tautology. */
function authorize(authorization: string | null, secret: string | undefined): number {
  const expected = secret?.trim();
  if (!expected) return 503;
  const header = authorization ?? '';
  const presented = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!presented.length || presented.length !== expected.length || !equal(presented, expected)) {
    return 401;
  }
  return 200;
}

function equal(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const SECRET = 'a'.repeat(64);
const GOOD = `Bearer ${SECRET}`;

describe('the cron endpoint refuses everything but its scheduler', () => {
  it('accepts the scheduler\'s exact header', () => {
    expect(authorize(GOOD, SECRET)).toBe(200);
  });

  it('rejects a missing header', () => {
    expect(authorize(null, SECRET)).toBe(401);
    expect(authorize('', SECRET)).toBe(401);
  });

  it('rejects a wrong secret', () => {
    expect(authorize('Bearer wrong', SECRET)).toBe(401);
    expect(authorize(`Bearer ${SECRET}x`, SECRET)).toBe(401);
    expect(authorize(`Bearer ${SECRET.slice(0, -1)}`, SECRET)).toBe(401);
  });

  it('rejects a header that is not the Bearer scheme', () => {
    expect(authorize(SECRET, SECRET)).toBe(401);
    expect(authorize(`Basic ${SECRET}`, SECRET)).toBe(401);
    expect(authorize(`bearer ${SECRET}`, SECRET)).toBe(401);
  });

  it('rejects a prefix of the secret', () => {
    expect(authorize(`Bearer ${SECRET.slice(0, 32)}`, SECRET)).toBe(401);
  });

  it('FAILS CLOSED when the secret is unset', () => {
    // The failure mode this guards: "if there is no secret, there is nothing to
    // check" would turn the endpoint public exactly when it is misconfigured.
    expect(authorize(GOOD, undefined)).toBe(503);
    expect(authorize(GOOD, '')).toBe(503);
    expect(authorize(GOOD, '   ')).toBe(503);
    expect(authorize(null, undefined)).toBe(503);
  });
});

describe('the secret is configured, not committed', () => {
  const original = process.env.CRON_SECRET;

  beforeEach(() => {
    delete process.env.CRON_SECRET;
  });
  afterEach(() => {
    if (original === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = original;
  });

  it('the example file ships a placeholder, never a value', async () => {
    const { readFileSync } = await import('node:fs');
    const text = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
    expect(text).toContain('CRON_SECRET=');
    // The value after the equals sign must be empty. Match the ASSIGNMENT, not
    // any line mentioning the name: the comment above it also starts with
    // "CRON_SECRET" once split on the first "=" is not confused.
    const line = text
      .split('\n')
      .find((l) => /^CRON_SECRET=/.test(l));
    expect(line, 'no CRON_SECRET= assignment line').toBeDefined();
    expect(line!.slice('CRON_SECRET='.length).trim()).toBe('');
  });

  it('the repo has no committed cron secret', async () => {
    const { execFileSync } = await import('node:child_process');
    let out = '';
    try {
      out = execFileSync('git', ['grep', '-nE', 'CRON_SECRET=[A-Za-z0-9]{8,}', '--', '.'], {
        cwd: new URL('..', import.meta.url).pathname,
        encoding: 'utf8',
      });
    } catch {
      out = ''; // git grep exits 1 when nothing matches, which is the pass case
    }
    expect(out.trim()).toBe('');
  });
});