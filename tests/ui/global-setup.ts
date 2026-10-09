import { cssPreflight, describeFailure, resolveBaseUrl, resolveBuildDir } from "./css-preflight";

/**
 * Global setup - the layout call: "make the served-CSS check part of the Playwright
 * setup, so it fails loudly instead of relying on memory."
 *
 * This runs once, before ANY spec. It throws on failure, which aborts the entire
 * run rather than letting 10 specs each report a confusing overflow against an
 * unstyled page.
 */
export default async function globalSetup(): Promise<void> {
  const result = await cssPreflight(resolveBaseUrl(), resolveBuildDir());

  if (!result.ok) {
    throw new Error(describeFailure(result));
  }

  console.log(
    `CSS preflight OK - ${result.servedPath} (${result.servedBytes} bytes) matches the current build.`,
  );
}
