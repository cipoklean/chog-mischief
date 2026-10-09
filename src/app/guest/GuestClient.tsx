"use client";

import { useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { ChogCard } from "@/components/ChogCard";
import { Toast } from "@/components/Toast";
import { GuestUpgradeCard } from "@/components/GuestUpgradeCard";
import type { GuestChog, Rival } from "@/lib/guest";
import { pranksForPowers } from "@/game/pranks";
import { powersFor } from "@/game/powers";
import type { ChogTraits } from "@/game/powers";
import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The client half of /guest. STATES.md §2.
 *
 * Split from the server shell because the Chog metadata comes from a cache that
 * reads node:fs, which cannot cross into a browser chunk. The shell resolves it
 * and hands it down as props; this file only owns timers and state.
 *
 * "A NO-WALLET VISITOR IS A FULL PLAYER ... Guest pranks hit practice rivals
 * (bots), never touch the real Supabase leaderboard, and reset on reload. This
 * is the judge path: the full loop with zero signatures."
 *
 * NOTHING HERE TOUCHES THE BACKEND. No fetch to /api, no Supabase import - a
 * guest must not be able to write a row even by accident. All progress is React
 * state, which dies with the tab: exactly the "resets on reload" Hark specified.
 */

export default function GuestClient({
  guest,
  rivals,
}: {
  guest: GuestChog;
  rivals: Rival[];
}): ReactNode {

  const [incoming, setIncoming] = useState<Rival | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [pranked, setPranked] = useState<string[]>([]);
  const [points, setPoints] = useState(0);
  /**
   * Hark's call 3: the upgrade card appears after the FIRST revenge loop, i.e.
   * once the guest has both landed a prank and seen it answered. Set when the
   * incoming card is resolved - taking it or hitting back both end the loop.
   */
  const [loopComplete, setLoopComplete] = useState(false);

  /** Resolve the incoming card: either answer it or shrug it off. Both end the loop. */
  function resolveIncoming(next: number | null) {
    setIncoming(null);
    if (next !== null) setPoints((p) => p + next);
    setLoopComplete(true);
  }

  // The guest's three unlocked pranks, derived from the borrowed Chog's real
  // traits through the same pure engine a real player uses.
  const pranks = useMemo(() => {
    // Same pure engine a signed-in player uses - the guest is only borrowing a
    // Chog, not a different ruleset.
    const powers = powersFor(guest.traits as ChogTraits);
    return pranksForPowers(
      powers,
      powers.signaturePrankId,
      powers.accessoryPrankId,
      powers.legendaryPrankId,
    ).slice(0, 3);
  }, [guest.traits]);

  /**
   * STATES.md §2: "about 8s after a guest prank lands, a practice rival pranks
   * back. Show the x-inc Incoming card and the toast ... so a judge sees revenge
   * and clean-up too."
   *
   * The delay is why this is not instant: the point is to let a judge witness
   * the whole loop rather than be handed a finished screen.
   */
  function prankRival(rival: Rival) {
    setPranked((prev) => [...prev, String(rival.id)]);
    setPoints((p) => p + 10);

    setTimeout(() => {
      setIncoming(rival);
      setToast(`#${String(rival.id).padStart(4, "0")} ${rival.name} wants revenge!`);
    }, rival.revengeAfterMs);
  }

  return (
    <AppShell
      current="hq"
      points={points}
      ammo={5 - pranked.length}
      banner="Guest mode · progress resets · Own a Chog to keep it"
    >
      {/* .x-guest is a plain block on phone - children stack exactly as before.
          At 768px+ it centres the content and pairs the hero cards side by side. */}
      <div className="x-guest">
        <div>
          <h2>Meet your Guest Chog</h2>
          <p className="x-mut x-sm">Borrowed for this session. Nobody&apos;s record changes.</p>
        </div>

        <div className="x-guest__top">
          {/* STATES.md §2: dashed 3px outline + magenta GUEST pill. */}
          <ChogCard
            id={guest.guestId}
            name={guest.name}
            imageUrl={guest.imageUrl}
            guest
            tier={String(guest.traits.Tier ?? "Chog")}
            caption={guest.guestId}
          />

          <div className="x-card">
            <h3>Fully playable</h3>
            <p className="x-sm x-mut">
              Guest pranks hit practice rivals and don&apos;t count on the real
              leaderboard.
            </p>
            <div className="x-row x-wrap">
              {pranks.map((p) => (
                <span key={p.id} className="x-pill">
                  {p.name}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* The rivals. Bots, and labelled as such in their names. At 768px+
            they become a card grid (3 columns tablet, 4 desktop). */}
        <div className="x-card">
          <h3>Practice rivals</h3>
          <p className="x-sm x-mut">
            Hit one, then wait. They pranked back a few seconds later.
          </p>
          <div className="x-rivals">
            {rivals.map((r) => (
              <div key={r.id} className="x-rival">
                <div className="x-row" style={{ minWidth: 0, justifyContent: "center" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img className="x-av" src={r.imageUrl ?? ""} alt="" />
                  <div style={{ minWidth: 0, textAlign: "left" }}>
                    <div style={{ fontFamily: "var(--x-d)", fontSize: 16 }}>{r.name}</div>
                    <div className="x-sm x-mut">Practice bot #{r.id}</div>
                  </div>
                </div>
                <button
                  type="button"
                  className="x-btn x-btn--m"
                  disabled={pranked.includes(String(r.id))}
                  onClick={() => prankRival(r)}
                >
                  {pranked.includes(String(r.id)) ? "Pranked 😈" : "Prank"}
                </button>
              </div>
            ))}
          </div>
        </div>

      {/* STATES.md §2: the rival's revenge arrives as the x-inc incoming card. */}
      {incoming ? (
        <div className="x-card x-inc">
          <h3>💥 Incoming prank</h3>
          <p className="x-sm">
            <b>{incoming.name}</b> pranked you back. You hit 12 points, they lost 8.
          </p>
          <div className="x-row">
            <button type="button" className="x-btn x-btn--g" onClick={() => resolveIncoming(12)}>
              😈 Revenge
            </button>
            <button type="button" className="x-btn x-btn--k" onClick={() => resolveIncoming(null)}>
              Take it
            </button>
          </div>
        </div>
      ) : null}

      {/* Hark's call 3: the honest exit from a session that cannot be saved.
          Placed after the loop, not before it. */}
      <GuestUpgradeCard visible={loopComplete} />

      <Link href="/" className="x-btn x-btn--k x-w">
        Browse Chogs
      </Link>

      <Toast message={toast} onDismiss={() => setToast(null)} />
      </div>
    </AppShell>
  );
}