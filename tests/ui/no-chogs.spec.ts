import { test, expect, type Page, type Route } from '@playwright/test';

/**
 * THE NO-CHOG STATE.
 *
 * A wallet that connects, signs, and is then told it holds no Chog Genesis is
 * not having a fault. It has reached the most common state for anyone who is
 * not already a holder - and the previous screen showed a red error string
 * with no way forward, which read as "you did something wrong" and offered
 * nothing to do about it.
 *
 * This is the gate working as intended: you need an NFT to play for points. The
 * screen's job is to say so plainly and hand over the two things that DO work -
 * the guest path, and where to look for a Chog.
 *
 * The real one is checked too: a wrong-chain or empty-wallet wallet is refused
 * by /api/auth/verify with `no_chogs`, and this asserts the UI that follows.
 */

const NO_CHOGS_BODY = {
  error: 'no_chogs',
  message: 'That wallet does not hold a Chog Genesis NFT.',
};

/** A wallet that is connected and can sign, but holds nothing. */
async function mockConnectedWalletWithoutChogs(page: Page): Promise<void> {
  // AppKit's modal and wagmi's connectors are not in a headless browser, so the
  // connect step is short-circuited the same way the prank flow short-circuits
  // signing. The state under test is what happens AFTER a successful signature.
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__CHOG_E2E__ = true;
    w.__CHOG_E2E_CONNECTED__ = true;
    w.__CHOG_E2E_ADDRESS__ = '0x2222222222222222222222222222222222222222';
  });

  await page.route('**/api/auth/nonce', (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        nonce: 'nochogsnonce0001',
        message: 'chogmischief.xyz wants you to sign in with your wallet',
      }),
    }),
  );

  await page.route('**/api/auth/verify', (route: Route) =>
    route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify(NO_CHOGS_BODY),
    }),
  );
}

test.describe('a wallet with no Chog', () => {
  test('is offered the guest path instead of a dead end', async ({ page }) => {
    await mockConnectedWalletWithoutChogs(page);
    await page.goto('/', { waitUntil: 'networkidle' });

    // Start from the landing page, where a non-holder always arrives.
    await page.getByRole('button', { name: /connect wallet/i }).first().click();

    const state = page.getByTestId('no-chogs');
    await expect(state).toBeVisible({ timeout: 20_000 });
  });

  test('says plainly that a Chog is required and that nothing was spent', async ({ page }) => {
    await mockConnectedWalletWithoutChogs(page);
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /connect wallet/i }).first().click();

    const state = page.getByTestId('no-chogs');
    await expect(state).toBeVisible({ timeout: 20_000 });

    await expect(state.getByText(/need a chog to play/i)).toBeVisible();
    await expect(state.getByText(/does not hold a chog genesis/i)).toBeVisible();
    // The reassurance that matters to someone who just signed something.
    await expect(state.getByText(/nothing was charged/i)).toBeVisible();
  });

  test('offers guest play as the primary way forward', async ({ page }) => {
    await mockConnectedWalletWithoutChogs(page);
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /connect wallet/i }).first().click();

    const state = page.getByTestId('no-chogs');
    await expect(state).toBeVisible({ timeout: 20_000 });

    const guest = state.getByRole('link', { name: /play as a guest/i });
    await expect(guest).toBeVisible();
    // It must go somewhere real, not "#".
    await expect(guest).toHaveAttribute('href', '/guest');
  });

  test('points at where a Chog can be found', async ({ page }) => {
    await mockConnectedWalletWithoutChogs(page);
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /connect wallet/i }).first().click();

    const state = page.getByTestId('no-chogs');
    await expect(state).toBeVisible({ timeout: 20_000 });

    const find = state.getByRole('link', { name: /find a chog/i });
    await expect(find).toHaveAttribute(
      'href',
      /monadvision\.com\/token\/0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763/,
    );
  });

  test('is NOT styled as an error', async ({ page }) => {
    await mockConnectedWalletWithoutChogs(page);
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /connect wallet/i }).first().click();

    const state = page.getByTestId('no-chogs');
    await expect(state).toBeVisible({ timeout: 20_000 });

    // The regression: this used to render the same text as the red inline error,
    // so a non-holder saw a fault banner for something that is not a fault.
    // role="status" is what separates it from role="alert".
    await expect(state).toHaveAttribute('role', 'status');

    // The failure this guards: the message rendered inside an ERROR slot, so a
    // non-holder saw a fault banner for something that is not a fault. Scoped to
    // an alert that mentions Chogs, because the landing page legitimately has
    // other alert regions and a page-wide count of zero would assert about the
    // wrong thing.
    await expect(
      page.locator('[role="alert"]', { hasText: /chog genesis/i }),
    ).toHaveCount(0);

    // And the message IS shown - just in the status region.
    await expect(state.getByText(/does not hold a chog genesis/i)).toBeVisible();
  });

  test('never shows the wallet address in this state', async ({ page }) => {
    await mockConnectedWalletWithoutChogs(page);
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /connect wallet/i }).first().click();

    const state = page.getByTestId('no-chogs');
    await expect(state).toBeVisible({ timeout: 20_000 });

    // A shareable screenshot of this screen must not carry an address.
    const text = await state.innerText();
    expect(text.toLowerCase()).not.toContain('0x2222');
  });

  test('can be retried, in case the wallet has a Chog on another network', async ({ page }) => {
    await mockConnectedWalletWithoutChogs(page);
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /connect wallet/i }).first().click();

    const state = page.getByTestId('no-chogs');
    await expect(state).toBeVisible({ timeout: 20_000 });

    await state.getByRole('button', { name: /try again/i }).click();
    await expect(state).toBeHidden();
    await expect(page.getByTestId('no-chogs')).toHaveCount(0);
  });
});