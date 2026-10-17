import type { ReactNode } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { ConnectWallet } from "@/components/ConnectWallet";

/**
 * /pick - ported from the prototype's `pick` screen.
 *
 * DESIGN GAP, per UI_RULES.md rule 9: the prototype's pick screen shows
 * six fixed mock Chogs, because it has no wallet. In the real app the list is
 * "the Chogs this wallet actually holds", which is empty until someone connects
 * - and that state has no design. It is built here from existing x- components
 * in the same style and listed in AGENTS.md under "UI states to review" so it can
 * go back to the reviewer.
 *
 * Until a wallet is connected this screen cannot be personalised at all, so it
 * says so and offers the one action that resolves it. It does NOT invent a
 * Chog to show: a demo that silently displays a mock NFT would be claiming a
 * balance that does not exist.
 *
 * It does offer the guest path, the same "Play as a guest instead" exit that
 * /hq and /inbox give a signed-out visitor. /profile redirects here when there
 * is no session, so without it a visitor who arrived from a profile link hit a
 * dead end: the only way to play without a Chog was hidden. Caught by the
 * TestSprite suite (HQP-005).
 */

export default function PickScreen(): ReactNode {
  return (
    <AppShell bare>
      {/* Centred, max 520px at 768px+. On phone the wrapper is a plain block,
          so the card fills the column exactly as before. */}
      <div className="x-center">
        <div>
          <h2>Pick your Chog</h2>
          <p className="x-mut">Your prankster for the season. You can switch later.</p>
        </div>

        <div className="x-card" style={{ textAlign: "center" }}>
          <span style={{ fontSize: 48 }} aria-hidden="true">
            🔐
          </span>
          <h3>Connect your wallet</h3>
          <p className="x-mut">
            Only Chog holders can play. Connect the wallet that holds your Chog.
            No transaction, no gas, you just sign a message.
          </p>
          <ConnectWallet />
          <Link href="/guest" className="x-btn x-btn--k x-w">
            Play as a guest instead
          </Link>
        </div>
      </div>
    </AppShell>
  );
}