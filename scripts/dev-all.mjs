#!/usr/bin/env node
import { spawn } from "node:child_process";
import process from "node:process";

/**
 * Run the API and the web dev server together.
 *
 * Hand-rolled rather than `concurrently` for one reason that matters: signal
 * handling. `tsx watch` spawns a child of its own, and a Ctrl-C that is not
 * forwarded properly leaves a process holding port 8092, so the next
 * `dev:all` fails with EADDRINUSE for no visible reason. This forwards
 * SIGINT and SIGTERM to the whole process group and waits for both to exit.
 */

const PORT = process.env.PSQ_PORT ?? "8092";

const TASKS = [
  { name: "server", color: "\x1b[36m", cmd: "pnpm", args: ["exec", "tsx", "watch", "apps/server/src/index.ts"] },
  // `-C apps/web exec` rather than the root's own vite: running vite from the
  // root resolves the root's older esbuild (a vitest transitive). Rather than
  // `--filter @psq/web dev`, because a nested pnpm run hands vite the wrong
  // cwd and it cannot find index.html.
  { name: "web", color: "\x1b[35m", cmd: "pnpm", args: ["-C", "apps/web", "exec", "vite"] },
];

const DIM = "\x1b[2m";
const OFF = "\x1b[0m";
const width = Math.max(...TASKS.map((t) => t.name.length));

/** Prefix every line so interleaved output stays readable. */
function pipe(stream, task, isError) {
  let buffer = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const tag = `${task.color}${task.name.padEnd(width)}${OFF} ${DIM}|${OFF} `;
      (isError ? process.stderr : process.stdout).write(`${tag}${line}\n`);
    }
  });
}

const children = TASKS.map((task) => {
  const child = spawn(task.cmd, task.args, {
    env: { ...process.env, PSQ_PORT: PORT, FORCE_COLOR: "1" },
    stdio: ["ignore", "pipe", "pipe"],
    // Its own process group, so a signal reaches grandchildren too.
    detached: true,
  });
  pipe(child.stdout, task, false);
  pipe(child.stderr, task, true);
  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    process.stdout.write(
      `${task.color}${task.name.padEnd(width)}${OFF} ${DIM}|${OFF} exited (${signal ?? code}); stopping the rest\n`,
    );
    shutdown(typeof code === "number" ? code : 1);
  });
  return { task, child };
});

let shuttingDown = false;

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const { child } of children) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
    try {
      // Negative pid signals the whole group, which is what catches tsx's child.
      process.kill(-child.pid, "SIGTERM");
    } catch {
      try {
        child.kill("SIGTERM");
      } catch {
        // Already gone.
      }
    }
  }
  // Escalate if anything ignores SIGTERM, then leave.
  const timer = setTimeout(() => {
    for (const { child } of children) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        // Already gone.
      }
    }
    process.exit(code);
  }, 3000);
  timer.unref();

  void Promise.all(
    children.map(
      ({ child }) =>
        new Promise((resolve) =>
          child.exitCode !== null ? resolve() : child.once("exit", resolve),
        ),
    ),
  ).then(() => process.exit(code));
}

for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => shutdown(0));

process.stdout.write(
  `${DIM}api on http://127.0.0.1:${PORT} · ui on http://127.0.0.1:5173 (proxies /api)${OFF}\n`,
);
