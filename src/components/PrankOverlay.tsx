"use client";

import type { ReactNode } from "react";

/**
 * PrankOverlay — HERMES_UI_RULES rule 5 names this a component.
 *
 * The prototype's `.x-ov` / `.x-ov__box`, used for the HIT / DODGED sting, the
 * share card and the wrong-network modal.
 *
 * Reduced motion: the global rule in globals.css neutralises the animations, so
 * the box still appears with all its text. Nothing here depends on animation to
 * convey meaning.
 */

export interface PrankOverlayProps {
  open: boolean;
  /** Emoji + headline, e.g. "💥 HIT!" or "🛡️ DODGED!". */
  headline: ReactNode;
  children?: ReactNode;
  /** One or two buttons along the bottom. */
  actions?: { label: string; onClick?: () => void; variant?: "y" | "m" | "g" | "p" | "k"; href?: string }[];
  onClose?: () => void;
  /** Extra confetti pieces. Kept subtle: the design does not spray confetti. */
  confetti?: number;
  labelledBy?: string;
}

const VARIANT: Record<string, string> = {
  y: "x-btn",
  m: "x-btn x-btn--m",
  g: "x-btn x-btn--g",
  p: "x-btn x-btn--p",
  k: "x-btn x-btn--k",
};

export function PrankOverlay({
  open,
  headline,
  children,
  actions = [],
  onClose,
  confetti = 0,
  labelledBy,
}: PrankOverlayProps) {
  // hidden + the CSS rule, not conditional rendering: the prototype keeps the
  // node and toggles it, and a mount/unmount remounts and re-animates it.
  if (!open) return <div className="x-ov" hidden aria-hidden="true" />;

  return (
    <div className="x-ov" role="dialog" aria-modal="true" aria-labelledby={labelledBy}>
      {Array.from({ length: confetti }, (_, i) => (
        <i
          key={i}
          className="x-cf"
          style={{
            left: `${(i * 37) % 100}%`,
            background: ["var(--x-y)", "var(--x-m)", "var(--x-g)", "var(--x-p)"][i % 4],
            animationDuration: `${1.6 + (i % 5) * 0.4}s`,
            animationDelay: `${(i % 7) * 0.18}s`,
          }}
          aria-hidden="true"
        />
      ))}

      <div className="x-ov__box">
        {typeof headline === "string" ? (
          <div className="x-boom" id={labelledBy}>
            {headline}
          </div>
        ) : (
          <div id={labelledBy}>{headline}</div>
        )}

        {children}

        {actions.length > 0 ? (
          <div className="x-col" style={{ gap: 8 }}>
            {actions.map((a) =>
              a.href ? (
                <a key={a.label} className={VARIANT[a.variant ?? "y"]} href={a.href}>
                  {a.label}
                </a>
              ) : (
                <button
                  key={a.label}
                  type="button"
                  className={VARIANT[a.variant ?? "y"]}
                  onClick={a.onClick}
                >
                  {a.label}
                </button>
              ),
            )}
          </div>
        ) : null}

        {onClose ? (
          <button type="button" className="x-sm x-mut" onClick={onClose} style={{ background: "none", border: 0, minHeight: "var(--tap)", color: "var(--x-mut)" }}>
            Close
          </button>
        ) : null}
      </div>
    </div>
  );
}

export default PrankOverlay;