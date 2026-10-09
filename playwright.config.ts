import { defineConfig, devices } from "@playwright/test";

/**
 * HERMES_UI_RULES rule 8 requires a visual check at 390x844 before any commit that
 * touches UI, compared side by side with the same screen in the prototype.
 *
 * Single worker on purpose: these runs share one preview server, and parallel
 * workers would race for the port. The suite is small and DOM-assertion-heavy.
 */
export default defineConfig({
  testDir: "./tests/ui",
  // Only *.spec.ts are Playwright specs. Without this, Playwright's default
  // testMatch also collects *.test.ts - and tests/ui/css-preflight.test.ts is
  // a Vitest file, which throws the moment Playwright's runner imports it.
  testMatch: "**/*.spec.ts",
  // Hark's call 1: confirm the SERVED stylesheet is the one in the build, before
  // any spec runs. A stale server serves the current HTML with an empty CSS
  // chunk, every page renders unstyled, and DOM assertions pass anyway - so this
  // failure has to abort the run rather than produce ten misleading overflow
  // failures. See tests/ui/css-preflight.ts for the full story.
  globalSetup: "./tests/ui/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.UI_BASE_URL ?? "http://127.0.0.1:3104",
    // Rule 7: keep the 480px phone frame, and rule 8 fixes the check width.
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
  },
  projects: [{ name: "mobile", use: { ...devices["Pixel 7"] } }],
});