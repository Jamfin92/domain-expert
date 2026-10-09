import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { EntityGraph, Route } from "@psq/schema";

/**
 * A drift pin between the wire schema and the hand-written client mirror.
 *
 * `apps/web` takes no workspace deps on purpose (stated at
 * `apps/web/src/lib/api.ts:33-34`), so every shape the server sends is restated
 * there by hand, and `call<T>()` ends in `return body as T` — no runtime
 * validation. That makes the divergence silent by construction: the mirror can
 * fall behind `@psq/schema` without a single test going red.
 *
 * This file lives in the root suite rather than in `apps/web` precisely so it
 * can import `@psq/schema` while leaving that app's dependency rule intact. It
 * reads the client file as TEXT, never as a module.
 *
 * `Route` and `RouteHandler` are pinned the same way with no allowlist (cases
 * 5-6): `handler` is mirrored, so the gap there is zero both ways.
 *
 * The four schema-only EntityGraph fields are an explicit ALLOWLIST, not a "should be
 * identical" pin: the gap is real and deliberate today, so the assertion is
 * that the gap is exactly these four. It reddens when the gap widens (a new
 * schema field the client never learns about) AND when it narrows (a field
 * mirrored in the client without shrinking this list on purpose).
 *
 * Parser tolerance, measured rather than assumed. Tolerant of (still parses to
 * the same 10): field reordering, one field per line, line comments, JSDoc
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

/** Field names declared by `EntityGraph` in `@psq/schema`. */
const SCHEMA_FIELDS = [
  "calls",
  "clientCalls",
  "components",
  "contextName",
  "entities",
  "entityRefs",
  "kind",
  "provider",
  "relations",
  "repo",
  "routes",
  "shapes",
  "unresolvedCalls",
  "warnings",
].sort();

/** Field names declared by `interface EntityGraph` in the web client. */
const WEB_FIELDS = [
  "clientCalls",
  "components",
  "contextName",
  "entities",
  "entityRefs",
  "provider",
  "relations",
  "repo",
  "routes",
  "warnings",
].sort();

/** Schema fields the client deliberately does not mirror. */
// `calls` and `unresolvedCalls` are the C# call graph. The Flow view draws it, but from the
// server's /flow endpoint (`Flow`, mirrored in api.ts), so the client never reads the raw edges.
const NOT_MIRRORED = ["calls", "kind", "shapes", "unresolvedCalls"].sort();

const ENTITY_GRAPH_MARKER = "export interface EntityGraph {";
const ROUTE_MARKER = "export interface Route {";
const HANDLER_MARKER = "export interface RouteHandler {";

/** Field names declared by `Route` in `@psq/schema` / the web client. */
const ROUTE_FIELDS = ["file", "handler", "line", "method", "path"].sort();
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
    // `toEqual` against a 10-element pinned list already fails on an empty
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
});
