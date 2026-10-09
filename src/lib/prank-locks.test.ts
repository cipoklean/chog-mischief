import { describe, it, expect } from 'vitest';
import { lockReason, prankLocks } from './prank-locks';
import { powersFor } from '@/game/powers';
import { getPrank, PRANKS } from '@/game/pranks';

/**
 * The lock reasons must agree with the pool: anything prankLocks marks
 * unlocked must have no reason, and every locked prank must have one.
 * Run against traits built by hand (the real-cache coverage tests already
 * pin the pool itself).
 */
describe('lockReason', () => {
  it('names the Head trait for a signature prank', () => {
    const prank = getPrank('crown-of-the-chog')!;
    const powers = powersFor({ Tier: 'Common' });
    expect(lockReason(prank, powers)).toBe('Needs trait: Head - Crown');
  });

  it('lists every spelling that grants a shared signature prank', () => {
    // Both bucket caps map to bucket-over-head, so the reason must name both.
    const prank = getPrank('bucket-over-head')!;
    const powers = powersFor({ Tier: 'Common' });
    const reason = lockReason(prank, powers)!;
    expect(reason).toContain('Blue Bucket Cap');
    expect(reason).toContain('Gray Bucket Cap');
  });

  it('names the Accessory trait for an accessory signature', () => {
    const prank = getPrank('fwogged')!;
    const powers = powersFor({ Tier: 'Common' });
    expect(lockReason(prank, powers)).toBe('Needs trait: Accessory - Fwog');
  });

  it('gives the weekly legendary its own reason', () => {
    const prank = getPrank('chog-god-mode')!;
    const powers = powersFor({ Tier: 'Legendary' });
    expect(lockReason(prank, powers)).toMatch(/rare Eyes, Aura or Head/);
  });

  it('explains a taunt prank by the Mouth gate', () => {
    const prank = getPrank('touch-grass')!;
    const powers = powersFor({ Tier: 'Common' });
    expect(lockReason(prank, powers)).toBe('Needs trait: a taunt Mouth');
  });

  it('falls back to the tier reason for a non-trait rare prank', () => {
    // A hypothetical rare, non-signature, non-taunt prank: tier is the only gate.
    const powers = powersFor({ Tier: 'Common' });
    expect(
      lockReason({ id: 'x', name: 'X', rarity: 'rare', kind: 'silly', caption: '', overlay: 'x', points: 1 }, powers),
    ).toBe('Needs tier: Uncommon or better');
  });

  it('returns null for a prank with no gate left', () => {
    const powers = powersFor({ Tier: 'Legendary' });
    expect(lockReason({ id: 'y', name: 'Y', rarity: 'rare', kind: 'silly', caption: '', overlay: 'y', points: 1 }, powers)).toBeNull();
  });
});

describe('prankLocks', () => {
  it('marks every catalogue prank and never leaves a locked one unexplained', () => {
    const locks = prankLocks({ Tier: 'Common', Head: 'Crown' });
    expect(locks).toHaveLength(PRANKS.length);
    for (const l of locks) {
      if (l.unlocked) expect(l.reason).toBeNull();
      else expect(typeof l.reason).toBe('string');
    }
  });

  it('puts the Crown signature in the unlocked set', () => {
    const locks = prankLocks({ Tier: 'Common', Head: 'Crown' });
    const crown = locks.find((l) => l.prank.id === 'crown-of-the-chog')!;
    expect(crown.unlocked).toBe(true);
  });

  it('locks the same prank without the trait and explains why', () => {
    const locks = prankLocks({ Tier: 'Common', Head: 'Wizard Hat' });
    const crown = locks.find((l) => l.prank.id === 'crown-of-the-chog')!;
    expect(crown.unlocked).toBe(false);
    expect(crown.reason).toBe('Needs trait: Head - Crown');
  });

  it('unlocks taunts only with a taunt Mouth', () => {
    const withMouth = prankLocks({ Tier: 'Common', Mouth: 'Clown Mouth' });
    const without = prankLocks({ Tier: 'Common', Mouth: 'Flat' });
    expect(withMouth.find((l) => l.prank.id === 'touch-grass')!.unlocked).toBe(true);
    expect(without.find((l) => l.prank.id === 'touch-grass')!.unlocked).toBe(false);
  });

  it('sorts unlocked first, then by rarity', () => {
    const locks = prankLocks({ Tier: 'Uncommon', Head: 'Crown' });
    const firstLocked = locks.findIndex((l) => !l.unlocked);
    for (let i = 1; i < firstLocked; i += 1) {
      expect(locks[i - 1].unlocked).toBe(true);
    }
    // Common pranks come before rare ones among the unlocked.
    const unlocked = locks.filter((l) => l.unlocked);
    const rarities = unlocked.map((l) => l.prank.rarity);
    const firstRare = rarities.indexOf('rare');
    if (firstRare > 0) expect(rarities.slice(0, firstRare).every((r) => r === 'common')).toBe(true);
  });
});
