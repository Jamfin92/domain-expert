import { existsSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import type { EntityGraph } from "@psq/schema";
import { walk } from "./files.js";
import { collectDdl, readSchema } from "./node/ddl.js";
import { readShapes } from "./node/shapes.js";
import { readRoutes } from "./node/routes.js";
import { linkCalls, readClientCalls } from "./node/clients.js";
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
};

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
  const clientCalls = linkCalls(routes, readClientCalls(repoRoot, sources, warnings), warnings);

  if (entities.length === 0 && shapes.length > 0) {
    warnings.push(
      "No CREATE TABLE statement was found, so this repo has shapes but no schema. " +
        "psq reads a schema from raw DDL only; an ORM-defined schema is not read.",
    );
  }

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
    warnings,
  };
}
