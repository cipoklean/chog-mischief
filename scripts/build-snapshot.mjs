#!/usr/bin/env node
/**
 * Regenerate data/snapshot/chogs.json from the live trait cache.
 *
 * The snapshot is the TRACKED, PUBLIC-ONLY fallback for the trait cache.
 * data/cache/ is gitignored (a clone re-harvests rather than trusting a
 * stale cache), so a Vercel build or a fresh clone has no live cache. This
 * snapshot is what they read instead.
 *
 * ── What it contains, and what it must never contain ───────────────────────
 * Contains: token id, display name, traits, image URL. All public on-chain
 * and OpenSea data, already published by the collection itself.
 * Never: owners, wallet addresses, signatures, anything from the game state.
 * The script REFUSES to write a snapshot containing an address-shaped
 * field, because committing one would publish a holder map that does not
 * belong in a public repo.
 *
 * Run: npm run snapshot:chogs
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const CACHE = join(process.cwd(), 'data', 'cache', 'chogs.json');
const SNAPSHOT = join(process.cwd(), 'data', 'snapshot', 'chogs.json');

/** The only fields a public snapshot may carry. */
const SAFE_FIELDS = new Set(['token_id', 'name', 'image_url', 'attributes']);

/** The collection's own contract address. Public by design: it is the NFT
 *  contract itself, it is in every image URL, and it is in the README. It is
 *  NOT a wallet, so it must not trip the address scan. */
const COLLECTION_CONTRACT = '0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763';

/** An Ethereum address, or anything shaped like one. */
const ADDRESS_SHAPED = /0x[0-9a-fA-F]{40}/g;

/**
 * True when the snapshot contains an address that is NOT the public
 * collection contract. A wallet address in a public snapshot would publish a
 * holder map, which is the one thing this file must never carry.
 */
function containsWalletAddress(json) {
  // Blank out every occurrence of the public contract address first, so the
  // image URLs that legitimately embed it do not read as a leak.
  const scrubbed = json.split(COLLECTION_CONTRACT).join('');
  return ADDRESS_SHAPED.test(scrubbed);
}

if (!existsSync(CACHE)) {
  console.error(
    'No live cache at data/cache/chogs.json. Harvest first:\n' +
      '  python3 scripts/harvest-traits.py --concurrency 6',
  );
  process.exit(1);
}

const raw = JSON.parse(readFileSync(CACHE, 'utf8'));

const snapshot = {};

let dropped = 0;
for (const [key, entry] of Object.entries(raw)) {
  // Keep ONLY the safe fields, whatever else the cache happens to carry.
  const clean = {};
  for (const [field, value] of Object.entries(entry)) {
    if (SAFE_FIELDS.has(field)) clean[field] = value;
  }
  const skipped = Object.keys(entry).filter((f) => !SAFE_FIELDS.has(f));
  if (skipped.length > 0) {
    dropped += 1;
    console.warn(`token ${key}: dropped non-public field(s): ${skipped.join(', ')}`);
  }
  const tokenId = Number(clean.token_id);
  if (!Number.isInteger(tokenId)) {
    console.warn(`token ${key}: no usable token_id, skipped`);
    continue;
  }
  snapshot[String(tokenId)] = clean;
}

// The safety net: refuse to publish anything with a WALLET address in it.
const serialised = JSON.stringify(snapshot);
if (containsWalletAddress(serialised)) {
  console.error(
    'REFUSING to write the snapshot: an address-shaped value is present.\n' +
      'The snapshot is public. Fix the source data before committing it.',
  );
  process.exit(1);
}

mkdirSync(join(process.cwd(), 'data', 'snapshot'), { recursive: true });
writeFileSync(SNAPSHOT, JSON.stringify(snapshot, null, 1));

const count = Object.keys(snapshot).length;
const named = Object.values(snapshot).filter((s) => s.name).length;
console.log(`wrote ${SNAPSHOT}`);
console.log(`  ${count} tokens (${named} with a real name)`);
console.log(`  fields: token_id, name, image_url, attributes (nothing else)`);
if (dropped > 0) {
  console.log(`  ${dropped} entries had non-public fields dropped`);
}
console.log('  address scan: clean');
