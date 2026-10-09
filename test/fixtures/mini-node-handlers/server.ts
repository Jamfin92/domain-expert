import express from "express";
import { listCrews, showCrew, VoyageController, legacy } from "./handlers.js";

const voyages = new VoyageController();
const auth = (_req: unknown, _res: unknown, next: () => void) => next();
declare const missing: never;
const wrap = (_fn: unknown): express.RequestHandler => (_req, res) => res.end();

export function createApp(): express.Express {
  const app = express();
  const router = express.Router();

  app.get("/inline", (_req, res) => {
    res.json({});
  });
  app.get("/crews", listCrews);
  router.get("/crews/:id", auth, showCrew);
  router.post("/voyages", auth, voyages.create);
  app.get("/ping", legacy.ping);
  app.get("/wrapped", wrap(listCrews));
  app.get("/bound", listCrews.bind(null));
  app.get("/missing", missing);
  app.get("/only-middleware");
  app.delete("/fn-expr", auth, function (_req, res) {
    res.json({});
  });

  return app;
}
