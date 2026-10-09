import { db } from '@/lib/db';
import { commitForSeed, seedForDay } from './fairness';

/**
 * DURABLE FAIRNESS COMMITMENTS.
 *
 * ── The problem this fixes ──────────────────────────────────────────────────
 * `getFairness` used to recompute `sha256(seed)` from SESSION_SECRET on every
 * request. Recomputing is not committing. If the secret is ever rotated, every
 * hash the endpoint ever served silently changes, along with every seed behind
 * it, and nothing records what was promised on any past day. A player who
 * stored yesterday's hash would find their stored value no longer appears
 * anywhere, with no way to tell whether they had misremembered or the server
 * had moved.
 *
 * ── The fix ─────────────────────────────────────────────────────────────────
 * A row per UTC day, written once. Reading serves the STORED hash, never a
 * freshly derived one. First write wins: the insert is `ON CONFLICT DO
 * NOTHING`, so two servers racing on the same day cannot produce two different
 * commitments, and a second writer cannot overwrite the first.
 *
 * The table has no UPDATE or DELETE policy, so with RLS on the anon and
 * authenticated roles cannot rewrite a commitment at all. All legitimate writes
 * go through the service role.
 *
 * ── What happens after a secret rotation ────────────────────────────────────
 * The right answer is that a rotation invalidates fairness retroactively, and
 * this module says so out loud rather than papering over it: if the derived
 * hash for a day disagrees with the stored one, that day is reported as
 * unverifiable and `/api/chaos`... rather, the commit route REFUSES to roll,
 * because a roll computed under a rotated secret could never be checked
 * against the commitment that was published for it. See `assertCommitment`.
 *
 * Reads degrade gracefully: if the table is missing (a fresh project that has
 * not run the migration) the derived hash is returned and `stored` is false, so
 * the app works before the migration without pretending the value is durable.
 */

export interface CommitmentRecord {
  day: string;
  commitHash: string;
  /** True when the value came from the table rather than being derived. */
  stored: boolean;
  /**
   * Why `stored` is false, when it is. `'not-yet-written'` is a normal first
   * request of a day; anything else is a fault worth logging loudly.
   */
  degraded?: 'table-missing' | 'read-failed' | 'not-yet-written';
}

/**
 * The commitment for one day, stored on first request and served thereafter.
 *
 * Never throws: a database outage must not take /api/fairness down, so a failed
 * read falls back to the derived hash and says so.
 */
export async function commitmentFor(secret: string, day: string): Promise<CommitmentRecord> {
  const derived = commitForSeed(seedForDay(secret, day));

  try {
    const supabase = db();

    // First write wins. DO NOTHING on conflict means a second concurrent
    // request cannot overwrite the value the first one published.
    const { error: insertError } = await supabase
      .from('daily_commits')
      .insert({ day, commit_hash: derived })
      .select('commit_hash');

    // A conflict surfaces as an error under some PostgREST configurations; that
    // is fine and expected on the second request of a day, so it is not fatal.
    if (insertError && !/duplicate|conflict/i.test(insertError.message)) {
      console.error('[fairness] could not record the commitment:', insertError.message);
    }

    const { data, error: readError } = await supabase
      .from('daily_commits')
      .select('commit_hash')
      .eq('day', day)
      .maybeSingle();

    if (readError) {
      // FALLING BACK TO THE DERIVED HASH. A read failure must not stop a
      // player from pranking, so this fails open deliberately - but at error
      // level and with the reason recorded, because a table that cannot be read
      // is a fault and one that has gone missing is a deployment gap that needs
      // a migration. `degraded` is what /api/health surfaces.
      console.error('[fairness] could not read the commitment:', readError.message);
      return { day, commitHash: derived, stored: false, degraded: 'read-failed' };
    }

    // The STORED value wins, always. If it disagrees with what this server
    // derives, the stored one is what was actually published and is what a
    // player holds - so it is served unchanged and the disagreement is
    // surfaced by the commit route rather than silently reconciled here.
    if (data?.commit_hash) {
      return { day, commitHash: String(data.commit_hash), stored: true };
    }

    return { day, commitHash: derived, stored: false, degraded: 'table-missing' };
  } catch (error) {
    console.error('[fairness] commitment store unavailable:', error);
    return { day, commitHash: derived, stored: false, degraded: 'table-missing' };
  }
}

export interface CommitmentCheck {
  ok: boolean;
  day: string;
  /** The published hash, from the store. */
  published: string;
  /** What this server derives right now. */
  derived: string;
  reason?: string;
  /** Set when the store could not be read and the check failed OPEN. */
  degraded?: 'table-missing' | 'read-failed' | 'not-yet-written';
}

/**
 * Assert that this server's derived commitment for `day` matches what was
 * published, before a roll is decided with it.
 *
 * This is the check that makes the commitment mean something. Without it, a
 * rotated secret would produce rolls that no player could ever verify against
 * the hash the endpoint published that morning, and the app would not know.
 * With it, the server refuses to roll rather than producing an unverifiable
 * result.
 *
 * A missing row is NOT a failure: it means the migration has not been applied
 * yet, which is a deployment state rather than a tampering signal. The derived
 * value is then the only thing there is, and the caller is told.
 */
export async function assertCommitment(
  secret: string,
  day: string,
): Promise<CommitmentCheck> {
  const { commitHash: published, stored, degraded } = await commitmentFor(secret, day);
  const derived = commitForSeed(seedForDay(secret, day));

  if (!stored) {
    // Failing OPEN, on purpose. A missing table is a deployment state, not
    // tampering, and refusing to roll would take the game down for every player
    // over a gap that the derived hash still answers honestly.
    //
    // But 'read-failed' means the table exists and could not be read, which is
    // a fault rather than a gap - so it is logged at error level and the reason
    // is carried out to /api/health.
    const reason =
      'no stored commitment for this day; using the derived hash';
    if (degraded === 'read-failed') {
      console.error(`[fairness] ${day}: ${reason} - the table exists but could not be read.`);
    }
    return { ok: true, day, published: derived, derived, reason, degraded };
  }

  if (published.toLowerCase() !== derived.toLowerCase()) {
    return {
      ok: false,
      day,
      published,
      derived,
      reason:
        'the stored commitment for this day does not match the current session secret, ' +
        'so any roll decided now would be unverifiable against what was published',
    };
  }

  return { ok: true, day, published, derived };
}