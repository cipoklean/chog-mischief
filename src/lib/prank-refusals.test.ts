import { describe, it, expect } from 'vitest';
import type { ApiFailure } from './prank-refusals';
import {
  mapCommitFailure,
  mapPrepareFailure,
  isNonceReplay,
  plainFailureMessage,
  isUserRejection,
} from './prank-refusals';

/**
 * Every branch of the error mapping, driven by the EXACT strings the routes
 * emit. If a route's message changes, these tests fail - which is the point:
 * the mapping is only correct while it agrees with the server.
 */
describe('mapCommitFailure', () => {
  it('maps a different-wallet signature to wrong-signer', () => {
    expect(mapCommitFailure({ status: 401, error: 'signature was from a different wallet' })).toBe(
      'wrong-signer',
    );
    expect(mapCommitFailure({ status: 401, error: 'invalid signature' })).toBe('wrong-signer');
  });

  it('maps ownership failures to not-owner', () => {
    expect(mapCommitFailure({ status: 403, error: 'you no longer hold that Chog' })).toBe('not-owner');
    expect(mapCommitFailure({ status: 403, error: 'that Chog is not yours' })).toBe('not-owner');
  });

  it('maps a replayed signature to nonce-replay', () => {
    expect(mapCommitFailure({ status: 409, error: 'this prank was already committed' })).toBe(
      'nonce-replay',
    );
    expect(mapCommitFailure({ status: 409, error: 'NONCE_USED' })).toBe('nonce-replay');
    expect(mapCommitFailure({ status: 409, error: 'NONCE_EXPIRED' })).toBe('nonce-replay');
  });

  it('maps the daily limit to daily-limit', () => {
    expect(mapCommitFailure({ status: 409, error: 'ALREADY_PRANKED_TODAY' })).toBe('daily-limit');
  });

  it('returns null for rule refusals with no matching sheet variant', () => {
    // These have no RefusalSheet variant; the flow shows a plain message.
    expect(mapCommitFailure({ status: 409, error: 'SAME_WALLET' })).toBeNull();
    expect(mapCommitFailure({ status: 409, error: 'SELF_PRANK' })).toBeNull();
    expect(mapCommitFailure({ status: 409, error: 'LEGENDARY_ALREADY_USED_THIS_WEEK' })).toBeNull();
    expect(mapCommitFailure({ status: 409, error: 'TOKEN_NOT_FOUND' })).toBeNull();
  });

  it('returns null for infrastructure failures', () => {
    expect(mapCommitFailure({ status: 500, error: 'could not record the prank' })).toBeNull();
    expect(mapCommitFailure({ status: 502, error: 'could not read ownership' })).toBeNull();
    expect(mapCommitFailure({ status: 400, error: 'invalid JSON body' })).toBeNull();
  });
});

describe('mapPrepareFailure', () => {
  it('maps the daily limit, which prepare checks before any signature', () => {
    expect(mapPrepareFailure({ status: 409, error: 'ALREADY_PRANKED_TODAY' })).toBe('daily-limit');
  });

  it('returns null for other prepare failures', () => {
    expect(mapPrepareFailure({ status: 403, error: 'this Chog cannot prank' })).toBeNull();
    expect(mapPrepareFailure({ status: 404, error: 'unknown Chog' })).toBeNull();
  });
});

describe('isNonceReplay', () => {
  it('is true exactly for the replay refusals', () => {
    expect(isNonceReplay({ status: 409, error: 'this prank was already committed' })).toBe(true);
    expect(isNonceReplay({ status: 409, error: 'ALREADY_PRANKED_TODAY' })).toBe(false);
    expect(isNonceReplay({ status: 401, error: 'invalid signature' })).toBe(false);
  });
});

describe('plainFailureMessage', () => {
  it('explains infrastructure failures without alarming the player', () => {
    expect(plainFailureMessage({ status: 500 })).toMatch(/Nothing was charged/);
    // A 502 used to echo the raw RPC detail into the player-facing copy. It is
    // now a fixed sentence naming the cause, because "rpc timeout" means
    // nothing to a player and reads like an internal error leaked.
    expect(plainFailureMessage({ status: 502, detail: 'rpc timeout' })).toMatch(/Monad is slow/);
    expect(plainFailureMessage({ status: 502, detail: 'rpc timeout' })).not.toMatch(/rpc timeout/);
  });

  it('explains the weekly legendary reset', () => {
    expect(plainFailureMessage({ status: 409, error: 'LEGENDARY_ALREADY_USED_THIS_WEEK' })).toMatch(
      /once a week/,
    );
  });

  it('returns null when there is nothing specific to say', () => {
    expect(plainFailureMessage({ status: 400, error: 'invalid JSON body' })).toBeNull();
  });
});

describe('isUserRejection', () => {
  it('recognises every wallet rejection phrasing', () => {
    for (const msg of [
      'User rejected the request',
      'user denied transaction signature',
      'The request was rejected',
    ]) {
      expect(isUserRejection(new Error(msg))).toBe(true);
    }
  });

  it('does not treat real failures as a cancellation', () => {
    expect(isUserRejection(new Error('network error'))).toBe(false);
    expect(isUserRejection(new Error('insufficient funds'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// A 502 is the RPC being slow, not the player losing their Chog.
// ---------------------------------------------------------------------------

describe("an unreachable chain reads as a retry, not a loss", () => {
  const slow: ApiFailure = {
    status: 502,
    error: "could not read ownership: rpc error",
  };

  it("is never mapped to a refusal variant", () => {
    // not-owner would tell a holder they lost their NFT. That is the exact
    // wrong conclusion to draw from a public endpoint timing out.
    expect(mapCommitFailure(slow)).toBeNull();
    expect(mapPrepareFailure(slow)).toBeNull();
  });

  it("says Monad is slow and that nothing was used up", () => {
    const message = plainFailureMessage(slow);
    expect(message).toMatch(/Monad is slow/i);
    expect(message).toMatch(/try again/i);
    // The reassurance that matters: the Chog is intact and the daily prank is
    // still available.
    expect(message).toMatch(/still yours/i);
    expect(message).toMatch(/not used/i);
  });

  it("does not leak the RPC error text into the player-facing copy", () => {
    expect(plainFailureMessage(slow)).not.toContain("rpc error");
  });

  it("keeps the generic message for a 500, which IS a failed write", () => {
    const write: ApiFailure = { status: 500, error: "could not save the toggle" };
    expect(plainFailureMessage(write)).toMatch(/went wrong/i);
    expect(plainFailureMessage(write)).not.toMatch(/Monad is slow/i);
  });

  it("still reports a real ownership loss as not-owner", () => {
    // The distinction matters in both directions: a 403 from a successful read
    // is a genuine loss and must keep its own wording.
    expect(mapCommitFailure({ status: 403, error: "you no longer hold that Chog" })).toBe(
      "not-owner",
    );
  });
});
