/**
 * TRAIT DISPLAY.
 *
 * ── Why this module exists ──────────────────────────────────────────────────
 * 24 of the 1,969 Chogs Genesis carry "Retard" as their Eyes trait. It is part
 * of the collection and cannot be removed from the chain, so the decision is
 * only about what this app RENDERS.
 *
 * It renders "[hidden]". Three reasons, and the third is the one that matters:
 *
 *   1. A player opening their own Chog's page should not have to read a slur to
 *      find out what their NFT is.
 *   2. Nothing in the game keys off it. The value is deliberately absent from
 *      the accuracy table and from the rarity sets, so it grants no power and
 *      unlocks no prank - it is just a word.
 *   3. It is rendered in a place people SCREENSHOT. The Chog page is
 *      shareable, the profile has an OG image, and both would otherwise put a
 *      slur into a judge's slides. Masking at display time covers every surface
 *      at once, including ones added later, which is why it lives here rather
 *      than being remembered at each call site.
 *
 * The NFT's own artwork is not ours to redact, and is not altered.
 *
 * ── Matching ────────────────────────────────────────────────────────────────
 * Case-insensitive and whitespace-collapsed, because the collection ships real
 * case duplicates of the same value (`JEET Cap` AND `Jeet Cap`), and a
 * case-sensitive blocklist would miss half of them. This reuses the same
 * normaliser the power tables use, so there is one definition of "the same
 * trait value" in the codebase.
 */

/**
 * Trait values that are never rendered verbatim.
 *
 * Kept as a plain list rather than a pattern: an explicit list cannot
 * accidentally mask a legitimate value, and every entry is a decision someone
 * made on purpose.
 */
export const HIDDEN_TRAIT_VALUES: readonly string[] = [
  'Retard',
  // Add any further value here, with a note on why. Check the real data with:
  //   node -e "const d=require('./data/cache/chogs.json');console.log(Object.keys(Object.values(d).reduce((a,c)=>(a.Eyes=[...new Set([...a.Eyes||[],...(c.attributes||{}).Eyes||[]])],a),{}).Eyes).sort())"
] as const;

/** What a masked trait shows instead. */
export const HIDDEN_TRAIT_LABEL = '[hidden]';

/**
 * Normalise a trait value for comparison: lowercase, collapsed whitespace.
 *
 * Same rule as `normaliseTrait` in game/powers, reimplemented here so this
 * module stays free of game imports and can be used from anywhere - including a
 * future server component or an OG-image route.
 */
function normalise(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

const HIDDEN = new Set(HIDDEN_TRAIT_VALUES.map(normalise));

/** True when this exact trait value must not be shown. */
export function isHiddenTraitValue(value: string | undefined | null): boolean {
  if (!value) return false;
  return HIDDEN.has(normalise(value));
}

/**
 * The value to render for a trait.
 *
 * Returns "[hidden]" for a masked value and the input untouched otherwise -
 * including for undefined, so a missing trait still renders as nothing rather
 * than the literal string "undefined".
 */
export function displayTrait(value: string | undefined | null): string {
  if (!value) return '';
  return isHiddenTraitValue(value) ? HIDDEN_TRAIT_LABEL : value;
}

/**
 * A whole trait bag, ready to render.
 *
 * Every trait object that reaches the UI goes through here, so a new screen
 * cannot accidentally print the raw value: the mask is applied by construction
 * rather than by remembering.
 */
export function displayTraits(traits: Record<string, unknown> | undefined | null): {
  key: string;
  label: string;
  value: string;
}[] {
  if (!traits) return [];
  return Object.entries(traits)
    // `__`-prefixed keys are internal markers from the harvest, not traits.
    .filter(([key]) => !key.startsWith('__'))
    .map(([key, value]) => ({
      key,
      label: key,
      value: displayTrait(typeof value === 'string' ? value : String(value ?? '')),
    }));
}
