"use client";

import { useEffect, useState } from "react";
import { RefusalSheet, type RefusalKind } from "@/components/RefusalSheet";
import { LoadingState, Skeleton, CheckingOwnership, AwaitingSignature } from "@/components/LoadingState";
import { Countdown, nextUtcReset } from "@/components/Countdown";
import { AppShell } from "@/components/AppShell";
import { LeftRail, type RailChog } from "@/components/LeftRail";
import { RightRail, type LeaderRow, type RivalryRow } from "@/components/RightRail";
import { ChaosStrip } from "@/components/ChaosStrip";
import type { GuestChog } from "@/lib/guest";
import type { ReactNode } from "react";

/**
 * /refusal-demo - a design harness, not a game screen.
 *
 * STATES.md §4 and §6 specify several screens that exist only as refusals or as
 * latencies, so they cannot be reached on demand in the running game. This route
 * mounts each one so the design can be reviewed and so tests/ui/design.spec.ts
 * can assert them for real instead of asserting on strings in the source.
 *
 * It ALSO mounts the responsive rails (Hark's tablet/desktop spec), because the
 * five game screens that will eventually show them - HQ, Prank, Inbox,
 * Leaderboards, Profile - do not exist yet. The harness is the only place the
 * rail layout can be reviewed and asserted today. The rail sections that need
 * data with no hook yet (Incoming, Weekly top 5, rivalries) show clearly
 * labelled DEMO rows; the sections with real hooks (Daily reset, Chaos feed,
 * Your Chogs in guest mode) show real data.
 *
 * `guest` arrives as a prop from the server shell - see the note there about
 * why the Chog metadata cannot be resolved in a client component.
 *
 * Not in the tab bar on purpose: a judge should never land here by accident.
 */

/** Demo rows for the rail sections that have no data hook yet. Labelled as
 *  demo in the section copy so a reviewer cannot mistake them for real. */
const DEMO_TOP5: LeaderRow[] = [
  { rank: 1, tokenId: 561, name: "Blaze", imageUrl: null, points: 240, mine: true },
  { rank: 2, tokenId: 42, name: "Sir Snorts", imageUrl: null, points: 198 },
  { rank: 3, tokenId: 77, name: "Mister Wobble", imageUrl: null, points: 175 },
  { rank: 4, tokenId: 103, name: "Chogzilla", imageUrl: null, points: 150 },
  { rank: 5, tokenId: 218, name: "Baron Puddles", imageUrl: null, points: 121 },
];

const DEMO_RIVALRIES: RivalryRow[] = [
  { name: "Sir Snorts 7 - 5 Mayhem", mine: 7, theirs: 5 },
  { name: "Mister Wobble 3 - 2 Chogzilla", mine: 3, theirs: 2 },
  { name: "Baron Puddles 1 - 1 Blaze", mine: 1, theirs: 1 },
];

const VARIANTS: RefusalKind[] = [
  "rejected",
  "wrong-signer",
  "not-owner",
  "nonce-replay",
  "daily-limit",
];

export function RefusalDemoClient({ guest }: { guest: GuestChog }): ReactNode {
  // Computed after mount, never during render. A Client Component is still
  // rendered during prerendering, so calling nextUtcReset() inline reads the clock
  // in the same blocked way Countdown.tsx used to - Cache Components rejects it
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

  // Guest-mode left rail: the borrowed Guest Chog, and no switcher targets.
  const guestRailChogs: RailChog[] = [
    { id: guest.guestId, name: guest.name, imageUrl: guest.imageUrl, ready: true },
  ];

  return (
    <AppShell
      current="hq"
      leftRail={
        <LeftRail
          chogs={guestRailChogs}
          guestMode
          feed={<ChaosStrip max={10} />}
        />
      }
      rightRail={
        <RightRail
          incoming={null}
          weeklyTop5={DEMO_TOP5}
          rivalries={DEMO_RIVALRIES}
          feed={<ChaosStrip max={10} />}
        />
      }
    >
      <div>
        <h2>Design states</h2>
        <p className="x-mut x-sm">
          STATES.md §4 refusals and §6 loading, plus the responsive rails (tablet /
          desktop). For review, not for play. Weekly top 5 and rivalries show demo
          rows - no data hook exists for them yet.
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
