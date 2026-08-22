import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { tablesDeclaredIn, tablesInDdlText } from "./fixtures.js";

/**
 * The corpus drift oracle, covered hermetically: every literal here has an
 * answer that is obvious by eye, so a wrong-but-consistent regex cannot hide.
 * Needs no corpus and must pass under PSQ_NO_CORPUS=1.
 */

describe("tablesInDdlText", () => {
  it("finds a plain declaration", () => {
    expect(tablesInDdlText("CREATE TABLE x (id INTEGER)")).toEqual(["x"]);
  });

  it("accepts IF NOT EXISTS", () => {
    expect(tablesInDdlText("CREATE TABLE IF NOT EXISTS jobs (id)")).toEqual(["jobs"]);
  });

  it("accepts TEMP and TEMPORARY", () => {
    expect(tablesInDdlText("CREATE TEMP TABLE scratch (id)")).toEqual(["scratch"]);
    expect(tablesInDdlText("CREATE TEMPORARY TABLE staging (id)")).toEqual(["staging"]);
  });

  it("unwraps a quoted name", () => {
    expect(tablesInDdlText('CREATE TABLE "double_quoted" (id)')).toEqual(["double_quoted"]);
    expect(tablesInDdlText("CREATE TABLE `backticked` (id)")).toEqual(["backticked"]);
    expect(tablesInDdlText("CREATE TABLE [bracketed] (id)")).toEqual(["bracketed"]);
  });

  it("ignores a commented-out declaration", () => {
    const text = "CREATE TABLE real (id);\n-- CREATE TABLE ghost (id);\n";
    expect(tablesInDdlText(text)).toEqual(["real"]);
  });

  it("is not fooled by a `--` on an unrelated earlier line", () => {
    const text = "count--;\nCREATE TABLE after_decrement (id);\n";
    expect(tablesInDdlText(text)).toEqual(["after_decrement"]);
  });

  it("keeps a declaration with a trailing comment (only text before the match is inspected)", () => {
    expect(tablesInDdlText("CREATE TABLE x (id); -- trailing comment\n")).toEqual(["x"]);
  });

  it("ignores a `//`-commented declaration", () => {
    const text = "// CREATE TABLE ghost (id);\nCREATE TABLE real (id);\n";
    expect(tablesInDdlText(text)).toEqual(["real"]);
  });

  it("ignores a declaration inside a single-line block comment", () => {
    const text = "/* CREATE TABLE ghost (id); */\nCREATE TABLE real (id);\n";
    expect(tablesInDdlText(text)).toEqual(["real"]);
  });

  it("ignores a JSDoc continuation line", () => {
    const text = "/**\n * CREATE TABLE ghost (id)\n */\nCREATE TABLE real (id);\n";
    expect(tablesInDdlText(text)).toEqual(["real"]);
  });

  it("ignores prose in a comment that happens to contain CREATE TABLE", () => {
    // Would otherwise capture a table named `for`.
    const text = "// the CREATE TABLE for tasks lives above\nCREATE TABLE tasks (id);\n";
    expect(tablesInDdlText(text)).toEqual(["tasks"]);
  });

  it("dedupes duplicate declarations", () => {
    const text = "CREATE TABLE twice (id);\nCREATE TABLE IF NOT EXISTS twice (id);\n";
    expect(tablesInDdlText(text)).toEqual(["twice"]);
  });

  it("sorts the result regardless of source order", () => {
    const text = "CREATE TABLE zebra (id);\nCREATE TABLE apple (id);\n";
    expect(tablesInDdlText(text)).toEqual(["apple", "zebra"]);
  });

  it("misses a CREATE VIRTUAL TABLE entirely", () => {
    // Pins a documented-known-wrong miss (fixtures.ts silent-misses block).
    expect(tablesInDdlText("CREATE VIRTUAL TABLE fts USING fts5(content)")).toEqual([]);
  });

  it("captures the schema qualifier instead of the table name", () => {
    // Pins a documented-known-wrong capture (fixtures.ts silent-misses block).
    expect(tablesInDdlText("CREATE TABLE main.foo (id)")).toEqual(["main"]);
  });

  it("truncates a quoted name at its first space", () => {
    // Pins a documented-known-wrong capture (fixtures.ts silent-misses block).
    expect(tablesInDdlText('CREATE TABLE "my table" (id)')).toEqual(["my"]);
  });

  it("truncates a non-ASCII identifier at the first non-word character", () => {
    // Pins a documented-known-wrong capture (fixtures.ts silent-misses block).
    expect(tablesInDdlText("CREATE TABLE caf\u00e9 (id)")).toEqual(["caf"]);
  });

  it("skips a real declaration that shares a line with a comment opener", () => {
    // Pins the loud-failure direction (fixtures.ts silent-misses block, fifth
    // bullet): update the bullet and this test together, do not delete it.
    expect(tablesInDdlText("/* v2 */ CREATE TABLE foo (id)")).toEqual([]);
  });
});

const here = dirname(fileURLToPath(import.meta.url));

describe("tablesDeclaredIn", () => {
  it("throws when the file is missing", () => {
    const path = resolve(here, "fixtures/does-not-exist.ts");
    expect(() => tablesDeclaredIn(path)).toThrow(/no DDL file at/);
  });

  it("throws when the file declares nothing", () => {
    // A self-contained temp file, so this test cannot rot when a checked-in
    // source file gains a CREATE TABLE token in a comment or string.
    const dir = mkdtempSync(join(tmpdir(), "psq-oracle-"));
    try {
      const path = join(dir, "empty.ts");
      writeFileSync(path, "export const nothingDeclaredHere = 1;\n");
      expect(() => tablesDeclaredIn(path)).toThrow(/declares no CREATE TABLE/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
