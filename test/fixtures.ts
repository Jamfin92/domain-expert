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

/**
 * A Vite-shaped React client: solution-style tsconfig (project references,
 * `@/*` paths), components, hooks, services. The only hermetic gate on
 * project-reference resolution and component attribution (M5b).
 */
export const MINI_REACT = resolve(here, "fixtures/mini-react");

/**
 * Two referenced projects with EQUAL file counts and reversed declaration
 * order, so the winner can only come from the explicit lexicographic
 * tiebreak — never from reference order or sort stability.
 */
export const MINI_SOLUTION_TIE = resolve(here, "fixtures/mini-solution-tie");

/** Neither of the above, so psq must say so rather than report an empty repo. */
export const NOT_A_PROJECT = resolve(here, "fixtures/not-a-project");

/**
 * Real repos on the developer's machine, used to validate extraction against
 * ground truth psq did not produce (an EF migration snapshot, a live schema).
 * They are private and not part of this repo, so both the paths and the
 * ground-truth expectations live in a gitignored `test/corpus.local.json`
 * (shape documented by `test/corpus.local.example.json`). Corpus tests skip
 * when the config or a repo is absent rather than failing for a reason
 * unrelated to the code.
 */
export type CorpusKey = "repoA" | "repoAClient" | "repoB" | "repoC" | "repoD" | "repoE";

export interface CorpusRepo {
  /** Absolute path to the repo (or the project directory inside it). */
  path: string;
  /** Repo-relative path to the single pinned DDL file, where one exists.
   *  Pinned so the oracle reads one known file instead of reimplementing the
   *  extractor's file selection. Drift mode the pin does not catch: if the
   *  repo adds a second DDL file, the extractor sees the extra tables and the
   *  oracle does not, and the failure will look like a psq bug rather than a
   *  stale pin. */
  ddl?: string;
  /** Ground-truth expectations, grouped by the test file that consumes them.
   *  Data, not code: no name from a private repo may appear in a committed
   *  test. */
  expect: {
    node?: CorpusNodeExpect;
    dotnet?: CorpusDotnetExpect;
    structure?: CorpusStructureExpect;
    fluent?: CorpusFluentExpect;
    graph?: CorpusGraphExpect;
    quiz?: CorpusQuizExpect;
  };
}

export interface CorpusNodeExpect {
  /** Hand-verified floor of table names; must never regress even if the
   *  text oracle breaks too. */
  tableFloor?: string[];
  minTables?: number;
  noWarnings?: boolean;
  wideTable?: { name: string; propertyCount: number; keys: string[] };
  relationIds?: string[];
  absentForeignKey?: string;
  houseStyleWarning?: string;
  zodShape?: string;
  zodFieldsShape?: { name: string; contains: string };
  mirrorPairs?: string[];
  routes?: string[];
  routeCount?: number;
  routeContains?: string;
  ownerTable?: string;
  oneToOneRelation?: string;
  utilityShape?: { name: string; fields: string[] };
  unionShape?: { name: string; discriminator: string };
  enumShape?: { name: string; members: number };
  shapeName?: string;
  /** Hand-verified component attributions for pinned call sites (M5b). */
  componentChains?: { file: string; line: number; components: string[] }[];
}

export interface CorpusDotnetExpect {
  contextName?: string;
  entityCount?: number;
  identityEntity?: string;
  notAnEntity?: string;
  relationCount?: number;
  navDup?: { dependent: string; principal: string; foreignKey: string };
  tableNames?: [entity: string, table: string][];
  identityMembers?: string[];
  identityKeyType?: string;
  compositeKey?: { entity: string; keys: string[] };
  singleKey?: { entity: string; keys: string[] };
  facets?: {
    entity: string;
    maxLengthProp: { name: string; maxLength: number };
    nullableProp: string;
    collectionProp: { name: string; baseType: string };
    precisionProp: { entity: string; name: string; precision: [number, number] };
  };
  relation?: {
    dependent: string;
    principal: string;
    foreignKey: string;
    principalNavigation: string;
    dependentNavigation: string;
  };
  optionalRelation?: { dependent: string; principal: string; deleteBehavior: string };
  shadowEntity?: { name: string; namespace: string; fileContains: string };
  cascade?: { count: number; behavior: string };
}

export interface CorpusStructureExpect {
  contextFile: string;
  contextType: string;
  namespace: string;
  domainUsing: string;
  contextBase: string;
  dbSetCount: number;
  dbSetContains: string;
  entityFile: string;
  entityType: string;
  requiredProp: { name: string; type: string; attributes: string[]; attrArgs: string[] };
  nullableValueProp: { name: string; type: string };
  nullableRefProp: { name: string; type: string };
  collectionProp: { name: string; type: string; initializer: string };
  nullForgivingProps: { name: string; type: string }[];
  constantsFile: string;
}

export interface CorpusFluentExpect {
  contextFile?: string;
  contextType?: string;
  minRelationChains?: number;
  relChain?: { entity: string; hasOne: string[]; withMany: string[]; foreignKey: string[] };
  compositeKey?: { entity: string; members: string[] };
  minIndexes?: number;
  uniqueIndex?: { entity: string; members: string[] };
  onDelete?: { count: number; behavior: string };
}

export interface CorpusGraphExpect {
  hub: { entity: string; degree: number };
  path: { from: string; to: string; via: string[] };
  unreachable: string;
  orphans: string[];
}

export interface CorpusQuizExpect {
  minQuestions: number;
  generatorCount: number;
  namespacedEntity: { raw: string; normalized: string };
  aliasEntity: { name: string; spellings: string[]; nonMatch: string };
  plurals: [singular: string, plural: string][];
}

const corpusConfigPath = resolve(here, "corpus.local.json");

const corpusConfig: Partial<Record<CorpusKey, CorpusRepo>> | null = existsSync(corpusConfigPath)
  ? (JSON.parse(readFileSync(corpusConfigPath, "utf8")) as Partial<Record<CorpusKey, CorpusRepo>>)
  : null;

/**
 * The corpus entry for a repo, or null when it cannot be used: no local
 * config, no entry, repo not on disk, or PSQ_NO_CORPUS=1 (which forces the
 * hermetic path so the skip behavior itself can be exercised on a machine
 * that does have the repos).
 */
export function corpusRepo(key: CorpusKey): CorpusRepo | null {
  if (process.env["PSQ_NO_CORPUS"] === "1") return null;
  const repo = corpusConfig?.[key];
  if (!repo || !existsSync(repo.path)) return null;
  return repo;
}

/** Absolute path of a corpus repo's pinned DDL file. */
export function corpusDdl(repo: CorpusRepo): string {
  if (!repo.ddl) throw new Error(`corpus repo at ${repo.path} pins no DDL file`);
  return resolve(repo.path, repo.ddl);
}

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
