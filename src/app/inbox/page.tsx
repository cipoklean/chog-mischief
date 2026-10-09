'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { ComponentType } from 'react';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/AppShell';
import { ConnectWallet } from '@/components/ConnectWallet';
import { LoadingState } from '@/components/LoadingState';

/**
 * /inbox - what happened to your Chog while you were away.
 *
 * Two queues, both real data from GET /api/hq:
 *
 * 1. REVENGE - pranks that landed on your Chog inside the revenge window.
 *    Each one links straight into the prank flow with the attacker
 *    preselected, and the SERVER decides the 2x (revenge is a rule, not a
 *    client flag). The link carries ?target=<attacker> so the weapon step
 *    opens with that Chog chosen.
 * 2. CLEAN - the overlays still sitting on your Chog's art. Cleaning one is
 *    the other gasless signature in the game: prepare builds the typed data,
 *    the wallet signs it, commit removes the overlay. One clean per day.
 *
 * The signing step lives in a dynamically imported child for the same reason
 * as PrankSignStep: AppKit hooks throw when called during prerender.
 */

interface OverlayRow {
  prankId: string;
  caption: string;
}

interface IncomingRow {
  id: string;
  fromTokenId: number;
  fromName: string;
  toTokenId: number;
  toName: string;
  prankId: string;
  landed: boolean;
  points: number;
  revenge: boolean;
  createdAt: string;
}

interface InboxData {
  authenticated: boolean;
  address: string;
  chogs: { tokenId: number; name: string; imageUrl: string | null }[];
  stats: {
    tokenId: number;
    points: number;
    prankedToday: boolean;
    streak: { currentStreak: number; longestStreak: number };
    badges: string[];
    overlays: OverlayRow[];
  }[];
  recentIncoming: IncomingRow[];
}

interface CleanSignProps {
  tokenId: number;
  prankId: string;
  caption: string;
  onDone: () => void;
  onError: (message: string) => void;
  onCancel: () => void;
}

function agoLabel(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function InboxClient(): ReactNode {
  const [data, setData] = useState<InboxData | null>(null);
  // The clean signer is imported after mount: its AppKit hooks must not be
  // CALLED during static prerender (the same trap as PrankSignStep).
  const [CleanSignStep, setCleanSignStep] = useState<ComponentType<CleanSignProps> | null>(null);
  const [checked, setChecked] = useState(false);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [cleaning, setCleaning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void import('./CleanSignStep').then((mod) => {
      if (live) setCleanSignStep(() => mod.CleanSignStep);
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    let live = true;
    void fetch('/api/hq')
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (!live) return;
        if (body?.authenticated) {
          setData(body as InboxData);
          setActiveId((body.chogs?.[0]?.tokenId as number) ?? null);
        }
        setChecked(true);
      })
      .catch(() => {
        if (live) setChecked(true);
      });
    return () => {
      live = false;
    };
  }, []);

  const active = useMemo(
    () => data?.chogs.find((c) => c.tokenId === activeId) ?? data?.chogs[0] ?? null,
    [data, activeId],
  );
  const stats = useMemo(
    () => data?.stats.find((s) => s.tokenId === active?.tokenId) ?? null,
    [data, active],
  );

  if (!checked) {
    return (
      <AppShell bare>
        <LoadingState>Loading your inbox</LoadingState>
      </AppShell>
    );
  }

  if (!data || !active || !stats) {
    return (
      <AppShell bare>
        <div className="x-card" style={{ textAlign: 'center' }}>
          <span style={{ fontSize: 48 }} aria-hidden="true">
            📬
          </span>
          <h3>The inbox needs a Chog</h3>
          <p className="x-mut">
            Revenge and cleanup are keyed to your Chog, not your wallet. Connect the wallet
            that holds one.
          </p>
          <ConnectWallet />
          <Link href="/guest" className="x-btn x-btn--k x-w">
            Play as a guest instead
          </Link>
        </div>
      </AppShell>
    );
  }

  // Revenge: a landed hit on this Chog. The server decides the multiplier.
  const revengeRows = (data.recentIncoming ?? []).filter((r) => r.landed && r.toTokenId === active.tokenId);

  return (
    <AppShell points={stats.points} ammo={stats.prankedToday ? 0 : 1} avatarUrl={active.imageUrl} current="inbox">
      {/* ---- clean queue ---- */}
      <div className="x-card">
        <h3>On {active.name} right now</h3>
        {stats.overlays.length === 0 ? (
          <p className="x-sm x-mut">Clean. Nothing is sitting on your art.</p>
        ) : (
          <div className="x-col" style={{ gap: 8 }}>
            {stats.overlays.map((o) => (
              <div key={o.prankId} className="x-row x-sp">
                <span className="x-rail__chog-name">{o.caption || 'an overlay'}</span>
                <button
                  type="button"
                  className="x-btn x-btn--k"
                  onClick={() => {
                    setError(null);
                    setCleaning(o.prankId);
                  }}
                >
                  Clean
                </button>
              </div>
            ))}
          </div>
        )}
        <p className="x-sm x-mut">One clean per day. Signing only, no gas.</p>
      </div>

      {/* ---- revenge queue ---- */}
      <div className="x-card">
        <h3>Revenge</h3>
        {revengeRows.length === 0 ? (
          <p className="x-sm x-mut">
            Nobody has landed a prank on {active.name} recently. Prank someone and they might
            prank you back.
          </p>
        ) : (
          <div className="x-col" style={{ gap: 8 }}>
            {revengeRows.map((r) => (
              <div key={r.id} className="x-row x-sp">
                <div style={{ minWidth: 0 }}>
                  <div className="x-rail__chog-name">
                    {r.fromName} hit you with {r.prankId.replace(/-/g, ' ')}
                  </div>
                  <div className="x-sm x-mut">
                    {agoLabel(r.createdAt)} - revenge is worth 2x
                  </div>
                </div>
                {/* The attacker is preselected: /prank?target= skips straight to
                    the weapon step. The 2x is the server's decision. */}
                <Link href={`/prank?target=${r.fromTokenId}`} className="x-btn x-btn--m">
                  Get revenge
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>

      {error ? (
        <div className="x-card" role="alert">
          <p className="x-sm" style={{ color: 'var(--x-m)' }}>
            {error}
          </p>
          <button type="button" className="x-btn x-btn--k" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      ) : null}

      {cleaning && active && CleanSignStep ? (
        <CleanSignStep
          tokenId={active.tokenId}
          prankId={cleaning}
          caption={stats.overlays.find((o) => o.prankId === cleaning)?.caption ?? ''}
          onDone={() => {
            setCleaning(null);
            // Re-read the inbox so the overlay leaves the queue.
            void fetch('/api/hq')
              .then((r) => (r.ok ? r.json() : null))
              .then((body) => {
                if (body?.authenticated) setData(body as InboxData);
              })
              .catch(() => undefined);
          }}
          onError={(msg: string) => {
            setCleaning(null);
            setError(msg);
          }}
          onCancel={() => setCleaning(null)}
        />
      ) : null}
    </AppShell>
  );
}
