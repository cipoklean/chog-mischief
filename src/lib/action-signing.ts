/**
 * Signed-action helpers.
 *
 * Every state-changing action in this game is proved by a SIGNATURE over a
 * message the server builds, never by a transaction. Three consequences shape
 * this file:
 *
 * 1. The server is the one that decides WHAT was signed. The client sends a
 *    nonce and the target; the server derives the prank, the roll, the day and
 *    the points, then asks the wallet to sign that exact payload. If the client
 *    chose the prank or the score, signing would prove nothing.
 * 2. The signature must be recoverable to the token's CURRENT owner, re-read
 *    from the chain. `ownerOf` in the message is stale the moment it is signed.
 * 3. The signature is stored, so anyone can re-derive the message from the row
 *    and check it. That is what makes the log public and verifiable.
 *
 * Gasless throughout: signing a message costs nothing and moves no tokens.
 */

import { getAddress } from 'viem';

/** Domain separator - binds these signatures to this app, not to any other dapp. */
export const SIWE_DOMAIN = 'chogmischief.xyz';
export const SIWE_CHAIN_ID = 143; // Monad

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
 * Canonical serialisation.
 *
 * Every field is length-prefixed and separated, so no combination of values can
 * be re-split into a different message ("1,23" vs "12,3"). Numbers are sent as
 * fixed-width strings so 1.50 and 1.5 cannot produce two different messages for
 * the same logical action.
 */
export function canonicalAction(p: ActionPayload): string {
  const parts = [
    p.kind,
    String(p.fromTokenId),
    String(p.toTokenId),
    p.prankId,
    p.dodgeRoll.toFixed(4),
    p.landed ? '1' : '0',
    String(p.points),
    p.revenge ? '1' : '0',
    p.day,
    p.nonce,
  ];
  return parts.map((part) => `${part.length}:${part}`).join('|');
}

/** The exact message the wallet is asked to sign. */
export function buildActionMessage(p: ActionPayload): string {
  const verb = p.kind === 'prank' ? 'prank' : 'clean';
  const outcome = p.landed ? 'it landed' : 'the target dodged';
  return [
    `${SIWE_DOMAIN} wants you to ${verb} with your Chog`,
    '',
    `Chog:     #${p.fromTokenId}`,
    `Target:   #${p.toTokenId}`,
    `Prank:    ${p.prankId}`,
    `Result:   ${outcome} (roll ${p.dodgeRoll.toFixed(4)})`,
    `Points:   ${p.points}${p.revenge ? ' (revenge x2)' : ''}`,
    `Day:      ${p.day}`,
    '',
    'This is gasless. It costs you nothing and moves no tokens.',
    `Nonce: ${p.nonce}`,
    `Chain: ${SIWE_CHAIN_ID} (Monad)`,
  ].join('\n');
}

/** Parse a message back into its payload, for replay and verification. */
export function parseActionMessage(message: string): ActionPayload | null {
  const lines = message.split('\n');
  const nonceLine = lines.find((l) => l.startsWith('Nonce: '));
  if (!nonceLine) return null;

  const pick = (label: string) => {
    const line = lines.find((l) => l.startsWith(label));
    return line ? line.slice(label.length).trim() : null;
  };

  const from = pick('Chog:     #');
  const to = pick('Target:   #');
  const prankId = pick('Prank:    ');
  const result = pick('Result:   ');
  const points = pick('Points:   ');
  const day = pick('Day:      ');

  if (!from || !to || !prankId || !result || !points || !day) return null;

  const rollMatch = /roll (\d+\.\d{4})/.exec(result);
  if (!rollMatch) return null;
  const landed = result.startsWith('it landed');

  const pointsMatch = /^(\d+)/.exec(points);
  if (!pointsMatch) return null;
  const revenge = points.includes('revenge');

  const isClean = message.includes('to clean with your Chog');
  const kind: ActionKind = isClean ? 'clean' : 'prank';

  return {
    kind,
    fromTokenId: Number(from),
    toTokenId: Number(to),
    prankId,
    dodgeRoll: Number(rollMatch[1]),
    landed,
    points: Number(pointsMatch[1]),
    revenge,
    day,
    nonce: nonceLine.slice('Nonce: '.length).trim(),
  };
}

/**
 * Recover the signer of a signature over `message`.
 *
 * `viem`'s verifyMessage returns a BOOLEAN, so it would accept ANY valid
 * signature and let one wallet act as another. Recovering the address and
 * comparing it is the only version that answers "who signed".
 */
export async function recoverActionSigner(
  message: string,
  signature: `0x${string}`,
): Promise<string | null> {
  const { recoverMessageAddress } = await import('viem');
  try {
    const address = await recoverMessageAddress({ message, signature });
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