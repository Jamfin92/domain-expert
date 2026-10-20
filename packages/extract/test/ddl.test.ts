import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractNode } from "../src/node.js";

/**
 * The DDL candidate predicate (P2b F2). A literal is executed only when its
 * first token, after whitespace and SQL comments, starts a SQLite statement
 * AND it says CREATE TABLE. Prose that merely mentions CREATE TABLE is not
 * executed, so it can no longer produce "a CREATE TABLE literal did not execute".
 */
describe("which literals are DDL", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  function repo(files: Record<string, string>): string {
    const d = mkdtempSync(join(tmpdir(), "psq-ddl-"));
    dirs.push(d);
    for (const [name, body] of Object.entries(files)) writeFileSync(join(d, name), body);
    return d;
  }

  it("reads real DDL behind comments and PRAGMA, and never executes prose", () => {
    const g = extractNode(repo({
      "prose.ts": 'export const msg = "No CREATE TABLE statement was found, so this repo has shapes but no schema.";\n',
      "help.ts": 'export const help = "psq graph  reads every CREATE TABLE literal it finds";\n',
      "comment.ts": 'export const a = "-- the a table\\n/* block */ CREATE TABLE a_t (id INTEGER PRIMARY KEY);";\n',
      "pragma.ts": 'export const b = "PRAGMA foreign_keys=ON; CREATE TABLE b_t (id INTEGER PRIMARY KEY);";\n',
      "real.ts": "export const c = `\n  create table c_t (id INTEGER PRIMARY KEY, a_t_id INTEGER)\n`;\n",
    }));
    expect(g.entities.map((e) => e.name).sort()).toEqual(["a_t", "b_t", "c_t"]);
    expect(g.warningRecords.filter((r) => r.code === "ddl-candidate-failed")).toEqual([]);
    expect(g.warnings.some((w) => /did not execute/.test(w))).toBe(false);
  });

  it("warns on a substituted template only when its first literal text starts a statement", () => {
    const g = extractNode(repo({
      "sub.ts": [
        "const t = 'x'; const p = ''; const pragmas = 'PRAGMA foreign_keys=ON';",
        "export const d = `CREATE TABLE ${t} (id INTEGER)`;",
        "export const e = `Prose about CREATE TABLE ${t}`;",
        "export const f = `${t}: CREATE TABLE in a sentence`;",
        "export const g = `  -- c\\n  CREATE TABLE y_${t} (id INTEGER)`;",
        "export const h = `${p}CREATE TABLE z_${t} (id INTEGER)`;",
        "export const i = `${pragmas}; CREATE TABLE w_${t} (id INTEGER)`;",
        "export const j = `${p}${t}\\n CREATE TABLE v (id INTEGER)`;",
        "export const k = `${t}: CREATE TABLE in a template literal with substitutions; not read`;",
        "",
      ].join("\n"),
    }));
    const subs = g.warningRecords.filter((r) => r.code === "ddl-substitution-literal");
    // d (a statement head), g (a statement behind a comment), and the three
    // empty-head runtime-built DDL templates h, i (after a `;` separator), j
    // (after two substitutions), judged by their first non-blank literal text.
    // Never the prose e, f or k, whatever their head.
    expect(subs.map((r) => r.line)).toEqual([2, 5, 6, 7, 8]);
    expect(subs.map((r) => r.file)).toEqual(["sub.ts", "sub.ts", "sub.ts", "sub.ts", "sub.ts"]);
    expect(subs[0]!.text).toBe("sub.ts:2: CREATE TABLE in a template literal with substitutions; not read");
  });

  it("keeps the warning on a template that is only substitutions (cannot be judged)", () => {
    // No literal text at all: the CREATE TABLE is inside a substitution, so
    // nothing says whether this is a statement. Rule 3: warn.
    const g = extractNode(repo({
      "only.ts": "const b = '';\nexport const s = `${\"CREATE TABLE q (id INTEGER)\"}${b}`;\n",
    }));
    const subs = g.warningRecords.filter((r) => r.code === "ddl-substitution-literal");
    expect(subs.map((r) => [r.file, r.line])).toEqual([["only.ts", 2]]);
  });

  it("still reports real DDL that SQLite refuses", () => {
    const g = extractNode(repo({ "bad.ts": 'export const s = "CREATE TABLE broken (";\n' }));
    const failed = g.warningRecords.filter((r) => r.code === "ddl-candidate-failed");
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ file: "bad.ts", line: null, about: null });
    expect(failed[0]!.text).toMatch(/^bad\.ts: a CREATE TABLE literal did not execute \(/);
  });
});
