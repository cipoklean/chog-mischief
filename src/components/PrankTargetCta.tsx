'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ConnectWallet } from '@/components/ConnectWallet';

/**
 * The "Prank this Chog" call-to-action on a Chog detail page.
 *
 * Signed in -> a link into the prank flow with the target preselected
 * (/prank?target=<id>), which skips straight to the weapon step. Signed out
 * -> the connect button, unchanged.
 *
 * WHY A CLIENT COMPONENT: a Chog page is statically prerendered for all
 * 1,969 tokens, so it cannot read the session cookie during render without
 * becoming per-request. The session is fetched after mount instead - one
 * tiny GET, and the phone/static behaviour is unchanged.
 *
 * The ownership check itself still happens server-side: /api/prank/prepare
 * verifies the wallet holds a Chog, and /api/prank/commit re-reads ownership
 * on chain before anything is written. This component only decides which
 * button to show.
 */
export function PrankTargetCta({ tokenId, chogName }: { tokenId: number; chogName: string }) {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    let live = true;
    void fetch('/api/auth/session')
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (live) setSignedIn(body?.authenticated === true);
      })
      .catch(() => {
        if (live) setSignedIn(false);
      });
    return () => {
      live = false;
    };
  }, []);

  // Before the check resolves, show the connect button - the safe default,
  // and the one a signed-out visitor always saw anyway.
  if (signedIn) {
    return (
      <Link href={`/prank?target=${tokenId}`} className="x-btn x-w">
        😈 Prank {chogName}
      </Link>
    );
  }

  return <ConnectWallet label={`😈 Prank ${chogName}`} />;
}

export default PrankTargetCta;
