import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import express from "express";
import { createApp } from "./app.js";

/**
 * Standalone entry point: `pnpm dev:server`, or booted by the Electron shell.
 *
 * Port 8092 is the default because this machine already runs llama-server on
 * 8080, mlx on 8083, corpus-repo-c on 8090 and corpus-repo-e on 8091. Pass 0 to
 * take any free port, which is what Electron does so two copies never clash.
 */

const { app, workspace } = createApp();

// In production the built web UI is served from the same origin, so there is
// no CORS story and no second process to supervise.
const webDist = resolve(import.meta.dirname, "../../web/dist");
if (existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get(/.*/, (_req, res) => {
    res.sendFile(resolve(webDist, "index.html"));
  });
}

const port = Number(process.env["PSQ_PORT"] ?? 8092);
const host = process.env["PSQ_HOST"] ?? "127.0.0.1";

const server = createServer(app);
server.listen(port, host, () => {
  const addr = server.address();
  const actual = typeof addr === "object" && addr ? addr.port : port;
  // Electron reads this line to learn which port to open.
  console.log(`psq server listening on http://${host}:${actual}`);
  if (!existsSync(webDist)) {
    console.log("web/dist not built — run `pnpm dev:web` for the UI in development");
  }
});

const shutdown = (): void => {
  workspace.closeAll();
  server.close(() => process.exit(0));
  // Do not let an open keep-alive socket hold the process open forever.
  setTimeout(() => process.exit(0), 2000).unref();
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
