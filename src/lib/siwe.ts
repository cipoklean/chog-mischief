/**
 * Chog Mischief - SIWE-style gasless sign-in.
 *
 * A wallet never pays gas here: it only SIGNS a message. The server verifies the
 * signature with viem's recoverAddress, then re-reads ownerOf from the chain
 * before granting any session, so a valid signature proves control of an address
 * and the chain read proves that address actually holds a Chog.
 *
 * Why we are not literally using the SIWE standard's domain/uri fields: they must
 * match the requesting origin exactly, which breaks local dev, preview deploys
 * and the Vercel production URL simultaneously. The binding that matters for
 * anti-replay is the nonce, and that is included and enforced.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { recoverMessageAddress } from 'viem';

export const SIWE_DOMAIN = 'chogmischief.xyz';
export const SIWE_CHAIN_ID = 143;
export const NONCE_TTL_MS = 10 * 60 * 1000;

/** EIP-4361-ish statement. Deliberately says no gas, no transaction. */
export const SIWE_STATEMENT =
  'Sign in to Chog Mischief. This is free and costs no gas. It does not send a transaction or approve anything.';

export interface SiwePayload {
  domain: string;
  address: string;
  nonce: string;
  issuedAt: string;
  expirationTime: string;
  chainId: number;
  statement: string;
}

export function newNonce(): string {
  // 16 random bytes, hex. CSPRNG, never Math.random.
  return randomBytes(16).toString('hex');
}

/** Canonical serialisation. Order is fixed so the hash is stable. */
export function serialiseSiwe(p: SiwePayload): string {
  return [
    `${p.domain} wants you to sign in with your Monad account:`,
    p.address,
    '',
    p.statement,
    '',
    `URI: https://${p.domain}`,
    'Version: 1',
    `Chain ID: ${p.chainId}`,
    `Nonce: ${p.nonce}`,
    `Issued At: ${p.issuedAt}`,
    `Expiration Time: ${p.expirationTime}`,
    '',
  ].join('\n');
}

export function buildSiweMessage(params: {
  address: string;
  nonce: string;
  now?: Date;
  ttlMs?: number;
}): { message: string; payload: SiwePayload } {
  const now = params.now ?? new Date();
  const ttl = params.ttlMs ?? NONCE_TTL_MS;
  const payload: SiwePayload = {
    domain: SIWE_DOMAIN,
    // Checksum casing is what wallets expect to see; comparison is lowercased.
    address: params.address as `0x${string}`,
    nonce: params.nonce,
    issuedAt: now.toISOString(),
    expirationTime: new Date(now.getTime() + ttl).toISOString(),
    chainId: SIWE_CHAIN_ID,
    statement: SIWE_STATEMENT,
  };
  return { message: serialiseSiwe(payload), payload };
}

/** Parse the fields we need back out of a signed message. */
export function parseSiweMessage(message: string): Partial<SiwePayload> | null {
  const out: Partial<SiwePayload> = {};
  for (const rawLine of message.split('\n')) {
    const line = rawLine.trim();
    if (line.startsWith('Nonce:')) out.nonce = line.slice(6).trim();
    else if (line.startsWith('Chain ID:')) out.chainId = Number(line.slice(9).trim());
    else if (line.startsWith('Issued At:')) out.issuedAt = line.slice(10).trim();
    else if (line.startsWith('Expiration Time:')) out.expirationTime = line.slice(16).trim();
  }
  // The address is the first non-empty line after the header sentence.
  const lines = message.split('\n');
  if (lines[1] && /^0x[0-9a-fA-F]{40}$/.test(lines[1].trim())) {
    out.address = lines[1].trim();
  }
  return out.nonce ? out : null;
}

export interface VerifyResult {
  ok: boolean;
  recovered?: `0x${string}`;
  reason?: string;
}

/**
 * Verify a signature over a SIWE message.
 *
 * `expectedAddress` is the address the client claimed. It must match the
 * recovered signer - otherwise anyone could present a valid signature from
 * their own wallet and claim to be somebody else.
 */
export async function verifySiweSignature(params: {
  message: string;
  signature: `0x${string}`;
  expectedAddress: string;
  now?: number;
}): Promise<VerifyResult> {
  // viem's verifyMessage returns a BOOLEAN, not the recovered address. To refuse
  // a signature made by a different wallet we must recover the signer ourselves
  // and compare - otherwise "the signature is valid for SOMEONE" would pass.
  let recovered: `0x${string}` | undefined;
  try {
    recovered = await recoverMessageAddress({
      message: params.message,
      signature: params.signature as `0x${string}`,
    });
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : 'bad signature' };
  }

  if (!recovered || recovered.toLowerCase() !== params.expectedAddress.toLowerCase()) {
    return { ok: false, recovered, reason: 'recovered address does not match' };
  }

  const parsed = parseSiweMessage(params.message);
  if (!parsed?.nonce) return { ok: false, recovered, reason: 'no nonce in message' };

  const now = params.now ?? Date.now();
  if (parsed.expirationTime) {
    const expiry = Date.parse(parsed.expirationTime);
    if (Number.isFinite(expiry) && now > expiry) {
      return { ok: false, recovered, reason: 'message expired' };
    }
  }

  return { ok: true, recovered };
}

/**
 * Session cookie payload. Signed with HMAC so the client cannot forge one, and
 * deliberately does NOT contain a private key or any gas-spending capability.
 */
export interface SessionPayload {
  address: string;
  tokenIds: number[];
  issuedAt: number;
  expiresAt: number;
}

export function signSession(payload: SessionPayload, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${mac}`;
}

/** Verify and decode a session cookie. Returns null on any tampering. */
export function verifySession(token: string | undefined, secret: string, now = Date.now()): SessionPayload | null {
  if (!token) return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;

  const body = token.slice(0, dot);
  const mac = token.slice(dot + 1);

  const expected = createHmac('sha256', secret).update(body).digest('base64url');

  // Constant-time compare: a timing-safe equality here stops an attacker from
  // discovering the MAC one byte at a time.
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let payload: SessionPayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload;
  } catch {
    return null;
  }
  if (typeof payload?.address !== 'string') return null;
  if (typeof payload?.expiresAt !== 'number' || now > payload.expiresAt) return null;
  if (!Array.isArray(payload?.tokenIds)) return null;
  return payload;
}
