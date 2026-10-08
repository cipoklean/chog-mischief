"use client";

import { useEffect, useState } from "react";

/**
 * Countdown — the `x-cd` treatment.
 *
 * HERMES_UI_RULES rule 5 names this a component. STATES.md is explicit about its
 * scope: x-cd is ONLY for the daily reset and the daily-limit refusal. Loading
 * states must NOT use it — they use skeletons (see LoadingState.tsx).
 *
 * It ticks, because a countdown that does not tick is a lie: it would freeze at
 * the server-rendered value and stop agreeing with the server that enforces the
 * limit. suppressHydrationWarning is deliberate — the server and client render
 * the first frame a second apart, and this number must not flash.
 *
 * It counts down to a UTC midnight, because that is when the limit actually
 * resets. A local-midnight countdown would disagree with the server.
 */
export interface CountdownProps {
  /** Any future instant. Renders "00:00:00" once it has passed. */
  to: Date | number;
  label?: string;
  format?: "clock" | "short";
}

function split(ms: number): { h: number; m: number; s: number } {
  const total = Math.floor(Math.max(0, ms) / 1000);
  return {
    h: Math.floor(total / 3600),
    m: Math.floor((total % 3600) / 60),
    s: total % 60,
  };
}

function clockOf(ms: number): string {
  const { h, m, s } = split(ms);
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

export function Countdown({ to, label, format = "clock" }: CountdownProps) {
  const target = typeof to === "number" ? to : to.getTime();

  // Start at null and fill it in after mount. Reading the clock DURING render
  // blocks prerendering under Cache Components ("blocking-prerender-current-time-
  // client"), because the value cannot be reproduced. Next's own guidance is to
  // defer it, and that is what this does: one tick later the countdown appears.
  //
  // It does not freeze the value. The interval keeps it live, and a tab left open
  // across midnight re-anchors to the new target because `to` is re-passed on
  // the next render.
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => setRemaining(target - Date.now());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [target]);

  const { h, m } = split(remaining ?? 0);
  const text = format === "short" ? `${h}h ${m}m` : clockOf(remaining ?? 0);

  return (
    <div style={{ display: "grid", gap: 4 }}>
      {label ? <span className="x-sm x-mut">{label}</span> : null}
      {remaining === null ? (
        // Reserve the space so the layout does not jump when the digits land.
        <span className="x-cd" aria-hidden="true">
          {"--:--:--"}
        </span>
      ) : (
        <span className="x-cd">{text}</span>
      )}
    </div>
  );
}

/** The next 00:00 UTC — when the daily limit resets server-side. */
export function nextUtcReset(from: Date = new Date()): Date {
  const next = new Date(from);
  next.setUTCHours(24, 0, 0, 0);
  return next;
}

export default Countdown;