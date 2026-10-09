"use client";

import { useState } from "react";
import { useAccount, useConnect, useSignMessage } from "wagmi";
import { useAppKit } from "@reown/appkit/react";
import type { ConnectWalletProps } from "./ConnectWallet";
import { e2eAddress, e2eConnected, e2eSignature } from "@/lib/e2e";

/**
 * The browser half of ConnectWallet. Split out so the wallet hooks are never
 * called during static prerender - see the long note in ConnectWallet.tsx for
 * why a mounted flag was not enough.
 *
 * The flow is the app's own rather than AppKit's modal, because what matters
 * here is the SESSION and the design wants an inline button:
 *
 *   1. POST /api/auth/nonce   - a SIWE message naming our domain and chain
 *   2. wallet signs it        - free, no gas, no transaction, no approval
 *   3. POST /api/auth/verify  - we recover the signer, re-read ownership from
 *                               Monad, and only then open a session
 *
 * Every failure below gets a DISTINCT message. "Sign in failed" cannot be told
 * apart from "you hold no Chog", and the player can act on only one of them.
 */

type Phase = "idle" | "nonce" | "signing" | "verifying" | "done" | "no-chogs" | "error";

/**
 * WHY "no-chogs" IS ITS OWN PHASE AND NOT AN ERROR
 *
 * A wallet that connects, signs, and is then told it holds no Chog has not
 * encountered a fault. It has arrived at the most common possible state for
 * anyone who is not already a holder - and the previous behaviour, showing a red
 * error string with no way forward, was a dead end. It read as "you did
 * something wrong" and offered nothing to do about it.
 *
 * This phase exists so the screen can instead say what is true (the game needs a
 * Chog Genesis NFT, and this wallet has none), point at where to look, and offer
 * the guest path, which is the actual way to play without one.
 *
 * No wallet address is shown: nothing here needs it, and a shareable screenshot
 * of an error should not carry one.
 */

export function ConnectWalletBody({
  onSignedIn,
  className = "x-btn x-btn--p x-w",
  label = "🔗 Connect wallet",
  children,
}: ConnectWalletProps) {
  const { open } = useAppKit();
  const wagmiAccount = useAccount();
  // A test can stand in for a connected wallet (see lib/e2e.ts). A real browser
  // always falls through to wagmi's own state.
  const isConnected = e2eConnected() || wagmiAccount.isConnected;
  const address = e2eAddress() ?? wagmiAccount.address;
  const { connectors } = useConnect();
  const { signMessageAsync } = useSignMessage();

  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [noChogsMessage, setNoChogsMessage] = useState<string | null>(null);

  async function signIn() {
    setError(null);
    setNoChogsMessage(null);

    // Not connected yet: hand off to AppKit's modal for the connection itself.
    // Connecting and signing are separate operations, so one does not imply the
    // other - do not try to sign before a wallet is actually connected.
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
      // A stand-in signature for the test path. It is not a valid signature of
      // anything and the server refuses it - which is why the no-Chog test can
      // drive this far at all: the refusal it exercises happens AFTER signing.
      const signature = e2eConnected()
        ? e2eSignature()
        : await signMessageAsync({ message: nonceBody.message });

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
          setNoChogsMessage(
            verifyBody.message ?? "This wallet does not hold a Chog Genesis NFT.",
          );
          setPhase("no-chogs");
          return;
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

      {/*
        THE NO-CHOG STATE

        Not an error banner. This is the most common state for anyone who is not
        already a holder, and it has to read that way: nothing is broken, nothing
        was charged, and there is a real way to play without a Chog.

        Three things it offers, in order of how likely they are to help:
        the guest path (works immediately, no wallet, no NFT), the place to look
        for a Chog, and a retry in case the wallet has one on another network.
      */}
      {phase === "no-chogs" ? (
        <div className="x-card" data-testid="no-chogs" role="status">
          <strong style={{ fontFamily: "var(--x-d)", fontSize: 18 }}>
            You need a Chog to play
          </strong>
          <p className="x-sm x-mut" style={{ marginTop: 6 }}>
            {noChogsMessage ?? "This wallet does not hold a Chog Genesis NFT."} Nothing
            was charged and no transaction was sent.
          </p>

          <div className="x-row x-wrap" style={{ marginTop: 10 }}>
            <a href="/guest" className="x-btn x-btn--m">
              Play as a guest
            </a>
            <a
              href="https://monadvision.com/token/0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763"
              className="x-btn x-btn--k"
              target="_blank"
              rel="noreferrer"
            >
              Find a Chog
            </a>
            <button
              type="button"
              className="x-btn x-btn--k"
              onClick={() => {
                setPhase("idle");
                setNoChogsMessage(null);
              }}
            >
              Try again
            </button>
          </div>

          <p className="x-sm x-mut" style={{ marginTop: 10 }}>
            Holding one on another network or in another wallet? Connect that one
            and sign in again. Chog Genesis is on Monad mainnet.
          </p>
        </div>
      ) : null}
    </div>
  );
}

export default ConnectWalletBody;