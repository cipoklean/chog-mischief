import Link from "next/link";
import type { ReactNode } from "react";
import { ConnectWallet } from "./ConnectWallet";
import { ChogSwitcher, type SwitcherChog } from "./ChogSwitcher";
import { KeyboardShortcuts } from "./KeyboardShortcuts";

/**
 * TopBar - the sticky header. Ported from the prototype's `.x-top` block.
 *
 * PHONE (below 768px): logo + points pill + ammo pill + avatar chip, exactly
 * as before. The nav and the header wallet button are in the DOM but hidden
 * with display:none (see globals.css), so nothing about the phone layout
 * changes - and a resize to desktop reveals them without a remount.
 *
 * TABLET/DESKTOP (768px+): the same bar gains a centred nav (HQ, Prank,
 * Inbox with a red count, Ranks, Profile - Prank biggest and yellow) and the
 * wallet button on the right, and the bottom tab bar disappears.
 */

export type TabKey = "hq" | "prank" | "inbox" | "ranks" | "me";

export interface TopBarProps {
  points: number;
  ammo: number;
  avatarUrl?: string | null;
  /** /chog/<id> for the signed-in Chog, or null when signed out. */
  profileHref?: string | null;
  current: TabKey | null;
  inboxCount: number;
  /** When present, the avatar chip opens the Chog switcher instead of linking. */
  switcherChogs?: SwitcherChog[] | null;
}

/** Shared by the bottom tab bar (phone) and the header nav (768px+). */
const TABS: { key: TabKey; icon: string; label: string; href: string; shortcut?: string }[] = [
  { key: "hq", icon: "🏠", label: "HQ", href: "/hq" },
  { key: "prank", icon: "💣", label: "Prank", href: "/prank", shortcut: "P" },
  { key: "inbox", icon: "📬", label: "Inbox", href: "/inbox", shortcut: "I" },
  { key: "ranks", icon: "🏆", label: "Ranks", href: "/ranks" },
  { key: "me", icon: "😈", label: "Profile", href: "/me" },
];

export function TopBar({
  points,
  ammo,
  avatarUrl,
  profileHref,
  current,
  inboxCount,
  switcherChogs,
}: TopBarProps) {
  return (
    <header className="x-top x-row x-sp">
      {/* prefetch={false}: /hq is not built yet - see the nav note below. */}
      <Link href="/hq" className="x-logo" prefetch={false}>
        CHOG MISCHIEF
      </Link>

      {/* The nav that replaces the tab bar at 768px+. Hidden below it.
          prefetch={false}: these five screens do not exist yet, so Next's
          automatic RSC prefetch would fire five 404 requests on every page
          load. The links still navigate client-side; they just do not
          pre-load routes that are not there. */}
      <nav className="x-nav" aria-label="Screens">
        {TABS.map((tab) => (
          <Link
            key={tab.key}
            href={tab.href}
            prefetch={false}
            className={`x-nav__btn${tab.key === "prank" ? " x-nav__btn--prank" : ""}`}
            {...(tab.key === current ? { "aria-current": "page" as const } : {})}
            title={tab.shortcut ? `${tab.label} (${tab.shortcut})` : tab.label}
          >
            {tab.icon} {tab.label}
            {tab.key === "inbox" && inboxCount > 0 ? (
              <span className="x-badge">{inboxCount}</span>
            ) : null}
          </Link>
        ))}
      </nav>

      <div className="x-row">
        <span className="x-pill" title="Chaos points">
          ⭐ {points.toLocaleString()}
        </span>
        {/* Phone-only: hidden at 768px+ by .x-top__ammo (Hark's header spec
            lists points + avatar + wallet, not ammo). */}
        <span className="x-pill x-top__ammo" title="Pranks left today">
          💣 {ammo}
        </span>
        {switcherChogs && switcherChogs.length > 0 && avatarUrl ? (
          <ChogSwitcher chogs={switcherChogs} avatarUrl={avatarUrl} />
        ) : avatarUrl ? (
          <Link
            href={profileHref ?? "/hq"}
            aria-label="Your Chog"
            style={{
              background: "none",
              border: 0,
              padding: 0,
              cursor: "pointer",
              minWidth: "var(--tap)",
              minHeight: "var(--tap)",
              display: "grid",
              placeItems: "center",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="x-av" src={avatarUrl} alt="" style={{ width: 40, height: 40 }} />
          </Link>
        ) : null}
        {/* Header wallet button - 768px+ only. */}
        <div className="x-top__wallet">
          <ConnectWallet label="🔗 Connect" />
        </div>
      </div>
    </header>
  );
}

export interface TabBarProps {
  current: TabKey;
  inboxCount: number;
}

export function TabBar({ current, inboxCount }: TabBarProps) {
  return (
    <nav className="x-tabs" aria-label="Screens">
      {TABS.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          // Same reason as the header nav: these five screens are not built
          // yet, so the router must not fetch their RSC payloads on load.
          prefetch={false}
          className="x-tab"
          {...(tab.key === current ? { "aria-current": "page" as const } : {})}
        >
          <b>{tab.icon}</b>
          {tab.label}
          {tab.key === "inbox" && inboxCount > 0 ? (
            <span className="x-badge">{inboxCount}</span>
          ) : null}
        </Link>
      ))}
    </nav>
  );
}

export interface AppShellProps {
  children: ReactNode;
  current?: TabKey;
  points?: number;
  ammo?: number;
  inboxCount?: number;
  avatarUrl?: string | null;
  profileHref?: string | null;
  /** Hide the header and tab bar on the landing and pick screens. */
  bare?: boolean;
  /**
   * Slim sticky strip under the top bar. STATES.md §2: guest mode shows
   * "Guest mode · progress resets · Own a Chog to keep it" here, so the player
   * always knows their progress is temporary. Spans the full shell width at
   * 768px+.
   */
  banner?: string;
  /**
   * Left rail content ("Your Chogs", daily reset, chaos feed). Rendered in the
   * DOM at EVERY screen size - display:none below 1200px, per Hark's rule
   * that layout switches with CSS only. Never conditionally render this.
   */
  leftRail?: ReactNode;
  /**
   * Right rail content (Incoming, weekly top 5, rivalries, and the feed on
   * tablet). Same render-then-hide rule: in the DOM always, hidden below
   * 768px.
   */
  rightRail?: ReactNode;
  /** When present, the avatar chip opens the Chog switcher. */
  switcherChogs?: SwitcherChog[] | null;
}

/**
 * AppShell - the `.x-app` frame every screen sits inside.
 *
 * In the prototype this frame is a single div with the header, the screen
 * container and the tab bar as siblings. In the App Router the frame is this
 * component and the screen is the route, so the tab bar needs to know which
 * screen it is on - hence `current` rather than the prototype's aria-current
 * toggling in one render pass.
 *
 * ── The .x-body wrapper ─────────────────────────────────────────────────────
 * On phone it is `display: contents`, so the rails and the main column take
 * part in .x-app's flex column exactly as direct children did before - the
 * phone DOM and layout are unchanged by its existence. At 768px+ it becomes
 * the grid holding main beside the right rail, and at 1200px+ beside both.
 * That is what lets one static DOM serve all three layouts with zero
 * JavaScript.
 */
export function AppShell({
  children,
  current,
  points = 0,
  ammo = 0,
  inboxCount = 0,
  avatarUrl,
  profileHref,
  bare = false,
  banner,
  leftRail,
  rightRail,
  switcherChogs,
}: AppShellProps) {
  const hasRails = Boolean(leftRail || rightRail);

  return (
    <div className={`x-app${hasRails ? " x-app--rails" : ""}`}>
      {bare ? null : (
        <TopBar
          points={points}
          ammo={ammo}
          avatarUrl={avatarUrl}
          profileHref={profileHref}
          current={current ?? null}
          inboxCount={inboxCount}
          switcherChogs={switcherChogs}
        />
      )}
      {banner ? (
        <div role="status" className="x-banner">
          {banner}
        </div>
      ) : null}
      <div className="x-body">
        {leftRail ? (
          <aside className="x-rail x-rail--l" aria-label="Your Chogs, reset and chaos feed">
            {leftRail}
          </aside>
        ) : null}
        <main className="x-scr">{children}</main>
        {rightRail ? (
          <aside className="x-rail x-rail--r" aria-label="Incoming, leaderboard and rivalries">
            {rightRail}
          </aside>
        ) : null}
      </div>
      {bare || !current ? null : <TabBar current={current} inboxCount={inboxCount} />}
      <KeyboardShortcuts />
    </div>
  );
}
