import { describe, expect, it } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import type { TypedDataDefinition } from 'viem';
import {
  buildActionTypedData,
  parseActionIntent,
  hasCanonicalShape,
  recoverActionSigner,
  verifyActionNonce,
  issueActionNonce,
  deterministicRoll,
  addressesMatch,
  ACTION_DOMAIN,
  PRANK_TYPES,
  type ActionIntent,
} from './action-signing';

/**
 * The P0 tests. These exist because the outcome used to live in the signed
 * message, which let a holder forge a guaranteed hit and reroll a miss.
 *
 * Real secp256k1 keypairs, not mocks: a mock that returns "the right address"
 * agrees with a verifier that always says yes, which is exactly the bug the
 * recover-instead-of-verify rule prevents.
 */

const SECRET = 'test-session-secret-not-a-real-one';

const alice = privateKeyToAccount(
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
);
const mallory = privateKeyToAccount(
  '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
);

function intent(overrides: Partial<ActionIntent> = {}): ActionIntent {
  return {
    kind: 'prank',
    fromTokenId: 70,
    toTokenId: 3,
    prankId: 'crown-of-the-chog',
    day: '2026-10-09',
    nonce: `ab12.${'cd'.repeat(32)}`,
    issuedAt: 1_760_000_000_000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// (i) A self-built message with extra fields cannot carry an outcome
// ---------------------------------------------------------------------------

describe('the signed schema carries no outcome', () => {
  it('has exactly the intent fields, in order', () => {
    expect(PRANK_TYPES.Prank.map((f) => f.name)).toEqual([
      'kind',
      'fromTokenId',
      'toTokenId',
      'prankId',
      'day',
      'nonce',
      'issuedAt',
    ]);
  });

  it('has no landed, revenge, dodgeRoll or points field at all', () => {
    const names = PRANK_TYPES.Prank.map((f) => f.name);
    for (const forbidden of ['landed', 'revenge', 'dodgeRoll', 'points']) {
      expect(names).not.toContain(forbidden);
    }
  });

  it('a typed data with an EXTRA outcome field is not the canonical shape', () => {
    // The forgery: add landed:true to the types and the message. The shape
    // check must refuse it.
    const forged = {
      domain: ACTION_DOMAIN,
      types: {
        Prank: [...PRANK_TYPES.Prank, { name: 'landed', type: 'bool' }],
      },
      primaryType: 'Prank',
      message: {
        kind: 'prank',
        fromTokenId: 70n,
        toTokenId: 3n,
        prankId: 'crown-of-the-chog',
        day: '2026-10-09',
        nonce: 'n',
        issuedAt: 1n,
        landed: true,
      },
    } as unknown as TypedDataDefinition;
    expect(hasCanonicalShape(forged)).toBe(false);
  });

  it('a tampered domain is not the canonical shape', () => {
    const typed = buildActionTypedData(intent());
    const otherChain = { ...typed, domain: { ...ACTION_DOMAIN, chainId: 1 } };
    expect(hasCanonicalShape(otherChain as TypedDataDefinition)).toBe(false);
  });

  it('a signature over a non-canonical shape does not recover to the signer', async () => {
    // Belt and braces: even if the shape check were bypassed, the canonical
    // re-derivation in commit would fail to recover.
    // A deliberately non-canonical types object: the extra `landed` field is
    // the forgery. Typed loosely so viem's strict message inference does not
    // fight the test's intent.
    const forgedTypes: Record<string, { name: string; type: string }[]> = {
      Prank: [...PRANK_TYPES.Prank, { name: 'landed', type: 'bool' }],
    };
    const forgedMessage = {
      kind: 'prank',
      fromTokenId: 70n,
      toTokenId: 3n,
      prankId: 'crown-of-the-chog',
      day: '2026-10-09',
      nonce: 'n',
      issuedAt: 1n,
      landed: true,
    };
    const signature = await alice.signTypedData({
      domain: ACTION_DOMAIN,
      types: forgedTypes,
      primaryType: 'Prank',
      message: forgedMessage,
    });
    // Recovering against the CANONICAL re-derivation (no landed field).
    const signer = await recoverActionSigner(
      buildActionTypedData(intent({ nonce: 'n', issuedAt: 1 })),
      signature,
    );
    if (signer) expect(addressesMatch(signer, alice.address)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (ii) A nonce the server never issued is refused
// ---------------------------------------------------------------------------

describe('server-issued, action-bound nonces', () => {
  const binding = {
    address: alice.address,
    fromTokenId: 70,
    toTokenId: 3,
    prankId: 'crown-of-the-chog',
    day: '2026-10-09',
  };

  it('verifies a nonce issued for the same action', () => {
    const nonce = issueActionNonce(binding, SECRET);
    expect(verifyActionNonce(nonce, binding, SECRET)).toBe(true);
  });

  it('refuses a nonce invented by the client', () => {
    // A random hex string has no binding half.
    expect(verifyActionNonce('deadbeefdeadbeefdeadbeefdeadbeef', binding, SECRET)).toBe(false);
  });

  it('refuses a nonce bound to a DIFFERENT target', () => {
    // The reroll-style attack: reuse a nonce issued for target 3 against 999.
    const nonce = issueActionNonce(binding, SECRET);
    expect(verifyActionNonce(nonce, { ...binding, toTokenId: 999 }, SECRET)).toBe(false);
  });

  it('refuses a nonce bound to a different prank, day or address', () => {
    const nonce = issueActionNonce(binding, SECRET);
    expect(verifyActionNonce(nonce, { ...binding, prankId: 'bonk' }, SECRET)).toBe(false);
    expect(verifyActionNonce(nonce, { ...binding, day: '2026-10-10' }, SECRET)).toBe(false);
    expect(verifyActionNonce(nonce, { ...binding, address: mallory.address }, SECRET)).toBe(false);
  });

  it('refuses a nonce signed with a different secret', () => {
    const nonce = issueActionNonce(binding, SECRET);
    expect(verifyActionNonce(nonce, binding, 'another-secret')).toBe(false);
  });

  it('refuses a nonce with a tampered binding half', () => {
    const nonce = issueActionNonce(binding, SECRET);
    const random = nonce.split('.')[0];
    const tampered = `${random}.${'ff'.repeat(32)}`;
    expect(verifyActionNonce(tampered, binding, SECRET)).toBe(false);
  });

  it('never issues the same nonce twice', () => {
    const seen = new Set(Array.from({ length: 200 }, () => issueActionNonce(binding, SECRET)));
    expect(seen.size).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// (iv) The same (from, to, day) always gives the same roll
// ---------------------------------------------------------------------------

describe('the roll is deterministic', () => {
  it('returns the same roll for the same inputs', () => {
    expect(deterministicRoll(SECRET, 70, 3, '2026-10-09')).toBe(
      deterministicRoll(SECRET, 70, 3, '2026-10-09'),
    );
  });

  it('gives a different roll for a different day, target or attacker', () => {
    const base = deterministicRoll(SECRET, 70, 3, '2026-10-09');
    expect(deterministicRoll(SECRET, 70, 3, '2026-10-10')).not.toBe(base);
    expect(deterministicRoll(SECRET, 70, 4, '2026-10-09')).not.toBe(base);
    expect(deterministicRoll(SECRET, 71, 3, '2026-10-09')).not.toBe(base);
  });

  it('depends on the secret, so nobody can predict a dodge', () => {
    expect(deterministicRoll(SECRET, 70, 3, '2026-10-09')).not.toBe(
      deterministicRoll('another-secret', 70, 3, '2026-10-09'),
    );
  });

  it('stays inside 0..1 across many inputs', () => {
    for (let i = 1; i <= 200; i += 1) {
      const roll = deterministicRoll(SECRET, i, (i * 7) % 1969 + 1, '2026-10-09');
      expect(roll).toBeGreaterThanOrEqual(0);
      expect(roll).toBeLessThan(1);
    }
  });
});

// ---------------------------------------------------------------------------
// Signature recovery still identifies WHO signed
// ---------------------------------------------------------------------------

describe('signature recovery', () => {
  it('recovers the signer of a genuine intent signature', async () => {
    const typedData = buildActionTypedData(intent());
    const signature = await alice.signTypedData(typedData);
    const signer = await recoverActionSigner(typedData, signature);
    expect(signer).toBe(alice.address);
  });

  it('recovers a DIFFERENT address for another wallet', async () => {
    const typedData = buildActionTypedData(intent());
    const mallorySignature = await mallory.signTypedData(typedData);
    const signer = await recoverActionSigner(typedData, mallorySignature);
    expect(signer).toBe(mallory.address);
    expect(addressesMatch(signer!, alice.address)).toBe(false);
  });

  it('refuses a garbage signature instead of throwing', async () => {
    const typedData = buildActionTypedData(intent());
    expect(await recoverActionSigner(typedData, '0xdeadbeef' as `0x${string}`)).toBeNull();
  });
});

describe('address comparison', () => {
  it('ignores case', () => {
    expect(addressesMatch(alice.address, alice.address.toLowerCase())).toBe(true);
  });
  it('does not match two different wallets', () => {
    expect(addressesMatch(alice.address, mallory.address)).toBe(false);
  });
});
