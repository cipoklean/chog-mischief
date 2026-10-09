"use client";

import { useEffect, useRef } from "react";
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
 *
 * ── Modal behaviour (Hark's desktop call) ──────────────────────────────────
 *   - Esc closes (when onClose is provided — a critical dialog with no close
 *     affordance is not dismissible by the keyboard, by design).
 *   - Clicking the backdrop closes the same non-critical dialogs.
 *   - Focus is trapped inside the box while open and RETURNED to whatever
 *     opened it on close. This is not decoration: a keyboard user who opens
 *     the switcher and presses Esc must land back on the avatar chip, not at
 *     the top of the document.
 * These behaviours apply at every size. The PHONE view is visually unchanged
 * (the prototype's overlay was already a centred .x-ov) — only the
 * interactions are added, never the layout.
 *
 * ── size ───────────────────────────────────────────────────────────────────
 * "sm" is the standard 440px dialog. "lg" is the 520px share-card modal Hark
 * specified. Default stays sm so nothing else changes.
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
  /** "sm" = 440px dialog (default); "lg" = 520px share-card modal. */
  size?: "sm" | "lg";
}

const VARIANT: Record<string, string> = {
  y: "x-btn",
  m: "x-btn x-btn--m",
  g: "x-btn x-btn--g",
  p: "x-btn x-btn--p",
  k: "x-btn x-btn--k",
};

/** Everything focusable inside the dialog, in tab order. */
function focusables(box: HTMLElement): HTMLElement[] {
  return [
    ...box.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
    ),
  ].filter((el) => el.offsetParent !== null || el === document.activeElement);
}

export function PrankOverlay({
  open,
  headline,
  children,
  actions = [],
  onClose,
  confetti = 0,
  labelledBy,
  size = "sm",
}: PrankOverlayProps) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  // Whatever had focus when we opened, so Esc/close can hand it back.
  const returnFocusTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    // Remember the opener and move focus into the dialog.
    returnFocusTo.current = (document.activeElement as HTMLElement) ?? null;
    const box = boxRef.current;
    if (box) {
      const first = focusables(box)[0] ?? box;
      first.focus();
    }

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && onClose) {
        e.preventDefault();
        onClose();
        return;
      }
      // Trap Tab inside the dialog.
      if (e.key === "Tab" && box) {
        const items = focusables(box);
        if (items.length === 0) {
          e.preventDefault();
          box.focus();
          return;
        }
        const firstEl = items[0];
        const lastEl = items[items.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && (active === firstEl || active === box)) {
          e.preventDefault();
          lastEl.focus();
        } else if (!e.shiftKey && active === lastEl) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    }

    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      // Hand focus back to the opener — but only if focus is still somewhere
      // inside this dialog, so we never yank focus from a newly focused
      // element the user reached by other means.
      const back = returnFocusTo.current;
      if (back && document.contains(back) && box && !box.contains(document.activeElement)) {
        back.focus();
      }
    };
  }, [open, onClose]);

  // hidden + the CSS rule, not conditional rendering: the prototype keeps the
  // node and toggles it, and a mount/unmount remounts and re-animates it.
  if (!open) return <div className="x-ov" hidden aria-hidden="true" />;

  return (
    <div
      className="x-ov"
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      // Backdrop click closes non-critical dialogs. Checking the target is
      // what makes a click INSIDE the box not count as a backdrop click.
      onClick={(e) => {
        if (e.target === e.currentTarget && onClose) onClose();
      }}
    >
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

      <div
        className="x-ov__box"
        data-size={size}
        ref={boxRef}
        tabIndex={-1}
        style={{ outline: "none" }}
      >
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
          <button
            type="button"
            className="x-sm x-mut"
            onClick={onClose}
            style={{ background: "none", border: 0, minHeight: "var(--tap)", color: "var(--x-mut)" }}
          >
            Close
          </button>
        ) : null}
      </div>
    </div>
  );
}

export default PrankOverlay;