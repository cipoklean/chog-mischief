/**
 * Static content for the home page.
 *
 * Kept separate from page.tsx so the copy can be reviewed on its own, and so
 * the featured set can be chosen from real harvested data rather than invented
 * token ids that would 404.
 */

import { getChog } from './chogs';

/**
 * Copy for the trait explainer.
 *
 * Every percentage here is measured from data/cache/chogs.json (1,969 Chogs)
 * against src/game/powers.ts, not estimated. An earlier draft said Head was
 * "about a third" of the collection, which was right by luck - 87.2% of Chogs
 * HAVE a Head, but only 31.9% carry one of the 14 Head traits that actually
 * grants a signature prank. Headwear being common does not make the unlock
 * common, and the page has to say the latter.
 *
 *   Head trait present      1,716 / 1,969  87.2%
 *   ...of which grants one     628 / 1,969  31.9%
 *   Accessory trait present    195 / 1,969   9.9%
 *   ...of which grants one      41 / 1,969   2.1%
 */
export const POWER_GROUPS = [
  {
    trait: 'Tier',
    effect: 'How much chaos you cause',
    detail: 'Common Chogs make small trouble. Epic and Legendary Chogs hit far harder - and can pull the rarest pranks.',
  },
  {
    trait: 'Aura',
    effect: 'How well you dodge',
    detail: 'Only 974 of 1,969 Chogs carry an aura at all, and a smoky or burning one makes you genuinely hard to catch.',
  },
  {
    trait: 'Mouth',
    effect: 'Whether you can taunt',
    detail: 'Most Chogs can talk (1,804 of 1,969). A loudmouth gets the taunt pranks; a quiet mouth keeps you polite, which is a real strategic choice.',
  },
  {
    trait: 'Head',
    effect: 'One signature prank',
    detail: '87% of Chogs wear something on their head, but only 14 specific traits grant a signature prank - 628 Chogs, or 32%, unlock one. A Crown, a Wizard Hat, a Durag.',
  },
  {
    trait: 'Accessory',
    effect: 'A second signature prank',
    detail: 'The rarest unlock in the game: 41 Chogs (2%) carry one of only two qualifying accessories.',
  },
  {
    trait: 'Eyes',
    effect: 'Your accuracy',
    detail: 'Steadier eyes lower the target’s dodge chance. Wild eyes do not help you hit anything.',
  },
] as const;

/**
 * Which Chogs to feature - every rarity tier is represented.
 *
 * The first draft picked ids by hand (954, 1462, 1, 42, ...) and every one of
 * them turned out to be Common or Uncommon, so the homepage showed 12 of the
 * 1,279 Commons and none of the 10 Legendaries. These ids are taken from the
 * measured tier distribution in data/cache/chogs.json:
 *
 *   Common 1,279 | Uncommon 590 | Rare 60 | Epic 30 | Legendary 10
 *
 * Rare is the one to show off - Epic and Legendary Chogs are where the best
 * signature pranks live.
 */
const FEATURED_IDS = [
  1,     // Uncommon - the lowest id that is not Common
  3,     // Common
  61,    // Rare
  70,    // Epic
  561,   // Legendary
  1969,  // the last Chog minted
  1458,
  954,
  1462,
  103,
  1200,
  1900,
];

export interface FeaturedChog {
  tokenId: number;
  name: string;
  imageUrl: string;
  tier: string;
}

export const FEATURED: FeaturedChog[] = FEATURED_IDS.map((tokenId) => {
  const chog = getChog(tokenId);
  return {
    tokenId,
    name: chog?.name ?? `CHOG #${tokenId}`,
    // A card with a broken image looks broken. Every harvested Chog has one,
    // and this list is filtered against the cache by the test suite.
    imageUrl: chog?.imageUrl ?? '',
    tier: chog?.traits.Tier ?? 'Chog',
  };
}).filter((c) => c.imageUrl !== '');

/** Sanity: the featured list must not be empty just because the cache is missing. */
export const FEATURED_TOTAL = FEATURED.length;
