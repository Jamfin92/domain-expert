import { createServer, type Server } from "node:http";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import express from "express";
import { createApp } from "@psq/server";
import { referenceAnswer } from "@psq/quiz";
import { chromium, type Browser, type Page } from "playwright-core";
import { BROWSER } from "./browser.js";

/**
 * Runs the real thing: the real API, the real built bundle, a real browser.
 *
 * The server listens on port 0 so the suite never collides with a dev server
 * on 8092, and it runs in-process so there is no child to supervise or leak.
 */

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(here, "..");
/** The self-contained fixture, so this suite needs nothing outside the repo. */
export const FIXTURE = join(REPO_ROOT, "test/fixtures/mini-efcore");
export const NODE_FIXTURE = join(REPO_ROOT, "test/fixtures/mini-node");
export const WEB_DIST = join(REPO_ROOT, "apps/web/dist");

export function webBuilt(): boolean {
  return existsSync(join(WEB_DIST, "index.html"));
}

export interface Harness {
  url: string;
  browser: Browser;
  /**
   * The model answer for a question, looked up by its prompt.
   *
   * The harness runs the server in-process, so a test can know the right
   * answer while the page still cannot. That keeps "does the UI show a
   * success state" testable without weakening the rule that the server is the
   * only judge.
   */
  answerFor(prompt: string): string | null;
  newPage(opts?: { colorScheme?: "light" | "dark"; desktop?: boolean }): Promise<Page>;
  stop(): Promise<void>;
}

export async function startHarness(): Promise<Harness> {
  if (!BROWSER) throw new Error("no browser found");
  if (!webBuilt()) throw new Error("apps/web/dist is missing; run pnpm build:web");

  const { app, workspace } = createApp();
  app.use(express.static(WEB_DIST));
  app.get(/.*/, (_req, res) => res.sendFile(join(WEB_DIST, "index.html")));

  const server: Server = createServer(app);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const url = `http://127.0.0.1:${port}`;

  const browser = await chromium.launch({ executablePath: BROWSER });

  const answerFor = (prompt: string): string | null => {
    for (const repo of workspace.list()) {
      const open = workspace.get(repo.id);
      const q = open?.questions.find((x) => x.prompt.trim() === prompt.trim());
      if (q) return referenceAnswer(q);
    }
    return null;
  };

  return {
    url,
    browser,
    answerFor,
    async newPage(opts = {}) {
      const page = await browser.newPage({
        viewport: { width: 1440, height: 900 },
        colorScheme: opts.colorScheme ?? "light",
      });
      if (opts.desktop === true) {
        // Stand in for Electron's preload. The UI feature-detects this object,
        // so injecting it exercises the desktop path without running Electron.
        await page.addInitScript(() => {
          (window as unknown as { psq: unknown }).psq = {
            pickFolder: () => Promise.resolve(null),
            openInEditor: () => Promise.resolve(true),
            platform: "darwin",
          };
        });
      }
      // A console error during a test is a failure worth seeing.
      page.on("pageerror", (err) => {
        throw new Error(`uncaught page error: ${String(err)}`);
      });
      return page;
    },
    async stop() {
      await browser.close();
      workspace.closeAll();
      await new Promise<void>((done) => server.close(() => done()));
    },
  };
}

/** Open the fixture through the UI and wait for the diagram. */
export async function analyzeFixture(page: Page, url: string, path = FIXTURE): Promise<void> {
  await page.goto(url, { waitUntil: "networkidle" });
  await page.fill('input[placeholder*="/path/to"]', path);
  await page.click('button:has-text("Analyze")');
  await page.waitForSelector("svg g.cursor-pointer", { timeout: 30_000 });
}
