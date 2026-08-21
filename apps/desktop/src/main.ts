import { app, BrowserWindow, dialog, ipcMain, shell, Menu } from "electron";
import { createServer, type Server } from "node:http";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import express from "express";
import { createApp } from "@psq/server";

/**
 * The desktop shell.
 *
 * It boots the same express app the browser talks to, on a free port, and
 * points a window at it. That is the whole trick: one API, one UI, two shells.
 * Electron adds only what a browser genuinely cannot do — a real folder
 * picker and jumping to a file in your editor.
 *
 * Port 0 means the OS picks a free one, so two copies never collide and it
 * never fights whatever is already on 8092.
 */

let server: Server | null = null;
let window: BrowserWindow | null = null;

const WEB_DIST = resolve(import.meta.dirname, "../../web/dist");
/** In development the Vite dev server has hot reload; use it when it is up. */
const DEV_URL = process.env["PSQ_DEV_URL"] ?? "";

async function startServer(): Promise<string> {
  const { app: api, workspace } = createApp();
  if (existsSync(WEB_DIST)) {
    api.use(express.static(WEB_DIST));
    api.get(/.*/, (_req, res) => res.sendFile(join(WEB_DIST, "index.html")));
  }

  server = createServer(api);
  await new Promise<void>((done) => server!.listen(0, "127.0.0.1", done));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  app.on("before-quit", () => {
    workspace.closeAll();
    server?.close();
  });

  return `http://127.0.0.1:${port}`;
}

function createWindow(url: string): void {
  window = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 900,
    minHeight: 600,
    // The frame follows the OS appearance; the page paints its own background.
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    backgroundColor: "#111318",
    show: false,
    webPreferences: {
      preload: join(import.meta.dirname, "preload.cjs"),
      // The renderer is ordinary web code and stays sandboxed. Everything
      // privileged goes through the three IPC calls below and nothing else.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.once("ready-to-show", () => window?.show());
  void window.loadURL(DEV_URL || url);

  // A link to somewhere else belongs in the real browser, not in this window.
  window.webContents.setWindowOpenHandler(({ url: target }) => {
    void shell.openExternal(target);
    return { action: "deny" };
  });
}

ipcMain.handle("psq:pickFolder", async () => {
  if (!window) return null;
  const result = await dialog.showOpenDialog(window, {
    title: "Choose a project to read",
    properties: ["openDirectory"],
    buttonLabel: "Analyze",
  });
  return result.canceled ? null : (result.filePaths[0] ?? null);
});

ipcMain.handle("psq:openInEditor", async (_event, file: unknown, line: unknown) => {
  if (typeof file !== "string" || file.length === 0) return false;
  const target = typeof line === "number" ? `${file}:${line}` : file;

  // Try VS Code's line-aware flag first, then fall back to the OS default,
  // which at least opens the file in whatever is registered for it.
  const code = spawn("code", ["-g", target], { stdio: "ignore", detached: true });
  const ok = await new Promise<boolean>((done) => {
    code.on("error", () => done(false));
    code.on("spawn", () => {
      code.unref();
      done(true);
    });
  });
  if (ok) return true;

  const err = await shell.openPath(file);
  return err === "";
});

void app.whenReady().then(async () => {
  const url = await startServer();
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === "darwin" ? [{ role: "appMenu" as const }] : []),
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { role: "reload" as const },
        { role: "toggleDevTools" as const },
        { type: "separator" as const },
        { role: "resetZoom" as const },
        { role: "zoomIn" as const },
        { role: "zoomOut" as const },
        { type: "separator" as const },
        { role: "togglefullscreen" as const },
      ],
    },
    { role: "windowMenu" },
  ]));

  createWindow(url);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(url);
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
