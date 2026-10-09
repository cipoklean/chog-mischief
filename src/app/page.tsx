import Link from "next/link";
import type { ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import { ConnectWallet } from "@/components/ConnectWallet";
import { ChaosStrip } from "@/components/ChaosStrip";

/**
 * / - Landing, first run with no wallet. STATES.md §1, verbatim.
 *
 * the product decision: A NO-WALLET VISITOR IS A FULL PLAYER. So the primary action
 * is "Play now - no wallet", NOT connect. Connect is secondary and is for people
 * who want their record permanent. Getting this backwards puts a wallet wall in
 * front of the single most important thing in the demo: a judge with no wallet
 * must reach the game in one tap.
 *
 * Copy is the reviewer's, including the h1 "Prank the Chogverse." - which replaces the
 * prototype's "Chog Mischief" hero title for this state.
 *
 * ── Phone vs desktop ───────────────────────────────────────────────────────
 * PHONE (below 768px): hero art with the h1 overlaid, the live feed, then the
 * two CTAs - the exact order and layout as before. The 3-step explainer is in
 * the DOM but display:none, so the phone view is unchanged.
 *
 * DESKTOP (768px+, the reviewer's call): a two-column hero - headline and CTAs on the
 * left, the art large, rotated and sticker-shadowed on the right - with the
 * 3-step explainer as three cards in a row underneath. No rails; the landing
 * uses the full 1320px shell. The DOM order is deliberately unchanged (hero,
 * feed, CTAs, fine print, explainer) and the CSS grid reorders it at 768+ -
 * that is what keeps one static markup serving both.
 */

const HERO_ART = "/chognice.jpg";

/** The prototype's own three steps, verbatim, as three cards. */
const STEPS = [
  { n: "1", title: "Pick your Chog", body: "Every Chog Genesis NFT is a player. Its traits are its powers." },
  // "Hit or dodge: the odds are set by your traits." The old line said the
  // outcome "is decided by traits, not luck", which overstated it: the roll is
  // random, and traits set the THRESHOLD it has to clear. Saying "not luck"
  // invited a player who lost to argue the game cheated.
  { n: "2", title: "Choose a target and a prank", body: "Hit or dodge: the odds are set by your traits." },
  { n: "3", title: "Sign it", body: "No gas, ever. Just a signature, then watch it land." },
];

export default function Landing(): ReactNode {
  return (
    <AppShell bare>
      <div className="x-land">
        <div className="x-hero">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={HERO_ART} alt="Chog Mischief hero art" />
          <div className="x-hero__t">
            <h1>Prank the Chogverse.</h1>
            {/* Hidden on phone (the overlay shows only the h1, as before) and
                revealed under the headline at 768px+. */}
            <p className="x-hero__sub x-mut" style={{ maxWidth: 420 }}>
              {/* "signed, verifiable, no gas" replaces "onchain", and "Rule"
                  replaces the old trailing clause. "onchain" implied a
                  transaction, which this game never does: every action is a
                  gasless signature and not one MON is ever spent. */}
              Prank your frens&apos; Chogs. Dodge theirs. Rule the leaderboard.
            </p>
          </div>
        </div>

        {/* STATES.md §1: the 3 latest feed items, so the page shows the game is
            alive before any interaction.

            the layout call: real rows from the public feed, padded with labelled
            bot rows when fewer than 3 exist so the strip is never empty or
            fake. */}
        <div className="x-card x-land__feed">
          <h3>Latest chaos</h3>
          <ChaosStrip max={3} />
        </div>

        <div className="x-land__cta">
          <Link href="/guest" className="x-btn x-w">
            Play now - no wallet
          </Link>
          <ConnectWallet label="Connect wallet" className="x-btn x-btn--p x-w" />
        </div>

        <p className="x-sm x-mut x-land__fine" style={{ textAlign: "center" }}>
          Connect a Chog to make it count.{" "}
          {/* The leaderboard is the one screen a signed-OUT visitor has no
              route to, because it reads a session for the "my Chogs"
              highlighting. Linking it here means the whole game's outcome is
              reachable from the first page, and a guest can see what they are
              playing towards before connecting anything. */}
          <Link href="/ranks" style={{ textDecoration: "underline" }}>
            See the leaderboard
          </Link>
        </p>

        {/* The 3-step explainer - desktop only (display:none below 768px). */}
        <div className="x-steps3" aria-label="How it works">
          {STEPS.map((s) => (
            <div key={s.n} className="x-card">
              <span
                className="x-pill"
                style={{ background: "var(--x-y)", justifySelf: "start" }}
              >
                Step {s.n}
              </span>
              <strong style={{ fontFamily: "var(--x-d)", fontSize: 18 }}>{s.title}</strong>
              <p className="x-sm x-mut">{s.body}</p>
            </div>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
