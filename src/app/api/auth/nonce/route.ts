/**
 * POST /api/auth/nonce — issue a SIWE nonce for an address.
 *
 * Gasless: the wallet only signs a message. Nothing here touches the chain or
 * costs the user anything.
 */

import { NextResponse } from 'next/server';
import { buildSiweMessage } from '@/lib/siwe';
import { issueNonce } from '@/lib/nonce-store';


const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export async function POST(request: Request) {
  let body: { address?: string };
  try {
    body = (await request.json()) as { address?: string };
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const address = body.address?.trim();
  if (!address || !ADDRESS_RE.test(address)) {
    return NextResponse.json({ error: 'a valid 0x address is required' }, { status: 400 });
  }

  const nonce = await issueNonce(address);
  const { message } = buildSiweMessage({ address, nonce });

  return NextResponse.json({ message, nonce });
}
