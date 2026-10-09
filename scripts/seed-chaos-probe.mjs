/**
 * Seed a couple of real prank rows, hit /api/chaos, verify, clean up.
 *
 * The pranks table is empty between verify runs (they clean up after
 * themselves), so this proves the /api/chaos path against LIVE Supabase with
 * real rows: the response must contain only the safe columns — no signer, no
 * signature — and the client pads with bot rows below 3 real events.
 *
 * Run: node --import ./scripts/ts-resolve.mjs scripts/seed-chaos-probe.mjs
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

function env() {
  const out = {};
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#') || !t.includes('=')) continue;
    const i = t.indexOf('=');
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

const e = env();
const url = e.SUPABASE_URL;
const key = e.SUPABASE_SECRET_KEY ?? e.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('SUPABASE_URL / SUPABASE_SECRET_KEY missing from .env');
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

// Real token ids that exist in the collection (same convention as
// verify-prank-flow.mjs).
const ATTACKER = 70;
const TARGET = 3;
const day = new Date().toISOString().slice(0, 10);

const rows = [
  {
    from_token_id: ATTACKER,
    to_token_id: TARGET,
    prank_id: 'crown-of-the-chog',
    day,
    landed: true,
    dodge_roll: 0.5,
    points: 30,
    revenge: false,
    week: day,
    signature: '0x' + 'ab'.repeat(65),
    signer: '0x' + '11'.repeat(20),
    signed_nonce: `chaos-probe-${Date.now()}`,
  },
];

console.log('-- seeding the chogs rows + one real prank row --');
const chogSeed = await supabase
  .from('chogs')
  .upsert([
    { token_id: ATTACKER, owner_address: '0x' + '11'.repeat(20), traits: { Tier: 'Epic' }, name: `CHOG #${ATTACKER}` },
    { token_id: TARGET, owner_address: '0x' + '22'.repeat(20), traits: { Tier: 'Common' }, name: `CHOG #${TARGET}` },
  ]);
if (chogSeed.error) {
  console.error('chogs upsert failed:', chogSeed.error.message);
  process.exit(1);
}
console.log('chogs upsert: ok');

const inserted = await supabase.from('pranks').insert(rows).select('id').maybeSingle();
console.log('insert:', inserted.error?.message ?? 'ok');
if (inserted.error) {
  console.error('could not seed a real row — aborting');
  await supabase.from('chogs').delete().in('token_id', [ATTACKER, TARGET]);
  process.exit(1);
}

console.log('\n-- GET /api/chaos --');
const res = await fetch('http://127.0.0.1:3104/api/chaos');
const body = await res.json();
console.log(JSON.stringify(body, null, 1));

const problems = [];
if (!Array.isArray(body.rows) || body.rows.length < 1) problems.push('no real rows came back');
for (const r of body.rows ?? []) {
  if ('signer' in r) problems.push('signer leaked into the response');
  if ('signature' in r) problems.push('signature leaked into the response');
  if (!('from_name' in r) || !('to_name' in r)) problems.push('names missing');
  if (!('landed' in r)) problems.push('landed missing');
}
if (body.needsBotFill !== true) problems.push('needsBotFill should be true below 3 real rows');

console.log('\n-- cleanup --');
const del = await supabase.from('pranks').delete().eq('signed_nonce', rows[0].signed_nonce);
console.log('cleanup pranks:', del.error?.message ?? 'ok');
const delChogs = await supabase.from('chogs').delete().in('token_id', [ATTACKER, TARGET]);
console.log('cleanup chogs:', delChogs.error?.message ?? 'ok');
const left = await supabase.from('pranks').select('id').eq('signed_nonce', rows[0].signed_nonce);
console.log('rows left:', (left.data ?? []).length);

if (problems.length) {
  console.error('\nFAILED:', problems.join('; '));
  process.exit(1);
}
console.log('\nPASS — real rows returned with no signer/signature; bot-padding flag set');