import { cpSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EXTRACTOR_VERSION } from "@psq/extract";
import { EntityGraph } from "@psq/schema";
import { Workspace } from "../../server/src/workspace.js";
import { blindSpots, canonicalGraphJson, graphDigestOf, headLabel, repoHeadOf } from "../src/common.js";
import { tools, type Ctx } from "../src/tools.js";
import { MINI_EFCORE_REFS, MINI_TYPES_ONLY } from "../../../test/fixtures.js";

/**
 * P1: every answer names the snapshot it was read from, and a repo with no
 * entities opens over the MCP with its coverage stated instead of refusing.
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
      coverage: { entities: "none-found" },
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
      expect(r).toEqual({ error: "no-entities", coverage: { entities: "none-found" }, graphDigest: expect.stringMatching(HEX64) });
    }
    const s = tools.search_entities.run(ctx, { query: "Post" }) as Json;
    expect(s).toMatchObject({ total: 0, hits: [], next: [], coverage: { entities: "none-found" } });
  });

  it("renders a one-line notice in the brief instead of an empty entities section", () => {
    tools.open_repo.run(ctx, { path: MINI_TYPES_ONLY });
    const b = tools.brief.run(ctx, {}) as string;
    expect(b).toContain("\nno entities: psq read 3 shapes and no schema\n");
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
