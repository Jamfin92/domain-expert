import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

/** Self-contained fixtures committed to this repo. Always present. */
export const MINI_EFCORE = resolve(here, "fixtures/mini-efcore");

/**
 * The Node counterpart. Resolves `zod` and `express` through this repo's own
 * node_modules, which is the only way the zod and route readers can be covered
 * without vendoring a dependency tree into a fixture.
 */
export const MINI_NODE = resolve(here, "fixtures/mini-node");

/** Neither of the above, so psq must say so rather than report an empty repo. */
export const NOT_A_PROJECT = resolve(here, "fixtures/not-a-project");

/**
 * Real repos on this machine, used to validate extraction against ground
 * truth that psq did not produce (an EF migration snapshot, a live schema).
 * They are not part of this repo, so corpus tests skip when they are absent
 * rather than failing for a reason unrelated to the code.
 */
export const CORPUS = {
  corpus-repo-a: "~/Developer/corpus-repo-a/server/src/corpus-repo-a.Api",
  corpus-repo-b: "~/Developer/corpus-repo-b/src/corpus-repo-b.Api",
  corpus-repo-c: "~/Developer/corpus-repo-c",
  corpus-repo-d: "~/Developer/corpus-repo-d",
  corpus-repo-e: "~/Developer/corpus-repo-e",
} as const;

export function hasCorpus(path: string): boolean {
  // PSQ_NO_CORPUS=1 forces the hermetic path, so the skip behavior itself can
  // be exercised on a machine that does happen to have the repos.
  if (process.env["PSQ_NO_CORPUS"] === "1") return false;
  return existsSync(path);
}

/** The file that holds each corpus repo's schema. Pinned, so the oracle reads
 *  one known file instead of reimplementing the extractor's file selection. */
export const CORPUS_DDL = {
  corpus-repo-d: resolve(CORPUS.corpus-repo-d, "server/src/state/db.ts"),
  corpus-repo-e: resolve(CORPUS.corpus-repo-e, "src/db.ts"),
} as const;

const CREATE_TABLE_NAME =
  /\bCREATE\s+(?:TEMP(?:ORARY)?\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"\[]?(\w+)[`"\]]?/gi;

/** Table names a human would find by reading the file, sorted. The independent
 *  half of the corpus assertion: the extractor runs the DDL through SQLite,
 *  this just reads the text. */
export function tablesInDdlText(text: string): string[] {
  const names = new Set<string>();
  for (const match of text.matchAll(CREATE_TABLE_NAME)) {
    // A `--` earlier on the same line means the match is commented out
    // (`-- CREATE TABLE old_thing`), not a declaration. Only the slice from
    // the previous newline is inspected, so a `count--;` line elsewhere in
    // the file cannot suppress a real declaration.
    const lineStart = text.lastIndexOf("\n", match.index) + 1;
    if (text.slice(lineStart, match.index).includes("--")) continue;
    names.add(match[1]!);
  }
  return [...names].sort();
}

/** Throws when the file is missing or declares nothing, so a moved schema
 *  fails loudly instead of comparing [] to []. */
export function tablesDeclaredIn(path: string): string[] {
  if (!existsSync(path)) throw new Error(`no DDL file at ${path}`);
  const tables = tablesInDdlText(readFileSync(path, "utf8"));
  if (tables.length === 0) throw new Error(`${path} declares no CREATE TABLE`);
  return tables;
}
