/**
 * Guest Chog — STATES.md §2.
 *
 * Hark's decision: A NO-WALLET VISITOR IS A FULL PLAYER. They get a temporary
 * Guest Chog, not a demo reel. This is the judge path: the full loop with zero
 * signatures.
 *
 * HARD BOUNDARY — this file must never touch Supabase or the real leaderboard.
 * Guest pranks hit practice rivals (bots) and reset on reload. A leak here would
 * put fake rows on the real board, which is the one unrecoverable mistake this
 * feature can make. The guest store is deliberately in-memory only: there is no
 * server round-trip to leak, because there is no persistence at all.
 *
 * The Chogs handed out are REAL ones from the harvested collection, renamed to
 * a guest id (#G-0420) with a "Sir Snorts (Guest)" style name. Inventing fake art
 * would misrepresent the collection; borrowing a real Chog with an explicit
 * guest label does not.
 */

import type { ChogTraits } from "@/game/powers";

/**
 * The trait/image data a guest borrows arrives as an ARGUMENT, never an import.
 *
 * `chogs.ts` reads node:fs, so importing it here would drag a server-only module
 * into the browser bundle — which Turbopack rejects at build time with "the
 * chunking context does not support external modules (request: node:fs)". The
 * server component page resolves the data and hands it down as props; this
 * module stays pure and runs on both sides.
 */

export interface GuestChog {
  /** Guest id shown to the player, e.g. "G-0420". Not a real token id. */
  guestId: string;
  /** Display name, e.g. "Sir Snorts (Guest)". */
  name: string;
  /** Real Chog art borrowed for the guest. */
  imageUrl: string | null;
  traits: ChogTraits;
  /** Guest ids are never signed, so they get no ownership address. */
  owner: null;
  isGuest: true;
}

/** Guest ids are drawn from the real range so the art is real Chog art. */
const GUEST_POOL = [420, 118, 1866, 27, 903, 1544, 611, 39, 1277, 745];

let guestPick: GuestChog | null = null;

/**
 * Deterministic per browser session. `Math.random()` here would make the guest
 * differ between server render and client render and break hydration; picking by
 * the current minute is stable for a reload burst without persisting anything.
 */
function pickIndex(): number {
  const minute = Math.floor(Date.now() / 60_000);
  return minute % GUEST_POOL.length;
}

/**
 * The guest Chog for this visit. Returns the same value within a minute so the
 * UI does not reshuffle on every render.
 */
export type ChogLookup = (tokenId: number) => { imageUrl: string | null; traits: ChogTraits } | null;

export function getGuestChog(lookup: ChogLookup): GuestChog {
  if (guestPick) return guestPick;

  const tokenId = GUEST_POOL[pickIndex()];
  const real = lookup(tokenId);
  const guestNumber = String(GUEST_POOL[pickIndex()]).padStart(4, "0");

  const built: GuestChog = {
    guestId: `G-${guestNumber}`,
    name: `${guestName(tokenId)} (Guest)`,
    imageUrl: real?.imageUrl ?? null,
    traits: real?.traits ?? {},
    owner: null,
    isGuest: true,
  };
  guestPick = built;
  return built;
}

const GUEST_NAMES = [
  "Sir Snorts",
  "Wobblebottom",
  "Chonk McChogface",
  "Sir Nibblesworth",
  "Mister Wobble",
  "Baron Puddles",
  "Lady Choggles",
  "Chogzilla",
  "Sir Fluffernutter",
  "Wobbleton",
];

function guestName(tokenId: number): string {
  return GUEST_NAMES[tokenId % GUEST_NAMES.length];
}

/**
 * Practice rivals — the bots a guest can prank. Fixed ids from the real
 * collection, labelled so nobody mistakes a bot for a person. STATES.md §2 also
 * requires that a rival pranks BACK about 8s after a guest prank lands, so a
 * judge sees revenge and cleanup without a second human.
 */
export const RIVAL_IDS = [311, 908, 1442, 56, 1702] as const;

export interface Rival {
  id: number;
  name: string;
  imageUrl: string | null;
  /** Revenge lands this many ms after the guest's prank. */
  revengeAfterMs: number;
}

export function getRivals(lookup: ChogLookup): Rival[] {
  return RIVAL_IDS.map((id, i) => ({
    id,
    name: `${guestName(id + 3)} ${["I", "II", "III", "IV", "V"][i]}`,
    imageUrl: lookup(id)?.imageUrl ?? null,
    // Staggered so two rivals never fire simultaneously.
    revengeAfterMs: 8000 + i * 1200,
  }));
}

/** True when this session is a guest. Guests never write to the real backend. */
export function isGuestSession(): boolean {
  return guestPick !== null;
}

/** Test hook: forget the guest so the next call picks a fresh one. */
export function resetGuestForTest(): void {
  guestPick = null;
}