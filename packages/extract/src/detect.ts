import { existsSync } from "node:fs";
import { join } from "node:path";
import type { EntityGraph } from "@psq/schema";
import { extractDotnet } from "./dotnet.js";
import { extractNode } from "./node.js";
import { repoRelative, walk } from "./files.js";
import { mergeGraphs, nodeRootFor } from "./merge.js";

export type Provider = "efcore" | "sqlite-ddl" | "fullstack" | "none";

/**
 * Which reader a repo needs, decided by what is on disk rather than by a flag.
 * Nothing here reads file contents; that is the reader's job.
 *
 * A repo holding both C# and TypeScript is read by BOTH readers and merged
 * (`merge.ts`). It used to route wholly to the .NET reader, on the stated
 * grounds that "a full-stack repo with a C# API and a TS client is a .NET repo
 * for M4's purposes — its client belongs to M5." That premise expired when M5
 * landed: components, client calls and their attribution now exist, and
 * throwing away the client half of a full-stack repo throws away facts psq can
 * read. Hence the reversal, recorded here rather than patched quietly.
 *
 * Known sharp edge: `walk` does not apply `isTestFile`, so ONE `.ts` anywhere
 * in a .NET repo — a build script, a Playwright spec — flips it to "fullstack"
 * and pays for a `ts.Program` (~870 ms on a repo of any size) to learn there
 * are no shapes. Nothing worse than slow: the extra reader contributes empty
 * arrays. Narrowing the test would be a guess about which `.ts` files count.
 */
export function detectProvider(repoRoot: string): Provider {
  // One walk for every extension at once. Asking separately per language means
  // traversing a repo three times before admitting psq cannot read it.
  const source = walk(repoRoot, [".csproj", ".cs", ".ts", ".tsx"]);
  const hasDotnet = source.some((f) => f.endsWith(".csproj") || f.endsWith(".cs"));
  const hasNode = source.some((f) => f.endsWith(".ts") || f.endsWith(".tsx"));
  if (hasDotnet && hasNode) return "fullstack";
  if (hasDotnet) return "efcore";
  if (hasNode) return "sqlite-ddl";

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
    case "fullstack": {
      // Two roots, one graph. The .NET reader takes the outer root; the
      // TypeScript reader takes whichever directory owns the tsconfig, because
      // reading a `paths`-using client from the outer root silently destroys
      // its cross-file attribution. See `nodeRootFor`.
      const dotnet = extractDotnet(repoRoot);
      const picked = nodeRootFor(repoRoot);
      const node = extractNode(picked.root);
      return mergeGraphs(dotnet, node, repoRelative(repoRoot, picked.root), picked.warnings);
    }
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
