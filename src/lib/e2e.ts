/**
 * The E2E test seam.
 *
 * Playwright's happy-path test drives the REAL flow - steps, nonce, sign,
 * commit, suspense, result - but a headless browser has no wallet, and a
 * real signature would have to come from the current on-chain owner of a
 * real Chog, which we will never ask anyone for. So the test sets a flag on
 * `window` before load and the sign step reads it here instead of calling
 * the wallet.
 *
 * SAFETY, because this ships in the browser bundle:
 * - It never touches the server's decisions. /api/prank/commit still
 *   re-parses the message, recovers the signer and re-checks live
 *   ownership. A fake signature from the flag is refused by the server
 *   exactly like any other wrong signature.
 * - It only changes WHO produces the signature string, nothing else: the
 *   nonce still comes from /prepare, the message is still the server's,
 *   the commit call is still a real fetch (which the test intercepts).
 * - The flag is only ever set by addInitScript in the Playwright suite. A
 *   judge could set it in devtools and would get a server-side refusal,
 *   which is the correct outcome.
 *
 * The alternatives were worse: a test-only route (two code paths to keep in
 * sync), or no happy-path coverage at all (the flow's state machine -
 * the part most likely to break - would be untested).
 */

interface E2EWindow {
  __CHOG_E2E__?: boolean;
  /** Make the sign step behave as if the wallet refused the signature. */
  __CHOG_E2E_REJECT__?: boolean;
  /** Make the sign step behave as if the wallet is on the wrong chain. */
  __CHOG_E2E_WRONG_CHAIN__?: boolean;
}

function flags(): E2EWindow {
  if (typeof window === 'undefined') return {};
  return window as unknown as E2EWindow;
}

/** True only in a browser that a test has explicitly armed. */
export function e2eMode(): boolean {
  return flags().__CHOG_E2E__ === true;
}

/** The wallet "refused" the signature - drives the `rejected` refusal. */
export function e2eRejected(): boolean {
  return flags().__CHOG_E2E_REJECT__ === true;
}

/** The wallet is on the wrong chain - drives the wrong-network modal. */
export function e2eWrongChain(): boolean {
  return flags().__CHOG_E2E_WRONG_CHAIN__ === true;
}

/**
 * A deterministic stand-in signature. It is NOT a valid signature of
 * anything - the server refuses it - which is exactly right: the test
 * intercepts /api/prank/commit, so this string only ever travels to the
 * mock. Deterministic (no randomness) so a test failure is reproducible.
 */
export function e2eSignature(): `0x${string}` {
  return ('0x' + 'e2e'.repeat(32)) as `0x${string}`;
}
