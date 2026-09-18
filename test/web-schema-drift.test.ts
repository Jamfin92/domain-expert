import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { EntityGraph } from "@psq/schema";

/**
 * A drift pin between the wire schema and the hand-written client mirror.
 *
 * `apps/web` takes no workspace deps on purpose (stated at
 * `apps/web/src/lib/api.ts:33`), so every shape the server sends is restated
 * there by hand, and `call<T>()` ends in `return body as T` — no runtime
 * validation. That makes the divergence silent by construction: the mirror can
 * fall behind `@psq/schema` without a single test going red.
 *
 * This file lives in the root suite rather than in `apps/web` precisely so it
 * can import `@psq/schema` while leaving that app's dependency rule intact. It
 * reads the client file as TEXT, never as a module.
 *
 * The four schema-only fields are an explicit ALLOWLIST, not a "should be
 * identical" pin: the gap is real and deliberate today, so the assertion is
 * that the gap is exactly these four. It reddens when the gap widens (a new
 * schema field the client never learns about) AND when it narrows (a field
 * mirrored in the client without shrinking this list on purpose).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const API_TS = resolve(HERE, "../apps/web/src/lib/api.ts");

/** Field names declared by `EntityGraph` in `@psq/schema`. */
const SCHEMA_FIELDS = [
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
  "warnings",
].sort();

/** Field names declared by `interface EntityGraph` in the web client. */
const WEB_FIELDS = [
  "clientCalls",
  "components",
  "contextName",
  "entities",
  "provider",
  "relations",
  "repo",
  "warnings",
].sort();

/** Schema fields the client deliberately does not mirror. */
const NOT_MIRRORED = ["entityRefs", "kind", "routes", "shapes"].sort();

/**
 * Pull the field names out of `export interface EntityGraph { ... }` in the
 * client source. Deliberately narrow: it matches that one declaration only, so
 * a rename or a reformat makes the parse return nothing rather than quietly
 * matching some other interface. The "contains entities" assertion below is
 * the positive control that catches exactly that failure.
 */
function parseWebEntityGraphFields(source: string): string[] {
  const open = source.indexOf("export interface EntityGraph {");
  if (open === -1) return [];
  const close = source.indexOf("}", open);
  if (close === -1) return [];
  const body = source
    .slice(open + "export interface EntityGraph {".length, close)
    // strip block and line comments so a commented-out field is not counted
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
  const fields: string[] = [];
  for (const segment of body.split(";")) {
    const m = /^\s*([A-Za-z_$][\w$]*)\s*\??\s*:/.exec(segment);
    if (m?.[1]) fields.push(m[1]);
  }
  return fields.sort();
}

describe("apps/web mirrors the EntityGraph the server actually sends", () => {
  const webFields = parseWebEntityGraphFields(readFileSync(API_TS, "utf8"));

  it("1. @psq/schema EntityGraph declares exactly the pinned field set", () => {
    expect(Object.keys(EntityGraph.shape).sort()).toEqual(SCHEMA_FIELDS);
  });

  it("2. the web client's hand-written interface parses to the pinned field set", () => {
    // Positive control: a parse that silently matched nothing would satisfy a
    // subset check but never this one.
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
});
