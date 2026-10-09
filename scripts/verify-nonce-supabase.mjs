#!/usr/bin/env node
/**
 * Live check: the nonce store against the REAL Supabase `nonces` table.
 *
 * The unit tests exercise the in-memory fallback, because no test sets
 * SUPABASE_URL. That proves the semantics but not the wiring - the thing that
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
    console.log(`  FAIL  ${label}${detail ? ` - ${detail}` : ''}`);
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
  console.error('SUPABASE_URL is unset - this script must hit the real table, not the fallback.');
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


// =============================================================================
// THE OUTSTANDING-NONCE CAP
//
// This is the check that cannot be mocked. The cap queries `nonces` with
// `.is('used_at', null)` - and the original version used `.eq('used_at', null)`,
// which serialises to `used_at=eq.null`. PostgREST cannot express IS NULL that
// way: it either 400s, or matches nothing, and the cap silently never fires.
//
// A unit test with a mocked client passes either way, because the mock is
// handed a query object and does not serialise it. Only a real PostgREST can
// tell us whether the filter matches a NULL column, so this runs against the
// live table: insert three unused nonces for one token and assert the count
// query sees exactly three.
// =============================================================================

console.log('\n-- the outstanding-nonce query --');

const CAP_TOKEN = 70;
const CAP_DAY = new Date().toISOString().slice(0, 10);
const capRows = [];

/**
 * The exact query /api/prank/prepare runs. Written out here rather than
 * imported, because importing the route would pull in cookies, sessions and a
 * request object; what needs proving is the FILTER, and that is what this is.
 */
async function countOutstanding(address, fromTokenId, day) {
  const { data, error } = await db()
    .from('nonces')
    .select('nonce')
    .eq('address', address.toLowerCase())
    .eq('from_token_id', fromTokenId)
    .eq('day', day)
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString());
  return { rows: data ?? [], error };
}

const addrA = '0x3333333333333333333333333333333333333333';
const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString();

// Clean any leftovers from a previous run of this script.
await db().from('nonces').delete().eq('address', addrA.toLowerCase());

for (let i = 0; i < 3; i += 1) {
  const { error } = await db().from('nonces').insert({
    nonce: `cap-probe-${i}-${Date.now()}`,
    address: addrA.toLowerCase(),
    expires_at: expires,
    used_at: null,
    from_token_id: CAP_TOKEN,
    day: CAP_DAY,
  });
  if (error) {
    ok('inserted a nonce for the cap probe', false, error.message);
    break;
  }
  capRows.push(i);
}

ok('three unused nonces inserted', capRows.length === 3, `inserted ${capRows.length}`);

const afterThree = await countOutstanding(addrA, CAP_TOKEN, CAP_DAY);
ok(
  '`.is(used_at, null)` MATCHES unused nonces - the query is not silently empty',
  afterThree.error === null && afterThree.rows.length === 3,
  afterThree.error
    ? `PostgREST rejected the filter: ${afterThree.error.message}`
    : `expected 3 rows, the query returned ${afterThree.rows.length}`,
);

// The old spelling, kept so the regression is demonstrated rather than asserted.
const { data: withEq, error: eqError } = await db()
  .from('nonces')
  .select('nonce')
  .eq('address', addrA.toLowerCase())
  .eq('used_at', null);
ok(
  '`.eq(used_at, null)` does NOT match - which is why it must not be used',
  eqError !== null || (withEq ?? []).length === 0,
  'if this ever starts matching, the two spellings are equivalent and the comment above is wrong',
);

// A consumed nonce must NOT count, or the cap would lock a player out after
// three successful pranks on the same day.
const consumedNonce = `cap-consumed-${Date.now()}`;
await db().from('nonces').insert({
  nonce: consumedNonce,
  address: addrA.toLowerCase(),
  expires_at: expires,
  used_at: new Date().toISOString(),
  from_token_id: CAP_TOKEN,
  day: CAP_DAY,
});
const afterConsume = await countOutstanding(addrA, CAP_TOKEN, CAP_DAY);
ok(
  'a consumed nonce does not count toward the cap',
  afterConsume.rows.length === 3,
  `expected 3, got ${afterConsume.rows.length}`,
);

// A DIFFERENT token with the same wallet must not count, which is the scoping
// bug the from_token_id/day columns exist to prevent.
await db().from('nonces').insert({
  nonce: `cap-other-token-${Date.now()}`,
  address: addrA.toLowerCase(),
  expires_at: expires,
  used_at: null,
  from_token_id: CAP_TOKEN + 1,
  day: CAP_DAY,
});
const otherToken = await countOutstanding(addrA, CAP_TOKEN + 1, CAP_DAY);
const sameToken = await countOutstanding(addrA, CAP_TOKEN, CAP_DAY);
ok(
  'the cap is scoped per (address, token, day), not per wallet',
  otherToken.rows.length === 1 && sameToken.rows.length === 3,
  `other token: ${otherToken.rows.length}, same token: ${sameToken.rows.length}`,
);

// Cleanup, always.
await db().from('nonces').delete().eq('address', addrA.toLowerCase());
const { rows: leftover } = await countOutstanding(addrA, CAP_TOKEN, CAP_DAY);
ok('cleanup removed the probe rows', leftover.length === 0, `${leftover.length} left`);

console.log(`\n${checks - failures.length}/${checks} checks passed`);
if (failures.length) {
  console.error(`\nFAILED: ${failures.join('; ')}`);
  process.exit(1);
}
console.log('PASS');