import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseCSharp } from "../src/csharp/structure.js";

import { corpusRepo } from "../../../test/fixtures.js";

const repoA = corpusRepo("repoA");

// Note: vitest executes even a skipped describe body during collection, so
// everything at describe scope must tolerate an absent corpus. The reads all
// happen inside the tests, which never run without it.
describe.skipIf(!repoA)("C# structural parser [corpus]", () => {
  const exp = (repoA?.expect.structure ?? {}) as import("../../../test/fixtures.js").CorpusStructureExpect;
  const root = repoA?.path ?? "";

  it("reads the Identity-derived DbContext and its expression-bodied DbSets", () => {
    const src = readFileSync(`${root}/${exp.contextFile}`, "utf8");
    const p = parseCSharp(src, exp.contextFile);

    expect(p.namespace).toBe(exp.namespace);
    expect(p.usings).toContain(exp.domainUsing);

    const ctx = p.types.find((t) => t.name === exp.contextType);
    expect(ctx).toBeDefined();
    // The base is IdentityDbContext<...>, not DbContext — matching `: DbContext`
    // alone finds nothing here.
    expect(ctx!.bases[0]).toBe(exp.contextBase);

    // Every DbSet is expression-bodied `=> Set<T>()`.
    const dbSets = ctx!.properties.filter((x) => x.type.startsWith("DbSet<"));
    expect(dbSets).toHaveLength(exp.dbSetCount);
    expect(dbSets.every((d) => d.expressionBodied)).toBe(true);
    expect(dbSets.map((d) => d.name)).toContain(exp.dbSetContains);

    // OnModelCreating must be captured with a non-empty body for fluent parsing.
    const onModel = ctx!.methods.find((m) => m.name === "OnModelCreating");
    expect(onModel).toBeDefined();
    expect(onModel!.body.length).toBeGreaterThan(100);

    expect(p.warnings).toEqual([]);
  });

  it("reads modern C# members that the 0.20 tree-sitter grammar rejects", () => {
    const src = readFileSync(`${root}/${exp.entityFile}`, "utf8");
    const p = parseCSharp(src, exp.entityFile);
    const e = p.types.find((t) => t.name === exp.entityType)!;

    const byName = (n: string) => e.properties.find((x) => x.name === n)!;

    // `required string` — C# 11
    const req = byName(exp.requiredProp.name);
    expect(req.modifiers).toContain("required");
    expect(req.type).toBe(exp.requiredProp.type);
    expect(req.attributes.map((a) => a.name)).toEqual(exp.requiredProp.attributes);
    expect(req.attributes[1]!.args).toEqual(exp.requiredProp.attrArgs);

    // nullable value type and nullable reference
    expect(byName(exp.nullableValueProp.name).type).toBe(exp.nullableValueProp.type);
    expect(byName(exp.nullableRefProp.name).type).toBe(exp.nullableRefProp.type);

    // collection expression initializer `= []` — C# 12
    expect(byName(exp.collectionProp.name).type).toBe(exp.collectionProp.type);
    expect(byName(exp.collectionProp.name).initializer).toBe(exp.collectionProp.initializer);

    // null-forgiving initializer must not swallow the next member
    for (const prop of exp.nullForgivingProps) {
      expect(byName(prop.name).type).toBe(prop.type);
    }

    expect(p.warnings).toEqual([]);
  });

  it("does not treat a static constants class as an entity shape", () => {
    const src = readFileSync(`${root}/${exp.constantsFile}`, "utf8");
    const p = parseCSharp(src, exp.constantsFile);
    for (const t of p.types) expect(t.modifiers).toContain("static");
  });
});

/**
 * Hermetic. The fixture tests cover the same ground end to end, but they
 * cannot say which half broke: an empty entity model looks identical whether
 * the header reader stopped early or the DbSet reader failed. These pin the
 * header reader itself.
 */
describe("base constructor argument lists", () => {
  it("reads the body and the full base list past `: Base(args)`", () => {
    const p = parseCSharp(
      "class C(int o) : DbContext(o), IThing { public DbSet<A> As => Set<A>(); void M(){} }",
      "T.cs",
    );
    const t = p.types[0]!;
    // Before the fix: bases ["DbContext"], properties ["o"], methods [].
    // `contextName` still resolved off that first base, which is exactly why
    // the failure was silent.
    expect(t.bases).toEqual(["DbContext", "IThing"]);
    expect(t.properties.map((x) => `${x.name}:${x.type}`)).toEqual(["o:int", "As:DbSet<A>"]);
    expect(t.methods.map((m) => m.name)).toEqual(["M"]);
    expect(p.warnings).toEqual([]);
  });

  it("does the same for a record, which is not a separate code path", () => {
    const p = parseCSharp(
      'record R(int Id) : Base(Id) { public string X { get; set; } }',
      "T.cs",
    );
    const t = p.types[0]!;
    expect(t.bases).toEqual(["Base"]);
    expect(t.properties.map((x) => x.name)).toEqual(["Id", "X"]);
    expect(p.warnings).toEqual([]);
  });

  it("leaves a correctly terminated bodyless declaration silent", () => {
    const p = parseCSharp("record R(int Id) : Base(Id);", "T.cs");
    expect(p.types[0]!.properties.map((x) => x.name)).toEqual(["Id"]);
    expect(p.warnings).toEqual([]);
  });

  it("keeps `abstract` in modifiers, which the zero-entity warning reads", () => {
    // dotnet.ts skips the zero-entity warning for an abstract context; that
    // depends on this modifier surviving the header reader.
    const p = parseCSharp("abstract class BaseContext : DbContext { }", "T.cs");
    expect(p.types[0]!.modifiers).toContain("abstract");
    expect(p.warnings).toEqual([]);
  });
});

describe("unterminated type headers", () => {
  it("warns instead of emitting a truncated type silently", () => {
    // `global::` is valid C# the reader does not consume. It stops at the
    // `::`, so the body is never entered.
    const p = parseCSharp(
      "class C : global::N.Base { public int X { get; set; } public int Y { get; set; } }",
      "T.cs",
    );
    expect(p.types[0]!.properties).toEqual([]);
    expect(p.warnings).toHaveLength(1);
    expect(p.warnings[0]).toContain("type C header not terminated");
    expect(p.warnings[0]).toContain("stopped at '::'");
  });

  it("also catches a base whose generic arguments close with `>>`", () => {
    const p = parseCSharp(
      "class C : Dictionary<string, List<int>> { public int X { get; set; } }",
      "T.cs",
    );
    expect(p.warnings.some((w) => /header not terminated/.test(w))).toBe(true);
  });
});

describe("D-Hb-10: expression-bodied method bodies are captured", () => {
  // Inline sources, no `corpusRepo`, no `skipIf`: these run under
  // PSQ_NO_CORPUS=1. Before H-e this branch pushed `body: []` and the suite
  // was green both with and without the fix, in every configuration.

  /** The tokens of the single method in a one-class source. */
  const bodyOf = (src: string, name = "M"): string[] => {
    const p = parseCSharp(src, "T.cs");
    const m = p.types[0]!.methods.find((x) => x.name === name)!;
    return m.body.map((t) => t.text);
  };

  it("captures a plain expression body at all", () => {
    // The base case. `body: []` fails here; nothing else in this describe is
    // meaningful without it.
    expect(bodyOf("class C { public int M() => Head + Tail; }")).toEqual(["Head", "+", "Tail"]);
  });

  it("leaves a well-formed expression body silent", () => {
    // The warning branch added below must not fire on ordinary input. Paired
    // with the malformed case further down, which is the same assertion in
    // the other direction.
    const p = parseCSharp("class C { public int M() => Head + Tail; }", "T.cs");
    expect(p.warnings).toEqual([]);
  });

  // The gating class is NOT one construct, which is what the inherited record
  // said. It is any expression-bodied member whose expression holds a
  // statement lambda or block literal containing a `;`. Three diverging
  // shapes, all of which lose `Tail` to a depth-less scan:

  it("shape 1: a statement lambda argument with its own `;`", () => {
    const b = bodyOf("class C { public object M() => Run(() => { int n = 0; return n; }, Tail); }");
    expect(b).toContain("Tail");
    expect(b.filter((t) => t === ";")).toHaveLength(2);
  });

  it("shape 2: statement lambdas nested two deep", () => {
    const b = bodyOf("class C { public object M() => A(() => { B(() => { int x = 0; }); }, Tail); }");
    expect(b).toContain("Tail");
  });

  it("shape 3: a `;`-bearing lambda inside a collection/object initializer", () => {
    const b = bodyOf("class C { public object M() => new Box { Value = Go(() => { int i = 0; }), Tag = Tail }; }");
    expect(b).toContain("Tail");
  });

  it("and the member list after such a method is EXACTLY right", () => {
    // Round 2 deleted a test here on the grounds that the depth-less scan
    // could not disturb the following members, and called that "unreachable".
    // Round 3 measured that it is reachable — in the other direction. The
    // round-2 reasoning only ruled out member LOSS; a member-list assertion
    // reddens just as well on member GAIN.
    //
    // `Local` is a local function inside the statement lambda — legal C# 7+.
    // MEASURED on this exact source:
    //   shipped         methods ["M","Z"]          (the lambda stays inside M)
    //   M6 depth-less   methods ["M","Local","Z"]  (resumes inside the lambda)
    //   pre-H-e HEAD    methods ["M","Local","Z"]  (same, and `Local` even
    //                   carries a body, so refs inside it were attributed to
    //                   a member the type does not have — see the note below)
    //   M11 resume      methods ["M"], props []    (`i = to` swallows the rest)
    //
    // M11 reddens THIS TEST AND NOTHING ELSE in the whole suite. Until it was
    // written, no hermetic test asserted that the reader resumes correctly
    // after a SUCCESSFULLY captured expression body — the one piece of control
    // flow change A adds on the success path.
    //
    // NOT reddened by M1 as that mutant is written: M1 blanks the captured
    // body but leaves the depth-tracked scan and the resume point intact, so
    // the member list is unchanged. Recorded because the round-3 instruction
    // predicted otherwise and the measurement says no.
    const p = parseCSharp(
      "class C { public object M() => A(() => { Local(); void Local() { c(); } }, Tail);\n" +
        "          public int After { get; set; } public void Z() { Body; } }",
      "T.cs",
    );
    expect(p.types[0]!.methods.map((m) => m.name)).toEqual(["M", "Z"]);
    expect(p.types[0]!.properties.map((x) => x.name)).toEqual(["After"]);
    expect(p.warnings).toEqual([]);
  });

  it("a local function inside the lambda stays INSIDE the enclosing body", () => {
    // The latent bug change A silently fixes, recorded because nothing in the
    // plan, the measurement or round 1-2 of the audit mentions it.
    //
    // MEASURED against HEAD: the pre-H-e reader resumed at the local
    // function's `;`, emitted `Local` as a CLASS METHOD with a real body
    // (["Course","c","=","null","!",";"]), and so attributed every ref inside
    // it to `type: "C", method: "Local"` — a member the type does not have.
    // After change A the lambda, local function and all, stays inside `M`.
    //
    // So on THIS shape depth tracking is not defensive, it is CORRECTIVE.
    // That is a real exception to the "defensive only" finding recorded
    // elsewhere, and it is consistent with the corpus diff being +6/-0: no
    // corpus repo contains the shape.
    const p = parseCSharp(
      "class C { public object M() => A(() => { Local(); void Local() { Course c = null!; } }, Tail); }",
      "T.cs",
    );
    expect(p.types[0]!.methods.map((m) => m.name)).toEqual(["M"]);
    expect(p.types[0]!.methods[0]!.body.map((t) => t.text)).toContain("Course");
  });

  // Round 2's deletion note, corrected and kept because the correction is the
  // useful part:
  //
  // What IS true, measured in round 3 over 150 well-formed shapes (30
  // expression bodies x 5 trailing-member arrangements) against shipped, M6
  // and pre-H-e HEAD: **0 of 150 LOSE a member** under either older reader.
  // A stray `}` at member scope is skipped wholesale (`structure.ts:253`) and
  // the member loop's bound `to` comes from an independent balanced match, so
  // leftover closers cannot end a class early.
  //
  // And what round 2 missed: **10 of 150 GAIN one** — expressions 22 and 23 of
  // that sweep, the two local-function shapes, across all five trailing-member
  // arrangements. Both older readers agree with each other and differ from
  // shipped. A member-list assertion reddens on gain exactly as well as on
  // loss, which is why the test above is a real gate.
  //
  // What round 2 wrongly concluded from that: "no input can do better",
  // "unreachable", "coverage cost: none". All three were false. Member GAIN
  // is reachable, it is what the test above pins, and until round 3 nothing
  // hermetic asserted that the reader resumes correctly after a SUCCESSFULLY
  // captured expression body — the one piece of control flow change A adds on
  // the success path. `Terse.Roster` is the only expression-bodied method in
  // any hermetic C# fixture and the member after it contributes no refs, so
  // breaking the resume moved nothing anywhere.
});

describe("the terminator-not-found fallback on a malformed expression body", () => {
  // MEASURED before it was written, not predicted: on this exact source the
  // depth-tracked scan WITHOUT a fallback loses a property and a method and
  // says nothing at all — worse than the code it replaced. The unbalanced `(`
  // wedges the depth counter, the scan runs off the end of the class, and the
  // reader resumes past the closing brace.
  const MALFORMED =
    "class C { public int A() => F(1; public int B { get; set; } public void Z() { Body; } }";

  it("keeps parsing the members that follow, as the pre-H-e reader did", () => {
    // M2: delete the fallback and this is 1 method / 0 properties.
    const p = parseCSharp(MALFORMED, "T.cs");
    expect(p.types[0]!.methods.map((m) => m.name)).toEqual(["A", "Z"]);
    expect(p.types[0]!.properties.map((x) => x.name)).toEqual(["B"]);
    // And the unterminated body itself is EMPTY, not a guess at where it
    // ended — rule 3: warn, never guess.
    expect(p.types[0]!.methods.find((m) => m.name === "A")!.body).toEqual([]);
  });

  it("and says so, rather than dropping the body silently", () => {
    // M3: keep the fallback, delete its warning push, and only this reddens.
    // The pre-H-e reader was silent here, unlike both unbalanced-brace
    // branches beside it; `psq graph` prints warnings and rule 3 makes a new
    // one a bug rather than noise.
    const p = parseCSharp(MALFORMED, "T.cs");
    expect(p.warnings).toHaveLength(1);
    expect(p.warnings[0]).toContain("T.cs:1:");
    expect(p.warnings[0]).toContain("expression body for method A not terminated");
  });
});
