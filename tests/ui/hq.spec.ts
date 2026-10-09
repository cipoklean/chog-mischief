import { test, expect, type Page, type Route } from '@playwright/test';

/**
 * /hq - the signed-in home base.
 *
 * Mocked the same way as the prank flow: GET /api/hq is intercepted, because
 * the real thing needs a session cookie signed by a real SIWE sign-in. The
 * page's job is to render the dashboard correctly from whatever the API
 * returns, and that is exactly what these tests drive.
 */

const HQ_BODY = {
  authenticated: true,
  address: '0x1111111111111111111111111111111111111111',
  today: '2026-10-09',
  chogs: [
    {
      tokenId: 70,
      name: 'CHOG #70',
      imageUrl: null,
      traits: { Tier: 'Epic', Head: 'Crown', Accessory: 'Fwog', Aura: 'White Aura' },
    },
  ],
  stats: [
    {
      tokenId: 70,
      points: 1240,
      prankedToday: false,
      streak: { currentStreak: 3, longestStreak: 5 },
      badges: ['first_blood'],
      overlays: [],
    },
  ],
  recentOutgoing: [
    {
      id: 'r1',
      fromTokenId: 70,
      fromName: 'CHOG #70',
      toTokenId: 3,
      toName: 'CHOG #3',
      prankId: 'crown-of-the-chog',
      landed: true,
      points: 30,
      revenge: false,
      createdAt: new Date(Date.now() - 3600_000).toISOString(),
    },
  ],
  recentIncoming: [
    {
      id: 'r2',
      fromTokenId: 561,
      fromName: 'CHOG #561',
      toTokenId: 70,
      toName: 'CHOG #70',
      prankId: 'bonk',
      landed: true,
      points: 0,
      revenge: false,
      createdAt: new Date(Date.now() - 7200_000).toISOString(),
    },
  ],
};

async function mockHq(page: Page, body: unknown): Promise<void> {
  await page.route('**/api/hq', (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    }),
  );
}

test.describe('the HQ', () => {
  test('renders the active Chog, its totals and the prank CTA', async ({ page }) => {
    await mockHq(page, HQ_BODY);
    await page.goto('/hq', { waitUntil: 'networkidle' });

    await expect(page.getByText('CHOG #70').first()).toBeVisible();
    await expect(page.getByText('1,240').first()).toBeVisible();
    await expect(page.getByText('first blood').first()).toBeVisible();

    // The primary action into the prank flow (Hark's #3 entry point).
    await expect(page.getByRole('link', { name: /Prank someone/ }).first()).toBeVisible();
  });

  test('shows the daily prank as spent, with the countdown', async ({ page }) => {
    await mockHq(page, {
      ...HQ_BODY,
      stats: [{ ...HQ_BODY.stats[0], prankedToday: true }],
    });
    await page.goto('/hq', { waitUntil: 'networkidle' });

    await expect(page.getByText(/Today.s prank is spent/)).toBeVisible();
    // The countdown reserves its space then fills in after mount.
    await expect(page.locator('.x-cd').first()).toHaveText(/^\d{2}:\d{2}:\d{2}$/);
  });

  test('lists the recent history in both directions', async ({ page }) => {
    await mockHq(page, HQ_BODY);
    await page.goto('/hq', { waitUntil: 'networkidle' });

    await expect(page.getByText(/CHOG #561 pranked you with/)).toBeVisible();
    await expect(page.getByText(/Crown Of The Chog on CHOG #3/)).toBeVisible();
  });

  test('shows an empty state before the first prank', async ({ page }) => {
    await mockHq(page, {
      ...HQ_BODY,
      recentOutgoing: [],
      recentIncoming: [],
      stats: [{ ...HQ_BODY.stats[0], points: 0, streak: { currentStreak: 0, longestStreak: 0 }, badges: [] }],
    });
    await page.goto('/hq', { waitUntil: 'networkidle' });

    await expect(page.getByText(/No pranks yet/)).toBeVisible();
  });

  test('gates on the wallet when there is no session', async ({ page }) => {
    await mockHq(page, { authenticated: false });
    await page.goto('/hq', { waitUntil: 'networkidle' });

    await expect(page.getByRole('heading', { name: 'Your HQ needs a Chog' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Play as a guest instead' })).toBeVisible();
  });

  test('the ammo pill and the one-row header hold at tablet', async ({ page }) => {
    await mockHq(page, HQ_BODY);
    await page.setViewportSize({ width: 900, height: 900 });
    await page.goto('/hq', { waitUntil: 'networkidle' });

    // Hark's verdicts: the ammo pill shows at 768+, and the header is one row.
    await expect(page.locator('.x-top__ammo')).toBeVisible();
    const height = await page.evaluate(() => {
      const top = document.querySelector('.x-top');
      return top ? top.getBoundingClientRect().height : 0;
    });
    expect(height).toBeLessThan(100);
  });
});
