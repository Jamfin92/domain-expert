import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Workspace } from "../../server/src/workspace.js";
import { LIMITS } from "../src/common.js";
import { CAP, tools, type Ctx } from "../src/tools.js";
import {
  MINI_EFCORE_PRIMARY_CTOR, MINI_EFCORE_REFS, MINI_FULLSTACK_CSHARP, MINI_NODE, MINI_TYPES_ONLY,
} from "../../../test/fixtures.js";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const MINI_CLIENT_BASE = resolve(dirname(fileURLToPath(import.meta.url)), "../../../test/fixtures/mini-client-base");

let ctx: Ctx;
beforeEach(() => {
  ctx = { workspace: new Workspace() };
});
afterEach(() => ctx.workspace.closeAll());

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const open = (path: string): string => (tools.open_repo.run(ctx, { path }) as Json).id;
const shapes = (args: Json = {}): Json => tools.shapes.run(ctx, args) as Json;
const names = (r: Json): string[] => r.shapes.map((s: Json) => s.name);

const FOUND_NONE =
  "`mirrors: null` means psq paired the shape against this stack's entities and found none " +
  "whose name and fields both match; a mapper psq cannot see may still connect them.";
const CROSS_STACK =
  "TypeScript shapes were not paired against the .NET entity model: `mirrors: null` on a " +
  'TypeScript shape means "not computed" cross-stack, not "no mirror".';

/** The item invariant: a shape's mirror, its provenance and its drift are null together. */
function expectNullTriple(s: Json): void {
  expect(s.mirrors === null, s.name).toBe(s.mirrorSource === null);
  expect(s.mirrors === null, s.name).toBe(s.drift === null);
}

describe("shapes tool on mini-node (entities are table names)", () => {
  it("lists every shape with counts and the found-none note", () => {
    const id = open(MINI_NODE);
    const r = shapes();
    expect(r).toMatchObject({
      mirrors: null, paired: null, kind: null, prefix: null,
      total: 12, counts: { paired: 3, unpaired: 9 }, truncated: false, note: FOUND_NONE,
    });
    // The note is the `mirrors` limit's own reading of this graph, not a second copy of it.
    expect(r.note).toBe(LIMITS.mirrors.see(ctx.workspace.get(id)!.graph));
    expect(r.shapes).toHaveLength(12);
    expect(r).not.toHaveProperty("coverage");
    expect(r).not.toHaveProperty("next");
    expect(r.graphDigest).toMatch(/^[0-9a-f]{64}$/);
    for (const s of r.shapes) expectNullTriple(s);
  });

  it("pins the three paired shapes exactly, with drift against the mirrored entity", () => {
    open(MINI_NODE);
    const r = shapes({ paired: true });
    expect(r.total).toBe(3);
    expect(r.counts).toEqual({ paired: 3, unpaired: 0 });
    expect(r.shapes).toEqual([
      {
        name: "Crew", kind: "zod", module: null, cite: "base.ts", fieldCount: 4, memberCount: 0, discriminator: null,
        mirrors: "crews", mirrorSource: "inferred",
        drift: {
          entityOnly: [], shapeOnly: [],
          shared: [
            { column: "callsign", field: "callsign" },
            { column: "name", field: "name" },
            { column: "home_port", field: "homePort" },
            { column: "founded_year", field: "foundedYear" },
          ],
        },
      },
      {
        name: "Voyage", kind: "interface", module: null, cite: "types.ts", fieldCount: 5, memberCount: 0, discriminator: null,
        mirrors: "voyages", mirrorSource: "inferred",
        drift: {
          entityOnly: ["departed_at"], shapeOnly: ["weather"],
          shared: [
            { column: "id", field: "id" },
            { column: "crew_id", field: "crew_id" },
            { column: "destination", field: "destination" },
            { column: "cargo_tons", field: "cargo_tons" },
          ],
        },
      },
      {
        name: "VoyageRow", kind: "interface", module: null, cite: "types.ts", fieldCount: 5, memberCount: 0, discriminator: null,
        mirrors: "voyages", mirrorSource: "inferred",
        drift: {
          entityOnly: [], shapeOnly: [],
          shared: [
            { column: "id", field: "id" },
            { column: "crew_id", field: "crew_id" },
            { column: "destination", field: "destination" },
            { column: "cargo_tons", field: "cargo_tons" },
            { column: "departed_at", field: "departed_at" },
          ],
        },
      },
    ]);
  });

  it("filters by mirrors, paired, kind and prefix", () => {
    open(MINI_NODE);
    expect(names(shapes({ mirrors: "crews" }))).toEqual(["Crew"]);
    expect(names(shapes({ mirrors: "voyages" }))).toEqual(["Voyage", "VoyageRow"]);
    // The entity is the TABLE name; the shape's own name is not a mirror.
    expect(shapes({ mirrors: "Crew" })).toMatchObject({ mirrors: "Crew", total: 0, shapes: [] });
    const unpaired = shapes({ paired: false });
    expect(unpaired).toMatchObject({ paired: false, total: 9, counts: { paired: 0, unpaired: 9 } });
    for (const s of unpaired.shapes) {
      expect(s).toMatchObject({ mirrors: null, mirrorSource: null, drift: null });
    }
    const enums = shapes({ kind: "enum" });
    expect(enums).toMatchObject({ kind: "enum", total: 1 });
    expect(enums.shapes[0]).toMatchObject({ name: "Rating", kind: "enum", fieldCount: 0, memberCount: 3 });
    expect(names(shapes({ prefix: "Voy" }))).toEqual(["Voyage", "VoyageRow"]);
    expect(shapes({ prefix: "" }).total).toBe(12);
    expect(shapes({ mirrors: "Nope" })).toMatchObject({ total: 0, counts: { paired: 0, unpaired: 0 }, truncated: false, shapes: [] });
  });

  it("sorts by name, whatever the graph's order", () => {
    const id = open(MINI_NODE);
    const g = ctx.workspace.get(id)!.graph;
    const sorted = names(shapes());
    expect(sorted).toEqual([...sorted].sort());
    g.shapes.reverse();
    expect(g.shapes[0]!.name).toBe("WireManifest");
    expect(names(shapes())).toEqual(sorted);
    expect(sorted[0]).toBe("Crew");
  });

  it("caps the list at CAP.shapes and says so", () => {
    const id = open(MINI_NODE);
    const g = ctx.workspace.get(id)!.graph;
    const base = g.shapes.find((s) => s.name === "Manifest")!;
    for (let i = 0; i < 201; i++) g.shapes.push({ ...base, name: `Bulk${String(i).padStart(3, "0")}` });
    const r = shapes();
    expect(CAP.shapes).toBe(200);
    expect(r.total).toBe(213);
    expect(r.truncated).toBe(true);
    expect(r.shapes).toHaveLength(200);
    // Sorted before the cap: the shown page is the first 200 names of all 213, not a sorted graph-order page.
    expect(names(r)).toEqual(Array.from({ length: 200 }, (_, i) => `Bulk${String(i).padStart(3, "0")}`));
  });
});

describe("shapes tool on other repos", () => {
  it("answers on a repo with no entities: no error, coverage, no note, every item unpaired", () => {
    open(MINI_TYPES_ONLY);
    const r = shapes();
    expect(r).not.toHaveProperty("error");
    expect(r).not.toHaveProperty("note");
    expect(r).toHaveProperty("coverage");
    expect(r.total).toBe(3);
    expect(names(r)).toEqual(["Author", "Comment", "Post"]);
    for (const s of r.shapes) expect(s).toMatchObject({ mirrors: null, mirrorSource: null, drift: null });
  });

  it("lists both ProductDto copies on a fullstack repo and says TS pairing was not computed", () => {
    open(MINI_FULLSTACK_CSHARP);
    const r = shapes({ prefix: "ProductDto" });
    expect(r.note).toBe(CROSS_STACK);
    expect(r.shapes.map((s: Json) => s.cite)).toEqual([
      "client/src/types/product-dto.ts", "server/Dtos/ProductDto.cs",
    ]);
    expect(r.shapes[0]).toMatchObject({ mirrors: null, mirrorSource: null, drift: null });
    expect(r.shapes[1]).toMatchObject({
      kind: "class", module: "Mini.Shop.Dtos", mirrors: "Product", mirrorSource: "inferred",
      drift: { entityOnly: ["CategoryId"], shapeOnly: ["Description"] },
    });
    expect(shapes().counts).toEqual({ paired: 1, unpaired: 2 });
  });

  it("answers an empty list with no note on a repo with no shapes", () => {
    open(MINI_EFCORE_REFS);
    const r = shapes();
    expect(r).toMatchObject({ total: 0, counts: { paired: 0, unpaired: 0 }, truncated: false, shapes: [] });
    expect(r).not.toHaveProperty("note");
    expect(r).not.toHaveProperty("coverage");
  });

  it("holds the null triple on every fixture with shapes", () => {
    for (const fx of [MINI_NODE, MINI_TYPES_ONLY, MINI_FULLSTACK_CSHARP, MINI_EFCORE_PRIMARY_CTOR, MINI_CLIENT_BASE]) {
      ctx.workspace.closeAll();
      open(fx);
      const r = shapes();
      expect(r.total, fx).toBeGreaterThan(0);
      expect(r.counts.paired + r.counts.unpaired, fx).toBe(r.total);
      for (const s of r.shapes) expectNullTriple(s);
    }
  });
});
