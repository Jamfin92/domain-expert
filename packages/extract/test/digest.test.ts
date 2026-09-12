import { describe, it, expect, afterEach, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { digestOf, walk, repoRelative, DIGEST_EXTENSIONS } from "../src/files.js";
import { extractWithDigest } from "../src/detect.js";

// A10 needs to observe the MOMENT `extractWithDigest` takes its digest, and
// `extractGraph` is module-private so it cannot be spied. `digestOf` is an
// imported binding in `detect.ts`, so it can be. The wrapper delegates to the
// real implementation and does nothing at all unless a test installs a hook,
// so every other test in this file exercises the genuine `digestOf`.
const hooks = vi.hoisted(() => ({ onDigest: null as ((root: string) => void) | null }));

vi.mock("../src/files.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/files.js")>();
  return {
    ...actual,
    digestOf: (root: string) => {
      hooks.onDigest?.(root);
      return actual.digestOf(root);
    },
  };
});

// `digestOf` is public package surface (it is what G-b's rehydrate calls to
// learn a repo is stale without paying for an extraction), but it is imported
// from `../src/files.js` here to match `merge.test.ts:6` and `dotnet.test.ts:2`.

const made: string[] = [];

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A repo on disk from a path -> contents map. Paths use "/" separators. */
function repo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "psq-digest-"));
  made.push(root);
  for (const [rel, body] of Object.entries(files)) {
    const full = join(root, ...rel.split("/"));
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, body);
  }
  return root;
}

/** A repo carrying one file of every extension the digest claims to cover. */
function fullFixture(): Record<string, string> {
  return {
    "package.json": JSON.stringify({ name: "fixture" }),
    "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true } }),
    "Api/Api.csproj": "<Project Sdk=\"Microsoft.NET.Sdk\"></Project>",
    "Api/Order.cs": "public class Order { public int Id { get; set; } }",
    "src/schema.ts": "export const ddl = `CREATE TABLE orders (id INTEGER)`;",
    "src/App.tsx": "export const App = () => null;",
    "README.md": "# fixture",
  };
}

/** Flip one byte of a file, without changing its length. */
function mutateOneByte(root: string, rel: string): void {
  const full = join(root, ...rel.split("/"));
  const buf = readFileSync(full);
  const last = buf.length - 1;
  if (last < 0) throw new Error(`fixture ${rel} is empty, nothing to mutate`);
  buf[last] = (buf[last] ?? 0) ^ 0x01;
  writeFileSync(full, buf);
}

describe("digestOf", () => {
  // ---- A4. The control for every "it changed" assertion below. A hash that
  // always changes passes A5-A8 and fails only here.
  it("A4: is deterministic across calls on an unchanged tree", () => {
    const root = repo(fullFixture());
    expect(digestOf(root)).toBe(digestOf(root));
  });

  it("A4: is deterministic across two identical trees in different directories", () => {
    // Stronger than the same-directory repeat: proves the absolute path of the
    // root does not leak into the hash, which is what lets G-b compare a
    // fingerprint written on one machine against one recomputed later.
    expect(digestOf(repo(fullFixture()))).toBe(digestOf(repo(fullFixture())));
  });

  // ---- A5. Sensitivity, one extension at a time.
  const sensitive = [
    ["a .cs file", "Api/Order.cs"],
    ["a .ts file", "src/schema.ts"],
    ["a .tsx file", "src/App.tsx"],
    ["a .csproj file", "Api/Api.csproj"],
    ["tsconfig.json", "tsconfig.json"],
    ["package.json", "package.json"],
  ] as const;

  for (const [label, rel] of sensitive) {
    it(`A5: one mutated byte in ${label} moves the digest`, () => {
      const root = repo(fullFixture());
      const before = digestOf(root);
      mutateOneByte(root, rel);
      expect(digestOf(root)).not.toBe(before);
    });
  }

  // ---- A6. The file SET, not just file contents.
  it("A6: adding a new .ts moves the digest", () => {
    const root = repo(fullFixture());
    const before = digestOf(root);
    writeFileSync(join(root, "src", "added.ts"), "export const added = 1;");
    expect(digestOf(root)).not.toBe(before);
  });

  it("A6: deleting an existing .ts moves the digest", () => {
    const root = repo(fullFixture());
    const before = digestOf(root);
    rmSync(join(root, "src", "schema.ts"));
    expect(digestOf(root)).not.toBe(before);
  });

  // A rename with byte-IDENTICAL contents is the case that makes A6 mean
  // something. Mutation-tested by the G-a reviewer: a `digestOf` that hashes
  // contents only, dropping the relpath entirely, passes the add and delete
  // cases above — both move the content stream, so neither separates the two
  // designs. Only a rename holds the path in the hash.
  it("A6: renaming a .ts to byte-identical contents moves the digest", () => {
    const root = repo(fullFixture());
    const before = digestOf(root);
    const body = readFileSync(join(root, "src", "schema.ts"));
    rmSync(join(root, "src", "schema.ts"));
    writeFileSync(join(root, "src", "schema2.ts"), body);
    expect(digestOf(root)).not.toBe(before);
  });

  it("A6: moving tsconfig.json one directory down moves the digest", () => {
    // The load-bearing instance of the same property: `nodeRootFor`
    // (`merge.ts:50,67`) scans one level down for a nested `tsconfig.json` and
    // re-roots the whole TS half of a fullstack graph on finding one. The
    // bytes are unchanged and only the path moves, so a contents-only digest
    // would call this repo unchanged while extraction produces a different
    // graph — permanently stale.
    const root = repo(fullFixture());
    const before = digestOf(root);
    const body = readFileSync(join(root, "tsconfig.json"));
    rmSync(join(root, "tsconfig.json"));
    writeFileSync(join(root, "src", "tsconfig.json"), body);
    expect(digestOf(root)).not.toBe(before);
  });

  it("A6: the rename cases really are byte-identical (insurance, not a control)", () => {
    // Deliberately labelled. This is NOT a control in the sense the A7 and A8
    // non-vacuity tests are: the renames above write bytes read straight back
    // from the same file, with no helper in between that could transform them,
    // so nothing short of the filesystem corrupting data can redden it. It is
    // kept as cheap insurance against a future refactor introducing such a
    // helper, and named so it is not mistaken for load-bearing.
    const root = repo(fullFixture());
    const body = readFileSync(join(root, "src", "schema.ts"));
    rmSync(join(root, "src", "schema.ts"));
    writeFileSync(join(root, "src", "schema2.ts"), body);
    expect(readFileSync(join(root, "src", "schema2.ts")).equals(body)).toBe(true);
  });

  // ---- A7. Negative. Without these an over-broad walk passes A5 and then
  // thrashes re-extract on every unrelated edit forever.
  it("A7: editing README.md does not move the digest", () => {
    const root = repo(fullFixture());
    const before = digestOf(root);
    writeFileSync(join(root, "README.md"), "# fixture, rewritten at length");
    expect(digestOf(root)).toBe(before);
  });

  it("A7: adding a source file under node_modules/ does not move the digest", () => {
    const root = repo(fullFixture());
    const before = digestOf(root);
    mkdirSync(join(root, "node_modules", "dep"), { recursive: true });
    writeFileSync(join(root, "node_modules", "dep", "index.ts"), "export const dep = 1;");
    writeFileSync(join(root, "node_modules", "dep", "package.json"), "{}");
    expect(digestOf(root)).toBe(before);
  });

  it("A7: the negative cases are not vacuous - the same tree is still sensitive", () => {
    // Positive control for the two gates above: a negative gate that passes by
    // finding nothing can pass because the digest stopped seeing anything at
    // all. Same fixture, same call, one real source edit.
    const root = repo(fullFixture());
    const before = digestOf(root);
    writeFileSync(join(root, "README.md"), "# fixture, rewritten at length");
    expect(digestOf(root)).toBe(before);
    mutateOneByte(root, "src/schema.ts");
    expect(digestOf(root)).not.toBe(before);
  });

  // ---- A8. Framing. `relpath + NUL + byteLength + NUL + contents`.
  //
  // The collision pair: under a naive `relpath + contents` concat, one file
  // `a.ts` holding "b.tsZ" and the two files `a.ts` (empty) + `b.ts` ("Z")
  // both concatenate to "a.tsb.tsZ". The naive-collides assertion is the
  // control; without it this gate passes whether or not the framing is real.
  const oneFile = { "a.ts": "b.tsZ" };
  const twoFiles = { "a.ts": "", "b.ts": "Z" };

  /** What the digest would be with no framing at all. */
  function naiveDigest(root: string): string {
    const h = createHash("sha256");
    for (const file of walk(root, DIGEST_EXTENSIONS)) {
      h.update(repoRelative(root, file));
      h.update(readFileSync(file));
    }
    return h.digest("hex");
  }

  it("A8 control: the naive relpath+contents concat collides on this pair", () => {
    expect(naiveDigest(repo(oneFile))).toBe(naiveDigest(repo(twoFiles)));
  });

  it("A8: digestOf does not collide on that pair", () => {
    expect(digestOf(repo(oneFile))).not.toBe(digestOf(repo(twoFiles)));
  });

  // ---- A8b. The LENGTH field, which A8 does not hold.
  //
  // A8's pair separates on the NUL alone: a digest of
  // `relpath + NUL + contents`, with no length, still tells "b.tsZ" from "Z".
  // So A8 gates the separator and nothing else, and a mutant that drops only
  // the length passes all 18 tests.
  //
  // This pair defeats the separator too. One file `a.ts` containing
  // `b.ts\0Z`, versus `a.ts` (empty) + `b.ts` containing `Z`: both render as
  // `a.ts\0b.ts\0Z` once the length is gone, because the payload supplies its
  // own NUL. Only the byte count separates them.
  const nulOneFile = { "a.ts": "b.ts\u0000Z" };
  const nulTwoFiles = { "a.ts": "", "b.ts": "Z" };

  /** `relpath + NUL + contents`: the separator, but no length. */
  function unlengthedDigest(root: string): string {
    const h = createHash("sha256");
    for (const file of walk(root, DIGEST_EXTENSIONS)) {
      h.update(repoRelative(root, file));
      h.update(Buffer.from([0]));
      h.update(readFileSync(file));
    }
    return h.digest("hex");
  }

  it("A8b control: dropping only the length collides on the NUL-bearing pair", () => {
    expect(unlengthedDigest(repo(nulOneFile))).toBe(unlengthedDigest(repo(nulTwoFiles)));
  });

  it("A8b: digestOf does not collide on the NUL-bearing pair", () => {
    expect(digestOf(repo(nulOneFile))).not.toBe(digestOf(repo(nulTwoFiles)));
  });

  it("A8b control: A8's own pair does NOT hold the length", () => {
    // The finding that produced A8b, asserted rather than described: the
    // length-free digest still separates A8's pair, so A8 could never have
    // caught a missing length field.
    expect(unlengthedDigest(repo(oneFile))).not.toBe(unlengthedDigest(repo(twoFiles)));
  });
});

describe("extractWithDigest", () => {
  afterEach(() => {
    hooks.onDigest = null;
  });

  /** A minimal Node repo the sqlite-ddl reader can read. */
  function extractableRepo(): string {
    return repo({
      "package.json": JSON.stringify({ name: "a10-fixture", type: "module" }),
      "tsconfig.json": JSON.stringify({
        compilerOptions: { target: "ES2022", module: "ESNext", strict: true },
        include: ["**/*.ts"],
      }),
      "schema.ts": [
        "export const SCHEMA = `",
        "CREATE TABLE voyages (",
        "  id INTEGER PRIMARY KEY,",
        "  destination TEXT NOT NULL",
        ");",
        "`;",
        "",
      ].join("\n"),
    });
  }

  // ---- A10. The digest must be taken BEFORE the graph is built.
  //
  // Object-literal properties evaluate in source order, so
  // `{ graph: extractGraph(root), digest: digestOf(root) }` builds the graph
  // from the bytes at T0 and stamps it with a fingerprint of the bytes at
  // T0+1.3s. A file edited inside that window yields an old graph carrying a
  // current digest, which a later comparison calls fresh: permanently stale.
  //
  // The hook writes a new table into the repo at the instant the digest is
  // taken, which is exactly the edit that race describes. If the digest comes
  // first, extraction runs afterwards and must SEE the new table. If the graph
  // came first, the table cannot appear. Deterministic: no threads, no sleeps.
  it("A10: takes the digest before extracting, so a write at digest time is in the graph", () => {
    const root = extractableRepo();
    let fired = 0;
    hooks.onDigest = (r) => {
      fired += 1;
      writeFileSync(
        join(r, "injected.ts"),
        "export const EXTRA = `\nCREATE TABLE injected_during_digest (\n  id INTEGER PRIMARY KEY\n);\n`;\n",
      );
    };

    const { graph } = extractWithDigest(root);

    // The hook firing is the premise; without it the assertion below would
    // fail for the wrong reason and read as an ordering bug.
    expect(fired).toBe(1);
    expect(graph.entities.map((e) => e.name)).toContain("injected_during_digest");
  });

  it("A10 control: the fixture does NOT contain the injected table on its own", () => {
    // Without this, an extractor that invented the entity, or a fixture that
    // already declared it, would pass A10 whatever the ordering.
    const { graph } = extractWithDigest(extractableRepo());
    expect(graph.entities.map((e) => e.name)).toEqual(["voyages"]);
  });
});
