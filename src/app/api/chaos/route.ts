import { connection } from "next/server";
import { db } from "@/lib/db";
import { VIEW_COLUMNS, isViewMissing, mapViewRow } from "@/lib/chaos-view";

/**
 * GET /api/chaos - the landing page's public "latest chaos" strip.
 *
 * ── The rule this route exists to enforce ────────────────────────────────────
 * Hark: the strip shows token IDs, names, prank type, hit-or-dodge and time.
 * It shows NO wallet addresses. `public.pranks` has `signer` (a 0x address) and
 * `signature` (a signed message, which contains the address in its text).
 *
 * ── Two guards, in this order ────────────────────────────────────────────────
 * 1. THE VIEW (structural): `public.recent_chaos` joins pranks to both Chog
 *    names and has no signer/signature column at all, so nothing written
 *    against it can leak an address. Applied to Supabase 2026-10-09.
 * 2. THE ALLOW-LIST (code): even reading the view, this route names each
 *    column it wants, so a column added to the view later cannot silently
 *    enter the response either.
 *
 * If the view is missing (a fresh clone, a deploy where the SQL was never
 * applied), the route FALLS BACK to the base tables - the allow-list still
 * applies there - and logs why. The fallback is why the feed can never go
 * dark over a deploy-state difference.
 *
 * NOTE: no `export const dynamic` here - the app runs with
 * `cacheComponents: true`, which rejects that export outright (a documented
 * gotcha in AGENTS.md). API routes are dynamic by default, so nothing is lost.
 */

/** Rows are newest-first; Hark asks for the last 10. */
const LIMIT = 10;
/**
 * Bots top the strip up when there are fewer than 3 real events. Set above 10 so
 * a mixed page still returns at most `LIMIT` rows once the client trims.
 */
const BOT_FILL = 6;

/** The ONLY columns the base-table fallback will ever return. */
const SAFE_COLUMNS =
  "id,from_token_id,to_token_id,prank_id,landed,revenge,points,created_at";

export interface ChaosRow {
  id: number;
  from_token_id: number;
  from_name: string;
  to_token_id: number;
  to_name: string;
  prank_id: string;
  landed: boolean;
  revenge: boolean;
  points: number;
  created_at: string;
  /** true = real signed prank; false = a bot row injected for display only. */
  real: boolean;
}

export interface ChaosResponse {
  rows: ChaosRow[];
  /** How many of `rows` are real signed pranks, before any client trimming. */
  realCount: number;
  /** True when the client should append bot rows to reach Hark's minimum of 3. */
  needsBotFill: boolean;
}

/** The base-table path, used only when the view is unavailable. */
async function readBaseTables(supabase: ReturnType<typeof db>): Promise<ChaosRow[]> {
  const { data: pranks, error } = await supabase
    .from("pranks")
    .select(SAFE_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(LIMIT);

  if (error) {
    console.error("[chaos] pranks query failed:", error.message);
    return [];
  }

  // Names come from `chogs` (token identity, not wallet identity), fetched in a
  // second query keyed on the ids actually present rather than all 1,969.
  const tokenIds = new Set<number>();
  for (const p of pranks ?? []) {
    tokenIds.add(p.from_token_id);
    tokenIds.add(p.to_token_id);
  }

  let names = new Map<number, string>();
  if (tokenIds.size > 0) {
    const { data: chogs, error: nameErr } = await supabase
      .from("chogs")
      .select("token_id,name")
      .in("token_id", [...tokenIds]);

    if (nameErr) {
      console.error("[chaos] names query failed:", nameErr.message);
    } else {
      names = new Map((chogs ?? []).map((c) => [c.token_id, c.name]));
    }
  }

  const nameOf = (id: number) => names.get(id) ?? `CHOG #${id}`;

  return (pranks ?? []).map((p) => ({
    id: p.id,
    from_token_id: p.from_token_id,
    from_name: nameOf(p.from_token_id),
    to_token_id: p.to_token_id,
    to_name: nameOf(p.to_token_id),
    prank_id: p.prank_id,
    landed: p.landed,
    revenge: p.revenge,
    points: p.points,
    created_at: p.created_at,
    real: true,
  }));
}

export async function GET() {
  // Wait for a real request before touching the database. Without this the
  // route has no dynamic dependency, so Cache Components tries to PRERENDER
  // it - the Supabase query then runs at build time and either races the
  // prerender (a logged "fetch() rejects" error) or, if it ever completes,
  // caches the response and serves a stale feed forever. `connection()` is
  // the documented opt-out (it replaces the `dynamic` export, which
  // cacheComponents rejects outright).
  await connection();

  const supabase = db();

  // Guard 1: the view. One query - the names are joined in it.
  const { data: viewRows, error: viewError } = await supabase
    .from("recent_chaos")
    .select(VIEW_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(LIMIT);

  let rows: ChaosRow[];
  if (viewError || !viewRows) {
    // Guard 2 keeps the no-address rule even on this path.
    console.warn(
      "[chaos] recent_chaos view unavailable",
      isViewMissing(viewError) ? "(not applied - reading the base tables)" : `(${viewError?.message})`,
    );
    rows = await readBaseTables(supabase);
  } else {
    rows = viewRows.map(mapViewRow);
  }

  return Response.json({
    rows,
    realCount: rows.length,
    // Hark: "if there are fewer than 3 real events, fill in with bot pranks".
    needsBotFill: rows.length < 3,
  } satisfies ChaosResponse);
}

export { BOT_FILL };
