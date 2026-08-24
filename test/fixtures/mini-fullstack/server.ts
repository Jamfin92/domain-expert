import express from "express";

/**
 * The server half. The client reader must skip this file entirely: it imports
 * express, so every `app.get(...)` below is a registration, not a client call.
 * Without that exclusion each route here would reappear as a phantom call and
 * then match itself.
 */

/** Executed by the real server on startup; the DDL reader sees the literal. */
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS items (
  id    TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  price REAL NOT NULL
);
`;

/**
 * Wrapped-handler registration style, as psq's own apps/server/src/app.ts
 * uses: the second argument is a CallExpression, which the handler-argument
 * guard cannot recognise as a registration. Only the express-import file
 * skip keeps `/health` from becoming a phantom self-matching client call —
 * this pins that guard in isolation.
 */
function wrap(handler: express.RequestHandler): express.RequestHandler {
  return handler;
}

export function createApp(): express.Express {
  const app = express();

  app.get("/health", wrap((_req, res) => {
    res.json({ ok: true });
  }));

  app.get("/api/items", (_req, res) => {
    res.json([]);
  });

  app.get("/api/items/:id", (_req, res) => {
    res.json({});
  });

  app.post("/api/items", (_req, res) => {
    res.json({});
  });

  return app;
}
