"use client";

import { PrankOverlay } from "./PrankOverlay";
import { Countdown } from "./Countdown";

/**
 * Midnight UTC as an absolute instant, computed WITHOUT reading the clock.
 *
 * The game day is a UTC calendar day, so the next reset is simply midnight of the
 * current UTC day plus one. Deriving it from Date.now() would be an unstable
 * value during prerender; deriving it from `Date.UTC` of the parts is not, and it
 * yields the same answer. Countdown re-checks against the real clock after mount,
 * so a stale target here self-corrects.
 */
function utcMidnight(): number {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
}

/**
 * RefusalSheet — STATES.md §4, verbatim.
 *
 * "Signature refusals: one bottom sheet, 5 variants." ONE component and ONE
 * shape for all five, differing only in emoji, headline, body and actions. Five
 * bespoke error screens would be five chances for the design to drift; this way
 * the layout is written once.
 *
 * The daily-limit variant is the only one that uses x-cd, per STATES.md §6
 * ("x-cd is only for the daily reset and the daily-limit refusal").
 */

export type RefusalKind = "rejected" | "wrong-signer" | "not-owner" | "nonce-replay" | "daily-limit";

export interface RefusalSpec {
  emoji: string;
  headline: string;
  body: string | ((ctx: RefusalContext) => string);
  /** Label -> handler. Rendered in order. */
  actions: { label: string; action: string }[];
}

export interface RefusalContext {
  /** The Chog whose ownership failed, for "That Chog moved out." */
  tokenId?: number | string;
}

export const REFUSALS: Record<RefusalKind, RefusalSpec> = {
  rejected: {
    emoji: "🐔",
    headline: "Chickened out?",
    body: "You declined the signature. No gas was ever on the line.",
    actions: [
      { label: "Try again", action: "retry" },
      { label: "Back", action: "back" },
    ],
  },
  "wrong-signer": {
    emoji: "🕵️",
    headline: "Imposter detected.",
    body: "That signature came from a different wallet than the one connected.",
    actions: [{ label: "Reconnect wallet", action: "reconnect" }],
  },
  "not-owner": {
    emoji: "📦",
    headline: "That Chog moved out.",
    body: (ctx) =>
      `#${ctx.tokenId ?? "?"} isn't in this wallet anymore. Its record went with it.`,
    actions: [{ label: "Pick another Chog", action: "pick" }],
  },
  "nonce-replay": {
    emoji: "🔁",
    headline: "Déjà prank.",
    body: "That prank was already used. Grab a fresh one.",
    actions: [{ label: "Retry", action: "retry" }],
  },
  "daily-limit": {
    emoji: "⏰",
    headline: "#{id} already pranked today.",
    body: "Big x-cd counting to 00:00 UTC.",
    actions: [
      { label: "Prank with another Chog", action: "pick" },
      { label: "Back to HQ", action: "hq" },
    ],
  },
};

export interface RefusalSheetProps {
  kind: RefusalKind | null;
  tokenId?: number | string;
  onAction: (action: string) => void;
  onClose?: () => void;
}

export function RefusalSheet({ kind, tokenId, onAction, onClose }: RefusalSheetProps) {
  // Countdown anchors itself after mount, so this only has to supply a stable
  // target. Nothing here may read the clock during render: a client component is
  // still rendered while prerendering, and Cache Components rejects an unstable
  // `new Date()` there. Hence no useState initialiser and no effect — the
  // component computes the UTC midnight arithmetically, without a wall clock.
  // The reset instant is computed when the sheet first mounts. Mounting per
  // refusal is what keeps it fresh across midnight: each open re-anchors.

  if (!kind) return null;
  const spec = REFUSALS[kind];
  const ctx: RefusalContext = { tokenId };
  const body = typeof spec.body === "function" ? spec.body(ctx) : spec.body;
  const headline =
    kind === "daily-limit" ? `#${tokenId ?? "?"} already pranked today.` : spec.headline;

  return (
    <PrankOverlay
      open
      labelledBy="refusal-headline"
      headline={
        <div style={{ display: "grid", gap: 8 }}>
          <div className="x-boom" style={{ fontSize: 48 }}>
            {spec.emoji}
          </div>
          <h2 id="refusal-headline" style={{ fontSize: 26 }}>
            {headline}
          </h2>
        </div>
      }
      actions={spec.actions.map((a) => ({
        label: a.label,
        onClick: () => onAction(a.action),
        variant: a.action === "back" ? ("k" as const) : ("y" as const),
      }))}
      onClose={onClose}
    >
      {kind === "daily-limit" ? (
        // STATES.md §4: the daily-limit variant replaces its body line with the
        // big countdown to 00:00 UTC.
        <div style={{ display: "grid", gap: 4, placeItems: "center" }}>
          <Countdown to={utcMidnight()} label="Reloads in" />
        </div>
      ) : (
        <p className="x-sm x-mut">{body}</p>
      )}
    </PrankOverlay>
  );
}

export default RefusalSheet;