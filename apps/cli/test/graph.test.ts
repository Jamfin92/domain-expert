import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

/**
 * `psq graph` prints each warning tagged with its code, then one `by code:`
 * count line when there are two or more (P2b-ii). Fixture paths are absolute:
 * a relative path changes what the extractor reads (P2b-i F6).
 *
 * The CLI's string-only branch (records absent) is not tested here: `psq
 * graph` always extracts fresh, so it always has records.
 */
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const FIXTURES = resolve(repoRoot, "test/fixtures");

const tmps: string[] = [];
afterAll(() => {
  for (const d of tmps) rmSync(d, { recursive: true, force: true });
});

/** Each case spawns `node --import tsx` (about 2 s under the full suite); vitest's 5 s default is too close. */
const CLI_TIMEOUT = 30_000;

const strip = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");

function graph(fixture: string): { stdout: string; out: string } {
  const out = mkdtempSync(resolve(tmpdir(), "psq-cli-graph-"));
  tmps.push(out);
  const stdout = execFileSync(
    "node",
    ["--import", "tsx", resolve(repoRoot, "apps/cli/src/index.ts"), "graph", "--repo", resolve(FIXTURES, fixture), "--out", out],
    { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  return { stdout: strip(stdout), out };
}

describe("psq graph warnings", () => {
  it("tags each warning with its code and sums them in one by-code line", () => {
    const { stdout, out } = graph("mini-aspnet-routes");
    const lines = stdout.split("\n");
    const header = lines.map((l) => /^(\d+) warning\(s\):$/.exec(l)).filter((m) => m !== null);
    expect(header).toHaveLength(1);
    const n = Number(header[0]![1]);
    expect(n).toBe(11);

    const tagged = lines.filter((l) => /^ {2}- \[route-[a-z-]+\] /.test(l));
    expect(tagged).toHaveLength(n);
    expect(lines.filter((l) => l.startsWith("  - ")).length).toBe(n);

    const byCode = lines.filter((l) => l.startsWith("by code: "));
    expect(byCode).toHaveLength(1);
    const pairs = byCode[0]!.slice("by code: ".length).split("  ");
    for (const p of pairs) expect(p).toMatch(/^[a-z-]+=\d+$/);
    expect(pairs.reduce((sum, p) => sum + Number(p.split("=")[1]), 0)).toBe(n);

    const g = JSON.parse(readFileSync(resolve(out, "entity.graph.json"), "utf8"));
    expect(g.warningRecords).toHaveLength(g.warnings.length);
    expect(g.warningRecords.map((r: { text: string }) => r.text)).toEqual(g.warnings);
    expect(tagged).toEqual(g.warningRecords.map((r: { code: string; text: string }) => `  - [${r.code}] ${r.text}`));
  }, CLI_TIMEOUT);

  it("prints no by-code line for a single warning", () => {
    const { stdout } = graph("mini-types-only");
    const lines = stdout.split("\n");
    expect(lines).toContain("1 warning(s):");
    expect(lines.filter((l) => /^ {2}- \[[a-z-]+\] /.test(l))).toHaveLength(1);
    expect(stdout).not.toContain("by code:");
  }, CLI_TIMEOUT);

  it("prints no warning block for a repo with none", () => {
    const { stdout } = graph("mini-efcore-refs");
    expect(stdout).not.toMatch(/warning\(s\):/);
    expect(stdout).not.toContain("by code:");
  }, CLI_TIMEOUT);
});
