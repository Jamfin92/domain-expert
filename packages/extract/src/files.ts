import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

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
