/**
 * The P0 forgery probe: tries the exact attacks the reviewer described.
 *
 * Attack (a) - FORGERY: build typed data with landed:true, revenge:true and
 *   points:9999, sign it with a wallet that "holds" the Chog, and commit it.
 *   If the server trusts the outcome from the signed data, this is a
 *   guaranteed hit at 2x.
 *
 * Attack (b) - REROLL: the outcome must NOT sit in the message the wallet
 *   shows. If /prepare returns landed/revenge/points in the typed data, a
 *   player who sees a miss rejects the signature, re-prepares, and repeats
 *   until it hits - dodge stops meaning anything.
 *
 * Attack (c) - NONCE FORGERY: a nonce /prepare never issued must be refused.
 *
 * The probe builds its typed data FROM SCRATCH rather than importing the
 * app's builder, so it is a real attacker and not a re-run of our own code.
 *
 * Run: BASE_URL=http://127.0.0.1:3104 npm run verify:prank:forgery
 */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { privateKeyToAccount } from 'viem/accounts';

for (const line of readFileSync('.env', 'utf8').split('\n')) {
  const t = line.trim();
  if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const { db } = await import('../src/lib/db.ts');
const { signSession } = await import('../src/lib/siwe.ts');

const CONTRACT = '0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763';
const DOMAIN = { name: 'Chog Mischief', version: '1', chainId: 143, verifyingContract: CONTRACT };

let checks = 0;
const failures = [];
function ok(label, cond, detail = '') {
  checks++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${!cond && detail ? ` - ${detail}` : ''}`);
  if (!cond) failures.push(label);
}

const wallet = privateKeyToAccount(`0x${randomUUID().replace(/-/g, '').padEnd(64, '0')}`);
const ATTACKER = 70;
const TARGET = 3;
const PRANK = 'crown-of-the-chog';
const today = new Date().toISOString().slice(0, 10);

async function post(path, body, cookie) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { json = null; }
  return { status: res.status, json };
}

async function cleanup() {
  const sb = db();
  await sb.from('pranks').delete().eq('from_token_id', ATTACKER);
  await sb.from('streaks').delete().eq('token_id', ATTACKER);
  await sb.from('badges').delete().eq('token_id', ATTACKER);
  await sb.from('overlays_active').delete().eq('token_id', TARGET);
  await sb.from('nonces').delete().eq('address', wallet.address.toLowerCase());
  await sb.from('chogs').delete().in('token_id', [ATTACKER, TARGET]);
}

console.log(`forgery probe vs ${BASE}\n`);

console.log('-- seed --');
const supabase = db();
const { error: seedError } = await supabase.from('chogs').upsert([
  { token_id: ATTACKER, owner_address: wallet.address, traits: { Tier: 'Epic' }, name: `CHOG #${ATTACKER}` },
  { token_id: TARGET, owner_address: wallet.address, traits: { Tier: 'Common' }, name: `CHOG #${TARGET}` },
]);
ok('seeded two Chogs owned by a throwaway wallet', !seedError, seedError?.message);
console.log(`  wallet: ${wallet.address}`);

const now = Date.now();
const session = signSession(
  { address: wallet.address, tokenIds: [ATTACKER], issuedAt: now, expiresAt: now + 3600_000 },
  process.env.SESSION_SECRET,
);
const cookie = `chog_session=${session}`;

// ---------------------------------------------------------------------------
// Attack (a): the forged commit
// ---------------------------------------------------------------------------
console.log('\n-- attack (a): forged outcome --');
const forgedTypes = {
  Prank: [
    { name: 'kind', type: 'string' },
    { name: 'fromTokenId', type: 'uint256' },
    { name: 'toTokenId', type: 'uint256' },
    { name: 'prankId', type: 'string' },
    { name: 'dodgeRoll', type: 'uint256' },
    { name: 'landed', type: 'bool' },
    { name: 'points', type: 'uint256' },
    { name: 'revenge', type: 'bool' },
    { name: 'day', type: 'string' },
    { name: 'nonce', type: 'string' },
  ],
};
const forgedMessage = {
  kind: 'prank',
  fromTokenId: ATTACKER,
  toTokenId: TARGET,
  prankId: PRANK,
  dodgeRoll: 0,
  landed: true,
  points: 9999,
  revenge: true,
  day: today,
  nonce: `forged-${randomUUID()}`,
};
const forgedSig = await wallet.signTypedData({
  domain: DOMAIN, types: forgedTypes, primaryType: 'Prank', message: forgedMessage,
});
const forged = await post('/api/prank/commit', {
  typedData: { domain: DOMAIN, types: forgedTypes, primaryType: 'Prank', message: forgedMessage },
  signature: forgedSig,
}, cookie);
ok('a forged landed:true commit is refused (4xx)', forged.status >= 400, `got ${forged.status} ${JSON.stringify(forged.json)}`);

// ---------------------------------------------------------------------------
// Attack (b): the outcome must not be in the signed data
// ---------------------------------------------------------------------------
console.log('\n-- attack (b): the outcome is not in what the wallet signs --');
const prep = await post('/api/prank/prepare', { fromTokenId: ATTACKER, toTokenId: TARGET, prankId: PRANK }, cookie);
ok('prepare succeeds for a holder', prep.status === 200, `got ${prep.status} ${JSON.stringify(prep.json)}`);

const signedFields = Object.keys(prep.json?.typedData?.message ?? {});
const outcomeFields = signedFields.filter((f) => ['landed', 'revenge', 'dodgeRoll', 'points'].includes(f));
ok(
  'the signed message carries NO outcome fields',
  outcomeFields.length === 0,
  `found: ${outcomeFields.join(', ') || 'none'} (signed: ${signedFields.join(', ')})`,
);

// ---------------------------------------------------------------------------
// Attack (c): a nonce the server never issued
// ---------------------------------------------------------------------------
console.log('\n-- attack (c): a nonce /prepare never issued --');
const intentTypes = {
  Prank: [
    { name: 'kind', type: 'string' },
    { name: 'fromTokenId', type: 'uint256' },
    { name: 'toTokenId', type: 'uint256' },
    { name: 'prankId', type: 'string' },
    { name: 'day', type: 'string' },
    { name: 'nonce', type: 'string' },
    { name: 'issuedAt', type: 'uint256' },
  ],
};
const intentMessage = {
  kind: 'prank',
  fromTokenId: ATTACKER,
  toTokenId: TARGET,
  prankId: PRANK,
  day: today,
  nonce: `never-issued-${randomUUID()}`,
  issuedAt: Date.now(),
};
const intentSig = await wallet.signTypedData({
  domain: DOMAIN, types: intentTypes, primaryType: 'Prank', message: intentMessage,
});
const unknownNonce = await post('/api/prank/commit', {
  typedData: { domain: DOMAIN, types: intentTypes, primaryType: 'Prank', message: intentMessage },
  signature: intentSig,
}, cookie);
ok('a nonce the server never issued is refused (4xx)', unknownNonce.status >= 400, `got ${unknownNonce.status} ${JSON.stringify(unknownNonce.json)}`);

console.log('\n-- cleanup --');
await cleanup();
const left = await supabase.from('pranks').select('id').eq('from_token_id', ATTACKER);
ok('no prank rows left behind', (left.data ?? []).length === 0, `${left.data?.length} left`);

console.log(`\n${checks - failures.length}/${checks} checks passed`);
if (failures.length) {
  console.error(`\nFAILED: ${failures.join('; ')}`);
  process.exit(1);
}
console.log('PASS');
