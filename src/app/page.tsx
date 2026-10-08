import Link from "next/link";
import type { ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import { ConnectWallet } from "@/components/ConnectWallet";
import { ChaosFeed } from "@/components/ChaosFeed";

/**
 * / — Landing, first run with no wallet. STATES.md §1, verbatim.
 *
 * Hark's decision: A NO-WALLET VISITOR IS A FULL PLAYER. So the primary action
 * is "Play now — no wallet", NOT connect. Connect is secondary and is for people
 * who want their record permanent. Getting this backwards puts a wallet wall in
 * front of the single most important thing in the demo: a judge with no wallet
 * must reach the game in one tap.
 *
 * Copy is Hark's, including the h1 "Prank the Chogverse." — which replaces the
 * prototype's "Chog Mischief" hero title for this state.
 */

const HERO_ART = "/chognice.jpg";

export default function Landing(): ReactNode {
  return (
    <AppShell bare>
      <div className="x-hero">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={HERO_ART} alt="Chog Mischief hero art" />
        <div className="x-hero__t">
          <h1>Prank the Chogverse.</h1>
        </div>
      </div>

      {/* STATES.md §1: the 3 latest feed items, so the page shows the game is
          alive before any interaction. Prototype copy stands in until the real
          feed endpoint exists — noted in AGENTS.md as not-yet-live. */}
      <div className="x-card">
        <h3>Latest chaos</h3>
        <ChaosFeed
          max={3}
          items={[
            {
              html: "<b>@slimelord</b> 🟢 slimed <b>@gmonad</b>",
              text: "@slimelord 🟢 slimed @gmonad",
            },
            {
              html: "<b>@nadsworth</b> dodged a 🍌 from <b>@bananabandit</b>",
              text: "@nadsworth dodged a 🍌 from @bananabandit",
            },
            {
              html: "<b>@chogfather</b> ✨ glitter-nuked <b>@purplehaze</b>",
              text: "@chogfather ✨ glitter-nuked @purplehaze",
            },
          ]}
        />
      </div>

      <Link href="/guest" className="x-btn x-w">
        Play now — no wallet
      </Link>
      <ConnectWallet label="Connect wallet" className="x-btn x-btn--p x-w" />

      <p className="x-sm x-mut" style={{ textAlign: "center" }}>
        Got a Chog? Connect to make your pranks permanent.
      </p>
    </AppShell>
  );
}