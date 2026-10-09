import { RefusalDemoClient } from "./RefusalDemoClient";
import { getChog } from "@/lib/chogs";
import { getGuestChog } from "@/lib/guest";

/**
 * /refusal-demo — server shell for the design harness.
 *
 * There is no game data to load here: the shell exists to mount a client
 * component, so it needs no caching directive at all. The daily-reset instant is
 * computed in the client, where a wall clock is legitimate.
 *
 * Note what this file is NOT allowed to do, having tried both:
 *   - `export const dynamic = "force-dynamic"` -> rejected, "not compatible with
 *     nextConfig.cacheComponents"
 *   - `new Date()` while prerendering -> rejected as an unstable value
 * So the reset time lives in the client and this shell stays empty of state.
 *
 * It DOES resolve the Guest Chog's metadata, the same way /guest does, because
 * the harness now also mounts the responsive rails — and the guest-mode left
 * rail shows that Chog. `chogs.ts` reads node:fs, so the lookup must happen
 * here, in a server component, and travel down as plain props.
 *
 * Never linked from the tab bar: it is a review harness, not a game screen.
 */
export default function RefusalDemo() {
  const lookup = (id: number) => {
    const c = getChog(id);
    return c ? { imageUrl: c.imageUrl, traits: c.traits } : null;
  };

  return <RefusalDemoClient guest={getGuestChog(lookup)} />;
}
