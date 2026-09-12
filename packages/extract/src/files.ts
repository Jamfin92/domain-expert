import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** Field separator for the digest framing; cannot occur in a path. */
const NUL = Buffer.from([0]);

/** Directories that never contain source worth parsing. */
const SKIP = new Set([
  "node_modules", "bin", "obj", ".git", "dist", "build", ".next", ".vs",
  "TestResults", "coverage", ".venv", "__pycache__",
]);

/**
 * Walk a repo collecting files with the given extensions.
 * Read-only: psq never writes into a target repo except on explicit export.
 */
export function walk(root: string, exts: string[], limit = 20000): string[] {
  const out: string[] = [];
  const stack = [root];
  while (stack.length > 0 && out.length < limit) {
    const dir = stack.pop()!;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (SKIP.has(name)) continue;
      const full = join(dir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) stack.push(full);
      else if (exts.some((e) => name.endsWith(e))) out.push(full);
    }
  }
  // Stable order so a graph is reproducible across machines.
  return out.sort();
}

export function repoRelative(root: string, file: string): string {
  return relative(root, file).split(sep).join("/");
}

/**
 * Source that describes the repo, as opposed to source that exercises it.
 *
 * A test fixture's CREATE TABLE is not the repo's schema and its interfaces are
 * not the repo's shapes, so reading them would report a project psq invented.
 */
export function isTestFile(repoRelativePath: string): boolean {
  return (
    /(^|\/)(test|tests|__tests__|fixtures|__fixtures__)\//.test(repoRelativePath) ||
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(repoRelativePath)
  );
}

/**
 * Extensions and whole filenames whose contents decide what extraction reads.
 *
 * `walk`'s matcher is `endsWith`, so whole filenames work as suffixes.
 *
 * This list is the source of truth, and `detectProvider`'s list (`detect.ts`)
 * is a strict SUBSET of it, not the other way round. Extraction does not walk
 * once and it does not decide its file set by walking at all:
 *
 * - the TS reader's `walk(root, [".ts",".tsx"])` is only a FALLBACK; the
 *   primary path builds a `ts.Program` from a `tsconfig.json` file list,
 *   and referenced configs and a nested `tsconfig.json` (`nodeRootFor`) can
 *   re-root the whole TS half of a fullstack graph;
 * - `detectProvider` branches on `existsSync(package.json | tsconfig.json)`,
 *   so the provider itself can flip on a file no walk returns;
 * - with `allowJs` the program reads `.js`/`.jsx`, and `.mts`/`.cts` are read
 *   by the program but never match `walk`'s `endsWith(".ts")`.
 *
 * `.js`, `.jsx` and `package.json` are read only under some configurations.
 * Hashing them unconditionally OVER-invalidates, which costs a re-extract and
 * is the safe direction. Missing one does not over-invalidate: it serves a
 * permanently stale graph with no user-visible escape, and makes psq assert
 * facts about a repo that are no longer true (CLAUDE.md rule 2).
 *
 * Stated limit, deliberately not closed: `ts.createProgram` resolves `.d.ts`
 * and lib files inside `node_modules`, which `walk` skips. A change to a
 * dependency's types will not move this digest. Repo source changes will.
 *
 * The rest of `SKIP` carries the same risk and the same cost. All eleven of the
 * other entries are skipped: `bin`, `obj`, `.git`, `dist`,
 * `build`, `.next`, `.vs`, `TestResults`, `coverage`, `.venv`, `__pycache__`.
 * A tsconfig whose `include` reaches generated sources under any of them hands
 * the program a file set this digest cannot see,
 * and a change confined to those directories leaves a permanently stale graph.
 * Not closed because hashing build output would re-invalidate on every build,
 * and `SKIP` is shared with the extraction walks — narrowing it here alone
 * would make the digest and the readers disagree about what the repo is.
 */
export const DIGEST_EXTENSIONS = [
  ".cs", ".csproj", ".ts", ".tsx", ".mts", ".cts", ".js", ".jsx",
  "tsconfig.json", "package.json",
];

/**
 * A content fingerprint of everything extraction could read in `root`.
 *
 * Walks `DIGEST_EXTENSIONS` and hashes the sorted result. Each entry
 * contributes `relpath + NUL + byteLength + NUL + contents`, so that a byte
 * moving across the path/contents boundary cannot collide: without the
 * framing, one file `a.ts` holding `"b.tsZ"` and the two files `a.ts` (empty)
 * and `b.ts` (`"Z"`) concatenate to the same bytes.
 *
 * Hashing contents rather than mtimes is deliberate: the whole walked set
 * costs 1-11ms to hash, and an mtime heuristic lies after a `git checkout`.
 */
export function digestOf(root: string): string {
  const h = createHash("sha256");
  for (const file of walk(root, DIGEST_EXTENSIONS)) {
    let contents: Buffer;
    try {
      contents = readFileSync(file);
    } catch {
      // A file that vanished between the walk and the read contributes
      // nothing. Skipping is the same answer the extractor would give.
      continue;
    }
    h.update(repoRelative(root, file));
    h.update(NUL);
    h.update(String(contents.byteLength));
    h.update(NUL);
    h.update(contents);
  }
  return h.digest("hex");
}
