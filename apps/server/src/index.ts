import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import express from "express";
import { createApp } from "./app.js";
import { resolveServerConfig, type ServerConfig } from "./config.js";

/**
 * Standalone entry point: `pnpm dev:server`, or booted by the Electron shell.
 *
 * Port 8092 is the default because the development machine already has other
 * local services parked on 8080–8091. Pass 0 to take any free port, which is
 * what Electron does so two copies never clash.
 */

// A refused configuration is a startup failure, not a warning: the whole point
// of the interlock is that an exposed-but-open server never comes up.
function loadConfig(): ServerConfig {
  try {
    return resolveServerConfig(process.env);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

const config = loadConfig();

const { app, workspace } = createApp(undefined, { token: config.token });

// In production the built web UI is served from the same origin, so there is
// no CORS story and no second process to supervise.
const webDist = resolve(import.meta.dirname, "../../web/dist");
if (existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get(/.*/, (_req, res) => {
    res.sendFile(resolve(webDist, "index.html"));
  });
}

const { host, port } = config;

const server = createServer(app);
server.listen(port, host, () => {
  const addr = server.address();
  const actual = typeof addr === "object" && addr ? addr.port : port;
  // Electron reads this line to learn which port to open.
  console.log(`psq server listening on http://${host}:${actual}`);
  // Never the token itself, only whether one is required.
  console.log(config.token ? "api: token required" : "api: open (loopback only)");
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
