import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

/** Self-contained fixture committed to this repo. Always present. */
export const MINI_EFCORE = resolve(here, "fixtures/mini-efcore");

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
} as const;

export function hasCorpus(path: string): boolean {
  // PSQ_NO_CORPUS=1 forces the hermetic path, so the skip behavior itself can
  // be exercised on a machine that does happen to have the repos.
  if (process.env["PSQ_NO_CORPUS"] === "1") return false;
  return existsSync(path);
}
