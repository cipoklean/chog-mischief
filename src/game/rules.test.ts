import { beforeEach, describe, expect, it } from 'vitest';
import { powersFor } from './powers';
import {
  Badge,
  DAILY_PRANKS_PER_TOKEN,
  GameState,
  MAX_ACTIVE_OVERLAYS,
  MOST_WANTED_DISTINCT_ATTACKERS,
  NONCE_TTL_MS,
  PrankInput,
  REVENGE_MULTIPLIER,
  REVENGE_WINDOW_MS,
  UNTOUCHABLE_DODGE_STREAK,
  activeOverlays,
  addOverlay,
  applyClean,
  applyPrank,
  burnNonce,
  canRevenge,
  canUsePrank,
  dayFor,
  daysBetween,
  emptyState,
  hasPrankedToday,
  pointsFor,
  pranksUsedToday,
  revengeTarget,
  revengeWindowRemaining,
  stateForToken,
  totalPointsDealt,
  validateNonce,
  validatePrank,
  weekFor,
} from './rules';

// Fixed instants so every test is deterministic. 2026-10-08 is a Thursday.
const T0 = Date.parse('2026-10-08T12:00:00Z');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

let state: GameState;

beforeEach(() => {
  state = emptyState();
});

function prank(over: Partial<PrankInput> = {}): PrankInput {
  return {
    fromTokenId: 1,
    toTokenId: 2,
    prankId: 'slime',
    prankRarity: 'common',
    attackerMaxRarity: 'common',
    landed: true,
    basePoints: 10,
    revenge: false,
    now: T0,
    knownTokens: new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]),
    ...over,
  };
}

// ---------------------------------------------------------------------------

describe('UTC day and week keys', () => {
  it('buckets by UTC day', () => {
    expect(dayFor(Date.parse('2026-10-08T23:59:59Z'))).toBe('2026-10-08');
    expect(dayFor(Date.parse('2026-10-09T00:00:00Z'))).toBe('2026-10-09');
  });

  it('buckets the week by its Monday', () => {
    expect(weekFor(T0)).toBe('2026-10-05');
    expect(weekFor(Date.parse('2026-10-11T23:00:00Z'))).toBe('2026-10-05');
    expect(weekFor(Date.parse('2026-10-12T00:00:00Z'))).toBe('2026-10-12');
  });

  it('counts whole days between keys', () => {
    expect(daysBetween('2026-10-08', '2026-10-09')).toBe(1);
    expect(daysBetween('2026-10-08', '2026-10-11')).toBe(3);
    expect(daysBetween('2026-10-08', '2026-10-08')).toBe(0);
  });
});

// ---------------------------------------------------------------------------

describe('daily limit: one prank per TOKEN per day', () => {
  it('starts with an allowance', () => {
    expect(hasPrankedToday(state, 1, T0)).toBe(false);
    expect(pranksUsedToday(state, 1, T0)).toBe(0);
  });

  it('spends the allowance after one prank', () => {
    const r = applyPrank(state, prank());
    expect(r.ok).toBe(true);
    expect(hasPrankedToday(r.ok ? r.value.state : state, 1, T0)).toBe(true);
  });

  it('refuses a second prank by the same token on the same day', () => {
    const first = applyPrank(state, prank({ toTokenId: 3 }));
    const next = validatePrank(first.ok ? first.value.state : state, prank({ toTokenId: 4 }));
    expect(next.ok).toBe(false);
    if (!next.ok) expect(next.refusal).toBe('ALREADY_PRANKED_TODAY');
  });

  it('is per token, not per wallet: a different token may prank the same day', () => {
    const first = applyPrank(state, prank());
    const second = validatePrank(first.ok ? first.value.state : state, prank({ fromTokenId: 5 }));
    expect(second.ok).toBe(true);
  });

  it('resets at 00:00 UTC', () => {
    const first = applyPrank(state, prank());
    const after = first.ok ? first.value.state : state;
    expect(hasPrankedToday(after, 1, Date.parse('2026-10-08T23:59:59Z'))).toBe(true);
    expect(hasPrankedToday(after, 1, Date.parse('2026-10-09T00:00:00Z'))).toBe(false);
  });

  it('counts a DODGED prank against the limit - a real attempt, not a free retry', () => {
    const dodged = applyPrank(state, prank({ landed: false }));
    const after = dodged.ok ? dodged.value.state : state;
    expect(hasPrankedToday(after, 1, T0)).toBe(true);
    expect(validatePrank(after, prank({ toTokenId: 3 })).ok).toBe(false);
  });

  it('exposes exactly one prank per day as the configured limit', () => {
    expect(DAILY_PRANKS_PER_TOKEN).toBe(1);
  });
});

// ---------------------------------------------------------------------------

describe('prank targeting rules', () => {
  it('refuses self-prank', () => {
    const r = validatePrank(state, prank({ toTokenId: 1 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refusal).toBe('SELF_PRANK');
  });

  it('refuses a Chog held in the same wallet', () => {
    const walletOf = (t: number) => (t === 1 || t === 2 ? '0xabc' : `0xdef${t}`);
    const r = validatePrank(state, prank({ walletOf }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refusal).toBe('SAME_WALLET');
  });

  it('allows a target in a different wallet', () => {
    const walletOf = (t: number) => `0x${t}`;
    expect(validatePrank(state, prank({ walletOf })).ok).toBe(true);
  });

  it('refuses an unknown token id', () => {
    const r = validatePrank(state, prank({ toTokenId: 9999 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refusal).toBe('TOKEN_NOT_FOUND');
  });

  it('refuses a prank rarer than what the attacker tier allows', () => {
    const r = validatePrank(
      state,
      prank({ prankRarity: 'legendary', attackerMaxRarity: 'common' }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refusal).toBe('PRANK_NOT_ALLOWED_FOR_TIER');
  });

  it('allows a prank at or below the tier ceiling', () => {
    expect(canUsePrank('common', 'common')).toBe(true);
    expect(canUsePrank('rare', 'rare')).toBe(true);
    expect(canUsePrank('common', 'legendary')).toBe(true);
    expect(canUsePrank('legendary', 'rare')).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('points and multipliers', () => {
  it('is worth the base points on a cold streak', () => {
    expect(pointsFor(10, 0, false)).toBe(10);
  });

  it('scales with the streak', () => {
    expect(pointsFor(10, 1, false)).toBe(10);
    expect(pointsFor(10, 2, false)).toBe(20);
    expect(pointsFor(10, 3, false)).toBe(30);
  });

  it('caps the streak multiplier at 3x', () => {
    expect(pointsFor(10, 4, false)).toBe(30);
    expect(pointsFor(10, 99, false)).toBe(30);
  });

  it('doubles for a revenge', () => {
    expect(pointsFor(10, 0, true)).toBe(20);
    expect(pointsFor(10, 2, true)).toBe(40);
    expect(REVENGE_MULTIPLIER).toBe(2);
  });

  it('awards nothing for a dodged prank', () => {
    const r = applyPrank(state, prank({ landed: false }));
    expect(r.ok && r.value.record.points).toBe(0);
  });

  it('uses the streak BEFORE this prank, so the first of a streak is 1x', () => {
    const day1 = applyPrank(state, prank({ now: Date.parse('2026-10-05T12:00:00Z') }));
    const s1 = day1.ok ? day1.value.state : state;
    const day2 = applyPrank(s1, prank({ now: Date.parse('2026-10-06T12:00:00Z') }));
    expect(day2.ok && day2.value.record.points).toBe(10); // streak was 1 -> 1x
    const s2 = day2.ok ? day2.value.state : s1;
    const day3 = applyPrank(s2, prank({ now: Date.parse('2026-10-07T12:00:00Z') }));
    expect(day3.ok && day3.value.record.points).toBe(20); // streak was 2 -> 2x
  });
});

// ---------------------------------------------------------------------------

describe('streaks', () => {
  it('starts at 1 on the first prank', () => {
    const r = applyPrank(state, prank());
    expect(r.ok && r.value.streak.currentStreak).toBe(1);
  });

  it('advances on consecutive UTC days', () => {
    let s = state;
    for (const [i, d] of ['2026-10-05', '2026-10-06', '2026-10-07'].entries()) {
      const r = applyPrank(s, prank({ now: Date.parse(`${d}T12:00:00Z`) }));
      if (r.ok) {
        s = r.value.state;
        expect(r.value.streak.currentStreak).toBe(i + 1);
      }
    }
  });

  it('resets to 1 when a day is missed', () => {
    const a = applyPrank(state, prank({ now: Date.parse('2026-10-05T12:00:00Z') }));
    const s1 = a.ok ? a.value.state : state;
    // Skip 2026-10-06 entirely.
    const b = applyPrank(s1, prank({ now: Date.parse('2026-10-07T12:00:00Z') }));
    expect(b.ok && b.value.streak.currentStreak).toBe(1);
  });

  it('never lets the multiplier exceed 3x even over a long streak', () => {
    let s = state;
    for (let d = 0; d < 10; d++) {
      const now = Date.parse('2026-10-01T12:00:00Z') + d * DAY;
      const r = applyPrank(s, prank({ now }));
      if (r.ok) s = r.value.state;
    }
    const last = s.pranks[s.pranks.length - 1];
    expect(last.points).toBe(30); // 10 base x 3x cap
  });

  it('tracks the longest streak separately from the current one', () => {
    let s = state;
    const days = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-12', '2026-10-13'];
    for (const d of days) {
      const r = applyPrank(s, prank({ now: Date.parse(`${d}T12:00:00Z`) }));
      if (r.ok) s = r.value.state;
    }
    const st = s.streaks[1];
    expect(st.currentStreak).toBe(2);
    expect(st.longestStreak).toBe(3);
  });
});

// ---------------------------------------------------------------------------

describe('overlays: max 3, the 4th replaces the oldest', () => {
  it('adds an overlay for a landed prank', () => {
    const r = applyPrank(state, prank());
    expect(r.ok && activeOverlays(r.value.state.overlays, 2)).toHaveLength(1);
  });

  it('adds no overlay for a dodged prank', () => {
    const r = applyPrank(state, prank({ landed: false }));
    expect(r.ok && r.value.state.overlays).toHaveLength(0);
  });

  it('caps at 3 and drops the oldest', () => {
    let ov = [] as ReturnType<typeof addOverlay>;
    for (let i = 0; i < 5; i++) {
      ov = addOverlay(ov, 2, `p${i}`, `cap ${i}`, T0 + i * 1000);
    }
    const active = activeOverlays(ov, 2);
    expect(active).toHaveLength(MAX_ACTIVE_OVERLAYS);
    expect(active.map((o) => o.prankId)).toEqual(['p2', 'p3', 'p4']);
  });

  it('caps overlays per victim, not globally', () => {
    // #1 hits #2 on four separate days: #2 must end up capped at 3 overlays.
    // #1 also hits #3 twice on other days: #3 keeps its own 2.
    let s = emptyState();
    const known = new Set([1, 2, 3, 4]);
    for (let d = 0; d < 4; d++) {
      const r = applyPrank(s, prank({ toTokenId: 2, now: T0 + d * DAY, knownTokens: known }));
      expect(r.ok).toBe(true);
      if (r.ok) s = r.value.state;
    }
    const a = applyPrank(s, prank({ toTokenId: 3, now: T0 + 4 * DAY, knownTokens: known }));
    s = a.ok ? a.value.state : s;
    const b = applyPrank(s, prank({ toTokenId: 3, now: T0 + 5 * DAY, knownTokens: known }));
    s = b.ok ? b.value.state : s;

    expect(activeOverlays(s.overlays, 2)).toHaveLength(MAX_ACTIVE_OVERLAYS); // capped at 3
    expect(activeOverlays(s.overlays, 3)).toHaveLength(2); // its own count, untouched
    expect(s.overlays).toHaveLength(MAX_ACTIVE_OVERLAYS + 2); // per-token, not global
  });

  it('caps the caption with both token ids', () => {
    const r = applyPrank(state, prank());
    const caption = r.ok ? r.value.state.overlays[0].caption : '';
    expect(caption).toContain('#2');
    expect(caption).toContain('#1');
    expect(caption).toContain('slime');
  });
});

// ---------------------------------------------------------------------------

describe('cleans', () => {
  function cleanable(): { state: GameState; prankId: string } {
    const r = applyPrank(state, prank());
    const s = r.ok ? r.value.state : state;
    return { state: s, prankId: r.ok ? r.value.record.id : '' };
  }

  it('removes the overlay it targets', () => {
    const { state: s, prankId } = cleanable();
    const r = applyClean(s, { tokenId: 2, prankRecordId: prankId, now: T0 + HOUR });
    expect(r.ok).toBe(true);
    if (r.ok) expect(activeOverlays(r.value.state.overlays, 2)).toHaveLength(0);
  });

  it('refuses a second clean on the same day', () => {
    const { state: s, prankId } = cleanable();
    const first = applyClean(s, { tokenId: 2, prankRecordId: prankId, now: T0 + HOUR });
    const s2 = first.ok ? first.value.state : s;
    const second = applyClean(s2, { tokenId: 2, prankRecordId: prankId, now: T0 + 2 * HOUR });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.refusal).toBe('ALREADY_CLEANED_TODAY');
  });

  it('allows a clean on the next UTC day', () => {
    const { state: s, prankId } = cleanable();
    const r = applyClean(s, {
      tokenId: 2,
      prankRecordId: prankId,
      now: Date.parse('2026-10-09T12:00:00Z'),
    });
    expect(r.ok).toBe(true);
  });

  it('refuses when there is no such overlay', () => {
    const r = applyClean(state, { tokenId: 2, prankRecordId: 'nope', now: T0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refusal).toBe('NO_OVERLAY_TO_CLEAN');
  });

  it('refuses to clean an overlay belonging to another Chog', () => {
    const { state: s, prankId } = cleanable();
    const r = applyClean(s, { tokenId: 99, prankRecordId: prankId, now: T0 + HOUR });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refusal).toBe('NO_OVERLAY_TO_CLEAN');
  });
});

// ---------------------------------------------------------------------------

describe('revenge window', () => {
  function attackedAt(now: number): GameState {
    const r = applyPrank(state, prank({ now }));
    return r.ok ? r.value.state : state;
  }

  it('is available immediately after a landed attack', () => {
    const s = attackedAt(T0);
    const attack = s.pranks[0];
    expect(canRevenge(s, attack, 2, T0 + 60_000)).toBe(true);
  });

  it('is available just inside 24h', () => {
    const s = attackedAt(T0);
    const attack = s.pranks[0];
    expect(canRevenge(s, attack, 2, T0 + REVENGE_WINDOW_MS)).toBe(true);
  });

  it('expires just past 24h', () => {
    const s = attackedAt(T0);
    const attack = s.pranks[0];
    expect(canRevenge(s, attack, 2, T0 + REVENGE_WINDOW_MS + 1)).toBe(false);
  });

  it('is not available for a dodged attack - nothing to revenge', () => {
    const r = applyPrank(state, prank({ landed: false }));
    const s = r.ok ? r.value.state : state;
    expect(canRevenge(s, s.pranks[0], 2, T0 + HOUR)).toBe(false);
  });

  it('is not available to a third party', () => {
    const s = attackedAt(T0);
    expect(canRevenge(s, s.pranks[0], 3, T0 + HOUR)).toBe(false);
  });

  it('picks the most recent eligible attack', () => {
    let s = attackedAt(T0);
    const b = applyPrank(s, prank({ fromTokenId: 3, toTokenId: 2, now: T0 + 2 * HOUR }));
    s = b.ok ? b.value.state : s;
    const t = revengeTarget(s, 2, T0 + 3 * HOUR);
    expect(t?.fromTokenId).toBe(3);
  });

  it('reports the remaining window', () => {
    expect(revengeWindowRemaining(T0 + HOUR, T0)).toBe(REVENGE_WINDOW_MS - HOUR);
    expect(revengeWindowRemaining(T0 + REVENGE_WINDOW_MS + DAY, T0)).toBe(0);
  });

  it('grants the Payback badge only for a landed revenge', () => {
    const s = attackedAt(T0);
    const r = applyPrank(s, prank({ fromTokenId: 2, toTokenId: 1, revenge: true }));
    expect(r.ok && r.value.newBadges).toContain<Badge>('payback');
  });

  it('does not grant Payback for a dodged revenge', () => {
    const s = attackedAt(T0);
    const r = applyPrank(s, prank({ fromTokenId: 2, toTokenId: 1, revenge: true, landed: false }));
    expect(r.ok && r.value.newBadges).not.toContain<Badge>('payback');
  });

  it('doubles the points for a revenge', () => {
    const s = attackedAt(T0);
    const r = applyPrank(s, prank({ fromTokenId: 2, toTokenId: 1, revenge: true }));
    expect(r.ok && r.value.record.points).toBe(20);
  });
});

// ---------------------------------------------------------------------------

describe('badges', () => {
  it('gives First Blood on the very first prank', () => {
    const r = applyPrank(state, prank());
    expect(r.ok && r.value.newBadges).toContain<Badge>('first_blood');
  });

  it('does not repeat First Blood', () => {
    const a = applyPrank(state, prank({ now: Date.parse('2026-10-05T12:00:00Z') }));
    const s = a.ok ? a.value.state : state;
    const b = applyPrank(s, prank({ now: Date.parse('2026-10-06T12:00:00Z') }));
    expect(b.ok && b.value.newBadges).not.toContain<Badge>('first_blood');
  });

  it('gives Untouchable after 5 consecutive dodges', () => {
    let s = emptyState();
    const victim = 2;
    const known = new Set([...Array.from({ length: 12 }, (_, i) => 100 + i), victim]);
    for (let i = 0; i < UNTOUCHABLE_DODGE_STREAK; i++) {
      const r = applyPrank(
        s,
        prank({ fromTokenId: 100 + i, toTokenId: victim, landed: false, knownTokens: known }),
      );
      expect(r.ok).toBe(true);
      if (r.ok) s = r.value.state;
    }
    expect(s.streaks[victim].consecutiveDodges).toBe(UNTOUCHABLE_DODGE_STREAK);
    expect(s.badges[victim]).toContain<Badge>('untouchable');
  });

  it('breaks the dodge streak when the victim is hit', () => {
    let s = emptyState();
    const known = new Set([...Array.from({ length: 12 }, (_, i) => 100 + i), 2]);
    for (let i = 0; i < 4; i++) {
      const r = applyPrank(s, prank({ fromTokenId: 100 + i, toTokenId: 2, landed: false, knownTokens: known }));
      if (r.ok) s = r.value.state;
    }
    expect(s.streaks[2].consecutiveDodges).toBe(4);
    const hit = applyPrank(s, prank({ fromTokenId: 105, toTokenId: 2, landed: true, knownTokens: known }));
    expect(hit.ok).toBe(true);
    const s2 = hit.ok ? hit.value.state : s;
    expect(s2.streaks[2].consecutiveDodges).toBe(0);
    expect(s2.badges[2] ?? []).not.toContain<Badge>('untouchable');
  });

  it('gives Most Wanted after 10 DISTINCT attackers', () => {
    let s = emptyState();
    const known = new Set([2, ...Array.from({ length: 12 }, (_, i) => 100 + i)]);
    for (let i = 0; i < MOST_WANTED_DISTINCT_ATTACKERS; i++) {
      const r = applyPrank(
        s,
        prank({ fromTokenId: 100 + i, toTokenId: 2, knownTokens: known }),
      );
      if (r.ok) s = r.value.state;
    }
    expect(s.badges[2]).toContain<Badge>('most_wanted');
  });

  it('does not give Most Wanted for 10 pranks from the SAME attacker', () => {
    let s = emptyState();
    for (let i = 0; i < 12; i++) {
      const r = applyPrank(s, prank({ fromTokenId: 1, toTokenId: 2, now: T0 + i * DAY }));
      if (r.ok) s = r.value.state;
    }
    expect(s.badges[2] ?? []).not.toContain<Badge>('most_wanted');
  });
});

// ---------------------------------------------------------------------------

describe('nonces', () => {
  const rec = { nonce: 'abc', address: '0xABC', expiresAt: T0 + NONCE_TTL_MS, usedAt: null };

  it('accepts a fresh nonce for the right address', () => {
    expect(validateNonce(rec, '0xabc', T0).ok).toBe(true);
  });

  it('is case-insensitive on the address', () => {
    expect(validateNonce(rec, '0xABC', T0).ok).toBe(true);
  });

  it('refuses a reused nonce', () => {
    const burned = burnNonce(rec, T0);
    const r = validateNonce(burned, '0xabc', T0 + 1000);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refusal).toBe('NONCE_USED');
  });

  it('refuses an expired nonce', () => {
    const r = validateNonce(rec, '0xabc', rec.expiresAt + 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refusal).toBe('NONCE_EXPIRED');
  });

  it('refuses a nonce issued to someone else', () => {
    const r = validateNonce(rec, '0xdead', T0);
    expect(r.ok).toBe(false);
  });

  it('expires after 10 minutes', () => {
    expect(NONCE_TTL_MS).toBe(10 * 60 * 1000);
  });
});

// ---------------------------------------------------------------------------

describe('reputation follows the token, not the wallet', () => {
  it('carries pranks, overlays, streak and badges on the token id', () => {
    const r = applyPrank(state, prank());
    const s = r.ok ? r.value.state : state;
    const view = stateForToken(s, 1);
    expect(view.pranksDealt).toHaveLength(1);
    expect(view.streak?.currentStreak).toBe(1);
    expect(view.badges).toContain<Badge>('first_blood');
  });

  it('keeps the grudge with the token when the victim sells it', () => {
    // #2 was pranked by #1. Nothing about that depends on who holds #2.
    const r = applyPrank(state, prank());
    const s = r.ok ? r.value.state : state;
    const victimView = stateForToken(s, 2);
    expect(victimView.pranksReceived).toHaveLength(1);
    expect(victimView.overlays).toHaveLength(1);
  });

  it('accumulates points per token across many days', () => {
    let s = emptyState();
    for (let i = 0; i < 4; i++) {
      const r = applyPrank(s, prank({ toTokenId: 2, now: T0 + i * DAY }));
      if (r.ok) s = r.value.state;
    }
    // Points use the streak BEFORE the prank: 1x, 1x, 2x, 3x.
    expect(s.pranks.map((p) => p.points)).toEqual([10, 10, 20, 30]);
    expect(totalPointsDealt(s, 1)).toBe(70);
  });

  it('keeps two tokens reputations independent', () => {
    let s = emptyState();
    const a = applyPrank(s, prank({ fromTokenId: 1 }));
    s = a.ok ? a.value.state : s;
    const b = applyPrank(s, prank({ fromTokenId: 7, toTokenId: 8 }));
    s = b.ok ? b.value.state : s;
    expect(totalPointsDealt(s, 1)).toBe(10);
    expect(totalPointsDealt(s, 7)).toBe(10);
    expect(s.streaks[1].currentStreak).toBe(1);
    expect(s.streaks[7].currentStreak).toBe(1);
  });
});

// ---------------------------------------------------------------------------

describe('rules agree with the real powers mapping', () => {
  it('lets a Legendary-tier Chog use every rarity', () => {
    const p = powersFor({ Tier: 'Legendary' });
    expect(canUsePrank('common', p.maxRarity)).toBe(true);
    expect(canUsePrank('rare', p.maxRarity)).toBe(true);
    expect(canUsePrank('legendary', p.maxRarity)).toBe(true);
  });

  it('locks a Common Chog out of legendary pranks', () => {
    const p = powersFor({ Tier: 'Common' });
    expect(canUsePrank('legendary', p.maxRarity)).toBe(false);
    expect(canUsePrank('common', p.maxRarity)).toBe(true);
  });
});
