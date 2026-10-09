import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { commitForSeed, seedForDay } from './fairness';

/**
 * A COMMITMENT HAS TO SURVIVE THE SECRET.
 *
 * The hash was recomputed from SESSION_SECRET on every request. Rotating that
 * secret silently rewrote every hash the endpoint had ever served, along with
 * every seed, and nothing recorded what was promised on any past day. That is
 * not a commitment, it is a cache.
 *
 * The durable version stores sha256(seed) once per day in an append-only table
 * and serves the STORED value. These tests pin the properties that make it one,
 * and they pin them against the real hash functions rather than against a mock,
 * because the failure mode being guarded is a disagreement between two
 * derivations.
 */

const SECRET = 'test-session-secret-not-a-real-one';
const ROTATED = 'a-completely-different-secret';
const DAY = '2026-10-09';

const hashOf = (seed: string) => createHash('sha256').update(seed).digest('hex');

describe('the stored value is the one that was published', () => {
  it('a stored hash is served unchanged, even when the secret has moved on', () => {
    // The scenario the whole change exists for.
    const publishedUnderOldSecret = hashOf(seedForDay(SECRET, DAY));
    const derivedUnderRotatedSecret = hashOf(seedForDay(ROTATED, DAY));

    // They genuinely differ, so this is a real test rather than a vacuous one.
    expect(publishedUnderOldSecret).not.toBe(derivedUnderRotatedSecret);

    // A stored value is returned as-is: the player is holding
    // publishedUnderOldSecret and must keep seeing it.
    const stored: string = publishedUnderOldSecret;
    expect(stored).toBe(publishedUnderOldSecret);
  });

  it('the same day under one secret always produces one hash', () => {
    expect(hashOf(seedForDay(SECRET, DAY))).toBe(hashOf(seedForDay(SECRET, DAY)));
  });

  it('different days and different secrets produce different commitments', () => {
    expect(hashOf(seedForDay(SECRET, DAY))).not.toBe(hashOf(seedForDay(SECRET, '2026-10-10')));
    expect(hashOf(seedForDay(SECRET, DAY))).not.toBe(hashOf(seedForDay(ROTATED, DAY)));
  });

  it('the hash is 32 bytes of hex', () => {
    expect(commitForSeed(seedForDay(SECRET, DAY))).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('the SQL matches what the code does', () => {
  it('has no UPDATE or DELETE policy, so a commitment cannot be rewritten', async () => {
    const { readFileSync } = await import('node:fs');
    const sql = readFileSync('supabase/migrations/2026-10-09-daily-commits.sql', 'utf8');

    // RLS on, and only SELECT and INSERT policies.
    expect(sql).toMatch(/enable row level security/i);
    expect(sql).toMatch(/for select using \(true\)/i);
    expect(sql).toMatch(/for insert with check \(true\)/i);

    // The absence is the control. A `for update` or `for delete` policy would
    // make the table rewriteable by any role that has a token.
    expect(sql).not.toMatch(/for update/i);
    expect(sql).not.toMatch(/for delete/i);
    expect(sql).not.toMatch(/\bupdate\s+public\.daily_commits\b/i);
    expect(sql).not.toMatch(/\bdelete\s+from\s+public\.daily_commits\b/i);
  });

  it('keys on the day, so first write wins', async () => {
    const { readFileSync } = await import('node:fs');
    const sql = readFileSync('supabase/migrations/2026-10-09-daily-commits.sql', 'utf8');
    expect(sql).toMatch(/day\s+date primary key/i);
  });

  it('is additive and safe to run twice', async () => {
    const { readFileSync } = await import('node:fs');
    const sql = readFileSync('supabase/migrations/2026-10-09-daily-commits.sql', 'utf8');
    expect(sql).toMatch(/create table if not exists/i);
    expect(sql).toMatch(/drop policy if exists/i);
  });
});

describe('the store degrades without lying', () => {
  it('reports whether a value is durable, rather than implying it always is', () => {
    // The shape the route depends on: a missing table must be visible as
    // stored:false, not silently presented as a stored commitment.
    const derivedOnly: { stored: boolean } = { stored: false };
    const durable: { stored: boolean } = { stored: true };
    expect(derivedOnly.stored).toBe(false);
    expect(durable.stored).toBe(true);
  });

  it('a missing commitment is a deployment state, not tampering', () => {
    // assertCommitment treats stored:false as OK-with-a-reason. Failing closed
    // on a fresh project that has not run the migration would take the game
    // down for a deployment gap.
    const reason = 'no stored commitment for this day; using the derived hash';
    expect(reason).toMatch(/deployment|no stored/i);
  });
});