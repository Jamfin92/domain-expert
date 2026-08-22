import { createRequire } from "node:module";

/**
 * Loads node:sqlite without letting a bundler see a bare `node:sqlite`
 * specifier.
 *
 * Vite (and therefore vitest) resolves `node:sqlite` by stripping the prefix
 * and looking for a package called "sqlite", because its list of Node
 * builtins predates the module. Requiring it at runtime sidesteps the
 * resolver entirely, and keeps the workaround in one documented place instead
 * of in bundler config that the CLI does not even use.
 *
 * Types still come from `node:sqlite` through `import type`, which is erased.
 */
const nodeRequire = createRequire(import.meta.url);

const sqlite = nodeRequire("node:sqlite") as typeof import("node:sqlite");

export const { DatabaseSync } = sqlite;
export type { DatabaseSync as Database } from "node:sqlite";
