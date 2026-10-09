/**
 * Chog metadata lookup, server-side.
 *
 * Reads the harvested trait cache and the owner snapshot from disk. Both are
 * build-time artefacts, not live chain reads, so rendering a Chog page costs no
 * RPC calls and cannot fail because Monad is rate-limiting us.
 *
 * NOT for client components - it touches node:fs.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ChogTraits } from '@/game/powers';

export interface ChogMeta {
  tokenId: number;
  name: string;
  imageUrl: string | null;
  traits: ChogTraits;
}

export const TOTAL_SUPPLY = 1969;

const cacheDir = join(process.cwd(), 'data', 'cache');
/**
 * The TRACKED public-metadata snapshot. `data/cache/` is gitignored (every
 * clone re-harvests rather than trusting a stale cache), so a production
 * build - Vercel, a fresh clone - has no live cache. This snapshot is the
 * committed fallback: the same public fields (token id, name, traits, image
 * URL) and nothing else. Never owners, never addresses.
 */
const snapshotDir = join(process.cwd(), 'data', 'snapshot');

interface CacheEntry {
  token_id: number;
  /** Optional: 10 Chogs in the collection have no name on OpenSea at all. */
  name?: string;
  image_url?: string;
  attributes: ChogTraits;
}

let cache: Map<number, CacheEntry> | null = null;

function loadCache(): Map<number, CacheEntry> {
  if (cache) return cache;
  // Live cache first (it is freshest, and a dev machine has it), then the
  // committed snapshot. A fresh clone or a Vercel build gets the snapshot.
  for (const dir of [cacheDir, snapshotDir]) {
    try {
      const raw = JSON.parse(readFileSync(join(dir, 'chogs.json'), 'utf8')) as Record<
        string,
        CacheEntry
      >;
      const parsed = new Map(Object.values(raw).map((c) => [c.token_id, c]));
      if (parsed.size > 0) {
        cache = parsed;
        return cache;
      }
    } catch {
      // Not present here; try the next source.
    }
  }
  // No cache and no snapshot. Callers must degrade, not crash.
  cache = new Map();
  return cache;
}

/**
 * Build a display name for THIS token.
 *
 * Why not just use `entry.name`? Because the original harvest read OpenSea's
 * top-level "name" field, which for this collection is a collection-wide
 * default - every asset page renders it as `CHOG #1462`, token 1462's name -
 * regardless of which token the page is for. Its own page title reads
 * `CHOG #1462 #1`, so the default and the true token id are both in the HTML.
 * All 1,959 harvested names were that same rotation and therefore wrong;
 * scripts/harvest-names.py has since recovered the 10 real ones.
 *
 * So a harvested name is only trusted when it names THIS token, either
 * directly (`CHOG #561`) or via the legacy `CHOG #53 - Blaze` form where the
 * number is a different id and the descriptive part is the actual name.
 * Everything else falls back to the token id, which the collection always
 * guarantees.
 */
const DIRECT_NAME = /^CHOG\s*#\s*(\d+)$/;
// Legacy names like "CHOG #53 - Blaze" join the id and the name with a dash of
// some kind, and the collection actually ships all three dash characters. The
// parser has to accept every one the source data uses, so this character class
// deliberately keeps them. That is data parsing, not prose, which is why it is
// the one place in the codebase where a dash survives the no-em-dash rule.
const NAME_SEPARATOR = "[—–-]";
const DESCRIPTIVE_NAME = new RegExp(
  `^CHOG\\s*#\\s*\\d+\\s*${NAME_SEPARATOR}\\s*(.+)$`,
);

function displayName(tokenId: number, harvestedName?: string): string {
  if (harvestedName) {
    const direct = harvestedName.trim().match(DIRECT_NAME);
    if (direct && Number(direct[1]) === tokenId) return `CHOG #${tokenId}`;

    const descriptive = harvestedName.trim().match(DESCRIPTIVE_NAME);
    // e.g. "Blaze" - a real named Chog, the only ones in the collection.
    if (descriptive) return `${tokenId} - ${descriptive[1].trim()}`;
  }
  return `CHOG #${tokenId}`;
}

export function getChog(tokenId: number): ChogMeta | null {
  const entry = loadCache().get(tokenId);
  if (!entry) return null;
  return {
    tokenId: entry.token_id,
    name: displayName(tokenId, entry.name),
    imageUrl: entry.image_url ?? null,
    traits: entry.attributes ?? {},
  };
}

/** Owner address from the prebuilt snapshot. NOT authoritative - the chain is. */
export function getOwnerFromSnapshot(tokenId: number): string | null {
  try {
    const raw = JSON.parse(readFileSync(join(process.cwd(), 'data', 'owners.json'), 'utf8')) as {
      owners: Record<string, number[]>;
    };
    for (const [address, ids] of Object.entries(raw.owners)) {
      if (ids.includes(tokenId)) return address;
    }
  } catch {
    // No snapshot; the page simply omits the owner.
  }
  return null;
}

export function traitCacheReady(): boolean {
  return loadCache().size > 0;
}

/**
 * Every Chog as a lightweight row, for the target grid.
 *
 * The full 1,969-row list is built once and cached with the trait cache, so
 * this is cheap to call per request. Deliberately NOT the same shape as
 * getChog(): the grid needs only enough to render a tile (id, name, art),
 * and shipping all traits to the browser for 1,969 Chogs would be a
 * multi-megabyte payload for data the grid never shows.
 */
export interface ChogListRow {
  tokenId: number;
  name: string;
  imageUrl: string | null;
}

export function listChogs(): ChogListRow[] {
  const rows: ChogListRow[] = [];
  for (const [id, entry] of loadCache()) {
    rows.push({
      tokenId: id,
      name: displayName(id, entry.name),
      imageUrl: entry.image_url ?? null,
    });
  }
  rows.sort((a, b) => a.tokenId - b.tokenId);
  return rows;
}