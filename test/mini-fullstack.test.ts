import { describe, expect, it } from "vitest";
import { extractNode } from "@psq/extract";
import { MINI_FULLSTACK } from "./fixtures.js";

/**
 * The client-call reader (M5a) against the only repo anywhere with both an
 * express route surface and an HTTP client of it. Every call site asserted
 * here is in the fixture on purpose; the decoys (a wrapper's inner fetch, a
 * concatenated URL, a runtime URL, a Map.get) must stay silent AND absent.
 */

const g = extractNode(MINI_FULLSTACK);

describe("reading client calls", () => {
  it("extracts without a single warning", () => {
    // The reader warns only on an ambiguous match, which this fixture does
    // not contain. Everything it cannot read is a catalogued silent miss.
    expect(g.warnings).toEqual([]);
  });

  it("reads the server half as routes, never as client calls", () => {
    expect(g.routes).toEqual([
      { method: "GET", path: "/api/items", file: "server.ts", line: 37 },
      { method: "POST", path: "/api/items", file: "server.ts", line: 45 },
      { method: "GET", path: "/api/items/:id", file: "server.ts", line: 41 },
      { method: "GET", path: "/health", file: "server.ts", line: 33 },
    ]);
    // The /health registration wraps its handler in a call expression, a
    // shape the handler-argument guard cannot reject: only the express-import
    // file skip keeps it out of clientCalls. This assertion pins that guard
    // in isolation.
    // The Express exclusion: no phantom self-matching calls from server.ts.
    expect(g.clientCalls.every((c) => c.file === "client.ts")).toBe(true);
  });

  it("records each call site, matched or not, and nothing else", () => {
    expect(g.clientCalls).toEqual([
      // bare fetch defaults to GET
      { method: "GET", path: "/api/items", file: "client.ts", line: 23,
        enclosing: "listItems", matches: "GET /api/items",
        components: [] },
      // an explicit method in the options object wins
      { method: "POST", path: "/api/items", file: "client.ts", line: 28,
        enclosing: "createItem", matches: "POST /api/items",
        components: [] },
      // ${} hole and :id both normalise to *
      { method: "GET", path: "/api/items/*", file: "client.ts", line: 32,
        enclosing: "itemById", matches: "GET /api/items/:id",
        components: [] },
      // axios-style property access, any receiver
      { method: "GET", path: "/health", file: "client.ts", line: 36,
        enclosing: "checkHealth", matches: "GET /health",
        components: [] },
      // no such route: matches stays null, no warning
      { method: "POST", path: "/api/orders", file: "client.ts", line: 41,
        enclosing: "submitOrder", matches: null,
        components: [] },
      // module scope (enclosing null); query string dropped before matching
      { method: "GET", path: "/api/items", file: "client.ts", line: 45,
        enclosing: null, matches: "GET /api/items",
        components: [] },
      // identifier body — the standard axios signature; the property name
      // carries the method, so the second argument is never ambiguous
      { method: "POST", path: "/api/items", file: "client.ts", line: 63,
        enclosing: "replaceItems", matches: "POST /api/items",
        components: [] },
      // ABSENT on purpose: fetch("/api/orders", init) at client.ts:71 — an
      // identifier init leaves the method unknowable, so the call is skipped
      // rather than fabricated as a GET.
      // ABSENT on purpose: fetch("/api/orders", { method, body }) at
      // client.ts:99 — a shorthand `method` forwards a variable, so the
      // method is just as unknowable as an identifier init.
      // ABSENT on purpose: fetch("/api/items", { method: "GET", ...opts })
      // at client.ts:113 — the spread can carry method: "POST", so the
      // literal GET before it proves nothing; skipped, never fabricated.
      // ABSENT on purpose: fetch("/api/items", { method: "GET", [k]: v })
      // at client.ts:122 — the computed key can be "method", so the literal
      // GET before it proves nothing either; skipped the same way.
      // A string-literal "method" key is still a literal method: recorded.
      { method: "POST", path: "/api/items", file: "client.ts", line: 104,
        enclosing: "quotedKey", matches: "POST /api/items",
        components: [] },
    ]);
  });

  it("still reads the schema the server half declares", () => {
    expect(g.entities.map((e) => e.name)).toEqual(["items"]);
  });
});
