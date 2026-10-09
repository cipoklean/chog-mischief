import { describe, expect, it } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import type { TypedDataDefinition } from 'viem';
import {
  buildActionTypedData,
  parseActionTypedData,
  recoverActionSigner,
  addressesMatch,
  newActionNonce,
  ACTION_DOMAIN,
  PRANK_TYPES,
  type ActionPayload,
} from './action-signing';

/**
 * Real secp256k1 keypairs, not mocks. A mock that returns "the right address"
 * would agree with a verifier that always says yes, which is the exact bug the
 * recover-instead-of-verify rule exists to prevent.
 */

const alice = privateKeyToAccount(
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
);
const mallory = privateKeyToAccount(
  '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
);

function sample(overrides: Partial<ActionPayload> = {}): ActionPayload {
  return {
    kind: 'prank',
    fromTokenId: 561,
    toTokenId: 1,
    prankId: 'sound-quiet',
    dodgeRoll: 0.7321,
    landed: true,
    points: 120,
    revenge: false,
    day: '2026-10-08',
    nonce: 'abc123',
    ...overrides,
  };
}

describe('the EIP-712 domain', () => {
  it('binds to Monad chain 143', () => {
    // The chain binding is the whole point of the domain: a signature made
    // here must not be replayable on another chain.
    expect(ACTION_DOMAIN.chainId).toBe(143);
  });

  it('binds to the Chog Genesis contract', () => {
    expect(ACTION_DOMAIN.verifyingContract?.toLowerCase()).toBe(
      '0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763',
    );
  });

  it('names the app, so another dapp cannot reuse the signature', () => {
    expect(ACTION_DOMAIN.name).toBe('Chog Mischief');
  });
});

describe('PRANK_TYPES', () => {
  it('declares every field the payload carries', () => {
    const names = PRANK_TYPES.Prank.map((f) => f.name);
    expect(names).toEqual([
      'kind',
      'fromTokenId',
      'toTokenId',
      'prankId',
      'dodgeRoll',
      'landed',
      'points',
      'revenge',
      'day',
      'nonce',
    ]);
  });

  it('uses uint256 for numbers, because EIP-712 has no float type', () => {
    const byName = Object.fromEntries(PRANK_TYPES.Prank.map((f) => [f.name, f.type]));
    expect(byName.fromTokenId).toBe('uint256');
    expect(byName.toTokenId).toBe('uint256');
    expect(byName.points).toBe('uint256');
    expect(byName.dodgeRoll).toBe('uint256');
    expect(byName.landed).toBe('bool');
    expect(byName.revenge).toBe('bool');
  });
});

describe('buildActionTypedData', () => {
  it('scales the roll to an integer, exactly and reversibly', () => {
    // 0.7321 cannot go on the wire as a float, so it travels as 7321 and
    // comes back divided. Four decimals is the roll's precision by
    // construction (rules.ts), so the scaling loses nothing.
    const typed = buildActionTypedData(sample()) as TypedDataDefinition;
    const message = typed.message as Record<string, unknown>;
    expect(message.dodgeRoll).toBe(7321);
    const parsed = parseActionTypedData(typed)!;
    expect(parsed.dodgeRoll).toBeCloseTo(0.7321, 4);
  });

  it('puts the whole payload on the wire', () => {
    const typed = buildActionTypedData(sample()) as TypedDataDefinition;
    const message = typed.message as Record<string, unknown>;
    expect(message).toMatchObject({
      kind: 'prank',
      fromTokenId: 561,
      toTokenId: 1,
      prankId: 'sound-quiet',
      landed: true,
      points: 120,
      revenge: false,
      day: '2026-10-08',
      nonce: 'abc123',
    });
  });
});

describe('parseActionTypedData', () => {
  it('round-trips every field it was built from', () => {
    const original = sample();
    const parsed = parseActionTypedData(buildActionTypedData(original));
    expect(parsed).toEqual(original);
  });

  it('recovers a revenge prank', () => {
    const parsed = parseActionTypedData(
      buildActionTypedData(sample({ revenge: true, points: 240 })),
    )!;
    expect(parsed.revenge).toBe(true);
    expect(parsed.points).toBe(240);
  });

  it('recovers a dodged prank with zero points', () => {
    const parsed = parseActionTypedData(
      buildActionTypedData(sample({ landed: false, points: 0 })),
    )!;
    expect(parsed.landed).toBe(false);
    expect(parsed.points).toBe(0);
  });

  it('refuses a payload with no message', () => {
    expect(
      parseActionTypedData({
        domain: ACTION_DOMAIN,
        types: PRANK_TYPES,
        primaryType: 'Prank',
      } as unknown as TypedDataDefinition),
    ).toBeNull();
  });

  it('refuses an unknown action kind', () => {
    const typed = buildActionTypedData(sample());
    const bad = { ...typed, message: { ...(typed.message as object), kind: 'steal' } };
    expect(parseActionTypedData(bad)).toBeNull();
  });

  it('refuses a non-integer token id', () => {
    const typed = buildActionTypedData(sample());
    const bad = { ...typed, message: { ...(typed.message as object), fromTokenId: 1.5 } };
    expect(parseActionTypedData(bad)).toBeNull();
  });

  it('refuses a missing nonce', () => {
    const typed = buildActionTypedData(sample());
    const { nonce, ...rest } = typed.message as Record<string, unknown>;
    expect(nonce).toBe('abc123');
    expect(parseActionTypedData({ ...typed, message: rest })).toBeNull();
  });
});

describe('signature recovery identifies WHO signed', () => {
  it('recovers the signer of a genuine signature', async () => {
    const typedData = buildActionTypedData(sample());
    const signature = await alice.signTypedData(typedData);
    const signer = await recoverActionSigner(typedData, signature);
    expect(signer).toBe(alice.address);
  });

  it('recovers a DIFFERENT address for another wallet', async () => {
    // This is the property verifyTypedData cannot give you: it returns a
    // boolean, so any valid signature "verifies" and one wallet can act as
    // another.
    const typedData = buildActionTypedData(sample());
    const mallorySignature = await mallory.signTypedData(typedData);
    const signer = await recoverActionSigner(typedData, mallorySignature);
    expect(signer).toBe(mallory.address);
    expect(addressesMatch(signer!, alice.address)).toBe(false);
  });

  it('does not recover a signer from a tampered payload', async () => {
    // Editing points must break the signature: this is the property that
    // stops a player editing the score in devtools.
    const original = buildActionTypedData(sample({ points: 120 }));
    const signature = await alice.signTypedData(original);
    const tampered = {
      ...original,
      message: { ...(original.message as object), points: 9999 },
    };

    const signer = await recoverActionSigner(tampered, signature);
    if (signer) expect(addressesMatch(signer, alice.address)).toBe(false);
  });

  it('does not recover a signer across a different domain', async () => {
    // The domain separator: the same payload signed for another chain must
    // not verify here. This is what makes chainId 143 load-bearing.
    const typedData = buildActionTypedData(sample());
    const signature = await alice.signTypedData(typedData);
    const otherChain = {
      ...typedData,
      domain: { ...ACTION_DOMAIN, chainId: 1 },
    };
    const signer = await recoverActionSigner(otherChain, signature);
    if (signer) expect(addressesMatch(signer, alice.address)).toBe(false);
  });

  it('refuses a garbage signature instead of throwing', async () => {
    const typedData = buildActionTypedData(sample());
    expect(await recoverActionSigner(typedData, '0xdeadbeef' as `0x${string}`)).toBeNull();
  });
});

describe('address comparison', () => {
  it('ignores case, since checksummed and lowercase forms differ', () => {
    expect(addressesMatch(alice.address, alice.address.toLowerCase())).toBe(true);
  });

  it('does not match two different wallets', () => {
    expect(addressesMatch(alice.address, mallory.address)).toBe(false);
  });
});

describe('newActionNonce', () => {
  it('is long enough to resist guessing', () => {
    expect(newActionNonce()).toMatch(/^[0-9a-f]{32}$/);
  });

  it('does not repeat', () => {
    const seen = new Set(Array.from({ length: 200 }, () => newActionNonce()));
    expect(seen.size).toBe(200);
  });
});
