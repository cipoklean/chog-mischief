'use client';

import { useState } from 'react';
import type { TypedDataDefinition } from 'viem';
import { useAccount, useSignTypedData, useSwitchChain } from 'wagmi';
import { AwaitingSignature, CheckingOwnership } from '@/components/LoadingState';
import { SuspenseBar, awaitSuspense, useSuspense } from '@/components/useSuspense';
import { e2eMode, e2eRejected, e2eWrongChain, e2eSignature } from '@/lib/e2e';
import { isUserRejection } from '@/lib/prank-refusals';
import { PrankOverlay } from '@/components/PrankOverlay';

/**
 * The clean signature step.
 *
 * Same shape as the prank sign step, and deliberately separate: the two
 * actions post to different endpoints and carry different payloads, and a
 * component that took "which action" as a flag would be a branch factory.
 *
 * It lives in its own file for the AppKit prerender trap: the hooks must not
 * be CALLED during static prerender, so this module is imported dynamically
 * by the Inbox after mount.
 */

const MONAD_CHAIN_ID = 143;

interface Props {
  tokenId: number;
  prankId: string;
  caption: string;
  onDone: () => void;
  onError: (message: string) => void;
  onCancel: () => void;
}

export function CleanSignStep({ tokenId, prankId, caption, onDone, onError, onCancel }: Props) {
  const { chainId } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const { switchChainAsync } = useSwitchChain();
  const suspense = useSuspense();

  const [phase, setPhase] = useState<'idle' | 'signing' | 'checking'>('idle');
  const [wrongNetwork, setWrongNetwork] = useState(false);
  const [switching, setSwitching] = useState(false);

  const wrongChain = e2eMode() ? e2eWrongChain() : chainId !== MONAD_CHAIN_ID;

  async function attempt(): Promise<void> {
    // The wrong network blocks the sign here, exactly as it does for a prank:
    // the typed data names chain 143, so signing elsewhere would be refused
    // by the server anyway.
    if (wrongChain) {
      setWrongNetwork(true);
      return;
    }

    setPhase('signing');
    let typedData: TypedDataDefinition | null = null;
    let signature: `0x${string}`;

    // 1. Ask the server for the typed data to sign. It decides what a clean
    //    is; the client only forwards it.
    try {
      const res = await fetch('/api/clean/prepare', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tokenId, prankId }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        typedData?: TypedDataDefinition;
        error?: string;
      };
      if (!res.ok || !body.typedData) {
        onError(body.error ?? 'could not prepare that clean');
        return;
      }
      typedData = body.typedData;
    } catch {
      onError('the network dropped the request. Nothing was signed.');
      return;
    }

    // 2. Sign it (or the e2e seam, in tests).
    try {
      if (e2eMode()) {
        if (e2eRejected()) throw new Error('User rejected the request');
        signature = e2eSignature();
      } else {
        signature = await signTypedDataAsync({
          domain: typedData.domain,
          types: typedData.types,
          primaryType: typedData.primaryType,
          message: typedData.message,
        });
      }
    } catch (err) {
      if (isUserRejection(err) || (e2eMode() && e2eRejected())) {
        onError('the signature was cancelled. Nothing was cleaned.');
        return;
      }
      onError(err instanceof Error ? err.message : 'the signature failed');
      return;
    }

    // 3. Commit, with the suspense floor.
    setPhase('checking');
    suspense.start();
    try {
      const res = await awaitSuspense(
        fetch('/api/clean/commit', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ typedData, signature }),
        }),
      );
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) {
        onError(body.error ?? 'the clean could not be recorded');
        return;
      }
      onDone();
    } catch {
      onError('the network dropped the commit. Nothing was cleaned.');
    }
  }

  return (
    <div className="x-card" data-testid="clean-sign">
      <p className="x-sm x-mut">
        Clean <b>{caption || 'this overlay'}</b> off #{tokenId}. One clean per day, signing only,
        no gas.
      </p>

      {phase === 'signing' ? <AwaitingSignature onCancel={onCancel} /> : null}
      {phase === 'checking' ? (
        <>
          <CheckingOwnership tokenId={tokenId} />
          <SuspenseBar state={suspense} reducedMotion={suspense.reducedMotion}>
            Cleaning…
          </SuspenseBar>
        </>
      ) : null}

      {phase === 'idle' ? (
        <div className="x-col" style={{ gap: 8 }}>
          <button type="button" className="x-btn x-w" onClick={() => void attempt()}>
            Sign to clean (no gas)
          </button>
          <button type="button" className="x-btn x-btn--k x-w" onClick={onCancel}>
            ← Back
          </button>
        </div>
      ) : null}

      <PrankOverlay
        open={wrongNetwork}
        labelledBy="clean-wrong-network"
        headline={
          <div style={{ display: 'grid', gap: 8 }}>
            <div className="x-boom" style={{ fontSize: 48 }}>
              🌐
            </div>
            <h2 id="clean-wrong-network" style={{ fontSize: 24 }}>
              Wrong network
            </h2>
          </div>
        }
        actions={[
          {
            label: switching ? 'Switching…' : 'Switch to Monad',
            onClick: () => {
              void (async () => {
                setSwitching(true);
                try {
                  if (!e2eMode()) await switchChainAsync({ chainId: MONAD_CHAIN_ID });
                  setWrongNetwork(false);
                } catch {
                  // The user cancelled the switch; the modal stays, because
                  // signing on the wrong chain is refused by the server.
                } finally {
                  setSwitching(false);
                }
              })();
            },
            variant: 'y',
          },
        ]}
        onClose={() => setWrongNetwork(false)}
      >
        <p className="x-sm x-mut">
          Switch to Monad to sign - it costs no gas.
        </p>
      </PrankOverlay>
    </div>
  );
}

export default CleanSignStep;
