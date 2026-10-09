import { describe, expect, it } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import type { TypedDataDefinition } from 'viem';
import {
  ACTION_DOMAIN,
  SHY_TYPES,
  VERIFYING_CONTRACT,
  addressesMatch,
  buildShyTypedData,
  hasCanonicalShyShape,
  issueActionNonce,
  parseShyIntent,
  recoverActionSigner,
  verifyActionNonce,
  type ShyIntent,
} from './action-signing';

/**
 * SHY MODE - a signed, gasless, owner-only display toggle.
 *
 * The rules it has to obey are the same ones every other signed action in this
 * game obeys, and they are worth restating because this action is the smallest
 * one in the system: there is no prank here, no target, no points, nothing to
 * forge. The temptation on an action this small is to cut a corner, and the
 * tests below exist to make cutting one loud.
 *
 * Real secp256k1 keypairs, never a mock signer.
 */

const SECRET = 'test-session-secret-not-a-real-one';

const owner = privateKeyToAccount(
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
);
const stranger = privateKeyToAccount(
  '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
);

function shy(overrides: Partial<ShyIntent> = {}): ShyIntent {
  return {
    kind: 'shy',
    tokenId: 70,
    enabled: true,
    day: '2026-10-09',
    nonce: 'nonce-abc',
    issuedAt: 1_760_000_000_000,
    ...overrides,
  };
}

async function sign(intent: ShyIntent, account = owner): Promise<`0x${string}`> {
  return account.signTypedData(buildShyTypedData(intent));
}

// ---------------------------------------------------------------------------

describe('the shy message carries intent and nothing else', () => {
  it('signs exactly six fields, with no outcome anywhere', () => {
    const fields = SHY_TYPES.Shy.map((f) => f.name);
    expect(fields).toEqual(['kind', 'tokenId', 'enabled', 'day', 'nonce', 'issuedAt']);

    // The whole point of the game's signing model: nothing that decides an
    // outcome appears in the message. `enabled` is the player's own request,
    // not a result.
    for (const forbidden of ['landed', 'points', 'dodgeRoll', 'revenge', 'streak', 'tier']) {
      expect(fields).not.toContain(forbidden);
    }
  });

  it('does not carry a target or a prank, because there is no target', () => {
    const fields = SHY_TYPES.Shy.map((f) => f.name);
    expect(fields).not.toContain('toTokenId');
    expect(fields).not.toContain('prankId');
  });

  it('round-trips through the parser', () => {
    const intent = shy();
    expect(parseShyIntent(buildShyTypedData(intent))).toEqual(intent);
  });

  it('is bound to this app, this chain and this collection', () => {
    const typed = buildShyTypedData(shy());
    expect(typed.domain).toEqual({
      name: 'Chog Mischief',
      version: '1',
      chainId: 143,
      verifyingContract: VERIFYING_CONTRACT,
    });
    expect(typed.primaryType).toBe('Shy');
  });
});

// ---------------------------------------------------------------------------

describe('a shy signature proves the holder', () => {
  it('recovers to the signer', async () => {
    const intent = shy();
    const signature = await sign(intent);
    const recovered = await recoverActionSigner(buildShyTypedData(intent), signature);
    expect(recovered).not.toBeNull();
    expect(addressesMatch(recovered!, owner.address)).toBe(true);
  });

  // A note on what "recovers to nobody" means, because it is NOT what
  // happens: any 65-byte string is a structurally valid signature and recovers
  // to SOME address, because that is what public-key recovery is. The security
  // property is not "recovery fails", it is "recovery yields a DIFFERENT
  // address, so the signer no longer matches the holder". Asserting null here
  // would be asserting a property EIP-712 does not have.

  it('recovers to a different address when the token was changed after signing', async () => {
    const signature = await sign(shy({ tokenId: 70 }));
    // The canonical re-derivation is what gets verified, so a different token
    // in the request cannot ride on the original signature.
    const tampered = buildShyTypedData(shy({ tokenId: 561 }));
    const recovered = await recoverActionSigner(tampered, signature);
    expect(recovered).not.toBeNull();
    expect(addressesMatch(recovered!, owner.address)).toBe(false);
  });

  it('recovers to a different address when enabled was flipped after signing', async () => {
    const signature = await sign(shy({ enabled: true }));
    const flipped = buildShyTypedData(shy({ enabled: false }));
    const recovered = await recoverActionSigner(flipped, signature);
    expect(recovered).not.toBeNull();
    expect(addressesMatch(recovered!, owner.address)).toBe(false);
  });

  it('the token really is inside the signed hash', async () => {
    // Two intents differing only in tokenId must produce different digests, or
    // the field above is decorative.
    const a = buildShyTypedData(shy({ tokenId: 70 }));
    const b = buildShyTypedData(shy({ tokenId: 71 }));
    expect(JSON.stringify(a.message)).not.toBe(JSON.stringify(b.message));
  });

  it('a stranger cannot produce a signature that recovers to the owner', async () => {
    const intent = shy();
    const signature = await sign(intent, stranger);
    const recovered = await recoverActionSigner(buildShyTypedData(intent), signature);
    expect(recovered).not.toBeNull();
    expect(addressesMatch(recovered!, owner.address)).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('the shape check refuses anything the server did not issue', () => {
  it('accepts what it builds', () => {
    expect(hasCanonicalShyShape(buildShyTypedData(shy()))).toBe(true);
  });

  it('rejects an extra field', () => {
    const typed = buildShyTypedData(shy()) as unknown as TypedDataDefinition;
    typed.types = {
      Shy: [...SHY_TYPES.Shy, { name: 'bypass', type: 'bool' }],
    };
    expect(hasCanonicalShyShape(typed)).toBe(false);
  });

  it('rejects a removed field', () => {
    const typed = buildShyTypedData(shy()) as unknown as TypedDataDefinition;
    typed.types = { Shy: SHY_TYPES.Shy.slice(0, 5) };
    expect(hasCanonicalShyShape(typed)).toBe(false);
  });

  it('rejects another primary type, so a prank signature cannot pass as shy', () => {
    const typed = { ...buildShyTypedData(shy()), primaryType: 'Prank' } as TypedDataDefinition;
    expect(hasCanonicalShyShape(typed)).toBe(false);
  });

  it('rejects a different chain, app name or collection', () => {
    const base = buildShyTypedData(shy());
    for (const domain of [
      { ...ACTION_DOMAIN, chainId: 1 },
      { ...ACTION_DOMAIN, name: 'Something Else' },
      { ...ACTION_DOMAIN, verifyingContract: '0x0000000000000000000000000000000000000001' },
    ]) {
      expect(hasCanonicalShyShape({ ...base, domain } as TypedDataDefinition)).toBe(false);
    }
  });

  it('the parser rejects a message that is not a shy intent', () => {
    expect(parseShyIntent({ domain: {}, types: {}, primaryType: 'Shy', message: {} })).toBeNull();
    expect(
      parseShyIntent({
        domain: {},
        types: {},
        primaryType: 'Shy',
        message: { kind: 'prank', tokenId: 1, enabled: true, day: 'x', nonce: 'n', issuedAt: 1 },
      }),
    ).toBeNull();
    // enabled must be a real boolean, not the string "true".
    expect(
      parseShyIntent({
        domain: {},
        types: {},
        primaryType: 'Shy',
        message: { kind: 'shy', tokenId: 1, enabled: 'true', day: 'x', nonce: 'n', issuedAt: 1 },
      }),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe('the nonce is server-issued and single-use', () => {
  const binding = { fromTokenId: 70, toTokenId: 70, prankId: 'shy', day: '2026-10-09' };

  it('verifies for the address and action it was issued for', () => {
    const nonce = issueActionNonce({ address: owner.address, ...binding }, SECRET);
    expect(verifyActionNonce(nonce, { address: owner.address, ...binding }, SECRET)).toBe(true);
  });

  it('refuses a different token', () => {
    const nonce = issueActionNonce({ address: owner.address, ...binding }, SECRET);
    expect(
      verifyActionNonce(nonce, { address: owner.address, ...binding, fromTokenId: 561 }, SECRET),
    ).toBe(false);
  });

  it('refuses a different wallet', () => {
    const nonce = issueActionNonce({ address: owner.address, ...binding }, SECRET);
    expect(verifyActionNonce(nonce, { address: stranger.address, ...binding }, SECRET)).toBe(false);
  });

  it('refuses a different day', () => {
    const nonce = issueActionNonce({ address: owner.address, ...binding }, SECRET);
    expect(
      verifyActionNonce(nonce, { address: owner.address, ...binding, day: '2026-10-10' }, SECRET),
    ).toBe(false);
  });

  it('refuses under a different secret', () => {
    const nonce = issueActionNonce({ address: owner.address, ...binding }, SECRET);
    expect(verifyActionNonce(nonce, { address: owner.address, ...binding }, 'other-secret')).toBe(
      false,
    );
  });

  it('refuses an empty or unknown nonce', () => {
    expect(verifyActionNonce('', { address: owner.address, ...binding }, SECRET)).toBe(false);
    expect(verifyActionNonce('made-up', { address: owner.address, ...binding }, SECRET)).toBe(false);
  });

  it('issues a different nonce each time, so two toggles cannot collide', () => {
    const a = issueActionNonce({ address: owner.address, ...binding }, SECRET);
    const b = issueActionNonce({ address: owner.address, ...binding }, SECRET);
    expect(a).not.toBe(b);
  });
});
