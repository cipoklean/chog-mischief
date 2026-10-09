import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { getChog, getOwnerFromSnapshot, TOTAL_SUPPLY } from "@/lib/chogs";
import { displayTrait, displayTraits } from "@/lib/traits";
import { powersFor } from "@/game/powers";
import { pranksForPowers, getPrank } from "@/game/pranks";
import { AppShell } from "@/components/AppShell";
import { PrankTargetCta } from "@/components/PrankTargetCta";

/**
 * /chog/[id] - one shareable page per Chog. Prebuilding all 1,969 at build time
 * means a shared link renders instantly and never 500s, and the identity data it
 * shows comes from the harvested cache rather than a live RPC call.
 *
 * MARKUP PORTED from the prototype's `me` (profile) screen, because a Chog page
 * IS a profile page in this game: same art block, same stat row, same trait pills.
 * Only the two copy lines are specific to this page, and they replace the
 * prototype's because a public page has no wallet behind it.
 */

export function generateStaticParams() {
  return Array.from({ length: TOTAL_SUPPLY }, (_, i) => ({ id: String(i + 1) }));
}

type ChogParams = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: ChogParams): Promise<Metadata> {
  const { id } = await params;
  const chog = getChog(Number(id));
  if (!chog) return { title: "Chog not found - Chog Mischief" };

  const title = `${chog.name} - Chog Mischief`;
  // The description is what a link preview, a share card and a crawler read, so
  // it goes through the same mask as the page body. Only the Tier is named, and
  // Tier is never masked - but routing it through displayTrait means a masked
  // value cannot leak here if that ever changes.
  const description = `${displayTrait(chog.traits.Tier) || "Chog"} tier Chog Genesis #${chog.tokenId}. See its traits, pranks and chaos history.`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      // OpenSea's CDN serves the art directly, so the share card needs no
      // image-generation step to look right.
      images: chog.imageUrl ? [{ url: chog.imageUrl, width: 512, height: 512 }] : undefined,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: chog.imageUrl ? [chog.imageUrl] : undefined,
    },
  };
}

const RARITY_PILL: Record<string, string> = {
  common: "var(--x-p)",
  rare: "var(--x-m)",
  legendary: "var(--x-y)",
};

export default async function ChogPage({ params }: ChogParams): Promise<ReactNode> {
  const { id } = await params;
  const tokenId = Number(id);

  // Guard the range explicitly. `getChog` returning null covers a missing cache,
  // but an id like 999999 would otherwise render an empty shell.
  if (!Number.isInteger(tokenId) || tokenId < 1 || tokenId > TOTAL_SUPPLY) notFound();

  const chog = getChog(tokenId);
  if (!chog) notFound();

  const powers = powersFor(chog.traits);
  const pool = pranksForPowers(
    powers,
    powers.signaturePrankId,
    powers.accessoryPrankId,
    powers.legendaryPrankId,
  );
  const owner = getOwnerFromSnapshot(tokenId);

  // The signature and the accessory are distinct unlocks; show whichever exist.
  const unlocks = [
    { label: "Head", prank: getPrank(powers.signaturePrankId) },
    { label: "Accessory", prank: getPrank(powers.accessoryPrankId) },
    { label: "Weekly legendary", prank: getPrank(powers.legendaryPrankId) },
  ].filter((u): u is { label: string; prank: NonNullable<ReturnType<typeof getPrank>> } =>
    u.prank !== null,
  );

  // Through displayTraits, so a masked value is "[hidden]" here rather than the
  // raw word. This is the page most likely to be screenshotted or shared, so it
  // is the surface that most needs it.
  const traits = displayTraits(chog.traits);
  const tier = String(chog.traits.Tier ?? "Chog");

  return (
    <AppShell bare>
      {/* .x-chog is a plain stacked grid on phone (same 16px rhythm as the
          old direct .x-scr children) and two columns at 768px+. The chog
          detail page is not in the per-screen layout spec; the two-column
          treatment mirrors the Profile spec and is flagged in AGENTS.md. */}
      <div className="x-chog">
        <div className="x-chog__head">
          <div className="x-row x-sp">
            {/* minHeight is not decoration: a bare .x-pill renders 26px tall and
                breaks the 44px tap target that UI_RULES rule 7 requires. The
                padding in .x-pill is horizontal, so the height has to be set here. */}
            <Link
              href="/"
              className="x-pill"
              style={{
                background: "var(--x-card)",
                color: "var(--x-tx)",
                minHeight: "var(--tap)",
              }}
            >
              ← All Chogs
            </Link>
            <span className="x-pill" style={{ background: RARITY_PILL[String(powers.maxRarity)] ?? "var(--x-y)", color: "var(--x-ink)" }}>
              {tier}
            </span>
          </div>
        </div>

        <div className="x-chog__artcol">
          {chog.imageUrl ? (
            // Art comes from a third-party CDN, so a broken image must not leave a
            // blank hole in the layout.
            // eslint-disable-next-line @next/next/no-img-element
            <img className="x-big" src={chog.imageUrl} alt={chog.name} loading="eager" />
          ) : (
            <div
              className="x-big x-card"
          style={{ display: "grid", placeItems: "center" }}
          aria-label="Art unavailable"
        >
          <span className="x-mut">Art unavailable</span>
        </div>
      )}

          <div>
            <h2>{chog.name}</h2>
            <p className="x-mut x-sm">
              #{chog.tokenId.toLocaleString()} of {TOTAL_SUPPLY.toLocaleString()} · every Chog is a player
            </p>
          </div>

          <div className="x-g3">
            <div className="x-card x-stat">
              <b>{powers.basePoints}</b>
              <span className="x-sm">base pts</span>
            </div>
            <div className="x-card x-stat">
              <b>{Math.round(powers.dodgeChance * 100)}%</b>
              <span className="x-sm">dodge</span>
            </div>
            <div className="x-card x-stat">
              <b>{Math.round(powers.accuracy * 100)}%</b>
              <span className="x-sm">accuracy</span>
            </div>
          </div>
        </div>

        <div className="x-chog__side">
          <div className="x-card">
            <h3>Traits</h3>
            <div className="x-row x-wrap">
              {traits.map(({ key, label, value }) => (
                <span key={key} className="x-pill" style={{ background: "var(--x-card)", color: "var(--x-tx)" }}>
                  <span className="x-mut">{label}</span> {value}
                </span>
              ))}
            </div>
          </div>

          <div className="x-card">
            <h3>Signature pranks</h3>
            {unlocks.length === 0 ? (
              <p className="x-mut x-sm">
                This Chog has no signature prank. It can still pull {pool.length} prank
                {pool.length === 1 ? "" : "s"} from the common pool.
              </p>
            ) : (
              <div className="x-col" style={{ gap: 8 }}>
                {unlocks.map(({ label, prank }) => (
                  <div key={prank.id} className="x-row x-sp x-card" style={{ boxShadow: "none", padding: 10 }}>
                    <div>
                      <div style={{ fontFamily: "var(--x-d)", fontSize: 18 }}>{prank.name}</div>
                      <p className="x-sm x-mut">{prank.caption}</p>
                    </div>
                    <span className="x-pill" style={{ background: "var(--x-m)" }}>
                      {label}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="x-card">
            <h3>Owner</h3>
            {owner ? (
              <p className="x-sm">
                Held by{" "}
                <span style={{ fontFamily: "var(--font-geist-mono)" }}>
                  {owner.slice(0, 6)}…{owner.slice(-4)}
                </span>
              </p>
            ) : (
              <p className="x-mut x-sm">Ownership is read live from Monad when you sign in.</p>
            )}
            <p className="x-sm x-mut">
              Chaos history is keyed to the token, so it travels with the Chog.
            </p>
          </div>

          <div className="x-card">
            <h3>Prank {chog.name}</h3>
            <p className="x-sm x-mut">
              You need to hold a Chog to prank one. Connect the wallet that holds
              it. Signing only, no gas. Holding one already? This link preselects{" "}
              {chog.name} as your target.
            </p>
            <PrankTargetCta tokenId={chog.tokenId} chogName={chog.name} />
          </div>
        </div>
      </div>
    </AppShell>
  );
}