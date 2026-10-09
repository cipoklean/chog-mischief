/**
 * POST /api/prank/commit - persist a prank the player has signed.
 *
 * - THE ORDER IS THE SECURITY -----------------------------------------------------
 * 1. Parse the INTENT out of the signed typed data. The schema has no
 *    landed/revenge/dodgeRoll/points field, so there is nothing for a client
 *    to forge even if it wanted to.
 * 2. Verify the typed data's domain and types are canonical. A client that
 *    adds a field changes the type hash.
 * 3. Verify the nonce was issued for THIS exact action, then consume it
 *    atomically. An unknown, expired, used or mismatched nonce is refused.
 * 4. Re-derive the canonical typed data from the parsed intent and recover
 *    the signer against THAT. A signature over any other shape fails here.
 * 5. Re-read live ownership from the chain.
 * 6. ONLY NOW decide the outcome: the roll is
 *    HMAC(SESSION_SECRET, from|to|day), so it is deterministic and cannot be
 *    rerolled. Revenge is recomputed from the stored pranks. Points come
 *    from the rules. Nothing the client sent influences any of it.
 *
 * This route trusts NOTHING from the request body except the signature and
 * the typed data, and the typed data is re-derived before it is trusted.
 *
 * The daily limit is enforced by a unique index in Postgres, not by a check
 * here - a check would race between two simultaneous requests.
 */

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import type { TypedDataDefinition } from 'viem';
import { verifySession } from '@/lib/siwe';
import { checkActionDay, DAY_ROLLED_OVER, dayRolledOverMessage } from '@/lib/action-day';
import { db } from '@/lib/db';
import { getChog, getOwnerFromSnapshot } from '@/lib/chogs';
import { powersFor, resolvePrank, tierRank } from '@/game/powers';
import { rollFromSeed, seedForDay } from '@/lib/fairness';
import { getPrank } from '@/game/pranks';
import { applyPrank, revengeTarget, weekFor } from '@/game/rules';
import { loadGameState } from '@/lib/game-state';
import {
  parseActionIntent,
  hasCanonicalShape,
  buildActionTypedData,
  recoverActionSigner,
  verifyActionNonce,
  addressesMatch,
} from '@/lib/action-signing';
import { ownerOf, ownerOfWithFallback } from '@/lib/chain-read';

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
    return NextResponse.json({ error: 'typedData and signature are required' }, { status: 400 });
  }

  // 1. The intent, and only the intent.
  const intent = parseActionIntent(typedData);
  if (!intent || intent.kind !== 'prank') {
    return NextResponse.json({ error: 'could not read the signed action' }, { status: 400 });
  }

  // 2. Canonical domain and types. A client that adds `landed` to the types
  //    is refused here rather than silently accepted.
  if (!hasCanonicalShape(typedData)) {
    return NextResponse.json(
      {
        error: 'this signature was not built by the server',
        detail: 'unexpected typed-data shape',
      },
      { status: 400 },
    );
  }

  // 3. The nonce must have been issued for this exact action.
  if (
    !verifyActionNonce(
      intent.nonce,
      {
        address: session.address,
        fromTokenId: intent.fromTokenId,
        toTokenId: intent.toTokenId,
        prankId: intent.prankId,
        day: intent.day,
      },
      secret,
    )
  ) {
    return NextResponse.json(
      {
        error: 'this prank was already committed',
        detail: 'the nonce was not issued for this action',
      },
      { status: 409 },
    );
  }

  // Consume it. ONE conditional UPDATE, so two concurrent requests cannot
  // both win. Every failure mode here maps to the nonce-replay refusal.
  const supabase = db();
  const now = Date.now();

  // ── THE DAY CHECK ─────────────────────────────────────────────────────────
  // A commit is only valid on the UTC day it was prepared for. Without this a
  // player can hold nonces across midnight, read the previous day's revealed
  // seed from /api/fairness, recompute every candidate roll offline, and commit
  // only the one that lands - a guaranteed hit chosen after the fact. See
  // lib/action-day.ts for the full attack.
  //
  // Placed before ANY state change and before the nonce is consumed, so a
  // stale commit neither burns the nonce nor writes.
  const dayCheck = checkActionDay(intent.day, now);
  if (!dayCheck.ok) {
    return NextResponse.json(
      { error: DAY_ROLLED_OVER, detail: dayRolledOverMessage() },
      { status: 409 },
    );
  }

  const { data: consumed, error: consumeError } = await supabase
    .from('nonces')
    .update({ used_at: new Date(now).toISOString() })
    .eq('nonce', intent.nonce)
    .is('used_at', null)
    .gt('expires_at', new Date(now).toISOString())
    .select('nonce');

  if (consumeError || !Array.isArray(consumed) || consumed.length === 0) {
    return NextResponse.json(
      {
        error: 'this prank was already committed',
        detail: 'the nonce is unknown, expired or used',
      },
      { status: 409 },
    );
  }

  // 4. Recover the signer against the CANONICAL re-derivation of the intent.
  //    A signature over any other shape fails here.
  const canonical = buildActionTypedData(intent);
  const signer = await recoverActionSigner(canonical, signature as `0x${string}`);
  if (!signer) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
  }
  if (!addressesMatch(signer, session.address)) {
    return NextResponse.json({ error: 'signature was from a different wallet' }, { status: 401 });
  }

  // 5. The attacker Chog must still be in the session AND still owned live.
  if (!session.tokenIds.includes(intent.fromTokenId)) {
    return NextResponse.json({ error: 'that Chog is not yours' }, { status: 403 });
  }
  let liveOwner: string | null = null;
  try {
    liveOwner = await ownerOf(intent.fromTokenId);
  } catch (err) {
    return NextResponse.json(
      { error: `could not read ownership: ${err instanceof Error ? err.message : 'rpc error'}` },
      { status: 502 },
    );
  }
  if (!liveOwner || !addressesMatch(liveOwner, session.address)) {
    return NextResponse.json({ error: 'you no longer hold that Chog' }, { status: 403 });
  }

  const attacker = getChog(intent.fromTokenId);
  if (!attacker) {
    return NextResponse.json({ error: 'unknown Chog' }, { status: 404 });
  }
  const prank = getPrank(intent.prankId);
  if (!prank) {
    return NextResponse.json({ error: 'unknown prank' }, { status: 400 });
  }
  const attackerPowers = powersFor(attacker.traits);

  // 6. THE OUTCOME, decided here and nowhere else.
  const state = await loadGameState(intent.fromTokenId, intent.toTokenId);

  // Deterministic: the same (from, to, day) always yields the same roll, so
  // there is nothing to reroll.
  // The roll is HMAC(todaysSeed, from|to|day) - see lib/fairness.
  //
  // The SEED, not the session secret, is the HMAC key. That is the whole point:
  // the seed is published as a hash now and revealed when the day ends, so a
  // player can recompute this exact number afterwards and check it. Keying on
  // the session secret instead would keep it unverifiable forever.
  //
  // Same determinism as before: same from, to and day always gives the same
  // roll, so there is nothing to reroll by rejecting a signature.
  const dodgeRoll = rollFromSeed(
    seedForDay(secret, intent.day),
    intent.fromTokenId,
    intent.toTokenId,
    intent.day,
  );
  const targetPowers = powersFor(getChog(intent.toTokenId)?.traits ?? {});

  // resolvePrank, NOT `dodgeRoll > targetPowers.dodgeChance`.
  //
  // The inline comparison is why attacker Eyes (accuracy) did nothing in
  // production: `effectiveDodge` and `resolvePrank` were only ever called from
  // tests, so the trait that lowers a target's dodge chance had no effect on
  // any real prank. "Traits unlock power" was half true - an attacker's eyes
  // were decorative. One shared resolver means the rule the tests pin and the
  // rule a player experiences cannot drift apart again.
  const outcome = resolvePrank(attackerPowers, targetPowers, dodgeRoll);
  const landed = outcome.landed;

  // Revenge is recomputed from the STORED pranks, never read from a message.
  const revenge = revengeTarget(state, intent.fromTokenId, now) !== null;

  const applied = await applyPrank(state, {
    fromTokenId: intent.fromTokenId,
    toTokenId: intent.toTokenId,
    prankId: intent.prankId,
    prankRarity: prank.rarity,
    attackerMaxRarity: attackerPowers.maxRarity,
    landed,
    basePoints: attackerPowers.basePoints,
    revenge,
    // The target bonus needs the two tiers and the target's streak; all three
    // are read here, server-side, and never from the signed message.
    attackerTierRank: tierRank(getChog(intent.fromTokenId)?.traits?.Tier),
    targetTierRank: tierRank(getChog(intent.toTokenId)?.traits?.Tier),
    targetCurrentStreak: state.streaks[intent.toTokenId]?.currentStreak,
    now,
    day: intent.day,
    knownTokens: new Set([intent.fromTokenId, intent.toTokenId]),
    // Live owner for the same-wallet rule, snapshot only if the RPC fails. See
    // prepare/route.ts for why this cannot use the snapshot alone.
    walletOf: async (tokenId) =>
      tokenId === intent.fromTokenId
        ? session.address
        : ((await ownerOfWithFallback(tokenId, getOwnerFromSnapshot(tokenId) ?? undefined)) ??
          undefined),
  });
  if (!applied.ok) {
    return NextResponse.json({ error: applied.refusal, detail: applied.detail }, { status: 409 });
  }

  const record = applied.value.record;
  const streak = applied.value.streak;

  const { data: inserted, error } = await supabase
    .from('pranks')
    .insert({
      from_token_id: intent.fromTokenId,
      to_token_id: intent.toTokenId,
      prank_id: intent.prankId,
      day: intent.day,
      landed,
      dodge_roll: dodgeRoll,
      dodge_chance: null,
      points: record.points,
      revenge,
      week: weekFor(now),
      signature: signature as string,
      signer,
      signed_nonce: intent.nonce,
    })
    .select('id')
    .maybeSingle();

  if (error) {
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

  // Derived state, written after the prank exists. Best-effort: a failure
  // here leaves a correct prank log with a stale streak, which is
  // recoverable, whereas failing the request would show a prank that never
  // happened.
  await Promise.allSettled([
    supabase.from('streaks').upsert(
      {
        token_id: intent.fromTokenId,
        current_streak: streak.currentStreak,
        longest_streak: streak.longestStreak,
        last_prank_day: intent.day,
        consecutive_dodges: streak.consecutiveDodges,
      },
      { onConflict: 'token_id' },
    ),
    ...(record.landed
      ? [
          supabase.from('overlays_active').insert({
            token_id: intent.toTokenId,
            prank_id: rowId ?? intent.nonce,
            caption: prank.caption,
          }),
        ]
      : []),
    ...applied.value.newBadges.map((badge) =>
      supabase.from('badges').insert({ token_id: intent.fromTokenId, badge }),
    ),
  ]);

  return NextResponse.json({
    ok: true,
    id: rowId ?? null,
    prank: {
      id: intent.prankId,
      name: prank.name,
      caption: prank.caption,
      landed,
      points: record.points,
      revenge,
      streak: streak.currentStreak,
      newBadges: applied.value.newBadges,
    },
  });
}
