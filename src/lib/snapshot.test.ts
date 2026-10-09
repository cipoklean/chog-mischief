import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The committed public-metadata snapshot.
 *
 * data/cache/ is gitignored, so a Vercel build or a fresh clone reads
 * data/snapshot/chogs.json instead. That makes this file load-bearing for
 * production, and it is PUBLIC, so these tests pin the two properties that
 * matter: it loads, and it carries no wallet address.
 *
 * The second property is not paranoia. A snapshot built from the wrong
 * source, or with a field not on the allow-list, would publish a holder map
 * to a public repo. The generator refuses to write one; this test refuses to
 * let one ship.
 */

const SNAPSHOT = join(process.cwd(), 'data', 'snapshot', 'chogs.json');

/** The only fields a public snapshot may carry. */
const SAFE_FIELDS = new Set(['token_id', 'name', 'image_url', 'attributes']);

/** The collection contract. Public by design and embedded in every image URL. */
const COLLECTION_CONTRACT = '0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763';

const ADDRESS_SHAPED = /0x[0-9a-fA-F]{40}/g;

interface SnapshotEntry {
  token_id: number;
  name?: string;
  image_url?: string;
  attributes: Record<string, string>;
}

function load(): Record<string, SnapshotEntry> {
  expect(existsSync(SNAPSHOT), 'data/snapshot/chogs.json is missing. Run npm run snapshot:chogs').toBe(
    true,
  );
  return JSON.parse(readFileSync(SNAPSHOT, 'utf8'));
}

describe('the committed Chog snapshot', () => {
  const snapshot = load();
  const entries = Object.values(snapshot);

  it('loads and covers the whole collection', () => {
    expect(entries.length).toBeGreaterThan(1900);
    for (const e of entries) {
      expect(Number.isInteger(e.token_id)).toBe(true);
      expect(e.attributes).toBeTypeOf('object');
    }
  });

  it('carries only the public fields', () => {
    for (const e of entries) {
      for (const field of Object.keys(e)) {
        expect(SAFE_FIELDS.has(field), `unexpected field "${field}" on token ${e.token_id}`).toBe(
          true,
        );
      }
    }
  });

  it('has no owner or wallet field, by name', () => {
    // The structural half of the guard: these field names must simply not
    // exist, whatever their values.
    for (const e of entries) {
      expect(e).not.toHaveProperty('owner');
      expect(e).not.toHaveProperty('owner_address');
      expect(e).not.toHaveProperty('signer');
      expect(e).not.toHaveProperty('address');
    }
  });

  it('has no wallet address, by value', () => {
    // The value half: even a mislabelled field could smuggle one in. Blank
    // out the public collection contract first (it lives inside every image
    // URL) and then no address-shaped value may remain.
    const raw = readFileSync(SNAPSHOT, 'utf8').split(COLLECTION_CONTRACT).join('');
    const matches = raw.match(ADDRESS_SHAPED);
    expect(matches, `wallet-shaped value(s) in the public snapshot: ${matches?.slice(0, 3)}`).toBe(
      null,
    );
  });

  it('gives every token a name and an image URL', () => {
    // The snapshot is what production renders from; a token with no art
    // would render a broken tile on Vercel.
    const missing = entries.filter((e) => !e.name || !e.image_url);
    expect(missing.map((e) => e.token_id).slice(0, 5)).toEqual([]);
  });

  it('keys on the token id, matching the live cache shape', () => {
    // chogs.ts builds its Map from Object.values(...).token_id, so the file
    // must be keyed such that the id is recoverable from the entry itself.
    for (const [key, e] of Object.entries(snapshot)) {
      expect(Number(key)).toBe(e.token_id);
    }
  });
});
