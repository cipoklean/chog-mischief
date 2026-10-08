import { defineConfig } from "vitest/config";

/**
 * Unit and pure-domain tests only.
 *
 * The Playwright specs under tests/ui/ are deliberately excluded. They import
 * `test()` from @playwright/test, which throws when Vitest's runner collects it
 * ("Playwright Test did not expect test() to be called here"). They run via
 * `npm run test:ui` against a live server instead.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    exclude: ["tests/ui/**", "node_modules/**", ".next/**"],
  },
});