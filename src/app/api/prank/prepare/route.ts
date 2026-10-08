/**
 * POST /api/prank/prepare — the SERVER decides the prank, then asks for a signature.
 *
 * Why two steps instead of one: if the client chose which prank landed, whether
 * the target dodged, or how many points it scored, then signing it would prove
 * only that the player agreed to their own guess. So this route derives every
 * one of those from the token's real traits and the stored rules, and returns
 * the exact message to sign.
 *
 * Nothing is written here. The row is created only by POST /api/prank/commit,
 * after a valid signature — so an abandoned signature costs the player nothing
 * and leaves no phantom prank in the log.
 */

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifySession } from '@/lib/siwe';
import { getChog, getOwnerFromSnapshot } from '@/lib/chogs';
import { powersFor } from '@/game/powers';
import { pranksForPowers, getPrank } from '@/game/pranks';
import { validatePrank, pointsFor, dayFor, weekFor, revengeTarget } from '@/game/rules';
import { loadGameState } from '@/lib/game-state';
import { buildActionMessage, newActionNonce, type ActionPayload } from '@/lib/action-signing';

const SESSION_COOKIE = 'chog_session';

/** The roll is decided by the SERVER and stored, so a leaderboard can be replayed. */
function rollDodge(): number {
  // 4 decimal places, matching numeric(5,4) in the schema.
  return Math.floor(Math.random() * 10000) / 10000;
}

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

  let body: { toTokenId?: number; fromTokenId?: number };
  try {
    body = (await request.json()) as { toTokenId?: number; fromTokenId?: number };
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  // A wallet may hold several Chogs. The player picks which one acts; it must
  // be one they actually hold.
  const fromTokenId = Number(body.fromTokenId);
  const toTokenId = Number(body.toTokenId);
  if (!Number.isInteger(fromTokenId) || !Number.isInteger(toTokenId)) {
    return NextResponse.json({ error: 'fromTokenId and toTokenId are required' }, { status: 400 });
  }
  if (!session.tokenIds.includes(fromTokenId)) {
    // Without this the session is a wallet and the Chog is decorative, which is
    // the one failure this whole mechanic must not have.
    return NextResponse.json(
      { error: 'that Chog is not in your session', detail: 'you can only prank as a Chog you hold' },
      { status: 403 },
    );
  }

  const attacker = getChog(fromTokenId);
  const target = getChog(toTokenId);
  if (!attacker || !target) {
    return NextResponse.json({ error: 'unknown Chog' }, { status: 404 });
  }

  const state = await loadGameState(fromTokenId, toTokenId);

  const attackerPowers = powersFor(attacker.traits);
  const targetPowers = powersFor(target.traits);

  // Revenge: if this target attacked us inside the window, the multiplier applies.
  const prior = revengeTarget(state, toTokenId, Date.now());
  const revenge = prior !== null;

  const pool = pranksForPowers(
    attackerPowers,
    attackerPowers.signaturePrankId,
    attackerPowers.accessoryPrankId,
    attackerPowers.legendaryPrankId,
  );
  if (pool.length === 0) {
    return NextResponse.json({ error: 'this Chog cannot prank' }, { status: 403 });
  }

  const dodgeRoll = rollDodge();
  const landed = dodgeRoll > targetPowers.dodgeChance;

  // Preview the rule outcome WITHOUT committing, so an impossible prank is
  // refused before a signature is ever requested.
  const now = Date.now();
  const day = dayFor(now);
  const candidate = pool[Math.floor(Math.random() * pool.length)];
  const check = validatePrank(state, {
    fromTokenId,
    toTokenId,
    prankId: candidate.id,
    prankRarity: candidate.rarity,
    attackerMaxRarity: attackerPowers.maxRarity,
    landed,
    basePoints: attackerPowers.basePoints,
    revenge,
    now,
    day,
    // knownTokens is "these token ids exist", NOT "these are the tokens in my
    // session". Seeding it from the session makes every Chog outside your own
    // wallet unplayable — you could only prank Chogs you already hold, which
    // defeats the game. Existence is already proven: getChog() returned a row
    // for both ids above, before this call.
    knownTokens: new Set([fromTokenId, toTokenId]),
    // The same-wallet rule compares the two tokens' OWNERS. Returning one
    // constant address for both would refuse every prank where the target is
    // in the session, and pass everything else.
    walletOf: (tokenId) =>
      tokenId === fromTokenId ? session.address : getOwnerFromSnapshot(tokenId) ?? undefined,
  });
  if (!check.ok) {
    return NextResponse.json({ error: check.refusal, detail: check.detail }, { status: 409 });
  }

  const points = landed
    ? pointsFor(
        attackerPowers.basePoints,
        state.streaks[fromTokenId]?.currentStreak ?? 0,
        revenge,
      )
    : 0;

  const payload: ActionPayload = {
    kind: 'prank',
    fromTokenId,
    toTokenId,
    prankId: candidate.id,
    dodgeRoll,
    landed,
    points,
    revenge,
    day,
    nonce: newActionNonce(),
  };

  const message = buildActionMessage(payload);
  const target_ = getPrank(candidate.id);

  return NextResponse.json({
    message,
    nonce: payload.nonce,
    payload,
    // Enough for the UI to show what is about to happen, without trusting it.
    preview: {
      prankName: target_?.name ?? candidate.id,
      caption: target_?.caption ?? '',
      landed,
      points,
      revenge,
      week: weekFor(now),
    },
  });
}