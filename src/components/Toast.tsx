"use client";

import { useEffect } from "react";

/**
 * Toast - UI_RULES rule 5 names this a component.
 *
 * The prototype's `.x-toast`: a single green sticker near the bottom of the
 * screen. Used by the guest loop for "a rival wants revenge" (STATES.md §2).
 *
 * Self-dismissing, because a toast that needs a tap to leave is a modal. The
 * auto-dismiss is announced politely rather than being a silent disappearing
 * act.
 */

export interface ToastProps {
  message: string | null;
  /** ms before it leaves. the reviewer's guest flow shows one at a time. */
  durationMs?: number;
  onDismiss: () => void;
}

export function Toast({ message, durationMs = 4000, onDismiss }: ToastProps) {
  useEffect(() => {
    if (!message) return;
    const id = setTimeout(onDismiss, durationMs);
    return () => clearTimeout(id);
  }, [message, durationMs, onDismiss]);

  if (!message) return null;

  return (
    <div className="x-toast" role="status" aria-live="polite">
      {message}
    </div>
  );
}

export default Toast;