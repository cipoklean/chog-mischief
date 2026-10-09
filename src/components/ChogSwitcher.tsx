"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { PrankOverlay } from "./PrankOverlay";
import { ConnectWallet } from "./ConnectWallet";

/**
 * ChogSwitcher — the avatar chip in the header, which opens the Chog
 * switcher (Hark's header spec: "active Chog avatar chip, which opens the
 * Chog switcher").
 *
 * ── Phone vs desktop ───────────────────────────────────────────────────────
 * On phone this is the same centred overlay every other modal uses (the
 * prototype's .x-ov), unchanged. At 768px+ it is a centred dialog, max
 * 440px, dimmed 70% #140B2E backdrop, Esc closes, backdrop click closes,
 * focus is trapped and returned — all of which PrankOverlay now provides.
 * There is deliberately no separate "bottom sheet" implementation: one
 * modal, one shape, one place where the behaviour lives.
 *
 * The list itself is the same compact switcher as the left rail's "Your
 * Chogs": avatar, name, #id, and a green "Prank ready" or grey "Used
 * today" pill. Picking one calls onPick; the caller owns what "active"
 * means, so this component stays presentational.
 */

export interface SwitcherChog {
  id: string | number;
  name: string;
  imageUrl?: string | null;
  /** true = has a prank available today; false = already used today. */
  ready: boolean;
}

export interface ChogSwitcherProps {
  chogs: SwitcherChog[];
  avatarUrl: string;
  activeId?: string | number | null;
  onPick?: (id: string | number) => void;
  /**
   * Guest mode: the list shows the Guest Chog and a "Connect to use real
   * Chogs" card instead of switching anything, because a guest owns nothing
   * to switch to.
   */
  guest?: ReactNode;
}

export function ChogSwitcher({ chogs, avatarUrl, activeId, onPick, guest }: ChogSwitcherProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="x-avchip"
        aria-label="Switch Chog"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        style={{
          background: "none",
          border: 0,
          padding: 0,
          cursor: "pointer",
          minWidth: "var(--tap)",
          minHeight: "var(--tap)",
          display: "grid",
          placeItems: "center",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="x-av" src={avatarUrl} alt="" style={{ width: 40, height: 40 }} />
      </button>

      <PrankOverlay
        open={open}
        labelledBy="switcher-headline"
        headline={<h2 id="switcher-headline" style={{ fontSize: 24 }}>Switch Chog</h2>}
        onClose={() => setOpen(false)}
      >
        <div className="x-col" style={{ gap: 8, textAlign: "left" }}>
          {guest ?? (
            chogs.map((c) => (
              <button
                key={String(c.id)}
                type="button"
                className="x-rail__chog"
                aria-pressed={String(c.id) === String(activeId ?? "")}
                onClick={() => {
                  onPick?.(c.id);
                  setOpen(false);
                }}
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
            ))
          )}
          {guest ? (
            <div className="x-card" style={{ boxShadow: "none", textAlign: "center" }}>
              <p className="x-sm x-mut">Connect to use real Chogs</p>
              <ConnectWallet label="🔗 Connect wallet" className="x-btn x-btn--p x-w" />
            </div>
          ) : null}
        </div>
      </PrankOverlay>
    </>
  );
}

export default ChogSwitcher;
