import { existsSync } from "node:fs";
import { join } from "node:path";
import type { EntityGraph } from "@psq/schema";
import { extractDotnet } from "./dotnet.js";
import { extractNode } from "./node.js";
import { digestOf, repoRelative, walk } from "./files.js";
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
 * Extraction semantics version, bumped by hand when what the readers produce
 * from the same bytes changes.
 *
 * A stored fingerprint stays valid across a rebuild of psq itself, so without
 * this a deploy would leave every cached graph "fresh" while the extractor that
 * produced it is gone, and old-extractor graphs would be served indefinitely.
 * An envelope's own `version` guards the envelope's shape, not its producer.
 *
 * This is a discipline control: nothing enforces the bump, and forgetting it
 * serves one class of stale graph. An auto-derived digest of the extractor's
 * own sources was considered and rejected as too clever for the gain.
 */
export const EXTRACTOR_VERSION = 2;

/**
 * Extract whatever this repo is, alongside a fingerprint of the files that
 * decided the result.
 *
 * The digest comes from `digestOf` and is never a second, inlined hash: a
 * duplicate that is correct today is the drift a cross-time staleness check
 * cannot see.
 */
export function extractWithDigest(repoRoot: string): { graph: EntityGraph; digest: string } {
  // The digest is taken BEFORE extraction, and the order is load-bearing.
  // Object-literal properties evaluate in source order, so returning
  // `{ graph: extractGraph(root), digest: digestOf(root) }` would build the
  // graph from the bytes at T0 and stamp it with a fingerprint of the bytes at
  // T0+1.3s. A file edited inside that window would then yield an old graph
  // carrying a current digest — permanently stale, which is the exact failure
  // class this digest exists to prevent.
  //
  // Digest-first inverts the race: the graph may contain bytes newer than the
  // fingerprint, so a later comparison MISMATCHES and re-extracts. Paying for
  // an unnecessary re-extract is the safe direction; serving a stale graph is
  // not.
  const digest = digestOf(repoRoot);
  return { graph: extractGraph(repoRoot), digest };
}

/**
 * Extract whatever this repo is. An unrecognized repo is an empty graph with a
 * warning that names what was looked for — never a throw, and never a guess.
 */
export function extract(repoRoot: string): EntityGraph {
  return extractGraph(repoRoot);
}

function extractGraph(repoRoot: string): EntityGraph {
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
        entityRefs: [],
        warnings: [
          "No .csproj, .cs, package.json, tsconfig.json or TypeScript source found here. " +
            "psq reads .NET projects with an EF Core DbContext and Node backends with a SQLite schema.",
        ],
      };
  }
}
