/**
 * Resolver hooks backing `scripts/ts-resolve.mjs`.
 * Keep the two in sync — this is the file Node actually loads.
 */

import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';

const SRC_ROOT = fileURLToPath(new URL('../src/', import.meta.url));

const CANDIDATES = ['', '.ts', '.tsx', '/index.ts', '/index.tsx', '.mjs', '.js'];

export function resolve(specifier, context, nextResolve) {
  let target = null;

  if (specifier.startsWith('@/')) {
    target = resolvePath(SRC_ROOT, specifier.slice(2));
  } else if (specifier.startsWith('./') || specifier.startsWith('../')) {
    const fromDir = context.parentURL ? dirname(fileURLToPath(context.parentURL)) : process.cwd();
    target = resolvePath(fromDir, specifier);
  }

  if (target) {
    for (const ext of CANDIDATES) {
      if (existsSync(target + ext)) {
        return nextResolve(pathToFileURL(target + ext).href, context);
      }
    }
  }

  return nextResolve(specifier, context);
}