/**
 * GET /api/auth/session - who am I, and which Chogs do I hold?
 *
 * Reads the signed session cookie and returns the address plus the token ids
 * it was issued for. No chain read: the session is short-lived and the ids
 * were verified at sign-in.
 *
 * The `chogs` array is the full meta (name, art, TRAITS) for the held ids,
 * read from the harvested cache. The prank flow needs the traits to build
 * the player's unlocked prank pool, and the UI needs the names and art -
 * one round trip instead of N. The traits are public on-chain data (the
 * /chog/<id> pages already show them), so nothing private travels here.
 */

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifySession } from '@/lib/siwe';
import { getChog } from '@/lib/chogs';

const SESSION_COOKIE = 'chog_session';

export async function GET() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return NextResponse.json({ authenticated: false });

  const jar = await cookies();
  const session = verifySession(jar.get(SESSION_COOKIE)?.value, secret);

  if (!session) return NextResponse.json({ authenticated: false });

  const chogs = session.tokenIds
    .map((id) => getChog(id))
    .filter((c): c is NonNullable<typeof c> => c !== null)
    .map((c) => ({
      tokenId: c.tokenId,
      name: c.name,
      imageUrl: c.imageUrl,
      traits: c.traits,
    }));

  return NextResponse.json({
    authenticated: true,
    address: session.address,
    tokenIds: session.tokenIds,
    chogs,
  });
}
