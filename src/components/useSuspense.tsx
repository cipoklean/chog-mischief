"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

/**
 * useSuspense — Hark's call 4: wire the suspense bar to the live commit.
 *
 * The rule, exactly as given:
 *   "The result shows when BOTH the server response AND a 1.2s minimum timer
 *    finish (Promise.all). If the server takes more than 10s, show the 'Monad's
 *    taking a nap' state. With reduced motion, keep the 1.2s and drop the shake."
 *
 * ── Why Promise.all and not "wait for whichever is first" ───────────────────
 * The 1.2s floor is a pacing device. A signature round-trip on Monad can return
 * in 180ms, and a result that flashes for a fifth of a second reads as a glitch
 * rather than a payoff — the HIT sting is the reward for the whole gasless
 * signing dance, and it has to land hard enough to feel like one. Waiting for
 * both means the floor always wins, and the animation never plays half-speed.
 *
 * It is also the honest reading of "minimum": a floor, not a target. A slow
 * server (say 4s) shows the bar for 4s, not 1.2s.
 *
 * ── Why 10s is a separate branch and not just a longer bar ─────────────────
 * Beyond 10s something has probably failed — an RPC that never answers, a wallet
 * that never returned. Showing an indefinite progress bar tells the user to keep
 * waiting for something that may never arrive, so past Hark's threshold this
 * swaps to an actionable state with a retry.
 *
 * ── Reduced motion ─────────────────────────────────────────────────────────
 * The 1.2s floor STAYS. Dropping it would make the flow feel faster than it is
 * and would remove the beat that reduced motion is meant to preserve — the
 * request to minimise vestibular animation is a request about movement, not
 * about honesty about timing. Only the shake goes, via the `shake` flag below,
 * which the caller passes to the CSS class. globals.css also neutralises the
 * animation globally, so this is belt and braces.
 */

/** Hark's minimum show time for the result, in ms. */
export const MIN_SUSPENSE_MS = 1_200;
/** Past this, swap the bar for the slow-network state. */
export const SLOW_AFTER_MS = 10_000;
/** How often the bar advances. 100ms is smooth enough and cheap. */
const TICK_MS = 100;

export type SuspensePhase = "idle" | "pending" | "slow" | "done" | "error";

export interface SuspenseState {
  phase: SuspensePhase;
  /** 0-100, for the progress bar. */
  pct: number;
  /** False once elapsed crosses SLOW_AFTER_MS. Drives the shake. */
  shake: boolean;
}

const IDLE: SuspenseState = {
  phase: "idle",
  pct: 0,
  shake: false,
};

export interface SuspenseResult extends SuspenseState {
  /** True when the user asked for reduced motion: keep the 1.2s, drop the shake. */
  reducedMotion: boolean;
  start: () => void;
  reset: () => void;
}

export function useSuspense(): SuspenseResult {
  /**
   * `reducedMotion` is read through a LAZY useState initialiser, not an effect.
   *
   * An effect would (a) trip React's no-setState-in-effect rule, and (b) start the
   * bar's first paint without knowing whether to shake — so a reduced-motion user
   * gets one frame of the animation before it stops. Reading it at first render is
   * both cheaper and more correct. It is a client-only value, so the server passes
   * false; hydration corrects it before anything animates.
   */
  const [reducedMotion, setReducedMotion] = useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  });

  const [state, setState] = useState<SuspenseState>(IDLE);

  // Refs, not state: these are read inside async callbacks where a stale closure
  // would decide whether the run should still be allowed to finish.
  const runId = useRef(0);
  const startedAt = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // Follow the user changing their OS setting mid-session. Listeners belong in
    // an effect; the initial read does not.
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, []);

  function start() {
    // Invalidate any in-flight run. A second commit must not be completed by the
    // first run's server response.
    const id = ++runId.current;
    startedAt.current = Date.now();

    if (timer.current) clearInterval(timer.current);
    setState((s) => ({ ...s, phase: "pending", pct: 0, shake: false }));

    timer.current = setInterval(() => {
      const elapsed = Date.now() - startedAt.current;
      if (id !== runId.current) return;
      setState((s) => ({
        ...s,
        // Clamped to the slow threshold: past 10s the bar stops creeping toward
        // a 100% it will never legitimately reach, and we swap to the slow state.
        pct: Math.min(100, (elapsed / SLOW_AFTER_MS) * 100),
        shake: elapsed > SLOW_AFTER_MS,
        phase: elapsed > SLOW_AFTER_MS ? "slow" : "pending",
      }));
    }, TICK_MS);
  }

  function reset() {
    runId.current += 1;
    if (timer.current) clearInterval(timer.current);
    setState((s) => ({ ...s, phase: "idle", pct: 0, shake: false }));
  }

  return { ...state, reducedMotion, start, reset };
}

/**
 * awaitSuspense — the Promise.all Hark specified.
 *
 * Resolves after BOTH the server call and the 1.2s floor. Rejects as soon as
 * the server call rejects: there is no point holding an error for another second.
 *
 * Exported separately so the logic is unit-testable without React, and so a
 * caller that already has its own suspense state can use the timing rule without
 * the hook.
 */
export async function awaitSuspense<T>(
  server: Promise<T>,
  opts: { minMs?: number; now?: () => number } = {},
): Promise<T> {
  const minMs = opts.minMs ?? MIN_SUSPENSE_MS;
  const now = opts.now ?? Date.now;

  const started = now();
  const elapsed = () => now() - started;
  const floor = new Promise<void>((resolve) => {
    const remaining = minMs - elapsed();
    if (remaining <= 0) resolve();
    else setTimeout(resolve, remaining);
  });

  // Promise.all, not Promise.race: both must finish.
  return Promise.all([server, floor]).then(([value]) => value);
}

/**
 * SuspenseBar — the visible bar. Rendering lives here so the hook stays testable
 * and any surface can adopt the same visual.
 */
export function SuspenseBar({
  state,
  reducedMotion = false,
  children,
  onRetry,
  onKeepWaiting,
}: {
  state: SuspenseState;
  /** Defaults to false so the bar can be rendered standalone in tests and demos. */
  reducedMotion?: boolean;
  children?: ReactNode;
  onRetry?: () => void;
  onKeepWaiting?: () => void;
}) {
  if (state.phase === "idle" || state.phase === "done") return null;

  if (state.phase === "slow") {
    return (
      <div className="x-card" role="status" data-testid="suspense-slow">
        <h3>🐌 Monad&apos;s taking a nap.</h3>
        <p className="x-sm x-mut">
          That signature took over 10 seconds to come back. Nothing was lost — it
          may still land.
        </p>
        <div className="x-row">
          {onRetry ? (
            <button type="button" className="x-btn x-btn--g" onClick={onRetry}>
              Retry
            </button>
          ) : null}
          {onKeepWaiting ? (
            <button type="button" className="x-btn x-btn--k" onClick={onKeepWaiting}>
              Keep waiting
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="x-card" role="status" aria-live="polite" data-testid="suspense-bar">
      <div className="x-row">
        <span aria-hidden="true">👛</span>
        <span className="x-sm">{children ?? "Landing the prank…"}</span>
      </div>
      <div
        aria-hidden="true"
        style={{ height: 8, borderRadius: 9, border: "2px solid var(--x-ink)", overflow: "hidden" }}
      >
        <div
          data-testid="suspense-fill"
          style={{
            width: `${state.pct}%`,
            height: "100%",
            background: "var(--x-y)",
            transition: "width 120ms linear",
            // The shake is decoration on a waiting state; it is dropped under
            // reduced motion both here and by the global CSS rule.
            ...(state.shake && !reducedMotion
              ? { animation: "x-shake 0.5s ease-in-out infinite" }
              : {}),
          }}
        />
      </div>
      <style>{`@keyframes x-shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-3px)}75%{transform:translateX(3px)}}`}</style>
    </div>
  );
}

export default useSuspense;
