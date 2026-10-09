/**
 * POST /api/prank/commit - persist a prank the player has signed.
 *
 * This route trusts NOTHING from the request body except the signature and
 * the EIP-712 typed data. Every number - which prank, whether it landed, the
 * points, the day - is re-parsed out of the typed data that was signed, then
 * the signer is recovered and matched against the Chog's CURRENT on-chain
 * owner. If any of that disagrees, the row is refused.
 *
 * Why re-parse the typed data instead of accepting the payload from /prepare:
 * the client sits between the two calls. Accepting its payload would let
 * anyone edit `landed` or `points` in the browser and get a signed-looking
 * prank for a result the rules never approved.
 *
 * The daily limit is enforced by a unique index in Postgres
 * (`pranks_daily_limit` on (from_token_id, day)), not by a check here - a check
 * in this route would race, because two simultaneous requests would both read
 * "not pranked today" and both write.
 */

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import type { TypedDataDefinition } from 'viem';
import { verifySession } from '@/lib/siwe';
import { db } from '@/lib/db';
import { getChog, getOwnerFromSnapshot } from '@/lib/chogs';
import { powersFor } from '@/game/powers';
import { getPrank } from '@/game/pranks';
import { applyPrank, weekFor } from '@/game/rules';
import { loadGameState } from '@/lib/game-state';
import {
  parseActionTypedData,
  recoverActionSigner,
  addressesMatch,
} from '@/lib/action-signing';
import { ownerOf } from '@/lib/chain-read';

const SESSION_COOKIE = 'chog_session';

export async function POST(request: Request) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'server not configured' }, { status: 500 });
  }

  const jar = await cookies();
  const raw = jar.get(SESSION_COOKIE)?.value;
  const session = raw ? verifySession(raw, secret) : null;
  if (!session) {
    return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  }

  let body: { typedData?: TypedDataDefinition; signature?: string };
  try {
    body = (await request.json()) as { typedData?: TypedDataDefinition; signature?: string };
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const { typedData, signature } = body;
  if (!typedData || !signature) {
    return NextResponse.json(
      { error: 'typedData and signature are required' },
      { status: 400 },
    );
  }

  // 1. Everything comes out of the signed typed data, not the request body.
  const payload = parseActionTypedData(typedData);
  if (!payload || payload.kind !== 'prank') {
    return NextResponse.json({ error: 'could not read the signed action' }, { status: 400 });
  }

  // 2. The signature must recover to the session's wallet.
  const signer = await recoverActionSigner(typedData, signature as `0x${string}`);
  if (!signer) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
  }
  if (!addressesMatch(signer, session.address)) {
    return NextResponse.json(
      { error: 'signature was from a different wallet' },
      { status: 401 },
    );
  }

  // 3. The attacker Chog must still be in the session...
  if (!session.tokenIds.includes(payload.fromTokenId)) {
    return NextResponse.json({ error: 'that Chog is not yours' }, { status: 403 });
  }

  // 4. ...AND still be owned by that wallet on chain, right now. The message
  //    was signed a moment ago; ownership can change between sign and commit.
  let liveOwner: string | null = null;
  try {
    liveOwner = await ownerOf(payload.fromTokenId);
  } catch (err) {
    return NextResponse.json(
      { error: `could not read ownership: ${err instanceof Error ? err.message : 'rpc error'}` },
      { status: 502 },
    );
  }
  if (!liveOwner || !addressesMatch(liveOwner, session.address)) {
    return NextResponse.json(
      { error: 'you no longer hold that Chog' },
      { status: 403 },
    );
  }

  // 5. Re-run the rules against current state. /prepare previewed this, but
  //    state moves between the two calls, and the commit is the real check.
  const attacker = getChog(payload.fromTokenId);
  if (!attacker) {
    return NextResponse.json({ error: 'unknown Chog' }, { status: 404 });
  }
  const powers = powersFor(attacker.traits);
  const prank = getPrank(payload.prankId);
  if (!prank) {
    return NextResponse.json({ error: 'unknown prank' }, { status: 400 });
  }

  const state = await loadGameState(payload.fromTokenId, payload.toTokenId);
  const applied = applyPrank(state, {
    fromTokenId: payload.fromTokenId,
    toTokenId: payload.toTokenId,
    prankId: payload.prankId,
    prankRarity: prank.rarity,
    attackerMaxRarity: powers.maxRarity,
    landed: payload.landed,
    basePoints: powers.basePoints,
    revenge: payload.revenge,
    now: Date.now(),
    day: payload.day,
    // See the note in prepare: knownTokens means "these ids exist" (proven by
    // getChog above), and walletOf must resolve each token's real owner or the
    // same-wallet rule silently never fires.
    knownTokens: new Set([payload.fromTokenId, payload.toTokenId]),
    walletOf: (tokenId) =>
      tokenId === payload.fromTokenId
        ? session.address
        : getOwnerFromSnapshot(tokenId) ?? undefined,
  });
  if (!applied.ok) {
    return NextResponse.json({ error: applied.refusal, detail: applied.detail }, { status: 409 });
  }

  const record = applied.value.record;
  const streak = applied.value.streak;

  // 6. Persist. The unique index is the real daily limit; a duplicate here
  //    returns a constraint error we surface as 409.
  const supabase = db();
  const { data: inserted, error } = await supabase
    .from('pranks')
    .insert({
      from_token_id: payload.fromTokenId,
      to_token_id: payload.toTokenId,
      prank_id: payload.prankId,
      day: payload.day,
      landed: payload.landed,
      dodge_roll: payload.dodgeRoll,
      dodge_chance: null,
      points: record.points,
      revenge: payload.revenge,
      week: weekFor(Date.now()),
      signature: signature as string,
      signer,
      signed_nonce: payload.nonce,
    })
    .select('id')
    .maybeSingle();

  if (error) {
    // Cite the constraint, not a generic message: this is the daily-limit
    // rejection and it is the most common one by far.
    const text = `${error.code ?? ''} ${error.message}`;
    if (/pranks_daily_limit/.test(text)) {
      return NextResponse.json(
        { error: 'ALREADY_PRANKED_TODAY', detail: 'that Chog has already pranked today' },
        { status: 409 },
      );
    }
    if (/pranks_nonce_unique/.test(text)) {
      return NextResponse.json(
        { error: 'this prank was already committed', detail: 'replayed signature' },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: 'could not record the prank', detail: error.message },
      { status: 500 },
    );
  }

  const rowId = inserted?.id as string | undefined;

  // 7. Derived state, written after the prank exists. These are best-effort:
  //    a failure here leaves a correct prank log with a stale streak, which
  //    is recoverable, whereas failing the request would show the player a
  //    prank that never happened.
  await Promise.allSettled([
    supabase.from('streaks').upsert(
      {
        token_id: payload.fromTokenId,
        current_streak: streak.currentStreak,
        longest_streak: streak.longestStreak,
        last_prank_day: payload.day,
        consecutive_dodges: streak.consecutiveDodges,
      },
      { onConflict: 'token_id' },
    ),
    ...(record.landed
      ? [
          supabase.from('overlays_active').insert({
            token_id: payload.toTokenId,
            prank_id: rowId ?? payload.nonce,
            caption: prank.caption,
          }),
        ]
      : []),
    ...applied.value.newBadges.map((badge) =>
      supabase.from('badges').insert({
        token_id: payload.fromTokenId,
        badge,
      }),
    ),
  ]);

  return NextResponse.json({
    ok: true,
    id: rowId ?? null,
    prank: {
      id: payload.prankId,
      name: prank.name,
      caption: prank.caption,
      landed: payload.landed,
      points: record.points,
      revenge: payload.revenge,
      streak: streak.currentStreak,
      newBadges: applied.value.newBadges,
    },
  });
}