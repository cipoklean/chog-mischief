/**
 * Signed-action helpers (EIP-712).
 *
 * Every state-changing action in this game is proved by a SIGNATURE over
 * typed data the server builds, never by a transaction. Three consequences
 * shape this file:
 *
 * 1. The server is the one that decides WHAT was signed. The client sends a
 *    nonce and the target; the server derives the prank, the roll, the day
 *    and the points, then asks the wallet to sign that exact payload. If the
 *    client chose the prank or the score, signing would prove nothing.
 * 2. The signature must be recoverable to the token's CURRENT owner, re-read
 *    from the chain. `ownerOf` in the payload is stale the moment it is signed.
 * 3. The signature is stored, so anyone can re-derive the typed data from the
 *    row and check it. That is what makes the log public and verifiable.
 *
 * ── Why EIP-712 typed data, not personal_sign ──────────────────────────────
 * Hark's spec (STATES.md and the build order) requires it, and it is the
 * better mechanism: the domain separator binds these signatures to THIS app
 * on Monad chain 143 for THIS collection, so a signature cannot be replayed
 * against another dapp, another chain, or another NFT contract. Wallets also
 * render the fields as structured rows instead of one opaque block of text,
 * which is what a player actually reads before signing.
 *
 * The domain carries `verifyingContract` = the Chog Genesis contract: a
 * signature over a prank is only ever valid for pranks in THIS collection.
 *
 * Gasless throughout: signing typed data costs nothing and moves no tokens.
 */

import { getAddress } from 'viem';
import type { TypedDataDefinition } from 'viem';

/** Human-readable app name for the EIP-712 domain. */
export const SIWE_DOMAIN = 'chogmischief.xyz';
export const SIWE_CHAIN_ID = 143; // Monad

/** The Chog Genesis contract: binds every signature to this collection. */
export const VERIFYING_CONTRACT = '0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763';

export type ActionKind = 'prank' | 'clean';

export interface ActionPayload {
  kind: ActionKind;
  fromTokenId: number;
  toTokenId: number;
  prankId: string;
  /** The roll that decided whether the target dodged, so it can be replayed. */
  dodgeRoll: number;
  landed: boolean;
  points: number;
  revenge: boolean;
  day: string;
  nonce: string;
}

/**
 * The EIP-712 domain.
 *
 * `verifyingContract` is the collection contract, so a signature is scoped
 * to pranks in this game and this collection only.
 */
export const ACTION_DOMAIN = {
  name: 'Chog Mischief',
  version: '1',
  chainId: SIWE_CHAIN_ID,
  verifyingContract: VERIFYING_CONTRACT,
} as const;

/**
 * The typed-data schema.
 *
 * `dodgeRoll` is a uint256 holding roll * 10000, because EIP-712 has no float
 * type and a float on the wire would be a source of ambiguity. The roll is a
 * 4-decimal value by construction (see rules.ts), so the scaling is exact and
 * reversible.
 */
export const PRANK_TYPES = {
  Prank: [
    { name: 'kind', type: 'string' },
    { name: 'fromTokenId', type: 'uint256' },
    { name: 'toTokenId', type: 'uint256' },
    { name: 'prankId', type: 'string' },
    { name: 'dodgeRoll', type: 'uint256' },
    { name: 'landed', type: 'bool' },
    { name: 'points', type: 'uint256' },
    { name: 'revenge', type: 'bool' },
    { name: 'day', type: 'string' },
    { name: 'nonce', type: 'string' },
  ],
} as const;

const ROLL_SCALE = 10000;

/** The payload as it goes on the wire: roll scaled to an integer. */
export interface TypedActionMessage {
  kind: string;
  fromTokenId: number;
  toTokenId: number;
  prankId: string;
  dodgeRoll: number;
  landed: boolean;
  points: number;
  revenge: boolean;
  day: string;
  nonce: string;
}

/** Build the exact typed data the wallet is asked to sign. */
export function buildActionTypedData(p: ActionPayload): TypedDataDefinition {
  const message: TypedActionMessage = {
    kind: p.kind,
    fromTokenId: p.fromTokenId,
    toTokenId: p.toTokenId,
    prankId: p.prankId,
    dodgeRoll: Math.round(p.dodgeRoll * ROLL_SCALE),
    landed: p.landed,
    points: p.points,
    revenge: p.revenge,
    day: p.day,
    nonce: p.nonce,
  };

  return {
    domain: ACTION_DOMAIN,
    types: PRANK_TYPES,
    primaryType: 'Prank',
    message: { ...message },
  };
}

/**
 * Parse signed typed data back into its payload, for replay and verification.
 *
 * Returns null when the shape is wrong, so the caller refuses rather than
 * guessing. This is the EIP-712 equivalent of the old message parser: the
 * server reads the action out of what was SIGNED, never out of the request.
 */
export function parseActionTypedData(
  typed: TypedDataDefinition,
): ActionPayload | null {
  const m = typed.message as Partial<TypedActionMessage> | undefined;
  if (!m) return null;

  const kind = m.kind;
  if (kind !== 'prank' && kind !== 'clean') return null;

  const fromTokenId = Number(m.fromTokenId);
  const toTokenId = Number(m.toTokenId);
  const points = Number(m.points);
  const dodgeRoll = Number(m.dodgeRoll);
  if (!Number.isInteger(fromTokenId) || !Number.isInteger(toTokenId)) return null;
  if (!Number.isInteger(points) || points < 0) return null;
  if (!Number.isInteger(dodgeRoll)) return null;

  const prankId = typeof m.prankId === 'string' ? m.prankId : '';
  const day = typeof m.day === 'string' ? m.day : '';
  const nonce = typeof m.nonce === 'string' ? m.nonce : '';
  if (!prankId || !day || !nonce) return null;

  return {
    kind,
    fromTokenId,
    toTokenId,
    prankId,
    dodgeRoll: dodgeRoll / ROLL_SCALE,
    landed: m.landed === true,
    points,
    revenge: m.revenge === true,
    day,
    nonce,
  };
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
    const address = await recoverTypedDataAddress({
      ...typedData,
      signature,
    });
    return getAddress(address);
  } catch {
    return null;
  }
}

export function addressesMatch(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** Fresh nonce for a signed action. Random, not sequential. */
export function newActionNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
