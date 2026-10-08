/**
 * Minimal TypeScript-path resolver so plain `node scripts/*.mjs` can import our
 * `.ts` source modules directly.
 *
 * Why: the point of the live verification scripts is to exercise the SAME code
 * the server runs. Duplicating that logic into a plain-JS script would let the
 * script and the app drift, and a drifting verification script is worse than
 * no verification at all.
 *
 * It resolves two things Node cannot do on its own:
 *   - extensionless relative imports (`./chain` -> `./chain.ts`)
 *   - the `@/*` path alias defined in tsconfig.json
 *
 * Usage:  node --import ./scripts/ts-resolve.mjs scripts/verify-holder.mjs
 */

import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register('./ts-resolve-hooks.mjs', import.meta.url);

export const tsAlias = '@';
export const tsBase = pathToFileURL(new URL('../src/', import.meta.url).pathname).href;