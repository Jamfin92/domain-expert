import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { extract } from "@psq/extract";
import { buildBank, materialize, hashSeed, DEFAULT_SEED } from "@psq/quiz";
import { MINI_FULLSTACK_REACT } from "./fixtures.js";

/**
 * Phase F (D-F-2). One default seed, resolved once.
 *
 * Before this phase the CLI defaulted its data seed to 1337 but forwarded a
 * bare `undefined` question seed, which each generator then resolved to
 * `hashSeed(g.repo)`; the server resolved both to 1337. An absent `--seed`
 * therefore built a different bank in each shell, so `psq selftest` gated a
 * bank the server never served.
 *
 * Case 2 is what keeps case 1 honest: differing seeds do not imply differing
 * banks, so the inequality is asserted directly rather than assumed.
 */
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

const g = extract(MINI_FULLSTACK_REACT);
const seeded = materialize(g, { seed: DEFAULT_SEED, rows: 40 });
afterAll(() => seeded.close());

const tmps: string[] = [];
afterAll(() => {
  for (const d of tmps) rmSync(d, { recursive: true, force: true });
});

/** `psq questions --out <dir>` into a fresh temp dir; returns the two outputs. */
function questionsOut(args: string[]): { questions: string; schema: string } {
  const out = mkdtempSync(resolve(tmpdir(), "psq-seed-parity-"));
  tmps.push(out);
  execFileSync(
    "node",
    [
      "--import", "tsx",
      resolve(repoRoot, "apps/cli/src/index.ts"),
      "questions", "--repo", MINI_FULLSTACK_REACT, "--out", out,
      ...args,
    ],
    { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  return {
    questions: readFileSync(resolve(out, "questions/entity.json"), "utf8"),
    schema: readFileSync(resolve(out, "schema.sql"), "utf8"),
  };
}

describe("seed parity", () => {
  it("1. an absent seed builds the same bank as an explicit DEFAULT_SEED", () => {
    expect(buildBank(g, seeded)).toEqual(buildBank(g, seeded, DEFAULT_SEED));
  });

  it("2. the old repo-path default really did build a different bank", () => {
    // Non-vacuity for case 1. If these are equal the fixture no longer
    // discriminates and case 1 proves nothing — that is a finding, not a skip.
    expect(buildBank(g, seeded, hashSeed(g.repo))).not.toEqual(
      buildBank(g, seeded, DEFAULT_SEED),
    );
  });

  it("3. the CLI shell writes byte-identical output with and without --seed 1337", () => {
    // Two subprocesses because `apps/cli/src/index.ts` runs `main()` at import
    // and exports nothing; there is no in-process way to exercise its shell.
    const bare = questionsOut([]);
    const pinned = questionsOut(["--seed", "1337"]);
    expect(bare.questions).toBe(pinned.questions);
    expect(bare.schema).toBe(pinned.schema);
  }, 60_000);

  it("4. pins the served value", () => {
    expect(DEFAULT_SEED).toBe(1337);
  });
});
