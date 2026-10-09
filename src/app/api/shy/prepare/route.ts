import { connection } from 'next/server';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifySession } from '@/lib/siwe';
import { db } from '@/lib/db';
import { buildShyTypedData, issueActionNonce, type ShyIntent } from '@/lib/action-signing';

/**
 * POST /api/shy/prepare - build the typed data for toggling Shy mode.
 *
 * Shy mode hides the overlays sitting on a Chog's public art. Pranks still land
 * and still cost points: it is a display preference, not a defence, and the UI
 * says so. It exists because an overlay is permanent artwork attached to
 * someone's NFT and the holder gets no say in what is drawn on their token.
 *
 * Same signed-action shape as prank and clean - the server issues a nonce bound
 * to this exact action, the wallet signs intent only, and /commit verifies,
 * consumes the nonce atomically and re-checks ownership live.
 *
 * Gasless: a plain message signature, like every other action in this game.
 */

const SESSION_COOKIE = 'chog_session';

/** How long an issued action nonce stays valid. */
const ACTION_NONCE_TTL_MS = 5 * 60 * 1000;

export async function POST(request: Request) {
  await connection();

  const secret = process.env.SESSION_SECRET;
  if (!secret) return NextResponse.json({ error: 'server not configured' }, { status: 500 });

  const jar = await cookies();
  const session = verifySession(jar.get(SESSION_COOKIE)?.value, secret);
  if (!session) return NextResponse.json({ error: 'not signed in' }, { status: 401 });

  let body: { tokenId?: number; enabled?: boolean };
  try {
    body = (await request.json()) as { tokenId?: number; enabled?: boolean };
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const { tokenId, enabled } = body;
  if (tokenId === undefined || !Number.isInteger(tokenId) || typeof enabled !== 'boolean') {
    return NextResponse.json(
      { error: 'tokenId (integer) and enabled (boolean) are required' },
      { status: 400 },
    );
  }

  // Only the holder may change it. Ownership is re-read live at commit; this
  // is the cheap early check so an obvious mistake never costs a signature.
  if (!session.tokenIds.includes(tokenId)) {
    return NextResponse.json({ error: 'that Chog is not yours' }, { status: 403 });
  }

  const now = Date.now();
  const day = new Date(now).toISOString().slice(0, 10);

  // The nonce is bound to (address, token, day). There is no prank and no
  // target to bind, and inventing one to fill the shared helper would put two
  // meaningless values inside an HMAC.
  const nonce = issueActionNonce(
    { address: session.address, fromTokenId: tokenId, toTokenId: tokenId, prankId: 'shy', day },
    secret,
  );

  const supabase = db();
  const { error: nonceError } = await supabase.from('nonces').insert({
    nonce,
    address: session.address.toLowerCase(),
    expires_at: new Date(now + ACTION_NONCE_TTL_MS).toISOString(),
    used_at: null,
  });
  if (nonceError) {
    // Fail closed: an unrecorded nonce could be replayed.
    return NextResponse.json(
      { error: 'could not issue a nonce', detail: nonceError.message },
      { status: 500 },
    );
  }

  const intent: ShyIntent = {
    kind: 'shy',
    tokenId,
    enabled,
    day,
    nonce,
    issuedAt: now,
  };

  return NextResponse.json({
    typedData: buildShyTypedData(intent),
    nonce,
    intent,
    preview: {
      enabled,
      // Shown next to the signature request so nobody enables it expecting a
      // defence they are not getting.
      note: 'Pranks still land. This only hides the overlays on your Chog art.',
    },
  });
}
