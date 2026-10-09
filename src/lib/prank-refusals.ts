/**
 * Commit/prepare error -> RefusalSheet variant mapping.
 *
 * WHY THIS IS PURE AND SEPARATE: the prank flow's error handling is the one
 * place where an HTTP failure becomes player-facing copy, and getting it
 * wrong shows the player the wrong words for what happened ("chickened out"
 * when their wallet simply hit the daily limit). Keeping the mapping a pure
 * function of {status, error} means every branch is unit-tested without a
 * server, and the flow component stays about flow.
 *
 * The five variants come from STATES.md §4 and are the ONLY ones
 * RefusalSheet renders. Anything that does not map to one of them is shown
 * as a plain inline error instead — a refusal sheet with the wrong emoji is
 * worse than no sheet.
 */

export type RefusalKind =
  | 'rejected'
  | 'wrong-signer'
  | 'not-owner'
  | 'nonce-replay'
  | 'daily-limit';

/** The shape of a failed API response we can map. */
export interface ApiFailure {
  status: number;
  /** The route's machine-readable `error` field. */
  error?: string;
  detail?: string;
}

function has(error: string | undefined, ...needles: string[]): boolean {
  const e = (error ?? '').toLowerCase();
  return needles.some((n) => e.includes(n.toLowerCase()));
}

/**
 * Map a failed POST /api/prank/commit to a refusal variant.
 *
 * Status alone is ambiguous (a 403 is "not yours" OR "no longer hold it"),
 * so the route's error string is consulted too — the routes are ours and
 * their strings are stable.
 */
export function mapCommitFailure(f: ApiFailure): RefusalKind | null {
  // 401: the signature did not recover to the session wallet — either a
  // different wallet signed, or the signature was malformed.
  if (f.status === 401) return 'wrong-signer';

  // 403: the Chog left the wallet between sign and commit, or was never in
  // the session.
  if (f.status === 403) return 'not-owner';

  if (f.status === 409) {
    // A replayed signature: the exact message+signature was already
    // committed (the unique nonce index caught it), or the nonce expired.
    if (has(f.error, 'already committed') || has(f.error, 'nonce_used') || has(f.error, 'nonce_expired')) {
      return 'nonce-replay';
    }
    // The daily limit, enforced by the Postgres unique index.
    if (has(f.error, 'already_pranked_today') || has(f.error, 'already pranked today')) {
      return 'daily-limit';
    }
    // Other rule refusals (self-prank, same-wallet, legendary weekly) have
    // no matching sheet variant — see the caller's fallback.
    return null;
  }

  // 500/502 and everything else: an infrastructure problem, not a refusal.
  return null;
}

/**
 * Map a failed POST /api/prank/prepare.
 *
 * The daily limit is checked in prepare, BEFORE any signature is requested
 * (the server previews the rules), so this is where the limit surfaces in
 * the flow — and it must map to the same daily-limit sheet.
 */
export function mapPrepareFailure(f: ApiFailure): RefusalKind | null {
  if (f.status === 409 && has(f.error, 'already_pranked_today')) return 'daily-limit';
  return null;
}

/** True when the failure is a nonce replay the flow may retry once silently. */
export function isNonceReplay(f: ApiFailure): boolean {
  return mapCommitFailure(f) === 'nonce-replay';
}

/**
 * A player-visible message for failures that have no refusal variant.
 *
 * Returns null when the caller should fall back to its own generic text.
 */
export function plainFailureMessage(f: ApiFailure): string | null {
  if (f.status === 500 || f.status === 502) {
    return f.detail
      ? `Something went wrong recording that prank. Nothing was charged. (${f.detail})`
      : 'Something went wrong recording that prank. Nothing was charged.';
  }
  if (has(f.error, 'legendary_already_used_this_week')) {
    return 'That legendary is once a week. Try again after the weekly reset.';
  }
  if (has(f.error, 'same_wallet')) {
    return 'That Chog is in your own wallet — pick someone else to prank.';
  }
  if (has(f.error, 'self_prank')) {
    return 'A Chog cannot prank itself.';
  }
  return null;
}

/** The signature-cancelled case, decided client-side, never over HTTP. */
export function isUserRejection(err: unknown): boolean {
  const raw = err instanceof Error ? err.message : String(err);
  // Any phrasing of a cancellation: wallets word this differently across
  // versions and connectors ("User rejected the request", "user denied
  // transaction signature", "The request was rejected"). A real failure —
  // network, insufficient funds — contains neither word.
  return /reject|denied/i.test(raw);
}
