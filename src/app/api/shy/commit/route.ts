import { connection } from 'next/server';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import type { TypedDataDefinition } from 'viem';
import { verifySession } from '@/lib/siwe';
import { checkActionDay, DAY_ROLLED_OVER, dayRolledOverMessage } from '@/lib/action-day';
import { db } from '@/lib/db';
import { ownerOf } from '@/lib/chain-read';
import {
  addressesMatch,
  buildShyTypedData,
  hasCanonicalShyShape,
  parseShyIntent,
  recoverActionSigner,
  verifyActionNonce,
} from '@/lib/action-signing';

/**
 * POST /api/shy/commit - turn Shy mode on or off after a signature.
 *
 * The verification order is the same one every signed action in this game uses,
 * and the order is the security property: nothing is written and nothing is
 * decided until the signature is proven to come from the wallet that holds
 * the token.
 *
 *   1. read the intent out of what was SIGNED, not out of the request body
 *   2. the domain and schema must be exactly the ones this server issues
 *   3. the nonce must be one this server issued for THIS action, then consumed
 *      atomically - so a replay cannot succeed even concurrently
 *   4. recover the signer against the CANONICAL re-derivation
 *   5. the signer must be the session wallet, and the session must hold the
 *      token, and the chain must still say so
 *   6. only then write
 *
 * Step 3 before step 4 on purpose: consuming the nonce first means a
 * signature that turns out to be forged has still burned its nonce, so it
 * cannot be retried into something valid.
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

  // 1. Intent out of the SIGNED message. A client that sends an extra field
  //    cannot make it into the typed data this server will act on.
  const intent = parseShyIntent(typedData);
  if (!intent) {
    return NextResponse.json({ error: 'could not read the signed shy toggle' }, { status: 400 });
  }

  // 2. Canonical domain and schema: this app, this chain, this collection, and
  //    exactly the Shy fields. A different primaryType cannot sneak through the
  //    prank path or vice versa.
  if (!hasCanonicalShyShape(typedData)) {
    return NextResponse.json(
      { error: 'this signature was not built by the server', detail: 'unexpected typed-data shape' },
      { status: 400 },
    );
  }

  // 3. The nonce must have been issued for this exact action by /prepare, then
  //    be consumed atomically. Both failures are the nonce-replay refusal.
  if (
    !verifyActionNonce(
      intent.nonce,
      {
        address: session.address,
        fromTokenId: intent.tokenId,
        toTokenId: intent.tokenId,
        prankId: 'shy',
        day: intent.day,
      },
      secret,
    )
  ) {
    return NextResponse.json(
      { error: 'this toggle was already committed', detail: 'the nonce was not issued for this action' },
      { status: 409 },
    );
  }

  const supabase = db();
  const now = Date.now();

  // ── THE DAY CHECK ─────────────────────────────────────────────────────────
  // Same rule as the prank and clean commits, and for the same reason: a
  // toggle signed for yesterday must not be committable today. See
  // lib/action-day.ts. Before any state change and before the nonce is
  // consumed, so a stale commit neither burns the nonce nor writes.
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
      { error: 'this toggle was already committed', detail: 'the nonce is unknown, expired or used' },
      { status: 409 },
    );
  }

  // 4. Recover against the CANONICAL re-derivation, so a signature over a
  //    tampered message cannot verify.
  const canonical = buildShyTypedData(intent);
  const signer = await recoverActionSigner(canonical, signature as `0x${string}`);
  if (!signer) return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
  if (!addressesMatch(signer, session.address)) {
    return NextResponse.json({ error: 'signature was from a different wallet' }, { status: 401 });
  }

  // 5. Ownership: the session, then the chain. The session check is cheap; the
  //    live read is the one that matters, because a token can be transferred
  //    between sign-in and now.
  const tokenId = intent.tokenId;
  if (!session.tokenIds.includes(tokenId)) {
    return NextResponse.json({ error: 'that Chog is not yours' }, { status: 403 });
  }

  let liveOwner: string | null = null;
  try {
    liveOwner = await ownerOf(tokenId);
  } catch (err) {
    // 502, deliberately NOT 403: "the RPC is down" and "you do not own this"
    // are different facts, and the UI must not tell a holder they lost their
    // Chog because a public endpoint timed out.
    return NextResponse.json(
      { error: `could not read ownership: ${err instanceof Error ? err.message : 'rpc error'}` },
      { status: 502 },
    );
  }
  if (!liveOwner || !addressesMatch(liveOwner, session.address)) {
    return NextResponse.json({ error: 'you no longer hold that Chog' }, { status: 403 });
  }

  // 6. Write. Upsert, because toggling twice is a normal thing for a player to
  //    do; the daily limit is on the NONCE, not on the row.
  const { error } = await supabase.from('shy_mode').upsert(
    {
      token_id: tokenId,
      enabled: intent.enabled,
      signature: signature as string,
      signer: session.address.toLowerCase(),
      signed_nonce: intent.nonce,
      updated_at: new Date(now).toISOString(),
    },
    { onConflict: 'token_id' },
  );
  if (error) {
    return NextResponse.json(
      { error: 'could not save the toggle', detail: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    tokenId,
    enabled: intent.enabled,
    day: intent.day,
  });
}
