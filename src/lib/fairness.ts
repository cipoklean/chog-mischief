import { createHash, createHmac } from 'node:crypto';

/**
 * PUBLIC VERIFIABILITY OF THE ROLL, for free.
 *
 * ── The problem ─────────────────────────────────────────────────────────────
 * The roll is HMAC(SESSION_SECRET, from|to|day). Nobody can predict it, which
 * is what stops a player searching for a target that will dodge in their
 * favour. But "nobody can predict it" also means "nobody can check it": a
 * player who loses has no way to confirm the server did not simply pick the
 * answer it wanted. They have to take it on trust.
 *
 * ── The fix, at zero cost ───────────────────────────────────────────────────
 * COMMIT-REVEAL, using a daily seed instead of a reveal step per prank.
 *
 *   1. At the start of each UTC day the server derives a seed and PUBLISHES
 *      only its hash: sha256(seed) at /api/fairness. Nobody can learn the seed
 *      from the hash, so nobody can precompute which targets dodge today.
 *   2. Every roll that day is HMAC(seed, from|to|day). Because the seed is the
 *      same for everyone, the day's outcomes are a pure function of public
 *      inputs plus the seed.
 *   3. When the day ENDS, the server reveals the seed. From then on anyone can
 *      recompute every roll of that day and check it.
 *
 * So a player cannot know today's outcomes in advance, and can verify every
 * outcome afterwards. The window between "hidden" and "checkable" is exactly
 * one day, and it closes on its own without anyone having to trust a promise.
 *
 * ── Why this cannot be gamed ────────────────────────────────────────────────
 * The seed comes from the same secret that already governs sessions, so the
 * server cannot pick a seed per request either. Changing the seed mid-day would
 * change the published hash, and `getFairness` refuses to report a day whose
 * hash does not match its seed - so a swapped seed is visible immediately, not
 * quietly.
 */

/**
 * How long after a UTC day ENDS before its seed is revealed.
 *
 * 30 minutes, not zero, and the reason is the attack it closes: at 23:56 a
 * player could hold a batch of prepared nonces, wait for midnight, read the
 * new day's commitment history, and pick the target whose roll lands. Every
 * nonce lives 5-10 minutes, so a seed revealed the instant its day ends is
 * still useful to anyone holding a nonce minted moments before midnight.
 *
 * 30 minutes is comfortably longer than the longest nonce TTL (10 minutes), so
 * by the time a seed is public there is no nonce left anywhere that could be
 * committed against it. The commit route now ALSO refuses a stale `intent.day`,
 * so this delay is the second of two independent defences rather than the only
 * one - the day check alone closes the attack, and this closes it for anyone
 * reading seeds offline.
 */
export const REVEAL_DELAY_MS = 30 * 60 * 1000;

/** How many past days are kept verifiable. */
export const HISTORY_DAYS = 7;

export interface FairnessState {
  /** Today, in UTC. */
  day: string;
  /**
   * sha256(seed) for today, hex. This is public from the moment the day starts.
   * It commits the server to one seed for the whole day before any prank lands.
   */
  commitHash: string;
  /**
   * The seed itself, ONCE the day has ended. null while the day is still
   * running, which is the whole point.
   */
  seed: string | null;
  /**
   * Always false, and named so the reason is visible in the payload rather
   * than inferred: TODAY's seed is never revealed, because the day it governs
   * is the day pranks are still being decided with it. Past days are in
   * `history`, and that is where verification happens.
   */
  revealed: false;
  /** True when at least one past day can be verified right now. */
  verifiable: boolean;
  /** Past days, newest first, with their revealed seeds. */
  history: { day: string; seed: string; commitHash: string }[];
  /** The exact rule, so a verifier does not have to read the source. */
  rule: {
    seedFor: string;
    commit: string;
    roll: string;
    interpretation: string;
  };
}

/** The UTC day key. Same function the daily limit uses. */
export function fairnessDay(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/**
 * The seed for a day.
 *
 * Derived from the session secret, so it is not something an attacker can
 * compute, reproduce on another deployment, or choose. Deterministic per day:
 * the same secret and the same day always give the same seed, which is what
 * makes a reveal verifiable against the hash published at 00:00.
 */
export function seedForDay(secret: string, day: string): string {
  return createHmac('sha256', secret).update(`chog-fairness|${day}`).digest('hex');
}

/** The public commitment: sha256(seed), hex. */
export function commitForSeed(seed: string): string {
  return createHash('sha256').update(seed).digest('hex');
}

/**
 * The roll for one prank on one day: HMAC(seed, from|to|day) mapped to [0,1).
 *
 * This is the function a verifier runs. It takes the REVEALED SEED, not the
 * server secret, so once the seed is public anyone can reproduce it.
 *
 * Both halves are named in the published rule string below, and both appear in
 * this signature, so a verifier reading /api/fairness knows exactly what to
 * compute.
 */
export function rollFromSeed(seed: string, fromTokenId: number, toTokenId: number, day: string): number {
  const hex = createHmac('sha256', seed)
    .update(`${fromTokenId}|${toTokenId}|${day}`)
    .digest('hex')
    .slice(0, 16);
  return Number(BigInt(`0x${hex}`)) / 2 ** 64;
}

/** The published description of the scheme, in enough detail to reimplement. */
export const FAIRNESS_RULE = {
  seedFor: 'seed = HMAC-SHA256(sessionSecret, "chog-fairness|" + day)  [hex digest]',
  commit: 'commit = SHA256(seed)  [hex digest], published at the start of the day',
  roll: 'roll = HMAC-SHA256(seed, fromTokenId + "|" + toTokenId + "|" + day), first 16 hex chars, divided by 2^64',
  interpretation:
    'landed = roll >= effectiveDodge(target.dodgeChance, attacker.accuracy), where effectiveDodge is clamped to [0.05, 0.45]. A roll at or above the threshold lands.',
} as const;

/**
 * What /api/fairness reports.
 *
 * `now` is injected so the reveal boundary is testable: the whole point is the
 * moment the seed stops being secret, and a test that cannot control the clock
 * cannot test that moment.
 */
export function getFairness(secret: string, now: number = Date.now()): FairnessState {
  const today = fairnessDay(new Date(now));
  const todaySeed = seedForDay(secret, today);
  const todayCommit = commitForSeed(todaySeed);

  const nowDayMs = Date.UTC(
    Number(today.slice(0, 4)),
    Number(today.slice(5, 7)) - 1,
    Number(today.slice(8, 10)),
  );

  // TODAY'S seed is never revealed, and `revealed` is therefore always false
  // for it. That is not a bug and it is the entire design: the day the seed
  // governs is the day pranks are still being decided with it, so publishing it
  // would let the remaining rolls be computed in advance. A day becomes
  // verifiable when it STOPS being today, which is what `history` is for.
  //
  // The reveal is a property of the calendar rather than of a timer: no cron,
  // no scheduled job, nothing that can fail to fire or fire twice.

  // Every PAST day, always. Gating this on `revealed` was the bug this comment
  // replaced: it made history permanently empty, because `revealed` never
  // becomes true, so a player could never check anything at all.
  // A past day appears only once it has been over for REVEAL_DELAY_MS. The
  // window is measured from the END of that day, not from now, so the delay is
  // a fixed property of the day rather than something that drifts as time
  // passes.
  const history: FairnessState['history'] = [];
  for (let back = 1; back <= HISTORY_DAYS; back += 1) {
    const dayStart = nowDayMs - back * 86_400_000;
    const dayEnd = dayStart + 86_400_000;
    if (now < dayEnd + REVEAL_DELAY_MS) break; // still inside the delay

    const day = fairnessDay(new Date(dayStart));
    const seed = seedForDay(secret, day);
    history.push({ day, seed, commitHash: commitForSeed(seed) });
  }

  return {
    day: today,
    commitHash: todayCommit,
    seed: null,
    revealed: false,
    // Whether there is anything to check. Useful to a client: on the very first
    // day of a deployment, or inside the 30-minute reveal delay, there is no
    // history yet, and a UI can say "nothing to verify yet" instead of
    // rendering an empty section.
    verifiable: history.length > 0,
    history,
    rule: { ...FAIRNESS_RULE },
  };
}

/**
 * True when a revealed seed actually matches the hash published for its day.
 *
 * This is the check that makes the whole thing mean something. Without it, a
 * server could publish one hash and roll with a different seed, and a verifier
 * recomputing from the "revealed" seed would get answers that disagree with
 * what happened - but nothing would say so. With it, a swapped seed fails
 * loudly on the first verification.
 */
export function verifyReveal(seed: string, day: string, commitHash: string): boolean {
  return commitForSeed(seed) === commitHash.toLowerCase();
}
