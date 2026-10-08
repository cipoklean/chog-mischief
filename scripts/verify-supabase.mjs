#!/usr/bin/env node
/**
 * Proves the Supabase connection end to end, against the LIVE database.
 *
 * Writes probe rows, reads them back, then deletes them. Run whenever the schema
 * or the credentials change — a green build says nothing about whether the
 * database accepts our writes.
 *
 * Columns are read from supabase/schema.sql, NOT guessed. The first draft of
 * this script invented `token_id`/`nonce` and reported a PASSING daily-limit
 * check that had actually failed on a missing column — a false green that hid
 * the real error. Hence: the constraint probe is separated and asserts on the
 * SPECIFIC duplicate-key error, not merely "an error happened".
 *
 * Usage: node --import ./scripts/ts-resolve.mjs scripts/verify-supabase.mjs
 */

import { randomUUID } from 'node:crypto';

const { readFileSync } = await import('node:fs');
for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
  const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const { db, supabaseConfigured } = await import('../src/lib/db.ts');

let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

console.log('Live Supabase verification\n');

check('env is configured', supabaseConfigured());
if (!supabaseConfigured()) {
  console.error('Set SUPABASE_URL and SUPABASE_SECRET_KEY in .env first.');
  process.exit(1);
}

const client = db();

// --- every table and view answers -----------------------------------------
for (const table of [
  'chogs', 'nonces', 'pranks', 'cleans', 'overlays_active',
  'streaks', 'badges', 'demo_sessions', 'demo_actions',
]) {
  const { error } = await client.from(table).select('*').limit(1);
  check(`table ${table} is reachable`, !error, error?.message ?? '');
}

for (const view of ['weekly_most_chaotic', 'weekly_most_bullied', 'weekly_best_dodger']) {
  const { error } = await client.from(view).select('*').limit(1);
  check(`view ${view} is reachable`, !error, error?.message ?? '');
}

// Probe identities. Far outside the real 1,969 collection, so they can never
// collide with a real Chog, and a day no real prank can occupy.
const FROM = 999_999;
const TO = 999_998;
const OTHER = 999_997;
const DAY = '2099-01-01';
const WEEK = '2098-12-29';
const SIGNER = '0x000000000000000000000000000000000000dEaD';

async function insertChog(tokenId) {
  const { error } = await client.from('chogs').insert({
    token_id: tokenId,
    name: `PROBE #${tokenId}`,
    traits: {},
  });
  if (error) throw new Error(`chog ${tokenId}: ${error.message}`);
}

function prankRow(target, prankId, nonce) {
  return {
    from_token_id: FROM,
    to_token_id: target,
    prank_id: prankId,
    day: DAY,
    landed: true,
    points: 10,
    revenge: false,
    week: WEEK,
    signature: `0x${'11'.repeat(65)}`,
    signer: SIGNER,
    signed_nonce: nonce,
  };
}

// --- setup: FK parents must exist before pranks can reference them ----------
try {
  await insertChog(FROM);
  await insertChog(TO);
  await insertChog(OTHER);
  check('insert probe chogs (FK parents)', true);
} catch (err) {
  check('insert probe chogs (FK parents)', false, err instanceof Error ? err.message : '');
}

// --- write / read round trip ----------------------------------------------
const nonce1 = randomUUID();
{
  const { error } = await client.from('pranks').insert(prankRow(TO, 'bonk', nonce1));
  check('insert a prank row', !error, error?.message ?? '');
}

{
  const { data, error } = await client
    .from('pranks')
    .select('*')
    .eq('from_token_id', FROM)
    .eq('day', DAY);
  check('read it back', !error && data?.length === 1, error?.message ?? `${data?.length ?? 0} rows`);
  check('points round-tripped', data?.[0]?.points === 10, String(data?.[0]?.points));
  check('prank id round-tripped', data?.[0]?.prank_id === 'bonk', String(data?.[0]?.prank_id));
  check('week leaderboard key round-tripped', data?.[0]?.week === WEEK, String(data?.[0]?.week));
}

// --- the daily limit must bite for the RIGHT REASON ------------------------
// One prank per (from_token_id, day), enforced by Postgres so two simultaneous
// requests cannot both succeed. Assert the SPECIFIC unique-violation, not just
// "something errored" — that distinction is what the first draft got wrong.
{
  const { error } = await client.from('pranks').insert(prankRow(OTHER, 'wet-bread', randomUUID()));
  const msg = error?.message ?? '';
  const isDuplicate =
    error != null &&
    /duplicate key value|unique constraint/i.test(msg);
  check(
    'a second prank the same day is REFUSED by the database',
    isDuplicate,
    error ? msg.slice(0, 90) : 'DUPLICATE ACCEPTED — the daily limit is not enforced',
  );
}

// --- a self-targeted prank must be impossible ------------------------------
{
  const { error } = await client
    .from('pranks')
    .insert({ ...prankRow(FROM, 'bonk', randomUUID()), day: '2099-01-02', week: '2098-12-29' });
  check(
    'pranking yourself is REFUSED (pranks_not_self check)',
    Boolean(error),
    error ? error.message.slice(0, 70) : 'SELF-PRANK ACCEPTED',
  );
}

// --- a replayed signature nonce must be impossible -------------------------
{
  const { error } = await client.from('pranks').insert(prankRow(TO, 'cigar-smoke', nonce1));
  check(
    'replaying a signed nonce is REFUSED (pranks_nonce_unique)',
    Boolean(error) && /duplicate key value|unique constraint/i.test(error?.message ?? ''),
    error ? error.message.slice(0, 90) : 'REPLAY ACCEPTED — nonce uniqueness is not enforced',
  );
}

// --- clean up ---------------------------------------------------------------
{
  const { error } = await client.from('pranks').delete().eq('from_token_id', FROM);
  check('delete the probe pranks', !error, error?.message ?? '');
}
{
  const { error } = await client.from('chogs').delete().in('token_id', [FROM, TO, OTHER]);
  check('delete the probe chogs', !error, error?.message ?? '');
}
{
  const { data } = await client.from('pranks').select('*').eq('from_token_id', FROM);
  check('probe rows are gone', (data?.length ?? 0) === 0, `${data?.length ?? 0} left`);
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);