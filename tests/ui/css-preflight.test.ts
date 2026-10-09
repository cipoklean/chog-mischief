import { createServer, type Server } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cssPreflight, MIN_CSS_BYTES } from "./css-preflight";

/**
 * The preflight exists to catch one specific, hard-to-see failure. If it does not
 * catch it, it is worse than nothing: it prints a reassuring green line while the
 * suite measures an unstyled page.
 *
 * So these tests reproduce the failure against a fake server serving exactly the
 * broken responses that happened here: current HTML, missing/empty CSS chunk.
 */

const REAL_CSS = `:root{--x-p:#836EF9;--x-bg:#140B2E}.x-card{border:3px solid var(--x-ink)}${"/* pad */".repeat(900)}`;

let server: Server;
let base = "";
let tmp: string;

/** What kind of broken server to simulate. */
type Flavour =
  | "good" // correct HTML + correct CSS
  | "empty-css" // HTML references a sheet that 404s to a 21-byte body
  | "tiny-css" // HTML references a sheet that returns a too-small body
  | "no-css" // HTML references no stylesheet at all
  | "foreign-css" // correct size, wrong content
  | "stale-name" // references a filename the build never produced
  | "unreachable"; // nothing listening

let flavour: Flavour = "good";

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), "css-preflight-"));
  const chunks = join(tmp, ".next", "static", "chunks");
  mkdirSync(chunks, { recursive: true });
  writeFileSync(join(chunks, "currentbuild-abc123.css"), REAL_CSS);

  server = createServer((req, res) => {
    const url = req.url ?? "/";
    if (flavour === "unreachable") return; // never happens; server closed below

    if (url.startsWith("/_next/static/chunks/")) {
      const name = url.split("/").pop() ?? "";
      if (flavour === "empty-css" || flavour === "stale-name") {
        if (name === "currentbuild-abc123.css" && flavour === "empty-css") {
          // The real failure: hashed filename is unknown to a stale server, which
          // answers 404 with a ~21 byte body.
          res.writeHead(404, { "content-type": "text/plain" });
          res.end("404: Not Found");
          return;
        }
      }
      if (flavour === "tiny-css") {
        res.writeHead(200, { "content-type": "text/css" });
        res.end(".x-card{}");
        return;
      }
      if (flavour === "foreign-css") {
        res.writeHead(200, { "content-type": "text/css" });
        res.end("body{font-family:Comic Sans}".repeat(200));
        return;
      }
      res.writeHead(200, { "content-type": "text/css" });
      res.end(REAL_CSS);
      return;
    }

    const html = (() => {
      switch (flavour) {
        case "no-css":
          return "<!doctype html><html><body><div class='x-card'>hi</div></body></html>";
        case "empty-css":
          // Current HTML, referencing the CURRENT build's sheet — which the stale
          // server does not have.
          return htmlWith('"/_next/static/chunks/currentbuild-abc123.css"');
        case "tiny-css":
        case "foreign-css":
        case "stale-name":
          return htmlWith(
            flavour === "stale-name"
              ? '"/_next/static/chunks/oldbuild-xyz999.css"'
              : '"/_next/static/chunks/currentbuild-abc123.css"',
          );
        default:
          return htmlWith('"/_next/static/chunks/currentbuild-abc123.css"');
      }
    })();

    res.writeHead(200, { "content-type": "text/html" });
    res.end(html);
  });

  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  rmSync(tmp, { recursive: true, force: true });
});

function htmlWith(ref: string): string {
  return `<!doctype html><html><head><link rel="stylesheet" href=${ref}/></head><body><div class="x-card">hi</div></body></html>`;
}

async function run(): ReturnType<typeof cssPreflight> {
  return cssPreflight(base, join(tmp, ".next"));
}

describe("cssPreflight", () => {
  it("passes when the served stylesheet matches the build", async () => {
    flavour = "good";
    const r = await run();
    expect(r.problems).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.servedBytes).toBeGreaterThanOrEqual(MIN_CSS_BYTES);
  });

  // THE failure this whole file exists for.
  it("fails when the referenced stylesheet 404s to a tiny body", async () => {
    flavour = "empty-css";
    const r = await run();
    expect(r.ok).toBe(false);
    expect(r.problems.join(" ")).toMatch(/under the .*byte floor|stale|HTTP 404/i);
  });

  it("fails when the stylesheet is present but too small", async () => {
    flavour = "tiny-css";
    const r = await run();
    expect(r.ok).toBe(false);
    expect(r.servedBytes).toBeLessThan(MIN_CSS_BYTES);
  });

  it("fails when the HTML references no stylesheet", async () => {
    flavour = "no-css";
    const r = await run();
    expect(r.ok).toBe(false);
    expect(r.problems.join(" ")).toMatch(/references no stylesheet/i);
  });

  it("fails when the stylesheet is the wrong content, even at a valid size", async () => {
    flavour = "foreign-css";
    const r = await run();
    expect(r.ok).toBe(false);
    expect(r.problems.join(" ")).toMatch(/--x-p:/);
  });

  it("fails when the served filename is not one the build produced", async () => {
    flavour = "stale-name";
    const r = await run();
    expect(r.ok).toBe(false);
    expect(r.problems.join(" ")).toMatch(/Stale server|current build did not produce/i);
  });

  it("fails when nothing is listening", async () => {
    const dead = "http://127.0.0.1:1"; // nothing binds port 1
    const r = await cssPreflight(dead, join(tmp, ".next"));
    expect(r.ok).toBe(false);
    expect(r.problems.join(" ")).toMatch(/could not reach/i);
  });

  it("fails when the build directory has no real stylesheet", async () => {
    flavour = "good";
    const r = await cssPreflight(base, join(tmp, "no-such-build"));
    expect(r.ok).toBe(false);
    expect(r.problems.join(" ")).toMatch(/npm run build/);
  });
});
