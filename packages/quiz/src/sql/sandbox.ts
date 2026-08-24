import type { DatabaseSync } from "node:sqlite";

/**
 * Runs candidate SQL for grading.
 *
 * Locally this executes against a throwaway database psq generated, so the
 * blast radius is small. Hosted and multi-tenant it is the only component that
 * runs user input at all, so it is locked down from the start rather than
 * retrofitted.
 *
 * Measured behavior of node:sqlite on Node 24 that shapes this design:
 *  - `load_extension` is already refused ("not authorized").
 *  - `ATTACH` is ALLOWED, even on a readOnly connection. A candidate query
 *    could otherwise read any other SQLite file on the machine.
 *  - `prepare("SELECT 1; DROP TABLE t")` succeeds but silently runs only the
 *    first statement. Safe, but it would hide half of what the user typed.
 *
 * So the defense is a positive allowlist — the statement must be a single
 * read — rather than a blacklist of dangerous words, backed by a read-only
 * connection, a row cap, and a timeout.
 */

export interface SqlResult {
  ok: true;
  columns: string[];
  rows: Array<Record<string, unknown>>;
  truncated: boolean;
}
export interface SqlError {
  ok: false;
  error: string;
  /** True when the statement was refused before it ever reached SQLite. */
  rejected: boolean;
}
export type SqlOutcome = SqlResult | SqlError;

export const MAX_ROWS = 5000;

/** Remove comments and string literals so keyword checks cannot be smuggled past. */
function stripNoise(sql: string): string {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const c = sql[i]!;
    if (c === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && sql[i + 1] === "*") {
      i += 2;
      while (i < sql.length && !(sql[i] === "*" && sql[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      const quote = c;
      i++;
      while (i < sql.length) {
        if (sql[i] === quote && sql[i + 1] === quote) {
          i += 2;
          continue;
        }
        if (sql[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      out += " 'x' ";
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/**
 * Decide whether a statement may run. Returns null when it is acceptable, or
 * the reason it was refused.
 */
export function refuse(sql: string): string | null {
  const bare = stripNoise(sql).trim();
  if (bare.length === 0) return "the query is empty";

  // Reject anything after the first statement. node:sqlite would silently
  // ignore it, and grading must never report on a query it did not fully run.
  const withoutTrailing = bare.replace(/;\s*$/, "");
  if (withoutTrailing.includes(";")) {
    return "only one statement is allowed";
  }

  // Positive allowlist: a graded query reads, it never writes or configures.
  // This refuses ATTACH, PRAGMA, INSERT, UPDATE, DELETE, DROP and friends at
  // the door, without needing to enumerate them.
  const head = withoutTrailing.match(/^\s*([a-zA-Z]+)/)?.[1]?.toUpperCase();
  if (head !== "SELECT" && head !== "WITH") {
    return `only SELECT and WITH queries can be graded, not ${head ?? "that"}`;
  }

  // `WITH ... INSERT` is valid SQLite. The read-only connection blocks it too,
  // but refusing here keeps the error honest instead of a driver message.
  if (/\b(INSERT|UPDATE|DELETE|REPLACE|ATTACH|DETACH|PRAGMA|VACUUM|CREATE|DROP|ALTER)\b/i.test(withoutTrailing)) {
    return "a graded query may only read";
  }

  return null;
}

/**
 * Execute a read query against a seeded database.
 * The connection should already be read-only; `refuse` is the primary gate.
 */
export function runQuery(db: DatabaseSync, sql: string): SqlOutcome {
  const reason = refuse(sql);
  if (reason !== null) return { ok: false, error: reason, rejected: true };

  try {
    const stmt = db.prepare(sql);
    const all = stmt.all() as Array<Record<string, unknown>>;
    const truncated = all.length > MAX_ROWS;
    const rows = truncated ? all.slice(0, MAX_ROWS) : all;
    const columns = rows.length > 0 ? Object.keys(rows[0]!) : [];
    return { ok: true, columns, rows, truncated };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      rejected: false,
    };
  }
}

/**
 * Compare two result sets the way an eval harness compares graded output: by JSON
 * round-trip, so 5 and 5.0 are the same value.
 *
 * Row order is ignored unless the reference query asks for an order, because
 * two correct queries may legitimately return rows in different orders.
 * Column NAMES are ignored — only the shape and values matter — since
 * `SELECT Name` and `SELECT s.Name AS student` answer the same question.
 */
export function resultsMatch(
  reference: SqlResult,
  candidate: SqlResult,
  referenceSql: string,
): { same: boolean; detail: string } {
  const ordered = /\border\s+by\b/i.test(stripNoise(referenceSql));

  const shape = (r: SqlResult): string[] =>
    r.rows.map((row) => JSON.stringify(Object.values(row)));

  const a = shape(reference);
  const b = shape(candidate);

  // Row count first. An empty result set exposes no column names at all, so
  // comparing columns first turns "you returned nothing" into a confusing
  // "expected 1 column, got 0".
  if (a.length !== b.length) {
    return { same: false, detail: `expected ${a.length} row(s), got ${b.length}` };
  }
  if (a.length > 0 && reference.columns.length !== candidate.columns.length) {
    return {
      same: false,
      detail: `expected ${reference.columns.length} column(s), got ${candidate.columns.length}`,
    };
  }

  const left = ordered ? a : [...a].sort();
  const right = ordered ? b : [...b].sort();
  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) {
      return {
        same: false,
        detail: ordered
          ? `row ${i + 1} differs: expected ${left[i]}, got ${right[i]}`
          : `row sets differ: expected ${left[i]} to be present`,
      };
    }
  }
  return { same: true, detail: `${a.length} row(s) match` };
}
