import type { ReactNode } from "react";

/**
 * ChaosFeed — HERMES_UI_RULES rule 5 names this a component.
 *
 * The prototype's `.x-feed`: a stacked list of one-line prank events, each
 * "attacker did thing to victim". Used on HQ and, per STATES.md §1, on the
 * landing page's "3 latest" strip.
 *
 * `items` may contain simple HTML because the prototype's copy bolds the handles
 * (@nadsworth dodged a 🍌 from @bananabandit). That markup is authored here, not
 * user input — no player-supplied string ever reaches this component, so there
 * is no injection surface. If that ever changes, this must take React nodes.
 */

export interface FeedItem {
  /** Rendered as-is; contains only <b> tags around handles. */
  html: string;
  /** Plain-text form, for aria-label and for tests. */
  text: string;
  ago?: string;
  /** First few items get the x-pop entrance animation, as in the prototype. */
  fresh?: boolean;
}

export function ChaosFeed({
  items,
  max,
  emptyState,
}: {
  items: FeedItem[];
  max?: number;
  emptyState?: ReactNode;
}) {
  const shown = typeof max === "number" ? items.slice(0, max) : items;

  if (shown.length === 0) {
    return emptyState ?? (
      <p className="x-sm x-mut">Nothing has happened yet. Be the first.</p>
    );
  }

  return (
    <ul className="x-feed">
      {shown.map((item, i) => (
        <li key={`${item.text}-${i}`} className={item.fresh ? "x-new" : undefined}>
          <span
            // Authored markup only — see the note above.
            dangerouslySetInnerHTML={{ __html: item.html }}
            style={{ flex: 1 }}
          />
          {item.ago ? <span className="x-mut x-sm">{item.ago}</span> : null}
        </li>
      ))}
    </ul>
  );
}

export default ChaosFeed;