import { connection } from 'next/server';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import type { TypedDataDefinition } from 'viem';
import { verifySession } from '@/lib/siwe';
import { db } from '@/lib/db';
import { loadGameState } from '@/lib/game-state';
import { applyClean } from '@/game/rules';
import {
  parseActionIntent,
  hasCanonicalShape,
  buildActionTypedData,
  recoverActionSigner,
  verifyActionNonce,
  addressesMatch,
} from '@/lib/action-signing';
import { ownerOf } from '@/lib/chain-read';

/**
 * POST /api/clean/commit - persist a clean the player has signed.
 *
 * Same discipline as the prank commit: the signature and the typed data are
 * the only things trusted from the body. The token id and the prank row id
 * are re-parsed out of what was signed, the signer is recovered and matched
 * to the session wallet, and live ownership is re-read from the chain.
 *
 * One clean per (token, day), enforced by a unique index - the same
 * reasoning as the prank daily limit.
 */

const SESSION_COOKIE = 'chog_session';

export async function POST(request: Request) {
  await connection();

  const secret = process.env.SESSION_SECRET;
  if (!secret) return NextResponse.json({ error: 'server not configured' }, { status: 500 });

  const jar = await cookies();
  const session = verifySession(jar.get(SESSION_COOKIE)?.value, secret);
  if (!session) return NextResponse.json({ error: 'not signed in' }, { status: 401 });

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

  // 1. Intent only: the clean schema has no client-decided field.
  const intent = parseActionIntent(typedData);
  if (!intent || intent.kind !== 'clean') {
    return NextResponse.json({ error: 'could not read the signed clean' }, { status: 400 });
  }

  // 2. Canonical domain and types.
  if (!hasCanonicalShape(typedData)) {
    return NextResponse.json(
      { error: 'this signature was not built by the server', detail: 'unexpected typed-data shape' },
      { status: 400 },
    );
  }

  // 3. The nonce must have been issued for this exact action, then consumed
  //    atomically. Every failure maps to the nonce-replay refusal.
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
      { error: 'this clean was already committed', detail: 'the nonce was not issued for this action' },
      { status: 409 },
    );
  }

  const supabase = db();
  const now = Date.now();
  const { data: consumed, error: consumeError } = await supabase
    .from('nonces')
    .update({ used_at: new Date(now).toISOString() })
    .eq('nonce', intent.nonce)
    .is('used_at', null)
    .gt('expires_at', new Date(now).toISOString())
    .select('nonce');
  if (consumeError || !Array.isArray(consumed) || consumed.length === 0) {
    return NextResponse.json(
      { error: 'this clean was already committed', detail: 'the nonce is unknown, expired or used' },
      { status: 409 },
    );
  }

  // 4. Recover against the CANONICAL re-derivation of the intent.
  const canonical = buildActionTypedData(intent);
  const signer = await recoverActionSigner(canonical, signature as `0x${string}`);
  if (!signer) return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
  if (!addressesMatch(signer, session.address)) {
    return NextResponse.json({ error: 'signature was from a different wallet' }, { status: 401 });
  }

  const tokenId = intent.fromTokenId;
  if (!session.tokenIds.includes(tokenId)) {
    return NextResponse.json({ error: 'that Chog is not yours' }, { status: 403 });
  }

  // Live ownership, re-read at commit time.
  let liveOwner: string | null = null;
  try {
    liveOwner = await ownerOf(tokenId);
  } catch (err) {
    return NextResponse.json(
      { error: `could not read ownership: ${err instanceof Error ? err.message : 'rpc error'}` },
      { status: 502 },
    );
  }
  if (!liveOwner || !addressesMatch(liveOwner, session.address)) {
    return NextResponse.json({ error: 'you no longer hold that Chog' }, { status: 403 });
  }

  // Re-run the rules: the daily clean allowance and the overlay's existence.
  const state = await loadGameState(tokenId, tokenId);
  const applied = applyClean(state, {
    tokenId,
    prankRecordId: intent.prankId,
    now,
    day: intent.day,
  });
  if (!applied.ok) {
    return NextResponse.json({ error: applied.refusal, detail: applied.detail }, { status: 409 });
  }

  const { data: inserted, error } = await supabase
    .from('cleans')
    .insert({
      token_id: tokenId,
      prank_id: intent.prankId,
      day: intent.day,
      week: new Date(now).toISOString().slice(0, 10),
      signature: signature as string,
      signer,
      signed_nonce: intent.nonce,
    })
    .select('id')
    .maybeSingle();

  if (error) {
    const text = `${error.code ?? ''} ${error.message}`;
    if (/cleans_daily|unique/i.test(text)) {
      return NextResponse.json(
        { error: 'ALREADY_CLEANED_TODAY', detail: 'that Chog has already cleaned today' },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: 'could not record the clean', detail: error.message }, { status: 500 });
  }

  // The overlay comes off the Chog only once the clean row exists.
  await supabase.from('overlays_active').delete().eq('token_id', tokenId).eq('prank_id', intent.prankId);

  return NextResponse.json({ ok: true, id: inserted?.id ?? null });
}
