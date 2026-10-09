import type { Metadata } from 'next';
import { Suspense } from 'react';
import PrankClient from './PrankClient';

/**
 * /prank — the signed-in prank flow.
 *
 * A server shell with no data of its own: everything (the session, the held
 * Chogs, the target grid, the prepare/commit calls) is fetched client-side
 * from /api. That is deliberate — it keeps the whole flow mockable in
 * Playwright (see tests/ui/prank.spec.ts) and means no cookie or file is
 * read outside an API route.
 *
 * `instant = false` + a Suspense boundary: the flow reads the URL
 * (?target=) with useSearchParams, a client hook that cannot run during
 * prerender, and the page is per-user anyway (it gates on the session). The
 * fallback streams in after prerender; the flow itself needs no server data.
 */

export const instant = false;

export const metadata: Metadata = {
  title: 'Prank — Chog Mischief',
  description: 'Pick a target, pick your weapon, sign it. No gas.',
};

export default function PrankPage() {
  return (
    <Suspense
      fallback={
        <div className="x-app">
          <div className="x-scr">
            <div className="x-card">
              <h3>Loading the prank flow…</h3>
            </div>
          </div>
        </div>
      }
    >
      <PrankClient />
    </Suspense>
  );
}
