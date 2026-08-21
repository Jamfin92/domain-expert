import type { Entity, EntityGraph, Question } from "@psq/schema";
import { hashSeed, rng, type Rng } from "../rng.js";
import type { SeededDb } from "../sql/seed.js";
import { runQuery } from "../sql/sandbox.js";

/**
 * SQL questions graded by execution.
 *
 * These are the questions a schema alone cannot support. "Which students have
 * a B+ GPA?" needs rows to have an answer, so psq materializes the schema,
 * seeds it deterministically, and grades by running the candidate query
 * against the reference query and comparing result sets.
 *
 * A generator only emits a question after running its own reference query and
 * checking the result is worth asking about. A query returning zero rows, or
 * every row, teaches nothing and is silently dropped.
 */

interface Ctx {
  g: EntityGraph;
  seeded: SeededDb;
  rnd: Rng;
}

const q = (s: string): string => `"${s.replace(/"/g, '""')}"`;

/** Reject a reference query that is unanswerable or trivially true. */
function isUsefulResult(ctx: Ctx, sql: string, table: string): boolean {
  const r = runQuery(ctx.seeded.db, sql);
  if (!r.ok) return false;
  const total = ctx.seeded.rowCounts.get(table) ?? 0;
  // Between one row and everything: a question with no answer, or whose answer
  // is "all of them", measures nothing.
  return r.rows.length > 0 && r.rows.length < total;
}

function sqlQuestion(parts: {
  id: string;
  generator: string;
  prompt: string;
  referenceSql: string;
  sqlTemplate?: string;
  answers?: string[];
  subjects: string[];
  rationale: string;
}): Question {
  return {
    id: parts.id,
    section: "entity",
    kind: "sql",
    gradeMode: "exec",
    generator: parts.generator,
    prompt: parts.prompt,
    referenceSql: parts.referenceSql,
    sqlTemplate: parts.sqlTemplate,
    answers: parts.answers,
    subjects: parts.subjects,
    rationale: parts.rationale,
  };
}

/**
 * Fill the blanks in a JOIN. The reader must know which table and which
 * columns connect two entities.
 */
function joinBlanks(ctx: Ctx): Question[] {
  const out: Question[] = [];
  const byName = new Map(ctx.g.entities.map((e) => [e.name, e]));

  for (const r of ctx.g.relations) {
    if (!r.foreignKeyProperty) continue;
    const dep = byName.get(r.dependent);
    const pri = byName.get(r.principal);
    const pk = pri?.keys[0];
    if (!dep || !pri || pk === undefined || pri.keys.length !== 1) continue;

    // A readable non-key column to select, so the result is recognisable.
    const label = pri.properties.find(
      (p) => !p.isNavigation && !p.isPrimaryKey && p.baseType === "string",
    );
    if (!label) continue;

    const reference =
      `SELECT p.${q(label.column)} FROM ${q(dep.tableName)} d ` +
      `JOIN ${q(pri.tableName)} p ON p.${q(pk)} = d.${q(r.foreignKeyProperty)}`;
    const template =
      `SELECT p.${q(label.column)} FROM ${q(dep.tableName)} d ` +
      `JOIN ____ p ON p.____ = d.____`;

    const check = runQuery(ctx.seeded.db, reference);
    if (!check.ok || check.rows.length === 0) continue;

    out.push(
      sqlQuestion({
        id: `entity.sql.join.${r.id}`,
        generator: "sql-join",
        prompt:
          `Complete the join from ${r.dependent} to ${r.principal}. ` +
          `Give the three blanks in order, separated by commas.\n\n    ` +
          template.replace(" JOIN ", "\n    JOIN "),
        referenceSql: reference,
        sqlTemplate: template,
        answers: [q(pri.tableName), q(pk), q(r.foreignKeyProperty)],
        subjects: [r.dependent, r.principal],
        rationale:
          `${r.dependent}.${r.foreignKeyProperty} references ` +
          `${r.principal}.${pk} (table ${pri.tableName}).`,
      }),
    );
  }
  return out;
}

/**
 * Named grade bands on the 4.0 scale. A question about a GPA should ask the
 * way a person asks it — "a B+ GPA" — not "between the 40th and 70th
 * percentile of the seeded data".
 */
const GRADE_BANDS: ReadonlyArray<readonly [string, number, number]> = [
  ["an A-", 3.7, 4.01],
  ["a B+", 3.3, 3.7],
  ["a B", 3.0, 3.3],
  ["a C+", 2.3, 2.7],
];

/**
 * A range filter over a numeric column — the shape of "which students have a
 * B+ GPA". The bounds are the blanks.
 */
function rangeFilter(ctx: Ctx): Question[] {
  const out: Question[] = [];

  for (const e of ctx.g.entities) {
    const numeric = e.properties.filter(
      (p) =>
        !p.isNavigation && !p.isPrimaryKey && !p.isForeignKey &&
        ["decimal", "double", "float"].includes(p.baseType.replace(/\?$/, "")),
    );
    const label = e.properties.find(
      (p) => !p.isNavigation && !p.isPrimaryKey && p.baseType === "string",
    );
    if (numeric.length === 0 || !label) continue;

    for (const col of numeric.slice(0, 2)) {
      // Pick bounds from the data so the answer is never empty.
      const stats = runQuery(
        ctx.seeded.db,
        `SELECT min(${q(col.column)}) AS lo, max(${q(col.column)}) AS hi FROM ${q(e.tableName)}`,
      );
      if (!stats.ok || stats.rows.length === 0) continue;
      const lo = Number(stats.rows[0]!["lo"]);
      const hi = Number(stats.rows[0]!["hi"]);
      if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) continue;

      // A recognisable band beats an arbitrary slice, when the column is one.
      let from = Number((lo + (hi - lo) * 0.4).toFixed(2));
      let to = Number((lo + (hi - lo) * 0.7).toFixed(2));
      let phrase = `is at least ${from} and below ${to}`;

      if (col.name.toLowerCase().includes("gpa")) {
        for (const [label, bandLo, bandHi] of GRADE_BANDS) {
          const probe = runQuery(
            ctx.seeded.db,
            `SELECT count(*) AS n FROM ${q(e.tableName)} ` +
              `WHERE ${q(col.column)} >= ${bandLo} AND ${q(col.column)} < ${bandHi}`,
          );
          if (!probe.ok) continue;
          // Both bounds must sit inside the data, or one of them accepts any
          // value beyond the edge and the reader can never get it wrong.
          if (bandLo <= lo || bandHi >= hi) continue;
          const n = Number(probe.rows[0]?.["n"] ?? 0);
          if (n > 0 && n < (ctx.seeded.rowCounts.get(e.name) ?? 0)) {
            from = bandLo;
            to = bandHi;
            phrase = `is ${label} (at least ${bandLo} and below ${bandHi})`;
            break;
          }
        }
      }

      const reference =
        `SELECT ${q(label.column)} FROM ${q(e.tableName)} ` +
        `WHERE ${q(col.column)} >= ${from} AND ${q(col.column)} < ${to} ` +
        `ORDER BY ${q(label.column)}`;
      const template =
        `SELECT ${q(label.column)} FROM ${q(e.tableName)} ` +
        `WHERE ${q(col.column)} >= ____ AND ${q(col.column)} < ____ ` +
        `ORDER BY ${q(label.column)}`;

      if (!isUsefulResult(ctx, reference, e.name)) continue;

      out.push(
        sqlQuestion({
          id: `entity.sql.range.${e.name}.${col.name}`,
          generator: "sql-range",
          prompt:
            `Return the ${label.column} of every ${e.name} whose ${col.name} ` +
            `${phrase}. Give the two bounds, separated by a comma.\n\n    ` +
            template.replace(" WHERE ", "\n    WHERE ").replace(" ORDER BY ", "\n    ORDER BY "),
          referenceSql: reference,
          sqlTemplate: template,
          answers: [String(from), String(to)],
          subjects: [e.name],
          rationale: `${e.name}.${col.name} ranges from ${lo} to ${hi} in the seeded data.`,
        }),
      );
    }
  }
  return out;
}

/** "Which column tells you X is unset?" — a null filter. */
function nullFilter(ctx: Ctx): Question[] {
  const out: Question[] = [];
  for (const r of ctx.g.relations) {
    if (r.required || !r.foreignKeyProperty) continue;
    const dep = ctx.g.entities.find((e) => e.name === r.dependent);
    if (!dep) continue;
    const reference =
      `SELECT count(*) AS n FROM ${q(dep.tableName)} WHERE ${q(r.foreignKeyProperty)} IS NULL`;
    const check = runQuery(ctx.seeded.db, reference);
    if (!check.ok || Number(check.rows[0]?.["n"] ?? 0) === 0) continue;

    const template = `SELECT count(*) AS n FROM ${q(dep.tableName)} WHERE ____ IS NULL`;
    out.push(
      sqlQuestion({
        id: `entity.sql.null.${r.id}`,
        generator: "sql-null",
        prompt:
          `${r.dependent} has an optional link to ${r.principal}. ` +
          `Count the ${r.dependent} rows that have no ${r.principal}. ` +
          `Name the column that goes in the blank.\n\n    ${template}`,
        referenceSql: reference,
        sqlTemplate: template,
        answers: [q(r.foreignKeyProperty)],
        subjects: [r.dependent, r.principal],
        rationale:
          `${r.dependent}.${r.foreignKeyProperty} is nullable because the ` +
          `relationship is optional.`,
      }),
    );
  }
  return out;
}

/** Group and count across a relationship. */
function groupCount(ctx: Ctx): Question[] {
  const out: Question[] = [];
  const byName = new Map(ctx.g.entities.map((e) => [e.name, e]));

  for (const r of ctx.g.relations) {
    if (!r.foreignKeyProperty || r.cardinality !== "one-to-many") continue;
    const dep = byName.get(r.dependent);
    const pri = byName.get(r.principal);
    const pk = pri?.keys[0];
    if (!dep || !pri || pk === undefined) continue;
    const label = pri.properties.find(
      (p) => !p.isNavigation && !p.isPrimaryKey && p.baseType === "string",
    );
    if (!label) continue;

    const reference =
      `SELECT p.${q(label.column)} AS label, count(*) AS n ` +
      `FROM ${q(dep.tableName)} d JOIN ${q(pri.tableName)} p ON p.${q(pk)} = d.${q(r.foreignKeyProperty)} ` +
      `GROUP BY p.${q(label.column)} HAVING count(*) > 1 ORDER BY n DESC, label`;
    const check = runQuery(ctx.seeded.db, reference);
    if (!check.ok || check.rows.length < 2) continue;

    out.push(
      sqlQuestion({
        id: `entity.sql.group.${r.id}`,
        generator: "sql-group",
        prompt:
          `Write a query returning each ${r.principal}'s ${label.column} and ` +
          `how many ${r.dependent} rows reference it, for those with more ` +
          `than one. Order by the count descending, then by ${label.column}.`,
        referenceSql: reference,
        subjects: [r.principal, r.dependent],
        rationale:
          `Join ${dep.tableName} to ${pri.tableName} on ` +
          `${r.foreignKeyProperty} = ${pk}, then GROUP BY with HAVING count(*) > 1.`,
      }),
    );
  }
  return out;
}

const GENERATORS = [joinBlanks, rangeFilter, nullFilter, groupCount];

/**
 * SQL questions for a graph. Requires a seeded database, because every
 * generator validates its own reference query against real rows before
 * emitting anything.
 */
export function generateEntitySql(
  g: EntityGraph,
  seeded: SeededDb,
  seed?: number,
): Question[] {
  const ctx: Ctx = { g, seeded, rnd: rng(seed ?? hashSeed(g.repo)) };
  const out: Question[] = [];
  for (const gen of GENERATORS) out.push(...gen(ctx));
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

const _unusedEntity: Entity | undefined = undefined;
void _unusedEntity;
