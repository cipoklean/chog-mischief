#!/usr/bin/env node
/**
 * Build the owner snapshot: address -> [token ids].
 *
 * WHY THIS EXISTS - a measured constraint, not a guess:
 *   Monad's public RPC allows ~50 eth_calls per SECOND (the batch endpoint
 *   returns `-32007 50/second request limit reached`). Reading ownerOf for all
 *   1,969 Chogs therefore takes a measured 47 seconds, and eth_getLogs is
 *   limited to a 100-block range, so neither live approach can run inside a
 *   sign-in request.
 *
 * So the chain index is built ONCE, offline, into data/owners.json and
 * read at runtime. balanceOf is still checked LIVE on every sign-in, so the
 * snapshot can only ever add token ids - it can never let a non-holder in, and
 * a freshly-minted holder simply re-runs this script.
 *
 * Usage: node --import ./scripts/ts-resolve.mjs scripts/harvest-owners.mjs
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

const RPC = process.env.RPC_PRIMARY ?? 'https://rpc.monad.xyz';
const CONTRACT = process.env.NEXT_PUBLIC_CHOG_CONTRACT ?? '0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763';
const OUT = resolvePath(dirname(fileURLToPath(import.meta.url)), '../data/owners.json');

const OWNER_OF = '0x6352211e';
const CHUNK = 25; // eth_calls per HTTP request; the cap is calls/second, not requests

async function totalSupply() {
  const r = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'eth_call',
      params: [{ to: CONTRACT, data: '0x18160ddd' }, 'latest'],
    }),
  });
  const j = await r.json();
  return Number(BigInt(j.result));
}

async function batch(start, end) {
  const body = [];
  for (let i = start; i <= end; i++) {
    body.push({
      jsonrpc: '2.0', id: i, method: 'eth_call',
      params: [{ to: CONTRACT, data: OWNER_OF + i.toString(16).padStart(64, '0') }, 'latest'],
    });
  }

  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (Array.isArray(json)) return json;
    // Rate limited: back off rather than hammering it.
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
  }
  throw new Error(`batch ${start}-${end} failed after retries`);
}

const supply = await totalSupply();
console.log(`Scanning ${supply} Chogs at ~50 calls/sec - expect about ${Math.ceil(supply / 50)}s.`);

const owners = {};
const byToken = {};
let callsThisSecond = 0;
let windowStart = Date.now();

const t0 = Date.now();

for (let start = 1; start <= supply; start += CHUNK) {
  if (callsThisSecond >= 45) {
    const wait = 1000 - (Date.now() - windowStart);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    callsThisSecond = 0;
    windowStart = Date.now();
  }

  const end = Math.min(start + CHUNK - 1, supply);
  callsThisSecond += end - start + 1;

  const results = await batch(start, end);
  for (const item of results) {
    const id = item.id;
    const hex = item.result;
    // A short/empty result means the call did not come back; the retry pass
    // below re-reads every id we could not map.
    if (!hex || hex.length < 66) continue;
    // The address is the LAST 20 bytes of the ABI-encoded return value.
    const address = ('0x' + hex.slice(-40)).toLowerCase();
    (owners[address] ??= []).push(id);
    byToken[id] = address;
  }
  if (start % 250 === 0 || start + CHUNK > supply) {
    process.stdout.write(`  ${Math.min(start + CHUNK - 1, supply)}/${supply}\r`);
  }
}

for (const list of Object.values(owners)) list.sort((a, b) => a - b);

// A dropped HTTP response looks identical to a burned token, so re-read every
// id we failed to map. Token #42 was missing from the first pass purely because
// its batch response came back short - the token is perfectly alive.
let repaired = 0; // ids recovered by the retry passes
for (let pass = 0; pass < 3; pass++) {
  const gaps = [];
  for (let id = 1; id <= supply; id++) if (!byToken[id]) gaps.push(id);
  if (gaps.length === 0) break;

  for (let i = 0; i < gaps.length; i += 5) {
    const slice = gaps.slice(i, i + 5);
    const results = await batch(slice[0], slice[slice.length - 1]);
    for (const item of results) {
      if (item.result && item.result.length >= 66) {
        const address = ('0x' + item.result.slice(-40)).toLowerCase();
        if (!byToken[item.id]) repaired++;
        byToken[item.id] = address;
        if (!owners[address].includes(item.id)) owners[address].push(item.id);
      }
    }
    await new Promise((r) => setTimeout(r, 1100)); // stay under 50 calls/sec
  }
}
for (const list of Object.values(owners)) list.sort((a, b) => a - b);

const mapped = Object.keys(byToken).length;
if (mapped < supply) {
  console.error(`\nWARNING: only ${mapped}/${supply} tokens mapped after retries`);
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(
  OUT,
  JSON.stringify({
    generatedAt: new Date().toISOString(),
    contract: CONTRACT,
    totalSupply: supply,
    holderCount: Object.keys(owners).length,
    missing: supply - mapped,
    owners,
  }),
);

console.log(
  `\nWrote ${OUT}\n  ${supply} tokens, ${Object.keys(owners).length} holders, ` +
    `${supply - mapped} unreadable, ${repaired} recovered by retry, ` +
    `${((Date.now() - t0) / 1000).toFixed(1)}s`,
);
if (supply - mapped > 0) process.exitCode = 1;