import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import ts from "typescript";
import type { ClientCall, EntityGraph } from "@psq/schema";
import { repoRelative, walk } from "./files.js";
import { collectDdl, readSchema } from "./node/ddl.js";
import { readShapes } from "./node/shapes.js";
import { readRoutes } from "./node/routes.js";
import { linkCalls, readClientCalls } from "./node/clients.js";
import { attributeComponents } from "./node/refs.js";
import { pairShapes } from "./pair.js";

/**
 * Read a Node backend: its SQLite schema, its declared shapes, its HTTP surface.
 *
 * Same contract as `extractDotnet` — synchronous, read-only, and a construct it
 * does not understand becomes a warning rather than a guess.
 */

/**
 * Enough to resolve types in a repo that has no tsconfig of its own.
 *
 * `strict` is not a style preference here. zod computes its inferred type with
 * conditional types over `undefined`, so without `strictNullChecks` every field
 * of every schema resolves as optional and every `.nullable()` loses its null.
 * psq would then report drift on fields that are fine and miss the ones that
 * are not — reading a repo under different rules than the repo is written to.
 */
const FALLBACK_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  strict: true,
  skipLibCheck: true,
  noEmit: true,
  allowJs: false,
  // Near-no-op — .tsx parses as JSX by extension regardless, and no
  // diagnostics are read — but it keeps the fallback program from carrying a
  // "JSX is off" option that a future diagnostic reader would trip over.
  jsx: ts.JsxEmit.Preserve,
};

/**
 * A solution-style tsconfig (`"files": []` + `"references"` — the Vite React
 * default) names no files itself; the options that make the repo resolve
 * (`paths`, `jsx`, `moduleResolution: "bundler"`) live in the referenced
 * projects. Pick ONE referenced project — the one with the most files,
 * tiebroken by lexicographic config path — and use its file set AND its
 * options verbatim. Never union file sets or overlay options: a project
 * reference is a separate compilation unit, and a merged compilation is one
 * tsc has never run — the overlay would leak `types`/`lib` from a config the
 * winner never extended, and the union would compile `vite.config.ts` under
 * the app project's options. One level only: a referenced config that is
 * itself solution-style contributes nothing.
 */
function pickReferencedProject(
  repoRoot: string,
  parsed: ts.ParsedCommandLine,
): { configPath: string; parsed: ts.ParsedCommandLine; contributors: number } | null {
  const prefix = repoRoot.endsWith("/") ? repoRoot : `${repoRoot}/`;
  // A reference is only as useful as the files it contributes UNDER the repo
  // root: `ownSources` filters everything else away afterwards, so counting
  // out-of-root files here would crown a winner whose entire program is then
  // discarded — a silent empty read. The predicate APPROXIMATES ownSources
  // conservatively rather than mirroring it exactly: `.d.ts` by suffix here
  // vs `isDeclarationFile` there (which also covers .d.mts/.d.cts), and the
  // config's own fileNames here vs the whole program with transitive imports
  // there. Both differences only undercount, and an undercount can only push
  // a reference toward the warned fall-through — never crown a winner whose
  // in-root read is empty.
  const ownCount = (files: readonly string[]): number =>
    files.filter(
      (f) => f.startsWith(prefix) && !f.includes("/node_modules/") && !f.endsWith(".d.ts"),
    ).length;

  let winner: { configPath: string; parsed: ts.ParsedCommandLine; own: number } | null = null;
  let contributors = 0;
  for (const ref of parsed.projectReferences ?? []) {
    // `projectReferences` paths are already absolute; this only resolves
    // directory-vs-file ("./app" -> "./app/tsconfig.json").
    const refPath = ts.resolveProjectReferencePath(ref);
    const read = ts.readConfigFile(refPath, ts.sys.readFile);
    if (read.error) continue;
    // basePath MUST be the referenced config's own directory, not the repo
    // root: a referenced `include: ["src"]` resolves against the config that
    // wrote it. Against the wrong root it would yield zero files — a wrong
    // answer wearing "no files" as a disguise.
    const refParsed = ts.parseJsonConfigFileContent(
      read.config,
      ts.sys,
      dirname(refPath),
      undefined,
      refPath,
    );
    const own = ownCount(refParsed.fileNames);
    // A reference pointing outside the repo (a sibling package, say) may
    // parse to plenty of files and still contribute nothing psq can read.
    // It must not win; if no reference contributes, the caller warns and
    // falls back to the directory scan, which still sees in-repo source.
    if (own === 0) continue;
    contributors += 1;
    if (
      winner === null ||
      own > winner.own ||
      (own === winner.own && refPath < winner.configPath)
    ) {
      winner = { configPath: refPath, parsed: refParsed, own };
    }
  }
  return winner === null
    ? null
    : { configPath: winner.configPath, parsed: winner.parsed, contributors };
}

function programFor(repoRoot: string, warnings: string[]): ts.Program {
  const configPath = join(repoRoot, "tsconfig.json");

  if (existsSync(configPath)) {
    const read = ts.readConfigFile(configPath, ts.sys.readFile);
    if (read.error) {
      warnings.push(
        `tsconfig.json: ${ts.flattenDiagnosticMessageText(read.error.messageText, " ")}; using defaults`,
      );
    } else {
      const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, repoRoot);
      if (parsed.fileNames.length > 0) {
        return ts.createProgram(parsed.fileNames, {
          ...parsed.options,
          // See FALLBACK_OPTIONS: a schema library's inferred types are wrong,
          // not merely looser, when null checking is off. psq reads, it does
          // not compile, so turning this on changes no output but the facts.
          strictNullChecks: true,
          noEmit: true,
        });
      }
      const chosen = pickReferencedProject(repoRoot, parsed);
      if (chosen) {
        const refs = parsed.projectReferences ?? [];
        if (chosen.contributors > 1) {
          // At least one OTHER reference contributed in-root files and was
          // dropped. For a Vite client that is by design (the loser holds
          // vite.config.ts); for a monorepo solution config it is a
          // half-read, so say so. A reference contributing nothing readable
          // (out-of-root, empty) is not a drop and does not warn.
          warnings.push(
            `tsconfig.json: ${refs.length} referenced projects; reading only ${repoRelative(repoRoot, chosen.configPath)}`,
          );
        }
        return ts.createProgram(chosen.parsed.fileNames, {
          ...chosen.parsed.options,
          strictNullChecks: true,
          noEmit: true,
        });
      }
      // A tsconfig existed, parsed, and yielded no files — directly or through
      // any referenced project. The directory scan below is a degraded read
      // (no `paths`, no bundler resolution), and degrading in silence is
      // against the house rule. This branch is unreachable when there is no
      // tsconfig at all: that case never enters the else-arm.
      warnings.push(
        "tsconfig.json names no files and no referenced project contributes files " +
          "under this directory; falling back to a directory scan with default compiler options",
      );
    }
  }

  return ts.createProgram(walk(repoRoot, [".ts", ".tsx"]), FALLBACK_OPTIONS);
}

/**
 * The repo's own source. Excludes declaration files, dependencies, and anything
 * a tsconfig pulled in from outside the directory psq was pointed at.
 */
function ownSources(program: ts.Program, repoRoot: string): ts.SourceFile[] {
  const prefix = repoRoot.endsWith("/") ? repoRoot : `${repoRoot}/`;
  return program
    .getSourceFiles()
    .filter(
      (f) =>
        !f.isDeclarationFile &&
        !f.fileName.includes("/node_modules/") &&
        f.fileName.startsWith(prefix),
    )
    .sort((a, b) => a.fileName.localeCompare(b.fileName));
}

export function extractNode(repoRoot: string): EntityGraph {
  const warnings: string[] = [];
  const program = programFor(repoRoot, warnings);
  const checker = program.getTypeChecker();
  const sources = ownSources(program, repoRoot);

  const { entities, relations } = readSchema(collectDdl(repoRoot, sources, warnings), warnings);
  const shapes = pairShapes(entities, readShapes(repoRoot, checker, sources, warnings), warnings);
  const routes = readRoutes(repoRoot, sources, warnings);
  const callNodes = new Map<ClientCall, ts.CallExpression>();
  const clientCalls = linkCalls(
    routes,
    readClientCalls(repoRoot, sources, warnings, callNodes),
    warnings,
  );

  if (entities.length === 0 && shapes.length > 0) {
    warnings.push(
      "No CREATE TABLE statement was found, so this repo has shapes but no schema. " +
        "psq reads a schema from raw DDL only; an ORM-defined schema is not read.",
    );
  }

  // Attribution runs LAST: a later phase that synthesises ClientCalls (the
  // deferred wrapper unwrapping) must be seen by it.
  const components = attributeComponents(
    repoRoot,
    sources,
    checker,
    clientCalls,
    callNodes,
    warnings,
  );

  return {
    kind: "entity",
    repo: repoRoot,
    provider: "sqlite-ddl",
    contextName: null,
    entities,
    relations,
    shapes,
    routes,
    clientCalls,
    components,
    warnings,
  };
}
