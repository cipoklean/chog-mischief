"use client";

import { useEffect, useRef, useState } from "react";
import { ChaosFeed, type FeedItem } from "@/components/ChaosFeed";
import { buildFeed } from "@/lib/chaos-feed";
import type { ChaosRow } from "@/app/api/chaos/route";

/**
 * The landing page's live chaos strip.
 *
 * Polls /api/chaos every 15s (Hark: "polling every 15s is fine, skip realtime").
 * Realtime is not just unnecessary here, it is worse: Supabase realtime needs a
 * publication and an authenticated channel, and this strip must render for a
 * signed-out visitor who has no session at all.
 *
 * ── The clock is read after mount, never during render ──────────────────────
 * `buildFeed` needs `now` to render "4m" instead of an absolute timestamp. The
 * app has Cache Components enabled, which refuses to prerender a component whose
 * output depends on the current time - a render-time `Date.now()` is a build
 * error ("blocking-prerender-current-time-client"). So the first paint uses a
 * fixed placeholder epoch and the real clock arrives in an effect, one tick
 * later. The strip is server-rendered with its rows and hydrates the ages in.
 *
 * Fails soft and quiet: a feed error leaves whatever is already on screen. A
 * landing page should not announce that its own ticker is broken.
 */

const POLL_MS = 15_000;
/** Placeholder until the client clock takes over. Ages render empty for a beat. */
const PLACEHOLDER_NOW = 0;

export function ChaosStrip({ max = 3 }: { max?: number }) {
  const [rows, setRows] = useState<ChaosRow[] | null>(null);
  const [now, setNow] = useState(PLACEHOLDER_NOW);
  // Guards against a slow response landing after unmount, and against an older
  // response overwriting a newer one when two polls overlap.
  const seq = useRef(0);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const mine = ++seq.current;
      try {
        const res = await fetch("/api/chaos", { cache: "no-store" });
        if (!res.ok) return;
        const body = (await res.json()) as { rows?: ChaosRow[] };
        if (!alive || mine !== seq.current) return;
        // Read the clock HERE, in the response callback, not in the effect body:
        // (a) it is the moment the ages are actually relative to, so a poll that
        //     takes 2s does not render "0m"; (b) a setState directly in an effect
        //     body triggers a cascading render, which React's compiler rules
        //     reject - and rightly, since this is not synchronisation with an
        //     external system, it is the arrival of data.
        setNow(Date.now());
        setRows(body.rows ?? []);
      } catch {
        // Offline or aborted. The previous strip stays; nothing to recover.
      }
    };

    void load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  // Before the first response, build from an empty set: the strip shows labelled
  // practice rows immediately rather than a hole in the layout.
  const feed: FeedItem[] = buildFeed(rows ?? [], now, { limit: 10 });

  return (
    <ChaosFeed
      items={feed}
      max={max}
      emptyState={<p className="x-sm x-mut">Nothing has happened yet. Be the first.</p>}
    />
  );
}

export default ChaosStrip;
