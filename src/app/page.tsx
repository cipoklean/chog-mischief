import Link from "next/link";
import type { ReactNode } from "react";
import { AppShell } from "@/components/AppShell";

/**
 * / — Landing. Ported from the prototype's `land` screen.
 *
 * The prototype's copy is final and kept verbatim; the artwork is the same
 * bundled reference art the prototype ships, so this screen matches the
 * approved design exactly.
 *
 * This replaces an earlier hand-built home feed (trait explainer + a grid of
 * featured Chogs). That was a guess written before any design existed. The
 * per-Chog pages at /chog/[id] are untouched and still reachable.
 */

const HERO_ART = "/chognice.jpg";

export default function Landing(): ReactNode {
  return (
    <AppShell bare>
      <div className="x-hero">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={HERO_ART} alt="Chog Mischief hero art" />
        <div className="x-hero__t">
          <p className="x-pill">Live on Monad</p>
          <h1>Chog Mischief</h1>
          <p>Prank your frens onchain. Dodge theirs. Rule the leaderboard.</p>
        </div>
      </div>

      <div className="x-g3">
        <div className="x-card x-stat">
          <b>5</b>
          <span className="x-sm">pranks a day</span>
        </div>
        <div className="x-card x-stat">
          <b>2x</b>
          <span className="x-sm">revenge pts</span>
        </div>
        <div className="x-card x-stat">
          <b>00:00</b>
          <span className="x-sm">UTC reset</span>
        </div>
      </div>

      <div className="x-card">
        <h3>How it works</h3>
        <p>
          1. Pick your Chog. &nbsp;2. Choose a target and a prank. &nbsp;3. Sign it.
          It hits, or they dodge.
        </p>
      </div>

      <Link href="/pick" className="x-btn x-btn--m x-w">
        Start the mischief 😈
      </Link>
    </AppShell>
  );
}