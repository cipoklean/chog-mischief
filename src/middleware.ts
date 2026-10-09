import { NextResponse, type NextRequest } from 'next/server';

/**
 * Middleware - exactly one job: make /profile redirect to the active Chog.
 *
 * ── Why this is middleware and not a server component ───────────────────────
 * The first version of /profile read the session cookie and called
 * redirect() in a server component. It built cleanly, and then served
 * HTTP 200 with a `__next_error__` body instead of redirecting, because
 * `cacheComponents: true` turns every route into a partial prerender: the
 * static shell is flushed FIRST, so the status line is already committed by
 * the time a streamed `redirect()` throws. The response carried
 * `x-nextjs-postponed: 1` and HTTP 200 - a browser lands on an error page and
 * never reaches /pick.
 *
 * A redirect is not a streamed value, so it cannot be produced from inside a
 * prerendered shell. It has to be issued by something that runs BEFORE any
 * HTML is committed. That is the middleware, and it is the only correct seam.
 *
 * ── WebCrypto, not node:crypto ─────────────────────────────────────────────
 * Middleware runs in the Edge runtime, where `node:crypto` is unavailable and
 * importing it fails the build outright ("A Node.js module is loaded
 * ('node:crypto') which is not supported in the Edge Runtime"). WebCrypto is
 * async, which is why this flow is async, and it exists in every runtime this
 * app uses, so the code does not have to care which one it landed in.
 *
 * ── The session check is duplicated, deliberately ───────────────────────────
 * `verifySession` lives in lib/siwe, which imports viem - fine in a server
 * component, far too heavy for middleware, which runs on every matched
 * request. So the HMAC is verified here directly: same algorithm, same
 * base64url encoding, same constant-time compare, so the two can never
 * disagree about who is signed in. If this ever drifts from `verifySession`,
 * the failure mode is safe: this only chooses WHICH profile to show, and
 * /profile/<id> re-checks the session itself before showing any record. A
 * wrong choice here leaks nothing the target page would not already refuse.
 */

const SESSION_COOKIE = 'chog_session';

/** The one path this middleware touches. */
const PROFILE_ROOT = '/profile';

/** Chog Genesis is exactly 1,969 tokens; mirrors CHOG_TOTAL_SUPPLY. */
const TOTAL_SUPPLY = 1969;

/**
 * Not `/profile/<id>`: those are real pages and must pass through untouched.
 * Exact string comparison, not startsWith, so a Chog profile can never be
 * hijacked into a redirect loop.
 */
function isProfileRoot(pathname: string): boolean {
  return pathname === PROFILE_ROOT || pathname === `${PROFILE_ROOT}/`;
}

/** base64url without padding - the encoding signSession uses on both halves. */
function base64urlFromBytes(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** base64url -> bytes, for decoding the payload body. */
function bytesFromBase64url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * The first held token id, or null when there is no verifiable session.
 *
 * Checks the MAC and the expiry. It deliberately does NOT re-check that the
 * wallet still holds the tokens: that happens in /api/prank/prepare and
 * /api/prank/commit against live chain state, and duplicating an RPC call on
 * every navigation would be slower for no extra safety.
 */
async function activeChogId(
  cookieValue: string | undefined,
  secret: string,
): Promise<number | null> {
  if (!cookieValue) return null;

  const dot = cookieValue.lastIndexOf('.');
  if (dot <= 0) return null;

  const body = cookieValue.slice(0, dot);
  const mac = cookieValue.slice(dot + 1);

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)),
  );

  // Constant-time compare, matching lib/siwe: a timing-safe equality stops an
  // attacker discovering the MAC one byte at a time.
  if (!constantTimeEqual(mac, base64urlFromBytes(signature))) return null;

  try {
    const payload = JSON.parse(new TextDecoder().decode(bytesFromBase64url(body))) as {
      tokenIds?: unknown;
      expiresAt?: unknown;
    };

    if (typeof payload.expiresAt !== 'number' || payload.expiresAt <= Date.now()) return null;
    if (!Array.isArray(payload.tokenIds)) return null;

    for (const id of payload.tokenIds) {
      if (typeof id === 'number' && Number.isInteger(id) && id >= 1 && id <= TOTAL_SUPPLY) {
        return id;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/** Length-independent, content constant-time. */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  if (!isProfileRoot(request.nextUrl.pathname)) return NextResponse.next();

  const secret = process.env.SESSION_SECRET?.trim();
  // No secret means no verifiable session, so there is no active Chog. /pick
  // is where a viewer without one belongs, and it explains what to do next.
  const id = secret ? await activeChogId(request.cookies.get(SESSION_COOKIE)?.value, secret) : null;

  const destination = id === null ? '/pick' : `/profile/${id}`;
  // 307, not 302: a real redirect the browser follows before rendering
  // anything, with the method preserved.
  return NextResponse.redirect(new URL(destination, request.url), 307);
}

export const config = {
  /**
   * Only /profile, matched exactly. A broad matcher would run an HMAC on every
   * image and stylesheet request, and a prefix matcher would swallow all 1,969
   * Chog profile pages into the redirect.
   */
  matcher: ['/profile'],
};
