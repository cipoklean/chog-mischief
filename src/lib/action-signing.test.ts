import { describe, expect, it } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import {
  buildActionMessage,
  parseActionMessage,
  canonicalAction,
  recoverActionSigner,
  addressesMatch,
  newActionNonce,
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

describe('canonicalAction', () => {
  it('is stable for the same payload', () => {
    expect(canonicalAction(sample())).toBe(canonicalAction(sample()));
  });

  it('cannot be re-split into a different payload', () => {
    // Length-prefixing is the whole point: without it, values containing the
    // separator could be read back as different fields.
    const a = canonicalAction(sample({ prankId: 'x|y' }));
    const b = canonicalAction(sample({ prankId: 'x', day: 'y' }));
    expect(a).not.toBe(b);
  });

  it('distinguishes a changed number from an unchanged one', () => {
    expect(canonicalAction(sample({ points: 120 }))).not.toBe(
      canonicalAction(sample({ points: 1200 })),
    );
  });

  it('distinguishes landed from dodged', () => {
    expect(canonicalAction(sample({ landed: true }))).not.toBe(
      canonicalAction(sample({ landed: false })),
    );
  });
});

describe('message round-trips through parsing', () => {
  it('recovers every field it was built from', () => {
    const original = sample();
    const parsed = parseActionMessage(buildActionMessage(original));
    expect(parsed).toEqual(original);
  });

  it('recovers a revenge prank', () => {
    const original = sample({ revenge: true, points: 240 });
    const parsed = parseActionMessage(buildActionMessage(original))!;
    expect(parsed.revenge).toBe(true);
    expect(parsed.points).toBe(240);
  });

  it('recovers a dodged prank with zero points', () => {
    const original = sample({ landed: false, points: 0 });
    const parsed = parseActionMessage(buildActionMessage(original))!;
    expect(parsed.landed).toBe(false);
    expect(parsed.points).toBe(0);
  });

  it('returns null for something that is not an action message', () => {
    expect(parseActionMessage('hello world')).toBeNull();
    expect(parseActionMessage('')).toBeNull();
  });
});

describe('signature recovery identifies WHO signed', () => {
  it('recovers the signer of a genuine signature', async () => {
    const message = buildActionMessage(sample());
    const signature = await alice.signMessage({ message });
    const signer = await recoverActionSigner(message, signature);
    expect(signer).toBe(alice.address);
  });

  it('recovers a DIFFERENT address for another wallet', async () => {
    // This is the property verifyMessage cannot give you: it returns a boolean,
    // so any valid signature "verifies" and one wallet can act as another.
    const message = buildActionMessage(sample());
    const mallorySignature = await mallory.signMessage({ message });
    const signer = await recoverActionSigner(message, mallorySignature);
    expect(signer).toBe(mallory.address);
    expect(addressesMatch(signer!, alice.address)).toBe(false);
  });

  it('does not recover a signer from a tampered message', async () => {
    const original = buildActionMessage(sample({ points: 120 }));
    const signature = await alice.signMessage({ message: original });
    const tampered = original.replace('120', '9999');
    expect(tampered).not.toBe(original);

    const signer = await recoverActionSigner(tampered, signature);
    // Either recovery fails outright or it yields some other address. What it
    // must never do is yield alice's address over the edited message.
    if (signer) expect(addressesMatch(signer, alice.address)).toBe(false);
  });

  it('refuses a garbage signature instead of throwing', async () => {
    const message = buildActionMessage(sample());
    expect(await recoverActionSigner(message, '0xdeadbeef' as `0x${string}`)).toBeNull();
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