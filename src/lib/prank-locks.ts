import type { ChogTraits } from '@/game/powers';
import {
  powersFor,
  HEAD_SIGNATURE,
  ACCESSORY_SIGNATURE,
  LEGENDARY_PRANK_ID,
  type ChogPowers,
} from '@/game/powers';
import { PRANKS, pranksForPowers, type Prank } from '@/game/pranks';

/**
 * Why a prank is locked for a given Chog.
 *
 * The pool (pranksForPowers) already answers WHICH pranks are unlocked; this
 * answers WHY the rest are not, in words a player can act on - "Needs trait:
 * Crown" tells them what to look for, "locked" tells them nothing.
 *
 * Pure and derived from the same tables powers.ts owns, so the explanation
 * can never disagree with the rule: if the trait table changes, the reason
 * changes with it.
 */

export interface PrankLock {
  prank: Prank;
  unlocked: boolean;
  /** Player-facing reason, or null when unlocked. */
  reason: string | null;
}

/** prankId -> the trait values that grant it, for the two signature maps. */
function inverseSignature(map: Record<string, string>): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [trait, prankId] of Object.entries(map)) {
    const list = out.get(prankId) ?? [];
    list.push(trait);
    out.set(prankId, list);
  }
  return out;
}

const HEAD_BY_PRANK = inverseSignature(HEAD_SIGNATURE);
const ACCESSORY_BY_PRANK = inverseSignature(ACCESSORY_SIGNATURE);

function traitList(values: string[]): string {
  // "Crown" or "Blue Bucket Cap or Gray Bucket Cap" - every spelling that
  // grants it, so a player who has one of them knows it counts.
  return values.join(' or ');
}

/**
 * The reason a specific prank is locked for these powers.
 *
 * Order matters: the most actionable reason wins. A rare prank that is also
 * a signature is "Needs trait: X" (the trait is the path), not "Needs tier".
 */
export function lockReason(prank: Prank, powers: ChogPowers): string | null {
  // The weekly legendary is the rarest gate in the game.
  if (prank.id === LEGENDARY_PRANK_ID) {
    return 'Needs trait: a rare Eyes, Aura or Head (weekly)';
  }

  const headTraits = HEAD_BY_PRANK.get(prank.id);
  if (headTraits) return `Needs trait: Head - ${traitList(headTraits)}`;

  const accessoryTraits = ACCESSORY_BY_PRANK.get(prank.id);
  if (accessoryTraits) return `Needs trait: Accessory - ${traitList(accessoryTraits)}`;

  // Taunt pranks need a taunt Mouth; the gate filters the pool entirely.
  if (prank.kind === 'taunt') return 'Needs trait: a taunt Mouth';

  // Tier gate: a Common Chog cannot pull rare pranks it has no trait for.
  if (prank.rarity === 'rare' && powers.maxRarity === 'common') {
    return 'Needs tier: Uncommon or better';
  }

  return null;
}

/**
 * Every prank in the catalogue, marked unlocked/locked with its reason, for
 * one Chog's traits.
 *
 * Unlocked first (the player's arsenal), then locked with reasons - the
 * order a player reads: what I can do, then what I could have.
 */
export function prankLocks(traits: ChogTraits): PrankLock[] {
  const powers = powersFor(traits);
  const pool = new Set(
    pranksForPowers(
      powers,
      powers.signaturePrankId,
      powers.accessoryPrankId,
      powers.legendaryPrankId,
    ).map((p) => p.id),
  );

  const rows: PrankLock[] = PRANKS.map((prank) => {
    const unlocked = pool.has(prank.id);
    return { prank, unlocked, reason: unlocked ? null : lockReason(prank, powers) };
  });

  const rarityOrder = { common: 0, rare: 1, legendary: 2 } as const;
  rows.sort((a, b) => {
    if (a.unlocked !== b.unlocked) return a.unlocked ? -1 : 1;
    const byRarity = rarityOrder[a.prank.rarity] - rarityOrder[b.prank.rarity];
    if (byRarity !== 0) return byRarity;
    return a.prank.name.localeCompare(b.prank.name);
  });
  return rows;
}
