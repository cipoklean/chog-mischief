#!/usr/bin/env node
/**
 * Live check: the nonce store against the REAL Supabase `nonces` table.
 *
 * The unit tests exercise the in-memory fallback, because no test sets
 * SUPABASE_URL. That proves the semantics but not the wiring — the thing that
 * can break is the column names, the conditional-UPDATE shape, and whether the
 * table actually rejects a replay. So run it for real.
 *
 *   node --import ./scripts/ts-resolve.mjs scripts/verify-nonce-supabase.mjs
 *
 * Exits non-zero on the first failure. Leaves one expired row behind per run,
 * which is harmless and swept by expires_at.
 */

const failures = [];
let checks = 0;

function ok(label, condition, detail = '') {
  checks++;
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
    failures.push(label);
  }
}

const ADDRESS_A = '0x1111111111111111111111111111111111111111';
const ADDRESS_B = '0x2222222222222222222222222222222222222222';

// Load .env with the stdlib, the same way scripts/verify-supabase.mjs does, so
// this script needs no dependency the project does not already have.
const { readFileSync } = await import('node:fs');
for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
  const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

console.log('nonce store vs live Supabase\n');

if (!process.env.SUPABASE_URL) {
  console.error('SUPABASE_URL is unset — this script must hit the real table, not the fallback.');
  process.exit(1);
}

// Import AFTER the env is loaded. Otherwise db() sees no credentials and the
// store silently falls back to the in-memory Map, and this whole script would
// report PASS while proving nothing about the database.
const { issueNonce, peekNonce, consumeNonce } = await import('../src/lib/nonce-store.ts');
const { db, supabaseConfigured } = await import('../src/lib/db.ts');

console.log('-- wiring --');
ok('supabase is configured', supabaseConfigured(), 'SUPABASE_URL or key missing');
ok(
  'the nonce store is NOT falling back to memory',
  process.env.SUPABASE_URL !== undefined,
  'fallback would make every check below meaningless',
);

// Prove we are really on the Supabase path before trusting anything below.
const { data: probe, error: probeError } = await db()
  .from('nonces')
  .select('nonce')
  .limit(1);
ok('reaches the real nonces table', Array.isArray(probe), probeError?.message ?? 'select returned no array');
if (failures.length) {
  console.error('\ncannot verify semantics without the real table');
  process.exit(1);
}

console.log('\n-- issue --');
const nonce = await issueNonce(ADDRESS_A);
ok('issueNonce returns a value', typeof nonce === 'string' && nonce.length >= 16, nonce);

console.log('\n-- peek does not consume --');
for (let i = 0; i < 3; i++) {
  const r = await peekNonce(nonce, ADDRESS_A);
  ok(`peek #${i + 1} still valid`, r.ok === true, r.reason);
}

console.log('\n-- address binding --');
const wrong = await peekNonce(nonce, ADDRESS_B);
ok('refuses a nonce issued to another address', wrong.ok === false, wrong.reason);
ok('reason names the address', /different address/.test(wrong.reason ?? ''), wrong.reason);

console.log('\n-- single use --');
const first = await consumeNonce(nonce);
ok('first consume succeeds', first === true);

const second = await consumeNonce(nonce);
ok('second consume is refused', second === false, 'replay accepted');

const after = await peekNonce(nonce, ADDRESS_A);
ok('peek reports it already used', after.ok === false, after.reason);
ok('reason says already used', /already used/.test(after.reason ?? ''), after.reason);

console.log('\n-- concurrent consume (the race the conditional UPDATE prevents) --');
const raceNonce = await issueNonce(ADDRESS_A);
const raced = await Promise.all([consumeNonce(raceNonce), consumeNonce(raceNonce)]);
const winners = raced.filter(Boolean).length;
ok('exactly one of two concurrent consumes wins', winners === 1, `winners=${winners}`);

console.log('\n-- unknown nonce --');
const ghost = await peekNonce('never-issued-at-all', ADDRESS_A);
ok('refuses an unknown nonce', ghost.ok === false, ghost.reason);
ok('consume of an unknown nonce fails', (await consumeNonce('never-issued-at-all')) === false);

console.log(`\n${checks - failures.length}/${checks} checks passed`);
if (failures.length) {
  console.error(`\nFAILED: ${failures.join('; ')}`);
  process.exit(1);
}
console.log('PASS');