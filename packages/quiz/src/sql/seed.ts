import { DatabaseSync } from "./driver.js";
import type { DatabaseSync as Db } from "node:sqlite";
import type { Entity, EntityGraph, Property } from "@psq/schema";
import { rng, type Rng } from "../rng.js";
import { sqliteType } from "./types.js";

/**
 * Turn an extracted schema into a real SQLite database with believable rows.
 *
 * This is what makes a data question gradable. "Which students have a B+ GPA?"
 * has no checkable answer against a schema alone — it needs rows. With rows,
 * the grader runs the candidate query and the reference query and compares
 * result sets, which is exact.
 *
 * Seeding is deterministic. The same graph and seed produce the same rows on
 * any machine, so a disputed answer can always be reproduced.
 */

export interface SeededDb {
  db: Db;
  /** entity name -> quoted table name */
  tables: Map<string, string>;
  rowCounts: Map<string, number>;
  ddl: string;
  warnings: string[];
  close(): void;
}

export interface SeedOptions {
  seed?: number;
  /** Rows per ordinary table. Join tables scale from their parents. */
  rows?: number;
  /** Write to a file instead of memory, so a session can be re-opened. */
  path?: string;
}

const FIRST = [
  "Ada", "Grace", "Alan", "Katherine", "Linus", "Barbara", "Edsger", "Radia",
  "Donald", "Frances", "Ken", "Margaret", "Dennis", "Jean", "Tony", "Adele",
  "Niklaus", "Karen", "Guido", "Sophie", "Rich", "Anita", "Bjarne", "Carol",
];
const LAST = [
  "Lovelace", "Hopper", "Turing", "Johnson", "Torvalds", "Liskov", "Dijkstra",
  "Perlman", "Knuth", "Allen", "Thompson", "Hamilton", "Ritchie", "Bartik",
  "Hoare", "Goldberg", "Wirth", "Sparck", "Rossum", "Wilson", "Stallman",
];
const WORDS = [
  "Alpha", "Bridge", "Canyon", "Delta", "Ember", "Fenwick", "Granite", "Harbor",
  "Ivory", "Juniper", "Kestrel", "Lantern", "Meridian", "Nimbus", "Onyx",
  "Pioneer", "Quarry", "Ridge", "Summit", "Tundra", "Vantage", "Willow",
];
const STATUSES = ["Draft", "Pending", "Active", "Approved", "Rejected", "Expired"];

/** A fixed instant, so dates never depend on the clock. */
const EPOCH = Date.UTC(2024, 0, 1, 12, 0, 0);

function isoAt(dayOffset: number): string {
  return new Date(EPOCH + dayOffset * 86_400_000).toISOString();
}

/** Deterministic GUID-shaped text. */
function guid(n: number): string {
  const h = n.toString(16).padStart(12, "0");
  return `00000000-0000-4000-8000-${h}`;
}

const lower = (s: string): string => s.toLowerCase();

/**
 * Invent a value for a column. Column names steer the shape so questions read
 * naturally: a Gpa lands in 0..4, an Email looks like an email.
 */
function valueFor(
  p: Property,
  entity: Entity,
  rowIndex: number,
  rnd: Rng,
  unique: boolean,
): string | number | null {
  const name = p.name.toLowerCase();
  const type = sqliteType(p);
  const suffix = unique ? String(rowIndex + 1) : "";

  if (type === "INTEGER") {
    if (p.baseType === "bool") return rnd.next() < 0.5 ? 0 : 1;
    if (name.includes("count") || name.includes("step")) return rnd.int(10);
    if (name.includes("credit")) return 1 + rnd.int(4);
    if (name.includes("year")) return 2020 + rnd.int(6);
    return 1 + rnd.int(1000);
  }

  if (type === "REAL") {
    const scale = p.precision?.[1] ?? 2;
    const round = (v: number): number => Number(v.toFixed(scale));
    if (name.includes("gpa")) return round(rnd.next() * 4);
    if (name.includes("rate") || name.includes("percent")) return round(rnd.next() * 25);
    if (name.includes("fee") || name.includes("amount") || name.includes("price") ||
        name.includes("balance") || name.includes("limit") || name.includes("payment")) {
      return round(rnd.next() * 5000);
    }
    return round(rnd.next() * 100);
  }

  if (type === "BLOB") return null;

  // TEXT
  if (p.baseType === "Guid") return guid(rowIndex + 1);
  if (["DateTime", "DateTimeOffset", "DateOnly"].includes(p.baseType)) {
    return isoAt(rnd.int(400) - 200);
  }

  const first = rnd.pick(FIRST);
  const last = rnd.pick(LAST);
  let text: string;
  if (name === "email" || name.endsWith("email")) {
    text = `${lower(first)}.${lower(last)}${suffix || rowIndex + 1}@example.com`;
  } else if (name.includes("firstname")) text = first;
  else if (name.includes("lastname") || name.includes("surname")) text = last;
  else if (name === "name" || name.endsWith("name")) text = `${first} ${last}`;
  else if (name.includes("slug") || name.includes("code")) {
    text = `${lower(rnd.pick(WORDS))}-${rowIndex + 1}`;
  } else if (name.includes("status") || name.includes("outcome")) text = rnd.pick(STATUSES);
  else if (name.includes("title")) text = `${rnd.pick(WORDS)} ${rnd.pick(WORDS)}`;
  else if (name.includes("url")) text = `https://example.com/${lower(rnd.pick(WORDS))}/${rowIndex + 1}`;
  else if (name.includes("json")) text = `{"note":"${lower(rnd.pick(WORDS))}"}`;
  else if (name.includes("grade")) text = rnd.pick(["A", "A-", "B+", "B", "B-", "C+", "C", "D", "F"]);
  else text = `${rnd.pick(WORDS)} ${rowIndex + 1}`;

  if (unique && !text.includes(String(rowIndex + 1))) text = `${text} ${rowIndex + 1}`;
  if (p.maxLength !== undefined && text.length > p.maxLength) {
    text = text.slice(0, p.maxLength);
  }
  return text;
}

/** Order tables so a parent is always inserted before its required children. */
function insertOrder(g: EntityGraph, warnings: string[]): Entity[] {
  const byName = new Map(g.entities.map((e) => [e.name, e]));
  const deps = new Map<string, Set<string>>();
  for (const e of g.entities) deps.set(e.name, new Set());
  for (const r of g.relations) {
    // Only required foreign keys constrain insert order. Optional ones are
    // filled by a second pass, which also removes any cycle they would form.
    if (!r.required) continue;
    if (r.principal === r.dependent) continue;
    deps.get(r.dependent)?.add(r.principal);
  }

  const out: Entity[] = [];
  const done = new Set<string>();
  // Names sorted first, so the order is stable rather than insertion-dependent.
  const pending = [...g.entities].sort((a, b) => a.name.localeCompare(b.name));

  while (pending.length > 0) {
    const ready = pending.filter((e) =>
      [...(deps.get(e.name) ?? [])].every((d) => done.has(d) || !byName.has(d)),
    );
    if (ready.length === 0) {
      // A cycle among required foreign keys cannot be inserted at all, by psq
      // or by EF. Report it and fall back to name order.
      warnings.push(
        `required-foreign-key cycle among: ${pending.map((e) => e.name).join(", ")}`,
      );
      out.push(...pending);
      break;
    }
    for (const e of ready) {
      out.push(e);
      done.add(e.name);
    }
    for (const e of ready) pending.splice(pending.indexOf(e), 1);
  }
  return out;
}

const q = (s: string): string => `"${s.replace(/"/g, '""')}"`;

/** Build the CREATE TABLE statements for a graph. */
export function ddlFor(g: EntityGraph): string {
  const byName = new Map(g.entities.map((e) => [e.name, e]));
  const stmts: string[] = [];

  for (const e of g.entities) {
    const cols: string[] = [];
    const scalars = e.properties.filter((p) => !p.isNavigation);

    for (const p of scalars) {
      const parts = [q(p.column), sqliteType(p)];
      const soloKey = e.keys.length === 1 && e.keys[0] === p.name;
      if (soloKey) parts.push("PRIMARY KEY");
      if (!p.nullable && !soloKey) parts.push("NOT NULL");
      if (p.maxLength !== undefined && sqliteType(p) === "TEXT") {
        parts.push(`CHECK (length(${q(p.column)}) <= ${p.maxLength})`);
      }
      cols.push(`  ${parts.join(" ")}`);
    }

    if (e.keys.length > 1) {
      cols.push(`  PRIMARY KEY (${e.keys.map(q).join(", ")})`);
    }

    for (const r of g.relations) {
      if (r.dependent !== e.name || !r.foreignKeyProperty) continue;
      const principal = byName.get(r.principal);
      const pk = principal?.keys[0];
      if (!principal || pk === undefined || principal.keys.length !== 1) continue;
      const onDelete = r.deleteBehavior === "Cascade" ? "CASCADE" : "SET NULL";
      cols.push(
        `  FOREIGN KEY (${q(r.foreignKeyProperty)}) REFERENCES ${q(principal.tableName)}(${q(pk)}) ON DELETE ${r.required ? onDelete : "SET NULL"}`,
      );
    }

    stmts.push(`CREATE TABLE ${q(e.tableName)} (\n${cols.join(",\n")}\n);`);

    for (const [i, idx] of e.indexes.entries()) {
      if (idx.properties.length === 0) continue;
      const kind = idx.isUnique ? "UNIQUE INDEX" : "INDEX";
      stmts.push(
        `CREATE ${kind} ${q(`ix_${e.tableName}_${i}`)} ON ${q(e.tableName)} (${idx.properties.map(q).join(", ")});`,
      );
    }
  }
  return stmts.join("\n\n");
}

/**
 * Create and populate a database from a graph.
 * Caller must call `close()`.
 */
export function materialize(g: EntityGraph, opts: SeedOptions = {}): SeededDb {
  const warnings: string[] = [];
  const rnd = rng(opts.seed ?? 1337);
  const rowTarget = opts.rows ?? 40;
  const db = new DatabaseSync(opts.path ?? ":memory:", { allowExtension: false });

  const ddl = ddlFor(g);
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(ddl);

  const byName = new Map(g.entities.map((e) => [e.name, e]));
  const tables = new Map(g.entities.map((e) => [e.name, e.tableName]));
  const rowCounts = new Map<string, number>();
  /** entity -> the primary key values actually inserted */
  const keysOf = new Map<string, Array<Record<string, string | number>>>();

  const uniqueColumns = (e: Entity): Set<string> => {
    const s = new Set<string>();
    for (const idx of e.indexes) {
      if (idx.isUnique) for (const p of idx.properties) s.add(p);
    }
    return s;
  };

  for (const e of insertOrder(g, warnings)) {
    const scalars = e.properties.filter((p) => !p.isNavigation);
    if (scalars.length === 0) {
      rowCounts.set(e.name, 0);
      keysOf.set(e.name, []);
      continue;
    }
    const uniq = uniqueColumns(e);

    // Which columns are foreign keys, and to where.
    const fkTargets = new Map<string, { principal: string; required: boolean }>();
    for (const r of g.relations) {
      if (r.dependent === e.name && r.foreignKeyProperty) {
        fkTargets.set(r.foreignKeyProperty, { principal: r.principal, required: r.required });
      }
    }

    const composite = e.keys.length > 1;
    const inserted: Array<Record<string, string | number>> = [];
    const usedComposite = new Set<string>();

    const stmt = db.prepare(
      `INSERT INTO ${q(e.tableName)} (${scalars.map((p) => q(p.column)).join(", ")}) ` +
        `VALUES (${scalars.map(() => "?").join(", ")})`,
    );

    // A join table cannot have more rows than the product of its parents.
    let target = rowTarget;
    if (composite) {
      const parents = e.keys.map((k) => fkTargets.get(k)?.principal).filter(Boolean) as string[];
      const capacity = parents.reduce((acc, p) => acc * (keysOf.get(p)?.length ?? 0), 1);
      target = Math.min(rowTarget, Math.max(0, capacity));
    }

    for (let i = 0; i < target; i++) {
      const row: Array<string | number | null> = [];
      const keyRecord: Record<string, string | number> = {};
      let skip = false;

      for (const p of scalars) {
        const fk = fkTargets.get(p.name);
        if (fk) {
          const parents = keysOf.get(fk.principal) ?? [];
          const parentEntity = byName.get(fk.principal);
          const parentKey = parentEntity?.keys[0];
          if (parents.length === 0 || parentKey === undefined) {
            // No parent rows to point at: null if allowed, otherwise skip.
            if (p.nullable) {
              row.push(null);
              continue;
            }
            skip = true;
            break;
          }
          // Optional foreign keys are left null a fifth of the time, so a
          // question about nullability has something real to find.
          if (!fk.required && rnd.next() < 0.2) {
            row.push(null);
            continue;
          }
          const parent = rnd.pick(parents)[parentKey]!;
          row.push(parent);
          if (e.keys.includes(p.name)) keyRecord[p.name] = parent;
          continue;
        }

        if (e.keys.includes(p.name) && !composite) {
          // Single-column primary key: dense and predictable.
          const v = p.baseType === "Guid" ? guid(i + 1) : i + 1;
          row.push(v);
          keyRecord[p.name] = v;
          continue;
        }

        const v = valueFor(p, e, i, rnd, uniq.has(p.name));
        row.push(v);
        if (e.keys.includes(p.name) && v !== null) keyRecord[p.name] = v;
      }

      if (skip) continue;

      if (composite) {
        const sig = e.keys.map((k) => String(keyRecord[k])).join("|");
        if (usedComposite.has(sig)) continue; // composite key must stay unique
        usedComposite.add(sig);
      }

      try {
        stmt.run(...row);
        inserted.push(keyRecord);
      } catch (err) {
        // A unique index collision is expected occasionally; anything else is
        // a real defect and must not be swallowed.
        const msg = err instanceof Error ? err.message : String(err);
        if (!/UNIQUE|PRIMARY KEY|CHECK/i.test(msg)) {
          warnings.push(`${e.name}: insert failed (${msg})`);
        }
      }
    }

    keysOf.set(e.name, inserted);
    rowCounts.set(e.name, inserted.length);
  }

  return {
    db,
    tables,
    rowCounts,
    ddl,
    warnings,
    close: () => db.close(),
  };
}
