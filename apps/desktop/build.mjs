import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/**
 * Bundle main and preload to CommonJS.
 *
 * Electron's main process loads .cjs reliably across versions, and the
 * preload MUST be CommonJS when `sandbox: true`. Bundling also pulls the psq
 * workspace packages in, so the app does not depend on pnpm's symlink layout
 * at runtime.
 */
const here = dirname(fileURLToPath(import.meta.url));

/**
 * `import.meta` does not exist in a CJS bundle. Without these,
 * `createRequire(import.meta.url)` in the sqlite driver receives an empty
 * string and throws, which would break every SQL question in the desktop app
 * while leaving the browser build working -- exactly the kind of shell-only
 * failure that is easy to ship unnoticed.
 */
const META_SHIM = {
  "import.meta.dirname": "__dirname",
  // A define value must be an identifier or a literal, so the real expression
  // is declared by the banner below and referenced by name here.
  "import.meta.url": "__psqMetaUrl",
};

const META_BANNER = {
  js: "const __psqMetaUrl = require('node:url').pathToFileURL(__filename).href;",
};

const common = {
  bundle: true,
  platform: "node",
  target: "node24",
  format: "cjs",
  sourcemap: true,
  // Electron supplies these itself; bundling them would break the app.
  external: ["electron"],
  logLevel: "info",
};

const main = await build({
  ...common,
  entryPoints: [resolve(here, "src/main.ts")],
  outfile: resolve(here, "dist/main.cjs"),
  define: META_SHIM,
  banner: META_BANNER,
});

const preload = await build({
  ...common,
  entryPoints: [resolve(here, "src/preload.ts")],
  outfile: resolve(here, "dist/preload.cjs"),
  define: META_SHIM,
  banner: META_BANNER,
});

/**
 * Fail on any warning.
 *
 * The bug this prevents: esbuild warned that `import.meta` is empty under
 * "cjs", which silently turned `createRequire(import.meta.url)` into a throw
 * and broke every SQL question in the desktop app while the browser build
 * kept working. A shell-only failure is exactly the kind that ships unnoticed,
 * so a warning here is a build error.
 */
const warnings = [...main.warnings, ...preload.warnings];
if (warnings.length > 0) {
  console.error(`\nRefusing to ship a bundle with ${warnings.length} warning(s).`);
  process.exit(1);
}
