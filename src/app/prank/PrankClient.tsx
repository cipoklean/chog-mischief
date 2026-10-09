'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ComponentType } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { ConnectWallet } from '@/components/ConnectWallet';
import { ChogCard } from '@/components/ChogCard';
import { RefusalSheet, type RefusalKind } from '@/components/RefusalSheet';
import { PrankOverlay } from '@/components/PrankOverlay';
import { Toast } from '@/components/Toast';
import { prankLocks } from '@/lib/prank-locks';
import { mapPrepareFailure, plainFailureMessage } from '@/lib/prank-refusals';
import type { ChogTraits } from '@/game/powers';
import type { ReactNode } from 'react';
import type { PrankResult, PrankSignStepProps } from './PrankSignStep';

/**
 * /prank - the signed-in prank flow, the core of the game.
 *
 * The prototype's 3-step stepper (target -> prank -> sign), built on the
 * components that already exist: ChogCard tiles, x-opt prank buttons,
 * AwaitingSignature, CheckingOwnership, the SuspenseBar, PrankOverlay for
 * the result, RefusalSheet for every failure.
 *
 * ── What the server decides, always ───────────────────────────────────────
 * The client picks WHICH Chog acts, WHICH target, and WHICH of its
 * trait-unlocked pranks to use. Everything else - the dodge roll, whether
 * it landed, the points, the streak, the daily limit - comes from
 * /api/prank/prepare and /api/prank/commit, and the commit re-parses every
 * number out of the SIGNED message. The daily limit is checked in prepare,
 * BEFORE any signature is requested, so a used-up player never signs.
 *
 * ── Why the wallet hooks live in a dynamically imported child ─────────────
 * AppKit hooks throw when called during static prerender, and a mounted
 * flag cannot prevent a hook from being CALLED. Same pattern as
 * ConnectWallet: PrankSignStep is imported after mount.
 *
 * ── Fully API-driven on purpose ───────────────────────────────────────────
 * The session, the held Chogs' traits, the target grid and both prank calls
 * all go through /api. That is what makes the whole flow testable in
 * Playwright with mocked routes and a test signer, and it means no
 * component here reads a cookie or a file directly.
 */

interface HeldChog {
  tokenId: number;
  name: string;
  imageUrl: string | null;
  traits: ChogTraits;
}

interface TargetRow {
  tokenId: number;
  name: string;
  imageUrl: string | null;
}

type Step = 'target' | 'prank' | 'sign' | 'result';

const FILTERS = [
  { key: 'all', label: 'All Chogs' },
  { key: 'rivals', label: 'Rivals' },
  { key: 'recent', label: 'Got you recently' },
] as const;

const PAGE = 24;

export default function PrankClient(): ReactNode {
  const params = useSearchParams();
  const router = useRouter();
  const preselectedTarget = Number(params.get('target')) || null;

  const [session, setSession] = useState<{
    address: string;
    chogs: HeldChog[];
  } | null>(null);
  const [sessionChecked, setSessionChecked] = useState(false);

  const [activeId, setActiveId] = useState<number | null>(null);
  const [step, setStep] = useState<Step>('target');
  const [target, setTarget] = useState<TargetRow | null>(null);
  const [prankId, setPrankId] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<{ message: string } | null>(null);
  const [refusal, setRefusal] = useState<RefusalKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [result, setResult] = useState<PrankResult | null>(null);
  const [shareOpen, setShareOpen] = useState(false);

  // ---- session ------------------------------------------------------------
  useEffect(() => {
    let live = true;
    void fetch('/api/auth/session')
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (!live) return;
        if (body?.authenticated && Array.isArray(body.chogs) && body.chogs.length > 0) {
          setSession({ address: body.address, chogs: body.chogs });
          setActiveId(body.chogs[0].tokenId);
        }
        setSessionChecked(true);
      })
      .catch(() => {
        if (live) setSessionChecked(true);
      });
    return () => {
      live = false;
    };
  }, []);

  // ---- the sign step, loaded after mount (AppKit hook trap) ---------------
  const [SignStep, setSignStep] = useState<ComponentType<PrankSignStepProps> | null>(null);
  useEffect(() => {
    let live = true;
    void import('./PrankSignStep').then((mod) => {
      if (live) setSignStep(() => mod.PrankSignStep);
    });
    return () => {
      live = false;
    };
  }, []);

  const active = useMemo(
    () => session?.chogs.find((c) => c.tokenId === activeId) ?? session?.chogs[0] ?? null,
    [session, activeId],
  );
  const ownIds = useMemo(() => (session?.chogs ?? []).map((c) => c.tokenId), [session]);

  // ---- step 1: the target grid --------------------------------------------
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'rivals' | 'recent'>('all');
  const [rows, setRows] = useState<TargetRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loadingTargets, setLoadingTargets] = useState(false);
  const [offset, setOffset] = useState(0);

  const loadTargets = useCallback(
    async (nextOffset: number, append: boolean) => {
      setLoadingTargets(true);
      try {
        const url = new URL('/api/chogs', window.location.origin);
        url.searchParams.set('exclude', ownIds.join(','));
        url.searchParams.set('filter', filter);
        url.searchParams.set('active', String(activeId ?? ''));
        url.searchParams.set('limit', String(PAGE));
        url.searchParams.set('offset', String(nextOffset));
        if (query) url.searchParams.set('q', query);
        const res = await fetch(url.toString());
        if (!res.ok) return;
        const body = (await res.json()) as { rows?: TargetRow[]; total?: number; cacheReady?: boolean };
        setRows((prev) => (append ? [...prev, ...(body.rows ?? [])] : (body.rows ?? [])));
        setTotal(body.total ?? 0);
        setOffset(nextOffset + (body.rows?.length ?? 0));
      } finally {
        setLoadingTargets(false);
      }
    },
    [ownIds, filter, activeId, query],
  );

  // (Re)load when the inputs change; reset paging. The named function keeps
  // the setState out of the effect body (react-hooks/set-state-in-effect).
  useEffect(() => {
    if (!session) return;
    const reload = () => {
      setOffset(0);
      void loadTargets(0, false);
    };
    reload();
  }, [session, filter, activeId, query, loadTargets]);

  // ---- a preselected target (from a Chog page) skips straight to step 2 --
  useEffect(() => {
    if (!session || !preselectedTarget || ownIds.includes(preselectedTarget)) return;
    let live = true;
    void fetch(`/api/chogs?limit=1&q=${preselectedTarget}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (!live) return;
        const row = (body?.rows ?? []).find(
          (r: TargetRow) => r.tokenId === preselectedTarget,
        ) as TargetRow | undefined;
        if (row) {
          setTarget(row);
          setStep('prank');
        }
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [session, preselectedTarget, ownIds]);

  // ---- step 2 -> prepare ---------------------------------------------------
  const locks = useMemo(() => (active ? prankLocks(active.traits) : []), [active]);
  const chosen = locks.find((l) => l.prank.id === prankId) ?? null;

  async function goToSign() {
    if (!active || !target || !chosen) return;
    setError(null);
    setRefusal(null);
    try {
      const res = await fetch('/api/prank/prepare', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          fromTokenId: active.tokenId,
          toTokenId: target.tokenId,
          prankId: chosen.prank.id,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        message?: string;
        error?: string;
        detail?: string;
      };
      if (!res.ok) {
        // The daily limit is checked HERE, before any signature.
        const kind = mapPrepareFailure({ status: res.status, error: body.error, detail: body.detail });
        if (kind) {
          setRefusal(kind);
          return;
        }
        setError(plainFailureMessage({ status: res.status, error: body.error, detail: body.detail }) ?? body.error ?? 'could not prepare that prank');
        return;
      }
      if (!body.message) {
        setError('the server did not return a message to sign');
        return;
      }
      setPrepared({ message: body.message });
      setStep('sign');
    } catch {
      setError('the network dropped the request. Nothing was signed.');
    }
  }

  // ---- the result overlay --------------------------------------------------
  function renderResult() {
    if (!result || !target) return null;
    const hit = result.landed;
    return (
      <PrankOverlay
        open
        labelledBy="prank-result-headline"
        confetti={hit ? 24 : 0}
        headline={
          <div style={{ display: 'grid', gap: 8 }}>
            <div className="x-boom">{hit ? '💥 HIT!' : '🛡️ DODGED!'}</div>
            <div id="prank-result-headline" style={{ fontFamily: 'var(--x-d)', fontSize: 20 }}>
              {hit
                ? `${result.prankName} landed on ${target.name}`
                : `${target.name} dodged ${result.prankName}`}
            </div>
          </div>
        }
        actions={[
          { label: 'Share card', onClick: () => setShareOpen(true), variant: 'm' },
          { label: 'Back to HQ', href: '/hq', variant: 'k' },
        ]}
      >
        <p className="x-sm x-mut">{result.caption}</p>
        <div className="x-g3">
          <div className="x-card x-stat">
            <b>{result.points}</b>
            <span className="x-sm">points</span>
          </div>
          <div className="x-card x-stat">
            <b>{result.streak}</b>
            <span className="x-sm">streak</span>
          </div>
          <div className="x-card x-stat">
            <b>{result.revenge ? 'x2' : '-'}</b>
            <span className="x-sm">revenge</span>
          </div>
        </div>
        {result.newBadges.length > 0 ? (
          <div className="x-row x-wrap" style={{ justifyContent: 'center' }}>
            {result.newBadges.map((b) => (
              <span key={b} className="x-pill" style={{ background: 'var(--x-g)' }}>
                🏅 {b.replace(/_/g, ' ')}
              </span>
            ))}
          </div>
        ) : null}
      </PrankOverlay>
    );
  }

  function renderShare() {
    if (!shareOpen || !result || !target) return null;
    return (
      <PrankOverlay
        open
        size="lg"
        labelledBy="share-headline"
        headline={<h2 id="share-headline" style={{ fontSize: 22 }}>Share the chaos</h2>}
        onClose={() => setShareOpen(false)}
      >
        <div className="x-share">
          {target.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={target.imageUrl} alt={target.name} />
          ) : null}
          <strong style={{ fontFamily: 'var(--x-d)', fontSize: 18 }}>
            {result.landed ? `${result.prankName} landed on` : 'Dodged by'} {target.name}
          </strong>
          <span className="x-sm">
            {result.landed ? `+${result.points} chaos points` : '0 points - try again tomorrow'}
          </span>
          <Link href={`/chog/${target.tokenId}`} className="x-sm">
            chogmischief.xyz/chog/{target.tokenId}
          </Link>
        </div>
        <button
          type="button"
          className="x-btn x-btn--p x-w"
          onClick={() => {
            const url = `${window.location.origin}/chog/${target.tokenId}`;
            void navigator.clipboard?.writeText(url).catch(() => undefined);
            setToast('Link copied');
          }}
        >
          Copy link
        </button>
      </PrankOverlay>
    );
  }

  // ---- gates ---------------------------------------------------------------
  if (!sessionChecked) {
    return (
      <AppShell bare>
        <div className="x-card">
          <h3>Checking your Chogs…</h3>
          <p className="x-sm x-mut">One moment.</p>
        </div>
      </AppShell>
    );
  }

  if (!session || !active) {
    return (
      <AppShell bare>
        <div className="x-card" style={{ textAlign: 'center' }}>
          <span style={{ fontSize: 48 }} aria-hidden="true">
            💣
          </span>
          <h3>Hold a Chog to prank</h3>
          <p className="x-mut">
            Pranking needs a Chog Genesis NFT - it is the player. Connect the wallet that
            holds one; signing only, no gas.
          </p>
          <ConnectWallet />
          <Link href="/guest" className="x-btn x-btn--k x-w">
            Play as a guest instead
          </Link>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell bare points={result?.points ?? 0} ammo={0}>
      {/* The prototype's x-steps bar: 3 segments, the current one lit. */}
      <div className="x-steps" aria-hidden="true">
        {(['target', 'prank', 'sign'] as Step[]).map((s) => (
          <i key={s} className={['target', 'prank', 'sign'].indexOf(s) <= ['target', 'prank', 'sign'].indexOf(step === 'result' ? 'sign' : step) ? 'on' : ''} />
        ))}
      </div>

      <div className="x-row x-sp">
        <h2 style={{ margin: 0 }}>
          {step === 'target' ? "Who's getting it?" : step === 'prank' ? 'Pick your weapon' : 'Sign it'}
        </h2>
        <span className="x-pill" title="Pranking as">
          😈 {active.name}
        </span>
      </div>

      {/* Active-Chog switcher when the wallet holds more than one. */}
      {session.chogs.length > 1 ? (
        <div className="x-row x-wrap">
          {session.chogs.map((c) => (
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
              onClick={() => {
                setActiveId(c.tokenId);
                setStep('target');
                setTarget(null);
                setPrankId(null);
              }}
            >
              {c.name}
            </button>
          ))}
        </div>
      ) : null}

      {/* ---------------- step 1: target ---------------- */}
      {step === 'target' ? (
        <>
          <div className="x-row x-wrap">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                className="x-pill"
                aria-pressed={filter === f.key}
                style={
                  filter === f.key
                    ? { background: 'var(--x-y)' }
                    : { background: 'var(--x-card)', color: 'var(--x-tx)' }
                }
                onClick={() => setFilter(f.key)}
              >
                {f.label}
              </button>
            ))}
          </div>
          <input
            className="x-opt"
            style={{ minHeight: 'var(--tap)' }}
            placeholder="Search Chogs by name or #id…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search Chogs"
          />

          {rows.length === 0 && !loadingTargets ? (
            <p className="x-sm x-mut">
              {filter === 'all'
                ? 'No Chogs matched that search.'
                : 'No prank history yet - that filter fills up as you play.'}
            </p>
          ) : null}

          <div className="x-g3">
            {rows.map((r) => (
              <ChogCard
                key={r.tokenId}
                id={r.tokenId}
                name={r.name}
                imageUrl={r.imageUrl}
                onClick={() => {
                  setTarget(r);
                  setPrankId(null);
                  setStep('prank');
                }}
              />
            ))}
          </div>

          {offset < total ? (
            <button
              type="button"
              className="x-btn x-btn--k x-w"
              disabled={loadingTargets}
              onClick={() => void loadTargets(offset, true)}
            >
              {loadingTargets ? 'Loading…' : `Show more (${total - offset} left)`}
            </button>
          ) : null}
        </>
      ) : null}

      {/* ---------------- step 2: prank ---------------- */}
      {step === 'prank' && target ? (
        <>
          <div className="x-card">
            <div className="x-row x-sp">
              <div className="x-row" style={{ minWidth: 0 }}>
                {target.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="x-av" src={target.imageUrl} alt="" />
                ) : null}
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontFamily: 'var(--x-d)', fontSize: 18 }}>{target.name}</div>
                  <div className="x-sm x-mut">Target</div>
                </div>
              </div>
              <button type="button" className="x-btn x-btn--k" onClick={() => setStep('target')}>
                ← Change
              </button>
            </div>
          </div>

          <div className="x-col" style={{ gap: 8 }}>
            {locks.map((l) => (
              <button
                key={l.prank.id}
                type="button"
                className="x-opt"
                disabled={!l.unlocked}
                aria-pressed={prankId === l.prank.id}
                style={
                  l.unlocked
                    ? prankId === l.prank.id
                      ? { background: 'var(--x-m)', color: 'var(--x-ink)' }
                      : undefined
                    : { opacity: 0.45, cursor: 'not-allowed' }
                }
                onClick={() => setPrankId(l.prank.id)}
              >
                <div className="x-row x-sp">
                  <span style={{ fontFamily: 'var(--x-d)', fontSize: 17 }}>{l.prank.name}</span>
                  <span className="x-pill" style={{ background: 'var(--x-card)', color: 'var(--x-tx)' }}>
                    {l.prank.rarity}
                  </span>
                </div>
                {l.unlocked ? (
                  <p className="x-sm x-mut">{l.prank.caption}</p>
                ) : (
                  <p className="x-sm" style={{ color: 'var(--x-mut)' }}>
                    {l.reason}
                  </p>
                )}
              </button>
            ))}
          </div>

          <button
            type="button"
            className="x-btn x-w"
            disabled={!chosen}
            onClick={() => void goToSign()}
          >
            {chosen ? `Prank with ${chosen.prank.name}` : 'Pick a prank'}
          </button>
        </>
      ) : null}

      {/* ---------------- step 3: sign ---------------- */}
      {step === 'sign' && target && chosen && prepared && SignStep ? (
        <SignStep
          fromTokenId={active.tokenId}
          toTokenId={target.tokenId}
          prankId={chosen.prank.id}
          message={prepared.message}
          targetName={target.name}
          prankName={chosen.prank.name}
          prankCaption={chosen.prank.caption}
          onResult={(r) => {
            setResult(r);
            setStep('result');
          }}
          onRefusal={(kind) => setRefusal(kind)}
          onError={(msg) => setError(msg)}
          onCancel={() => {
            setPrepared(null);
            setStep('prank');
          }}
        />
      ) : null}

      {/* ---------------- the result ---------------- */}
      {step === 'result' ? renderResult() : null}
      {renderShare()}

      {/* ---------------- refusals + errors ---------------- */}
      <RefusalSheet
        kind={refusal}
        tokenId={target?.tokenId ?? active.tokenId}
        onAction={(action) => {
          setRefusal(null);
          if (action === 'pick') setStep('target');
          if (action === 'retry' && step === 'sign') {
            setPrepared(null);
            setStep('prank');
          }
          if (action === 'hq') router.push('/hq');
        }}
        onClose={() => setRefusal(null)}
      />

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

      <Toast message={toast} onDismiss={() => setToast(null)} />
    </AppShell>
  );
}
