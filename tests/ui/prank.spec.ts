import { test, expect, type Page, type Route } from '@playwright/test';

/**
 * The signed-in prank flow, end to end, in a real browser.
 *
 * WHY MOCKED ROUTES + A TEST SIGNER: the happy path needs a signature from
 * the CURRENT ON-CHAIN OWNER of a real Chog. We will never ask a holder for
 * a private key to satisfy a test, and a headless browser has no wallet -
 * so the test arms a flag (src/lib/e2e.ts) that makes the sign step produce
 * a deterministic stand-in signature, and intercepts the four API routes.
 * Everything else is REAL: the stepper, the session gate, the target grid,
 * the prank pool, the daily-limit check in prepare, the nonce-replay retry,
 * the suspense floor, the result overlay, every refusal sheet.
 *
 * The server still does the real verification (recovering the signer,
 * re-reading ownership) - the flag only changes who produces the signature
 * string, which is why it is safe to ship: with it unset, nothing changes.
 */

const HELD_TOKEN = 70;
const HELD_CHOG = {
  tokenId: HELD_TOKEN,
  name: 'CHOG #70',
  imageUrl: null,
  // Common tier (so rare pranks are LOCKED and show their trait reason),
  // Crown (an unlocked signature prank - a trait grant beats the tier cap)
  // and Clown Mouth (taunts unlocked).
  traits: { Tier: 'Common', Head: 'Crown', Mouth: 'Clown Mouth', Eyes: 'Happy' },
};

const TARGETS = [
  { tokenId: 3, name: 'CHOG #3', imageUrl: null },
  { tokenId: 5, name: 'CHOG #5', imageUrl: null },
  { tokenId: 8, name: 'CHOG #8', imageUrl: null },
];

/** The realistic server-built EIP-712 typed data. The client signs and
 *  forwards it; the shape must match what buildActionTypedData emits. */
const TEST_TYPED_DATA = {
  domain: {
    name: 'Chog Mischief',
    version: '1',
    chainId: 143,
    verifyingContract: '0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763',
  },
  types: {
    Prank: [
      { name: 'kind', type: 'string' },
      { name: 'fromTokenId', type: 'uint256' },
      { name: 'toTokenId', type: 'uint256' },
      { name: 'prankId', type: 'string' },
      { name: 'dodgeRoll', type: 'uint256' },
      { name: 'landed', type: 'bool' },
      { name: 'points', type: 'uint256' },
      { name: 'revenge', type: 'bool' },
      { name: 'day', type: 'string' },
      { name: 'nonce', type: 'string' },
    ],
  },
  primaryType: 'Prank',
  message: {
    kind: 'prank',
    fromTokenId: 70,
    toTokenId: 3,
    prankId: 'crown-of-the-chog',
    dodgeRoll: 5000,
    landed: true,
    points: 30,
    revenge: false,
    day: '2026-10-09',
    nonce: 'e2etestnonce0001',
  },
};

const SESSION_BODY = {
  authenticated: true,
  address: '0x1111111111111111111111111111111111111111',
  tokenIds: [HELD_TOKEN],
  chogs: [HELD_CHOG],
};

interface MockOptions {
  /** Status + body for POST /api/prank/commit. */
  commit?: { status: number; body: Record<string, unknown> };
  /** Status + body for POST /api/prank/prepare. */
  prepare?: { status: number; body: Record<string, unknown> };
  /** Arm the e2e signer seam. Default true. */
  e2e?: boolean;
  /** The wallet "refuses" the signature. */
  reject?: boolean;
  /** The wallet is on the wrong chain. */
  wrongChain?: boolean;
  /** No session at all (the connect gate). */
  signedOut?: boolean;
}

async function mockApi(page: Page, opts: MockOptions = {}): Promise<void> {
  if (opts.e2e !== false) {
    await page.addInitScript(
      ([e2e, reject, wrongChain]) => {
        const w = window as unknown as Record<string, boolean>;
        w.__CHOG_E2E__ = e2e;
        w.__CHOG_E2E_REJECT__ = reject;
        w.__CHOG_E2E_WRONG_CHAIN__ = wrongChain;
      },
      [true, opts.reject === true, opts.wrongChain === true] as const,
    );
  }

  await page.route('**/api/auth/session', (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(opts.signedOut ? { authenticated: false } : SESSION_BODY),
    }),
  );

  // The target grid: honour the client's own-exclusion so the test can prove
  // the player's Chogs never appear as targets.
  await page.route('**/api/chogs**', (route: Route) => {
    const url = new URL(route.request().url());
    const exclude = new Set(
      (url.searchParams.get('exclude') ?? '')
        .split(',')
        .filter(Boolean)
        .map(Number),
    );
    const q = url.searchParams.get('q');
    const rows = TARGETS.filter((t) => !exclude.has(t.tokenId)).filter((t) =>
      q ? String(t.tokenId).includes(q.replace('#', '')) : true,
    );
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ rows, total: rows.length, cacheReady: true }),
    });
  });

  await page.route('**/api/prank/prepare', (route: Route) =>
    route.fulfill({
      status: opts.prepare?.status ?? 200,
      contentType: 'application/json',
      body: JSON.stringify(
        opts.prepare?.body ?? {
          typedData: TEST_TYPED_DATA,
          nonce: 'e2etestnonce0001',
          payload: {},
          preview: { prankName: 'Crown Of The Chog', caption: 'Crowned.', landed: true, points: 30 },
        },
      ),
    }),
  );

  await page.route('**/api/prank/commit', (route: Route) =>
    route.fulfill({
      status: opts.commit?.status ?? 200,
      contentType: 'application/json',
      body: JSON.stringify(
        opts.commit?.body ?? {
          ok: true,
          id: 'row-1',
          prank: {
            id: 'crown-of-the-chog',
            name: 'Crown Of The Chog',
            caption: 'Crowned.',
            landed: true,
            points: 30,
            revenge: false,
            streak: 2,
            newBadges: ['first_blood'],
          },
        },
      ),
    }),
  );
}

/** Walk the flow to the sign step. */
async function toSignStep(page: Page, url = '/prank'): Promise<void> {
  await page.goto(url, { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: "Who's getting it?" })).toBeVisible();
  await page.getByRole('button', { name: /CHOG #3/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Pick your weapon' })).toBeVisible();
  await page.getByRole('button', { name: /Crown Of The Chog/ }).first().click();
  await page.getByRole('button', { name: /^Prank with/ }).click();
  await expect(page.getByRole('heading', { name: 'Sign it' })).toBeVisible();
}

test.describe('the prank flow', () => {
  test('happy path: target -> prank -> sign -> HIT result', async ({ page }) => {
    await mockApi(page);
    await toSignStep(page);

    // Step 3 asks for the gasless signature.
    await page.getByRole('button', { name: 'Sign to prank (no gas)' }).click();

    // The suspense floor (1.2s) keeps the bar up before the result lands.
    await expect(page.getByTestId('suspense-bar')).toBeVisible();
    await expect(page.getByTestId('suspense-bar')).toContainText('Landing the prank');

    // The HIT result, with the points and the confetti.
    const result = page.locator('.x-ov__box');
    await expect(result).toBeVisible({ timeout: 15_000 });
    await expect(result).toContainText('HIT!');
    await expect(result).toContainText('Crown Of The Chog landed on CHOG #3');
    await expect(result).toContainText('30');
    await expect(result).toContainText('first blood');
    // Confetti only sprays on a hit.
    expect(await page.locator('.x-cf').count()).toBeGreaterThan(0);

    // Share card + Back to HQ.
    await result.getByRole('button', { name: 'Share card' }).click();
    const share = page.locator('.x-ov__box[data-size="lg"]');
    await expect(share).toBeVisible();
    await expect(share).toContainText('/chog/3');
  });

  test('the daily limit is refused at the weapon step, before any signature', async ({ page }) => {
    await mockApi(page, {
      prepare: { status: 409, body: { error: 'ALREADY_PRANKED_TODAY' } },
    });

    let commitCalls = 0;
    page.on('request', (r) => {
      if (r.url().includes('/api/prank/commit')) commitCalls += 1;
    });

    // Walk to the weapon step and try to prank. Prepare (which checks the
    // daily limit) runs BEFORE any signature is requested.
    await page.goto('/prank', { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: "Who's getting it?" })).toBeVisible();
    await page.getByRole('button', { name: /CHOG #3/ }).first().click();
    await expect(page.getByRole('heading', { name: 'Pick your weapon' })).toBeVisible();
    await page.getByRole('button', { name: /Crown Of The Chog/ }).first().click();
    await page.getByRole('button', { name: /^Prank with/ }).click();

    // The daily-limit sheet, with its countdown to 00:00 UTC.
    const sheet = page.locator('.x-ov__box');
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText('already pranked today');
    await expect(sheet.locator('.x-cd')).toHaveText(/^\d{2}:\d{2}:\d{2}$/);

    // No signature was ever requested and nothing was committed.
    expect(commitCalls).toBe(0);
    await expect(page.getByTestId('prank-sign')).toHaveCount(0);
  });

  test('a wrong-signer signature is refused with the imposter sheet', async ({ page }) => {
    await mockApi(page, {
      commit: { status: 401, body: { error: 'signature was from a different wallet' } },
    });
    await toSignStep(page);
    await page.getByRole('button', { name: 'Sign to prank (no gas)' }).click();

    const sheet = page.locator('.x-ov__box');
    await expect(sheet).toBeVisible({ timeout: 15_000 });
    await expect(sheet).toContainText('Imposter detected.');
  });

  test('a Chog that left the wallet is refused with the not-owner sheet', async ({ page }) => {
    await mockApi(page, {
      commit: { status: 403, body: { error: 'you no longer hold that Chog' } },
    });
    await toSignStep(page);
    await page.getByRole('button', { name: 'Sign to prank (no gas)' }).click();

    const sheet = page.locator('.x-ov__box');
    await expect(sheet).toBeVisible({ timeout: 15_000 });
    await expect(sheet).toContainText('That Chog moved out.');
  });

  test('a replayed signature is retried once silently, then refused', async ({ page }) => {
    await mockApi(page, {
      commit: { status: 409, body: { error: 'this prank was already committed' } },
    });

    let prepareCalls = 0;
    let commitCalls = 0;
    page.on('request', (r) => {
      if (r.url().includes('/api/prank/prepare')) prepareCalls += 1;
      if (r.url().includes('/api/prank/commit')) commitCalls += 1;
    });

    await toSignStep(page);
    await page.getByRole('button', { name: 'Sign to prank (no gas)' }).click();

    const sheet = page.locator('.x-ov__box');
    await expect(sheet).toBeVisible({ timeout: 20_000 });
    await expect(sheet).toContainText('Déjà prank.');

    // Exactly one silent retry: two prepares (the original + the retry) and
    // two commits - never a third, which would be a loop.
    expect(prepareCalls).toBe(2);
    expect(commitCalls).toBe(2);
  });

  test('a cancelled signature gets the chickened-out sheet and commits nothing', async ({ page }) => {
    await mockApi(page, { reject: true });

    let commitCalls = 0;
    page.on('request', (r) => {
      if (r.url().includes('/api/prank/commit')) commitCalls += 1;
    });

    await toSignStep(page);
    await page.getByRole('button', { name: 'Sign to prank (no gas)' }).click();

    const sheet = page.locator('.x-ov__box');
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText('Chickened out?');
    expect(commitCalls).toBe(0);
  });

  test('the wrong network blocks the sign with its own modal', async ({ page }) => {
    await mockApi(page, { wrongChain: true });
    await toSignStep(page);
    await page.getByRole('button', { name: 'Sign to prank (no gas)' }).click();

    const modal = page.locator('.x-ov__box');
    await expect(modal).toBeVisible();
    await expect(modal).toContainText('Wrong network');
    await expect(modal).toContainText('Switch to Monad');
    // No signature request happened.
    await expect(page.getByTestId('prank-sign')).not.toContainText('Check your wallet to sign');
  });

  test('a Chog page preselects its target and skips to the weapon step', async ({ page }) => {
    await mockApi(page);
    await page.goto('/prank?target=3', { waitUntil: 'networkidle' });

    // Straight to step 2, with the target already chosen.
    await expect(page.getByRole('heading', { name: 'Pick your weapon' })).toBeVisible();
    await expect(page.getByText('CHOG #3').first()).toBeVisible();
    await expect(page.getByRole('heading', { name: "Who's getting it?" })).toHaveCount(0);
  });

  test('the target grid excludes the player own Chogs', async ({ page }) => {
    await mockApi(page);
    await page.goto('/prank', { waitUntil: 'networkidle' });

    await expect(page.getByRole('heading', { name: "Who's getting it?" })).toBeVisible();
    // CHOG #70 is the held Chog: it is sent as exclude= and never rendered.
    const seen = await page.evaluate(() =>
      [...document.querySelectorAll('.x-pick')].map((el) => el.textContent ?? ''),
    );
    expect(seen.join(' ')).not.toContain('CHOG #70');
    expect(seen.join(' ')).toContain('CHOG #3');
  });

  test('locked pranks are greyed with their trait requirement', async ({ page }) => {
    await mockApi(page);
    await page.goto('/prank', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /CHOG #3/ }).first().click();
    await expect(page.getByRole('heading', { name: 'Pick your weapon' })).toBeVisible();

    // The Crown signature is unlocked (the held Chog wears one)...
    await expect(page.getByRole('button', { name: /Crown Of The Chog/ }).first()).toBeEnabled();
    // ...while a Head signature this Chog lacks is locked and explains why.
    const locked = page.getByRole('button', { name: /Wizard Of Chog/ }).first();
    await expect(locked).toBeDisabled();
    await expect(locked).toContainText('Needs trait: Head - Wizard Hat');
  });

  test('without a session the flow gates on the wallet', async ({ page }) => {
    await mockApi(page, { signedOut: true });
    await page.goto('/prank', { waitUntil: 'networkidle' });

    await expect(page.getByRole('heading', { name: 'Hold a Chog to prank' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Play as a guest instead' })).toBeVisible();
  });
});
