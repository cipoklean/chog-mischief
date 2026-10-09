import { connection } from 'next/server';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifySession } from '@/lib/siwe';
import { db } from '@/lib/db';
import { loadGameState } from '@/lib/game-state';
import {
  buildActionTypedData,
  newActionNonce,
  type ActionPayload,
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

  const payload: ActionPayload = {
    kind: 'clean',
    fromTokenId: tokenId,
    toTokenId: tokenId,
    // The row id travels as prankId so the commit can re-check it.
    prankId,
    dodgeRoll: 0,
    landed: false,
    points: 0,
    revenge: false,
    day: new Date().toISOString().slice(0, 10),
    nonce: newActionNonce(),
  };

  return NextResponse.json({
    typedData: buildActionTypedData(payload),
    nonce: payload.nonce,
    payload,
    preview: {
      caption: prankRow?.caption ?? overlay.caption ?? '',
      attackerTokenId: prankRow?.from_token_id ?? null,
    },
  });
}
