import { describe, it, expect } from 'vitest';
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
    expect(plainFailureMessage({ status: 502, detail: 'rpc timeout' })).toMatch(/rpc timeout/);
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
