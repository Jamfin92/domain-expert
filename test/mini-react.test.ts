import { describe, expect, it } from "vitest";
import { extractNode } from "@psq/extract";
import { MINI_REACT, MINI_SOLUTION_TIE } from "./fixtures.js";

/**
 * The component-attribution reader (M5b) against a hermetic Vite-shaped React
 * client. The fixture's tsconfig is solution-style (`"files": []` plus
 * references to tsconfig.app.json — holding the `@/*` paths — and a one-file
 * tsconfig.node.json that must lose and be reported dropped), and the
 * component->hook and hook->service hops import via `@/` on purpose: with
 * relative imports the chains would resolve under the fallback walk() program
 * too, and this suite would stay green with the project-reference resolution
 * reverted. Verified: with the solution tsconfig hidden, /api/status,
 * /api/things and the DELETE all lose their components.
 */

const g = extractNode(MINI_REACT);

describe("reading a React client", () => {
  it("warns exactly twice: the dropped reference and the key collision", () => {
    // The two-reference solution tsconfig names its dropped loser, the
    // fixture carries a CREATE TABLE so the shapes-but-no-schema warning
    // cannot fire, and the one collision (top-level Refresh vs the class
    // method Refresh) keeps the first definition and says so.
    expect(g.warnings).toEqual([
      "tsconfig.json: 2 referenced projects; reading only tsconfig.app.json",
      'src/lib/refresh.ts: definitions at line 8 and line 28 both produce the key "src/lib/refresh.ts#Refresh"; keeping the first',
    ]);
    expect(g.provider).toBe("sqlite-ddl");
    expect(g.entities.map((e) => e.name)).toEqual(["things"]);
    expect(g.routes).toEqual([]);
  });

  it("finds every component, keyed by file so same names stay apart", () => {
    expect(g.components).toEqual([
      // Consumes the session context; a component even though it owns no call.
      { key: "src/components/AccountMenu.tsx#AccountMenu",
        name: "AccountMenu", file: "src/components/AccountMenu.tsx", line: 4 },
      // Two components named Card: only the key tells them apart.
      { key: "src/components/admin/Card.tsx#Card",
        name: "Card", file: "src/components/admin/Card.tsx", line: 2 },
      // Touches only the plain member of the exotic service.
      { key: "src/components/ExoticPanel.tsx#ExoticPanel",
        name: "ExoticPanel", file: "src/components/ExoticPanel.tsx", line: 7 },
      // export default function HomePage(): named default export.
      { key: "src/components/HomePage.tsx#HomePage",
        name: "HomePage", file: "src/components/HomePage.tsx", line: 4 },
      // Owner of a call inside a two-member options object: the
      // sibling-bearing rule keeps a COMPONENT owner.
      { key: "src/components/MutatingPanel.tsx#MutatingPanel",
        name: "MutatingPanel", file: "src/components/MutatingPanel.tsx", line: 8 },
      // References the class holding the collision loser, the property
      // arrow, and the class expression.
      { key: "src/components/SchedulerPanel.tsx#SchedulerPanel",
        name: "SchedulerPanel", file: "src/components/SchedulerPanel.tsx", line: 8 },
      { key: "src/components/shop/Card.tsx#Card",
        name: "Card", file: "src/components/shop/Card.tsx", line: 2 },
      { key: "src/components/StatusPanel.tsx#StatusPanel",
        name: "StatusPanel", file: "src/components/StatusPanel.tsx", line: 4 },
      // References the factory-made store whose member calls must not spill.
      { key: "src/components/StorePanel.tsx#StorePanel",
        name: "StorePanel", file: "src/components/StorePanel.tsx", line: 7 },
      { key: "src/components/ThingList.tsx#ThingList",
        name: "ThingList", file: "src/components/ThingList.tsx", line: 4 },
      { key: "src/components/ThingRemover.tsx#ThingRemover",
        name: "ThingRemover", file: "src/components/ThingRemover.tsx", line: 8 },
      // The shadcn shape: a const whose initializer is React.forwardRef(...).
      { key: "src/components/ui/Button.tsx#Button",
        name: "Button", file: "src/components/ui/Button.tsx", line: 4 },
      // Each touches ONE member of the nested grouped client.
      { key: "src/components/UserFinder.tsx#UserFinder",
        name: "UserFinder", file: "src/components/UserFinder.tsx", line: 4 },
      { key: "src/components/UserList.tsx#UserList",
        name: "UserList", file: "src/components/UserList.tsx", line: 4 },
      { key: "src/providers/session-provider.tsx#SessionProvider",
        name: "SessionProvider", file: "src/providers/session-provider.tsx", line: 17 },
      // ABSENT on purpose: FormatDate (src/lib/format.ts) — PascalCase but no
      // JSX, so the detector refuses it.
      // ABSENT on purpose: Refresh/RefreshScheduler — no JSX either; the
      // collision above is about keys, not about componenthood.
    ]);
  });

  it("attributes each call to its nearest component, by key", () => {
    expect(g.clientCalls).toEqual([
      // Direct call in a component: the component itself, and nothing above.
      { method: "POST", path: "/api/admin/cards", file: "src/components/admin/Card.tsx",
        line: 4, enclosing: "save", matches: null,
        components: ["src/components/admin/Card.tsx#Card"] },
      // Direct call in the named default export.
      { method: "GET", path: "/api/home", file: "src/components/HomePage.tsx",
        line: 6, enclosing: "boot", matches: null,
        components: ["src/components/HomePage.tsx#HomePage"] },
      // A call inside a TWO-member options object whose owner is the
      // component itself: the sibling-bearing rule refuses only
      // non-component owners, so this stays attributed — the regression
      // guard for the useMutation({ mutationFn, ... }) shape.
      { method: "GET", path: "/api/mutate", file: "src/components/MutatingPanel.tsx",
        line: 11, enclosing: "mutationFn", matches: null,
        components: ["src/components/MutatingPanel.tsx#MutatingPanel"] },
      // The other Card: same component name, different key.
      { method: "GET", path: "/api/shop/cards", file: "src/components/shop/Card.tsx",
        line: 4, enclosing: "load", matches: null,
        components: ["src/components/shop/Card.tsx#Card"] },
      // Module scope: inside no definition, so genuinely unattributed.
      { method: "GET", path: "/api/boot", file: "src/lib/boot.ts",
        line: 2, enclosing: null, matches: null, components: [] },
      // pingA <-> pingB is a reference cycle reaching no component; the
      // visited set terminates the walk and the call stays unattributed.
      { method: "GET", path: "/api/ping", file: "src/lib/cycle.ts",
        line: 3, enclosing: "pingA", matches: null, components: [] },
      // The CONSTRUCTOR is dropped like every other non-method member:
      // SchedulerPanel does `new RefreshScheduler()`, but a type annotation
      // or instanceof would look identical to the edge walk, so "references
      // the class" cannot prove the constructor ran.
      { method: "GET", path: "/api/ctor", file: "src/lib/refresh.ts",
        line: 19, enclosing: "constructor", matches: null, components: [] },
      // A class PROPERTY ARROW is not a definition; its call is dropped,
      // never handed to the class and SchedulerPanel.
      { method: "GET", path: "/api/poll", file: "src/lib/refresh.ts",
        line: 26, enclosing: "poll", matches: null, components: [] },
      // The collision LOSER owns this call. SchedulerPanel references the
      // class, but ownership must not spill outward from the dropped method
      // to RefreshScheduler — unattributed, never mis-attributed.
      { method: "GET", path: "/api/refresh", file: "src/lib/refresh.ts",
        line: 29, enclosing: "Refresh", matches: null, components: [] },
      // A class EXPRESSION's members are never indexed; the whole expression
      // is dropped, so tick()'s call cannot spill to Poller's referencers.
      { method: "GET", path: "/api/klass", file: "src/lib/refresh.ts",
        line: 40, enclosing: "tick", matches: null, components: [] },
      // The provider swallow, pinned: SessionProvider references the service,
      // so the call is its. AccountMenu consumes the context hook and is
      // ABSENT on purpose — no reference edge connects it to the call, and
      // guessing one would be worse than missing it.
      { method: "GET", path: "/api/session", file: "src/providers/session-provider.tsx",
        line: 5, enclosing: "me", matches: null,
        components: ["src/providers/session-provider.tsx#SessionProvider"] },
      // The NESTED grouped client (api.users.list / api.users.find): each
      // call attributes only through its own member's caller. If the nested
      // members were not definitions of their own, both calls would fan out
      // to both components through `api.users`.
      { method: "GET", path: "/api/users", file: "src/services/api.ts",
        line: 9, enclosing: "list", matches: null,
        components: ["src/components/UserList.tsx#UserList"] },
      { method: "GET", path: "/api/users/*", file: "src/services/api.ts",
        line: 13, enclosing: "find", matches: null,
        components: ["src/components/UserFinder.tsx#UserFinder"] },
      // Members that cannot be definitions — computed key, accessor,
      // spread — each hold a call. Only the plain sibling attributes; the
      // other three are DROPPED, not spilled to exoticService and fanned
      // out to ExoticPanel. (The computed member's enclosing is null — a
      // computed name is no more knowable to enclosingName than to refs.)
      { method: "GET", path: "/api/exotic/plain", file: "src/services/exotic.service.ts",
        line: 10, enclosing: "plain", matches: null,
        components: ["src/components/ExoticPanel.tsx#ExoticPanel"] },
      { method: "GET", path: "/api/exotic/computed", file: "src/services/exotic.service.ts",
        line: 14, enclosing: null, matches: null, components: [] },
      { method: "GET", path: "/api/exotic/accessor", file: "src/services/exotic.service.ts",
        line: 17, enclosing: "lazy", matches: null, components: [] },
      { method: "GET", path: "/api/exotic/spread", file: "src/services/exotic.service.ts",
        line: 21, enclosing: "inlineSpread", matches: null, components: [] },
      // 3-hop: StatusPanel -> useStatus -> statusService.load, where the
      // hook holds a BARE method reference (a value, not a call).
      { method: "GET", path: "/api/status", file: "src/services/status.service.ts",
        line: 3, enclosing: "load", matches: null,
        components: ["src/components/StatusPanel.tsx#StatusPanel"] },
      // A sibling-bearing container that is not a set of definitions: the
      // object lives inside a factory CALL, so neither member is indexed,
      // and the owner (store) is not a component. Both calls are refused
      // rather than fanned out to StorePanel through the variable.
      { method: "GET", path: "/api/store/a", file: "src/services/store.ts",
        line: 13, enclosing: "loadA", matches: null, components: [] },
      { method: "GET", path: "/api/store/b", file: "src/services/store.ts",
        line: 16, enclosing: "loadB", matches: null, components: [] },
      // The sibling count is ALL properties: one named + one computed-key
      // member is still two siblings, so both calls are refused. Under a
      // named-members-only count this literal read as single-member and
      // both fanned out to StorePanel.
      { method: "GET", path: "/api/mixed/named", file: "src/services/store.ts",
        line: 31, enclosing: "named", matches: null, components: [] },
      { method: "GET", path: "/api/mixed/computed", file: "src/services/store.ts",
        line: 34, enclosing: null, matches: null, components: [] },
      // 2-hop through one method of the two-method service. ThingRemover
      // touches only removeThing, so it must NOT appear here: ownerDef is the
      // innermost definition (thingsService.getThings), never the holding
      // object, or every component touching any method would own every call.
      { method: "GET", path: "/api/things", file: "src/services/things.service.ts",
        line: 8, enclosing: "getThings", matches: null,
        components: ["src/components/ThingList.tsx#ThingList"] },
      // ...and the DELETE attributes only through the barrel importer.
      { method: "DELETE", path: "/api/things/*", file: "src/services/things.service.ts",
        line: 12, enclosing: "removeThing", matches: null,
        components: ["src/components/ThingRemover.tsx#ThingRemover"] },
    ]);
  });
});

/**
 * The tiebreak in isolation: two referenced projects with EQUAL file counts,
 * declared in REVERSED order, so only the explicit lexicographic comparison
 * can pick tsconfig.a.json. If the winner ever came from reference order or
 * sort stability, /api/b would appear and /api/a would vanish.
 */
const tie = extractNode(MINI_SOLUTION_TIE);

describe("solution-style tiebreak", () => {
  it("picks the lexicographically smaller config and says what it dropped", () => {
    expect(tie.warnings).toEqual([
      "tsconfig.json: 2 referenced projects; reading only tsconfig.a.json",
    ]);
  });

  it("reads only the winner's file", () => {
    expect(tie.clientCalls).toEqual([
      { method: "GET", path: "/api/a", file: "a.ts", line: 2,
        enclosing: null, matches: null, components: [] },
    ]);
    expect(tie.entities).toEqual([]);
    expect(tie.components).toEqual([]);
  });
});
