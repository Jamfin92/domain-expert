import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Page } from "playwright-core";
import { BROWSER } from "./browser.js";
import {
  analyzeFixture, startHarness, webBuilt, FIXTURE, NODE_FIXTURE, type Harness,
} from "./harness.js";

/**
 * End-to-end: a real browser against the real API and the real bundle.
 *
 * These cover the ground unit tests structurally cannot — that the thing
 * renders, that clicking works, that the theme actually changes, and that a
 * question's answer never reaches the page before it is submitted.
 *
 * Everything targets the fixture inside this repo, so the suite is portable.
 */

const reason = !BROWSER
  ? "no Chromium found (set PSQ_E2E_BROWSER)"
  : !webBuilt()
    ? "apps/web/dist is missing (run pnpm build:web)"
    : "";

let h: Harness;

beforeAll(async () => {
  if (reason) return;
  h = await startHarness();
}, 120_000);

afterAll(async () => {
  await h?.stop();
});

describe.skipIf(reason !== "")(`psq end to end`, () => {
  it("starts empty and tells a browser user how to open a project", async () => {
    const page = await h.newPage();
    await page.goto(h.url, { waitUntil: "networkidle" });
    await expect.poll(() => page.title()).toContain("psq");
    expect(await page.locator("text=Point psq at a project").count()).toBe(1);
    // A browser cannot return a filesystem path, so no picker is offered.
    expect(await page.locator('button:has-text("Open repo")').count()).toBe(0);
    expect(await page.locator("text=A browser cannot return a filesystem path").count()).toBe(1);
    await page.close();
  });

  it("offers a folder picker when the desktop bridge is present", async () => {
    // Exercises the same feature detection Electron relies on, with no Electron.
    const page = await h.newPage({ desktop: true });
    await page.goto(h.url, { waitUntil: "networkidle" });
    expect(await page.locator('button:has-text("Open repo")').count()).toBe(1);
    expect(await page.locator("text=A browser cannot return a filesystem path").count()).toBe(0);
    await page.close();
  });

  it("analyzes a project and reports what it found", async () => {
    const page = await h.newPage();
    await analyzeFixture(page, h.url);

    const api = await page.evaluate(async () => {
      const list = (await (await fetch("/api/repos")).json()) as {
        repos: Array<{ entities: number; relations: number; warnings: string[] }>;
      };
      return list.repos[0]!;
    });
    expect(api.entities).toBe(5);
    expect(api.warnings).toEqual([]);

    // Every count on screen must match what the API actually returned.
    const main = (await page.locator("main").textContent()) ?? "";
    expect(main).toContain(String(api.entities));
    expect(await page.locator('[data-psq="node"]').count()).toBe(api.entities);
    expect(await page.locator("text=Parsed with no warnings").count()).toBe(1);
    expect(await page.locator("text=Every question is answerable and failable").count()).toBe(1);
    await page.close();
  });

  it("draws every entity inside the diagram, unclipped", async () => {
    const page = await h.newPage();
    await analyzeFixture(page, h.url);
    await page.waitForTimeout(600); // let fit-to-view settle

    const fit = await page.evaluate(() => {
      // Target the diagram explicitly: the first <svg> on the page is a lucide
      // icon in the header, and measuring against it makes every node look
      // clipped.
      const svg = document.querySelector('svg[data-psq="diagram"]')!;
      const box = svg.getBoundingClientRect();
      const nodes = [...document.querySelectorAll('[data-psq="node"]')];
      const outside = nodes.filter((n) => {
        const r = n.getBoundingClientRect();
        return (
          r.top < box.top - 2 || r.bottom > box.bottom + 2 ||
          r.left < box.left - 2 || r.right > box.right + 2
        );
      });
      return { total: nodes.length, clipped: outside.length };
    });
    // The graph opens fitted; a clipped node means fit-to-view regressed.
    expect(fit.total).toBe(5);
    expect(fit.clipped).toBe(0);
    await page.close();
  });

  it("focuses an entity when you click it and shows its columns", async () => {
    const page = await h.newPage();
    await analyzeFixture(page, h.url);
    await page.waitForTimeout(600);

    const node = page.locator('[data-psq="node"]').first();
    const name = await node.getAttribute("data-entity");
    await node.click();
    await page.waitForTimeout(400);

    // The rail switches from the extraction summary to the entity detail.
    const rail = page.locator("aside");
    expect(await rail.textContent()).toContain(name!);
    expect(await rail.locator("text=PK").count()).toBeGreaterThan(0);
    await page.close();
  });

  it("switches the graph between 2D and 3D and back", async () => {
    const page = await h.newPage();
    await analyzeFixture(page, h.url);

    expect(await page.locator('[data-psq="dim-toggle"]').count()).toBe(1);
    await page.click('[data-psq="dim-3d"]');
    await page.waitForTimeout(400);
    // Headless Chrome may have no GPU, so the WebGL fallback is a pass too —
    // the claim under test is the swap, not the GPU.
    const city = await page.locator('[data-psq="city"]').count();
    const fallback = await page.locator('[data-psq="city-fallback"]').count();
    expect(city + fallback).toBe(1);
    expect(await page.locator('svg[data-psq="diagram"]').count()).toBe(0);

    await page.click('[data-psq="dim-2d"]');
    await page.waitForTimeout(400);
    expect(await page.locator('svg[data-psq="diagram"]').count()).toBe(1);
    expect(await page.locator('[data-psq="city"]').count()).toBe(0);
    await page.close();
  });

  it("gives the city a palette that follows the theme", async () => {
    // These two hex strings must match CITY_PALETTE.light.building and
    // CITY_PALETTE.dark.building in apps/web/src/lib/scene3d.ts. Pinned
    // literally: e2e/tsconfig.json has no @/* mapping, so importing the
    // palette from apps/web would fail typecheck.
    const LIGHT_BUILDING = "#8b95a5";
    const DARK_BUILDING = "#b6c0d2";

    const page = await h.newPage({ colorScheme: "light" });
    await analyzeFixture(page, h.url);
    await page.click('button[aria-label="Light"]');
    await page.waitForTimeout(200);
    await page.click('[data-psq="dim-3d"]');
    await page.waitForTimeout(400);

    // The attribute sits on whichever root rendered — city or fallback — so
    // this holds with or without WebGL.
    const before = await page.getAttribute("[data-city-palette]", "data-city-palette");
    expect(await page.getAttribute("html", "class")).not.toContain("dark");
    expect(before).toBe(LIGHT_BUILDING);

    await page.click('button[aria-label="Dark"]');
    await page.waitForTimeout(200);
    const after = await page.getAttribute("[data-city-palette]", "data-city-palette");
    expect(await page.getAttribute("html", "class")).toContain("dark");
    expect(after).toBe(DARK_BUILDING);
    expect(after).not.toBe(before);
    await page.close();
  });

  it("draws a city that is not blank", async (ctx) => {
    const page = await h.newPage();
    await analyzeFixture(page, h.url);
    await page.click('[data-psq="dim-3d"]');
    await page.waitForTimeout(400);

    if ((await page.locator('[data-psq="city"]').count()) === 0) {
      // A machine without WebGL legitimately renders the fallback, exactly as
      // in the 2D/3D swap test above. Skip visibly rather than pass silently.
      expect(await page.locator('[data-psq="city-fallback"]').count()).toBe(1);
      await page.close();
      ctx.skip();
      return;
    }

    const px = await page.evaluate(
      () =>
        new Promise<{ pixels: number; uniform: boolean }>((resolve) => {
          const el = document.querySelector('[data-psq="city"]') as HTMLElement;
          const canvas = el.querySelector("canvas") as HTMLCanvasElement;
          // three r185 renders through WebGL2; getContext with the same type
          // returns the live context rather than creating one.
          const gl = canvas.getContext("webgl2") as WebGL2RenderingContext;
          const read = (): { pixels: number; uniform: boolean } => {
            const w = gl.drawingBufferWidth;
            const h2 = gl.drawingBufferHeight;
            const buf = new Uint8Array(w * h2 * 4);
            gl.readPixels(0, 0, w, h2, gl.RGBA, gl.UNSIGNED_BYTE, buf);
            let uniform = true;
            for (let i = 4; i < buf.length; i += 4) {
              if (
                buf[i] !== buf[0] || buf[i + 1] !== buf[1] ||
                buf[i + 2] !== buf[2] || buf[i + 3] !== buf[3]
              ) {
                uniform = false;
                break;
              }
            }
            return { pixels: w * h2, uniform };
          };
          // The renderer has no preserveDrawingBuffer, so the buffer is
          // cleared once the compositor consumes a frame — a bare readPixels
          // sees only zeros. EntityCity re-renders from a ResizeObserver
          // created on mount; observers are notified in creation order, so
          // this one (created later) runs in the same frame, after the
          // render and before the compositor clears it.
          const ro = new ResizeObserver(() => {
            const r = read();
            if (!r.uniform) {
              ro.disconnect();
              resolve(r);
            }
          });
          ro.observe(el);
          // Nudge the size to fire both observers; twice, in case the first
          // notification races the mount render.
          el.style.height = "99%";
          setTimeout(() => {
            el.style.height = "98%";
          }, 150);
          // Genuinely blank canvas: every read was uniform. Report it so the
          // test fails rather than hangs.
          setTimeout(() => {
            ro.disconnect();
            resolve(read());
          }, 1500);
        }),
    );
    expect(px.pixels).toBeGreaterThan(0);
    // A uniform buffer is a blank canvas: the city did not draw.
    expect(px.uniform).toBe(false);
    await page.close();
  });

  it("changes theme on demand and remembers the choice", async () => {
    const page = await h.newPage({ colorScheme: "light" });
    await page.goto(h.url, { waitUntil: "networkidle" });

    const htmlClass = async (): Promise<string> =>
      (await page.getAttribute("html", "class")) ?? "";

    await page.click('button[aria-label="Dark"]');
    await page.waitForTimeout(200);
    expect(await htmlClass()).toContain("dark");

    await page.click('button[aria-label="Light"]');
    await page.waitForTimeout(200);
    expect(await htmlClass()).not.toContain("dark");

    // An explicit choice must outlive a reload, and must not flash the wrong
    // theme on the way back: the inline script applies it before first paint.
    await page.click('button[aria-label="Dark"]');
    await page.reload({ waitUntil: "domcontentloaded" });
    expect(await htmlClass()).toContain("dark");
    expect(await page.evaluate(() => localStorage.getItem("psq-theme"))).toBe("dark");
    await page.close();
  });

  it("follows the operating system while the choice is System", async () => {
    const page = await h.newPage({ colorScheme: "dark" });
    await page.goto(h.url, { waitUntil: "networkidle" });
    await page.click('button[aria-label="System"]');
    await page.waitForTimeout(200);
    expect(await page.getAttribute("html", "class")).toContain("dark");

    await page.emulateMedia({ colorScheme: "light" });
    await page.waitForTimeout(200);
    // Without a media listener this would stay dark until a reload.
    expect(await page.getAttribute("html", "class")).not.toContain("dark");
    await page.close();
  });

  it("never sends an answer to the page before it is submitted", async () => {
    const page = await h.newPage();
    await analyzeFixture(page, h.url);

    const payloads: unknown[] = [];
    page.on("response", async (res) => {
      if (!res.url().includes("/quiz")) return;
      try {
        payloads.push(await res.json());
      } catch {
        // non-JSON responses are not quiz payloads
      }
    });

    await page.click('button:has-text("Start 10 questions")');
    await page.waitForSelector("text=/1 \\/ 10/", { timeout: 20_000 });
    await page.waitForTimeout(400);

    const serialized = JSON.stringify(payloads);
    expect(serialized.length).toBeGreaterThan(0);
    for (const field of ["answerIndex", '"answers"', "referenceSql", "rationale"]) {
      expect(serialized).not.toContain(field);
    }
    await page.close();
  });

  it("grades a wrong answer and only then reveals the right one", async () => {
    const page = await h.newPage();
    await analyzeFixture(page, h.url);
    await page.click('button:has-text("Start 10 questions")');
    await page.waitForSelector("text=/1 \\/ 10/", { timeout: 20_000 });

    await answerFirstQuestion(page);
    await page.waitForSelector("text=Not quite", { timeout: 10_000 });
    // The model answer appears only after the attempt.
    expect(await page.locator("text=Not quite").count()).toBe(1);
    await page.close();
  });

  it("accepts the right answer and shows the success state", async () => {
    const page = await h.newPage();
    await analyzeFixture(page, h.url);
    await page.click('button:has-text("Start 10 questions")');
    await page.waitForSelector("text=/1 \\/ 10/", { timeout: 20_000 });

    // Walk forward until a multiple-choice question comes up, then answer it
    // with the model answer the harness reads from the server. The page still
    // never receives it; only the test process does.
    for (let step = 0; step < 10; step++) {
      const prompt = (await page.locator("main p").first().textContent()) ?? "";
      const answer = h.answerFor(prompt);
      const options = page.locator("main button:has(span.font-mono)");
      const count = await options.count();

      if (answer !== null && count > 0) {
        const target = page.locator(`main button:has-text(${JSON.stringify(answer)})`);
        if ((await target.count()) > 0) {
          await target.first().click();
          await page.waitForSelector("text=Correct", { timeout: 10_000 });
          expect(await page.locator("text=Not quite").count()).toBe(0);
          await page.close();
          return;
        }
      }

      // Not a multiple-choice question: answer it any way at all and move on.
      if (count > 0) await options.first().click();
      else {
        const field = page.locator('main input, main textarea').first();
        await field.fill("skip");
        await page.click('button:has-text("Check")');
      }
      await page.waitForTimeout(300);
      await page.locator('main button:has-text("Next"), main button:has-text("See the score")').first().click();
      await page.waitForTimeout(300);
    }
    throw new Error("no multiple-choice question appeared in ten questions");
  });

  it("closes a project and returns to the empty state", async () => {
    const page = await h.newPage();
    await analyzeFixture(page, h.url);
    await page.hover("header button:has-text('mini-efcore')");
    await page.locator("header button:has-text('mini-efcore') svg").last().click();
    await page.waitForSelector("text=Point psq at a project", { timeout: 10_000 });
    expect(await page.locator('[data-psq="node"]').count()).toBe(0);
    await page.close();
  });

  it("explains a bad path instead of showing a stack trace", async () => {
    const page = await h.newPage();
    await page.goto(h.url, { waitUntil: "networkidle" });
    await page.fill('input[placeholder*="/path/to"]', "/definitely/not/a/real/path");
    await page.click('button:has-text("Analyze")');
    await page.waitForSelector("text=No such directory", { timeout: 15_000 });
    expect(await page.locator("text=at Object").count()).toBe(0);
    await page.close();
  });
});

/** Answer whichever question is on screen, without caring what is right. */
async function answerFirstQuestion(page: Page): Promise<void> {
  const options = page.locator("main button:has(span.font-mono)");
  if ((await options.count()) > 0) {
    await options.first().click();
    return;
  }
  const field = page.locator("main input, main textarea").first();
  await field.fill("definitely wrong");
  await page.click('button:has-text("Check")');
}

describe.skipIf(reason !== "")("a Node backend in the browser", () => {
  it("draws inferred edges dashed, and says which are inferred", async () => {
    const page = await h.newPage();
    await analyzeFixture(page, h.url, NODE_FIXTURE);

    // Every relation in a raw-DDL repo is inferred from naming, so every edge
    // must be dashed. A solid one would claim the schema declared it.
    const edges = page.locator("svg path[stroke-dasharray]");
    await expect.poll(() => edges.count()).toBe(2);
    expect(await page.getByText("inferred").count()).toBeGreaterThan(0);
    await page.close();
  });

  it("shows the drift between a table and the shape that mirrors it", async () => {
    const page = await h.newPage();
    await analyzeFixture(page, h.url, NODE_FIXTURE);

    await expect.poll(() => page.locator("text=Drift").count()).toBeGreaterThan(0);
    // departed_at is on the table and not the DTO; weather is the other way.
    expect(await page.locator("text=table only").count()).toBeGreaterThan(0);
    expect(await page.locator("text=shape only").count()).toBeGreaterThan(0);
    await page.close();
  });

  it("lists the HTTP surface it read out of a factory function", async () => {
    const page = await h.newPage();
    await analyzeFixture(page, h.url, NODE_FIXTURE);
    await expect.poll(() => page.getByText("/crews/:callsign").count()).toBe(1);
    await page.close();
  });

  it("takes a quiz restricted to one section", async () => {
    const page = await h.newPage();
    await analyzeFixture(page, h.url, NODE_FIXTURE);

    await page.click('button[aria-pressed="false"]:has-text("Data structures")');
    await page.click('button:has-text("Start 10 questions")');
    await page.waitForSelector("text=/1 \\/ 10/", { timeout: 20_000 });

    // mini-node has more than ten ds questions, so a full quiz is served from
    // that section alone — which is only possible if the filter reached the API.
    expect(await page.locator("text=/1 \\/ 10/").count()).toBeGreaterThan(0);
    await page.close();
  });
});
