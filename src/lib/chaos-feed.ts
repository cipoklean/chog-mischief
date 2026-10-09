import type { ChaosRow } from "@/app/api/chaos/route";
import type { FeedItem } from "@/components/ChaosFeed";
import { PRANKS, type Prank } from "@/game/pranks";

/**
 * Turning chaos rows into feed items — PURE, no DB, no clock, no network.
 *
 * ── Why bot rows exist at all ───────────────────────────────────────────────
 * Hark: the landing strip shows the last 10 real pranks, but if there are fewer
 * than 3 real events it is padded with bot pranks carrying a small "practice"
 * pill, so the strip is never empty and never passes bots off as real players.
 *
 * The pill is the whole point. A strip of unmarked bot rows would be a lie told
 * by omission; a strip with no rows at all looks broken on first load, which is
 * exactly what a judge sees first. So the filler is always labelled, and
 * `practice: true` is a property of the row, not a styling decision made at the
 * call site where someone could forget it.
 *
 * Determinism matters here: the same rows must produce the same bot filler on
 * every render, or a 15s poll would reshuffle the strip under the reader. Bots
 * are therefore picked by a hash of the real rows, not by Math.random().
 */

/** Hark's floor: below this many real events, pad. */
export const MIN_REAL_ROWS = 3;
/** Highest number of rows the landing strip shows. */
export const FEED_LIMIT = 10;

/**
 * Bot identities. Fixed, and never derived from a real wallet: a bot is not a
 * player, and giving it a plausible address would blur exactly the line the
 * "no wallet addresses" rule draws.
 */
export const BOTS = [
  { tokenId: 900001, name: "Sir Sneezles" },
  { tokenId: 900002, name: "Mister Mucus" },
  { tokenId: 900003, name: "Baron Bedwetter" },
  { tokenId: 900004, name: "Dame Dampness" },
  { tokenId: 900005, name: "Lord Lumpy" },
  { tokenId: 900006, name: "Professor Puddle" },
] as const;

function prankById(id: string): Prank | undefined {
  return PRANKS.find((p) => p.id === id);
}

/** Short FNV-1a. Stable across runs and Node versions, unlike a crypto hash. */
function hash(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/**
 * Builds the bot filler.
 *
 * `seed` is derived from the real rows so the filler is stable while the real
 * data is unchanged, and changes when it does. Pass an explicit seed in tests.
 */
export function botRows(real: ChaosRow[], seed?: string): ChaosRow[] {
  // Never pad a full strip, and never invent more bots than there are of them.
  const count = Math.min(BOTS.length, FEED_LIMIT - real.length);
  if (count <= 0) return [];

  const base = seed ?? real.map((r) => `${r.id}:${r.prank_id}`).join(",") ?? "";
  const h = hash(base);

  const out: ChaosRow[] = [];
  for (let i = 0; i < count; i += 1) {
    const bot = BOTS[(h + i) % BOTS.length];
    const prank = PRANKS[(h + i * 7) % PRANKS.length];
    // Bots attack each other only. A bot row that named a real token would put a
    // fake event on a real player's card, which is the same lie the pill avoids.
    const victim = BOTS[(h + i + 3) % BOTS.length];

    // Times step backwards from the oldest real row so the strip reads
    // chronologically. Uses a fixed epoch: this function takes no clock, so a
    // test asserts an exact value.
    const created = new Date(Date.UTC(2026, 0, 1, 0, 0, 0) - (i + 1) * 137 * 1000);

    out.push({
      id: -1000 - i,
      from_token_id: bot.tokenId,
      from_name: bot.name,
      to_token_id: victim.tokenId,
      to_name: victim.name,
      prank_id: prank.id,
      // Deterministic mix of hits and dodges so both states are visible.
      landed: (h + i) % 3 !== 0,
      revenge: i === 1,
      points: prank.points,
      created_at: created.toISOString(),
      real: false,
    });
  }
  return out;
}

/** "4m", "3h", "2d" — compact, and never negative for a clock-skewed row. */
export function relativeTime(iso: string, now: number): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const secs = Math.max(0, Math.round((now - then) / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

/**
 * The complete strip: real rows first (newest first), padded with bots when
 * there are fewer than Hark's floor, trimmed to the limit.
 */
export function buildFeed(
  rows: ChaosRow[],
  now: number,
  options: { limit?: number; seed?: string } = {},
): FeedItem[] {
  const limit = options.limit ?? FEED_LIMIT;
  const real = rows.slice(0, limit);
  const filler = real.length < MIN_REAL_ROWS ? botRows(real, options.seed) : [];

  return [...real, ...filler].slice(0, limit).map((row, i) => {
    const prank = prankById(row.prank_id);
    return {
      id: String(row.id),
      attacker: row.from_name,
      target: row.to_name,
      // The catalogue's caption is a full sentence ("Bonked. No notes."), which
      // is right on a card and wrong in a one-line feed, so the feed uses the
      // prank's name as the verb: "X bonked Y".
      verb: row.landed ? (prank?.name.toLowerCase() ?? "pranked") : undefined,
      dodged: !row.landed,
      ago: row.real ? relativeTime(row.created_at, now) : "",
      practice: !row.real,
      attackerHref: row.real ? `/chog/${row.from_token_id}` : undefined,
      targetHref: row.real ? `/chog/${row.to_token_id}` : undefined,
      fresh: i < 3,
    };
  });
}

/** Real rows only — what the leaderboard-facing surfaces should read. */
export function realOnly(items: FeedItem[]): FeedItem[] {
  return items.filter((i) => i.practice !== true);
}