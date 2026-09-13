import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import express from "express";
import { createApp } from "./app.js";
import { resolveServerConfig, type ServerConfig } from "./config.js";
import { defaultStateDir } from "./store.js";

/**
 * Standalone entry point: `pnpm dev:server`, or booted by the Electron shell.
 *
 * Port 8092 is the default because the development machine already has other
 * local services parked on 8080–8091. Port 0 is NOT accepted — `config.ts`
 * refuses anything outside 1..65535, and `config.test.ts` pins that refusal —
 * so a test that wants an unused port has to pick one itself and pass it.
 *
 * The Electron shell does not run this file at all. It embeds `createApp()`
 * in-process (`apps/desktop/src/main.ts:29`) and calls `listen(0, …)` on its
 * own server, reading the port back off `server.address()`.
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

/**
 * Resolving the store directory must never throw before the socket binds.
 * This process runs under `KeepAlive` with `ThrottleInterval 30`, and the
 * plist supplies only PSQ_HOST/PORT/TOKEN/PATH — `HOME` comes from the launchd
 * session and is one plist edit from absent. A throw here would become a
 * silent 30-second restart loop, which is worse than running with no
 * persistence at all.
 */
function loadStateDir(): string | undefined {
  try {
    return defaultStateDir();
  } catch (err) {
    console.error(
      `persistence off: ${err instanceof Error ? err.message : String(err)}`,
    );
    return undefined;
  }
}

const { app, workspace } = createApp(undefined, {
  token: config.token,
  stateDir: loadStateDir(),
});

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
  // Nothing parses this line: the Electron shell never spawns this process,
  // and there is no out-of-process port handshake anywhere in the repo. It is
  // for a human reading `launchctl` output — and for the boot gates, which
  // wait on it before they poll.
  console.log(`psq server listening on http://${host}:${actual}`);
  // Never the token itself, only whether one is required.
  console.log(config.token ? "api: token required" : "api: open (loopback only)");
  if (!existsSync(webDist)) {
    console.log("web/dist not built — run `pnpm dev:web` for the UI in development");
  }
  // Bind first, print first, THEN read the store. This process runs under
  // `KeepAlive` with `ThrottleInterval 30`, so anything that can throw before
  // the socket is listening turns into a silent 30-second restart loop.
  // Rehydrate re-extracts repos and is the most expensive thing here.
  //
  // The only call site. `createApp()` deliberately does not do this, so the
  // desktop shell and `e2e/harness.ts` never read the store (D-Gb-7).
  void workspace.rehydrate().catch((err) => console.error(`psq rehydrate: ${err}`));
});

const shutdown = (): void => {
  workspace.closeAll();
  server.close(() => process.exit(0));
  // Do not let an open keep-alive socket hold the process open forever.
  setTimeout(() => process.exit(0), 2000).unref();
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
