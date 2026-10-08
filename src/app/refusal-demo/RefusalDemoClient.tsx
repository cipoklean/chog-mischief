"use client";

import { useEffect, useState } from "react";
import { RefusalSheet, type RefusalKind } from "@/components/RefusalSheet";
import { LoadingState, Skeleton, CheckingOwnership, AwaitingSignature } from "@/components/LoadingState";
import { Countdown, nextUtcReset } from "@/components/Countdown";
import { AppShell } from "@/components/AppShell";
import type { ReactNode } from "react";

/**
 * /refusal-demo — a design harness, not a game screen.
 *
 * STATES.md §4 and §6 specify several screens that exist only as refusals or as
 * latencies, so they cannot be reached on demand in the running game. This route
 * mounts each one so the design can be reviewed and so tests/ui/design.spec.ts
 * can assert them for real instead of asserting on strings in the source.
 *
 * `resetTo` arrives as a number from the server shell — see the note there about
 * Cache Components rejecting `new Date()` during prerender.
 *
 * Not in the tab bar on purpose: a judge should never land here by accident.
 */

const VARIANTS: RefusalKind[] = [
  "rejected",
  "wrong-signer",
  "not-owner",
  "nonce-replay",
  "daily-limit",
];

export function RefusalDemoClient(): ReactNode {
  // Computed after mount, never during render. A Client Component is still
  // rendered during prerendering, so calling nextUtcReset() inline reads the clock
  // in the same blocked way Countdown.tsx used to — Cache Components rejects it
  // as an unstable value. useEffect is the escape hatch Next documents.
  const [resetTo, setResetTo] = useState<number | null>(null);

  useEffect(() => {
    // Re-anchor when crossing UTC midnight, so a tab left open overnight shows
    // the new reset rather than a spent one.
    const tick = () => setResetTo(nextUtcReset().getTime());
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);

  const [kind, setKind] = useState<RefusalKind | null>(null);
  const [slow, setSlow] = useState(false);

  return (
    <AppShell current="hq">
      <div>
        <h2>Design states</h2>
        <p className="x-mut x-sm">
          STATES.md §4 refusals and §6 loading. For review, not for play.
        </p>
      </div>

      <div className="x-card">
        <h3>§4 Signature refusals</h3>
        <div className="x-col" style={{ gap: 8 }}>
          {VARIANTS.map((k) => (
            <button key={k} type="button" className="x-btn x-btn--k" onClick={() => setKind(k)}>
              {k}
            </button>
          ))}
        </div>
      </div>

      <div className="x-card">
        <h3>§6 Loading</h3>
        <div className="x-col" style={{ gap: 8 }}>
          <LoadingState>Checking Monad…</LoadingState>
          <CheckingOwnership tokenId={561} />
          <AwaitingSignature />
          <button type="button" className="x-btn x-btn--k" onClick={() => setSlow(!slow)}>
            toggle slow state
          </button>
          {slow ? (
            <LoadingState
              slowTitle="🐌 Monad's taking a nap."
              onRetry={() => setSlow(false)}
              onKeepWaiting={() => setSlow(false)}
            />
          ) : null}
        </div>
      </div>

      <div className="x-card">
        <h3>§5 Empty states</h3>
        <div className="x-card x-stat">
          <b>?</b>
          <span className="x-sm">Land your first prank to unlock First Blood.</span>
        </div>
        <Skeleton count={2} />
      </div>

      <div className="x-card">
        <h3>Daily reset</h3>
        {resetTo === null ? null : <Countdown to={resetTo} label="Reloads in" />}
      </div>

      <button type="button" className="x-btn x-btn--k" onClick={() => setKind(null)}>
        close
      </button>

      <RefusalSheet
        kind={kind}
        tokenId={561}
        onAction={(a) => {
          // Cycle through the variants so one page exercises all five.
          if (a === "retry" || a === "reconnect") return;
          const i = kind ? VARIANTS.indexOf(kind) : -1;
          setKind(VARIANTS[(i + 1) % VARIANTS.length] ?? null);
        }}
        onClose={() => setKind(null)}
      />
    </AppShell>
  );
}
export default RefusalDemoClient;
