'use client';

import { useRef, useState } from 'react';
import { useAccount, useSignMessage, useSwitchChain } from 'wagmi';
import { PrankOverlay } from '@/components/PrankOverlay';
import { AwaitingSignature, CheckingOwnership } from '@/components/LoadingState';
import { SuspenseBar, awaitSuspense, useSuspense } from '@/components/useSuspense';
import { mapCommitFailure, isUserRejection, plainFailureMessage } from '@/lib/prank-refusals';
import { e2eMode, e2eRejected, e2eWrongChain, e2eSignature } from '@/lib/e2e';
import type { RefusalKind } from '@/lib/prank-refusals';

/**
 * Step 3 of the prank flow: sign, commit, suspense, hand back the result.
 *
 * This file holds the ONLY wallet hooks in the flow, and it is loaded by
 * dynamic import after mount (see PrankClient) - the same pattern as
 * ConnectWallet, because AppKit hooks throw when called during static
 * prerender ("Please call createAppKit before using useAppKit hook").
 *
 * The signature is a gasless personal_sign over the message the SERVER
 * built (buildActionMessage). It is deliberately NOT EIP-712 typed data:
 * the commit route recovers it with recoverMessageAddress, and the chain is
 * bound by the "Chain: 143 (Monad)" line inside the message. Changing the
 * signing scheme here would silently break verification server-side.
 *
 * ── The sequence ───────────────────────────────────────────────────────────
 *   1. Wrong chain? The hard wrong-network modal blocks the sign.
 *   2. "Sign to prank (no gas)" -> AwaitingSignature -> signMessageAsync.
 *   3. Signed -> CheckingOwnership (the server re-reads ownerOf) while
 *      POST /api/prank/commit runs, wrapped in awaitSuspense so the
 *      SuspenseBar shows for at least Hark's 1.2s and flips to the nap
 *      state past 10s.
 *   4. A nonce-replay failure is retried ONCE silently: a fresh /prepare
 *      (new nonce, new roll) is signed and committed again. Only a second
 *      replay shows the sheet - a silent retry that always fails is not
 *      silent, it is a loop.
 */

export interface PrankResult {
  landed: boolean;
  points: number;
  revenge: boolean;
  streak: number;
  newBadges: string[];
  prankName: string;
  caption: string;
}

export interface PrankSignStepProps {
  fromTokenId: number;
  toTokenId: number;
  prankId: string;
  /** The message from the step-2 /prepare call. */
  message: string;
  targetName: string;
  prankName: string;
  prankCaption: string;
  onResult: (result: PrankResult) => void;
  onRefusal: (kind: RefusalKind) => void;
  /** A failure with no refusal variant; the parent shows it inline. */
  onError: (message: string) => void;
  onCancel: () => void;
}

const MONAD_CHAIN_ID = 143;

export function PrankSignStep({
  fromTokenId,
  toTokenId,
  prankId,
  message,
  targetName,
  prankName,
  prankCaption,
  onResult,
  onRefusal,
  onError,
  onCancel,
}: PrankSignStepProps) {
  const { chainId } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const { switchChainAsync } = useSwitchChain();
  const suspense = useSuspense();

  const [phase, setPhase] = useState<'idle' | 'signing' | 'checking'>('idle');
  const [wrongNetwork, setWrongNetwork] = useState(false);
  const [switching, setSwitching] = useState(false);
  // Guards the single silent nonce-replay retry.
  const retried = useRef(false);
  // The message may be replaced by the retry's fresh /prepare.
  const activeMessage = useRef(message);
  activeMessage.current = message;

  const wrongChain = e2eMode() ? e2eWrongChain() : chainId !== MONAD_CHAIN_ID;

  async function sign(): Promise<`0x${string}`> {
    if (e2eMode()) {
      // The test seam: no wallet, deterministic signature. The server
      // refuses it unless the test intercepts the commit - which is the
      // point (see src/lib/e2e.ts).
      if (e2eRejected()) throw new Error('User rejected the request');
      return e2eSignature();
    }
    return signMessageAsync({ message: activeMessage.current });
  }

  /** Re-run /prepare to get a fresh nonce + roll, then re-sign. */
  async function freshPrepare(): Promise<string | null> {
    const res = await fetch('/api/prank/prepare', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fromTokenId, toTokenId, prankId }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { message?: string };
    return body.message ?? null;
  }

  async function commit(signature: `0x${string}`): Promise<Response> {
    return fetch('/api/prank/commit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: activeMessage.current, signature }),
    });
  }

  async function attempt(): Promise<void> {
    setPhase('signing');
    let signature: `0x${string}`;
    try {
      signature = await sign();
    } catch (err) {
      // A cancelled signature is a CHOICE, not a fault - and it is the one
      // failure the player can act on, so it gets its own sheet.
      if (isUserRejection(err) || (e2eMode() && e2eRejected())) {
        onRefusal('rejected');
        return;
      }
      onError(err instanceof Error ? err.message : 'the signature failed');
      return;
    }

    // Signed. The server now re-reads ownership and records the prank; the
    // SuspenseBar paces the wait (1.2s floor, nap state past 10s).
    setPhase('checking');
    suspense.start();
    try {
      const res = await awaitSuspense(commit(signature));
      if (res.ok) {
        const body = (await res.json()) as {
          prank?: {
            landed?: boolean;
            points?: number;
            revenge?: boolean;
            streak?: number;
            newBadges?: string[];
            name?: string;
            caption?: string;
          };
        };
        const p = body.prank ?? {};
        onResult({
          landed: p.landed ?? false,
          points: p.points ?? 0,
          revenge: p.revenge ?? false,
          streak: p.streak ?? 0,
          newBadges: p.newBadges ?? [],
          prankName: p.name ?? prankName,
          caption: p.caption ?? prankCaption,
        });
        return;
      }

      const body = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
      const failure = { status: res.status, error: body.error, detail: body.detail };

      const kind = mapCommitFailure(failure);
      if (kind === 'nonce-replay' && !retried.current) {
        // Silent retry once: a fresh nonce, a fresh sign, a fresh commit.
        retried.current = true;
        const fresh = await freshPrepare();
        if (fresh) {
          activeMessage.current = fresh;
          await attempt();
          return;
        }
      }
      if (kind) {
        onRefusal(kind);
        return;
      }
      onError(plainFailureMessage(failure) ?? body.error ?? 'the prank could not be recorded');
    } catch {
      onError('the network dropped the prank. Nothing was charged.');
    }
  }

  function startSign() {
    if (wrongChain) {
      setWrongNetwork(true);
      return;
    }
    void attempt();
  }

  async function switchNetwork() {
    setSwitching(true);
    try {
      if (!e2eMode()) await switchChainAsync({ chainId: MONAD_CHAIN_ID });
      setWrongNetwork(false);
    } catch {
      // The user cancelled the switch, or the wallet refused. The modal
      // stays - signing on the wrong chain would be refused by the server
      // anyway (the message names chain 143).
    } finally {
      setSwitching(false);
    }
  }

  return (
    <div className="x-card" data-testid="prank-sign">
      {/* The stepper heading above already says "Sign it"; this card states
          WHAT is being signed. */}
      <p className="x-sm x-mut">
        <b>{prankName}</b> on <b>{targetName}</b>. No gas - this only signs a message.
      </p>
      <p className="x-sm x-mut">{prankCaption}</p>

      {phase === 'signing' ? <AwaitingSignature onCancel={onCancel} /> : null}

      {phase === 'checking' ? (
        <>
          <CheckingOwnership tokenId={fromTokenId} />
          <SuspenseBar
            state={suspense}
            reducedMotion={suspense.reducedMotion}
            onRetry={() => void attempt()}
            onKeepWaiting={() => undefined}
          >
            Landing the prank…
          </SuspenseBar>
        </>
      ) : null}

      {phase === 'idle' ? (
        <div className="x-col" style={{ gap: 8 }}>
          <button type="button" className="x-btn x-w" onClick={startSign}>
            Sign to prank (no gas)
          </button>
          <button type="button" className="x-btn x-btn--k x-w" onClick={onCancel}>
            ← Change target
          </button>
        </div>
      ) : null}

      <PrankOverlay
        open={wrongNetwork}
        labelledBy="wrong-network-headline"
        headline={
          <div style={{ display: 'grid', gap: 8 }}>
            <div className="x-boom" style={{ fontSize: 48 }}>
              🌐
            </div>
            <h2 id="wrong-network-headline" style={{ fontSize: 24 }}>
              Wrong network
            </h2>
          </div>
        }
        actions={[
          {
            label: switching ? 'Switching…' : 'Switch to Monad',
            onClick: () => void switchNetwork(),
            variant: 'y',
          },
        ]}
        onClose={() => setWrongNetwork(false)}
      >
        <p className="x-sm x-mut">
          Your wallet is on another network. Switch to Monad to sign - it costs no gas.
        </p>
      </PrankOverlay>
    </div>
  );
}

export default PrankSignStep;
