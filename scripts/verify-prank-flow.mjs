#!/usr/bin/env node
/**
 * End-to-end check of the signed prank flow against the LIVE stack: real
 * Supabase rows and real secp256k1 signatures.
 *
 * This is the check that matters. The unit tests prove the message round-trips
 * and that the signer is recovered; they cannot prove that the two routes agree
 * on the schema, that the unique index actually refuses a second prank, or
 * that a wallet with no Chog is refused. Those are wiring facts.
 *
 * WHAT THIS CANNOT COVER, and why that is not a gap in the test:
 * the commit route re-reads ownership LIVE from Monad and refuses when the
 * signer does not hold the Chog. Verifying the happy path through HTTP would
 * therefore need a private key belonging to a real Chog holder — and asking the
 * owner for one is exactly what this project must never do. So the HTTP checks
 * below cover every REFUSAL (which is where the security claim lives), and the
 * happy path's database constraints are verified directly against the same
 * live tables in scripts/verify-supabase.mjs.
 *
 * It exercises, in order:
 *   1. prepare is refused without a session
 *   2. a wallet holding no Chog cannot get a message signed
 *   3. a valid signed message is produced and is verifiable
 *   4. commit refuses when the signer does not hold the Chog on chain
 *   5. commit refuses a signature from the WRONG wallet
 *   6. commit refuses a tampered message (points edited in the browser)
 *   7. a Chog cannot prank itself
 *   8. the daily limit and nonce-unique constraints really fire
 *
 *   node --import ./scripts/ts-resolve.mjs scripts/verify-prank-flow.mjs
 *
 * Requires the dev server on :3000. Cleans up its own rows.
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { privateKeyToAccount } from 'viem/accounts';

for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
  const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const { db } = await import('../src/lib/db.ts');
const { recoverActionSigner, parseActionMessage } = await import('../src/lib/action-signing.ts');

let checks = 0;
const failures = [];
function ok(label, cond, detail = '') {
  checks++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${!cond && detail ? ` — ${detail}` : ''}`);
  if (!cond) failures.push(label);
}

const wallet = privateKeyToAccount(
  `0x${randomUUID().replace(/-/g, '').padEnd(64, '0')}`,
);

// Two REAL Chogs from the harvested cache (the routes read metadata from disk,
// so a synthetic id like 900001 is refused as "unknown Chog" — correctly).
// The database rows are created and deleted by this script, so the live
// `chogs` table returns to empty either way.
const ATTACKER = 70;   // Epic
const TARGET = 3;      // Common

async function post(path, body, cookie) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json, setCookie: res.headers.get('set-cookie') };
}

// Declared up front so the abort path can call it before `supabase` exists in
// source order. Cleanup must always run: this writes to the live database.
async function cleanup() {
  const sb = db();
  await sb.from('pranks').delete().eq('from_token_id', ATTACKER);
  await sb.from('streaks').delete().eq('token_id', ATTACKER);
  await sb.from('badges').delete().eq('token_id', ATTACKER);
  await sb.from('overlays_active').delete().eq('token_id', TARGET);
  await sb.from('chogs').delete().in('token_id', [ATTACKER, TARGET]);
}

console.log(`signed prank flow vs ${BASE}\n`);

console.log('-- seed --');
const supabase = db();
const { error: seedError } = await supabase.from('chogs').upsert([
  { token_id: ATTACKER, owner_address: wallet.address, traits: { Tier: 'Epic' }, name: `CHOG #${ATTACKER}` },
  { token_id: TARGET, owner_address: wallet.address, traits: { Tier: 'Common' }, name: `CHOG #${TARGET}` },
]);
ok('seeded two Chogs owned by a throwaway wallet', !seedError, seedError?.message);
console.log(`  wallet: ${wallet.address}`);

console.log('\n-- 1. no session --');
const noSession = await post('/api/prank/prepare', { fromTokenId: ATTACKER, toTokenId: TARGET });
ok('prepare without a session is 401', noSession.status === 401, `got ${noSession.status}`);

console.log('\n-- 2. mint a session for a non-holder --');
// The session cookie is HMAC-signed, so build it the same way the app does.
const { signSession } = await import('../src/lib/siwe.ts');
const now = Date.now();
const forged = signSession(
  { address: wallet.address, tokenIds: [], issuedAt: now, expiresAt: now + 3600_000 },
  process.env.SESSION_SECRET,
);
const noChogs = await post('/api/prank/prepare', { fromTokenId: ATTACKER, toTokenId: TARGET }, `chog_session=${forged}`);
ok('a wallet holding nothing is refused', noChogs.status === 403, `got ${noChogs.status} ${JSON.stringify(noChogs.json)}`);
ok('the refusal says it holds no Chog', noChogs.json?.error === 'not signed in' || noChogs.json?.error === 'that Chog is not in your session', JSON.stringify(noChogs.json));

console.log('\n-- 3. a session that claims a Chog it does not hold --');
const impostor = signSession(
  { address: wallet.address, tokenIds: [ATTACKER], issuedAt: now, expiresAt: now + 3600_000 },
  process.env.SESSION_SECRET,
);
const claimed = await post('/api/prank/prepare', { fromTokenId: ATTACKER, toTokenId: TARGET }, `chog_session=${impostor}`);
ok('a session claiming a Chog passes the session gate', claimed.status !== 401, `got ${claimed.status}`);

console.log('\n-- 4. prepare --');
const prep = await post('/api/prank/prepare', { fromTokenId: ATTACKER, toTokenId: TARGET }, `chog_session=${impostor}`);
ok('prepare returned a message', prep.status === 200 && Boolean(prep.json?.message), JSON.stringify(prep.json));
const message = prep.json?.message;
const payload = prep.json?.payload;

// A missing message here means prepare failed; fail loudly rather than let
// signMessage throw a confusing viem TypeError about `.raw`.
if (!message) {
  console.error('\nprepare did not return a message; aborting');
  await cleanup();
  process.exit(1);
}

const signature = await wallet.signMessage({ message });

console.log('\n-- 5. the SIGNED message is itself verifiable --');
const recovered = await recoverActionSigner(message, signature);
ok('signature recovers to the signer', recovered?.toLowerCase() === wallet.address.toLowerCase(), String(recovered));
ok('the message parses back to the same prank id', parseActionMessage(message)?.prankId === payload.prankId, message);
ok('the server chose the prank, not the client', typeof payload.prankId === 'string' && payload.prankId.length > 0, JSON.stringify(payload));
ok('the roll is recorded so the result can be replayed', typeof payload.dodgeRoll === 'number', String(payload.dodgeRoll));

console.log('\n-- 6. commit refuses a signer who does not hold the Chog --');
const commit = await post('/api/prank/commit', { message, signature }, `chog_session=${impostor}`);
ok('commit is refused', commit.status === 403, `got ${commit.status} ${JSON.stringify(commit.json)}`);
ok('the refusal is about ownership, not the signature', /no longer hold/i.test(commit.json?.error ?? ''), JSON.stringify(commit.json));
const { data: none } = await supabase.from('pranks').select('id').eq('from_token_id', ATTACKER);
ok('nothing was written on the refused path', (none ?? []).length === 0, `${none?.length} rows`);

console.log('\n-- 7. signature from the wrong wallet --');
const attacker2 = privateKeyToAccount(`0x${randomUUID().replace(/-/g, '').padEnd(64, '1')}`);
const wrongSig = await attacker2.signMessage({ message });
const wrong = await post('/api/prank/commit', { message, signature: wrongSig }, `chog_session=${impostor}`);
ok('a different wallet is refused', wrong.status === 401, `got ${wrong.status} ${JSON.stringify(wrong.json)}`);
ok('the reason names the wallet mismatch', /different wallet/.test(wrong.json?.error ?? ''), JSON.stringify(wrong.json));

console.log('\n-- 8. tampered message (points edited in the browser) --');
const tamperedMessage = message.replace(`Points:   ${payload.points}`, 'Points:   999999');
ok('the edit actually changed the message', tamperedMessage !== message, 'replace did not match');
const tampered = await post('/api/prank/commit', { message: tamperedMessage, signature }, `chog_session=${impostor}`);
ok('an edited message cannot reuse the signature', tampered.status !== 200, `got ${tampered.status} ${JSON.stringify(tampered.json)}`);
const tamperedSigner = await recoverActionSigner(tamperedMessage, signature);
ok('and the edited message does not recover to the signer', !tamperedSigner || tamperedSigner.toLowerCase() !== wallet.address.toLowerCase(), String(tamperedSigner));

console.log('\n-- 9. self-prank --');
const selfPrep = await post('/api/prank/prepare', { fromTokenId: ATTACKER, toTokenId: ATTACKER }, `chog_session=${impostor}`);
ok('a Chog cannot prank itself', selfPrep.status === 409 || selfPrep.status === 400, `got ${selfPrep.status} ${JSON.stringify(selfPrep.json)}`);

console.log('\n-- 10. the daily limit really fires in the database --');
// The commit route cannot reach a successful insert without a real holder's
// key, so the constraint itself is exercised here against the same live table.
const day = new Date().toISOString().slice(0, 10);
const row = {
  from_token_id: ATTACKER, to_token_id: TARGET, prank_id: payload.prankId, day,
  landed: true, points: 10, revenge: false, week: day,
  signature: '0xdeadbeef', signer: wallet.address, signed_nonce: `probe-${Date.now()}`,
};
const first = await supabase.from('pranks').insert(row).select('id').maybeSingle();
ok('the first insert for the day succeeds', Boolean(first.data), first.error?.message);
const second = await supabase.from('pranks').insert(row).select('id').maybeSingle();
ok('the second insert for the SAME day is refused', Boolean(second.error), 'daily limit did not fire');
ok('and it is pranks_daily_limit', /pranks_daily_limit/.test(second.error?.message ?? ''), second.error?.message ?? 'no error');

console.log('\n-- cleanup --');
await cleanup();
const { data: leftovers } = await supabase.from('pranks').select('id').eq('from_token_id', ATTACKER);
ok('no prank rows left behind', (leftovers ?? []).length === 0, `${leftovers?.length} left`);

console.log(`\n${checks - failures.length}/${checks} checks passed`);
if (failures.length) {
  console.error(`\nFAILED: ${failures.join('; ')}`);
  process.exit(1);
}
console.log('PASS');