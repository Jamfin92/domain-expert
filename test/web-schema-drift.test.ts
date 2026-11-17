import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ClientCall, Component, Coverage, CoverageStatus, EntityGraph, EntityRef, FacetCoverage, FactSource,
  ProviderBasis, Route, Shape, SkipReason, WarningCode, WarningRecord,
} from "@psq/schema";

/**
 * A drift pin between the wire schema and the hand-written client mirror.
 *
 * `apps/web` takes no workspace deps on purpose (stated at
 * `apps/web/src/lib/api.ts:39-40`), so every shape the server sends is restated
 * there by hand, and `call<T>()` ends in `return body as T` — no runtime
 * validation. That makes the divergence silent by construction: the mirror can
 * fall behind `@psq/schema` without a single test going red.
 *
 * This file lives in the root suite rather than in `apps/web` precisely so it
 * can import `@psq/schema` while leaving that app's dependency rule intact. It
 * reads the client file as TEXT, never as a module.
 *
 * `Route` and `RouteHandler` are pinned the same way with no allowlist (cases
 * 5-6): `handler` is mirrored, so the gap there is zero both ways. Case 7 is
 * the first ENUM pin: the web `FactSource` union against the schema enum, and
 * (7b) that the web `Route.source` is typed by it.
 *
 * Cases 8-15 (P2c-iii) pin the provenance types the client now reads —
 * `WarningRecord`, `Coverage`, `FacetCoverage` (+ its `skipped` element as
 * `SkipEntry`), `ProviderBasis`, their three enums — the P2c-i source fields
 * on `ClientCall` / `EntityRef` / `UiComponent` / `Shape`, and the web
 * `RepoSummary` against the SERVER's `RepoSummary` (text against text: the
 * server type is a TS interface, not a zod schema).
 *
 * The four schema-only EntityGraph fields are an explicit ALLOWLIST, not a "should be
 * identical" pin: the gap is real and deliberate today, so the assertion is
 * that the gap is exactly these four. It reddens when the gap widens (a new
 * schema field the client never learns about) AND when it narrows (a field
 * mirrored in the client without shrinking this list on purpose).
 *
 * Parser tolerance, measured rather than assumed. Tolerant of (still parses to
 * the same 13): field reordering, one field per line, line comments, JSDoc
 * blocks inside the body, multi-line union types, `?:` optional fields, a
 * missing final semicolon. FALSE RED on: the opening brace on its own line,
 * TWO spaces before the brace, commas used as member separators (valid TS —
 * only the first member parses). WRONG BUT RED: a nested object literal type
 * truncates the body at the inner `}`, because the `close` search below is
 * brace-depth-naive. The repo carries no prettier/biome/eslint/editorconfig
 * config, so nothing reformats this file spontaneously; the trade is
 * deliberate.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const API_TS = resolve(HERE, "../apps/web/src/lib/api.ts");
const WORKSPACE_TS = resolve(HERE, "../apps/server/src/workspace.ts");

/** Field names declared by `EntityGraph` in `@psq/schema`. */
const SCHEMA_FIELDS = [
  "calls",
  "clientCalls",
  "components",
  "contextName",
  "coverage",
  "entities",
  "entityRefs",
  "kind",
  "provider",
  "providerBasis",
  "relations",
  "repo",
  "routes",
  "shapes",
  "unresolvedCalls",
  "warningRecords",
  "warnings",
].sort();

/** Field names declared by `interface EntityGraph` in the web client. */
const WEB_FIELDS = [
  "clientCalls",
  "components",
  "contextName",
  "coverage",
  "entities",
  "entityRefs",
  "provider",
  "providerBasis",
  "relations",
  "repo",
  "routes",
  "warningRecords",
  "warnings",
].sort();

/** Schema fields the client deliberately does not mirror. */
// `calls` and `unresolvedCalls` are the C# call graph. The Flow view draws it, but from the
// server's /flow endpoint (`Flow`, mirrored in api.ts), so the client never reads the raw edges.
// `shapes` arrives on its own endpoint (`/shapes`, with `drift` added), never inside the graph.
const NOT_MIRRORED = ["calls", "kind", "shapes", "unresolvedCalls"].sort();

const ENTITY_GRAPH_MARKER = "export interface EntityGraph {";
const ROUTE_MARKER = "export interface Route {";
const HANDLER_MARKER = "export interface RouteHandler {";

/** Field names declared by `Route` in `@psq/schema` / the web client. */
const ROUTE_FIELDS = ["file", "handler", "line", "method", "path", "source"].sort();
/** Field names of `Route.handler` in `@psq/schema` / `RouteHandler` in the web client. */
const HANDLER_FIELDS = ["file", "line", "method", "type"].sort();

interface ParsedInterface {
  /** Members whose name the matcher recognised, sorted. */
  fields: string[];
  /**
   * Non-empty `;`-separated segments of the body that the matcher did NOT
   * recognise. Must always be empty: see the anti-silent-drop guard below.
   */
  unparsed: string[];
  /**
   * How many times `MARKER` occurs in the whole file. Must always be 1: the
   * parse below reads only the FIRST occurrence, and TypeScript merges a second
   * `export interface EntityGraph { ... }` block into the same type, so a second
   * declaration adds real members the parse cannot see.
   */
  markerCount: number;
}

/**
 * Pull the field names out of `export interface EntityGraph { ... }` in the
 * client source. Deliberately narrow: it matches that one declaration only, so
 * a rename or a reformat makes the parse return nothing rather than quietly
 * matching some other interface.
 *
 * Every non-empty `;`-segment that does not yield a name is returned in
 * `unparsed` rather than dropped. A dropped member is the failure mode that
 * would defeat the "gap narrows" direction of this gate: `readonly kind:
 * "entity";` or `"kind": "entity";` mirrors an allowlisted field, and a
 * silently-dropped `readonly phantomField: string;` invents one — all three
 * would leave every other assertion here green.
 */
function parseWebEntityGraphFields(source: string, marker = ENTITY_GRAPH_MARKER): ParsedInterface {
  const markerCount = source.split(marker).length - 1;
  const open = source.indexOf(marker);
  if (open === -1) return { fields: [], unparsed: [], markerCount };
  const close = source.indexOf("}", open);
  if (close === -1) return { fields: [], unparsed: [], markerCount };
  const body = source
    .slice(open + marker.length, close)
    // strip block and line comments so a commented-out field is not counted
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
  const fields: string[] = [];
  const unparsed: string[] = [];
  for (const segment of body.split(";")) {
    if (segment.trim() === "") continue;
    const m = /^\s*([A-Za-z_$][\w$]*)\s*\??\s*:/.exec(segment);
    if (m?.[1]) fields.push(m[1]);
    else unparsed.push(segment.trim());
  }
  return { fields: fields.sort(), unparsed, markerCount };
}

describe("apps/web mirrors the EntityGraph the server actually sends", () => {
  const { fields: webFields, unparsed, markerCount } =
    parseWebEntityGraphFields(readFileSync(API_TS, "utf8"));

  it("1. @psq/schema EntityGraph declares exactly the pinned field set", () => {
    expect(Object.keys(EntityGraph.shape).sort()).toEqual(SCHEMA_FIELDS);
  });

  it("2. the web client's hand-written interface parses to the pinned field set", () => {
    // Anti-declaration-merging guard. The parse reads only the FIRST
    // `export interface EntityGraph {` in the file, but TypeScript MERGES a
    // second declaration of the same interface into the same type — verified,
    // not assumed: with a second block appended, `pnpm --filter @psq/web
    // typecheck` still exits 0 and `const k: EntityGraph["kind"] = "entity"`
    // typechecks, so the extra member is genuinely on the type. A second block
    // could therefore mirror an allowlisted field with every other assertion
    // here green. Exactly one occurrence, or the parse is not authoritative.
    expect(
      markerCount,
      `expected exactly one \`${ENTITY_GRAPH_MARKER}\` in apps/web/src/lib/api.ts; ` +
        "more than one means a SECOND declaration of the interface exists, and " +
        "TypeScript declaration merging puts its members on the same type while " +
        "this parse reads only the first block — the parse is no longer " +
        "authoritative. Zero means the interface was renamed or reformatted out " +
        "of the matcher's reach.",
    ).toBe(1);
    // Anti-silent-drop guard. Every non-empty `;`-segment of the body must
    // have produced a field name, so a member the matcher cannot see reddens
    // here instead of vanishing. `unparsed` (not a bare count) is asserted
    // because the failure message then NAMES the segment that did not parse.
    expect(unparsed).toEqual([]);
    // The guard above passes vacuously on a body with zero segments (an empty
    // or unfound interface), so it is paired with a check that the parse found
    // something. This clause is a DIAGNOSTIC AID, not the detection mechanism:
    // `toEqual` against a 13-element pinned list already fails on an empty
    // parse. Its value is the message — "empty list" reads differently from
    // "list with an extra name", which is what tells an empty parse (M2) apart
    // from a deliberately mirrored field (M3).
    expect(webFields).toContain("entities");
    expect(webFields).toEqual(WEB_FIELDS);
  });

  it("3. the fields the client does not mirror are exactly the known four", () => {
    const schemaOnly = Object.keys(EntityGraph.shape)
      .filter((k) => !webFields.includes(k))
      .sort();
    expect(schemaOnly).toEqual(NOT_MIRRORED);
  });

  it("4. the client mirrors no field the server never sends", () => {
    const schemaKeys = Object.keys(EntityGraph.shape);
    expect(webFields.filter((f) => !schemaKeys.includes(f))).toEqual([]);
  });

  // Route and Route.handler are mirrored in full: unlike EntityGraph there is
  // no allowlist, the gap is zero in both directions. Same parser, same
  // single-declaration and nothing-unparsed guards.
  const source = readFileSync(API_TS, "utf8");
  const handlerShape = (Route.shape.handler as unknown as {
    unwrap(): { shape: Record<string, unknown> };
  }).unwrap().shape;

  it("5. the web Route mirrors @psq/schema's Route exactly", () => {
    expect(Object.keys(Route.shape).sort()).toEqual(ROUTE_FIELDS);
    const p = parseWebEntityGraphFields(source, ROUTE_MARKER);
    expect(p.markerCount).toBe(1);
    expect(p.unparsed).toEqual([]);
    expect(p.fields).toEqual(ROUTE_FIELDS);
  });

  it("6. the web RouteHandler mirrors @psq/schema's Route.handler exactly", () => {
    expect(Object.keys(handlerShape).sort()).toEqual(HANDLER_FIELDS);
    const p = parseWebEntityGraphFields(source, HANDLER_MARKER);
    expect(p.markerCount).toBe(1);
    expect(p.unparsed).toEqual([]);
    expect(p.fields).toEqual(HANDLER_FIELDS);
  });

  // The first ENUM drift check: `Route.source` is typed by the web's own
  // `FactSource` union, so its members must be exactly the schema enum's. A
  // one-line regex over quoted literals on the single `export type FactSource =`
  // line; no brace parsing.
  it("7. the web FactSource union lists exactly @psq/schema's FactSource values", () => {
    const decl = /^export type FactSource =[^;]*;/m.exec(source);
    expect(decl, "expected one `export type FactSource = ...;` in apps/web/src/lib/api.ts").not.toBeNull();
    expect(source.match(/^export type FactSource =/gm)).toHaveLength(1);
    const web = [...decl![0].matchAll(/"([^"]*)"/g)].map((m) => m[1]!).sort();
    expect(web).toContain("inferred");
    expect(web).toEqual([...FactSource.options].sort());
  });

  // Case 5 checks member NAMES only, so `source: string` would pass it. The
  // web Route's `source` must be typed by the pinned union.
  it("7b. the web Route's `source` is typed FactSource", () => {
    const open = source.indexOf(ROUTE_MARKER);
    const body = source.slice(open, source.indexOf("}", open));
    expect(/^\s*source\s*:\s*FactSource\s*;/m.test(body)).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // P2c-iii: provenance types (cases 8-15)
  // ---------------------------------------------------------------------------

  /** Parse one named interface out of api.ts with the shared guards; returns its sorted fields. */
  function webInterface(marker: string, from = source): string[] {
    const p = parseWebEntityGraphFields(from, marker);
    expect(p.markerCount, `expected exactly one \`${marker}\``).toBe(1);
    expect(p.unparsed).toEqual([]);
    return p.fields;
  }

  /** The body text of one named interface, for type pins like 7b. */
  function webBody(marker: string): string {
    const open = source.indexOf(marker);
    expect(open, `expected \`${marker}\``).toBeGreaterThan(-1);
    return source.slice(open, source.indexOf("}", open));
  }

  /**
   * Case 7's four assertions, generalised: exactly one `export type NAME =`
   * declaration, its quoted literals harvested, a positive control, and
   * equality with the zod enum's options.
   */
  function enumMirror(name: string, options: readonly string[], control: string): void {
    const decl = new RegExp(`^export type ${name} =[^;]*;`, "m").exec(source);
    expect(decl, `expected one \`export type ${name} = ...;\` in apps/web/src/lib/api.ts`).not.toBeNull();
    expect(source.match(new RegExp(`^export type ${name} =`, "gm"))).toHaveLength(1);
    const web = [...decl![0].matchAll(/"([^"]*)"/g)].map((m) => m[1]!).sort();
    expect(web).toContain(control);
    expect(web).toEqual([...options].sort());
  }

  it("8. the web WarningRecord mirrors @psq/schema's WarningRecord exactly", () => {
    const fields = webInterface("export interface WarningRecord {");
    expect(fields).toContain("code");
    expect(fields).toEqual(Object.keys(WarningRecord.shape).sort());
  });

  it("9. the web Coverage lists exactly @psq/schema's nine facets", () => {
    const fields = webInterface("export interface Coverage {");
    expect(fields).toHaveLength(9);
    expect(fields).toEqual(Object.keys(Coverage.shape).sort());
  });

  // `FacetCoverage` is a ZodEffects (it carries a `.refine`): `.shape` on it is
  // undefined, so the inner object is read through `.innerType()`. A wrong
  // accessor throws in `Object.keys` rather than passing vacuously.
  const facetShape = FacetCoverage.innerType().shape;

  it("10. the web FacetCoverage mirrors @psq/schema's FacetCoverage exactly", () => {
    const fields = webInterface("export interface FacetCoverage {");
    expect(fields).toContain("status");
    expect(fields).toEqual(Object.keys(facetShape).sort());
  });

  it("11. the web ProviderBasis mirrors @psq/schema's ProviderBasis exactly", () => {
    const fields = webInterface("export interface ProviderBasis {");
    expect(fields).toHaveLength(8);
    expect(fields).toEqual(Object.keys(ProviderBasis.shape).sort());
  });

  it("12. the web SkipEntry mirrors FacetCoverage.skipped's element exactly", () => {
    const fields = webInterface("export interface SkipEntry {");
    expect(fields).toContain("why");
    expect(fields).toEqual(Object.keys(facetShape.skipped.element.shape).sort());
  });

  it("13. the web CoverageStatus / SkipReason / WarningCode unions list exactly the schema enums", () => {
    enumMirror("CoverageStatus", CoverageStatus.options, "none-found");
    enumMirror("SkipReason", SkipReason.options, "walk-limit");
    enumMirror("WarningCode", WarningCode.options, "no-schema");
  });

  it("14. the web ClientCall / EntityRef / UiComponent / Shape mirror the schema, sources typed FactSource", () => {
    expect(webInterface("export interface ClientCall {")).toEqual(Object.keys(ClientCall.shape).sort());
    expect(webInterface("export interface EntityRef {")).toEqual(Object.keys(EntityRef.shape).sort());
    expect(webInterface("export interface UiComponent {")).toEqual(Object.keys(Component.shape).sort());
    // `GET /:id/shapes` sends `{ ...shape, drift }`, so the web Shape carries one extra key.
    expect(webInterface("export interface Shape {")).toEqual([...Object.keys(Shape.shape), "drift"].sort());

    expect(/^\s*source\s*:\s*FactSource\s*;/m.test(webBody("export interface UiComponent {"))).toBe(true);
    expect(/(^|;)\s*source\s*:\s*FactSource\s*;/m.test(webBody("export interface EntityRef {"))).toBe(true);
    const call = webBody("export interface ClientCall {");
    expect(/\bmatchSource\s*:\s*FactSource\s*\|\s*null\s*;/.test(call)).toBe(true);
    expect(/\bcomponentsSource\s*:\s*FactSource\s*\|\s*null\s*;/.test(call)).toBe(true);
    expect(/\bmirrorSource\s*:\s*FactSource\s*\|\s*null\s*;/.test(webBody("export interface Shape {"))).toBe(true);
  });

  it("15. the web RepoSummary declares exactly the server's RepoSummary keys", () => {
    const marker = "export interface RepoSummary {";
    const server = webInterface(marker, readFileSync(WORKSPACE_TS, "utf8"));
    const web = webInterface(marker);
    expect(server).toContain("coverage");
    expect(web).toContain("coverage");
    expect(web).toEqual(server);
  });
});
