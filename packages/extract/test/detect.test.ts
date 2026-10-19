import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { detectProvider, detectStack, extract } from "../src/detect.js";
import {
  MINI_EFCORE, MINI_EFCORE_EMPTY_CONTEXT, MINI_EFCORE_PRIMARY_CTOR, MINI_EFCORE_REFS,
  MINI_FULLSTACK, MINI_FULLSTACK_CSHARP, MINI_FULLSTACK_REACT, MINI_NODE, MINI_REACT,
  MINI_SOLUTION_TIE, MINI_TYPES_ONLY, NOT_A_PROJECT,
} from "../../../test/fixtures.js";

/**
 * Provider election from source OUTSIDE test paths (P2a). A `.cs` under
 * `test/fixtures/` is not the repo being a .NET project; on the baseline it
 * was, and the repo was read as fullstack.
 */
describe("detectStack: only non-test source makes a stack present", () => {
  let root: string;
  const write = (rel: string, body: string): void => {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body);
  };
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "psq-detect-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("(a) TS source plus .cs only under test/fixtures/ is sqlite-ddl, not fullstack", () => {
    write("src/server.ts", "export const port = 1;\n");
    write("test/fixtures/dotnet/Program.cs", "class Program {}\n");
    expect(detectProvider(root)).toBe("sqlite-ddl");
    const { provider, basis } = detectStack(root);
    expect(provider).toBe("sqlite-ddl");
    expect(basis.testOnlyCs).toBeGreaterThanOrEqual(1);
    expect(basis.csFiles).toBe(1);
    expect(basis.tsFiles).toBe(1);
    expect(basis.testOnlyTs).toBe(0);
  });

  it("(b) .cs source plus .ts only under __tests__/ is efcore, not fullstack", () => {
    write("Api/Program.cs", "class Program {}\n");
    write("__tests__/e2e.ts", "export const x = 1;\n");
    write("web/login.spec.ts", "export const y = 1;\n");
    expect(detectProvider(root)).toBe("efcore");
    expect(detectStack(root).basis.testOnlyTs).toBe(2);
  });

  it("(c) only test-path sources and no manifest is none, and the warning says why", () => {
    write("tests/Fixtures/App.cs", "class App {}\n");
    write("test/helper.ts", "export const z = 1;\n");
    expect(detectProvider(root)).toBe("none");
    const g = extract(root);
    expect(g.provider).toBe("none");
    expect(g.warnings).toHaveLength(1);
    expect(g.warnings[0]).toContain("outside test paths");
    expect(g.warnings[0]).toContain("2 files under test/fixture paths were not treated as the project");
    expect(g.providerBasis).toMatchObject({ testOnlyCs: 1, testOnlyTs: 1 });
  });

  it("(c'') a .csproj only under a test path counts in the test-path clause", () => {
    write("tests/P/P.csproj", "<Project />\n");
    expect(detectProvider(root)).toBe("none");
    const g = extract(root);
    expect(g.providerBasis).toMatchObject({ testOnlyCsproj: 1, testOnlyCs: 0, testOnlyTs: 0, csprojFiles: 1 });
    expect(g.warnings[0]).toContain("1 files under test/fixture paths were not treated as the project");
  });

  it("(c') a manifest still routes test-only TypeScript to the Node reader (fallback unchanged)", () => {
    write("package.json", "{}\n");
    write("test/helper.ts", "export const z = 1;\n");
    expect(detectProvider(root)).toBe("sqlite-ddl");
    expect(detectStack(root).basis.packageJson).toBe(true);
  });
});

describe("detectProvider: every hermetic fixture keeps its provider", () => {
  // Measured on the baseline (ed92eac) before the test-path rule existed:
  // no fixture holds test-path source, so none may move.
  const table: [string, string][] = [
    [MINI_EFCORE, "efcore"],
    [MINI_EFCORE_EMPTY_CONTEXT, "efcore"],
    [MINI_EFCORE_PRIMARY_CTOR, "efcore"],
    [MINI_EFCORE_REFS, "efcore"],
    [MINI_FULLSTACK, "sqlite-ddl"],
    [MINI_FULLSTACK_CSHARP, "fullstack"],
    [MINI_FULLSTACK_REACT, "sqlite-ddl"],
    [MINI_NODE, "sqlite-ddl"],
    [MINI_REACT, "sqlite-ddl"],
    [MINI_SOLUTION_TIE, "sqlite-ddl"],
    [MINI_TYPES_ONLY, "sqlite-ddl"],
    [NOT_A_PROJECT, "none"],
    [join(dirname(MINI_EFCORE), "mini-aspnet-routes"), "efcore"],
    [join(dirname(MINI_EFCORE), "mini-client-base"), "sqlite-ddl"],
    [join(dirname(MINI_EFCORE), "mini-node-handlers"), "sqlite-ddl"],
  ];
  it.each(table)("%s", (path, provider) => {
    expect(detectProvider(path)).toBe(provider);
    const basis = detectStack(path).basis;
    expect(basis.testOnlyCs + basis.testOnlyTs).toBe(0);
  });
});
