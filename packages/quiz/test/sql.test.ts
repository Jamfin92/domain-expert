import { describe, it, expect } from "vitest";
import { unlinkSync, readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { extractDotnet } from "@psq/extract";
import { materialize } from "../src/sql/seed.js";
import { refuse, runQuery, resultsMatch, type SqlResult } from "../src/sql/sandbox.js";
import { generateEntitySql } from "../src/generate/entity-sql.js";
import { generateEntityCloze } from "../src/generate/entity-cloze.js";
import { grade } from "../src/grade.js";
import { selftest } from "../src/selftest.js";
import { MINI_EFCORE } from "../../../test/fixtures.js";

const g = extractDotnet(MINI_EFCORE);

describe("schema materialization", () => {
  it("seeds every table with no warnings", () => {
    const s = materialize(g, { seed: 1337, rows: 40 });
    expect(s.warnings).toEqual([]);
    for (const e of g.entities) expect(s.rowCounts.get(e.name)).toBeGreaterThan(0);
    s.close();
  });

  it("is byte-identical for the same seed", () => {
    const hashes = [1, 2].map((run) => {
      const path = `/tmp/psq-test-seed-${run}.db`;
      if (existsSync(path)) unlinkSync(path);
      materialize(g, { seed: 1337, rows: 20, path }).close();
      const h = createHash("sha256").update(readFileSync(path)).digest("hex");
      unlinkSync(path);
      return h;
    });
    expect(hashes[0]).toBe(hashes[1]);
  });

  it("honors foreign keys, so no child points at a missing parent", () => {
    const s = materialize(g, { seed: 7, rows: 30 });
    const orphans = runQuery(
      s.db,
      `SELECT count(*) AS n FROM "Enrollments" e
       LEFT JOIN "Students" s ON s."Id" = e."StudentId" WHERE s."Id" IS NULL`,
    );
    expect(orphans.ok && orphans.rows[0]!["n"]).toBe(0);
    s.close();
  });

  it("leaves optional foreign keys null often enough to be worth asking about", () => {
    const s = materialize(g, { seed: 7, rows: 40 });
    const r = runQuery(s.db, `SELECT count(*) AS n FROM "Students" WHERE "AdvisorId" IS NULL`);
    expect(r.ok && Number(r.rows[0]!["n"])).toBeGreaterThan(0);
    s.close();
  });

  it("respects a max length as a CHECK constraint", () => {
    expect(materialize(g, { seed: 1 }).ddl).toContain('CHECK (length("Name") <= 80)');
  });
});

describe("SQL sandbox", () => {
  it("refuses anything that is not a single read", () => {
    expect(refuse(`ATTACH DATABASE '/tmp/other.db' AS o`)).toMatch(/only SELECT and WITH/);
    expect(refuse(`PRAGMA table_info("Students")`)).toMatch(/only SELECT and WITH/);
    expect(refuse(`DELETE FROM "Students"`)).toMatch(/only SELECT and WITH/);
    expect(refuse(`SELECT 1; DROP TABLE "Students"`)).toMatch(/only one statement/);
    expect(refuse(`WITH x AS (SELECT 1) INSERT INTO "Students" DEFAULT VALUES`)).toMatch(/only read/);
    expect(refuse("   ")).toMatch(/empty/);
  });

  it("allows legitimate reads that merely look suspicious", () => {
    // A semicolon inside a string literal is not a statement separator, and a
    // comment is not a smuggled keyword.
    expect(refuse(`SELECT "Name" FROM "Students" WHERE "Name" = 'a;b'`)).toBeNull();
    expect(refuse(`SELECT/* note */ 1`)).toBeNull();
    expect(refuse(`WITH t AS (SELECT 1 AS a) SELECT a FROM t`)).toBeNull();
    expect(refuse(`SELECT 1;`)).toBeNull();
  });

  it("reports a refusal without executing", () => {
    const s = materialize(g, { seed: 1, rows: 5 });
    const before = runQuery(s.db, `SELECT count(*) AS n FROM "Students"`);
    const attempt = runQuery(s.db, `DELETE FROM "Students"`);
    expect(attempt.ok).toBe(false);
    expect(!attempt.ok && attempt.rejected).toBe(true);
    const after = runQuery(s.db, `SELECT count(*) AS n FROM "Students"`);
    expect(before.ok && after.ok && before.rows[0]!["n"]).toBe(
      after.ok ? after.rows[0]!["n"] : -1,
    );
    s.close();
  });
});

describe("result comparison", () => {
  const mk = (rows: Array<Record<string, unknown>>): SqlResult => ({
    ok: true,
    columns: rows.length > 0 ? Object.keys(rows[0]!) : [],
    rows,
    truncated: false,
  });

  it("ignores row order unless the reference asks for an order", () => {
    const a = mk([{ n: "x" }, { n: "y" }]);
    const b = mk([{ n: "y" }, { n: "x" }]);
    expect(resultsMatch(a, b, "SELECT n FROM t").same).toBe(true);
    expect(resultsMatch(a, b, "SELECT n FROM t ORDER BY n").same).toBe(false);
  });

  it("ignores column names, so an alias does not change the answer", () => {
    expect(resultsMatch(mk([{ label: 1 }]), mk([{ whatever: 1 }]), "SELECT 1").same).toBe(true);
  });

  it("treats 5 and 5.0 as the same value", () => {
    expect(resultsMatch(mk([{ n: 5 }]), mk([{ n: 5.0 }]), "SELECT 1").same).toBe(true);
  });

  it("reports a row-count mismatch rather than a confusing column mismatch", () => {
    const cmp = resultsMatch(mk([{ n: 1 }]), mk([]), "SELECT 1");
    expect(cmp.same).toBe(false);
    expect(cmp.detail).toContain("expected 1 row(s), got 0");
  });
});

describe("SQL questions", () => {
  const s = materialize(g, { seed: 1337, rows: 40 });
  const sql = generateEntitySql(g, s, 1337);
  const ctx = { db: s.db };

  it("generates questions of every SQL kind", () => {
    const gens = new Set(sql.map((q) => q.generator));
    expect(gens).toContain("sql-join");
    expect(gens).toContain("sql-range");
    expect(gens).toContain("sql-group");
  });

  it("asks a GPA question the way a person would ask it", () => {
    const range = sql.find((q) => q.generator === "sql-range")!;
    expect(range.prompt).toContain("a B+");
    expect(range.answers).toEqual(["3.3", "3.7"]);
  });

  it("grades a range question on the rows, not the text", () => {
    const range = sql.find((q) => q.generator === "sql-range")!;
    expect(grade(range, "3.3, 3.7", ctx).correct).toBe(true);
    expect(grade(range, "3.5, 3.7", ctx).correct).toBe(false);
    expect(grade(range, "3.3, 3.9", ctx).correct).toBe(false);
    expect(grade(range, "3.7, 3.3", ctx).correct).toBe(false);
  });

  it("accepts a differently written but equivalent query", () => {
    const group = sql.find((q) => q.generator === "sql-group")!;
    const equivalent = group
      .referenceSql!.replaceAll("label", "whatever")
      .replaceAll(" d ", " dep ")
      .replaceAll("d.", "dep.");
    expect(equivalent).not.toBe(group.referenceSql);
    expect(grade(group, equivalent, ctx).correct).toBe(true);
  });

  it("rejects a query that reads the wrong table", () => {
    const join = sql.find((q) => q.generator === "sql-join")!;
    const wrong = join.answers![0] === '"Departments"' ? '"Advisors"' : '"Departments"';
    expect(grade(join, join.answers!.join(", "), ctx).correct).toBe(true);
    expect(grade(join, `${wrong}, ${join.answers![1]}, ${join.answers![2]}`, ctx).correct).toBe(false);
  });

  it("refuses a malicious answer instead of running it", () => {
    const group = sql.find((q) => q.generator === "sql-group")!;
    const r = grade(group, `ATTACH DATABASE '/tmp/x.db' AS e`, ctx);
    expect(r.correct).toBe(false);
    expect(r.detail).toContain("refused");
  });

  it("passes the selftest gate with a database", () => {
    expect(selftest(sql, ctx)).toEqual([]);
  });

  it("refuses to validate an exec question without a database", () => {
    expect(selftest(sql).map((f) => f.problem).join()).toContain("without a seeded database");
  });

  it("catches a blank that no answer could get wrong", () => {
    // Widen the upper bound past the data so any larger value also passes.
    const range = structuredClone(sql.find((q) => q.generator === "sql-range")!);
    range.referenceSql = range.referenceSql!.replace("< 3.7", "< 99");
    range.sqlTemplate = range.sqlTemplate!;
    range.answers = ["3.3", "99"];
    const problems = selftest([range], ctx).map((f) => f.problem).join("\n");
    expect(problems).toContain("blank 2 cannot be got wrong");
  });
});

describe("cloze questions", () => {
  const cloze = generateEntityCloze(g, 1337);

  it("accepts any alias of the right entity", () => {
    const nav = cloze.find((q) => q.generator === "navigation-type")!;
    expect(nav.prompt).toContain("____");
    expect(grade(nav, nav.answers![0]!).correct).toBe(true);
    expect(grade(nav, nav.answers![0]!.toLowerCase()).correct).toBe(true);
    expect(grade(nav, "NotAnEntity").correct).toBe(false);
  });

  it("requires every blank of a composite key", () => {
    const key = cloze.find((q) => q.generator === "composite-key-parts")!;
    expect(key.answers).toHaveLength(2);
    expect(grade(key, key.answers!.join(", ")).correct).toBe(true);
    expect(grade(key, key.answers![0]!).correct).toBe(false);
    expect(grade(key, `${key.answers![1]}, ${key.answers![0]}`).correct).toBe(false);
  });

  it("passes the selftest gate", () => {
    expect(selftest(cloze)).toEqual([]);
  });
});
