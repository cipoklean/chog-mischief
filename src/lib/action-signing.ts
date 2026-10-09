/**
 * Signed-action helpers (EIP-712, INTENT ONLY).
 *
 * Every state-changing action in this game is proved by a SIGNATURE over
 * typed data the server builds, never by a transaction. The rule this file
 * exists to enforce, in one line:
 *
 *   THE SIGNATURE PROVES INTENT. THE SERVER DECIDES THE OUTCOME.
 *
 * - Why the schema is intent-only -------------------------------------------------
 * The typed data carries kind, fromTokenId, toTokenId, prankId, day, nonce
 * and issuedAt. It carries NO landed, revenge, dodgeRoll or points, because
 * a field in the signed message is a field the CLIENT chose. The previous
 * shape put the outcome in the message, which gave two attacks:
 *
 *   (a) FORGERY - build typed data with landed:true, revenge:true, sign it
 *       with a wallet that holds the Chog. The signature recovers to them
 *       and the commit accepts it: a guaranteed hit at 2x.
 *   (b) REROLL - the outcome is in the message the wallet shows. See a
 *       miss, reject the signature, re-prepare, repeat until it hits.
 *
 * Both are gone: the outcome is computed AFTER verification from a
 * deterministic HMAC of (from, to, day), so the same target on the same day
 * always produces the same result no matter how many times anyone signs.
 *
 * The nonce is issued SERVER-SIDE and bound to the action (see
 * issueActionNonce), so it cannot be reused across a different target, prank
 * or day, and /commit consumes it exactly once.
 *
 * Gasless throughout: signing typed data costs nothing and moves no tokens.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { getAddress } from 'viem';
import type { TypedDataDefinition } from 'viem';

/** Human-readable app name for the EIP-712 domain. */
export const SIWE_DOMAIN = 'chogmischief.xyz';
export const SIWE_CHAIN_ID = 143; // Monad

/** The Chog Genesis contract: binds every signature to this collection. */
export const VERIFYING_CONTRACT = '0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763';

export type ActionKind = 'prank' | 'clean' | 'shy';

/**
 * What the player is asking for. Every field the outcome used to be is gone.
 */
export interface ActionIntent {
  kind: ActionKind;
  fromTokenId: number;
  toTokenId: number;
  prankId: string;
  day: string;
  nonce: string;
  issuedAt: number;
}

/**
 * The EIP-712 domain. `verifyingContract` is the collection contract, so a
 * signature is scoped to pranks in this game and this collection only.
 */
export const ACTION_DOMAIN = {
  name: 'Chog Mischief',
  version: '1',
  chainId: SIWE_CHAIN_ID,
  verifyingContract: VERIFYING_CONTRACT,
} as const;

/** The typed-data schema: intent only, no outcome fields. */
export const PRANK_TYPES = {
  Prank: [
    { name: 'kind', type: 'string' },
    { name: 'fromTokenId', type: 'uint256' },
    { name: 'toTokenId', type: 'uint256' },
    { name: 'prankId', type: 'string' },
    { name: 'day', type: 'string' },
    { name: 'nonce', type: 'string' },
    { name: 'issuedAt', type: 'uint256' },
  ],
} as const;

// ---------------------------------------------------------------------------
// SHY MODE
// ---------------------------------------------------------------------------

/**
 * A separate schema, deliberately NOT a reuse of `Prank`.
 *
 * Shy mode has no target and no prank: it is "hide the overlays on MY Chog".
 * Reusing the Prank schema would mean asking a wallet to sign a message
 * containing a `toTokenId` and a `prankId` that do not mean anything, so the
 * signer would be shown two fields that are lies. It would also leave the
 * prank parse path able to accept a shy signature, or vice versa.
 *
 * It carries the same three guarantees as every other signed action: the
 * domain binds it to this app, this chain and this collection; the schema
 * holds intent only, with no outcome field; and the nonce is issued
 * server-side and bound to (address, token, day) so it cannot be replayed.
 */
export const SHY_TYPES = {
  Shy: [
    { name: 'kind', type: 'string' },
    { name: 'tokenId', type: 'uint256' },
    { name: 'enabled', type: 'bool' },
    { name: 'day', type: 'string' },
    { name: 'nonce', type: 'string' },
    { name: 'issuedAt', type: 'uint256' },
  ],
} as const;

/** What a player is asking for with Shy mode. */
export interface ShyIntent {
  kind: 'shy';
  tokenId: number;
  /** true = hide my overlays, false = show them again. */
  enabled: boolean;
  day: string;
  nonce: string;
  issuedAt: number;
}

export function buildShyTypedData(intent: ShyIntent): TypedDataDefinition {
  return {
    domain: ACTION_DOMAIN,
    types: SHY_TYPES,
    primaryType: 'Shy',
    message: {
      kind: intent.kind,
      tokenId: intent.tokenId,
      enabled: intent.enabled,
      day: intent.day,
      nonce: intent.nonce,
      issuedAt: intent.issuedAt,
    },
  };
}

export function parseShyIntent(typed: TypedDataDefinition): ShyIntent | null {
  const m = typed.message as Record<string, unknown> | undefined;
  if (!m) return null;
  if (m.kind !== 'shy') return null;

  const tokenId = Number(m.tokenId);
  const issuedAt = Number(m.issuedAt);
  if (!Number.isInteger(tokenId) || !Number.isInteger(issuedAt)) return null;
  if (typeof m.enabled !== 'boolean') return null;

  const day = typeof m.day === 'string' ? m.day : '';
  const nonce = typeof m.nonce === 'string' ? m.nonce : '';
  if (!day || !nonce) return null;

  return { kind: 'shy', tokenId, enabled: m.enabled, day, nonce, issuedAt };
}

export function hasCanonicalShyShape(typed: TypedDataDefinition): boolean {
  if (typed.primaryType !== 'Shy') return false;
  const domain = typed.domain as Record<string, unknown> | undefined;
  if (!domain) return false;
  if (domain.name !== ACTION_DOMAIN.name) return false;
  if (domain.version !== ACTION_DOMAIN.version) return false;
  if (Number(domain.chainId) !== SIWE_CHAIN_ID) return false;
  if (String(domain.verifyingContract ?? '').toLowerCase() !== VERIFYING_CONTRACT) return false;

  const types = typed.types as Record<string, readonly { name: string; type: string }[]> | undefined;
  const fields = types?.Shy;
  if (!fields) return false;
  const expected = SHY_TYPES.Shy;
  if (fields.length !== expected.length) return false;
  for (let i = 0; i < expected.length; i += 1) {
    if (fields[i].name !== expected[i].name || fields[i].type !== expected[i].type) return false;
  }
  return true;
}

/** Build the exact typed data the wallet is asked to sign. */
export function buildActionTypedData(intent: ActionIntent): TypedDataDefinition {
  const message = {
    kind: intent.kind,
    fromTokenId: intent.fromTokenId,
    toTokenId: intent.toTokenId,
    prankId: intent.prankId,
    day: intent.day,
    nonce: intent.nonce,
    issuedAt: intent.issuedAt,
  };
  return {
    domain: ACTION_DOMAIN,
    types: PRANK_TYPES,
    primaryType: 'Prank',
    message: { ...message },
  };
}

/**
 * Parse signed typed data back into its intent, for replay and verification.
 *
 * Returns null when the shape is wrong, so the caller refuses rather than
 * guessing. The server reads the intent out of what was SIGNED, never out of
 * the request body. There is deliberately no landed/revenge/dodgeRoll/points
 * field to read: the schema does not have them, so a client cannot supply
 * one.
 */
export function parseActionIntent(typed: TypedDataDefinition): ActionIntent | null {
  const m = typed.message as Record<string, unknown> | undefined;
  if (!m) return null;

  const kind = m.kind;
  if (kind !== 'prank' && kind !== 'clean') return null;

  const fromTokenId = Number(m.fromTokenId);
  const toTokenId = Number(m.toTokenId);
  const issuedAt = Number(m.issuedAt);
  if (!Number.isInteger(fromTokenId) || !Number.isInteger(toTokenId)) return null;
  if (!Number.isInteger(issuedAt)) return null;

  const prankId = typeof m.prankId === 'string' ? m.prankId : '';
  const day = typeof m.day === 'string' ? m.day : '';
  const nonce = typeof m.nonce === 'string' ? m.nonce : '';
  if (!prankId || !day || !nonce) return null;

  return { kind, fromTokenId, toTokenId, prankId, day, nonce, issuedAt };
}

/**
 * True when the typed data's DOMAIN and TYPES are exactly what this server
 * issues.
 *
 * A client that adds a field (say `landed`) changes the types, which changes
 * the type hash, which breaks the signature over the canonical re-derivation
 * in /commit. Checking the shape here turns that from a silent acceptance
 * into a clear refusal.
 */
export function hasCanonicalShape(typed: TypedDataDefinition): boolean {
  const domain = typed.domain as Record<string, unknown> | undefined;
  if (!domain) return false;
  if (domain.name !== ACTION_DOMAIN.name) return false;
  if (domain.version !== ACTION_DOMAIN.version) return false;
  if (Number(domain.chainId) !== SIWE_CHAIN_ID) return false;
  if (String(domain.verifyingContract ?? '').toLowerCase() !== VERIFYING_CONTRACT) return false;
  if (typed.primaryType !== 'Prank') return false;

  const types = typed.types as Record<string, readonly { name: string; type: string }[]> | undefined;
  const fields = types?.Prank;
  if (!fields) return false;
  const expected = PRANK_TYPES.Prank;
  if (fields.length !== expected.length) return false;
  for (let i = 0; i < expected.length; i += 1) {
    if (fields[i].name !== expected[i].name || fields[i].type !== expected[i].type) return false;
  }
  return true;
}

/**
 * Recover the signer of a signature over `typedData`.
 *
 * `viem`'s verifyTypedData returns a BOOLEAN, so it would accept ANY valid
 * signature and let one wallet act as another. Recovering the address and
 * comparing it is the only version that answers "who signed".
 */
export async function recoverActionSigner(
  typedData: TypedDataDefinition,
  signature: `0x${string}`,
): Promise<string | null> {
  const { recoverTypedDataAddress } = await import('viem');
  try {
    const address = await recoverTypedDataAddress({ ...typedData, signature });
    return getAddress(address);
  } catch {
    return null;
  }
}

export function addressesMatch(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

// ---------------------------------------------------------------------------
// The deterministic outcome
// ---------------------------------------------------------------------------

function hmacHex(secret: string, data: string): string {
  return createHmac('sha256', secret).update(data).digest('hex');
}

/**
 * The dodge roll for an action, 0..1, DETERMINISTIC.
 *
 * HMAC(SESSION_SECRET, fromTokenId|toTokenId|day) mapped to 0..1. Because it
 * is a pure function of the key and the three inputs, the same target on the
 * same day ALWAYS produces the same roll - so there is nothing to reroll,
 * and a player who rejects a signature and signs again gets the identical
 * result. The secret means nobody can predict or search for a target that
 * will dodge in their favour.
 */
export function deterministicRoll(
  secret: string,
  fromTokenId: number,
  toTokenId: number,
  day: string,
): number {
  const hex = hmacHex(secret, `${fromTokenId}|${toTokenId}|${day}`).slice(0, 16);
  const value = BigInt(`0x${hex}`);
  return Number(value) / 2 ** 64;
}

// ---------------------------------------------------------------------------
// Server-issued, action-bound nonces
// ---------------------------------------------------------------------------

/** What an action nonce is bound to. All five parts must match at commit. */
export interface NonceBinding {
  address: string;
  fromTokenId: number;
  toTokenId: number;
  prankId: string;
  day: string;
}

const NONCE_SEPARATOR = '.';

function bindingKey(b: NonceBinding, secret: string): string {
  return hmacHex(
    secret,
    [
      b.address.toLowerCase(),
      String(b.fromTokenId),
      String(b.toTokenId),
      b.prankId,
      b.day,
    ].join('|'),
  );
}

/**
 * Issue a nonce for one specific action.
 *
 * The nonce is `<32 random hex>.<64 hex binding>`. The random part makes it
 * unguessable and unique; the binding part is an HMAC of the action, so
 * /commit can verify the nonce was issued for THIS (address, from, to,
 * prankId, day) without storing the binding anywhere. The nonces table still
 * enforces single use and expiry exactly as before.
 */
export function issueActionNonce(b: NonceBinding, secret: string): string {
  const random = randomBytes(16).toString('hex');
  return `${random}${NONCE_SEPARATOR}${bindingKey(b, secret)}`;
}

/**
 * Verify a nonce was issued for this exact action, in constant time.
 *
 * An unknown, expired, used or mismatched nonce is refused - the caller
 * maps every one of those to the nonce-replay refusal.
 */
export function verifyActionNonce(nonce: string, b: NonceBinding, secret: string): boolean {
  const idx = nonce.lastIndexOf(NONCE_SEPARATOR);
  if (idx <= 0) return false;
  const presented = nonce.slice(idx + 1);
  const expected = bindingKey(b, secret);
  if (presented.length !== expected.length) return false;
  // Equal-length buffers (refused above otherwise), so timingSafeEqual is safe.
  return timingSafeEqual(Buffer.from(presented, 'hex'), Buffer.from(expected, 'hex'));
}
