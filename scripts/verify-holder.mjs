#!/usr/bin/env node
/**
 * Proves the owner snapshot matches LIVE Monad - the step that makes the Chog
 * NFT essential - and that the live balanceOf gate works.
 *
 * It imports the SOURCE module (Node 24 strips the types natively) so it
 * exercises the same code the sign-in route runs, not a stale build artefact.
 *
 * The holder/token pair defaults come from the snapshot itself rather than being
 * hard-coded, because Chogs are being TRANSFERRED: a fixed address/ids pair goes
 * stale and then the test fails for a reason that has nothing to do with the code.
 *
 * Usage: node --import ./scripts/ts-resolve.mjs scripts/verify-holder.mjs
 */

import { readFileSync } from 'node:fs';
import { balanceOf, findHeldTokens, ownerOf } from '../src/lib/chain-read.ts';

const snapshot = JSON.parse(
  readFileSync(new URL('../data/owners.json', import.meta.url), 'utf8'),
);

// Pick the smallest holder so the check stays cheap and unambiguous.
const entries = Object.entries(snapshot.owners).filter(([, ids]) => ids.length === 1);
const [HOLDER, HELD_IDS] = entries[0] ?? Object.entries(snapshot.owners)[0];
const TOKEN = HELD_IDS[0];
const MAX_ID = snapshot.totalSupply;

let failures = 0;
function check(label, ok, detail = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` - ${detail}` : ''}`);
}

console.log('Live ownership read against Monad mainnet\n');
console.log(`checking holder ${HOLDER} holding Chog #${TOKEN}\n`);

const count = Number(await balanceOf(HOLDER));
check('balanceOf reads', Number.isFinite(count), String(count));

const owner = await ownerOf(TOKEN);
check(
  `ownerOf(${TOKEN}) resolves to the snapshot holder`,
  owner?.toLowerCase() === HOLDER.toLowerCase(),
  owner ?? 'null',
);

const held = await findHeldTokens(HOLDER);
check('findHeldTokens returns a non-empty set', held.length > 0, `token ids: ${held.join(', ')}`);
check('the set includes the Chog we checked', held.includes(TOKEN));
check(
  'the set size agrees with the live balanceOf',
  held.length === count,
  `set ${held.length} vs balanceOf ${count}`,
);

// The snapshot must be COMPLETE, or token ids above the missing ones can never
// be shown to their owner.
let mapped = 0;
for (const ids of Object.values(snapshot.owners)) mapped += ids.length;
check(
  'the snapshot covers the whole collection',
  mapped === MAX_ID && snapshot.missing === 0,
  `${mapped}/${MAX_ID} mapped, ${snapshot.missing} missing`,
);

// A high-numbered Chog must be reachable - this is the bug a 200-id scan cap
// would hide. Read its owner live and confirm the snapshot agrees.
const highId = MAX_ID;
const [highAddress] = Object.entries(snapshot.owners).find(([, ids]) => ids.includes(highId)) ?? [];
const highOwner = await ownerOf(highId);
check(
  `the snapshot agrees on the highest token id (#${highId})`,
  typeof highAddress === 'string' && highOwner?.toLowerCase() === highAddress.toLowerCase(),
  `${highOwner ?? 'null'} vs ${highAddress ?? 'absent'}`,
);

// A freshly generated address must own nothing - the refusal path that stops
// any random wallet from playing.
const nobody = '0x000000000000000000000000000000000000dEaD';
const none = await findHeldTokens(nobody);
check('a random address owns no Chogs', none.length === 0);

// The owner cache must return the same answer without a second RPC round trip.
const t0 = process.hrtime.bigint();
const cached = await findHeldTokens(HOLDER);
const ms = Number(process.hrtime.bigint() - t0) / 1e6;
check('cached read still resolves', cached.includes(TOKEN), `${ms.toFixed(1)}ms`);

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);