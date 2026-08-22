/**
 * DDL bound to a constant and executed elsewhere — corpus-repo-e's shape. A reader
 * that only inspects the arguments of `exec()` finds neither of these tables.
 */
export const LOG_SCHEMA = `
CREATE TABLE IF NOT EXISTS log_entries (
  callsign TEXT NOT NULL,
  seq      INTEGER NOT NULL,
  note     TEXT NOT NULL,
  PRIMARY KEY (callsign, seq)
);

CREATE TABLE IF NOT EXISTS ports (
  code    TEXT PRIMARY KEY,
  country TEXT NOT NULL
);
`;
