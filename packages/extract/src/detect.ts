import { existsSync } from "node:fs";
import { join } from "node:path";
import type { EntityGraph } from "@psq/schema";
import { extractDotnet } from "./dotnet.js";
import { extractNode } from "./node.js";
import { walk } from "./files.js";

export type Provider = "efcore" | "sqlite-ddl" | "none";

/**
 * Which reader a repo needs, decided by what is on disk rather than by a flag.
 *
 * A .NET project wins when one is present, because a full-stack repo with a C#
 * API and a TS client is a .NET repo for M4's purposes — its client belongs to
 * M5. Nothing here reads file contents; that is the reader's job.
 */
export function detectProvider(repoRoot: string): Provider {
  // One walk for every extension at once. Asking separately per language means
  // traversing a repo three times before admitting psq cannot read it.
  const source = walk(repoRoot, [".csproj", ".cs", ".ts", ".tsx"]);
  if (source.some((f) => f.endsWith(".csproj") || f.endsWith(".cs"))) return "efcore";
  if (source.length > 0) return "sqlite-ddl";

  // No source, but a manifest: a JavaScript repo, or one whose sources live
  // somewhere `walk` skips. The Node reader will say what it could not find.
  if (existsSync(join(repoRoot, "package.json")) || existsSync(join(repoRoot, "tsconfig.json"))) {
    return "sqlite-ddl";
  }
  return "none";
}

/**
 * Extract whatever this repo is. An unrecognized repo is an empty graph with a
 * warning that names what was looked for — never a throw, and never a guess.
 */
export function extract(repoRoot: string): EntityGraph {
  switch (detectProvider(repoRoot)) {
    case "efcore":
      return extractDotnet(repoRoot);
    case "sqlite-ddl":
      return extractNode(repoRoot);
    case "none":
      return {
        kind: "entity",
        repo: repoRoot,
        provider: "none",
        contextName: null,
        entities: [],
        relations: [],
        shapes: [],
        routes: [],
        clientCalls: [],
        components: [],
        warnings: [
          "No .csproj, .cs, package.json, tsconfig.json or TypeScript source found here. " +
            "psq reads .NET projects with an EF Core DbContext and Node backends with a SQLite schema.",
        ],
      };
  }
}
