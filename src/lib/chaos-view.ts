import type { ChaosRow } from '@/app/api/chaos/route';

/**
 * Reading the public chaos feed from the `recent_chaos` view.
 *
 * The view is the STRUCTURAL guard: it exists in the database, joins pranks
 * to both Chog names, and physically has no `signer` or `signature` column
 * - so no query written against it can leak a wallet address even by
 * accident. The route keeps its column allow-list on top as a SECOND guard,
 * which is what makes the no-address rule testable in code review rather
 * than only in the database.
 *
 * The view was applied to Supabase on 2026-10-09 (David ran
 * scripts/supabase-recent-chaos-view.sql in the dashboard SQL editor).
 *
 * This module exists so the decision logic - which error means "the view is
 * not applied yet" and how a view row maps to the API shape - is pure and
 * unit-tested, rather than living inline in a route file no test can reach.
 */

/** The ONLY columns the feed reads from the view. Names come joined. */
export const VIEW_COLUMNS =
  'id,from_token_id,from_name,to_token_id,to_name,prank_id,landed,revenge,points,created_at';

/** A row as the view returns it. */
export interface ViewRow {
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
}

/** The Postgres/PostgREST codes that mean "this relation does not exist". */
const MISSING_RELATION_CODES = new Set(['42P01', 'PGRST202']);

/**
 * True when the error means the view is not applied (yet), as opposed to a
 * transient failure. Used only to decide the LOG MESSAGE - the route falls
 * back on any error, because a correct answer from the base tables beats an
 * empty feed either way - but distinguishing them keeps the logs honest: a
 * missing view is a deploy state, a network blip is not.
 */
export function isViewMissing(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return typeof code === 'string' && MISSING_RELATION_CODES.has(code);
}

/** Map one view row to the API shape. The view already joined the names. */
export function mapViewRow(row: ViewRow): ChaosRow {
  return {
    id: row.id,
    from_token_id: row.from_token_id,
    from_name: row.from_name,
    to_token_id: row.to_token_id,
    to_name: row.to_name,
    prank_id: row.prank_id,
    landed: row.landed,
    revenge: row.revenge,
    points: row.points,
    created_at: row.created_at,
    real: true,
  };
}
