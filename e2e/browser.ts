import { existsSync, readdirSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

/**
 * Find a Chromium to drive, wherever this happens to be running.
 *
 * The suite must not assume a Playwright install or a downloaded browser, so
 * it looks in the places one usually exists and skips cleanly when none does.
 * That is the same contract the corpus tests use: run where the inputs exist,
 * skip where they do not, never fail for a reason unrelated to the code.
 *
 * Set PSQ_E2E_BROWSER to point at a specific binary.
 */

function firstExisting(paths: string[]): string | null {
  return paths.find((p) => existsSync(p)) ?? null;
}

/** Playwright caches browsers under a versioned directory; take the newest. */
function fromPlaywrightCache(): string | null {
  const roots =
    platform() === "darwin"
      ? [join(homedir(), "Library/Caches/ms-playwright")]
      : [join(homedir(), ".cache/ms-playwright"), "/ms-playwright"];

  for (const root of roots) {
    if (!existsSync(root)) continue;
    let entries: string[];
    try {
      entries = readdirSync(root);
    } catch {
      continue;
    }
    const versions = entries
      .filter((e) => /^chromium-\d+$/.test(e))
      .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));

    for (const v of versions) {
      const candidate = firstExisting([
        join(root, v, "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"),
        join(root, v, "chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"),
        join(root, v, "chrome-linux/chrome"),
        join(root, v, "chrome-win/chrome.exe"),
      ]);
      if (candidate) return candidate;
    }
  }
  return null;
}

function fromSystem(): string | null {
  return firstExisting([
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
  ]);
}

export function findBrowser(): string | null {
  const override = process.env["PSQ_E2E_BROWSER"];
  if (override) return existsSync(override) ? override : null;
  return fromPlaywrightCache() ?? fromSystem();
}

export const BROWSER = findBrowser();
