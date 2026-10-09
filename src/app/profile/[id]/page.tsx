import type { Metadata } from 'next';
import { Suspense } from 'react';
import ProfileClient from './ProfileClient';

/**
 * /profile/<id> - the owner's view of one Chog.
 *
 * A server shell with no data of its own: the Chog's public metadata comes
 * from GET /api/chogs (single-row, traits included) and the record from
 * GET /api/hq, both client-side. That keeps node:fs out of the browser
 * chunk and makes the page testable with mocked APIs.
 *
 * `instant = false` + Suspense: the client reads the route param with
 * useParams, a hook that cannot run during prerender, and the page is
 * per-viewer anyway (it gates on the session).
 */

export const instant = false;

export const metadata: Metadata = {
  title: 'Profile - Chog Mischief',
  description: 'A Chog record: points, streak, badges, grudges and history.',
};

export default function ProfilePage() {
  return (
    <Suspense
      fallback={
        <div className="x-app">
          <div className="x-scr">
            <div className="x-card">
              <h3>Loading the profile...</h3>
            </div>
          </div>
        </div>
      }
    >
      <ProfileClient />
    </Suspense>
  );
}
