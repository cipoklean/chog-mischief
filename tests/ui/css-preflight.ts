import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * CSS PREFLIGHT — Hark's call 1, and the reason this file exists at all.
 *
 * "Make the 'confirm served CSS filename + byte size' step part of the Playwright
 * setup, so it fails loudly instead of relying on memory."
 *
 * ── The failure this prevents ───────────────────────────────────────────────
 * A stale `next-server` on the test port serves the HTML of one build and the
 * assets of another. Next.js serves a CSS chunk by hashed filename, so the stale
 * server 404s the current build's stylesheet and returns a 21-byte error body
 * instead. The page then renders completely UNSTYLED while every DOM assertion
 * still passes — the feed, the buttons and the headings are all present, they are
 * just naked.
 *
 * That is exactly what happened here. Playwright reported every route overflowing
 * by ~496px, which looked like a layout bug and sent me looking at JSX widths.
 * The real cause was an empty stylesheet. Twenty minutes of the wrong fix, and
 * the overflow assertions were correct the whole time — they were measuring an
 * unstyled document.
 *
 * So the preflight runs before any spec and fails the whole run:
 *   1. the built stylesheet exists on disk
 *   2. the served HTML references a stylesheet at all
 *   3. that referenced filename is one the current build actually produced
 *   4. the served asset is at least MIN_CSS_BYTES (an error page is ~21 bytes)
 *
 * A green run now means the styles under test are the styles in the build.
 */

/** An error body is ~21 bytes; the real design stylesheet is ~23KB. */
export const MIN_CSS_BYTES = 5_000;

const CSS_NAME = /^\/_next\/static\/chunks\/[A-Za-z0-9_-]+\.css$/;

/** Filenames the current build produced, e.g. "23jbu7r2g-jbx.css". */
function builtCssNames(buildDir: string): Set<string> {
  const dir = join(buildDir, "static", "chunks");
  if (!existsSync(dir)) return new Set();
  return new Set(
    readdirSync(dir)
      .filter((f) => f.endsWith(".css"))
      .map((f) => ({ name: f, size: statSync(join(dir, f)).size }))
      .filter((f) => f.size >= MIN_CSS_BYTES)
      .map((f) => f.name),
  );
}

async function get(url: string): Promise<{ status: number; body: string }> {
  // Uses http, so it works against 127.0.0.1 without TLS.
  const res = await fetch(url, { redirect: "follow" });
  return { status: res.status, body: await res.text() };
}

export interface PreflightResult {
  ok: boolean;
  /** The stylesheet URL the served HTML points at. */
  servedPath: string | null;
  servedBytes: number;
  /** Human-readable reasons for every failure, not just the first. */
  problems: string[];
}

/**
 * Runs all four checks. Never throws — the caller decides how loudly to fail, so
 * the same function can back `npm run verify:ui` and the test setup.
 */
export async function cssPreflight(baseURL: string, buildDir: string): Promise<PreflightResult> {
  const problems: string[] = [];

  const built = builtCssNames(buildDir);
  if (built.size === 0) {
    problems.push(
      `No stylesheet of at least ${MIN_CSS_BYTES} bytes in ${buildDir}/static/chunks. Run \`npm run build\` first — this would otherwise "verify" a build that does not exist.`,
    );
  }

  let servedPath: string | null = null;
  let servedBytes = 0;

  let html = "";
  try {
    const home = await get(`${baseURL}/`);
    if (home.status !== 200) problems.push(`GET / returned HTTP ${home.status}, expected 200.`);
    html = home.body;
  } catch (err) {
    problems.push(
      `Could not reach ${baseURL} (${(err as Error).message}). If nothing is listening there, a stale or dead server is the most likely cause.`,
    );
    return { ok: false, servedPath: null, servedBytes: 0, problems };
  }

  const refs = [...html.matchAll(/(?:href|src)="(\/_next\/static\/chunks\/[A-Za-z0-9_-]+\.css)"/g)].map(
    (m) => m[1],
  );

  if (refs.length === 0) {
    problems.push(
      "The served HTML references no stylesheet. That is what a failed or empty build looks like from the browser's side — every page renders unstyled.",
    );
  } else {
    // Check every referenced sheet, not just the first: a build can reference
    // more than one, and a partial failure among them is just as invisible.
    for (const ref of refs) {
      const name = ref.split("/").pop() ?? "";
      if (!CSS_NAME.test(ref)) {
        problems.push(`Referenced asset ${ref} is not a Next.js static CSS chunk.`);
      }
      if (built.size > 0 && !built.has(name)) {
        problems.push(
          `Stale server: served HTML references ${name}, which the current build did not produce. Built sheets: ${[...built].join(", ")}. Kill the process holding the port and start the current build.`,
        );
      }

      let css = "";
      try {
        const res = await get(`${baseURL}${ref}`);
        if (res.status !== 200) {
          problems.push(`GET ${ref} returned HTTP ${res.status}, expected 200.`);
        }
        css = res.body;
      } catch (err) {
        problems.push(`Could not fetch ${ref} (${(err as Error).message}).`);
      }

      servedBytes = Buffer.byteLength(css, "utf8");
      if (servedBytes < MIN_CSS_BYTES) {
        problems.push(
          `Served ${ref} is ${servedBytes} bytes, under the ${MIN_CSS_BYTES}-byte floor. This is the empty-stylesheet failure: pages render unstyled while DOM assertions still pass.`,
        );
      }
      // Cheap sanity check that it is really the design system, not an HTML error
      // page that happened to be large.
      if (css.length > 0 && !css.includes("--x-p:")) {
        problems.push(
          `Served ${ref} does not contain the design token --x-p:. It is not the approved stylesheet.`,
        );
      }
      servedPath = ref;
    }
  }

  return {
    ok: problems.length === 0,
    servedPath,
    servedBytes,
    problems,
  };
}

/** Reads the base URL the same way the Playwright config does. */
export function resolveBaseUrl(): string {
  return process.env.UI_BASE_URL ?? "http://127.0.0.1:3104";
}

/** Reads the build directory, defaulting to this project's .next. */
export function resolveBuildDir(): string {
  return process.env.BUILD_DIR ?? join(process.cwd(), ".next");
}

/** Formats a failure for a terminal or a test error message. */
export function describeFailure(result: PreflightResult): string {
  return [
    "",
    "CSS PREFLIGHT FAILED — the stylesheet under test is not the stylesheet in the build.",
    "",
    ...result.problems.map((p) => `  ✗ ${p}`),
    "",
    "Every assertion below would still pass against an unstyled page. Fix the server,",
    "then re-run. Do not go looking for a layout bug.",
    "",
  ].join("\n");
}

/*
 * NOTE: this module has NO top-level await and no CLI block on purpose.
 *
 * Playwright's global setup imports it, and the project has no
 * "type": "module" in package.json — so the file is loaded as CommonJS,
 * where a top-level `await` (even in a guarded CLI block) is a syntax error
 * that aborts the ENTIRE Playwright run before any spec executes. The
 * standalone-gate idea was moved out rather than kept here; the real
 * consumer is tests/ui/global-setup.ts, which calls cssPreflight() itself.
 */
