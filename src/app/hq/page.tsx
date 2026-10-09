'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/AppShell';
import { ConnectWallet } from '@/components/ConnectWallet';
import { Countdown, nextUtcReset } from '@/components/Countdown';
import { ChaosStrip } from '@/components/ChaosStrip';
import { LoadingState } from '@/components/LoadingState';

/**
 * /hq - the signed-in player's home base.
 *
 * The screen a returning player lands on and the entry point for the prank
 * flow: the active Chog, its points, streak and whether today's prank is
 * still available, the recent history in both directions, and the big
 * "Prank someone" action.
 *
 * ── Real data, one round trip ─────────────────────────────────────────────
 * Everything comes from GET /api/hq (session-scoped server-side), which is
 * why this page is a thin renderer and why the whole screen is testable
 * with a mocked session - the same pattern as /prank. No component here
 * reads a cookie or touches Supabase.
 *
 * ── Phone first ───────────────────────────────────────────────────────────
 * The phone layout is the default; the tablet/desktop treatment is the
 * existing AppShell grid with the rails carrying real data (your Chogs, the
 * daily reset countdown, the chaos feed, your rivalries).
 */

interface HeldChog {
  tokenId: number;
  name: string;
  imageUrl: string | null;
  traits: Record<string, string>;
}

interface TokenStats {
  tokenId: number;
  points: number;
  prankedToday: boolean;
  streak: { currentStreak: number; longestStreak: number };
  badges: string[];
  overlays: { prankId: string; caption: string }[];
}

interface HistoryRow {
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

interface HqData {
  authenticated: boolean;
  address: string;
  chogs: HeldChog[];
  today: string;
  stats: TokenStats[];
  recentOutgoing: HistoryRow[];
  recentIncoming: HistoryRow[];
}

function prankLabel(prankId: string): string {
  // The catalogue is the source of truth for names, but the HQ must render
  // even for a prank id this build does not know (a row written by a later
  // version). Never crash on unknown data.
  return prankId.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
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

export default function HqClient(): ReactNode {
  const [data, setData] = useState<HqData | null>(null);
  const [checked, setChecked] = useState(false);
  const [activeId, setActiveId] = useState<number | null>(null);
  // The reset instant is read in an effect, never during render: a clock read
  // during render would bake the BUILD-TIME midnight into the prerendered
  // HTML, and the countdown would show 00:00:00 forever. Same pattern as
  // LeftRail.
  const [resetTo, setResetTo] = useState<number | null>(null);

  useEffect(() => {
    // A named function, not a bare setState in the effect body: the lint rule
    // forbids the synchronous form because it can cascade renders.
    const readReset = () => setResetTo(nextUtcReset().getTime());
    readReset();
  }, []);

  useEffect(() => {
    let live = true;
    void fetch('/api/hq')
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (!live) return;
        if (body?.authenticated) {
          setData(body as HqData);
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
        <LoadingState>Loading your HQ</LoadingState>
      </AppShell>
    );
  }

  if (!data || !active || !stats) {
    return (
      <AppShell bare>
        <div className="x-card" style={{ textAlign: 'center' }}>
          <span style={{ fontSize: 48 }} aria-hidden="true">
            🏠
          </span>
          <h3>Your HQ needs a Chog</h3>
          <p className="x-mut">
            Connect the wallet that holds a Chog Genesis NFT. It is the player: without it
            there is no HQ, no pranks and no record.
          </p>
          <ConnectWallet />
          <Link href="/guest" className="x-btn x-btn--k x-w">
            Play as a guest instead
          </Link>
        </div>
      </AppShell>
    );
  }

  const ammoLeft = stats.prankedToday ? 0 : 1;

  return (
    <AppShell
      points={stats.points}
      ammo={ammoLeft}
      avatarUrl={active.imageUrl}
      current="hq"
      switcherChogs={
        data.chogs.length > 1
          ? data.chogs.map((c) => ({
              id: c.tokenId,
              name: c.name,
              imageUrl: c.imageUrl,
              ready: (data.stats.find((s) => s.tokenId === c.tokenId)?.prankedToday ?? true) === false,
            }))
          : undefined
      }
      banner={`${active.name} · ${stats.points.toLocaleString()} pts · streak ${stats.streak.currentStreak}`}
      leftRail={
        <>
          <div className="x-rail__card">
            <h3 className="x-rail__h">Your Chogs</h3>
            <div className="x-rail__list">
              {data.chogs.map((c) => (
                <button
                  key={c.tokenId}
                  type="button"
                  className="x-rail__chog"
                  aria-pressed={c.tokenId === active.tokenId}
                  onClick={() => setActiveId(c.tokenId)}
                >
                  {c.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img className="x-rail__av" src={c.imageUrl} alt="" />
                  ) : null}
                  <span className="x-rail__chog-name">{c.name}</span>
                  <span className="x-rail__chog-pts">
                    {(data.stats.find((s) => s.tokenId === c.tokenId)?.points ?? 0).toLocaleString()}
                  </span>
                </button>
              ))}
            </div>
          </div>
          <div className="x-rail__card">
            <h3 className="x-rail__h">Next prank in</h3>
            {resetTo === null ? (
              // Reserve the space so the card does not jump when the digits
              // land, exactly as LeftRail does.
              <span className="x-cd" aria-hidden="true">
                --:--:--
              </span>
            ) : (
              <Countdown to={resetTo} />
            )}
          </div>
          <div className="x-rail__card">
            <h3 className="x-rail__h">Chaos feed</h3>
            <ChaosStrip max={4} />
          </div>
        </>
      }
      rightRail={
        stats.overlays.length > 0 ? (
          <div className="x-rail__card">
            <h3 className="x-rail__h">On your Chog right now</h3>
            <div className="x-rail__list">
              {stats.overlays.map((o) => (
                <div key={o.prankId} className="x-rail__row">
                  <span className="x-rail__chog-name">{o.caption || prankLabel(o.prankId)}</span>
                </div>
              ))}
            </div>
            <Link href="/inbox" className="x-btn x-btn--k x-w">
              Clean it up
            </Link>
          </div>
        ) : null
      }
    >
      {/* ---- the active Chog ---- */}
      <div className="x-card">
        <div className="x-row x-sp">
          <div className="x-row" style={{ minWidth: 0 }}>
            {active.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="x-av" src={active.imageUrl} alt="" style={{ width: 56, height: 56 }} />
            ) : null}
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: 'var(--x-d)', fontSize: 22 }}>{active.name}</div>
              <div className="x-sm x-mut">
                {active.traits.Tier ?? 'Chog'} tier · {active.traits.Head ?? 'no head'} ·{' '}
                {active.traits.Accessory ?? 'no accessory'}
              </div>
            </div>
          </div>
          {data.chogs.length > 1 ? (
            <div className="x-row x-wrap">
              {data.chogs.map((c) => (
                <button
                  key={c.tokenId}
                  type="button"
                  className="x-pill"
                  aria-pressed={c.tokenId === active.tokenId}
                  style={
                    c.tokenId === active.tokenId
                      ? { background: 'var(--x-y)' }
                      : { background: 'var(--x-card)', color: 'var(--x-tx)' }
                  }
                  onClick={() => setActiveId(c.tokenId)}
                >
                  {c.name}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="x-g3" style={{ marginTop: 12 }}>
          <div className="x-card x-stat">
            <b>{stats.points.toLocaleString()}</b>
            <span className="x-sm">points</span>
          </div>
          <div className="x-card x-stat">
            <b>{stats.streak.currentStreak}</b>
            <span className="x-sm">streak</span>
          </div>
          <div className="x-card x-stat">
            <b>{ammoLeft}</b>
            <span className="x-sm">prank left today</span>
          </div>
        </div>

        {stats.badges.length > 0 ? (
          <div className="x-row x-wrap" style={{ marginTop: 12 }}>
            {stats.badges.map((b) => (
              <span key={b} className="x-pill" style={{ background: 'var(--x-g)' }}>
                🏅 {b.replace(/_/g, ' ')}
              </span>
            ))}
          </div>
        ) : null}

        {/* The primary action: the primary entry point into the prank flow. */}
        <Link
          href="/prank"
          className="x-btn x-w"
          style={ammoLeft === 0 ? { opacity: 0.6 } : undefined}
        >
          {ammoLeft > 0 ? '😈 Prank someone' : '😈 Prank someone (used today)'}
        </Link>
        {ammoLeft === 0 ? (
          <p className="x-sm x-mut" style={{ textAlign: 'center' }}>
            Today&apos;s prank is spent.{' '}
            {resetTo === null ? (
              <span className="x-cd" aria-hidden="true">
                --:--:--
              </span>
            ) : (
              <Countdown to={resetTo} />
            )}
          </p>
        ) : null}
      </div>

      {/* ---- recent history ---- */}
      <div className="x-card">
        <h3>Your latest chaos</h3>
        {data.recentOutgoing.length === 0 && data.recentIncoming.length === 0 ? (
          <p className="x-sm x-mut">
            No pranks yet. Pick a target and land the first one - it starts your streak.
          </p>
        ) : null}

        {data.recentIncoming.length > 0 ? (
          <>
            <div className="x-sm x-mut" style={{ marginTop: 8 }}>
              Got pranked
            </div>
            <div className="x-col" style={{ gap: 8 }}>
              {data.recentIncoming.map((r) => (
                <Link
                  key={r.id}
                  href={`/chog/${r.fromTokenId}`}
                  className="x-rail__row"
                  style={{ textDecoration: 'none' }}
                >
                  <span className="x-rail__chog-name">
                    {r.fromName} {r.landed ? 'pranked you with' : 'tried to prank you with'}{' '}
                    {prankLabel(r.prankId)}
                  </span>
                  <span className="x-sm x-mut">{agoLabel(r.createdAt)}</span>
                </Link>
              ))}
            </div>
          </>
        ) : null}

        {data.recentOutgoing.length > 0 ? (
          <>
            <div className="x-sm x-mut" style={{ marginTop: 12 }}>
              You pranked
            </div>
            <div className="x-col" style={{ gap: 8 }}>
              {data.recentOutgoing.map((r) => (
                <Link
                  key={r.id}
                  href={`/chog/${r.toTokenId}`}
                  className="x-rail__row"
                  style={{ textDecoration: 'none' }}
                >
                  <span className="x-rail__chog-name">
                    {prankLabel(r.prankId)} on {r.toName} - {r.landed ? `+${r.points}` : 'dodged'}
                    {r.revenge ? ' (revenge x2)' : ''}
                  </span>
                  <span className="x-sm x-mut">{agoLabel(r.createdAt)}</span>
                </Link>
              ))}
            </div>
          </>
        ) : null}
      </div>

      {/* ---- targets, phone-only rail equivalent ---- */}
      <div className="x-card">
        <h3>Pick your next target</h3>
        <p className="x-sm x-mut">Your own Chogs are never targets.</p>
        <Link href="/prank" className="x-btn x-btn--p x-w">
          Browse targets
        </Link>
      </div>
    </AppShell>
  );
}
