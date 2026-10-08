"use client";

import { useState } from "react";
import { useAccount, useConnect, useSignMessage } from "wagmi";
import { useAppKit } from "@reown/appkit/react";
import type { ConnectWalletProps } from "./ConnectWallet";

/**
 * The browser half of ConnectWallet. Split out so the wallet hooks are never
 * called during static prerender — see the long note in ConnectWallet.tsx for
 * why a mounted flag was not enough.
 *
 * The flow is the app's own rather than AppKit's modal, because what matters
 * here is the SESSION and the design wants an inline button:
 *
 *   1. POST /api/auth/nonce   — a SIWE message naming our domain and chain
 *   2. wallet signs it        — free, no gas, no transaction, no approval
 *   3. POST /api/auth/verify  — we recover the signer, re-read ownership from
 *                               Monad, and only then open a session
 *
 * Every failure below gets a DISTINCT message. "Sign in failed" cannot be told
 * apart from "you hold no Chog", and the player can act on only one of them.
 */

type Phase = "idle" | "nonce" | "signing" | "verifying" | "done" | "error";

export function ConnectWalletBody({
  onSignedIn,
  className = "x-btn x-btn--p x-w",
  label = "🔗 Connect wallet",
  children,
}: ConnectWalletProps) {
  const { open } = useAppKit();
  const { isConnected, address } = useAccount();
  const { connectors } = useConnect();
  const { signMessageAsync } = useSignMessage();

  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);

  async function signIn() {
    setError(null);

    // Not connected yet: hand off to AppKit's modal for the connection itself.
    // Connecting and signing are separate operations, so one does not imply the
    // other — do not try to sign before a wallet is actually connected.
    if (!isConnected || !address) {
      open();
      return;
    }

    try {
      setPhase("nonce");
      const nonceRes = await fetch("/api/auth/nonce", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address }),
      });
      const nonceBody = (await nonceRes.json()) as { message?: string; error?: string };
      if (!nonceRes.ok || !nonceBody.message) {
        throw new Error(nonceBody.error ?? "could not start sign-in");
      }

      setPhase("signing");
      const signature = await signMessageAsync({ message: nonceBody.message });

      setPhase("verifying");
      const verifyRes = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: nonceBody.message, signature }),
      });
      const verifyBody = (await verifyRes.json()) as { error?: string; message?: string };

      if (!verifyRes.ok) {
        // Different problems with different fixes, so different words.
        // "no_chogs" is the one the player can act on; the rest are server-side.
        if (verifyBody.error === "no_chogs") {
          throw new Error(
            verifyBody.message ?? "That wallet does not hold a Chog Genesis NFT.",
          );
        }
        throw new Error(verifyBody.error ?? "sign-in was refused");
      }

      setPhase("done");
      onSignedIn?.();
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);

      // Rejecting the signature prompt is a CHOICE, not a fault. It must not read
      // like something broke, and nothing was signed or spent.
      if (/user rejected|user denied|rejected the request|request rejected/i.test(raw)) {
        setError("You cancelled the signature. Nothing was signed and nothing was spent.");
        setPhase("idle");
        return;
      }

      setPhase("error");
      setError(raw);
    }
  }

  const busy = phase === "nonce" || phase === "signing" || phase === "verifying";
  const busyLabel =
    phase === "nonce"
      ? "Getting a nonce…"
      : phase === "signing"
        ? "✍️ Check your wallet…"
        : "Confirming on Monad…";

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <button
        type="button"
        className={className}
        onClick={signIn}
        disabled={busy || phase === "done"}
      >
        {busy ? <span className="x-spin">⏳</span> : null}
        {phase === "done" ? "✓ Signed in" : busy ? busyLabel : (children ?? label)}
      </button>

      {/* A button that silently does nothing is worse than saying so. */}
      {connectors.length === 0 && !isConnected ? (
        <p className="x-sm x-mut">
          No wallet connector available in this browser. Try a wallet extension or a
          mobile wallet browser.
        </p>
      ) : null}

      {error ? (
        <p className="x-sm" style={{ color: "var(--x-m)" }} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export default ConnectWalletBody;