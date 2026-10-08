import Link from 'next/link';
import type { ReactNode } from 'react';
import { TOTAL_SUPPLY } from '@/lib/chogs';
import { POWER_GROUPS, FEATURED } from '@/lib/home-data';

/**
 * The feed. Static at build time: every card links to a prebuilt Chog page, so
 * the first thing a judge sees loads instantly on a phone.
 */
export default function Home(): ReactNode {
  return (
    <main className="mx-auto w-full max-w-5xl px-5 py-8 sm:py-14">
      <header className="max-w-2xl">
        <p className="text-xs uppercase tracking-widest text-ink-soft">
          Chogathon 2026 · Monad
        </p>
        <h1 className="font-display mt-3 text-5xl leading-[1.05] sm:text-6xl">
          A daily prank war,
          <br />
          <em className="text-accent">one Chog at a time.</em>
        </h1>
        <p className="mt-5 text-lg leading-relaxed text-ink-soft">
          Every Chog Genesis NFT is a player. Prank another Chog once a day, get
          pranked back, and carry your chaos history with the token itself — sell
          the Chog and its grudges go with it.
        </p>
        <p className="mt-3 text-sm text-ink-soft">
          Free to play. Wallets only sign messages, so it never costs gas.
        </p>

        <div className="mt-7 flex flex-wrap gap-3">
          <Link href="#browse" className="pill">
            Browse Chogs
          </Link>
          <span className="pill opacity-60">Sign in to prank</span>
        </div>
      </header>

      <section className="mt-14">
        <h2 className="font-display text-3xl">Your traits are your pranks</h2>
        <p className="mt-2 max-w-2xl text-ink-soft">
          Tier sets how much chaos you cause. Aura decides how well you dodge. Your
          Mouth unlocks taunts, and your Head and Accessory each unlock one
          signature prank nobody else has.
        </p>

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {POWER_GROUPS.map((group) => (
            <div key={group.trait} className="card p-5">
              <span className="tag tag-accent">{group.trait}</span>
              <h3 className="font-display mt-3 text-2xl">{group.effect}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-soft">
                {group.detail}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section id="browse" className="mt-16">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-3xl">Pick a Chog</h2>
          <p className="text-sm text-ink-soft">
            {TOTAL_SUPPLY.toLocaleString()} in the collection · every one is playable
          </p>
        </div>

        <ul className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {FEATURED.map((chog) => (
            <li key={chog.tokenId}>
              <Link href={`/chog/${chog.tokenId}`} className="group block">
                <div className="overflow-hidden rounded-2xl border border-line bg-white">
                  {/* Art is remote (OpenSea CDN) and cannot be optimised at build time. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={chog.imageUrl}
                    alt={chog.name}
                    width={512}
                    height={512}
                    loading="lazy"
                    className="aspect-square w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
                  />
                </div>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="font-display text-lg">{chog.name}</span>
                  <span className="tag shrink-0">{chog.tier}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>

        <p className="mt-6 text-sm text-ink-soft">
          Any of the {TOTAL_SUPPLY.toLocaleString()} works — these are just a few to
          start with.
        </p>
      </section>
    </main>
  );
}