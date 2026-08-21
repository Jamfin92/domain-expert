import { describe, it, expect } from "vitest";
import { extractDotnet } from "../src/dotnet.js";

import { CORPUS, hasCorpus } from "../../../test/fixtures.js";

const PP = CORPUS.corpus-repo-a;
const BI = CORPUS.corpus-repo-b;
const NEG = CORPUS.corpus-repo-c;

describe.skipIf(!hasCorpus(PP))("EF Core extraction [corpus]", () => {
  const g = extractDotnet(PP);

  it("finds the Identity-derived context and its 17 domain entities", () => {
    // Ground truth: AppDbContextModelSnapshot.cs declares 17 distinct
    // corpus-repo-a.Api.Models.Domain.* entities = 16 DbSets + User, which
    // reaches the model only as IdentityDbContext's first type argument.
    expect(g.contextName).toBe("AppDbContext");
    expect(g.entities).toHaveLength(17);
    expect(g.entities.map((e) => e.name)).toContain("User");
    expect(g.entities.find((e) => e.name === "User")!.dbSetName).toBeNull();
    // The static constants class must not be mistaken for an entity.
    expect(g.entities.map((e) => e.name)).not.toContain("FormTemplateStatus");
  });

  it("matches the migration snapshot's relationship count", () => {
    // AppDbContextModelSnapshot.cs has 26 HasForeignKey calls; 6 belong to the
    // Identity join tables (RoleClaim, UserClaim, UserLogin, UserRole x2,
    // UserToken), leaving 20 in the domain model.
    expect(g.relations).toHaveLength(20);
    // One navigation, one relationship: ApplicationDocument.LicenseApplication
    // is keyed by ApplicationId, so a name-based convention pass would add a
    // second, foreign-key-less duplicate.
    const dup = g.relations.filter(
      (r) => r.dependent === "ApplicationDocument" && r.principal === "LicenseApplication",
    );
    expect(dup).toHaveLength(1);
    expect(dup[0]!.foreignKeyProperty).toBe("ApplicationId");
  });

  it("uses EF table naming, including AspNetUsers for the Identity entity", () => {
    const tables = new Map(g.entities.map((e) => [e.name, e.tableName]));
    expect(tables.get("County")).toBe("Counties");
    expect(tables.get("FeedbackEntry")).toBe("FeedbackEntries");
    expect(tables.get("User")).toBe("AspNetUsers");
  });

  it("includes members inherited from IdentityUser", () => {
    const user = g.entities.find((e) => e.name === "User")!;
    const names = user.properties.map((p) => p.name);
    expect(user.keys).toEqual(["Id"]);
    expect(names).toContain("Email");
    expect(names).toContain("PasswordHash");
    expect(names).toContain("FirstName");
    expect(user.properties.find((p) => p.name === "Id")!.type).toBe("Guid");
  });

  it("reads keys, including the composite key on UserCounty", () => {
    expect(g.entities.find((e) => e.name === "UserCounty")!.keys).toEqual([
      "UserId", "CountyId",
    ]);
    expect(g.entities.find((e) => e.name === "County")!.keys).toEqual(["Id"]);
  });

  it("reads property facets from attributes and fluent config", () => {
    const la = g.entities.find((e) => e.name === "LicenseApplication")!;
    const conf = la.properties.find((p) => p.name === "ConfirmationNumber")!;
    expect(conf.maxLength).toBe(20);
    expect(conf.nullable).toBe(false);

    const formData = la.properties.find((p) => p.name === "FormData")!;
    expect(formData.nullable).toBe(true);

    const docs = la.properties.find((p) => p.name === "ApplicationDocuments")!;
    expect(docs.isCollection).toBe(true);
    expect(docs.isNavigation).toBe(true);
    expect(docs.baseType).toBe("ApplicationDocument");

    const fee = g.entities
      .find((e) => e.name === "LicenseType")!
      .properties.find((p) => p.name === "ApplicationFee")!;
    expect(fee.precision).toEqual([10, 2]);
  });

  it("resolves relationships and marks foreign keys", () => {
    const dept = g.relations.find(
      (r) => r.dependent === "Department" && r.principal === "County",
    )!;
    expect(dept.cardinality).toBe("one-to-many");
    expect(dept.foreignKeyProperty).toBe("CountyId");
    expect(dept.principalNavigation).toBe("Departments");
    expect(dept.dependentNavigation).toBe("County");

    const fk = g.entities
      .find((e) => e.name === "Department")!
      .properties.find((p) => p.name === "CountyId")!;
    expect(fk.isForeignKey).toBe(true);
  });

  it("derives delete behavior from convention when no OnDelete is written", () => {
    // corpus-repo-a declares zero OnDelete calls; every value must therefore
    // be marked as convention-derived, never presented as written source.
    expect(g.relations.every((r) => r.deleteBehaviorSource === "convention")).toBe(true);
    const optional = g.relations.find(
      (r) => r.dependent === "LicenseApplication" && r.principal === "FormTemplate",
    )!;
    expect(optional.required).toBe(false);
    expect(optional.deleteBehavior).toBe("ClientSetNull");
  });

  it("parses the whole repo without warnings", () => {
    expect(g.warnings).toEqual([]);
  });
});

describe.skipIf(!hasCorpus(BI))("shadow-class disambiguation [corpus]", () => {
  const g = extractDotnet(BI);

  it("keeps only the entities the context imports", () => {
    // Models/CreditLine.cs and Models/Payment.cs are stale siblings of the
    // Models/Entities/* classes. Only the namespace the context imports counts.
    expect(g.entities).toHaveLength(9);
    const cl = g.entities.find((e) => e.name === "CreditLine")!;
    expect(cl.namespace).toBe("corpus-repo-b.Api.Models.Entities");
    expect(cl.file).toContain("Models/Entities/CreditLine.cs");
  });

  it("reads explicitly declared cascade behavior", () => {
    const cascades = g.relations.filter((r) => r.deleteBehaviorSource === "fluent");
    expect(cascades.length).toBe(7);
    expect(cascades.every((r) => r.deleteBehavior === "Cascade")).toBe(true);
  });
});

describe.skipIf(!hasCorpus(NEG))("negative fixture [corpus]", () => {
  it("reports zero entities for a backend with no ORM, without throwing", () => {
    const g = extractDotnet(NEG);
    expect(g.entities).toEqual([]);
    expect(g.relations).toEqual([]);
    expect(g.contextName).toBeNull();
  });
});
