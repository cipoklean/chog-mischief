/**
 * POST /api/prank/prepare - the SERVER decides the prank, then asks for a signature.
 *
 * Why two steps instead of one: if the client chose which prank landed,
 * whether the target dodged, or how many points it scored, then signing it
 * would prove only that the player agreed to their own guess. So this route
 * derives the prank from the token's real traits and the stored rules, and
 * returns the exact INTENT to sign.
 *
 * - What this route does NOT do -------------------------------------------------
 * It does not roll, decide landed, compute points, or decide revenge. Those
 * are all decided in /commit, AFTER the signature is verified, from a
 * deterministic HMAC of (from, to, day). That is what makes the outcome
 * unknowable before signing (the 1.2s suspense is real) and unrerollable
 * after.
 *
 * - The nonce ------------------------------------------------------------------
 * Issued here, server-side, bound to this exact (address, from, to, prank,
 * day) and inserted into the nonces table with a 5-minute expiry. /commit
 * verifies the binding and consumes it exactly once.
 *
 * Nothing about the prank is written here. The row is created only by
 * /commit, after a valid signature.
 */

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifySession } from '@/lib/siwe';
import { MAX_OUTSTANDING_NONCES } from '@/lib/action-day';
import { db } from '@/lib/db';
import { getChog, getOwnerFromSnapshot } from '@/lib/chogs';
import { ownerOfWithFallback } from '@/lib/chain-read';
import { effectiveDodge, powersFor, tierRank } from '@/game/powers';
import { pranksForPowers, getPrank } from '@/game/pranks';
import { validatePrank, dayFor, weekFor } from '@/game/rules';
import { loadGameState } from '@/lib/game-state';
import {
  buildActionTypedData,
  issueActionNonce,
  type ActionIntent,
} from '@/lib/action-signing';

const SESSION_COOKIE = 'chog_session';

/** How long an issued action nonce stays valid. */
const ACTION_NONCE_TTL_MS = 5 * 60 * 1000;

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

  let body: { toTokenId?: number; fromTokenId?: number; prankId?: string };
  try {
    body = (await request.json()) as { toTokenId?: number; fromTokenId?: number; prankId?: string };
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const fromTokenId = Number(body.fromTokenId);
  const toTokenId = Number(body.toTokenId);
  if (!Number.isInteger(fromTokenId) || !Number.isInteger(toTokenId)) {
    return NextResponse.json({ error: 'fromTokenId and toTokenId are required' }, { status: 400 });
  }
  if (!session.tokenIds.includes(fromTokenId)) {
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

  const pool = pranksForPowers(
    attackerPowers,
    attackerPowers.signaturePrankId,
    attackerPowers.accessoryPrankId,
    attackerPowers.legendaryPrankId,
  );
  if (pool.length === 0) {
    return NextResponse.json({ error: 'this Chog cannot prank' }, { status: 403 });
  }

  const now = Date.now();
  const day = dayFor(now);

  // The player picks their weapon from the pranks their traits unlock; the
  // SERVER validates the choice is in the pool.
  let candidate = pool[Math.floor(Math.random() * pool.length)];
  if (body.prankId) {
    const chosen = pool.find((p) => p.id === body.prankId);
    if (!chosen) {
      return NextResponse.json(
        { error: 'PRANK_NOT_ALLOWED_FOR_TIER', detail: 'that prank is not unlocked for this Chog' },
        { status: 409 },
      );
    }
    candidate = chosen;
  }

  // Preview the RULES only - no outcome. An impossible prank is refused
  // before a signature is ever requested, which is where the daily limit
  // surfaces (Hark's spec: checked here, before any signature).
  const check = await validatePrank(state, {
    fromTokenId,
    toTokenId,
    prankId: candidate.id,
    prankRarity: candidate.rarity,
    attackerMaxRarity: attackerPowers.maxRarity,
    landed: false,
    basePoints: attackerPowers.basePoints,
    revenge: false,
    attackerTierRank: tierRank(attacker.traits?.Tier),
    targetTierRank: tierRank(target.traits?.Tier),
    targetCurrentStreak: state.streaks[toTokenId]?.currentStreak,
    now,
    day,
    knownTokens: new Set([fromTokenId, toTokenId]),
    // Live owner for the same-wallet rule, cached 60s by ownerOf. The snapshot
    // is a FALLBACK, reached only when the RPC fails: a token transferred
    // since the harvest must not still read as its old holder's, because that
    // would let one wallet prank its own Chog through the back door. Pranking
    // yourself is refused, and "is this my own Chog" is exactly the question
    // that needs a current answer.
    walletOf: async (tokenId) => {
      if (tokenId === fromTokenId) return session.address;
      return (await ownerOfWithFallback(tokenId, getOwnerFromSnapshot(tokenId) ?? undefined)) ?? undefined;
    },
  });
  if (!check.ok) {
    return NextResponse.json({ error: check.refusal, detail: check.detail }, { status: 409 });
  }

  // Issue the server-side nonce, bound to this exact action, and record it.
  const nonce = issueActionNonce(
    {
      address: session.address,
      fromTokenId,
      toTokenId,
      prankId: candidate.id,
      day,
    },
    secret,
  );

  const supabase = db();

  // ── OUTSTANDING NONCE CAP ─────────────────────────────────────────────────
  // At most MAX_OUTSTANDING_NONCES unused nonces may exist per (address,
  // fromTokenId, day). Unused is the operative word: a consumed nonce is
  // history, and an expired one can no longer be committed, so neither counts.
  //
  // Without this cap, /prepare is an unlimited batch machine. A player could
  // hold dozens of nonces for dozens of targets and commit them in whatever
  // order turned out best - which is exactly what makes the day-boundary
  // attack worth preparing for, and is useful even within a single day. Three
  // is enough for the flow to work: the UI prepares once, retries once
  // silently on a nonce replay, and leaves one spare.
  const { data: outstanding, error: outstandingError } = await supabase
    .from('nonces')
    .select('nonce')
    .eq('address', session.address.toLowerCase())
    .eq('used_at', null)
    .gt('expires_at', new Date(now).toISOString());

  if (outstandingError) {
    return NextResponse.json(
      { error: 'could not read outstanding nonces', detail: outstandingError.message },
      { status: 500 },
    );
  }
  if ((outstanding ?? []).length >= MAX_OUTSTANDING_NONCES) {
    return NextResponse.json(
      {
        error: 'TOO_MANY_PENDING',
        detail: `finish or let expire the ${MAX_OUTSTANDING_NONCES} pranks you already prepared`,
      },
      { status: 429 },
    );
  }

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

  const intent: ActionIntent = {
    kind: 'prank',
    fromTokenId,
    toTokenId,
    prankId: candidate.id,
    day,
    nonce,
    issuedAt: now,
  };

  const prankMeta = getPrank(candidate.id);

  // The ODDS, not the outcome.
  //
  // `effectiveDodge` is the same function the commit route calls through
  // `resolvePrank`, so the percentage shown before signing is the percentage
  // that decides the result afterwards. Showing `targetPowers.dodgeChance`
  // here would quote a number that ignores the attacker's accuracy - i.e. it
  // would promise worse odds than the player actually gets whenever their
  // Eyes are good, which is the opposite of what the trait is for.
  const targetPowers = powersFor(target.traits);
  const dodgeChance = effectiveDodge(targetPowers.dodgeChance, attackerPowers.accuracy);

  return NextResponse.json({
    // The exact INTENT the wallet signs. No outcome is in it.
    typedData: buildActionTypedData(intent),
    nonce,
    intent,
    // Enough for the UI to name the prank and state the odds, with no
    // outcome in it: a roll is never computed before the signature.
    preview: {
      prankName: prankMeta?.name ?? candidate.id,
      caption: prankMeta?.caption ?? '',
      week: weekFor(now),
      dodgeChance,
      hitChance: 1 - dodgeChance,
    },
  });
}
