"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Countdown, nextUtcReset } from "./Countdown";
import { ConnectWallet } from "./ConnectWallet";

/**
 * LeftRail - the 1200px+ desktop left rail. the product spec, section by section:
 *
 *   1. "Your Chogs": compact switcher list - avatar, name, #id, a green
 *      "Prank ready" pill or a grey "Used today" pill. Click to make active.
 *      In guest mode it shows the Guest Chog + a "Connect to use real Chogs"
 *      card.
 *   2. "Daily reset": the x-cd countdown to 00:00 UTC (the existing Countdown
 *      component - x-cd is ONLY for the daily reset, per STATES.md §6).
 *   3. "Chaos Feed": the live feed, 10 items, the existing ChaosFeed
 *      component (passed in as a node by the caller).
 *
 * ── Data boundary ──────────────────────────────────────────────────────────
 * This component takes `chogs` as props. It does NOT read the session, does
 * not query Supabase and does not touch the chain - the five screens that
 * will render it own that data and pass it down. Keeping the rail
 * presentational means the same component works for a signed-in player and
 * for a guest, and the guest cannot accidentally reach the backend through
 * it.
 *
 * The reset instant is read in an effect, never during render: a client
 * component is still rendered during prerender, and Cache Components rejects
 * a render-time clock ("blocking-prerender-current-time-client"). This is
 * the same discipline Countdown itself follows.
 */

export interface RailChog {
  id: string | number;
  name: string;
  imageUrl?: string | null;
  /** true = has a prank available today; false = already used today. */
  ready: boolean;
}

export interface LeftRailProps {
  chogs: RailChog[];
  activeId?: string | number | null;
  onPick?: (id: string | number) => void;
  /** Guest mode: show the Guest Chog plus a connect card. */
  guestMode?: boolean;
  /** The live chaos feed - a <ChaosStrip> node supplied by the caller. */
  feed?: ReactNode;
}

export function LeftRail({ chogs, activeId, onPick, guestMode = false, feed }: LeftRailProps) {
  // The reset instant: computed after mount, for the reason above. Wrapped in
  // a named function rather than called inline - a synchronous setState in an
  // effect body triggers a cascading render (react-hooks/set-state-in-effect),
  // and this is the same pattern RefusalDemoClient uses.
  const [resetTo, setResetTo] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setResetTo(nextUtcReset().getTime());
    tick();
  }, []);

  return (
    <>
      <section className="x-card">
        <h3>Your Chogs</h3>
        <div className="x-rail__list">
          {chogs.map((c) => (
            <button
              key={String(c.id)}
              type="button"
              className="x-rail__chog"
              aria-pressed={String(c.id) === String(activeId ?? "")}
              onClick={() => onPick?.(c.id)}
            >
              {c.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="x-av" src={c.imageUrl} alt="" />
              ) : (
                <span className="x-av" aria-hidden="true" />
              )}
              <span className="x-rail__chog-name">
                {c.name} <span className="x-mut">#{c.id}</span>
              </span>
              <span
                className="x-pill"
                style={
                  c.ready
                    ? { background: "var(--x-g)" }
                    : { background: "var(--x-card)", color: "var(--x-mut)" }
                }
              >
                {c.ready ? "Prank ready" : "Used today"}
              </span>
            </button>
          ))}
        </div>
        {guestMode ? (
          <div className="x-card" style={{ boxShadow: "none", textAlign: "center" }}>
            <p className="x-sm x-mut">Connect to use real Chogs</p>
            <ConnectWallet label="🔗 Connect wallet" className="x-btn x-btn--p x-w" />
          </div>
        ) : null}
      </section>

      <section className="x-card">
        <h3>Daily reset</h3>
        {resetTo === null ? (
          // Reserve the space so the rail does not jump when the digits land.
          <span className="x-cd" aria-hidden="true">
            --:--:--
          </span>
        ) : (
          <Countdown to={resetTo} label="Next prank in" />
        )}
      </section>

      {feed ? <section className="x-card">{feed}</section> : null}
    </>
  );
}

export default LeftRail;
