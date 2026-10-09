'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/AppShell';
import { ConnectWallet } from '@/components/ConnectWallet';
import { LoadingState } from '@/components/LoadingState';
import { pranksForPowers } from '@/game/pranks';
import { powersFor } from '@/game/powers';

const TOTAL_SUPPLY = 1969;

/**
 * /profile/<id> - the owner's view of one Chog.
 *
 * The public /chog/<id> page shows traits, unlocked pranks and a chaos
 * history. The profile adds what an OWNER cares about: the live record
 * (points, streak, badges), the grudges (who pranked this Chog, and whether
 * revenge is available), and the overlays still sitting on the art.
 *
 * Same data as /chog/<id> plus the owner-scoped history from /api/hq-shaped
 * reads, so the two pages cannot disagree about the same Chog.
 *
 * Phone first; the desktop treatment is the AppShell grid.
 */

interface ProfileData {
  authenticated: boolean;
  address: string;
  chogs: { tokenId: number; name: string; imageUrl: string | null; traits: Record<string, string> }[];
  stats: {
    tokenId: number;
    points: number;
    prankedToday: boolean;
    streak: { currentStreak: number; longestStreak: number };
    badges: string[];
    overlays: { prankId: string; caption: string }[];
  }[];
  recentOutgoing: {
    id: string;
    fromName: string;
    toTokenId: number;
    toName: string;
    prankId: string;
    landed: boolean;
    points: number;
    revenge: boolean;
    createdAt: string;
  }[];
  recentIncoming: {
    id: string;
    fromTokenId: number;
    fromName: string;
    toName: string;
    prankId: string;
    landed: boolean;
    points: number;
    revenge: boolean;
    createdAt: string;
  }[];
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

/**
 * `tokenId` arrives as a PROP, validated by the server shell.
 *
 * It used to be read here with useParams, which forced `instant = false` and a
 * Suspense boundary. That combination was the reason /profile/2000 answered
 * HTTP 200: with a partial prerender, the static shell is flushed first, so a
 * notFound() thrown later cannot change a status code that is already sent.
 * The same class of bug made /chog/2000 answer 404 while /profile/2000
 * answered 200 for the identical out-of-range id.
 *
 * Passing the id down removes the client-side param read entirely, which lets
 * the 404 be a real 404.
 */
export default function ProfileClient({ tokenId }: { tokenId: number }): ReactNode {

  const [data, setData] = useState<ProfileData | null>(null);
  const [checked, setChecked] = useState(false);
  // The Chog's public metadata comes from the API, never from node:fs:
  // chogs.ts is server-only, and importing it here fails the build.
  const [meta, setMeta] = useState<{ tokenId: number; name: string; imageUrl: string | null; traits: Record<string, string> } | null>(null);

  useEffect(() => {
    let live = true;
    // A named function, not a bare setState in the effect body: the lint rule
    // forbids the synchronous form because it can cascade renders.
    const reject = () => {
      if (!live) return;
      setChecked(true);
    };
    if (!Number.isInteger(tokenId) || tokenId < 1 || tokenId > TOTAL_SUPPLY) {
      reject();
      return () => {
        live = false;
      };
    }
    void fetch(`/api/chogs?limit=1&q=${tokenId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (!live) return;
        const row = ((body?.rows ?? []) as { tokenId: number; name: string; imageUrl: string | null }[]).find(
          (r) => r.tokenId === tokenId,
        );
        if (row) setMeta({ ...row, traits: {} });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [tokenId]);

  useEffect(() => {
    let live = true;
    void fetch('/api/hq')
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (!live) return;
        if (body?.authenticated) setData(body as ProfileData);
        setChecked(true);
      })
      .catch(() => {
        if (live) setChecked(true);
      });
    return () => {
      live = false;
    };
  }, []);

  const stats = useMemo(
    () => data?.stats.find((s) => s.tokenId === tokenId) ?? null,
    [data, tokenId],
  );
  const held = useMemo(() => data?.chogs.some((c) => c.tokenId === tokenId) ?? false, [data, tokenId]);

  if (!Number.isInteger(tokenId) || !meta) {
    return (
      <AppShell bare>
        <div className="x-card" style={{ textAlign: 'center' }}>
          <h3>No such Chog</h3>
          <p className="x-mut">
            Chog Genesis has exactly {TOTAL_SUPPLY.toLocaleString()} Chogs, numbered 1 to{' '}
            {TOTAL_SUPPLY.toLocaleString()}.
          </p>
          <Link href="/chog/1" className="x-btn x-w">
            Meet Chog #1
          </Link>
        </div>
      </AppShell>
    );
  }

  // Wait for BOTH the metadata and the session read: rendering before the
  // metadata lands would flash "No such Chog" for a Chog that exists.
  if (!checked || (!meta && Number.isInteger(tokenId) && tokenId >= 1 && tokenId <= TOTAL_SUPPLY)) {
    return (
      <AppShell bare>
        <LoadingState>Loading the profile</LoadingState>
      </AppShell>
    );
  }

  const powers = powersFor(meta.traits);
  const pool = pranksForPowers(powers, powers.signaturePrankId, powers.accessoryPrankId, powers.legendaryPrankId);

  return (
    <AppShell
      avatarUrl={meta.imageUrl}
      profileHref={`/profile/${tokenId}`}
      current="me"
      points={stats?.points ?? 0}
      ammo={stats?.prankedToday ? 0 : 1}
    >
      {/* ---- the Chog ---- */}
      <div className="x-card">
        <div className="x-row x-sp">
          <div className="x-row" style={{ minWidth: 0 }}>
            {meta.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="x-av" src={meta.imageUrl} alt="" style={{ width: 64, height: 64 }} />
            ) : null}
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: 'var(--x-d)', fontSize: 24 }}>{meta.name}</div>
              <div className="x-sm x-mut">
                {meta.traits.Tier ?? 'Chog'} tier - {meta.traits.Head ?? 'no head'} -{' '}
                {meta.traits.Aura ?? 'no aura'}
              </div>
            </div>
          </div>
          {held ? (
            <span className="x-pill" style={{ background: 'var(--x-g)' }}>
              yours
            </span>
          ) : null}
        </div>

        <div className="x-g3" style={{ marginTop: 12 }}>
          <div className="x-card x-stat">
            <b>{(stats?.points ?? 0).toLocaleString()}</b>
            <span className="x-sm">points</span>
          </div>
          <div className="x-card x-stat">
            <b>{stats?.streak.currentStreak ?? 0}</b>
            <span className="x-sm">streak</span>
          </div>
          <div className="x-card x-stat">
            <b>{pool.length}</b>
            <span className="x-sm">pranks unlocked</span>
          </div>
        </div>

        {stats && stats.badges.length > 0 ? (
          <div className="x-row x-wrap" style={{ marginTop: 12 }}>
            {stats.badges.map((b) => (
              <span key={b} className="x-pill" style={{ background: 'var(--x-g)' }}>
                🏅 {b.replace(/_/g, ' ')}
              </span>
            ))}
          </div>
        ) : null}

        <div className="x-row" style={{ marginTop: 12 }}>
          <Link href={`/chog/${tokenId}`} className="x-btn x-btn--k">
            Public page
          </Link>
          {held ? (
            <Link href={`/prank?target=${tokenId}`} className="x-btn x-btn--m">
              Prank as this Chog
            </Link>
          ) : null}
        </div>
      </div>

      {/* ---- overlays still on the art ---- */}
      {stats && stats.overlays.length > 0 ? (
        <div className="x-card">
          <h3>On the art right now</h3>
          <div className="x-col" style={{ gap: 8 }}>
            {stats.overlays.map((o) => (
              <div key={o.prankId} className="x-row x-sp">
                <span className="x-rail__chog-name">{o.caption || 'an overlay'}</span>
                <Link href="/inbox" className="x-btn x-btn--k">
                  Clean
                </Link>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* ---- grudges: who pranked this Chog, with revenge available ---- */}
      <div className="x-card">
        <h3>Grudges</h3>
        <p className="x-sm x-mut">
          {held
            ? 'Who landed a prank on this Chog, and whether revenge is still on the table.'
            : 'This Chog is not in your wallet, so its grudges are read-only.'}
        </p>
        {data && data.recentIncoming.filter((r) => r.toName === meta.name).length === 0 ? (
          <p className="x-sm x-mut">Nobody has landed a prank on {meta.name} yet.</p>
        ) : (
          <div className="x-col" style={{ gap: 8 }}>
            {(data?.recentIncoming ?? [])
              .filter((r) => r.toName === meta.name)
              .map((r) => (
                <div key={r.id} className="x-row x-sp">
                  <div style={{ minWidth: 0 }}>
                    <div className="x-rail__chog-name">
                      {r.fromName} hit {meta.name} with {r.prankId.replace(/-/g, ' ')}
                    </div>
                    <div className="x-sm x-mut">
                      {agoLabel(r.createdAt)} - revenge is worth 2x
                    </div>
                  </div>
                  {held ? (
                    <Link href={`/prank?target=${r.fromTokenId}`} className="x-btn x-btn--m">
                      Get revenge
                    </Link>
                  ) : null}
                </div>
              ))}
          </div>
        )}
      </div>

      {/* ---- history ---- */}
      <div className="x-card">
        <h3>History</h3>
        {data && data.recentOutgoing.filter((r) => r.fromName === meta.name).length === 0 &&
        data.recentIncoming.filter((r) => r.toName === meta.name).length === 0 ? (
          <p className="x-sm x-mut">No pranks yet. The first one starts the streak.</p>
        ) : (
          <div className="x-col" style={{ gap: 8 }}>
            {(data?.recentOutgoing ?? [])
              .filter((r) => r.fromName === meta.name)
              .map((r) => (
                <Link
                  key={r.id}
                  href={`/chog/${r.toTokenId}`}
                  className="x-rail__row"
                  style={{ textDecoration: 'none' }}
                >
                  <span className="x-rail__chog-name">
                    {r.prankId.replace(/-/g, ' ')} on {r.toName} -{' '}
                    {r.landed ? `+${r.points}` : 'dodged'}
                    {r.revenge ? ' (revenge x2)' : ''}
                  </span>
                  <span className="x-sm x-mut">{agoLabel(r.createdAt)}</span>
                </Link>
              ))}
          </div>
        )}
      </div>

      {!held ? (
        <div className="x-card" style={{ textAlign: 'center' }}>
          <h3>Own {meta.name}?</h3>
          <p className="x-mut">
            Connect the wallet that holds this Chog to manage its record, clean its art and get
            revenge.
          </p>
          <ConnectWallet />
        </div>
      ) : null}
    </AppShell>
  );
}
