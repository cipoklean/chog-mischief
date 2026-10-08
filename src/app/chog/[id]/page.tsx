import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { getChog, getOwnerFromSnapshot, TOTAL_SUPPLY } from '@/lib/chogs';
import { powersFor } from '@/game/powers';
import { pranksForPowers, getPrank } from '@/game/pranks';

/**
 * Every Chog gets a shareable page. Prebuilding all 1,969 at build time means
 * a shared link renders instantly and never 500s — and the owner/identity data
 * it shows comes from the cache, not from a live RPC call.
 */

export function generateStaticParams() {
  return Array.from({ length: TOTAL_SUPPLY }, (_, i) => ({ id: String(i + 1) }));
}

type ChogParams = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: ChogParams): Promise<Metadata> {
  const { id } = await params;
  const chog = getChog(Number(id));
  if (!chog) return { title: 'Chog not found — Chog Mischief' };

  const title = `${chog.name} — Chog Mischief`;
  const description = `${chog.traits.Tier ?? 'Chog'} tier Chog Genesis #${chog.tokenId}. See its traits, pranks and chaos history.`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      // OpenSea's CDN serves the art directly, so the share card needs no
      // image-generation step to look right.
      images: chog.imageUrl ? [{ url: chog.imageUrl, width: 512, height: 512 }] : undefined,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: chog.imageUrl ? [chog.imageUrl] : undefined,
    },
  };
}

const RARITY_LABEL = { common: 'Common', rare: 'Rare', legendary: 'Legendary' } as const;

export default async function ChogPage({ params }: ChogParams): Promise<ReactNode> {
  const { id } = await params;
  const tokenId = Number(id);

  // Guard the range explicitly. `getChog` returning null covers a missing cache,
  // but an id like 999999 would otherwise render an empty shell.
  if (!Number.isInteger(tokenId) || tokenId < 1 || tokenId > TOTAL_SUPPLY) notFound();

  const chog = getChog(tokenId);
  if (!chog) notFound();

  const powers = powersFor(chog.traits);
  const pool = pranksForPowers(
    powers,
    powers.signaturePrankId,
    powers.accessoryPrankId,
    powers.legendaryPrankId,
  );
  const owner = getOwnerFromSnapshot(tokenId);

  // The signature and the accessary are distinct unlocks; show whichever exist.
  const unlocks = [
    { label: 'Head', prank: getPrank(powers.signaturePrankId) },
    { label: 'Accessory', prank: getPrank(powers.accessoryPrankId) },
    { label: 'Weekly legendary', prank: getPrank(powers.legendaryPrankId) },
  ].filter((u): u is { label: string; prank: NonNullable<ReturnType<typeof getPrank>> } =>
    u.prank !== null,
  );

  const traits = Object.entries(chog.traits).filter(
    ([k]) => !['__'].some((r) => k.startsWith(r)),
  );

  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-8 sm:py-12">
      <Link href="/" className="text-sm text-ink-soft hover:text-accent">
        ← All Chogs
      </Link>

      <div className="mt-6 grid gap-8 sm:grid-cols-[minmax(0,280px)_1fr]">
        <div>
          {chog.imageUrl ? (
            // Art comes from a third-party CDN, so a broken image must not leave
            // a blank hole in the layout.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={chog.imageUrl}
              alt={chog.name}
              width={512}
              height={512}
              className="w-full rounded-2xl border border-line bg-white"
              loading="eager"
            />
          ) : (
            <div className="grid aspect-square w-full place-items-center rounded-2xl border border-line bg-white text-sm text-ink-soft">
              Art unavailable
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <span className="tag tag-accent">{chog.traits.Tier ?? 'Chog'}</span>
            <span className="tag">#{chog.tokenId}</span>
          </div>
        </div>

        <div>
          <h1 className="font-display text-4xl leading-tight">{chog.name}</h1>
          <p className="mt-2 text-ink-soft">
            One of {TOTAL_SUPPLY.toLocaleString()} Chogs. Every Chog is a player.
          </p>

          <section className="mt-6">
            <h2 className="text-xs font-medium uppercase tracking-wide text-ink-soft">
              Powers
            </h2>
            <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Base points" value={String(powers.basePoints)} />
              <Stat label="Dodge" value={`${Math.round(powers.dodgeChance * 100)}%`} />
              <Stat label="Accuracy" value={`${Math.round(powers.accuracy * 100)}%`} />
              <Stat label="Best prank" value={RARITY_LABEL[powers.maxRarity]} />
            </dl>
          </section>

          {unlocks.length > 0 && (
            <section className="mt-8">
              <h2 className="text-xs font-medium uppercase tracking-wide text-ink-soft">
                Unlocked pranks
              </h2>
              <ul className="mt-3 space-y-3">
                {unlocks.map(({ label, prank }) => (
                  <li key={prank.id} className="card p-4">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-display text-xl">{prank.name}</span>
                      <span className="tag">{label}</span>
                    </div>
                    <p className="mt-1 text-sm text-ink-soft">{prank.caption}</p>
                    <p className="mt-2 text-xs text-ink-soft">
                      {prank.points} pts · {prank.rarity}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="mt-8">
            <h2 className="text-xs font-medium uppercase tracking-wide text-ink-soft">
              Traits
            </h2>
            <ul className="mt-3 flex flex-wrap gap-2">
              {traits.map(([key, value]) => (
                <li key={key} className="tag">
                  <span className="opacity-60">{key}</span> {String(value)}
                </li>
              ))}
            </ul>
          </section>

          <section className="mt-8 text-sm text-ink-soft">
            {owner ? (
              <p>
                Held by{' '}
                <span className="font-mono text-xs">
                  {owner.slice(0, 6)}…{owner.slice(-4)}
                </span>
              </p>
            ) : (
              <p>Ownership is read live from Monad when you sign in.</p>
            )}
            <p className="mt-2">
              This Chog can pull {pool.length} different prank
              {pool.length === 1 ? '' : 's'}.
            </p>
          </section>

          <div className="mt-8 flex flex-wrap gap-3">
            <button type="button" className="pill" disabled>
              Prank {chog.name}
            </button>
            <span className="pill opacity-60">Sign in to play</span>
          </div>
        </div>
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-3">
      <dt className="text-xs text-ink-soft">{label}</dt>
      <dd className="mt-1 font-display text-2xl">{value}</dd>
    </div>
  );
}