import type { ReactNode } from "react";

/**
 * ChaosFeed — HERMES_UI_RULES rule 5 names this a component.
 *
 * The prototype's `.x-feed`: a stacked list of one-line prank events, each
 * "attacker did thing to victim". Used on HQ and, per STATES.md §1, on the
 * landing page's "3 latest" strip.
 *
 * ── Why this takes STRUCTURED fields and not an `html` string ───────────────
 * The prototype hardcodes three rows of copy. The first version of this
 * component took `html: string` and rendered it with `dangerouslySetInnerHTML`,
 * safe only because the strings were authored here in source. That assumption is
 * now false: the landing strip reads real rows out of Supabase. Chog names and
 * prank captions are collection and catalogue data today, so they are not
 * attacker-controlled — but a feed that renders DB text as HTML has an injection
 * surface the moment either becomes user-writable, and a refusal is cheap to
 * build in and expensive to find later.
 *
 * So: `attacker`, `verb`, `target` and `ago` are separate fields rendered as
 * text nodes. Bold handles come from `<b>` in the component, not from markup in
 * a string. There is no `dangerouslySetInnerHTML` anywhere in this file, and a
 * name containing `<script>` renders as those literal characters.
 */

/** Where a row came from. Bot rows are labelled so the strip is never a lie. */
export type FeedSource = "real" | "practice";

export interface FeedItem {
  /** Display name of the attacking Chog. A token name, never a wallet address. */
  attacker: string;
  /** Display name of the target Chog. */
  target: string;
  /**
   * What happened, in the words of the prank catalogue — "slimed", "bonked",
   * "dodged a 🍌 from". Null `verb` with `dodged: true` reads as a dodge.
   */
  verb?: string;
  dodged?: boolean;
  /** Relative time, e.g. "4m". Computed by the caller, not by this component. */
  ago?: string;
  practice?: boolean;
  /** Link target for the attacker, if any. Guests and bots have none. */
  attackerHref?: string;
  targetHref?: string;
  /** Stable key: the DB row id, or a deterministic synthetic key for bots. */
  id?: string;
  /** First few rows get the x-pop entrance animation, as in the prototype. */
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
      {shown.map((item, i) => {
        const dodged = item.dodged === true;
        // "X dodged a 🍌 from Y" and "X slimed Y" are different sentence shapes,
        // so the dodge case is built explicitly rather than by string surgery.
        const line = dodged
          ? `${item.attacker} dodged${item.verb ? ` ${item.verb} from` : ""} ${item.target}`
          : `${item.attacker} ${item.verb ?? "pranked"} ${item.target}`;

        return (
          <li key={item.id ?? `${line}-${i}`} className={item.fresh ? "x-new" : undefined}>
            <span className="x-feed-line" style={{ flex: 1 }}>
              {item.attackerHref ? (
                <a href={item.attackerHref}>
                  <b>{item.attacker}</b>
                </a>
              ) : (
                <b>{item.attacker}</b>
              )}
              {` ${dodged ? "dodged" : (item.verb ?? "pranked")} `}
              {dodged && !item.verb ? "" : null}
              {dodged && item.verb ? "from " : null}
              {item.targetHref ? (
                <a href={item.targetHref}>
                  <b>{item.target}</b>
                </a>
              ) : (
                <b>{item.target}</b>
              )}
              {item.practice ? (
                <>
                  {" "}
                  <span className="x-pill x-sm" title="Bot Chog, not a real player">
                    practice
                  </span>
                </>
              ) : null}
            </span>
            {item.ago ? <span className="x-mut x-sm">{item.ago}</span> : null}
          </li>
        );
      })}
    </ul>
  );
}

export default ChaosFeed;