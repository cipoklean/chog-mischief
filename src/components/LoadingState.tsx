"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";

/**
 * Loading & latency — STATES.md §6.
 *
 * Timings are Hark's and are load-bearing:
 *   under 300ms   show nothing (a flash of skeleton is worse than a delay)
 *   300ms - 10s   show the loading state
 *   over 10s      show the slow state, after trying rpc1 then rpc3
 *
 * STATES.md also says explicitly: LOADING IS NOT x-cd. x-cd is reserved for the
 * daily reset and the daily-limit refusal (see Countdown.tsx). These use
 * skeletons, a bobbing emoji and a progress bar instead.
 *
 * prefers-reduced-motion drops the animation and keeps the text — the shimmer,
 * bob, wiggle and shake are all under the global reduced-motion rule in
 * globals.css, and the 3-dot bounce is handled locally here.
 */

/** Hark's thresholds, in ms. */
export const SHOW_AFTER_MS = 300;
export const SLOW_AFTER_MS = 10_000;

export interface LoadingProps {
  /**
   * What is being waited on, e.g. "Checking #561 is yours…". Optional because
   * the slow state (§6, over 10s) shows only its own headline and actions.
   */
  children?: ReactNode;
  /** Text that replaces the shimmer once we cross the slow threshold. */
  slowTitle?: string;
  slowBody?: string;
  onRetry?: () => void;
  onKeepWaiting?: () => void;
}

export function LoadingState({
  children,
  slowTitle = "🐌 Monad's taking a nap.",
  slowBody = "The network is slow right now.",
  onRetry,
  onKeepWaiting,
}: LoadingProps) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const started = Date.now();
    const id = setInterval(() => setElapsed(Date.now() - started), 100);
    return () => clearInterval(id);
  }, []);

  // Under 300ms: render nothing at all. A skeleton that appears for a fifth of
  // a second reads as a glitch.
  if (elapsed < SHOW_AFTER_MS) return null;

  const slow = elapsed > SLOW_AFTER_MS;
  const pct = Math.min(100, (elapsed / SLOW_AFTER_MS) * 100);

  if (slow) {
    return (
      <div className="x-card" role="status">
        <h3>{slowTitle}</h3>
        <p className="x-sm x-mut">{slowBody}</p>
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
    <div className="x-card" role="status" aria-live="polite">
      <div className="x-row">
        <Dots />
        <span className="x-sm">{children}</span>
      </div>
      {/* Progress bar. aria-hidden: it carries no information the text does not. */}
      <div
        aria-hidden="true"
        style={{ height: 8, borderRadius: 9, border: "2px solid var(--x-ink)", overflow: "hidden" }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background: "var(--x-y)",
            transition: "width 120ms linear",
          }}
        />
      </div>
    </div>
  );
}

/** The 3-dot bounce. Honours prefers-reduced-motion by dropping the animation. */
function Dots() {
  return (
    <span aria-hidden="true" style={{ display: "inline-flex", gap: 3, flex: "none" }}>
      {[0, 1, 2].map((i) => (
        <i
          key={i}
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: "var(--x-y)",
            border: "1px solid var(--x-ink)",
            animation: `x-dot 1s ${i * 0.15}s infinite`,
          }}
        />
      ))}
      <style>{`@keyframes x-dot{0%,60%,100%{transform:translateY(0);opacity:.45}30%{transform:translateY(-5px);opacity:1}}`}</style>
    </span>
  );
}

/**
 * Shimmer skeleton — sticker-shaped blocks the same size as the real content,
 * purple #25174F to #33216a, per STATES.md §6. Used for the pick grid,
 * leaderboard rows and inbox.
 */
export function Skeleton({
  height = 72,
  count = 3,
  className = "x-card",
}: {
  height?: number;
  count?: number;
  className?: string;
}) {
  return (
    <div aria-hidden="true" style={{ display: "grid", gap: 8 }}>
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className={className}
          style={{ height, boxShadow: "none", animation: "x-shimmer 1.4s linear infinite" }}
        />
      ))}
      <style>{`@keyframes x-shimmer{0%{background:#25174F}50%{background:#33216a}100%{background:#25174F}}`}</style>
    </div>
  );
}

/** Ownership check: 🔍 bobbing over the card, per STATES.md §6. */
export function CheckingOwnership({ tokenId }: { tokenId: number }) {
  return (
    <div className="x-card" role="status" aria-live="polite" style={{ textAlign: "center" }}>
      <span className="x-e" style={{ fontSize: 34, display: "inline-block", animation: "x-bob 1.1s ease-in-out infinite" }}>
        🔍
      </span>
      <p className="x-sm">Checking #{tokenId} is yours…</p>
      <style>{`@keyframes x-bob{0%,100%{transform:translateY(0) rotate(-8deg)}50%{transform:translateY(-7px) rotate(8deg)}}`}</style>
    </div>
  );
}

/** Awaiting signature: 👛 wiggling + "No gas. Just a signature." + Cancel. */
export function AwaitingSignature({ onCancel }: { onCancel?: () => void }) {
  return (
    <div className="x-card" role="status" aria-live="polite" style={{ textAlign: "center" }}>
      <span className="x-e" style={{ fontSize: 34, display: "inline-block", animation: "x-wiggle 0.7s ease-in-out infinite" }}>
        👛
      </span>
      <p className="x-sm">Check your wallet to sign</p>
      <p className="x-sm x-mut">No gas. Just a signature.</p>
      {onCancel ? (
        <button type="button" className="x-btn x-btn--k" onClick={onCancel}>
          Cancel
        </button>
      ) : null}
      <style>{`@keyframes x-wiggle{0%,100%{transform:rotate(0)}25%{transform:rotate(-12deg)}75%{transform:rotate(12deg)}}`}</style>
    </div>
  );
}

export default LoadingState;