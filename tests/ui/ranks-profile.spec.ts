import { test, expect, type Page, type Route } from '@playwright/test';

/**
 * /ranks and /profile - the two screens Hark flagged as missing.
 *
 * Both read their data from /api, so they are driven here with mocked routes
 * the same way /hq and /inbox are. Playwright at the phone viewport (the
 * config default) and again at 1440 for the desktop treatment.
 */

const RANKS_BODY = {
  myTokenIds: [70],
  weekly: {
    chaotic: [
      { tokenId: 561, name: 'CHOG #561', imageUrl: null, points: 240, pranks: 8, mine: false },
      { tokenId: 70, name: 'CHOG #70', imageUrl: null, points: 120, pranks: 4, mine: true },
    ],
    bullied: [{ tokenId: 3, name: 'CHOG #3', imageUrl: null, points: 0, pranks: 5, mine: false }],
    dodger: [{ tokenId: 9, name: 'CHOG #9', imageUrl: null, points: 0, pranks: 3, mine: false }],
  },
  allTime: [
    { tokenId: 561, name: 'CHOG #561', imageUrl: null, points: 900, pranks: 30, mine: false },
    { tokenId: 70, name: 'CHOG #70', imageUrl: null, points: 300, pranks: 10, mine: true },
  ],
  rivalries: [
    { opponentTokenId: 561, opponentName: 'CHOG #561', mine: 4, theirs: 2, myTokenId: 70 },
  ],
};

const HQ_BODY = {
  authenticated: true,
  address: '0x1111111111111111111111111111111111111111',
  today: '2026-10-09',
  chogs: [
    {
      tokenId: 70,
      name: 'CHOG #70',
      imageUrl: null,
      traits: { Tier: 'Epic', Head: 'Crown', Mouth: 'Clown Mouth' },
    },
  ],
  stats: [
    {
      tokenId: 70,
      points: 1240,
      prankedToday: false,
      streak: { currentStreak: 3, longestStreak: 5 },
      badges: ['first_blood'],
      overlays: [{ prankId: 'row-abc', caption: 'slimed' }],
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

async function mockAll(page: Page): Promise<void> {
  await page.route('**/api/ranks', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(RANKS_BODY) }),
  );
  await page.route('**/api/hq', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(HQ_BODY) }),
  );
  // The single-row Chog lookup, with traits (the profile derives powers from them).
  await page.route('**/api/chogs**', (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        rows: [
          {
            tokenId: 70,
            name: 'CHOG #70',
            imageUrl: null,
            traits: { Tier: 'Epic', Head: 'Crown', Mouth: 'Clown Mouth' },
          },
        ],
        total: 1,
        cacheReady: true,
      }),
    }),
  );
}

test.describe('/ranks', () => {
  test('shows the weekly boards with my Chog highlighted', async ({ page }) => {
    await mockAll(page);
    await page.goto('/ranks', { waitUntil: 'networkidle' });

    await expect(page.getByRole('heading', { name: 'Most chaotic' })).toBeVisible();
    await expect(page.getByText('CHOG #561').first()).toBeVisible();
    // My Chog is highlighted (yellow), not just listed.
    const myRow = page.locator('.x-rail__row', { hasText: 'CHOG #70' }).first();
    await expect(myRow).toBeVisible();
    const bg = await myRow.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg).not.toBe('rgba(0, 0, 0, 0)');
  });

  test('switches to all-time and rivalries', async ({ page }) => {
    await mockAll(page);
    await page.goto('/ranks', { waitUntil: 'networkidle' });

    await page.getByRole('button', { name: 'All-time' }).click();
    await expect(page.getByRole('heading', { name: 'All-time points' })).toBeVisible();

    await page.getByRole('button', { name: 'Rivalries' }).click();
    await expect(page.getByRole('heading', { name: 'Rivalries' })).toBeVisible();
    await expect(page.getByText('CHOG #561').first()).toBeVisible();
  });

  test('pins an Unranked row for a Chog with no rank', async ({ page }) => {
    await mockAll(page);
    await page.route('**/api/ranks', (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          myTokenIds: [70],
          weekly: { chaotic: [], bullied: [], dodger: [] },
          allTime: [],
          rivalries: [],
        }),
      }),
    );
    await page.goto('/ranks', { waitUntil: 'networkidle' });

    await expect(page.getByText(/Unranked/)).toBeVisible();
  });
});

test.describe('/profile', () => {
  test('shows the record, grudges and history for a held Chog', async ({ page }) => {
    await mockAll(page);
    await page.goto('/profile/70', { waitUntil: 'networkidle' });

    await expect(page.getByText('CHOG #70').first()).toBeVisible();
    await expect(page.getByText('1,240').first()).toBeVisible();
    await expect(page.getByText('first blood').first()).toBeVisible();
    // The overlay on the art, with a clean link.
    await expect(page.getByText('slimed')).toBeVisible();
    // Grudges: who hit this Chog, with revenge available.
    await expect(page.getByText(/CHOG #561 hit CHOG #70/)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Get revenge' }).first()).toBeVisible();
  });

  test('renders the public view when the Chog is not held', async ({ page }) => {
    await mockAll(page);
    await page.route('**/api/hq', (route: Route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ authenticated: false }) }),
    );
    await page.goto('/profile/70', { waitUntil: 'networkidle' });

    await expect(page.getByRole('heading', { name: 'Own CHOG #70?' })).toBeVisible();
  });

  test('refuses an id outside the collection', async ({ page }) => {
    await mockAll(page);
    await page.goto('/profile/99999', { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: 'No such Chog' })).toBeVisible();
  });
});

test.describe('the new screens hold at desktop', () => {
  test('no horizontal overflow on /ranks and /profile at 1440', async ({ page }) => {
    await mockAll(page);
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.goto('/ranks', { waitUntil: 'networkidle' });
    let overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    await page.goto('/profile/70', { waitUntil: 'networkidle' });
    overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
