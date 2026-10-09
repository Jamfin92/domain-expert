import { describe, it, expect } from "vitest";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { EntityGraph, type Call } from "@psq/schema";
import { extractDotnet } from "../src/dotnet.js";
import { parseCSharp } from "../src/csharp/structure.js";
import { collectCalls } from "../src/csharp/calls.js";

/**
 * The expectations for the fixture were written by reading the fixture files
 * and following the calls by hand; none was copied from psq's output. Lines are
 * lines of the fixture files: a node's line is its method's declaration (an
 * interface member's, for an interface), `at` is the call site.
 */
const ROUTES = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../test/fixtures/mini-aspnet-routes",
);

type Row = [from: string, to: string, at: number, ambiguous?: true];
const S = "Services";
const R = "Repositories";
const C = "Controllers";

const EXPECTED: Row[] = [
  // GadgetsController -> IGadgetService -> its one implementation
  [`${C}/GadgetsController.cs:GadgetsController.Get@20`, `${S}/IGadgetService.cs:IGadgetService.Assemble@5`, 20],
  [`${C}/GadgetsController.cs:GadgetsController.Get@20`, `${S}/GadgetService.cs:GadgetService.Assemble@17`, 20],
  [`${C}/GadgetsController.cs:GadgetsController.Retire@23`, `${S}/IGadgetService.cs:IGadgetService.Retire@6`, 25],
  [`${C}/GadgetsController.cs:GadgetsController.Retire@23`, `${S}/GadgetService.cs:GadgetService.Retire@24`, 25],
  // static `Chain.Step0()`, and `var calc = new Calculator(); calc.Add(`
  [`${C}/GadgetsController.cs:GadgetsController.Deep@30`, `${S}/Chain.cs:Chain.Step0@7`, 30],
  [`${C}/GadgetsController.cs:GadgetsController.Calc@33`, `${S}/Calculator.cs:Calculator.Add@7`, 36],
  // GadgetService -> repository interface -> its one implementation; bare calls
  [`${S}/GadgetService.cs:GadgetService.Assemble@17`, `${R}/IGadgetRepository.cs:IGadgetRepository.Load@7`, 19],
  [`${S}/GadgetService.cs:GadgetService.Assemble@17`, `${R}/GadgetRepository.cs:GadgetRepository.Load@15`, 19],
  [`${S}/GadgetService.cs:GadgetService.Assemble@17`, `${S}/GadgetService.cs:GadgetService.Rebalance@30`, 20],
  // INotifier has two implementations: both linked, both ambiguous
  [`${S}/GadgetService.cs:GadgetService.Retire@24`, `${S}/INotifier.cs:INotifier.Send@5`, 26],
  [`${S}/GadgetService.cs:GadgetService.Retire@24`, `${S}/Notifiers.cs:EmailNotifier.Send@7`, 26, true],
  [`${S}/GadgetService.cs:GadgetService.Retire@24`, `${S}/Notifiers.cs:SmsNotifier.Send@15`, 26, true],
  [`${S}/GadgetService.cs:GadgetService.Retire@24`, `${R}/IGadgetRepository.cs:IGadgetRepository.Remove@8`, 27],
  [`${S}/GadgetService.cs:GadgetService.Retire@24`, `${R}/GadgetRepository.cs:GadgetRepository.Remove@17`, 27],
  // the cycle
  [`${S}/GadgetService.cs:GadgetService.Rebalance@30`, `${S}/GadgetService.cs:GadgetService.Settle@35`, 32],
  [`${S}/GadgetService.cs:GadgetService.Settle@35`, `${S}/GadgetService.cs:GadgetService.Rebalance@30`, 37],
  // the repository: `Load(id)` is a bare call; `_db.Gadgets.Remove(` is chained and is NOT it
  [`${R}/GadgetRepository.cs:GadgetRepository.Remove@17`, `${R}/GadgetRepository.cs:GadgetRepository.Load@15`, 19],
  // a six-deep chain of bare calls, for the depth cap
  [`${S}/Chain.cs:Chain.Step0@7`, `${S}/Chain.cs:Chain.Step1@8`, 7],
  [`${S}/Chain.cs:Chain.Step1@8`, `${S}/Chain.cs:Chain.Step2@9`, 8],
  [`${S}/Chain.cs:Chain.Step2@9`, `${S}/Chain.cs:Chain.Step3@10`, 9],
  [`${S}/Chain.cs:Chain.Step3@10`, `${S}/Chain.cs:Chain.Step4@11`, 10],
  [`${S}/Chain.cs:Chain.Step4@11`, `${S}/Chain.cs:Chain.Step5@12`, 11],
];

const key = (s: { file: string; type: string; method: string; line: number }): string =>
  `${s.file}:${s.type}.${s.method}@${s.line}`;
const rowOf = (c: Call): Row =>
  c.ambiguous ? [key(c.from), key(c.to), c.line, true] : [key(c.from), key(c.to), c.line];
const norm = (rows: Row[]): string[] => rows.map((r) => JSON.stringify(r)).sort();

describe("C# call graph on the mini ASP.NET fixture", () => {
  const g = extractDotnet(ROUTES);
  // The fixture's older controllers add edges and unresolved counts of their
  // own; the hand-derived set below is the Gadgets chain, selected by file.
  const chain = (g.calls ?? []).filter(
    (c) =>
      c.from.file === `${C}/GadgetsController.cs` ||
      c.from.file.startsWith(`${S}/`) ||
      c.from.file.startsWith(`${R}/`),
  );

  it("reads exactly the hand-derived calls", () => {
    expect(norm(chain.map(rowOf))).toEqual(norm(EXPECTED));
  });

  it("links a lone implementation plainly, and several as ambiguous", () => {
    const flag = (typ: string): Array<boolean | undefined> =>
      chain.filter((c) => c.to.type === typ).map((c) => c.ambiguous);
    expect(flag("GadgetService")).toEqual([undefined, undefined, undefined, undefined, undefined]);
    expect(flag("GadgetRepository")).toEqual([undefined, undefined, undefined]);
    expect(flag("EmailNotifier")).toEqual([true]);
    expect(flag("SmsNotifier")).toEqual([true]);
    expect(flag("INotifier")).toEqual([undefined]);
  });

  it("counts what it could not resolve, per method, and guesses nothing", () => {
    const counts = Object.fromEntries(
      (g.unresolvedCalls ?? [])
        .filter((u) => u.file === `${C}/GadgetsController.cs` || u.file === `${R}/GadgetRepository.cs`)
        .map((u) => [`${u.type}.${u.method}`, u.count]),
    );
    expect(counts).toEqual({
      "GadgetsController.Get": 1, // Ok(
      "GadgetsController.Retire": 1, // Ok(
      "GadgetsController.Deep": 1, // Ok(
      "GadgetsController.Calc": 1, // Ok(
      "GadgetsController.Opaque": 3, // _log.LogInformation(, Ok(, Helpers.Format(
      "GadgetRepository.Load": 1, // _db.Gadgets.Find(  (chained)
      "GadgetRepository.Remove": 1, // _db.Gadgets.Remove(  (chained)
    });
    // the unresolved framework calls produced no edge
    expect(chain.some((c) => c.to.method === "Format" || c.to.method === "Find")).toBe(false);
  });

  it("emits no warning for any call, resolved or not", () => {
    expect(g.warnings.filter((w) => /call/i.test(w) && !/route|client call/i.test(w))).toEqual([]);
  });

  it("produces a graph the schema accepts, in a stable order", () => {
    expect(() => EntityGraph.parse(g)).not.toThrow();
    expect(extractDotnet(ROUTES).calls).toEqual(g.calls);
    expect(extractDotnet(ROUTES).unresolvedCalls).toEqual(g.unresolvedCalls);
  });
});

/** Calls for inline sources, one file each, rendered `Type.method->Type.method@line`. */
function callsOf(...sources: string[]): { edges: string[]; unresolved: Record<string, number> } {
  const parses = sources.map((s, i) => parseCSharp(s, `f${i}.cs`));
  const { calls, unresolved } = collectCalls(parses);
  return {
    edges: calls.map(
      (c) => `${c.from.type}.${c.from.method}->${c.to.type}.${c.to.method}@${c.line}${c.ambiguous ? "!" : ""}`,
    ),
    unresolved: Object.fromEntries(unresolved.map((u) => [`${u.type}.${u.method}`, u.count])),
  };
}

describe("call resolution rules", () => {
  it("types a receiver by its declaration: field, property, method parameter, primary-ctor parameter", () => {
    const r = callsOf(`
class Dep { public void Go() {} }
class A { private readonly Dep _d; void M() { _d.Go(); } }
class B { Dep D { get; set; } void M() { D.Go(); } }
class C { void M(Dep d) { d.Go(); } }
class E(Dep d) { void M() { d.Go(); } }
`);
    expect(r.edges).toEqual([
      "A.M->Dep.Go@3", "B.M->Dep.Go@4", "C.M->Dep.Go@5", "E.M->Dep.Go@6",
    ]);
  });

  it("follows this., this._field., ?. and a generic call", () => {
    const r = callsOf(`
class Dep { public void Go<T>() {} }
class A {
  private Dep _d;
  void N() {}
  void M() { this.N(); this._d.Go<int>(); _d?.Go<List<int>>(); }
}
`);
    // the two generic calls share a line, so they are one edge
    expect(r.edges).toEqual(["A.M->A.N@6", "A.M->Dep.Go@6"]);
  });

  it("types a local only when trivially: var x = new T(, or T x", () => {
    const r = callsOf(`
class Dep { public void Go() {} }
class A {
  void M() { var d = new Dep(); d.Go(); }
  void N() { Dep d = Make(); d.Go(); }
  void O() { var d = Make(); d.Go(); }
  Dep Make() => null;
}
`);
    expect(r.edges).toEqual([
      "A.M->Dep.Go@4", "A.N->A.Make@5", "A.N->Dep.Go@5", "A.O->A.Make@6",
    ]);
    // `var d = Make()` is untyped: `d.Go()` is counted, not resolved
    expect(r.unresolved).toEqual({ "A.O": 1 });
  });

  it("lets a local we cannot type shadow a field of the same name", () => {
    const r = callsOf(`
class Dep { public void Go() {} }
class A {
  private Dep _d;
  void M(string s) { foreach (var _d in s) { _d.Go(); } }
}
`);
    expect(r.edges).toEqual([]);
    expect(r.unresolved).toEqual({ "A.M": 1 });
  });

  it("resolves a static call only to a static method", () => {
    const r = callsOf(`
class U { public static void S() {} public void I() {} }
class A { void M() { U.S(); U.I(); } }
`);
    expect(r.edges).toEqual(["A.M->U.S@3"]);
    expect(r.unresolved).toEqual({ "A.M": 1 });
  });

  it("refuses a chained receiver and a type name declared twice", () => {
    const r = callsOf(
      `namespace One { class Dup { public void Go() {} } }`,
      `namespace Two { class Dup { public void Go() {} } }`,
      `class Dep { public Dup Other; public void Go() {} }
       class A { Dep _d; Dup _x; void M() { _d.Other.Go(); _x.Go(); _d.Go(); } }`,
    );
    expect(r.edges).toEqual(["A.M->Dep.Go@2"]);
    expect(r.unresolved).toEqual({ "A.M": 2 });
  });

  it("does not take another object's member for the receiver's own field", () => {
    const r = callsOf(`
class Mine { public void Go() {} }
class Theirs { public object Other; }
class A { Mine Other; Theirs _t; void M() { _t.Other.Go(); } }
`);
    expect(r.edges).toEqual([]);
    expect(r.unresolved).toEqual({ "A.M": 1 });
  });

  it("reads partial parts as one type and finds an inherited method", () => {
    const r = callsOf(
      `partial class P { void A() { B(); } }`,
      `partial class P { void B() {} }`,
      `class Base { protected Base2 _b; protected void Inh() {} }
       class Base2 { public void Go() {} }
       class Sub : Base { void M() { Inh(); _b.Go(); } }`,
    );
    expect(r.edges).toEqual(["P.A->P.B@1", "Sub.M->Base.Inh@3", "Sub.M->Base2.Go@3"]);
  });

  it("matches generic interfaces by their exact text, and links nothing across arguments", () => {
    const r = callsOf(`
interface IRepo<T> { void Save(); }
class WidgetRepo : IRepo<Widget> { public void Save() {} }
class GadgetRepo : IRepo<Gadget> { public void Save() {} }
class A { IRepo<Widget> _r; void M() { _r.Save(); } }
`);
    expect(r.edges).toEqual(["A.M->IRepo.Save@5", "A.M->WidgetRepo.Save@5"]);
  });

  it("finds an implementer through a derived interface and a base class", () => {
    const r = callsOf(`
interface IBase { void Do(); }
interface IMore : IBase { }
class Impl : IMore { public void Do() {} }
class Sub : Impl { }
class A { IBase _b; void M() { _b.Do(); } }
`);
    // Sub inherits Impl.Do: one distinct target, so not ambiguous
    expect(r.edges).toEqual(["A.M->IBase.Do@6", "A.M->Impl.Do@6"]);
  });

  it("does not take a local function or a constructor for a call", () => {
    const r = callsOf(`
class A {
  void Local() {}
  void M() { int Local() { return 1; } var x = Local(); var y = new A(); }
}
`);
    expect(r.edges).toEqual([]);
  });

  it("does not take await's operand for a declaration", () => {
    const r = callsOf(`
class A { void Go() {} async void M() { await Go(); } }
`);
    expect(r.edges).toEqual(["A.M->A.Go@2"]);
  });
});
