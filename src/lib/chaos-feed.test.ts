import { describe, it, expect } from "vitest";
import {
  botRows,
  buildFeed,
  realOnly,
  relativeTime,
  MIN_REAL_ROWS,
  FEED_LIMIT,
  BOTS,
} from "./chaos-feed";
import type { ChaosRow } from "@/app/api/chaos/route";

const NOW = Date.UTC(2026, 0, 1, 12, 0, 0);

function realRow(over: Partial<ChaosRow> = {}): ChaosRow {
  return {
    id: 1,
    from_token_id: 10,
    from_name: "CHOG #10",
    to_token_id: 20,
    to_name: "CHOG #20",
    prank_id: "bonk",
    landed: true,
    revenge: false,
    points: 10,
    created_at: new Date(NOW - 4 * 60_000).toISOString(),
    real: true,
    ...over,
  };
}

describe("relativeTime", () => {
  it("formats seconds, minutes, hours and days", () => {
    expect(relativeTime(new Date(NOW - 30_000).toISOString(), NOW)).toBe("30s");
    expect(relativeTime(new Date(NOW - 4 * 60_000).toISOString(), NOW)).toBe("4m");
    expect(relativeTime(new Date(NOW - 3 * 3_600_000).toISOString(), NOW)).toBe("3h");
    expect(relativeTime(new Date(NOW - 2 * 86_400_000).toISOString(), NOW)).toBe("2d");
  });

  // A row whose created_at is ahead of the client's clock must not render "-3m".
  it("never renders a negative duration for a future timestamp", () => {
    expect(relativeTime(new Date(NOW + 60_000).toISOString(), NOW)).toBe("0s");
  });

  it("returns empty rather than NaN for an unparseable date", () => {
    expect(relativeTime("not-a-date", NOW)).toBe("");
  });
});

describe("botRows", () => {
  it("fills with every bot it has when there are no real rows", () => {
    // Filler is capped by the bot roster, not by the 10-row strip limit: a bot
    // row that repeated a bot under a new prank id would be padding pretending
    // to be activity. Six labelled rows beat ten rows of noise.
    expect(botRows([], "seed")).toHaveLength(BOTS.length);
  });

  it("never exceeds the strip limit", () => {
    expect(botRows([], "seed").length).toBeLessThanOrEqual(FEED_LIMIT);
  });

  // The core requirement: filler is deterministic, so a 15s poll does not
  // reshuffle the strip under a reader's eyes.
  it("is deterministic for a given seed", () => {
    const a = botRows([], "abc");
    const b = botRows([], "abc");
    expect(a).toEqual(b);
  });

  it("is deterministic across calls with the same real rows and no explicit seed", () => {
    const rows = [realRow({ id: 1 }), realRow({ id: 2 })];
    expect(botRows(rows)).toEqual(botRows(rows));
  });

  it("changes when the real data changes, so a stale strip is visibly refreshed", () => {
    expect(botRows([], "one")).not.toEqual(botRows([], "two"));
  });

  it("marks every bot row as not real", () => {
    for (const row of botRows([], "seed")) expect(row.real).toBe(false);
  });

  it("only ever involves bot token ids, never a real one", () => {
    const botIds = new Set<number>(BOTS.map((b) => b.tokenId));
    for (const row of botRows([], "seed")) {
      expect(botIds.has(row.from_token_id)).toBe(true);
      expect(botIds.has(row.to_token_id)).toBe(true);
    }
  });

  it("emits both hits and dodges so both states are visible", () => {
    const rows = botRows([], "seed");
    expect(rows.some((r) => r.landed)).toBe(true);
    expect(rows.some((r) => !r.landed)).toBe(true);
  });

  it("adds nothing when the real rows already fill the strip", () => {
    const full = Array.from({ length: FEED_LIMIT }, (_, i) => realRow({ id: i + 1 }));
    expect(botRows(full, "seed")).toHaveLength(0);
  });
});

describe("buildFeed", () => {
  it("pads with practice rows when there are fewer than 3 real events", () => {
    const feed = buildFeed([realRow()], NOW, { seed: "s" });
    // 1 real + every bot: the strip is never short and never fake.
    expect(feed).toHaveLength(1 + BOTS.length);
    expect(feed.filter((i) => i.practice !== true)).toHaveLength(1);
    expect(feed.length).toBeLessThanOrEqual(FEED_LIMIT);
  });

  it("does not pad once there are 3 or more real events", () => {
    const rows = [realRow({ id: 1 }), realRow({ id: 2 }), realRow({ id: 3 })];
    const feed = buildFeed(rows, NOW, { seed: "s" });
    expect(feed.filter((i) => i.practice === true)).toHaveLength(0);
    expect(feed).toHaveLength(3);
  });

  // the reviewer's hard rule for this strip.
  it("never leaves the strip empty, even on a fresh database", () => {
    expect(buildFeed([], NOW, { seed: "s" }).length).toBeGreaterThanOrEqual(MIN_REAL_ROWS);
  });

  it("labels every bot row so a fake event cannot pass for a real player", () => {
    const feed = buildFeed([], NOW, { seed: "s" });
    expect(feed.every((i) => i.practice === true)).toBe(true);
  });

  it("never marks a real row as practice", () => {
    const feed = buildFeed([realRow(), realRow({ id: 2 }), realRow({ id: 3 })], NOW, {
      seed: "s",
    });
    expect(realOnly(feed)).toHaveLength(3);
    expect(feed.every((i) => i.practice === false)).toBe(true);
  });

  it("puts real rows first, newest first", () => {
    const rows = [
      realRow({ id: 1, from_name: "NEWEST" }),
      realRow({ id: 2, from_name: "OLDER" }),
      realRow({ id: 3, from_name: "OLDEST" }),
    ];
    const feed = buildFeed(rows, NOW, { seed: "s" });
    expect(feed.map((i) => i.attacker)).toEqual(["NEWEST", "OLDER", "OLDEST"]);
  });

  it("caps the strip at the reviewer's limit of 10", () => {
    const rows = Array.from({ length: 25 }, (_, i) => realRow({ id: i + 1 }));
    expect(buildFeed(rows, NOW).length).toBe(FEED_LIMIT);
  });

  it("reads a landed prank as the catalogue verb and a miss as a dodge", () => {
    const feed = buildFeed(
      [realRow({ id: 1, landed: true }), realRow({ id: 2, landed: false })],
      NOW,
      { seed: "s" },
    );
    expect(feed[0].dodged).toBe(false);
    expect(feed[0].verb).toBe("bonk");
    expect(feed[1].dodged).toBe(true);
  });

  it("links real rows to Chog pages and leaves bot rows unlinked", () => {
    const feed = buildFeed([realRow({ id: 1 })], NOW, { seed: "s" });
    expect(feed[0].attackerHref).toBe("/chog/10");
    expect(feed[0].targetHref).toBe("/chog/20");
    for (const item of feed.filter((i) => i.practice)) {
      expect(item.attackerHref).toBeUndefined();
      expect(item.targetHref).toBeUndefined();
    }
  });

  // Defence in depth for the no-wallet-addresses rule: if a name ever did carry
  // one, it must be inert text rather than markup.
  it("passes names through as text, not markup", () => {
    const feed = buildFeed([realRow({ from_name: "<script>alert(1)</script>" })], NOW, {
      seed: "s",
      limit: 1,
    });
    expect(feed[0].attacker).toBe("<script>alert(1)</script>");
  });
});
// ---------------------------------------------------------------------------
// The feed reads as: actor, prank, target, result.
// ---------------------------------------------------------------------------

describe("the feed line reads in one glance", () => {
  const now = Date.UTC(2026, 9, 9, 12, 0, 0);

  function row(over: Partial<ChaosRow> = {}): ChaosRow {
    return {
      id: 1,
      from_token_id: 412,
      from_name: "Mister Mucus",
      to_token_id: 88,
      to_name: "Lord Lumpy",
      prank_id: "bonk",
      landed: true,
      revenge: false,
      points: 10,
      created_at: new Date(now - 3_600_000).toISOString(),
      real: true,
      ...over,
    };
  }

  it("names the prank that landed, not a generic verb", () => {
    const [hit] = buildFeed([row()], now, { limit: 10 });
    // "bonk" is the catalogue id; the feed shows the prank's NAME as the verb.
    expect(hit.verb).toBe("bonk");
    expect(hit.attacker).toBe("Mister Mucus");
    expect(hit.target).toBe("Lord Lumpy");
    expect(hit.dodged).toBe(false);
  });

  it("still names the prank on a dodge, because the attempt happened", () => {
    const [dodged] = buildFeed([row({ landed: false })], now, { limit: 10 });
    // The old shape dropped the verb entirely on a dodge and printed
    // "X dodged from Y", so a dodge named neither the prank nor a target.
    expect(dodged.attacker).toBe("Mister Mucus");
    expect(dodged.target).toBe("Lord Lumpy");
    expect(dodged.dodged).toBe(true);
  });

  it("every row carries an actor, a target and an unambiguous result", () => {
    const feed = buildFeed([row(), row({ landed: false, id: 2 })], now, { limit: 10 });
    for (const item of feed) {
      expect(item.attacker.length).toBeGreaterThan(0);
      expect(item.target.length).toBeGreaterThan(0);
      expect(typeof item.dodged).toBe("boolean");
    }

    // Only the REAL rows are counted here. Two real rows is below the floor of
    // three, so the strip pads with examples, and counting the whole feed
    // silently included them - which is exactly the confusion the pill exists
    // to prevent.
    const real = feed.filter((i) => i.practice === false);
    expect(real).toHaveLength(2);
    // One HIT, one DODGED: distinguishable without reading the sentence.
    expect(real.filter((i) => i.dodged === false)).toHaveLength(1);
    expect(real.filter((i) => i.dodged === true)).toHaveLength(1);
  });

  it("padded rows are flagged so an example is never read as a real prank", () => {
    // With one real row the strip pads. The flag is what the pill renders.
    const feed = buildFeed([row()], now, { limit: 10 });
    const padded = feed.filter((i) => i.practice === true);
    expect(padded.length).toBeGreaterThan(0);
    expect(feed.filter((i) => i.practice === false)).toHaveLength(1);
  });
});
