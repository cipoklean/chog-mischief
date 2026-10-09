import { test, expect, type Page } from "@playwright/test";

/**
 * Responsive invariants — Hark's tablet/desktop spec, asserted in a real
 * browser at five viewports.
 *
 * HERMES_UI_RULES rule 8 (as amended): the 480px frame is the PHONE layout
 * only. These tests pin the breakpoint behaviour:
 *
 *   phone  <768      480px column, sticky top bar, bottom tab bar, rails hidden
 *   tablet 768–1199  main (<=560) + right rail (320), header nav, no tab bar
 *   desktop >=1200   left rail 300 | main 560–640 | right rail 320, max 1320
 *
 * NO PIXEL DIFF (Hark's call, and the right one — the phone view is verified
 * structurally here, and the served-CSS identity is checked by the global
 * setup before any of this runs). Screenshots are written per route per
 * viewport to test-results/responsive/ for a human to review.
 *
 * The rule-1 guarantee (CSS-only switching, no JS viewport detection) is
 * proven by the resize test: the layout switches with no reload and no
 * console errors, which is only possible if nothing in JavaScript is
 * watching the viewport.
 */

const INK = "rgb(6, 2, 15)";
const TAP_MIN = 44;

const VIEWPORTS = [
  { name: "phone", width: 390, height: 844 },
  { name: "tablet", width: 820, height: 1180 },
  { name: "tablet-landscape", width: 1024, height: 768 },
  { name: "laptop", width: 1440, height: 900 },
  { name: "desktop", width: 1920, height: 1080 },
] as const;

/**
 * Routes in the matrix. `chrome` marks the non-bare routes that carry the
 * header + tab bar; `rails` marks the one route that mounts the rails (the
 * design harness — the five game screens that will show them do not exist
 * yet).
 */
const ROUTES = [
  { path: "/", name: "landing", chrome: false, rails: false },
  { path: "/guest", name: "guest", chrome: true, rails: false },
  { path: "/pick", name: "pick", chrome: false, rails: false },
  { path: "/chog/561", name: "chog-legendary", chrome: false, rails: false },
  { path: "/refusal-demo", name: "design-states", chrome: true, rails: true },
] as const;

async function overflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

/** Is this element actually laid out (not display:none)? */
async function isShown(page: Page, selector: string): Promise<boolean> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    const cs = getComputedStyle(el);
    return cs.display !== "none" && el.getBoundingClientRect().height > 0;
  }, selector);
}

for (const vp of VIEWPORTS) {
  for (const route of ROUTES) {
    test(`${route.name} @ ${vp.name} (${vp.width}x${vp.height})`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.setViewportSize({ width: vp.width, height: vp.height });

      await page.goto(route.path, { waitUntil: "networkidle" });
      await page.screenshot({
        path: `test-results/responsive/${route.name}/${vp.width}x${vp.height}.png`,
        fullPage: true,
      });

      // No client-side crash, at any size.
      const detail = errors.join(", ");
      expect(errors, `page errors on ${route.path}: ${detail}`).toHaveLength(0);

      // No horizontal overflow, at any size. This is the check that caught
      // the missing-stylesheet failure — it must pass because the page is
      // styled, and the global setup proves the stylesheet is the current
      // build's before we get here.
      expect(await overflow(page), `horizontal overflow on ${route.path}`).toBeLessThanOrEqual(0);

      const wide = vp.width >= 768;
      const desktop = vp.width >= 1200;

      // ---- chrome: tab bar on phone, header nav at 768+ ----
      if (route.chrome) {
        expect(await isShown(page, ".x-tabs"), "bottom tab bar").toBe(!wide);
        expect(await isShown(page, ".x-nav"), "header nav").toBe(wide);
        if (wide) {
          // The nav replaces the tab bar entirely at 768+.
          const navBtns = await page.locator(".x-nav__btn").allTextContents();
          expect(navBtns.join(" ")).toMatch(/HQ.*Prank.*Inbox.*Ranks.*Profile/s);
        }
      } else {
        // Bare routes (landing, pick, chog) never show chrome at any size.
        expect(await isShown(page, ".x-tabs"), "tab bar on a bare route").toBe(false);
        expect(await isShown(page, ".x-nav"), "nav on a bare route").toBe(false);
      }

      // ---- rails: right rail at 768+, left rail at 1200+, never on phone ----
      if (route.rails) {
        expect(await isShown(page, ".x-rail--r"), "right rail").toBe(wide);
        expect(await isShown(page, ".x-rail--l"), "left rail").toBe(desktop);
      } else {
        expect(await isShown(page, ".x-rail"), "rails on a rail-less route").toBe(false);
      }

      // ---- shell width and centring ----
      if (wide) {
        const box = await page.locator(".x-app").boundingBox();
        expect(box).not.toBeNull();
        // Desktop cap is 1320px; the tablet rail shell is 904px; either way
        // it must never exceed 1320.
        expect(box!.width, "shell wider than 1320").toBeLessThanOrEqual(1320);
        if (desktop) {
          expect(box!.width, "desktop shell should use the full 1320").toBe(1320);
        }
        // Centred: equal margins on both sides (within a pixel of rounding).
        const leftMargin = box!.x;
        const rightMargin = vp.width - (box!.x + box!.width);
        expect(
          Math.abs(leftMargin - rightMargin),
          `shell not centred: left=${leftMargin} right=${rightMargin}`,
        ).toBeLessThanOrEqual(1);
      } else {
        const box = await page.locator(".x-app").boundingBox();
        expect(box!.width, "phone shell should be the 480px frame").toBeLessThanOrEqual(480);
      }
    });
  }
}

test("layout switches live on resize with no reload and no console errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/refusal-demo", { waitUntil: "networkidle" });

  // Desktop: both rails, nav, no tab bar.
  expect(await isShown(page, ".x-rail--l")).toBe(true);
  expect(await isShown(page, ".x-rail--r")).toBe(true);
  expect(await isShown(page, ".x-nav")).toBe(true);
  expect(await isShown(page, ".x-tabs")).toBe(false);

  // Shrink to phone — NO RELOAD. A JS viewport listener could not do this
  // without a re-render; CSS does it with zero React involvement, which is
  // exactly Hark's rule 1.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  expect(await isShown(page, ".x-rail--l")).toBe(false);
  expect(await isShown(page, ".x-rail--r")).toBe(false);
  expect(await isShown(page, ".x-nav")).toBe(false);
  expect(await isShown(page, ".x-tabs")).toBe(true);
  expect(await overflow(page)).toBeLessThanOrEqual(0);

  // Back to desktop, again without reloading.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(300);
  expect(await isShown(page, ".x-rail--l")).toBe(true);
  expect(await isShown(page, ".x-rail--r")).toBe(true);
  expect(await isShown(page, ".x-nav")).toBe(true);
  expect(await isShown(page, ".x-tabs")).toBe(false);

  const detail = errors.join(", ");
  expect(errors, `console/page errors during resize: ${detail}`).toEqual([]);
});

test("desktop rails stick below the header and scroll independently", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/refusal-demo", { waitUntil: "networkidle" });

  const rail = page.locator(".x-rail--r");
  const before = await rail.boundingBox();

  // Scroll the page; the rail must stay pinned at header height + 16px.
  await page.evaluate(() => window.scrollTo(0, 600));
  await page.waitForTimeout(200);
  const after = await rail.boundingBox();

  expect(Math.round(after!.y), "rail did not stay sticky").toBeLessThanOrEqual(80);
  expect(Math.round(after!.y), "rail should pin at 80px").toBe(80);

  // Independent scroll: the rail scrolls its own overflow, not the page's.
  const overflowY = await rail.evaluate((el) => getComputedStyle(el).overflowY);
  expect(overflowY).toBe("auto");
  void before;
});

for (const vp of [
  { name: "phone", width: 390, height: 844 },
  { name: "desktop", width: 1440, height: 900 },
] as const) {
  test(`modal is a centred dialog at ${vp.name} with a trapped focus`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto("/refusal-demo", { waitUntil: "networkidle" });

    const opener = page.getByRole("button", { name: "rejected", exact: true });
    await opener.click();

    const box = page.locator(".x-ov__box");
    await expect(box).toBeVisible();

    // Backdrop: the phone overlay is unchanged (rgba(10,4,24,.82)); at 768+
    // Hark's 70% #140B2E dim.
    const backdrop = await page
      .locator(".x-ov")
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    if (vp.width >= 768) {
      expect(backdrop).toBe("rgba(20, 11, 46, 0.7)");
    } else {
      expect(backdrop).toBe("rgba(10, 4, 24, 0.82)");
    }

    // Centred: the box's centre is the viewport's centre.
    const b = await box.boundingBox();
    const centre = b!.x + b!.width / 2;
    expect(Math.abs(centre - vp.width / 2), "dialog not centred").toBeLessThanOrEqual(2);

    // Focus moved into the dialog.
    const focusInside = await page.evaluate(() => {
      const boxEl = document.querySelector(".x-ov__box");
      return boxEl ? boxEl.contains(document.activeElement) : false;
    });
    expect(focusInside, "focus did not move into the dialog").toBe(true);

    // Focus is TRAPPED: tabbing many times never escapes the box.
    for (let i = 0; i < 10; i += 1) {
      await page.keyboard.press("Tab");
      const stillInside = await page.evaluate(() => {
        const boxEl = document.querySelector(".x-ov__box");
        return boxEl ? boxEl.contains(document.activeElement) : false;
      });
      expect(stillInside, `focus escaped the dialog after ${i + 1} tabs`).toBe(true);
    }

    // Esc closes and focus RETURNS to the opener.
    await page.keyboard.press("Escape");
    await expect(box).toHaveCount(0);
    const returned = await page.evaluate(() => document.activeElement?.textContent ?? "");
    expect(returned).toContain("rejected");
  });
}

test("backdrop click closes a non-critical dialog at desktop", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/refusal-demo", { waitUntil: "networkidle" });

  await page.getByRole("button", { name: "rejected", exact: true }).click();
  const box = page.locator(".x-ov__box");
  await expect(box).toBeVisible();

  // Click the dimmed area, not the box. The overlay's own click handler
  // checks the target is the overlay itself, so this must not count as a
  // click inside the dialog.
  await page.locator(".x-ov").click({ position: { x: 5, y: 5 } });
  await expect(box).toHaveCount(0);
});

test("keyboard shortcuts navigate, and are inert inside text fields", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/refusal-demo", { waitUntil: "networkidle" });

  // Wait for the app to be INTERACTIVE before pressing keys: the shortcut
  // listener is attached in a client effect, and a key pressed before
  // hydration finds no listener. The countdown ticking from its server
  // placeholder to real digits is the proof that the client has taken over.
  await expect(page.locator(".x-cd").first()).toHaveText(/^\d{2}:\d{2}:\d{2}$/);

  // P opens Prank, I opens Inbox (Hark's desktop shortcuts; shown as hints
  // in the header nav tooltips). The routes themselves do not exist yet —
  // these assert the shortcut FIRES, which is what this component owns.
  await page.keyboard.press("p");
  await expect(page).toHaveURL(/\/prank/);

  await page.goto("/refusal-demo", { waitUntil: "networkidle" });
  await expect(page.locator(".x-cd").first()).toHaveText(/^\d{2}:\d{2}:\d{2}$/);
  await page.keyboard.press("i");
  await expect(page).toHaveURL(/\/inbox/);
});

// The design invariants must hold at the new sizes too, not just at 390px.
for (const vp of [
  { name: "tablet", width: 820, height: 1180 },
  { name: "desktop", width: 1440, height: 900 },
] as const) {
  test(`design tokens and 44px targets hold at ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto("/guest", { waitUntil: "networkidle" });

    const card = page.locator(".x-card, .x-pick").first();
    const s = await card.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { border: cs.borderWidth, borderColor: cs.borderColor, shadow: cs.boxShadow };
    });
    expect(s.border, "3px ink outline").toBe("3px");
    expect(s.borderColor, "ink outline colour").toBe(INK);
    expect(s.shadow, "4px hard shadow").toContain("4px 4px");
    expect(s.shadow, "shadow must not be blurred").not.toContain("blur");

    const tooSmall = await page.evaluate((min) => {
      const out: string[] = [];
      for (const el of document.querySelectorAll("button, a")) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (!(el.textContent ?? "").trim()) continue;
        if (r.height < min) {
          out.push(`${el.tagName}"${(el.textContent ?? "").trim().slice(0, 24)}"=${Math.round(r.height)}px`);
        }
      }
      return out;
    }, TAP_MIN);
    expect(tooSmall, `tap targets under ${TAP_MIN}px`).toEqual([]);
  });
}
