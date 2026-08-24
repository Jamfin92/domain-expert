import { DatabaseSync } from "node:sqlite";
import { LOG_SCHEMA } from "./schema.js";

/**
 * DDL written inline in the call — corpus repo D's shape. Between the two files this
 * fixture covers both ways a Node repo hands SQLite its schema.
 */
export function open(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE IF NOT EXISTS crews (
      callsign     TEXT PRIMARY KEY,
      name         TEXT NOT NULL,
      -- A comment between two columns. Corpus repo E has these, repo D does not,
      -- and a column-line parser reads this one as a column.
      home_port    TEXT,
      founded_year INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS voyages (
      id          TEXT PRIMARY KEY,
      crew_id     TEXT NOT NULL,
      destination TEXT NOT NULL,
      cargo_tons  REAL NOT NULL,
      departed_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_voyages_departed ON voyages(departed_at);
  `);
  db.exec(LOG_SCHEMA);
  return db;
}

/** A DML string that also mentions a table. Reading it would invent columns. */
export function recentVoyages(db: DatabaseSync, crewId: string): unknown[] {
  return db
    .prepare("SELECT id, destination FROM voyages WHERE crew_id = ? ORDER BY departed_at DESC")
    .all(crewId);
}
