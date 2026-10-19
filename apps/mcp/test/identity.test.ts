import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EXTRACTOR_VERSION } from "@psq/extract";
import { EntityGraph } from "@psq/schema";
import { Workspace } from "../../server/src/workspace.js";
import { blindSpots, canonicalGraphJson, graphDigestOf, headLabel, repoHeadOf } from "../src/common.js";
import { tools, type Ctx } from "../src/tools.js";
import { MINI_EFCORE_REFS, MINI_REACT, MINI_TYPES_ONLY } from "../../../test/fixtures.js";

/**
 * P1: every answer names the snapshot it was read from. A repo with no
 * entities opens over the MCP; its results carry `coverage` (per-facet status
 * and reason) instead of a refusal.
 */

let ctx: Ctx;
const dirs: string[] = [];
beforeEach(() => {
  ctx = { workspace: new Workspace() };
});
afterEach(() => {
  ctx.workspace.closeAll();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const HEX64 = /^[0-9a-f]{64}$/;

const FACETS = [
  "entities", "relations", "shapes", "routes", "clientCalls", "components", "entityRefs", "calls", "pairing",
];

/** MINI_TYPES_ONLY's coverage: entities none-found WITH the reason, shapes complete. */
const NONE_FOUND = expect.objectContaining({
  entities: expect.objectContaining({ status: "none-found", reason: expect.stringMatching(/CREATE TABLE/) }),
  shapes: expect.objectContaining({ status: "complete" }),
});

function expectHeadShape(h: unknown): void {
  if (h === null) return;
  expect(h).toEqual({ commit: expect.stringMatching(/^[0-9a-f]{40,64}$/), prefix: expect.any(String) });
}

describe("a repo with no entities", () => {
  it("is still refused by Workspace.open by default (the HTTP server's behaviour)", () => {
    expect(() => ctx.workspace.open(MINI_TYPES_ONLY)).toThrow(/No entities found/);
  });

  it("opens over the MCP with coverage none-found and the full identity", () => {
    const o = tools.open_repo.run(ctx, { path: MINI_TYPES_ONLY }) as Json;
    expect(o).toMatchObject({
      name: "mini-types-only",
      provider: "sqlite-ddl",
      entities: 0,
      shapes: 3,
      warnings: 1,
      coverage: NONE_FOUND,
      extractorVersion: EXTRACTOR_VERSION,
    });
    expect(o.graphDigest).toMatch(HEX64);
    expect(o.sourceFingerprint).toBe(ctx.workspace.get(o.id)!.sourceFingerprint);
    expect(o.sourceFingerprint).toEqual(expect.any(String));
    expect(o.sourceFingerprint.length).toBeGreaterThan(0);
    expectHeadShape(o.repoHead);
    // Inside a checkout the fixture is a subfolder of a larger repo.
    if (o.repoHead !== null) expect(o.repoHead.prefix).toMatch(/test\/fixtures\/mini-types-only\/$/);
  });

  it("answers entity-only tools with a normal no-entities result, not an error", () => {
    tools.open_repo.run(ctx, { path: MINI_TYPES_ONLY });
    for (const r of [
      tools.entity.run(ctx, { name: "Post" }),
      tools.refs.run(ctx, { entity: "Post" }),
      tools.flow.run(ctx, { route: "GET /x" }),
      tools.areas.run(ctx, {}),
    ] as Json[]) {
      expect(r).toEqual({ error: "no-entities", coverage: NONE_FOUND, graphDigest: expect.stringMatching(HEX64) });
    }
    const s = tools.search_entities.run(ctx, { query: "Post" }) as Json;
    expect(s).toMatchObject({ total: 0, hits: [], next: [], coverage: NONE_FOUND });
  });

  it("renders a one-line notice in the brief instead of an empty entities section", () => {
    tools.open_repo.run(ctx, { path: MINI_TYPES_ONLY });
    const b = tools.brief.run(ctx, {}) as string;
    expect(b).toContain(
      "\nno entities: psq read 3 shapes and no schema (no CREATE TABLE literal among 2 TypeScript files)\n",
    );
    expect(b).not.toContain("## Entities and relations");
    expect(b).toContain("cannot see: psq read no entity schema here");
    expect(b).toMatch(/missing coverage is unknown, not absence/);
  });

  it("does not claim mirrors were paired and none found when there were no entities to pair", () => {
    tools.open_repo.run(ctx, { path: MINI_TYPES_ONLY });
    const spots = (tools.warnings.run(ctx, {}) as Json).cannotSee.join("\n");
    expect(spots).not.toMatch(/found none whose name and fields both match/);
    expect(spots).not.toMatch(/mirrors: null/);
    // Positive control: the coverage row is what speaks for this graph.
    expect(spots).toMatch(/psq read no entity schema here/);
  });

  it("is not persisted to the state dir (rehydrate would refuse it every boot)", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "psq-state-"));
    dirs.push(stateDir);
    const ws = new Workspace(undefined, { stateDir, log: () => {} });
    const envelopes = (): string[] => {
      try {
        return readdirSync(join(stateDir, "repos"));
      } catch {
        return [];
      }
    };
    try {
      ws.open(MINI_TYPES_ONLY, { allowEmpty: true });
      expect(envelopes()).toEqual([]);
      // Positive control: a repo with entities is persisted in the same dir.
      ws.open(MINI_EFCORE_REFS);
      expect(envelopes().length).toBe(1);
    } finally {
      ws.closeAll();
    }
  });

  it("states the coverage gap in cannotSee only when there are no entities", () => {
    tools.open_repo.run(ctx, { path: MINI_TYPES_ONLY });
    expect((tools.warnings.run(ctx, {}) as Json).cannotSee.join("\n")).toMatch(/missing coverage is unknown/);
    const refs = ctx.workspace.open(MINI_EFCORE_REFS);
    expect(blindSpots(refs.graph).join("\n")).not.toMatch(/missing coverage is unknown/);
  });
});

describe("the coverage reason in cannotSee, the brief and the HTTP refusal", () => {
  /**
   * mini-react copied to its own temp dir, so a test can edit it without
   * touching the shared fixture. Opened by absolute path, tsconfig.json's two
   * references make the TS read partial ("reading only tsconfig.app.json");
   * each test asserts that precondition, so it cannot pass vacuously.
   */
  const PARTIAL = "tsconfig.json: 2 referenced projects; reading only tsconfig.app.json";
  function reactCopy(stripSchema: boolean): string {
    const d = mkdtempSync(join(tmpdir(), "psq-react-"));
    dirs.push(d);
    const repo = join(d, "repo");
    cpSync(MINI_REACT, repo, { recursive: true });
    if (stripSchema) {
      const p = join(repo, "src/lib/schema.ts");
      const src = readFileSync(p, "utf8");
      const out = src.replaceAll("CREATE TABLE", "-- no table");
      expect(out).not.toBe(src);
      writeFileSync(p, out);
    }
    return repo;
  }

  it("embeds the none-found reason in the cannotSee line", () => {
    tools.open_repo.run(ctx, { path: MINI_TYPES_ONLY });
    expect((tools.warnings.run(ctx, {}) as Json).cannotSee).toContain(
      "psq read no entity schema here (no CREATE TABLE literal among 2 TypeScript files): missing coverage is " +
        "unknown, not absence, and the app may keep data in a way psq does not read.",
    );
  });

  it("words a partial read's reason as what was left out, not as the cause, at all three sites", () => {
    const repo = reactCopy(true);
    expect(() => new Workspace().open(repo)).toThrow(
      `No entities found in a partial read (${PARTIAL}). psq reads a schema from raw DDL;`,
    );
    const o = tools.open_repo.run(ctx, { path: repo }) as Json;
    expect(o.entities).toBe(0);
    expect(o.coverage.entities).toMatchObject({ status: "partial", reason: PARTIAL });
    const b = tools.brief.run(ctx, {}) as string;
    expect(b).toContain(`\nno entities: psq read ${o.shapes} shapes and no schema in a partial read (${PARTIAL})\n`);
    const spots = (tools.warnings.run(ctx, {}) as Json).cannotSee as string[];
    expect(spots).toContain(
      `psq read no entity schema here in a partial read (${PARTIAL}): missing coverage is unknown, not absence, ` +
        "and the app may keep data in a way psq does not read.",
    );
  });

  it("does not fire on a repo with entities whose entities facet carries a (partial) reason", () => {
    const repo = reactCopy(false);
    const o = tools.open_repo.run(ctx, { path: repo }) as Json;
    // Non-vacuous: entities were found AND the facet has a reason.
    expect(o.entities).toBeGreaterThan(0);
    expect(o.coverage.entities).toMatchObject({ status: "partial", reason: PARTIAL });
    const spots = ((tools.warnings.run(ctx, {}) as Json).cannotSee as string[]).join("\n");
    expect(spots).not.toContain("psq read no entity schema here");
    expect(tools.brief.run(ctx, {}) as string).not.toContain("no entities:");
  });
});

describe("coverage on a repo with entities", () => {
  it("open_repo carries the full coverage block and providerBasis on a repo with entities", () => {
    const o = tools.open_repo.run(ctx, { path: MINI_EFCORE_REFS }) as Json;
    expect(o.entities).toBe(2);
    expect(Object.keys(o.coverage)).toEqual(FACETS);
    expect(o.coverage.entities.status).toBe("complete");
    expect(o.providerBasis.csFiles).toBeGreaterThan(0);
    expect(o.providerBasis).toHaveProperty("testOnlyCsproj");
  });

  it("overview and warnings carry coverage; entity and routes do not on a repo with entities", () => {
    const o = tools.open_repo.run(ctx, { path: MINI_EFCORE_REFS }) as Json;
    const overview = tools.overview.run(ctx, {}) as Json;
    const warnings = tools.warnings.run(ctx, {}) as Json;
    // Keys first: on a tool without coverage, `undefined` would equal `undefined`.
    expect(Object.keys(overview.coverage ?? {})).toEqual(FACETS);
    expect(Object.keys(warnings.coverage ?? {})).toEqual(FACETS);
    expect(overview.coverage).toEqual(o.coverage);
    expect(warnings.coverage).toEqual(o.coverage);
    // `stamp` injects coverage only on a 0-entity repo.
    expect(tools.entity.run(ctx, { name: "Course" }) as Json).not.toHaveProperty("coverage");
    expect(tools.routes.run(ctx, {}) as Json).not.toHaveProperty("coverage");
  });
});

describe("graphDigest", () => {
  it("is on every JSON result and identical to open_repo's", () => {
    const { graphDigest } = tools.open_repo.run(ctx, { path: MINI_EFCORE_REFS }) as Json;
    expect(graphDigest).toMatch(HEX64);
    const results = [
      tools.overview.run(ctx, {}),
      tools.search_entities.run(ctx, { query: "c" }),
      tools.entity.run(ctx, { name: "Course" }),
      tools.refs.run(ctx, { entity: "Course" }),
      tools.routes.run(ctx, {}),
      tools.client_calls.run(ctx, {}),
      tools.warnings.run(ctx, {}),
      tools.areas.run(ctx, {}),
    ] as Json[];
    for (const r of results) expect(r.graphDigest).toBe(graphDigest);
    // And on the three text outputs.
    expect((tools.mermaid.run(ctx, {}) as string).split("\n")[1]).toBe(`%% graphDigest ${graphDigest}`);
    expect(tools.brief.run(ctx, {}) as string).toContain(` · graph ${graphDigest}\n`);
  });

  it("is the same across two opens of one repo", () => {
    const a = (tools.open_repo.run(ctx, { path: MINI_EFCORE_REFS }) as Json).graphDigest;
    const b = (tools.open_repo.run(ctx, { path: MINI_EFCORE_REFS }) as Json).graphDigest;
    expect(b).toBe(a);
  });

  it("does not depend on where the checkout lives", () => {
    const copies = [0, 1].map(() => {
      const d = mkdtempSync(join(tmpdir(), "psq-identity-"));
      dirs.push(d);
      cpSync(MINI_EFCORE_REFS, join(d, "app"), { recursive: true });
      return join(d, "app");
    });
    const [x, y] = copies.map((p) => tools.open_repo.run(ctx, { path: p }) as Json);
    expect(x.id).not.toBe(y.id);
    expect(y.graphDigest).toBe(x.graphDigest);
  });

  it("ignores key order and the absolute repo path, and changes with the graph", () => {
    const g = ctx.workspace.open(MINI_EFCORE_REFS).graph;
    const reversed = (v: unknown): unknown =>
      Array.isArray(v)
        ? v.map(reversed)
        : v !== null && typeof v === "object"
          ? Object.fromEntries(Object.keys(v).reverse().map((k) => [k, reversed((v as Record<string, unknown>)[k])]))
          : v;
    const moved = { ...(reversed(g) as EntityGraph), repo: "/somewhere/else" };
    expect(canonicalGraphJson(moved)).toBe(canonicalGraphJson(g));
    expect(canonicalGraphJson(g)).not.toContain(g.repo);
    // A real zod round trip, as rehydrate reads an envelope: a future
    // `.default()` or key-stripping change in the schema shows up here.
    const rehydrated = EntityGraph.parse(JSON.parse(JSON.stringify(g)));
    expect(graphDigestOf(rehydrated)).toBe(graphDigestOf(g));
    // Positive control: a real change to the graph changes the digest.
    const changed = { ...g, warnings: [...g.warnings, "x"] };
    expect(graphDigestOf(changed)).not.toBe(graphDigestOf(g));
  });
});

describe("repoHead", () => {
  it("is null outside git", () => {
    const d = mkdtempSync(join(tmpdir(), "psq-nogit-"));
    dirs.push(d);
    expect(repoHeadOf(d)).toBeNull();
    expect(headLabel(null)).toBe("none");
  });

  it("ignores GIT_DIR / GIT_WORK_TREE / GIT_INDEX_FILE in the environment", () => {
    const clean = repoHeadOf(MINI_TYPES_ONLY);
    expectHeadShape(clean);
    const saved = { d: process.env.GIT_DIR, w: process.env.GIT_WORK_TREE, i: process.env.GIT_INDEX_FILE };
    try {
      process.env.GIT_DIR = "/nonexistent-psq-git-dir";
      process.env.GIT_WORK_TREE = "/nonexistent-psq-work-tree";
      process.env.GIT_INDEX_FILE = "/nonexistent-psq-index";
      expect(repoHeadOf(MINI_TYPES_ONLY)).toEqual(clean);
    } finally {
      for (const [k, v] of [["GIT_DIR", saved.d], ["GIT_WORK_TREE", saved.w], ["GIT_INDEX_FILE", saved.i]] as const) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });

  describe("scrubs every GIT_* variable, on a repo built here (never vacuous outside a checkout)", () => {
    let sub: string;
    let clean: ReturnType<typeof repoHeadOf>;
    beforeEach(() => {
      const t = mkdtempSync(join(tmpdir(), "psq-git-"));
      dirs.push(t);
      const git = (...args: string[]): void => {
        const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
        execFileSync("git", ["-C", t, ...args], { stdio: "ignore", env });
      };
      git("init", "-q");
      git("-c", "user.name=x", "-c", "user.email=x@y", "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-qm", "i");
      sub = join(t, "a", "b");
      mkdirSync(sub, { recursive: true });
      clean = repoHeadOf(sub);
      // HARD: a null here would make both cases below pass on any scrub.
      expect(clean).not.toBeNull();
      expect(clean!.prefix).toBe("a/b/");
    });

    for (const [key, value] of [
      ["GIT_COMMON_DIR", () => "/nonexistent"],
      ["GIT_CEILING_DIRECTORIES", () => join(sub, "..")],
    ] as const) {
      it(`ignores ${key}`, () => {
        const saved = process.env[key];
        try {
          process.env[key] = value();
          expect(repoHeadOf(sub)).toEqual(clean);
        } finally {
          if (saved === undefined) delete process.env[key];
          else process.env[key] = saved;
        }
      });
    }
  });

  it("labels a subfolder as commit:prefix", () => {
    expect(headLabel({ commit: "a".repeat(40), prefix: "" })).toBe("a".repeat(40));
    expect(headLabel({ commit: "a".repeat(40), prefix: "sub/" })).toBe(`${"a".repeat(40)}:sub/`);
  });

  it("is in the brief's snapshot line with the extractor version", () => {
    const o = tools.open_repo.run(ctx, { path: MINI_EFCORE_REFS }) as Json;
    const b = tools.brief.run(ctx, {}) as string;
    const lines = b.split("\n");
    expect(lines[0]).toBe("# Domain brief: mini-efcore-refs");
    expect(lines[2]).toBe(
      `> snapshot: ${headLabel(o.repoHead)} · extractor ${EXTRACTOR_VERSION} · graph ${o.graphDigest}`,
    );
  });
});
