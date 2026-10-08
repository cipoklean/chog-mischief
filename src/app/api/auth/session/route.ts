/**
 * GET /api/auth/session — who am I?
 *
 * Reads the signed session cookie and returns the address plus the token ids it
 * was issued for. No chain read: the session is short-lived and the ids were
 * verified at sign-in.
 */

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifySession } from '@/lib/siwe';


const SESSION_COOKIE = 'chog_session';

export async function GET() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return NextResponse.json({ authenticated: false });

  const jar = await cookies();
  const session = verifySession(jar.get(SESSION_COOKIE)?.value, secret);

  if (!session) return NextResponse.json({ authenticated: false });

  return NextResponse.json({
    authenticated: true,
    address: session.address,
    tokenIds: session.tokenIds,
  });
}
