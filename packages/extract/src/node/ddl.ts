import ts from "typescript";
import type { Cardinality, Entity, Index, Property, Relation } from "@psq/schema";
import { DatabaseSync, type Database } from "../sqlite/driver.js";
import { conceptKey } from "../names.js";
import { isTestFile, repoRelative } from "../files.js";
import type { Warnings } from "../warnings.js";

/**
 * Read a Node backend's schema by running its DDL, not by parsing it.
 *
 * A repo writes `CREATE TABLE` as a string and hands it to SQLite. psq does the
 * same thing into a throwaway in-memory database and then asks SQLite what it
 * got, through `sqlite_master` and the `table_info` / `index_list` /
 * `foreign_key_list` pragmas. Composite primary keys, interleaved `--`
 * comments, `AUTOINCREMENT`, `DEFAULT '[]'` and `DESC` in an index all come out
 * right because the authority on what the DDL means is SQLite itself.
 */

const CREATE_TABLE = /\bCREATE\s+TABLE\b/i;

/**
 * Every keyword a SQLite statement can begin with (sqlite.org/lang.html). A
 * literal is DDL only when its first token, after whitespace and comments, is
 * one of these (P2b F2). Prose that merely MENTIONS "CREATE TABLE" ("No CREATE
 * TABLE statement was found…", a CLI help line) is not executed.
 */
const STATEMENT_START =
  /^(ALTER|ANALYZE|ATTACH|BEGIN|COMMIT|CREATE|DELETE|DETACH|DROP|END|EXPLAIN|INSERT|PRAGMA|REINDEX|RELEASE|REPLACE|ROLLBACK|SAVEPOINT|SELECT|UPDATE|VACUUM|WITH)\b/i;

/** Strip leading whitespace, `-- …` line comments and `/* … *\/` block comments. */
function stripLeading(text: string): string {
  let s = text;
  for (;;) {
    const next = s.replace(/^\s+/, "").replace(/^--[^\n]*(\n|$)/, "").replace(/^\/\*[\s\S]*?\*\//, "");
    if (next === s) return s;
    s = next;
  }
}

/** A string that begins like a SQL statement and contains CREATE TABLE. */
function isDdlLiteral(text: string): boolean {
  return STATEMENT_START.test(stripLeading(text)) && CREATE_TABLE.test(text);
}

/**
 * A template with substitutions: judged by its first non-blank literal chunk
 * (the head, else the text after a substitution), never by `getText()`, which
 * starts with a backtick. A leading `;` is a statement separator, so
 * `${pragmas}; CREATE TABLE …` is DDL while `${x}: CREATE TABLE in …` is prose.
 * A template that is only substitutions cannot be judged and keeps the warning.
 */
function isDdlTemplate(node: ts.TemplateExpression): boolean {
  if (!CREATE_TABLE.test(node.getText())) return false;
  for (const chunk of [node.head.text, ...node.templateSpans.map((sp) => sp.literal.text)]) {
    const t = stripLeading(stripLeading(chunk).replace(/^;+/, ""));
    if (t !== "") return STATEMENT_START.test(t);
  }
  return true; // only substitutions: cannot be judged, keep the warning
}

/** Above this many tables keyed on the same column name, the name is a habit. */
const MAX_SHARED_KEY_CLAIMANTS = 2;

interface Candidate {
  text: string;
  file: string;
}

/**
 * Every DDL literal in the repo, wherever it is written.
 *
 * Deliberately not "every literal passed to `exec()`": one corpus repo writes
 * the DDL inline in the call, another binds it to `export const SCHEMA` and execs it
 * ninety lines later, and a third repo will do a third thing. What makes a
 * string the schema is that it says CREATE TABLE.
 */
export function collectDdl(
  root: string,
  sources: readonly ts.SourceFile[],
  warnings: Warnings,
): Candidate[] {
  const out: Candidate[] = [];
  const seen = new Set<string>();

  for (const source of sources) {
    const rel = repoRelative(root, source.fileName);
    if (isTestFile(rel)) continue;

    const visit = (node: ts.Node): void => {
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        if (isDdlLiteral(node.text) && !seen.has(node.text)) {
          seen.add(node.text);
          out.push({ text: node.text, file: rel });
        }
      } else if (ts.isTemplateExpression(node) && isDdlTemplate(node)) {
        // A schema assembled at runtime is not a fact psq can hold. Say so.
        const { line } = source.getLineAndCharacterOfPosition(node.getStart());
        warnings.push(
          "ddl-substitution-literal",
          `${rel}:${line + 1}: CREATE TABLE in a template literal with substitutions; not read`,
          { file: rel, line: line + 1 },
        );
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }

  return out;
}

interface ColumnInfo {
  name: string;
  type: string;
  notnull: number;
  pk: number;
}

interface ForeignKeyInfo {
  table: string;
  from: string;
  to: string | null;
  on_delete: string;
}

interface TableRead {
  name: string;
  file: string;
  columns: ColumnInfo[];
  indexes: Index[];
  /** Columns that are unique on their own: a sole PK, or a one-column UNIQUE. */
  uniqueColumns: Set<string>;
  foreignKeys: ForeignKeyInfo[];
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function tableNames(db: Database): string[] {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all() as unknown as Array<{ name: string }>;
  return rows.map((r) => r.name).sort();
}

/** Run every candidate, attributing each table to the file that declared it. */
function readTables(candidates: readonly Candidate[], warnings: Warnings): TableRead[] {
  const db = new DatabaseSync(":memory:", { allowExtension: false });
  const origin = new Map<string, string>();

  try {
    for (const candidate of candidates) {
      const before = new Set(tableNames(db));
      try {
        db.exec(candidate.text);
      } catch (err) {
        warnings.push(
          "ddl-candidate-failed",
          `${candidate.file}: a CREATE TABLE literal did not execute (${(err as Error).message})`,
          { file: candidate.file },
        );
        continue;
      }
      for (const name of tableNames(db)) {
        if (!before.has(name)) origin.set(name, candidate.file);
      }
    }

    return tableNames(db).map((name) => {
      const columns = db.prepare(`PRAGMA table_info(${quoteIdent(name)})`).all() as unknown as ColumnInfo[];
      const foreignKeys = db
        .prepare(`PRAGMA foreign_key_list(${quoteIdent(name)})`)
        .all() as unknown as ForeignKeyInfo[];

      const indexes: Index[] = [];
      const uniqueColumns = new Set<string>();
      const pkColumns = columns.filter((c) => c.pk > 0);
      if (pkColumns.length === 1) uniqueColumns.add(pkColumns[0]!.name);

      const indexList = db.prepare(`PRAGMA index_list(${quoteIdent(name)})`).all() as unknown as Array<{
        name: string;
        unique: number;
        origin: string;
      }>;
      for (const idx of indexList) {
        const cols = (
          db.prepare(`PRAGMA index_info(${quoteIdent(idx.name)})`).all() as unknown as Array<{
            name: string | null;
          }>
        )
          .map((c) => c.name)
          .filter((c): c is string => c !== null);
        if (cols.length === 0) continue;
        if (idx.unique === 1 && cols.length === 1) uniqueColumns.add(cols[0]!);
        // `pk` indexes restate the primary key, which `keys` already carries.
        if (idx.origin === "pk") continue;
        indexes.push({ properties: cols, isUnique: idx.unique === 1, source: "declared" });
      }

      return {
        name,
        file: origin.get(name) ?? "",
        columns,
        indexes,
        uniqueColumns,
        foreignKeys,
      };
    });
  } finally {
    db.close();
  }
}

function toProperty(c: ColumnInfo): Property {
  const type = c.type.trim().toUpperCase() || "TEXT";
  return {
    name: c.name,
    type,
    baseType: type,
    // SQLite lets a non-INTEGER primary key hold null, but no schema means it.
    nullable: c.notnull === 0 && c.pk === 0,
    isPrimaryKey: c.pk > 0,
    isForeignKey: false,
    isNavigation: false,
    isCollection: false,
    column: c.name,
  };
}

function toEntity(t: TableRead): Entity {
  return {
    name: t.name,
    namespace: null,
    file: t.file,
    tableName: t.name,
    dbSetName: null,
    keys: t.columns
      .filter((c) => c.pk > 0)
      .sort((a, b) => a.pk - b.pk)
      .map((c) => c.name),
    properties: t.columns.map(toProperty),
    indexes: t.indexes,
    isFramework: false,
  };
}

function relationId(dependent: string, column: string, principal: string): string {
  return `${dependent}.${column}->${principal}`;
}

/** `ON DELETE CASCADE` in DDL, spelled the way the schema spells it. */
function deleteBehaviorOf(onDelete: string): "Cascade" | "SetNull" | "Restrict" | "NoAction" {
  const t = onDelete.replace(/\s+/g, "").toLowerCase();
  if (t === "cascade") return "Cascade";
  if (t === "setnull") return "SetNull";
  if (t === "restrict") return "Restrict";
  return "NoAction";
}

/**
 * Relations, in descending order of evidence.
 *
 * 1. A declared FOREIGN KEY. No Node corpus repo has one, but a
 *    schema that declares them deserves to be believed.
 * 2. `task_id` / `taskId` naming, where a table of that concept exists.
 * 3. A column whose name is another table's sole identifying column, which is
 *    how one corpus repo joins everything on its natural key.
 *
 * Everything from 2 and 3 is marked `inferred`, drawn dashed, and barred from
 * delete-behavior questions, because nobody wrote it down.
 */
function buildRelations(tables: readonly TableRead[], warnings: Warnings): Relation[] {
  const byName = new Map(tables.map((t) => [t.name, t]));
  const byConcept = new Map<string, TableRead[]>();
  for (const t of tables) {
    const key = conceptKey(t.name);
    const bucket = byConcept.get(key);
    if (bucket) bucket.push(t);
    else byConcept.set(key, [t]);
  }

  const relations: Relation[] = [];
  const claimed = new Set<string>();

  const add = (
    dependent: TableRead,
    column: ColumnInfo,
    principal: TableRead,
    source: "declared" | "inferred",
    deleteBehavior: "Cascade" | "SetNull" | "Restrict" | "NoAction",
  ): void => {
    if (dependent.name === principal.name) return;
    const key = `${dependent.name}.${column.name}`;
    if (claimed.has(key)) return;
    claimed.add(key);

    // A unique foreign key can only point at one parent row, so it is 1:1.
    const cardinality: Cardinality = dependent.uniqueColumns.has(column.name)
      ? "one-to-one"
      : "one-to-many";

    relations.push({
      id: relationId(dependent.name, column.name, principal.name),
      principal: principal.name,
      dependent: dependent.name,
      foreignKeyProperty: column.name,
      cardinality,
      dependentNavigation: null,
      principalNavigation: null,
      required: column.notnull === 1 || column.pk > 0,
      deleteBehavior,
      deleteBehaviorSource: source,
      source,
    });
  };

  // 1 — declared
  for (const t of tables) {
    for (const fk of t.foreignKeys) {
      const principal = byName.get(fk.table);
      const column = t.columns.find((c) => c.name === fk.from);
      if (!principal || !column) continue;
      add(t, column, principal, "declared", deleteBehaviorOf(fk.on_delete));
    }
  }

  // 2 — <table>_id / <Table>Id
  for (const t of tables) {
    for (const column of t.columns) {
      const stem = column.name.replace(/[_]?[Ii][Dd]$/, "");
      if (stem === column.name || stem.length === 0) continue;
      const candidates = byConcept.get(conceptKey(stem));
      if (!candidates || candidates.length !== 1) continue;
      add(t, column, candidates[0]!, "inferred", "NoAction");
    }
  }

  // 3 — the column is another table's sole identifying column.
  //
  // A shared key has exactly one owner, decided once for the whole schema
  // rather than once per table. Deciding it per table makes the relationship
  // symmetric — `feed_state` points at `tickers` and `tickers` points back —
  // which is not what a foreign key is.
  const claimants = new Map<string, TableRead[]>();
  for (const t of tables) {
    for (const column of t.uniqueColumns) {
      const bucket = claimants.get(column);
      if (bucket) bucket.push(t);
      else claimants.set(column, [t]);
    }
  }

  const ownerOf = new Map<string, TableRead>();
  for (const [column, candidates] of claimants) {
    // Every corpus repo D table identifies itself with `id`. That makes `id` a house
    // style, not a key one table lends to another, and a surrogate key is never
    // a reference to somebody else's. Two tables sharing a key is an extension;
    // six is a convention.
    if (candidates.length > MAX_SHARED_KEY_CLAIMANTS) {
      warnings.push(
        "ddl-relation-ambiguous",
        `${column} is the identifying column of ${candidates.length} tables, so it reads as a naming convention; no relation inferred from it`,
        { about: column },
      );
      continue;
    }
    // Both `tickers` and `feed_state` are keyed on `symbol`. The one carrying
    // the most attributes under that key owns it; the other is an extension of
    // it. An exact tie is not resolvable, and psq says so instead of picking.
    const ranked = candidates
      .slice()
      .sort((a, b) => b.columns.length - a.columns.length || a.name.localeCompare(b.name));
    const best = ranked[0]!;
    const runnerUp = ranked[1];
    if (runnerUp && runnerUp.columns.length === best.columns.length) {
      warnings.push(
        "ddl-relation-ambiguous",
        `${column} identifies ${ranked.map((o) => o.name).join(" and ")} equally; no relation inferred from it`,
        { about: column },
      );
      continue;
    }
    ownerOf.set(column, best);
  }

  for (const t of tables) {
    for (const column of t.columns) {
      const owner = ownerOf.get(column.name);
      if (!owner || owner.name === t.name) continue;
      add(t, column, owner, "inferred", "NoAction");
    }
  }

  return relations.sort((a, b) => a.id.localeCompare(b.id));
}

export interface SchemaRead {
  entities: Entity[];
  relations: Relation[];
}

export function readSchema(candidates: readonly Candidate[], warnings: Warnings): SchemaRead {
  if (candidates.length === 0) return { entities: [], relations: [] };

  const tables = readTables(candidates, warnings);
  const relations = buildRelations(tables, warnings);
  const entities = tables.map(toEntity).sort((a, b) => a.name.localeCompare(b.name));

  const fkColumns = new Set(relations.map((r) => `${r.dependent}.${r.foreignKeyProperty}`));
  for (const e of entities) {
    for (const p of e.properties) {
      if (fkColumns.has(`${e.name}.${p.column}`)) p.isForeignKey = true;
    }
  }

  return { entities, relations };
}
