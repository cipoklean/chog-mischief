/**
 * POST /api/auth/verify — verify a SIWE signature and open a session.
 *
 * The chain of trust, in order, and every step is required:
 *   1. the nonce was issued, is unused, is unexpired, and belongs to THIS address
 *   2. the signature over the message recovers to THIS address
 *   3. the address actually holds a Chog, re-read from the chain right now
 *
 * Step 3 is the one that makes the NFT essential: a valid signature proves
 * control of a wallet, and only the chain can prove that wallet is a player.
 *
 * The nonce is consumed only after every check passes, so a failed attempt does
 * not burn a legitimate user's pending nonce.
 */

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { parseSiweMessage, signSession, verifySiweSignature } from '@/lib/siwe';
import { consumeNonce, peekNonce } from '@/lib/nonce-store';
import { findHeldTokens } from '@/lib/chain-read';


const SESSION_COOKIE = 'chog_session';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export async function POST(request: Request) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: 'server not configured: SESSION_SECRET is unset' },
      { status: 500 },
    );
  }

  let body: { message?: string; signature?: string };
  try {
    body = (await request.json()) as { message?: string; signature?: string };
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const { message, signature } = body;
  if (!message || !signature) {
    return NextResponse.json({ error: 'message and signature are required' }, { status: 400 });
  }

  const parsed = parseSiweMessage(message);
  if (!parsed?.nonce || !parsed.address || !ADDRESS_RE.test(parsed.address)) {
    return NextResponse.json({ error: 'malformed sign-in message' }, { status: 400 });
  }

  const address = parsed.address;

  // 1. nonce
  const nonceCheck = await peekNonce(parsed.nonce, address);
  if (!nonceCheck.ok) {
    return NextResponse.json({ error: nonceCheck.reason }, { status: 401 });
  }

  // 2. signature
  const sig = await verifySiweSignature({
    message,
    signature: signature as `0x${string}`,
    expectedAddress: address,
  });
  if (!sig.ok) {
    return NextResponse.json({ error: sig.reason ?? 'invalid signature' }, { status: 401 });
  }

  // 3. does this address actually hold a Chog?
  let tokenIds: number[];
  try {
    tokenIds = await findHeldTokens(address);
  } catch (err) {
    return NextResponse.json(
      { error: `could not read holdings: ${err instanceof Error ? err.message : 'rpc error'}` },
      { status: 502 },
    );
  }

  // Consume the nonce last: a failed ownership check should not burn it.
  if (!(await consumeNonce(parsed.nonce))) {
    return NextResponse.json({ error: 'nonce already consumed' }, { status: 401 });
  }

  if (tokenIds.length === 0) {
    return NextResponse.json(
      {
        error: 'no_chogs',
        message: 'That wallet does not hold a Chog Genesis NFT.',
      },
      { status: 403 },
    );
  }

  const now = Date.now();
  const session = signSession(
    { address, tokenIds, issuedAt: now, expiresAt: now + SESSION_TTL_MS },
    secret,
  );

  const jar = await cookies();
  jar.set(SESSION_COOKIE, session, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  });

  return NextResponse.json({ address, tokenIds });
}

/** DELETE /api/auth/verify — sign out. */
export async function DELETE() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  return NextResponse.json({ ok: true });
}
