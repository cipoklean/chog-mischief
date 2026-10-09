import { connection } from 'next/server';
import { NextResponse } from 'next/server';
import { getFairness } from '@/lib/fairness';
import { commitmentFor } from '@/lib/fairness-store';
import { commitForSeed, seedForDay } from '@/lib/fairness';

/**
 * GET /api/fairness - the public commitment to today's rolls.
 *
 * Serves three things:
 *
 *   1. TODAY'S COMMITMENT: sha256(seed) for the current UTC day, published from
 *      the moment the day starts. A player can store it now and check later that
 *      the seed the server reveals really is the one it committed to.
 *   2. THE SEED, once the day has ended. Before that it is `null`, and the day
 *      is not over yet - that is the design, not a gap.
 *   3. THE RULE, spelled out in enough detail to reimplement: how the seed is
 *      derived, how the commitment is formed, how the roll is computed from the
 *      seed, and how the roll maps to a hit. A verifier should not have to read
 *      this project's source to check it.
 *
 * Public and unauthenticated by design: the whole point is that anyone can
 * check. It exposes no secret - while the day runs, the response contains only
 * a hash, and after it ends the seed is public by design. The session secret
 * itself never appears in any branch.
 *
 * `no-store` is essential. A cached copy from earlier in the day would show a
 * seed that is still secret, which would break the guarantee this endpoint
 * exists to make.
 */
export async function GET() {
  await connection();

  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: 'fairness is not configured' },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    );
  }

  const state = getFairness(secret);

  // Serve the STORED commitment for today, not a freshly derived one. The two
  // are identical while the secret is unchanged; if it has been rotated they
  // differ, and the stored value is what a player is holding, so it is what
  // goes out. A mismatch is reported rather than hidden.
  const today = await commitmentFor(secret, state.day);
  const derived = commitForSeed(seedForDay(secret, state.day));

  return NextResponse.json(
    {
      ...state,
      commitHash: today.commitHash,
      durable: today.stored,
      ...(today.stored && today.commitHash.toLowerCase() !== derived.toLowerCase()
        ? { mismatch: true }
        : {}),
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}
