import GuestClient from "./GuestClient";
import { getChog } from "@/lib/chogs";
import { getGuestChog, getRivals } from "@/lib/guest";
import type { ReactNode } from "react";

/**
 * /guest — the judge path. STATES.md §2, verbatim.
 *
 * Server shell. The Chog metadata lives in the harvested cache, which reads
 * node:fs — a server-only module — so the lookup happens HERE and is passed down
 * as plain props. Importing `chogs` from the client half instead fails the
 * build: Turbopack refuses to put node:fs in a browser chunk ("the chunking
 * context does not support external modules").
 */
export default function GuestPage(): ReactNode {
  const lookup = (id: number) => {
    const c = getChog(id);
    return c ? { imageUrl: c.imageUrl, traits: c.traits } : null;
  };

  return <GuestClient guest={getGuestChog(lookup)} rivals={getRivals(lookup)} />;
}
