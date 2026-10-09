import { test, expect, type Route } from '@playwright/test';

/**
 * Hark's three production fixes, verified against the real server.
 *
 *   1. /profile (no id) redirected to the active Chog's profile, or /pick.
 *   2. /profile/<id> outside 1..1,969 returns a 404, like /chog/<id].
 *   3. GET /api/health returns booleans only, never a value.
 *
 * These are cheap to state and easy to regress: a redirect can silently
 * become a 404, a range guard can be dropped, and a health route that starts
 * echoing an error message becomes a credential leak.
 */

test.describe('fix 1: /profile redirects to the active Chog', () => {
  test('with no session it lands on /pick, not a 404', async ({ page }) => {
    const response = await page.goto('/profile', { waitUntil: 'networkidle' });
    // The redirect is server-side, so the URL is already the destination.
    expect(new URL(page.url()).pathname).toBe('/pick');
    expect(response?.status()).toBeLessThan(400);
  });

  test('the redirect does not loop', async ({ page }) => {
    await page.goto('/profile', { waitUntil: 'networkidle' });
    // A redirect that redirects back to itself is the classic failure here.
    expect(new URL(page.url()).pathname).not.toBe('/profile');
  });
});

test.describe('fix 2: out-of-range profile ids are 404', () => {
  for (const id of ['0', '2000', '99999', 'abc', '1.5', '-3']) {
    test(`/profile/${id} returns 404`, async ({ request }) => {
      const response = await request.get(`/profile/${id}`, { maxRedirects: 0 });
      expect(response.status()).toBe(404);
    });
  }

  test('/profile/1969 and /profile/1 are real pages', async ({ request }) => {
    // The boundaries must NOT be caught by the guard: an off-by-one here would
    // 404 a Chog that exists, which is worse than the bug being fixed.
    for (const id of ['1', '1969']) {
      const response = await request.get(`/profile/${id}`);
      expect(response.status()).toBe(200);
    }
  });

  test('/profile/2000 behaves exactly like /chog/2000', async ({ request }) => {
    // The fix is "the same as /chog/[id]", so both are compared directly.
    const profile = await request.get('/profile/2000');
    const chog = await request.get('/chog/2000');
    expect(profile.status()).toBe(chog.status());
    expect(profile.status()).toBe(404);
  });
});

test.describe('fix 3: /api/health is booleans only', () => {
  test('answers with booleans and no secret material', async ({ request }) => {
    const response = await request.get('/api/health');
    const body = await response.json();

    // The four facts Hark asked for.
    for (const key of ['supabaseOk', 'viewOk', 'rpcOk', 'sessionSecretSet']) {
      expect(typeof body[key], `${key} must be a boolean`).toBe('boolean');
    }

    // Nothing anywhere in the payload may look like a value.
    const serialised = JSON.stringify(body);
    // A Supabase project ref, a URL, a key prefix, or a JWT-shaped blob.
    expect(serialised).not.toMatch(/https?:\/\/[a-z0-9]+\.supabase\./i);
    expect(serialised).not.toMatch(/sb_secret_/);
    expect(serialised).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/);
    // And no raw secret from this machine's own env, in case a change ever
    // starts echoing one.
    for (const name of ['SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SESSION_SECRET']) {
      const value = process.env[name];
      if (value) expect(serialised).not.toContain(value);
    }
  });

  test('is never cached', async ({ request }) => {
    const response = await request.get('/api/health');
    expect(response.headers()['cache-control']).toContain('no-store');
  });

  test('every top-level value is a boolean, a small count, or ok', async ({ request }) => {
    const body = await (await request.get('/api/health')).json();
    for (const [key, value] of Object.entries(body)) {
      const kind = typeof value;
      const allowed = kind === 'boolean' || (kind === 'number' && Number.isInteger(value));
      expect(allowed, `${key} = ${JSON.stringify(value)} is neither boolean nor a count`).toBe(true);
    }
  });
});
