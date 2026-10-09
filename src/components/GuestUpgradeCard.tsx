"use client";

import { useState } from "react";
import { ConnectWallet } from "@/components/ConnectWallet";

/**
 * The guest upgrade card - Hark's call 3.
 *
 * Copy, verbatim from the call:
 *   "Like it? Connect a Chog to make it count."
 *   [Connect wallet]  [Keep practicing]
 *
 * ── Why the guest does NOT get to prank real Chogs ──────────────────────────
 * A guest owns nothing. If a guest could hit a real token, three things break at
 * once: anyone could spam a real player's card without proving anything; the
 * leaderboard would fill with rows no NFT stands behind; and "the NFT is the
 * player" - the premise the whole product rests on - would be false. So the guest
 * loop is bots only, and this card is the honest exit from it: the game is real,
 * the persistence is not, here is how to make it real.
 *
 * It appears AFTER the first revenge loop completes, not before. Shown too early
 * it reads as a paywall in front of the game; shown after the player has felt
 * the loop it reads as an upgrade, which is what it is.
 *
 * "Keep practicing" dismisses it permanently for the session - re-asking someone
 * who already said no is worse than losing the upsell.
 */

const STORAGE_KEY = "chog:guest-upgrade-dismissed";

export function GuestUpgradeCard({ visible }: { visible: boolean }) {
  /**
   * Read localStorage DURING RENDER rather than in an effect.
   *
   * This looks like it should be an effect, and it is not: reading it in an
   * effect means the first paint shows the card and a tick later it vanishes,
   * which for a dismissible upsell means the user sees a flash of something they
   * already refused. A lazy useState initialiser runs once, on the client, at
   * first render - no flash, no cascading re-render, no ref.
   *
   * Server-rendered HTML therefore contains no card at all. That is correct: the
   * card's visibility is per-visitor session state, and prerendering someone
   * else's dismissal would be wrong.
   */
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === "undefined") return true; // never show pre-hydration
    try {
      return window.localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      // Private mode can throw on localStorage. Losing the dismissal across a
      // reload is a far smaller failure than a guest-facing crash.
      return false;
    }
  });

  // The guest flow owns the "the loop actually finished" signal; `visible` is that
  // signal. The ref in the previous version existed only to double-check it, and
  // reading a ref during render is what React's compiler rules forbid.
  if (!visible || dismissed) return null;

  function keepPractising() {
    setDismissed(true);
    try {
      window.localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // Non-fatal: worst case the card reappears next reload.
    }
  }

  return (
    <div className="x-card" data-testid="guest-upgrade">
      {/* Same copy as the landing page's fine print, deliberately: "make it
          permanent" and "forever" both implied the record lives on the chain,
          and it does not. It lives in this game's database, keyed to the token
          and travelling with it. What IS verifiable is the signature. */}
      <h3>Like it? Connect a Chog to make it count.</h3>
      <p className="x-sm x-mut">
        Guest pranks vanish when you close the tab. Connect any Chog and the same
        loop keeps your points, badges and grudges - signed, verifiable, and
        travelling with the Chog if you sell it.
      </p>
      <div className="x-row x-wrap" style={{ marginTop: 10 }}>
        <ConnectWallet label="🔗 Connect wallet" className="x-btn x-btn--p" />
        <button type="button" className="x-btn x-btn--k" onClick={keepPractising}>
          Keep practicing
        </button>
      </div>
    </div>
  );
}

export default GuestUpgradeCard;
