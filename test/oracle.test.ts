import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
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

  it("dedupes duplicate declarations", () => {
    const text = "CREATE TABLE twice (id);\nCREATE TABLE IF NOT EXISTS twice (id);\n";
    expect(tablesInDdlText(text)).toEqual(["twice"]);
  });

  it("sorts the result regardless of source order", () => {
    const text = "CREATE TABLE zebra (id);\nCREATE TABLE apple (id);\n";
    expect(tablesInDdlText(text)).toEqual(["apple", "zebra"]);
  });
});

const here = dirname(fileURLToPath(import.meta.url));

describe("tablesDeclaredIn", () => {
  it("throws when the file is missing", () => {
    const path = resolve(here, "fixtures/does-not-exist.ts");
    expect(() => tablesDeclaredIn(path)).toThrow(/no DDL file at/);
  });

  it("throws when the file declares nothing", () => {
    // fixtures.ts itself: real, readable, and free of CREATE TABLE.
    const path = resolve(here, "fixtures.ts");
    expect(() => tablesDeclaredIn(path)).toThrow(/declares no CREATE TABLE/);
  });
});
