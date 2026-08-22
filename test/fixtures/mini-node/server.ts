import express from "express";

/**
 * Routes registered inside a factory body, which is where ten of the fifteen
 * express routes on this machine live. Walking top-level statements finds none.
 */
export function createApp(): express.Express {
  const app = express();

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/crews/:callsign", (_req, res) => {
    res.json({});
  });

  app.post("/voyages", (_req, res) => {
    res.json({});
  });

  return app;
}
