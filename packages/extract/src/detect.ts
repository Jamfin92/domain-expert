import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ProviderBasis } from "@psq/schema";
import { extractDotnet } from "./dotnet.js";
import { extractNode } from "./node.js";
import { digestOf, partitionTest, repoRelative, walk } from "./files.js";
import { mergeGraphs, nodeRootFor } from "./merge.js";
import { allFacets, notRead, type ExtractedGraph } from "./coverage.js";
import { countNoun, Warnings } from "./warnings.js";

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
 * Only source OUTSIDE test paths (`isTestFile`) makes a stack present. A
 * `.cs` under `tests/fixtures/` is not the repo being a .NET project, and a
 * Playwright spec or a `__tests__/` file is not it being a TypeScript one;
 * routing on them read a project psq invented. The package.json/tsconfig.json
 * fallback below is unchanged. A build script outside test paths still counts
 * (narrowing further would be a guess about which `.ts` files matter).
 */
export function detectProvider(repoRoot: string): Provider {
  return detectStack(repoRoot).provider;
}

/** `detectProvider`, plus the file counts that decided it. */
export function detectStack(repoRoot: string): { provider: Provider; basis: ProviderBasis } {
  // One walk for every extension at once. Asking separately per language means
  // traversing a repo three times before admitting psq cannot read it.
  const source = walk(repoRoot, [".csproj", ".cs", ".ts", ".tsx"]);
  const { src, test } = partitionTest(repoRoot, source);
  const isCs = (f: string): boolean => f.endsWith(".cs");
  const isTs = (f: string): boolean => f.endsWith(".ts") || f.endsWith(".tsx");
  const basis: ProviderBasis = {
    csFiles: source.filter(isCs).length,
    csprojFiles: source.filter((f) => f.endsWith(".csproj")).length,
    tsFiles: source.filter(isTs).length,
    testOnlyCs: test.filter(isCs).length,
    testOnlyCsproj: test.filter((f) => f.endsWith(".csproj")).length,
    testOnlyTs: test.filter(isTs).length,
    packageJson: existsSync(join(repoRoot, "package.json")),
    tsconfig: existsSync(join(repoRoot, "tsconfig.json")),
  };
  const hasDotnet = src.some((f) => f.endsWith(".csproj") || isCs(f));
  const hasNode = src.some(isTs);
  if (hasDotnet && hasNode) return { provider: "fullstack", basis };
  if (hasDotnet) return { provider: "efcore", basis };
  if (hasNode) return { provider: "sqlite-ddl", basis };

  // No source, but a manifest: a JavaScript repo, or one whose sources live
  // somewhere `walk` skips. The Node reader will say what it could not find.
  if (basis.packageJson || basis.tsconfig) return { provider: "sqlite-ddl", basis };
  return { provider: "none", basis };
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
 *
 * 8: (1) every graph carries `coverage` + `providerBasis`; (2) the provider
 * is elected from source outside test paths only; (3) the DbContext is
 * elected from contexts outside test paths first.
 *
 * 9: (1) every graph carries `warningRecords`, the typed twin of `warnings`;
 * (2) a DDL candidate must begin like a SQL statement (prose mentioning CREATE
 * TABLE is no longer executed); (3) fullstack node warnings carry the node-root
 * prefix; (4) unreadable `.cs` files are counted in coverage (`skipped:
 * unreadable`, partial) and a walk-limit hit warns in both readers; (5) every
 * entry point resolves its path first, so a relative root reads the same facts
 * as its absolute twin; (6) "1 file"/"1 shape" grammar.
 */
export const EXTRACTOR_VERSION = 9;

/**
 * Extract whatever this repo is, alongside a fingerprint of the files that
 * decided the result.
 *
 * The digest comes from `digestOf` and is never a second, inlined hash: a
 * duplicate that is correct today is the drift a cross-time staleness check
 * cannot see.
 */
export function extractWithDigest(repoRootIn: string): { graph: ExtractedGraph; digest: string } {
  // Same path form for the digest and the graph; see `extract`.
  const repoRoot = resolve(repoRootIn);
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
export function extract(repoRoot: string): ExtractedGraph {
  // A relative root used to read different facts than its absolute twin (P2b F6).
  return extractGraph(resolve(repoRoot));
}

function extractGraph(repoRoot: string): ExtractedGraph {
  const { provider, basis } = detectStack(repoRoot);
  switch (provider) {
    case "efcore":
      return { ...extractDotnet(repoRoot), providerBasis: basis };
    case "sqlite-ddl":
      return { ...extractNode(repoRoot), providerBasis: basis };
    case "fullstack": {
      // Two roots, one graph. The .NET reader takes the outer root; the
      // TypeScript reader takes whichever directory owns the tsconfig, because
      // reading a `paths`-using client from the outer root silently destroys
      // its cross-file attribution. See `nodeRootFor`.
      const dotnet = extractDotnet(repoRoot);
      const picked = nodeRootFor(repoRoot);
      const node = extractNode(picked.root);
      return {
        ...mergeGraphs(dotnet, node, repoRelative(repoRoot, picked.root), picked.records),
        providerBasis: basis,
      };
    }
    case "none": {
      const underTest = basis.testOnlyCs + basis.testOnlyCsproj + basis.testOnlyTs;
      const sentence =
        "No .csproj, .cs, .ts or .tsx source files outside test paths, and no package.json or " +
        "tsconfig.json, found here" +
        (underTest > 0
          ? `; ${countNoun(underTest, "file")} under test/fixture paths ` +
            `${underTest === 1 ? "was" : "were"} not treated as the project`
          : "");
      const w = new Warnings();
      w.push(
        "no-reader",
        `${sentence}. psq reads .NET projects with an EF Core DbContext and Node backends with a SQLite schema.`,
      );
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
        warnings: w.strings,
        warningRecords: w.records,
        coverage: allFacets(() => notRead(`no reader ran: ${sentence}`)),
        providerBasis: basis,
      };
    }
  }
}
