import { test, expect, type Page, type Route } from '@playwright/test';

/**
 * /inbox - the revenge and clean queues.
 *
 * Mocked the same way as /hq: GET /api/hq is intercepted, because the real
 * thing needs a real SIWE session. The clean signing step is exercised with
 * the e2e seam and mocked /api/clean/* routes, so the whole inbox - both
 * queues and the signature flow - runs in a headless browser with no wallet.
 */

const HQ_BODY = {
  authenticated: true,
  address: '0x1111111111111111111111111111111111111111',
  today: '2026-10-09',
  chogs: [{ tokenId: 70, name: 'CHOG #70', imageUrl: null, traits: { Tier: 'Epic' } }],
  stats: [
    {
      tokenId: 70,
      points: 900,
      prankedToday: false,
      streak: { currentStreak: 2, longestStreak: 4 },
      badges: [],
      overlays: [{ prankId: 'row-abc', caption: 'slimed' }],
    },
  ],
  recentOutgoing: [],
  recentIncoming: [
    {
      id: 'r1',
      fromTokenId: 561,
      fromName: 'CHOG #561',
      toTokenId: 70,
      toName: 'CHOG #70',
      prankId: 'bonk',
      landed: true,
      points: 0,
      revenge: false,
      createdAt: new Date(Date.now() - 1800_000).toISOString(),
    },
  ],
};

const CLEAN_TYPED_DATA = {
  domain: { name: 'Chog Mischief', version: '1', chainId: 143, verifyingContract: '0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763' },
  types: { Prank: [{ name: 'kind', type: 'string' }] },
  primaryType: 'Prank',
  message: { kind: 'clean' },
};

async function mockApi(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as Record<string, boolean>).__CHOG_E2E__ = true;
  });
  // Stateful: once the clean commits, the overlay is gone from the next
  // /api/hq read, exactly as the real server would behave.
  let cleaned = false;
  const body = () => ({
    ...HQ_BODY,
    stats: [
      {
        ...HQ_BODY.stats[0],
        overlays: cleaned ? [] : HQ_BODY.stats[0].overlays,
      },
    ],
  });

  await page.route('**/api/hq', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body()) }),
  );
  await page.route('**/api/clean/prepare', (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ typedData: CLEAN_TYPED_DATA, nonce: 'n1', preview: { caption: 'slimed' } }),
    }),
  );
  await page.route('**/api/clean/commit', (route: Route) => {
    cleaned = true;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, id: 'c1' }) });
  });
}

test.describe('the inbox', () => {
  test('shows the clean queue with what is on the Chog', async ({ page }) => {
    await mockApi(page);
    await page.goto('/inbox', { waitUntil: 'networkidle' });

    await expect(page.getByText('On CHOG #70 right now')).toBeVisible();
    await expect(page.getByText('slimed')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Clean' })).toBeVisible();
  });

  test('shows the revenge queue with a link that preselects the attacker', async ({ page }) => {
    await mockApi(page);
    await page.goto('/inbox', { waitUntil: 'networkidle' });

    await expect(page.getByText(/CHOG #561 hit you with/)).toBeVisible();
    await expect(page.getByText(/revenge is worth 2x/)).toBeVisible();
    // The link carries the attacker so /prank skips to the weapon step; the
    // 2x itself is the server's decision.
    await expect(page.getByRole('link', { name: 'Get revenge' })).toHaveAttribute(
      'href',
      '/prank?target=561',
    );
  });

  test('cleans an overlay end to end through the signature step', async ({ page }) => {
    await mockApi(page);
    await page.goto('/inbox', { waitUntil: 'networkidle' });

    await page.getByRole('button', { name: 'Clean' }).click();

    // The sign step appears, the e2e seam signs, the commit is mocked.
    await expect(page.getByRole('button', { name: 'Sign to clean (no gas)' })).toBeVisible();
    await page.getByRole('button', { name: 'Sign to clean (no gas)' }).click();

    // After the commit the overlay leaves the queue (the page re-reads /api/hq).
    await expect(page.getByRole('button', { name: 'Clean' })).toHaveCount(0, { timeout: 15_000 });
  });

  test('gates on the wallet with no session', async ({ page }) => {
    await mockApi(page);
    await page.route('**/api/hq', (route: Route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ authenticated: false }) }),
    );
    await page.goto('/inbox', { waitUntil: 'networkidle' });

    await expect(page.getByRole('heading', { name: 'The inbox needs a Chog' })).toBeVisible();
  });
});
