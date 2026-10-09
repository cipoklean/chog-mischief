/**
 * Test helper: load the Chog collection the way the app does.
 *
 * The coverage tests used to read `data/cache/chogs.json` at MODULE level,
 * which threw on a fresh clone (the cache is gitignored) before
 * `describe.skipIf` could ever fire - so `npm test` was red for a judge who
 * cloned the repo. This helper reads the live cache when it exists and falls
 * back to the committed public snapshot (`data/snapshot/chogs.json`), which
 * is the same data in the same shape.
 *
 * Both sources are the real collection: the snapshot is generated from the
 * cache by `npm run snapshot:chogs` and carries the same public fields.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface CollectionEntry {
  token_id: number;
  name?: string;
  image_url?: string;
  attributes: Record<string, string>;
}

const CACHE = join(process.cwd(), 'data', 'cache', 'chogs.json');
const SNAPSHOT = join(process.cwd(), 'data', 'snapshot', 'chogs.json');

function readEntries(path: string): Record<string, CollectionEntry> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, CollectionEntry>;
}

/**
 * The collection, live cache first then the snapshot.
 *
 * Throws only when NEITHER source exists, which means the checkout is
 * missing tracked data - a real failure, not a missing optional cache.
 */
export function loadCollection(): { entries: Record<string, CollectionEntry>; source: 'cache' | 'snapshot' } {
  if (existsSync(CACHE)) return { entries: readEntries(CACHE), source: 'cache' };
  if (existsSync(SNAPSHOT)) return { entries: readEntries(SNAPSHOT), source: 'snapshot' };
  throw new Error(
    'No Chog collection found. Expected data/cache/chogs.json (run the harvest) ' +
      'or the committed data/snapshot/chogs.json (run npm run snapshot:chogs).',
  );
}

/** True when the real collection is available from either source. */
export function collectionAvailable(): boolean {
  return existsSync(CACHE) || existsSync(SNAPSHOT);
}
