#!/usr/bin/env node
/**
 * End-to-end sign-in check against the RUNNING dev server and the LIVE chain.
 *
 * This is the test that matters: it drives the real HTTP routes, signs with a
 * real throwaway key, and requires the server to read ownerOf from Monad and
 * refuse an address that holds no Chog.
 *
 * It never touches a real wallet — the key is generated here and discarded.
 *
 * Usage:  node scripts/e2e-signin.mjs            (dev server on :3000)
 *         BASE=http://127.0.0.1:3000 node scripts/e2e-signin.mjs
 */

import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

const BASE = process.env.BASE ?? 'http://127.0.0.1:3000';

// Chog #1462's real, live owner (read from Monad on 2026-10-08).
const HOLDER = '0x8ccfaa2c191f60a5a625064ae9682bb82b1c6d94';

let failures = 0;

function check(label, condition, detail = '') {
  const ok = Boolean(condition);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
}

async function post(path, body, cookie) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON body */
  }
  const setCookie = res.headers.getSetCookie?.() ?? [];
  return { status: res.status, json, setCookie };
}

console.log(`E2E sign-in against ${BASE}\n`);

// 1. nonce endpoint rejects garbage
{
  const r = await post('/api/auth/nonce', { address: 'not-an-address' });
  check('nonce rejects a malformed address', r.status === 400, `status ${r.status}`);
}

// 2. nonce endpoint issues a real challenge
let message = null;
let nonce = null;
{
  const r = await post('/api/auth/nonce', { address: HOLDER });
  check('nonce issues for a valid address', r.status === 200, `status ${r.status}`);
  message = r.json?.message;
  nonce = r.json?.nonce;
  check('message embeds the address', message?.includes(HOLDER));
  check('message embeds the nonce', message?.includes(`Nonce: ${nonce}`));
  check('message says no gas', /costs no gas/i.test(message ?? ''));
}

// 3. a wrong signature is refused
{
  const impostor = privateKeyToAccount(generatePrivateKey());
  const signature = await impostor.signMessage({ message });
  const r = await post('/api/auth/verify', { message, signature });
  check(
    'verify refuses a signature from another wallet',
    r.status === 401,
    `status ${r.status}`,
  );
}

// 4. a garbage signature is refused, not crashed
{
  const r = await post('/api/auth/verify', { message, signature: '0xdeadbeef' });
  check('verify refuses a malformed signature', r.status === 401, `status ${r.status}`);
}

// 5. the nonce is single-use: a real signature cannot be replayed
//    We do NOT have HOLDER's key, so this asserts the refusal path only.
{
  const r = await post('/api/auth/verify', { message, signature: '0x' + 'ab'.repeat(65) });
  check('verify refuses without a valid signer', r.status === 401, `status ${r.status}`);
}

// 6. an address holding no Chog is refused AFTER a valid signature.
//    We sign properly with our own key, so the only thing that can fail is the
//    on-chain ownership check — which is the NFT-essential rule in action.
{
  const nobody = privateKeyToAccount(generatePrivateKey());
  const r0 = await post('/api/auth/nonce', { address: nobody.address });
  const msg0 = r0.json?.message;
  check('nonce issued for the non-holder', r0.status === 200 && Boolean(msg0));

  const sig0 = await nobody.signMessage({ message: msg0 });
  const r = await post('/api/auth/verify', { message: msg0, signature: sig0 });

  check(
    'a valid signature from a wallet with no Chog is refused',
    r.status === 403,
    `status ${r.status} ${JSON.stringify(r.json)}`,
  );
  check('the refusal names the reason', r.json?.error === 'no_chogs');
  check('no session cookie is issued', (r.setCookie ?? []).length === 0);
}

// 7. the session endpoint reports signed-out
{
  const res = await fetch(`${BASE}/api/auth/session`);
  const json = await res.json();
  check('session reports signed-out without a cookie', json?.authenticated === false);
}

// 8. a tampered cookie is rejected
{
  const res = await fetch(`${BASE}/api/auth/session`, {
    headers: { cookie: 'chog_session=eyJhZGRyZXNzIjoiMHgxIn0.forgedmac' },
  });
  const json = await res.json();
  check('a forged session cookie is rejected', json?.authenticated === false);
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
