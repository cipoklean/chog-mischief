import Link from "next/link";
import type { ReactNode } from "react";
import { AppShell } from "@/components/AppShell";

/**
 * A Chog page is shareable, so bad links are expected - a judge will follow one
 * from a truncated chat message. The default Next 404 renders inside the root
 * layout with no content and no way back into the game.
 *
 * Copy is unchanged from the version written before the design kit landed; only
 * the markup is ported, because the words already fit the voice.
 */
export default function NotFound(): ReactNode {
  return (
    <AppShell bare>
      <div style={{ display: "grid", placeItems: "center", gap: 16, paddingTop: 40 }}>
        <span style={{ fontSize: 64 }} aria-hidden="true">
          🕳️
        </span>
        <p className="x-pill">404</p>
        <h2 style={{ textAlign: "center" }}>No Chog lives at this address.</h2>
        <p className="x-mut" style={{ textAlign: "center" }}>
          Chog Genesis has exactly 1,969 Chogs, numbered 1 to 1,969. If you followed
          a link, the number in it is probably mistyped.
        </p>
        <Link href="/" className="x-btn x-w">
          Browse all Chogs
        </Link>
        <Link href="/chog/1" className="x-btn x-btn--k x-w">
          Meet Chog #1
        </Link>
      </div>
    </AppShell>
  );
}