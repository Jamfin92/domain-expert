import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Workspace } from "../../server/src/workspace.js";
import { BRIEF_BUDGET } from "../src/brief.js";
import { tools, type Ctx } from "../src/tools.js";
import { MINI_FULLSTACK_REACT } from "../../../test/fixtures.js";

const MINI_ASPNET_ROUTES = resolve(dirname(fileURLToPath(import.meta.url)), "../../../test/fixtures/mini-aspnet-routes");

let ctx: Ctx;
beforeEach(() => {
  ctx = { workspace: new Workspace() };
});
afterEach(() => ctx.workspace.closeAll());

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const open = (): string => (tools.open_repo.run(ctx, { path: MINI_ASPNET_ROUTES }) as Json).id;
const flow = (args: Json): Json => tools.flow.run(ctx, args) as Json;
const brief = (): string => tools.brief.run(ctx, {}) as string;
const flowSection = (b: string): string => b.slice(b.indexOf("## Flow"), b.indexOf("## Client-call"));

/** Five extra mentions of Widget in a Gadgets handler: the gadgets area now owns Widget, so widgets handlers cross into it. */
function gadgetsMentionWidget(id: string): void {
  const g = ctx.workspace.get(id)!.graph;
  const h = g.routes.find((r) => r.handler?.type === "GadgetsController" && r.handler.method === "Get")!.handler!;
  const ref = g.entityRefs.find((e) => e.entity === "Widget")!;
  for (let i = 0; i < 5; i++) {
    g.entityRefs.push({ ...ref, file: h.file, type: h.type, method: h.method, line: 20 });
  }
}

describe("flow tool", () => {
  it("returns the controller -> service -> repository chain with file:line per hop", () => {
    open();
    const f = flow({ route: "GET /api/Gadgets/{id}" });
    expect(f.truncated).toBe(false);
    expect(f.hops[0].method).toBe("GadgetsController.Get");
    const repo = f.hops.find((x: Json) => x.method === "GadgetRepository.Load");
    expect(repo.depth).toBe(2);
    expect(repo.path).toEqual(["GadgetsController.Get", "GadgetService.Assemble", "GadgetRepository.Load"]);
    expect(repo.cite).toBe("Repositories/GadgetRepository.cs:15");
    expect(repo.entities).toEqual(["Gadget"]);
    const svc = f.hops.find((x: Json) => x.method === "GadgetService.Assemble");
    expect(svc.cite).toMatch(/^Services\/GadgetService\.cs:\d+$/);
    expect(svc.calledAt).toBe("Controllers/GadgetsController.cs:20");
    expect(f.entities).toEqual(["Gadget"]);
    expect(f.unresolvedCalls).toBeGreaterThan(0);
  });

  it("accepts a handler instead of a route, and refuses neither, both and unknown", () => {
    open();
    const f = flow({ handler: { type: "GadgetsController", method: "Get" } });
    expect(f.reached).toEqual([expect.objectContaining({ entity: "Gadget", depth: 1 })]);
    expect(() => flow({})).toThrow(/exactly one/);
    expect(() => flow({ route: "GET /x", handler: { type: "A", method: "b" } })).toThrow(/exactly one/);
    expect(() => flow({ route: "GET /nope" })).toThrow(/No route/);
    expect(() => flow({ handler: { type: "Nope", method: "x" } })).toThrow(/No method/);
  });

  it("flags ambiguous edges and depth truncation", () => {
    open();
    const r = flow({ route: "PUT /api/Gadgets/{id}/retire" });
    const amb = r.hops.filter((x: Json) => x.ambiguous).map((x: Json) => x.method).sort();
    expect(amb).toEqual(["EmailNotifier.Send", "SmsNotifier.Send"]);
    expect(r.reached.find((x: Json) => x.entity === "Widget").ambiguous).toBe(true);
    expect(r.reached.find((x: Json) => x.entity === "Gadget").ambiguous).toBe(false);
    const deep = flow({ route: "GET /api/Gadgets/deep" });
    expect(deep.truncated).toBe(true);
    expect(deep.truncatedByDepth).toBe(true);
    expect(flow({ route: "GET /api/Gadgets/deep", maxDepth: 6 }).truncated).toBe(false);
  });

  it("caps hops and says so", () => {
    const id = open();
    const g = ctx.workspace.get(id)!.graph;
    const base = g.calls!.find((c) => c.from.type === "GadgetsController" && c.from.method === "Get")!;
    for (let i = 0; i < 250; i++) {
      g.calls!.push({ ...base, to: { ...base.to, type: "Fan", method: `M${String(i).padStart(3, "0")}` } });
    }
    const f = flow({ route: "GET /api/Gadgets/{id}" });
    expect(f.hops).toHaveLength(200);
    expect(f.omittedNodes).toBeGreaterThan(0);
    expect(f.truncated).toBe(true);
    expect(f.truncatedByDepth).toBe(false);
  });

  it("says an inline handler is not followed", () => {
    tools.open_repo.run(ctx, { path: MINI_FULLSTACK_REACT });
    const f = flow({ route: "POST /api/admin/cards" });
    expect(f.start.method).toBe("<inline>");
    expect(f.notes.join(" ")).toMatch(/Inline handler/);
  });
});

describe("brief Flow section", () => {
  it("shows an entity reached only through a service call, with its depth", () => {
    open();
    const f = flowSection(brief());
    expect(f).toContain(
      "`GET /api/Gadgets/{id}` → GadgetsController.Get (Controllers/GadgetsController.cs:20): Gadget (depth 1 via GadgetService.Assemble)",
    );
    expect(f).toContain("Widget (depth 2 via SmsNotifier.Send, ambiguous)");
    expect(f).toMatch(/\d+ calls in \d+ methods are unresolved/);
    expect(f).toContain("overloads are not distinguished");
    expect(f).not.toContain("likely delegate");
  });

  it("words routes with nothing reachable by handler kind", () => {
    tools.open_repo.run(ctx, { path: MINI_FULLSTACK_REACT });
    const g = [...ctx.workspace.list()].map((r) => ctx.workspace.get(r.id)!.graph)[0]!;
    g.entityRefs = [];
    const f = flowSection(brief());
    expect(f).toMatch(/routes have inline handlers: psq reads no calls inside an inline handler/);
    expect(f).not.toContain("likely delegate");
    expect(f).toContain("carries no call edges");
  });

  it("stays under the character budget on a large repo, and says it trimmed", () => {
    const id = open();
    const g = ctx.workspace.get(id)!.graph;
    const gadget = g.routes.find((r) => r.handler?.type === "GadgetsController" && r.handler.method === "Get")!;
    for (let i = 0; i < 400; i++) g.routes.push({ ...gadget, path: `/area${i}/${"long-segment-".repeat(4)}${i}` });
    for (let i = 0; i < 300; i++) {
      g.entities.push({ ...g.entities[0]!, name: `Bulk${String(i).padStart(3, "0")}`, file: `Models/${"Deep/".repeat(5)}Bulk${i}.cs` });
    }
    const b = brief();
    expect(b.length).toBeLessThanOrEqual(BRIEF_BUDGET);
    expect(b).toContain("Lists are cut to");
  });
});

describe("areas", () => {
  it("the tool lists areas with routes and entities", () => {
    open();
    const a = tools.areas.run(ctx, {}) as Json;
    const widgets = a.areas.find((x: Json) => x.key === "widgets");
    expect(widgets.basis).toBe("route");
    expect(widgets.entities).toContain("Widget");
    expect(a.unassigned.counts.routes).toEqual(expect.any(Number));
    expect(a.truncated).toBe(false);
    expect(a.notes.join(" ")).toMatch(/directly/);
  });

  it("returns cross-area edges with citations", () => {
    gadgetsMentionWidget(open());
    const a = tools.areas.run(ctx, {}) as Json;
    const e = a.edges.find((x: Json) => x.kind === "touches-entity" && x.from === "widgets");
    expect(e).toBeDefined();
    expect(e.to).toBe("gadgets");
    expect(e.evidence[0].text).toBe("WidgetsController.Create -> Widget");
    expect(e.evidence[0].cites).toEqual(["Controllers/WidgetsController.cs:24"]);
  });

  it("caps areas and says so", () => {
    const id = open();
    const g = ctx.workspace.get(id)!.graph;
    for (let i = 0; i < 50; i++) g.routes.push({ ...g.routes[0]!, path: `/zz${String(i).padStart(2, "0")}/x` });
    const a = tools.areas.run(ctx, {}) as Json;
    expect(a.areas).toHaveLength(40);
    expect(a.truncated).toBe(true);
    expect(a.omitted.areas).toBeGreaterThan(0);
  });

  it("the brief has a Feature areas section with cross-area edges", () => {
    gadgetsMentionWidget(open());
    const b = brief();
    const sec = b.slice(b.indexOf("## Feature areas"), b.indexOf("## Hot spots"));
    expect(sec).toContain("- **widgets** (route):");
    expect(sec).toContain("- **widgets** → **gadgets** (touches-entity): WidgetsController.Create -> Widget (Controllers/WidgetsController.cs:24)");
  });
});
