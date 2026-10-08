"use client";

import { useEffect, useState } from "react";
import type { ComponentType, ReactNode } from "react";
import { walletConfigured } from "./AppKitProvider";

/**
 * Gasless wallet connect: sign a message, prove you hold a Chog.
 *
 * This file is the SHELL only. Everything that touches a wallet lives in
 * ConnectWalletBody.tsx and is loaded dynamically, after mount.
 *
 * WHY THE SPLIT — this cost a failed production build:
 *   AppKit is browser-only. createAppKit() in AppKitProvider is guarded on
 *   `typeof window`, so on the server there is no AppKit instance. A client
 *   component is still RENDERED on the server during static prerender, so a
 *   hook like useAppKit() runs exactly where createAppKit never ran and throws
 *   "Please call createAppKit before using useAppKit hook". That failed the build
 *   on all 1,969 prebuilt Chog pages.
 *
 *   A mounted flag alone does NOT fix it. The guard must stop the hooks from
 *   being CALLED, not merely stop their results being read, and React hooks
 *   cannot be called conditionally. Keeping the wallet hooks in a separate
 *   module means they are never called during prerender at all.
 */

export interface ConnectWalletProps {
  onSignedIn?: () => void;
  className?: string;
  label?: string;
  children?: ReactNode;
}

export function ConnectWallet(props: ConnectWalletProps) {
  const [Body, setBody] = useState<ComponentType<ConnectWalletProps> | null>(null);

  useEffect(() => {
    // Without a Reown project id there is no WagmiProvider above this tree, so
    // the body's useAccount/useSignMessage hooks would throw a
    // WagmiProviderNotFoundError. Stay on the inert button instead.
    if (!walletConfigured) return;
    let live = true;
    void import("./ConnectWalletBody").then((mod) => {
      if (live) setBody(() => mod.ConnectWalletBody);
    });
    return () => {
      live = false;
    };
  }, []);

  if (!Body) {
    // Server render and first client paint: same shape as the real button so the
    // layout does not jump, but inert — nothing can work before AppKit exists.
    const { className = "x-btn x-btn--p x-w", label = "🔗 Connect wallet", children } = props;
    return (
      <div style={{ display: "grid", gap: 8 }}>
        <button type="button" className={className} disabled>
          {children ?? label}
        </button>
        {walletConfigured ? null : (
          <p className="x-sm x-mut">
            Wallet connection is unavailable: no Reown project id is configured on
            this deployment.
          </p>
        )}
      </div>
    );
  }

  return <Body {...props} />;
}

export default ConnectWallet;