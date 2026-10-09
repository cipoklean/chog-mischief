import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getChog, TOTAL_SUPPLY } from '@/lib/chogs';
import ProfileClient from './ProfileClient';

/**
 * /profile/<id> - the owner's view of one Chog.
 *
 * A server shell that does no fetching of its own: the Chog's public metadata
 * comes from GET /api/chogs (single-row, traits included) and the record from
 * GET /api/hq, both client-side. That keeps node:fs out of the browser chunk and
 * makes the page testable with mocked APIs.
 *
 * ── Why the id is validated HERE and passed down as a prop ──────────────────
 * The first version of this page read the route param in the client with
 * useParams, which forced `instant = false` plus a Suspense boundary. Under a
 * partial prerender the static shell is flushed BEFORE the streamed part
 * runs, so a notFound() thrown while streaming cannot change a status code
 * that has already been sent. The result was /profile/2000 answering HTTP 200
 * while /chog/2000 answered 404 for the identical out-of-range id - the
 * branded "No such Chog" card rendered, but the status code said the page was
 * fine, which is exactly what Hark flagged from the live deployment.
 *
 * Validating the id in this server component and handing it to the client as a
 * prop removes the client-side param read altogether. The guard now runs before
 * anything is committed, so out-of-range ids are a real 404 and /profile
 * behaves identically to /chog/[id]. The client keeps its own guard as a
 * defence in depth, but it is no longer load-bearing.
 *
 * No `instant = false`: nothing here touches cookies or runtime data, so the
 * page can be statically generated for every real token id.
 */


export function generateStaticParams() {
  return Array.from({ length: TOTAL_SUPPLY }, (_, i) => ({ id: String(i + 1) }));
}

type ProfileParams = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: ProfileParams): Promise<Metadata> {
  const { id } = await params;
  const chog = getChog(Number(id));
  if (!chog) return { title: 'Chog not found - Chog Mischief' };

  const title = `${chog.name}'s profile - Chog Mischief`;
  const description = `Points, streak, badges, grudges and chaos history for ${chog.name}, Chog Genesis #${chog.tokenId}.`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
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

export default async function ProfilePage({ params }: ProfileParams) {
  const { id } = await params;
  const tokenId = Number(id);

  // Same guard, same wording, as /chog/[id]. Both checks matter: the integer
  // test rejects "abc" and "1.5", the range test rejects 0 and 2000, and
  // getChog returning null covers a missing cache or snapshot.
  if (!Number.isInteger(tokenId) || tokenId < 1 || tokenId > TOTAL_SUPPLY) notFound();
  if (!getChog(tokenId)) notFound();

  return <ProfileClient tokenId={tokenId} />;
}
