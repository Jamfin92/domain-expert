import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractDotnet } from "@psq/extract";
import { invariants } from "@psq/graph";
import { MINI_EFCORE_PRIMARY_CTOR, MINI_EFCORE_EMPTY_CONTEXT } from "./fixtures.js";

/**
 * The end-to-end half of the base-constructor-argument-list fix. A base
 * argument list — `: DbContext(options)` — used to stop the header reader at
 * the `(`, so the context reached the graph with no DbSets and no
 * OnModelCreating while `contextName` still resolved. The graph came back with
 * zero entities, zero relations and zero warnings: a silent wrong answer,
 * indistinguishable from a repo that genuinely has no entity model.
 */
describe("mini EF fixture with primary constructors and base arguments", () => {
  const g = extractDotnet(MINI_EFCORE_PRIMARY_CTOR);

  it("extracts a clean graph", () => {
    expect(g.contextName).toBe("LibraryDbContext");
    expect(g.warnings).toEqual([]);
    expect(invariants(g)).toEqual([]);
  });

  it("reads the DbSets through `: DbContext(options), ILibraryContext`", () => {
    // Was 0 entities before the fix, with no warning.
    expect(g.entities.map((e) => e.name).sort()).toEqual(["Author", "Book", "Loan"]);
    const sets = new Map(g.entities.map((e) => [e.name, e.dbSetName]));
    expect(sets.get("Author")).toBe("Authors"); // => Set<Author>()
    expect(sets.get("Book")).toBe("Books"); // { get; set; }
  });

  it("finds OnModelCreating past the base argument list", () => {
    // Was 0 relations: `methods` was empty, so OnModelCreating never existed.
    const byId = new Map(g.relations.map((r) => [`${r.dependent}->${r.principal}`, r]));
    expect([...byId.keys()].sort()).toEqual(["Book->Author", "Loan->Book"]);
    expect(byId.get("Book->Author")!.deleteBehavior).toBe("Restrict");
    expect(byId.get("Book->Author")!.deleteBehaviorSource).toBe("fluent");
    expect(byId.get("Loan->Book")!.deleteBehavior).toBe("Cascade");
  });

  it("keeps a record's body members, not just its positional parameters", () => {
    const summary = g.shapes.find((s) => s.name === "BookSummaryDto")!;
    expect(summary.fields.map((f) => f.name).sort()).toEqual([
      "AuthorName", "Id", "LoanCount", "Title",
    ]);
  });

  it("lets an explicit ToTable beat the DbSet name", () => {
    // The only other ToTable assertion in the suite is corpus-gated, so
    // without this the rule has no coverage on a clean checkout.
    const byName = new Map(g.entities.map((e) => [e.name, e.tableName]));
    expect(byName.get("Loan")).toBe("Loan Records"); // not "Loans"
    expect(byName.get("Book")).toBe("Books"); // no ToTable: the DbSet name
  });

  it("keeps an interface listed after the base argument list", () => {
    // `: ReportBase(id), ITimestamped` used to yield bases ["ReportBase"].
    // That is what breaks Identity detection on a real repo.
    const report = g.shapes.find((s) => s.name === "LoanReportDto")!;
    expect(report.fields.map((f) => f.name).sort()).toEqual([
      "OverdueCount", "TotalFees", "UpdatedAt", "id",
    ]);
  });
});

/**
 * The positive control. A warning never triggered in a test is a warning that
 * may not work — a negative gate ("no warnings on the clean fixtures") passes
 * just as happily when the warning is dead code.
 */
describe("mini EF fixture whose model is empty", () => {
  const g = extractDotnet(MINI_EFCORE_EMPTY_CONTEXT);

  it("warns that a type header was never terminated, rather than truncating silently", () => {
    // WidgetDto derives from a `global::`-qualified base, which the reader
    // does not consume. Its three properties are lost; before the warning it
    // then fell under MIN_PROPERTIES and vanished from the graph entirely.
    const hit = g.warnings.find((w) => /header not terminated/.test(w));
    expect(hit).toBeDefined();
    expect(hit).toContain("WidgetDto");
    expect(hit).toContain("stopped at '::'");
    expect(g.shapes.find((s) => s.name === "WidgetDto")).toBeUndefined();
  });

  it("warns that the selected context contributed no entities", () => {
    expect(g.contextName).toBe("EmptyDbContext");
    expect(g.entities).toEqual([]);
    expect(
      g.warnings.some((w) => /EmptyDbContext contributed no entities/.test(w)),
    ).toBe(true);
  });

  it("says exactly those two things and nothing else", () => {
    expect(g.warnings).toHaveLength(2);
  });
});

/**
 * The `abstract` skip on the zero-entity warning, which no fixture directory
 * can cover: a second context in either fixture makes `contexts.length === 2`
 * and fires the multiple-DbContext warning instead, breaking that fixture's
 * warning-count assertion. A throwaway tree keeps it hermetic without adding
 * a third fixture.
 *
 * Case (b) is what makes the skip load-bearing rather than merely defensive.
 * `findContexts` matches only classes whose OWN bases name DbContext, so the
 * derived context is never seen at all and the abstract base IS the selected
 * `ctx`. Without the skip, that entirely normal .NET layout warns every time.
 */
describe("an abstract base context is not warned about", () => {
  let root = "";
  const write = (rel: string, src: string): void => {
    const full = join(root, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, src, "utf8");
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "psq-abstract-ctx-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("(a) alone, with no DbSets at all", () => {
    write(
      "Data/BaseContext.cs",
      [
        "using Microsoft.EntityFrameworkCore;",
        "namespace Abs.Data;",
        "public abstract class BaseContext(DbContextOptions options) : DbContext(options)",
        "{",
        "}",
      ].join("\n"),
    );
    const g = extractDotnet(root);
    expect(g.contextName).toBe("BaseContext");
    expect(g.entities).toEqual([]);
    expect(g.warnings).toEqual([]);
  });

  it("(b) with a derived context holding the DbSets", () => {
    write(
      "Data/BaseContext.cs",
      [
        "using Microsoft.EntityFrameworkCore;",
        "namespace Abs.Data;",
        "public abstract class BaseContext(DbContextOptions options) : DbContext(options)",
        "{",
        "}",
      ].join("\n"),
    );
    write(
      "Data/AppDbContext.cs",
      [
        "using Microsoft.EntityFrameworkCore;",
        "using Abs.Models;",
        "namespace Abs.Data;",
        "public class AppDbContext : BaseContext",
        "{",
        "    public DbSet<Thing> Things { get; set; }",
        "}",
      ].join("\n"),
    );
    write(
      "Models/Thing.cs",
      [
        "namespace Abs.Models;",
        "public class Thing",
        "{",
        "    public int Id { get; set; }",
        "    public string Name { get; set; } = \"\";",
        "}",
      ].join("\n"),
    );
    const g = extractDotnet(root);
    // The derived context is invisible to findContexts (its own base is
    // BaseContext, not DbContext), so the abstract base is the selected ctx
    // and contributes nothing. That must stay silent.
    expect(g.contextName).toBe("BaseContext");
    expect(g.entities).toEqual([]);
    expect(g.warnings).toEqual([]);
  });
});
