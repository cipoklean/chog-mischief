import Link from "next/link";
import type { ReactNode } from "react";

/**
 * TopBar — the sticky header. Ported from the prototype's `.x-top` block.
 *
 * The prototype hides the bar on the landing and pick screens; that rule lives
 * in the AppShell rather than here, because it depends on the session state.
 */

export interface TopBarProps {
  points: number;
  ammo: number;
  avatarUrl?: string | null;
  /** /chog/<id> for the signed-in Chog, or null when signed out. */
  profileHref?: string | null;
}

export function TopBar({ points, ammo, avatarUrl, profileHref }: TopBarProps) {
  return (
    <header className="x-top x-row x-sp">
      <Link href="/hq" className="x-logo">
        CHOG MISCHIEF
      </Link>
      <div className="x-row">
        <span className="x-pill" title="Points">
          ⭐ {points.toLocaleString()}
        </span>
        <span className="x-pill" style={{ background: "var(--x-g)" }} title="Pranks left today">
          💣 {ammo}
        </span>
        {avatarUrl ? (
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
      </div>
    </header>
  );
}

export interface TabBarProps {
  current: "hq" | "prank" | "inbox" | "ranks" | "me";
  inboxCount: number;
}

const TABS: { key: TabBarProps["current"]; icon: string; label: string; href: string }[] = [
  { key: "hq", icon: "🏠", label: "HQ", href: "/hq" },
  { key: "prank", icon: "💣", label: "Prank", href: "/prank" },
  { key: "inbox", icon: "📬", label: "Inbox", href: "/inbox" },
  { key: "ranks", icon: "🏆", label: "Ranks", href: "/ranks" },
  { key: "me", icon: "😈", label: "Me", href: "/me" },
];

export function TabBar({ current, inboxCount }: TabBarProps) {
  return (
    <nav className="x-tabs" aria-label="Screens">
      {TABS.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
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
  current?: TabBarProps["current"];
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
   * always knows their progress is temporary.
   */
  banner?: string;
}

/**
 * AppShell — the `.x-app` frame every screen sits inside.
 *
 * In the prototype this frame is a single div with the header, the screen
 * container and the tab bar as siblings. In the App Router the frame is this
 * component and the screen is the route, so the tab bar needs to know which
 * screen it is on — hence `current` rather than the prototype's aria-current
 * toggling in one render pass.
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
}: AppShellProps) {
  return (
    <div className="x-app">
      {bare ? null : (
        <TopBar points={points} ammo={ammo} avatarUrl={avatarUrl} profileHref={profileHref} />
      )}
      {banner ? (
        <div
          role="status"
          style={{
            position: "sticky",
            top: 0,
            zIndex: 4,
            padding: "6px 8px",
            background: "var(--x-y)",
            color: "var(--x-ink)",
            borderBottom: "3px solid var(--x-ink)",
            font: "var(--type-tag)",
            fontWeight: 600,
            textAlign: "center",
          }}
        >
          {banner}
        </div>
      ) : null}
      <main className="x-scr">{children}</main>
      {bare || !current ? null : (
        <TabBar current={current} inboxCount={inboxCount} />
      )}
    </div>
  );
}