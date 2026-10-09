import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Unit and pure-domain tests only.
 *
 * The Playwright specs under tests/ui/ are deliberately excluded. They import
 * `test()` from @playwright/test, which throws when Vitest's runner collects it
 * ("Playwright Test did not expect test() to be called here"). They run via
 * `npm run test:ui` against a live server instead.
 *
 * The `@/*` alias is repeated here rather than inherited from tsconfig: Vitest
 * does not read tsconfig paths on its own, and without it every spec importing a
 * module through `@/` fails to resolve - which reads like a broken import in the
 * source rather than a missing bit of test config.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    // Only the PLAYWRIGHT specs are excluded. `tests/ui/css-preflight.test.ts`
    // is a plain Vitest file that happens to live under tests/ui, and a blanket
    // `tests/ui/**` exclusion silently skipped it - which would have left the
    // served-CSS gate, the one piece of infrastructure whose whole job is to
    // catch a failure that is invisible, untested.
    exclude: [
      "tests/ui/*.spec.ts",
      "node_modules/**",
      ".next/**",
    ],
  },
});