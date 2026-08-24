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

/**
 * A Node repo with both halves: an express server and an HTTP-calling client.
 * No corpus repo has both, so this fixture is the only gate on the client-call
 * reader and its route matching (M5a).
 */
export const MINI_FULLSTACK = resolve(here, "fixtures/mini-fullstack");

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
 *  one known file instead of reimplementing the extractor's file selection.
 *  Drift mode the pin does not catch: if a corpus repo adds a second DDL file,
 *  the extractor sees the extra tables and this oracle does not, and the
 *  failure will look like a psq bug rather than a stale pin. */
export const CORPUS_DDL = {
  corpus-repo-d: resolve(CORPUS.corpus-repo-d, "server/src/state/db.ts"),
  corpus-repo-e: resolve(CORPUS.corpus-repo-e, "src/db.ts"),
} as const;

// Assumes the SQLite-ish DDL subset the corpus actually uses: plain
// `CREATE [TEMP[ORARY]] TABLE [IF NOT EXISTS] name`. Known misses, none of
// which occur in the corpus today:
//   - `CREATE VIRTUAL TABLE fts USING fts5(...)` -> no match
//   - `CREATE TABLE main.foo`                    -> captures `main`
//   - `CREATE TABLE "my table"`                  -> captures `my`
//   - non-ASCII identifiers truncate at the first non-`\w` character
//   - a real declaration sharing a line with `//`, `/*` or `--` anywhere
//     earlier on the line is skipped (`/* v2 */ CREATE TABLE foo`, but
//     equally `count--; CREATE TABLE foo`) -> no match
//   - a real declaration on a line whose first non-space character is `*`
//     (a JSDoc continuation line) is skipped -> no match
//   - a `CREATE TABLE` alone on an unmarked line inside a multi-line
//     `/* ... */` block is captured as a real table -> ghost match
//
// How each miss surfaces at the corpus assertion (a `toEqual` against the
// extractor's names, packages/extract/test/node.test.ts): a wrong captured
// name (bullets 2-4) or a skipped declaration (bullets 5-6) reddens it
// outright. The virtual-table miss (bullet 1) is the one that can pass
// quietly: the extractor's own gate is the literal words `CREATE TABLE`,
// so both sides omit the table and the lists agree. The ghost match
// (bullet 7) reddens too, but misattributes the failure — the diff reads
// as "psq missed a table" and sends the reader into the extractor, when
// the invented name came from this oracle. None of this is a reason to
// "fix" the regex; update the corpus pin or this catalogue instead.
//
// Every bullet above is pinned by exactly one characterization test in
// oracle.test.ts, and every such test names its bullet by ordinal — 1:1,
// no orphan in either direction. Update a bullet and its test together.
//
// This file's own prose contains `CREATE TABLE` tokens (the bullets above,
// plus one unsuppressed token in an error message below that matches nothing
// only because a backtick follows `TABLE` directly — an accident, not a
// guarantee). Never point the oracle at this file.
const CREATE_TABLE_NAME =
  /\bCREATE\s+(?:TEMP(?:ORARY)?\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"\[]?(\w+)[`"\]]?/gi;

/** Table names a human would find by reading the file, sorted. The independent
 *  half of the corpus assertion: the extractor runs the DDL through SQLite,
 *  this just reads the text. */
export function tablesInDdlText(text: string): string[] {
  const names = new Set<string>();
  for (const match of text.matchAll(CREATE_TABLE_NAME)) {
    // A comment marker earlier on the same line means the match is commented
    // out, not a declaration: SQL `--`, TS `//` or `/*`, or a JSDoc
    // continuation line whose first non-whitespace character is `*`. Only the
    // slice from the previous newline is inspected, so a `count--;` line
    // elsewhere in the file cannot suppress a real declaration. Deliberate
    // limit: a CREATE TABLE on its own line inside a multi-line block comment
    // with no leading `*` still slips through; a full comment-state machine
    // is not worth it for these pinned files.
    const lineStart = text.lastIndexOf("\n", match.index) + 1;
    const before = text.slice(lineStart, match.index);
    if (before.includes("--") || before.includes("//") || before.includes("/*")) continue;
    if (/^\s*\*/.test(before)) continue;
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
