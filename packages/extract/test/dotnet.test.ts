import { describe, it, expect } from "vitest";
import { extractDotnet } from "../src/dotnet.js";

import { corpusRepo, NOT_A_PROJECT, type CorpusDotnetExpect } from "../../../test/fixtures.js";

const repoA = corpusRepo("repoA");
const repoB = corpusRepo("repoB");
const repoC = corpusRepo("repoC");

// Note: vitest executes even a skipped describe body during collection, so
// everything at describe scope must tolerate an absent corpus.
describe.skipIf(!repoA)("EF Core extraction [corpus]", () => {
  const exp: CorpusDotnetExpect = repoA?.expect.dotnet ?? {};
  const g = extractDotnet(repoA?.path ?? NOT_A_PROJECT);

  it("finds the Identity-derived context and its domain entities", () => {
    // Ground truth: the repo's EF migration snapshot declares `entityCount`
    // distinct domain entities = (entityCount - 1) DbSets + the Identity user,
    // which reaches the model only as IdentityDbContext's first type argument.
    expect(g.contextName).toBe(exp.contextName);
    expect(g.entities).toHaveLength(exp.entityCount!);
    expect(g.entities.map((e) => e.name)).toContain(exp.identityEntity);
    expect(g.entities.find((e) => e.name === exp.identityEntity)!.dbSetName).toBeNull();
    // The static constants class must not be mistaken for an entity.
    expect(g.entities.map((e) => e.name)).not.toContain(exp.notAnEntity);
  });

  it("matches the migration snapshot's relationship count", () => {
    // The snapshot's HasForeignKey calls, minus the ones belonging to the
    // Identity join tables (RoleClaim, UserClaim, UserLogin, UserRole x2,
    // UserToken), leave `relationCount` in the domain model.
    expect(g.relations).toHaveLength(exp.relationCount!);
    // One navigation, one relationship: one entity's navigation is keyed by a
    // foreign key that does not follow the `<Nav>Id` convention, so a
    // name-based convention pass would add a second, foreign-key-less
    // duplicate.
    const dup = g.relations.filter(
      (r) => r.dependent === exp.navDup!.dependent && r.principal === exp.navDup!.principal,
    );
    expect(dup).toHaveLength(1);
    expect(dup[0]!.foreignKeyProperty).toBe(exp.navDup!.foreignKey);
  });

  it("uses EF table naming, including AspNetUsers for the Identity entity", () => {
    const tables = new Map(g.entities.map((e) => [e.name, e.tableName]));
    for (const [entity, table] of exp.tableNames!) {
      expect(tables.get(entity)).toBe(table);
    }
  });

  it("includes members inherited from IdentityUser", () => {
    const user = g.entities.find((e) => e.name === exp.identityEntity)!;
    const names = user.properties.map((p) => p.name);
    expect(user.keys).toEqual(["Id"]);
    for (const member of exp.identityMembers!) expect(names).toContain(member);
    expect(user.properties.find((p) => p.name === "Id")!.type).toBe(exp.identityKeyType);
  });

  it("reads keys, including a composite key", () => {
    expect(g.entities.find((e) => e.name === exp.compositeKey!.entity)!.keys)
      .toEqual(exp.compositeKey!.keys);
    expect(g.entities.find((e) => e.name === exp.singleKey!.entity)!.keys)
      .toEqual(exp.singleKey!.keys);
  });

  it("reads property facets from attributes and fluent config", () => {
    const entity = g.entities.find((e) => e.name === exp.facets!.entity)!;
    const capped = entity.properties.find((p) => p.name === exp.facets!.maxLengthProp.name)!;
    expect(capped.maxLength).toBe(exp.facets!.maxLengthProp.maxLength);
    expect(capped.nullable).toBe(false);

    const nullable = entity.properties.find((p) => p.name === exp.facets!.nullableProp)!;
    expect(nullable.nullable).toBe(true);

    const coll = entity.properties.find((p) => p.name === exp.facets!.collectionProp.name)!;
    expect(coll.isCollection).toBe(true);
    expect(coll.isNavigation).toBe(true);
    expect(coll.baseType).toBe(exp.facets!.collectionProp.baseType);

    const precise = g.entities
      .find((e) => e.name === exp.facets!.precisionProp.entity)!
      .properties.find((p) => p.name === exp.facets!.precisionProp.name)!;
    expect(precise.precision).toEqual(exp.facets!.precisionProp.precision);
  });

  it("resolves relationships and marks foreign keys", () => {
    const rel = g.relations.find(
      (r) => r.dependent === exp.relation!.dependent && r.principal === exp.relation!.principal,
    )!;
    expect(rel.cardinality).toBe("one-to-many");
    expect(rel.foreignKeyProperty).toBe(exp.relation!.foreignKey);
    expect(rel.principalNavigation).toBe(exp.relation!.principalNavigation);
    expect(rel.dependentNavigation).toBe(exp.relation!.dependentNavigation);

    const fk = g.entities
      .find((e) => e.name === exp.relation!.dependent)!
      .properties.find((p) => p.name === exp.relation!.foreignKey)!;
    expect(fk.isForeignKey).toBe(true);
  });

  it("derives delete behavior from convention when no OnDelete is written", () => {
    // The repo declares zero OnDelete calls; every value must therefore be
    // marked as convention-derived, never presented as written source.
    expect(g.relations.every((r) => r.deleteBehaviorSource === "convention")).toBe(true);
    const optional = g.relations.find(
      (r) =>
        r.dependent === exp.optionalRelation!.dependent &&
        r.principal === exp.optionalRelation!.principal,
    )!;
    expect(optional.required).toBe(false);
    expect(optional.deleteBehavior).toBe(exp.optionalRelation!.deleteBehavior);
  });

  it("parses the whole repo without warnings", () => {
    expect(g.warnings).toEqual([]);
  });
});

describe.skipIf(!repoB)("shadow-class disambiguation [corpus]", () => {
  const exp: CorpusDotnetExpect = repoB?.expect.dotnet ?? {};
  const g = extractDotnet(repoB?.path ?? NOT_A_PROJECT);

  it("keeps only the entities the context imports", () => {
    // The repo declares stale siblings of its Models/Entities/* classes under
    // Models/*. Only the namespace the context imports counts.
    expect(g.entities).toHaveLength(exp.entityCount!);
    const shadow = g.entities.find((e) => e.name === exp.shadowEntity!.name)!;
    expect(shadow.namespace).toBe(exp.shadowEntity!.namespace);
    expect(shadow.file).toContain(exp.shadowEntity!.fileContains);
  });

  it("reads explicitly declared cascade behavior", () => {
    const cascades = g.relations.filter((r) => r.deleteBehaviorSource === "fluent");
    // Aggregate over a live repo: a floor, not an exact count.
    expect(cascades.length).toBeGreaterThanOrEqual(exp.cascade!.count);
    expect(cascades.every((r) => r.deleteBehavior === exp.cascade!.behavior)).toBe(true);
  });
});

describe.skipIf(!repoC)("negative fixture [corpus]", () => {
  it("reports zero entities for a backend with no ORM, without throwing", () => {
    const g = extractDotnet(repoC!.path);
    expect(g.entities).toEqual([]);
    expect(g.relations).toEqual([]);
    expect(g.contextName).toBeNull();
  });
});
