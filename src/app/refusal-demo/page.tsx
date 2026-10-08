import { RefusalDemoClient } from "./RefusalDemoClient";

/**
 * /refusal-demo — server shell for the design harness.
 *
 * There is no data to load here: the shell exists only to mount a client
 * component, so it needs no caching directive at all. The daily-reset instant is
 * computed in the client, where a wall clock is legitimate.
 *
 * Note what this file is NOT allowed to do, having tried both:
 *   - `export const dynamic = "force-dynamic"` -> rejected, "not compatible with
 *     nextConfig.cacheComponents"
 *   - `new Date()` while prerendering -> rejected as an unstable value
 * So the reset time lives in the client and this shell stays empty of state.
 *
 * Never linked from the tab bar: it is a review harness, not a game screen.
 */
export default function RefusalDemo() {
  return <RefusalDemoClient />;
}
