import Link from "next/link";
import type { ReactNode } from "react";

/**
 * ChogCard - HERMES_UI_RULES rule 5 names this a component.
 *
 * The prototype has two card shapes: `.x-pick` (a selectable tile in the pick
 * grid) and the profile art block. This covers both plus STATES.md §2's guest
 * card, which is an x-card with a DASHED 3px outline and a magenta GUEST pill.
 *
 * No new visual language: every colour, border and shadow here is an existing
 * x- class or a Hark-specified token value.
 */

export interface ChogCardProps {
  /** Real token id, or a guest id like "G-0420". */
  id: string | number;
  name: string;
  imageUrl?: string | null;
  /** Where the artwork links to. Guests link nowhere - they are not on-chain. */
  href?: string;
  /** Renders the dashed guest outline and the GUEST pill (STATES.md §2). */
  guest?: boolean;
  /** Tier pill text, e.g. "Legendary". */
  tier?: string | null;
  /** Selected state for the pick grid: aria-pressed, not a CSS hack. */
  selected?: boolean;
  /** Extra line under the name, e.g. "Fully playable." */
  caption?: ReactNode;
  footer?: ReactNode;
  /**
   * Makes the whole tile a button that SELECTS instead of navigating - the
   * prank flow's target grid. Mutually exclusive with href: a tile that both
   * navigates and selects on one click is a bug waiting to happen.
   */
  onClick?: () => void;
}

export function ChogCard({
  id,
  name,
  imageUrl,
  href,
  guest = false,
  tier,
  selected = false,
  caption,
  footer,
  onClick,
}: ChogCardProps) {
  const label = typeof id === "number" ? `#${id}` : id;

  const art = imageUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={imageUrl}
      alt={name}
      loading="lazy"
      style={{
        width: "100%",
        aspectRatio: "1",
        objectFit: "cover",
        borderRadius: 12,
        border: "2px solid var(--x-ink)",
        display: "block",
      }}
    />
  ) : (
    <div
      aria-label="Art unavailable"
      style={{
        width: "100%",
        aspectRatio: "1",
        borderRadius: 12,
        border: "2px solid var(--x-ink)",
        background: "var(--x-card)",
        display: "grid",
        placeItems: "center",
        color: "var(--x-mut)",
        font: "var(--type-small)",
      }}
    >
      No art
    </div>
  );

  const inner = (
    <>
      {art}
      <div className="x-row x-sp">
        <strong style={{ fontFamily: "var(--x-d)", fontSize: 17 }}>{name}</strong>
        <span className="x-pill" style={guest ? { background: "var(--x-m)" } : undefined}>
          {guest ? "GUEST" : tier ?? label}
        </span>
      </div>
      {caption ? <p className="x-sm x-mut">{caption}</p> : null}
      {footer}
    </>
  );

  // A tile that selects (the prank target grid) is a BUTTON, not a link -
  // clicking it must choose the target, not navigate away from the flow.
  if (onClick && !href) {
    return (
      <button
        type="button"
        className="x-pick"
        onClick={onClick}
        aria-pressed={selected}
        style={guest ? { ...dashed(), font: "inherit" } : { font: "inherit" }}
      >
        {inner}
      </button>
    );
  }

  // A guest Chog is not on-chain, so it must not link to a /chog page that does
  // not exist. Render the tile without a link rather than a dead one.
  if (!href) {
    return (
      <div className="x-pick" style={guest ? dashed() : undefined}>
        {inner}
      </div>
    );
  }

  return (
    <Link href={href} className="x-pick" aria-pressed={selected}>
      {inner}
    </Link>
  );
}

/**
 * STATES.md §2: "The card is an x-card with a DASHED 3px outline and a magenta
 * x-pill GUEST tag." The dashed line is the only structural signal that this
 * Chog is not real, so it overrides x-pick's solid border and must stay visible
 * against the purple card background.
 */
function dashed(): React.CSSProperties {
  return {
    borderStyle: "dashed",
    background: "var(--x-card)",
  };
}

export default ChogCard;