import express from "express";

/**
 * The server half. It imports express, so the client-call reader skips this
 * file entirely and every registration below stays a route rather than
 * reappearing as a phantom self-matching call.
 *
 * Two routes, both unambiguous: `linkCalls` warns whenever a call could match
 * more than one, and this fixture asserts an empty warning list.
 */

/** Executed by the real server on startup; the DDL reader sees the literal.
 *  Mandatory: with 0 entities `Workspace.open` throws "No entities found". */
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS cards (
  id    TEXT PRIMARY KEY,
  label TEXT NOT NULL
);
`;

export function createApp(): express.Express {
  const app = express();

  /** Hit by src/components/admin/Card.tsx: the attributed AND matched row. */
  app.post("/api/admin/cards", (_req, res) => {
    res.json({});
  });

  /** Hit by src/lib/boot.ts at module scope: the unattributed, matched row. */
  app.get("/api/cards", (_req, res) => {
    res.json([]);
  });

  return app;
}
