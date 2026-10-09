import { connection } from 'next/server';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifySession } from '@/lib/siwe';
import { db } from '@/lib/db';
import { loadGameState } from '@/lib/game-state';
import {
  buildActionTypedData,
  issueActionNonce,
  type ActionIntent,
} from '@/lib/action-signing';

/**
 * POST /api/clean/prepare - build the typed data for cleaning one overlay.
 *
 * The clean is the other half of the revenge loop: a Chog that got pranked
 * can wipe the overlay off its art, once a day, with a gasless signature.
 * Same shape as the prank pair, and the same rule: the server decides, the
 * signature proves, the client never does.
 *
 * `prankId` here is the PRANK ROW id (a uuid), not the catalogue prank id:
 * that is what overlays_active references, and it is what makes the clean
 * refer to one specific hit rather than a prank type.
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

  let body: { tokenId?: number; prankId?: string };
  try {
    body = (await request.json()) as { tokenId?: number; prankId?: string };
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const { tokenId, prankId } = body;
  if (tokenId === undefined || !Number.isInteger(tokenId) || !prankId) {
    return NextResponse.json({ error: 'tokenId and prankId are required' }, { status: 400 });
  }
  const activeToken: number = tokenId;
  if (!session.tokenIds.includes(activeToken)) {
    return NextResponse.json({ error: 'this Chog cannot clean' }, { status: 403 });
  }

  // The overlay must actually be on this Chog right now.
  const state = await loadGameState(activeToken, activeToken);
  const overlay = state.overlays.find((o) => o.prankId === prankId);
  if (!overlay || overlay.tokenId !== activeToken) {
    return NextResponse.json({ error: 'NO_OVERLAY_TO_CLEAN' }, { status: 409 });
  }

  // The prank row, for the response the UI shows.
  const supabase = db();
  const { data: prankRow } = await supabase
    .from('pranks')
    .select('id, from_token_id, prank_id, caption')
    .eq('id', prankId)
    .maybeSingle();

  // Server-issued nonce, bound to this exact action, recorded with a 5-minute
  // expiry. /commit verifies the binding and consumes it exactly once.
  const now = Date.now();
  const day = new Date(now).toISOString().slice(0, 10);
  const nonce = issueActionNonce(
    {
      address: session.address,
      fromTokenId: tokenId,
      toTokenId: tokenId,
      prankId,
      day,
    },
    secret,
  );

  const { error: nonceError } = await supabase.from('nonces').insert({
    nonce,
    address: session.address.toLowerCase(),
    expires_at: new Date(now + ACTION_NONCE_TTL_MS).toISOString(),
    used_at: null,
  });
  if (nonceError) {
    return NextResponse.json(
      { error: 'could not issue a nonce', detail: nonceError.message },
      { status: 500 },
    );
  }

  // Intent only: no outcome fields, so there is nothing to forge.
  const intent: ActionIntent = {
    kind: 'clean',
    fromTokenId: tokenId,
    toTokenId: tokenId,
    prankId,
    day,
    nonce,
    issuedAt: now,
  };

  return NextResponse.json({
    typedData: buildActionTypedData(intent),
    nonce,
    intent,
    preview: {
      caption: prankRow?.caption ?? overlay.caption ?? '',
      attackerTokenId: prankRow?.from_token_id ?? null,
    },
  });
}
