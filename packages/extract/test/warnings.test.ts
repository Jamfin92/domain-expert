import { afterEach, describe, expect, it, vi } from "vitest";
import { cpSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { WarningCode, WarningRecord } from "@psq/schema";
import { extract } from "../src/detect.js";
import { extractDotnet } from "../src/dotnet.js";
import { extractNode } from "../src/node.js";
import { pairShapes } from "../src/pair.js";
import type { Entity, Shape } from "@psq/schema";
import { countNoun, Warnings } from "../src/warnings.js";
import { MINI_EFCORE, MINI_TYPES_ONLY } from "../../../test/fixtures.js";

/**
 * Typed warning records (P2b). `warningRecords[i].text === warnings[i]` on
 * every hermetic fixture, read from disk like `coverage.test.ts` so a new
 * fixture is covered without editing this file.
 *
 * `WALK_LIMIT` is mocked through a getter so it stays the real 20000 for the
 * fixture sweep and drops to 1 only inside the walk-limit tests.
 */
const limit = vi.hoisted(() => ({ value: null as number | null }));
vi.mock("../src/files.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/files.js")>();
  return {
    ...real,
    get WALK_LIMIT() {
      return limit.value ?? real.WALK_LIMIT;
    },
  };
});

const FIXTURES = dirname(MINI_EFCORE);
const ALL = readdirSync(FIXTURES, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

describe("every extracted graph carries warningRecords, one per warning", () => {
  it("found the fixture set", () => {
    expect(ALL).toContain("not-a-project");
    expect(ALL.length).toBeGreaterThanOrEqual(15);
  });

  it.each(ALL)("%s", (name) => {
    const g = extract(join(FIXTURES, name));
    expect(g.warningRecords).toBeDefined();
    expect(g.warningRecords.length).toBe(g.warnings.length);
    g.warningRecords.forEach((r, i) => {
      const at = `${name}[${i}]`;
      expect(r.text, at).toBe(g.warnings[i]);
      expect(() => WarningRecord.parse(r), at).not.toThrow();
      expect(WarningCode.safeParse(r.code).success, at).toBe(true);
      if (r.file !== null) {
        expect(isAbsolute(r.file), at).toBe(false);
        expect(r.file.split("/"), at).not.toContain("..");
        expect(r.file, at).not.toContain("\\");
      }
      if (r.line !== null) expect(r.line, at).toBeGreaterThanOrEqual(1);
      // Oracle only: production never parses its own text.
      const fileLine = /^(\S+?):(\d+): /.exec(r.text);
      if (fileLine) {
        expect(r.file, at).toBe(fileLine[1]);
        expect(r.line, at).toBe(Number(fileLine[2]));
      }
      const fileOnly = /^(\S+\.(cs|ts|tsx)): /.exec(r.text);
      if (fileOnly) expect(r.file, at).toBe(fileOnly[1]);
    });
  });

  it("the codes the fixtures exercise, as an explicit list", () => {
    // A new fixture or a new code is a visible diff here, never a silent one.
    const seen = new Set<string>();
    for (const name of ALL) for (const r of extract(join(FIXTURES, name)).warningRecords) seen.add(r.code);
    expect([...seen].sort()).toEqual([
      "client-base-unreadable",
      "cs-type-header-not-terminated",
      "dbcontext-empty",
      "no-reader",
      "no-schema",
      "ref-key-collision",
      "route-accept-verbs",
      "route-action-name-undecided",
      "route-any-verb",
      "route-area-not-read",
      "route-conventional",
      "route-inherited-not-read",
      "route-minimal-api",
      "route-template-invalid",
      "route-template-not-literal",
      "route-verb-undecided",
      "shapes-unpaired",
      "tsconfig-references-partial",
    ]);
  });
});

describe("the Warnings collector", () => {
  it("derives strings from records and copies on append", () => {
    const a = new Warnings();
    a.push("entity-no-key", "X: no primary key found by convention or HasKey", { about: "X" });
    a.push("cs-unreadable", "A.cs: unreadable (EACCES)", { file: "A.cs" });
    expect(a.strings).toEqual(["X: no primary key found by convention or HasKey", "A.cs: unreadable (EACCES)"]);
    expect(a.records[0]).toEqual({
      code: "entity-no-key", file: null, line: null, about: "X",
      text: "X: no primary key found by convention or HasKey",
    });
    const b = new Warnings();
    b.append(a);
    b.append(a.records);
    expect(b.strings).toHaveLength(4);
    b.records[0]!.text = "changed";
    expect(a.records[0]!.text).not.toBe("changed");
  });

  it("rebases file, the text's own file prefix, and a path-bearing about; nothing else", () => {
    const w = new Warnings();
    w.push("shape-unresolved", "src/a.ts:3: could not resolve a declaration (x)", { file: "src/a.ts", line: 3 });
    w.push("tsconfig-fallback-scan", "tsconfig.json names no files", { file: "tsconfig.json" });
    w.push("ref-key-collision", 'src/k.ts: definitions at line 1 and line 2 both produce the key "src/k.ts#K"', {
      file: "src/k.ts", about: "src/k.ts#K",
    });
    w.push("ddl-relation-ambiguous", "id identifies a and b equally", { about: "id" });
    expect(w.rebase("client")).toEqual([
      { code: "shape-unresolved", file: "client/src/a.ts", line: 3, about: null,
        text: "client/src/a.ts:3: could not resolve a declaration (x)" },
      // The text does not start with `tsconfig.json:`, so it is left alone.
      { code: "tsconfig-fallback-scan", file: "client/tsconfig.json", line: null, about: null,
        text: "tsconfig.json names no files" },
      { code: "ref-key-collision", file: "client/src/k.ts", line: null, about: "client/src/k.ts#K",
        text: 'client/src/k.ts: definitions at line 1 and line 2 both produce the key "src/k.ts#K"' },
      { code: "ddl-relation-ambiguous", file: null, line: null, about: "id", text: "id identifies a and b equally" },
    ]);
    expect(w.rebase("")).toEqual(w.records);
  });
});

describe("pairShapes: an ambiguous mirror is a coded warning (no fixture emits it)", () => {
  it("names the shape in `about` and its file in `file`", () => {
    const entity = (ns: string): Entity => ({
      name: "Order", namespace: ns, file: `${ns}/Order.cs`, tableName: "Orders", dbSetName: "Orders",
      keys: ["Id"], indexes: [], isFramework: false,
      properties: [{ name: "Id", type: "int", baseType: "int", nullable: false, isPrimaryKey: true,
        isForeignKey: false, isNavigation: false, isCollection: false, column: "Id" }],
    });
    const shape: Shape = {
      name: "Order", file: "web/order.ts", module: null, kind: "interface",
      fields: [{ name: "id", type: "number", baseType: "number", optional: false, isCollection: false }],
      members: [], discriminator: null, mirrors: null, mirrorSource: "inferred",
    };
    const w = new Warnings();
    const [out] = pairShapes([entity("A"), entity("B")], [shape], w);
    expect(out!.mirrors).toBeNull();
    expect(w.records).toEqual([{
      code: "shape-mirror-ambiguous", file: "web/order.ts", line: null, about: "Order",
      text: "web/order.ts: Order could mirror Order or Order; not paired",
    }]);
  });
});

describe("countNoun", () => {
  it("agrees with its count", () => {
    expect(countNoun(0, "file")).toBe("0 files");
    expect(countNoun(1, "file")).toBe("1 file");
    expect(countNoun(2, "file")).toBe("2 files");
    expect(countNoun(1, "entity", "entities")).toBe("1 entity");
    expect(countNoun(3, "entity", "entities")).toBe("3 entities");
  });
});

describe("a walk that hits its limit warns, in both readers (P2b F3)", () => {
  const dirs: string[] = [];
  const copy = (from: string): string => {
    const d = mkdtempSync(join(tmpdir(), "psq-walk-"));
    dirs.push(d);
    cpSync(from, d, { recursive: true });
    return d;
  };
  afterEach(() => {
    limit.value = null;
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("the TypeScript directory scan", () => {
    const root = copy(MINI_TYPES_ONLY); // no tsconfig: the directory-scan path
    const before = extractNode(root);
    expect(before.warningRecords.some((r) => r.code === "walk-limit")).toBe(false);
    limit.value = 1;
    const g = extractNode(root);
    const hit = g.warningRecords.filter((r) => r.code === "walk-limit");
    expect(hit).toHaveLength(1);
    expect(hit[0]!.text).toBe("the directory scan stopped at its 1-file limit; directories past it were not read");
    expect(g.coverage.shapes).toMatchObject({ status: "partial", reason: hit[0]!.text });
    expect(g.coverage.shapes.skipped).toContainEqual({ why: "walk-limit", count: 1 });
    expect(g.warnings).toEqual(g.warningRecords.map((r) => r.text));
  });

  it("the C# file walk", () => {
    const root = copy(MINI_EFCORE);
    expect(extractDotnet(root).warningRecords.some((r) => r.code === "walk-limit")).toBe(false);
    limit.value = 1;
    const g = extractDotnet(root);
    const hit = g.warningRecords.filter((r) => r.code === "walk-limit");
    expect(hit).toHaveLength(1);
    expect(hit[0]!.text).toBe("the .cs file walk stopped at its 1-file limit; directories past it were not read");
    expect(g.coverage.routes).toMatchObject({ status: "partial", reason: hit[0]!.text });
    expect(g.coverage.routes.skipped).toContainEqual({ why: "walk-limit", count: 1 });
    expect(g.warnings).toEqual(g.warningRecords.map((r) => r.text));
  });
});
