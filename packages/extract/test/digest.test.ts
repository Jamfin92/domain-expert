import { describe, it, expect, afterEach } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { digestOf, walk, repoRelative, DIGEST_EXTENSIONS } from "../src/files.js";

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

  it("A6 control: the rename cases really are byte-identical", () => {
    // If a rename helper silently changed the bytes, the rename tests above
    // would pass for the wrong reason and stop separating the two designs.
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
});
