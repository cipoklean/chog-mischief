import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * A Chog page is shareable, so bad links are expected — a judge will follow one
 * from a truncated chat message. The default Next 404 renders inside the root
 * layout with no content and no way back into the game.
 */
export default function NotFound(): ReactNode {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-5 py-16">
      <p className="text-xs uppercase tracking-widest text-ink-soft">404</p>
      <h1 className="font-display mt-3 text-4xl leading-tight sm:text-5xl">
        No Chog lives at this address.
      </h1>
      <p className="mt-4 leading-relaxed text-ink-soft">
        Chog Genesis has exactly 1,969 Chogs, numbered 1 to 1,969. If you followed a
        link, the number in it is probably mistyped.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/" className="pill">
          Browse all Chogs
        </Link>
        <Link href="/chog/1" className="pill">
          Meet Chog #1
        </Link>
      </div>
    </main>
  );
}