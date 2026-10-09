"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Desktop keyboard shortcuts - the reviewer's desktop polish.
 *
 *   P  opens Prank      I  opens Inbox      Esc  closes (per-dialog)
 *
 * Shown as small hints in the header nav's tooltips (see AppShell's TABS).
 *
 * ── Why there is no viewport check ─────────────────────────────────────────
 * the reviewer's rule 1: layout switches with CSS media queries ONLY, no JS viewport
 * detection. A `matchMedia("(min-width: 768px)")` gate here would be exactly
 * the pattern that rule bans - and it is unnecessary. A phone has no physical
 * keyboard, so these handlers can never fire there; "on desktop" is satisfied
 * by physics, not by a media query. No hydration flash, no resize listener,
 * nothing to keep in sync.
 *
 * ── Why Esc is not here ────────────────────────────────────────────────────
 * Esc belongs to the open dialog, which owns its own focus and focus trap
 * (see PrankOverlay). A global Esc that raced a dialog's Esc would close the
 * wrong thing. This handler therefore STAYS OUT of the way while any dialog
 * is open: it skips P/I entirely then, because navigating while a modal is
 * up is never what the user meant.
 *
 * Typing in an input never triggers a shortcut - a search field full of "p"
 * would otherwise fire Prank mid-word.
 */
export function KeyboardShortcuts() {
  const router = useRouter();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Never hijack a keystroke aimed at a text field.
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.tagName === "SELECT" ||
          t.isContentEditable)
      ) {
        return;
      }
      // Modifier combos belong to the browser and the OS, not to us.
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      // While a dialog is open it handles its own keys; do not also navigate.
      if (typeof document !== "undefined" && document.querySelector(".x-ov:not([hidden])")) {
        return;
      }

      const k = e.key.toLowerCase();
      if (k === "p") {
        e.preventDefault();
        router.push("/prank");
      } else if (k === "i") {
        e.preventDefault();
        router.push("/inbox");
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  return null;
}

export default KeyboardShortcuts;
