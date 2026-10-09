'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/AppShell';
import { LoadingState } from '@/components/LoadingState';

/**
 * /ranks - the three leaderboards.
 *
 * Weekly (most chaotic, most wanted, best dodger - the three schema views),
 * All-time points, and Rivalries (head-to-head against your own Chogs).
 *
 * The viewer's own Chogs are highlighted, and a viewer with no rank yet gets
 * a pinned Unranked row at the bottom rather than an empty board - the reviewer's
 * spec. Everything is keyed on token id, so a Chog keeps its rank when it
 * changes hands.
 *
 * Phone first: a single column of stacked boards. The tablet/desktop
 * treatment is the AppShell grid with the rails.
 */

interface RankRow {
  tokenId: number;
  name: string;
  imageUrl: string | null;
  points: number;
  pranks: number;
  mine: boolean;
}

interface RanksData {
  myTokenIds: number[];
  weekly: { chaotic: RankRow[]; bullied: RankRow[]; dodger: RankRow[] };
  allTime: RankRow[];
  rivalries: {
    opponentTokenId: number;
    opponentName: string;
    mine: number;
    theirs: number;
    myTokenId: number;
  }[];
}

type Tab = 'weekly' | 'alltime' | 'rivalries';

const TABS: { key: Tab; label: string }[] = [
  { key: 'weekly', label: 'Weekly' },
  { key: 'alltime', label: 'All-time' },
  { key: 'rivalries', label: 'Rivalries' },
];

function rankLabel(i: number): string {
  return ['🥇', '🥈', '🥉'][i] ?? `#${i + 1}`;
}

function Board({
  title,
  subtitle,
  rows,
  metric,
}: {
  title: string;
  subtitle: string;
  rows: RankRow[];
  metric: (r: RankRow) => string;
}) {
  return (
    <div className="x-card">
      <h3>{title}</h3>
      <p className="x-sm x-mut">{subtitle}</p>
      {rows.length === 0 ? (
        <p className="x-sm x-mut">Nobody here yet. Land the first prank of the week.</p>
      ) : (
        <div className="x-col" style={{ gap: 8, marginTop: 8 }}>
          {rows.map((r, i) => (
            <Link
              key={r.tokenId}
              href={`/chog/${r.tokenId}`}
              className="x-rail__row"
              style={{
                textDecoration: 'none',
                background: r.mine ? 'var(--x-y)' : undefined,
                color: r.mine ? 'var(--x-ink)' : undefined,
              }}
            >
              <span className="x-rail__chog-name">
                {rankLabel(i)} {r.name}
              </span>
              <span className="x-sm">{metric(r)}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export default function RanksClient(): ReactNode {
  const [data, setData] = useState<RanksData | null>(null);
  const [tab, setTab] = useState<Tab>('weekly');

  useEffect(() => {
    let live = true;
    void fetch('/api/ranks')
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (live && body) setData(body as RanksData);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  // The pinned Unranked row: my Chogs, when they are not on a board yet.
  const myUnranked = useMemo(() => {
    if (!data || data.myTokenIds.length === 0) return [];
    const ranked = new Set([
      ...data.weekly.chaotic.map((r) => r.tokenId),
      ...data.allTime.map((r) => r.tokenId),
    ]);
    return data.myTokenIds
      .filter((id) => !ranked.has(id))
      .map((id) => ({ tokenId: id, name: `CHOG #${id}`, imageUrl: null, points: 0, pranks: 0, mine: true }));
  }, [data]);

  if (!data) {
    return (
      <AppShell bare>
        <LoadingState>Loading the ranks</LoadingState>
      </AppShell>
    );
  }

  return (
    <AppShell current="ranks">
      <div className="x-row x-wrap">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className="x-pill"
            aria-pressed={tab === t.key}
            style={
              tab === t.key
                ? { background: 'var(--x-y)' }
                : { background: 'var(--x-card)', color: 'var(--x-tx)' }
            }
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'weekly' ? (
        <>
          <Board
            title="Most chaotic"
            subtitle="Most points from landed pranks this week."
            rows={data.weekly.chaotic}
            metric={(r) => `${r.points.toLocaleString()} pts · ${r.pranks} pranks`}
          />
          {/* "Most Wanted", not "Most bullied". The data field stays
              `bullied` and the Supabase view stays `weekly_most_bullied`: a
              rename in the database would mean a migration and a coordinated
              deploy for no player-visible gain, while the label is what a
              player reads and it was framing a leaderboard as a list of
              victims. */}
          <Board
            title="Most Wanted"
            subtitle="Took the most landed pranks this week."
            rows={data.weekly.bullied}
            metric={(r) => `${r.pranks} hits taken`}
          />
          <Board
            title="Best dodger"
            subtitle="Dodged the most pranks this week."
            rows={data.weekly.dodger}
            metric={(r) => `${r.pranks} dodges`}
          />
        </>
      ) : null}

      {tab === 'alltime' ? (
        <Board
          title="All-time points"
          subtitle="Every landed prank, forever. The Hall of Fame."
          rows={data.allTime}
          metric={(r) => `${r.points.toLocaleString()} pts · ${r.pranks} pranks`}
        />
      ) : null}

      {tab === 'rivalries' ? (
        <div className="x-card">
          <h3>Rivalries</h3>
          <p className="x-sm x-mut">Head-to-head against your own Chogs.</p>
          {data.rivalries.length === 0 ? (
            <p className="x-sm x-mut">No history yet. Prank someone and they might prank back.</p>
          ) : (
            <div className="x-col" style={{ gap: 8, marginTop: 8 }}>
              {data.rivalries.map((r) => (
                <Link
                  key={`${r.myTokenId}-${r.opponentTokenId}`}
                  href={`/chog/${r.opponentTokenId}`}
                  className="x-rail__row"
                  style={{ textDecoration: 'none' }}
                >
                  <span className="x-rail__chog-name">{r.opponentName}</span>
                  <span className="x-d" style={{ fontSize: 18, flex: 'none' }}>
                    <span style={{ color: 'var(--x-g)' }}>{r.mine}</span> -{' '}
                    <span style={{ color: 'var(--x-m)' }}>{r.theirs}</span>
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {/* the product spec: a viewer with no rank yet is pinned as Unranked, never
          shown an empty board. */}
      {myUnranked.length > 0 ? (
        <div className="x-card">
          <h3>Your Chogs</h3>
          <div className="x-col" style={{ gap: 8 }}>
            {myUnranked.map((r) => (
              <Link
                key={r.tokenId}
                href={`/chog/${r.tokenId}`}
                className="x-rail__row"
                style={{ textDecoration: 'none', background: 'var(--x-y)', color: 'var(--x-ink)' }}
              >
                <span className="x-rail__chog-name">{r.name}</span>
                <span className="x-sm">Unranked - land one prank to get on the board</span>
              </Link>
            ))}
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}
