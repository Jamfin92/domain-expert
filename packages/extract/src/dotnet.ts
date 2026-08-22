import { readFileSync } from "node:fs";
import type {
  DeleteBehavior, Entity, EntityGraph, FactSource, Index, Property, Relation,
} from "@psq/schema";
import { parseCSharp, type FileParse, type PropertyDecl, type TypeDecl } from "./csharp/structure.js";
import { entityConfigs, enumMemberArg, lambdaMembers, type EntityConfig } from "./csharp/fluent.js";
import { repoRelative, walk } from "./files.js";
import { csharpShapes } from "./csharp/shapes.js";
import { pairShapes } from "./pair.js";

/** Collection types EF treats as a "many" navigation. */
const COLLECTIONS = new Set([
  "ICollection", "IList", "List", "IEnumerable", "HashSet", "ISet",
  "IReadOnlyCollection", "IReadOnlyList", "Collection",
]);

/** Strip nullability and unwrap a collection wrapper: "ICollection<Order>?" -> "Order". */
function unwrap(type: string): { base: string; isCollection: boolean; nullable: boolean } {
  let t = type.trim();
  let nullable = false;
  if (t.endsWith("?")) {
    nullable = true;
    t = t.slice(0, -1);
  }
  if (t.endsWith("[]")) return { base: t.slice(0, -2), isCollection: true, nullable };
  const lt = t.indexOf("<");
  if (lt > 0 && t.endsWith(">")) {
    const outer = t.slice(0, lt);
    const inner = t.slice(lt + 1, -1);
    if (COLLECTIONS.has(outer)) {
      // take the last type argument (handles IDictionary<K,V> loosely)
      const parts = splitTop(inner);
      const last = parts[parts.length - 1] ?? inner;
      const u = unwrap(last);
      return { base: u.base, isCollection: true, nullable: nullable || u.nullable };
    }
  }
  // drop any namespace qualification
  const dot = t.lastIndexOf(".");
  if (dot > 0 && !t.includes("<")) t = t.slice(dot + 1);
  return { base: t, isCollection: false, nullable };
}

/** Split a generic argument list on top-level commas. */
function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const c of s) {
    if (c === "<") depth++;
    if (c === ">") depth--;
    if (c === "," && depth === 0) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  if (cur) out.push(cur);
  return out;
}

/** C# value types that are non-nullable unless marked with `?`. */
const VALUE_TYPES = new Set([
  "int", "long", "short", "byte", "sbyte", "uint", "ulong", "ushort",
  "bool", "char", "decimal", "double", "float", "Guid", "DateTime",
  "DateTimeOffset", "TimeSpan", "DateOnly", "TimeOnly",
]);

function isScalar(base: string): boolean {
  return VALUE_TYPES.has(base) || base === "string" || base === "byte[]" || base === "object";
}

/**
 * Members ASP.NET Core Identity puts on IdentityUser<TKey>. corpus-repo-a's
 * User declares none of them — including its primary key — yet they are real
 * columns. Without them a "which is NOT a property of User" question could
 * offer `Email` as a wrong answer when `Email` genuinely is one.
 */
const IDENTITY_USER_MEMBERS: ReadonlyArray<readonly [string, string]> = [
  ["UserName", "string?"], ["NormalizedUserName", "string?"],
  ["Email", "string?"], ["NormalizedEmail", "string?"],
  ["EmailConfirmed", "bool"], ["PasswordHash", "string?"],
  ["SecurityStamp", "string?"], ["ConcurrencyStamp", "string?"],
  ["PhoneNumber", "string?"], ["PhoneNumberConfirmed", "bool"],
  ["TwoFactorEnabled", "bool"], ["LockoutEnd", "DateTimeOffset?"],
  ["LockoutEnabled", "bool"], ["AccessFailedCount", "int"],
];

const IDENTITY_BASES = new Set(["IdentityUser", "IdentityRole"]);

function synthetic(name: string, type: string): PropertyDecl {
  return {
    name, type, attributes: [], modifiers: [], line: 0,
    expressionBodied: false, initializer: null,
  };
}

/**
 * Every property an entity has, including those inherited from a base class.
 * Repo-local bases are resolved from the parse; framework bases fall back to
 * the known Identity member list above.
 */
function withInheritedProperties(
  decl: TypeDecl,
  byName: Map<string, { decl: TypeDecl; parse: FileParse }[]>,
  warnings: string[],
  depth = 0,
): PropertyDecl[] {
  if (depth > 6) return decl.properties;
  const own = [...decl.properties];
  const haveName = new Set(own.map((p) => p.name));

  for (const base of decl.bases) {
    const head = base.split("<")[0]!;
    const short = head.slice(head.lastIndexOf(".") + 1);

    if (IDENTITY_BASES.has(short)) {
      const args = base.includes("<")
        ? splitTop(base.slice(base.indexOf("<") + 1, -1))
        : ["string"];
      const keyType = (args[0] ?? "string").trim();
      const members: Array<readonly [string, string]> = [
        ["Id", keyType],
        ...(short === "IdentityUser" ? IDENTITY_USER_MEMBERS : [["Name", "string?"] as const]),
      ];
      for (const [n, t] of members) {
        if (haveName.has(n)) continue;
        haveName.add(n);
        own.push(synthetic(n, t));
      }
      continue;
    }

    // a base declared inside this repo
    const cands = byName.get(short);
    if (!cands || cands.length === 0) continue;
    const baseDecl = cands[0]!.decl;
    if (baseDecl.name === decl.name) continue;
    for (const p of withInheritedProperties(baseDecl, byName, warnings, depth + 1)) {
      if (haveName.has(p.name)) continue;
      haveName.add(p.name);
      own.push(p);
    }
  }
  return own;
}

interface ContextInfo {
  decl: TypeDecl;
  parse: FileParse;
  /** entity type name -> DbSet property name */
  dbSets: Map<string, string>;
  /** entity type names contributed by an Identity base type argument */
  identityEntities: string[];
  configs: EntityConfig[];
}

/** Base type names that mark a class as an EF context. */
function isDbContextBase(base: string): boolean {
  const head = base.split("<")[0]!;
  return head === "DbContext" || head.endsWith("IdentityDbContext") || head === "IdentityDbContext";
}

function findContexts(parses: FileParse[]): ContextInfo[] {
  const out: ContextInfo[] = [];
  for (const parse of parses) {
    for (const decl of parse.types) {
      if (decl.keyword !== "class") continue;
      if (!decl.bases.some(isDbContextBase)) continue;

      const dbSets = new Map<string, string>();
      for (const p of decl.properties) {
        if (!p.type.startsWith("DbSet<")) continue;
        const inner = p.type.slice("DbSet<".length, -1);
        dbSets.set(inner.trim(), p.name);
      }

      // IdentityDbContext<TUser, TRole, TKey> contributes TUser as an entity
      // that has no DbSet of its own. corpus-repo-a's User arrives only here.
      const identityEntities: string[] = [];
      const identityBase = decl.bases.find((b) => b.split("<")[0]!.includes("IdentityDbContext"));
      if (identityBase && identityBase.includes("<")) {
        const args = splitTop(identityBase.slice(identityBase.indexOf("<") + 1, -1));
        const first = args[0]?.trim();
        if (first && !first.startsWith("Identity") && !VALUE_TYPES.has(first)) {
          identityEntities.push(first);
        }
      }

      const onModel = decl.methods.find((m) => m.name === "OnModelCreating");
      const configs = onModel ? entityConfigs(onModel.body) : [];

      out.push({ decl, parse, dbSets, identityEntities, configs });
    }
  }
  return out;
}

/**
 * Resolve a type name to its declaration using the context's using directives.
 *
 * This is what separates corpus-repo-b's live entities from its stale
 * shadow copies: `Models/CreditLine.cs` and `Models/Entities/CreditLine.cs`
 * declare the same class name, and only the namespace imported by the context
 * (`corpus-repo-b.Api.Models.Entities`) is the real one.
 */
function resolveType(
  name: string,
  byName: Map<string, { decl: TypeDecl; parse: FileParse }[]>,
  ctx: ContextInfo,
  warnings: string[],
): { decl: TypeDecl; parse: FileParse } | null {
  const candidates = byName.get(name);
  if (!candidates || candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0]!;

  const scopes = new Set<string>(ctx.parse.usings);
  if (ctx.parse.namespace) scopes.add(ctx.parse.namespace);

  const inScope = candidates.filter((c) => c.parse.namespace && scopes.has(c.parse.namespace));
  if (inScope.length === 1) return inScope[0]!;
  if (inScope.length > 1) {
    warnings.push(
      `${name}: ${inScope.length} declarations in imported namespaces ` +
        `(${inScope.map((c) => c.parse.namespace).join(", ")}); took the first`,
    );
    return inScope[0]!;
  }

  warnings.push(
    `${name}: ${candidates.length} declarations, none in a namespace imported by ` +
      `${ctx.decl.name} (${candidates.map((c) => c.parse.namespace).join(", ")}); took the first`,
  );
  return candidates[0]!;
}

function attrArgInt(p: PropertyDecl, attr: string): number | undefined {
  const a = p.attributes.find((x) => x.name === attr || x.name === `${attr}Attribute`);
  if (!a || a.args.length === 0) return undefined;
  const n = Number(a.args[0]);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export interface DotnetExtractOptions {
  /** Include EF migration files. Off by default — they restate the model. */
  includeMigrations?: boolean;
}

/**
 * Build an EntityGraph from a .NET repo.
 *
 * Only classes reachable from a DbSet<T> or an Identity base type argument
 * become entities. Every other class in the repo is ignored, which is what
 * keeps DTOs, services and stale duplicates out of the graph.
 */
export function extractDotnet(
  repoRoot: string,
  opts: DotnetExtractOptions = {},
): EntityGraph {
  const warnings: string[] = [];
  const files = walk(repoRoot, [".cs"]).filter((f) => {
    if (opts.includeMigrations) return true;
    return !/\/Migrations\//.test(f);
  });

  const parses: FileParse[] = [];
  for (const f of files) {
    try {
      const p = parseCSharp(readFileSync(f, "utf8"), repoRelative(repoRoot, f));
      parses.push(p);
      warnings.push(...p.warnings);
    } catch (err) {
      warnings.push(`${repoRelative(repoRoot, f)}: parse failed (${String(err)})`);
    }
  }

  const byName = new Map<string, { decl: TypeDecl; parse: FileParse }[]>();
  for (const parse of parses) {
    for (const decl of parse.types) {
      if (decl.modifiers.includes("static")) continue; // constants holders
      if (decl.keyword === "interface" || decl.keyword === "enum") continue;
      const list = byName.get(decl.name) ?? [];
      list.push({ decl, parse });
      byName.set(decl.name, list);
    }
  }

  const contexts = findContexts(parses);
  if (contexts.length === 0) {
    return {
      kind: "entity", repo: repoRoot, provider: "efcore", contextName: null,
      entities: [], relations: [], shapes: [], routes: [], warnings,
    };
  }
  if (contexts.length > 1) {
    warnings.push(
      `${contexts.length} DbContext classes found (${contexts.map((c) => c.decl.name).join(", ")}); using the one with the most DbSets`,
    );
  }
  const ctx = contexts.slice().sort((a, b) => b.dbSets.size - a.dbSets.size)[0]!;

  // ---- entity set -------------------------------------------------------
  const wanted = new Map<string, string | null>(); // type name -> DbSet name
  for (const [type, setName] of ctx.dbSets) wanted.set(type, setName);
  for (const t of ctx.identityEntities) if (!wanted.has(t)) wanted.set(t, null);

  const resolved = new Map<string, { decl: TypeDecl; parse: FileParse }>();
  for (const name of wanted.keys()) {
    const hit = resolveType(name, byName, ctx, warnings);
    if (!hit) {
      warnings.push(`${name}: declared as a DbSet but no class declaration found`);
      continue;
    }
    resolved.set(name, hit);
  }
  const entityNames = new Set(resolved.keys());

  // ---- per-entity fluent configuration ----------------------------------
  const configsFor = new Map<string, EntityConfig[]>();
  for (const c of ctx.configs) {
    const list = configsFor.get(c.entity) ?? [];
    list.push(c);
    configsFor.set(c.entity, list);
  }

  // ---- entities ---------------------------------------------------------
  const entities: Entity[] = [];
  for (const [name, { decl, parse }] of resolved) {
    const configs = configsFor.get(name) ?? [];

    // explicit keys win over convention
    let keys: string[] = [];
    for (const cfg of configs) {
      const hasKey = cfg.calls.find((c) => c.name === "HasKey");
      if (hasKey) keys = lambdaMembers(hasKey.args);
    }

    const indexes: Index[] = [];
    for (const cfg of configs) {
      const idx = cfg.calls.find((c) => c.name === "HasIndex");
      if (!idx) continue;
      indexes.push({
        properties: lambdaMembers(idx.args),
        isUnique: cfg.calls.some((c) => c.name === "IsUnique"),
        source: "fluent",
      });
    }

    // fluent Property(...) overrides, keyed by property name
    const fluentMaxLength = new Map<string, number>();
    const fluentPrecision = new Map<string, [number, number]>();
    const fluentRequired = new Set<string>();
    for (const cfg of configs) {
      const prop = cfg.calls.find((c) => c.name === "Property");
      if (!prop) continue;
      const target = lambdaMembers(prop.args)[0];
      if (!target) continue;
      for (const call of cfg.calls) {
        if (call.name === "HasMaxLength") {
          const n = Number(call.args.map((t) => t.text).join(""));
          if (Number.isFinite(n)) fluentMaxLength.set(target, n);
        }
        if (call.name === "HasPrecision") {
          const nums = call.args.filter((t) => t.kind === "number").map((t) => Number(t.text));
          if (nums.length === 2) fluentPrecision.set(target, [nums[0]!, nums[1]!]);
        }
        if (call.name === "IsRequired" && callBool(call) === true) fluentRequired.add(target);
      }
    }

    const properties: Property[] = [];
    for (const p of withInheritedProperties(decl, byName, warnings)) {
      if (p.modifiers.includes("static") || p.modifiers.includes("const")) continue;
      const u = unwrap(p.type);
      const isNavigation = entityNames.has(u.base);
      const hasRequiredAttr =
        p.attributes.some((a) => a.name === "Required") ||
        p.modifiers.includes("required") ||
        fluentRequired.has(p.name);

      // A C# reference type without `?` is still nullable at the CLR level;
      // EF treats the annotation as the source of truth, so `string` is
      // required and `string?` is optional.
      const nullable = u.isCollection ? false : u.nullable && !hasRequiredAttr;

      properties.push({
        name: p.name,
        type: p.type,
        baseType: u.base,
        nullable,
        isPrimaryKey: false, // filled in below
        isForeignKey: false, // filled in below
        isNavigation,
        isCollection: u.isCollection,
        maxLength: fluentMaxLength.get(p.name) ?? attrArgInt(p, "MaxLength") ?? attrArgInt(p, "StringLength"),
        precision: fluentPrecision.get(p.name),
        column: p.name,
      });
    }

    // key by convention when not declared: "Id" or "<Entity>Id"
    if (keys.length === 0) {
      const conv = properties.find(
        (p) => !p.isNavigation && (p.name === "Id" || p.name === `${name}Id`),
      );
      if (conv) keys = [conv.name];
    }
    for (const p of properties) if (keys.includes(p.name)) p.isPrimaryKey = true;
    if (keys.length === 0) warnings.push(`${name}: no primary key found by convention or HasKey`);

    const dbSetName = wanted.get(name) ?? null;

    // Table name: an explicit ToTable wins; otherwise EF uses the DbSet
    // property name. Identity-derived entities have no DbSet and map to the
    // AspNet* tables instead — verified against AppDbContextModelSnapshot.cs.
    let tableName = dbSetName ?? name;
    for (const cfg of configs) {
      const toTable = cfg.calls.find((c) => c.name === "ToTable");
      const lit = toTable?.args.find((t) => t.kind === "string");
      if (lit) tableName = lit.text.replace(/^[@$]*"|"$/g, "");
    }
    if (!dbSetName && decl.bases.some((b) => b.split("<")[0]!.endsWith("IdentityUser"))) {
      tableName = "AspNetUsers";
    }

    entities.push({
      name,
      namespace: parse.namespace,
      file: parse.file,
      tableName,
      dbSetName,
      keys,
      properties,
      indexes,
      isFramework: false,
    });
  }

  const entityByName = new Map(entities.map((e) => [e.name, e]));

  // ---- relations --------------------------------------------------------
  const relations: Relation[] = [];
  const seen = new Set<string>();

  const addRelation = (r: Omit<Relation, "id">): void => {
    const id = `${r.dependent}.${r.foreignKeyProperty ?? r.dependentNavigation ?? "?"}->${r.principal}`;
    if (seen.has(id)) return;
    seen.add(id);
    relations.push({ ...r, id });
  };

  // 1) fluent-declared relationships take precedence
  for (const [entity, configs] of configsFor) {
    if (!entityByName.has(entity)) continue;
    for (const cfg of configs) {
      const hasOne = cfg.calls.find((c) => c.name === "HasOne");
      const hasMany = cfg.calls.find((c) => c.name === "HasMany");
      const withMany = cfg.calls.find((c) => c.name === "WithMany");
      const withOne = cfg.calls.find((c) => c.name === "WithOne");
      const fk = cfg.calls.find((c) => c.name === "HasForeignKey");
      const onDelete = cfg.calls.find((c) => c.name === "OnDelete");
      const isRequiredCall = cfg.calls.find((c) => c.name === "IsRequired");
      // `.IsRequired(false)` marks a relationship OPTIONAL. Treating the mere
      // presence of the call as "required" inverts the fact — corpus-repo-a
      // uses exactly this on LicenseApplication -> FormTemplate.
      const isRequiredValue = isRequiredCall ? callBool(isRequiredCall) : null;
      if (!hasOne && !hasMany) continue;

      const navName = lambdaMembers((hasOne ?? hasMany)!.args)[0] ?? null;
      const self = entityByName.get(entity)!;
      const navProp = navName ? self.properties.find((p) => p.name === navName) : undefined;

      // The other end: prefer the navigation's declared type, fall back to a
      // generic argument on HasOne<T>/HasMany<T>.
      const other =
        navProp?.baseType ??
        (hasOne ?? hasMany)!.typeArgs[0] ??
        null;
      if (!other || !entityByName.has(other)) continue;

      const fkProp = fk ? (lambdaMembers(fk.args)[0] ?? null) : null;
      const backNav = withMany
        ? (lambdaMembers(withMany.args)[0] ?? null)
        : withOne
          ? (lambdaMembers(withOne.args)[0] ?? null)
          : null;

      let cardinality: Relation["cardinality"];
      let principal: string;
      let dependent: string;
      if (hasOne && withMany) {
        cardinality = "one-to-many";
        principal = other;
        dependent = entity;
      } else if (hasOne && withOne) {
        cardinality = "one-to-one";
        principal = other;
        dependent = entity;
      } else if (hasMany && withOne) {
        cardinality = "one-to-many";
        principal = entity;
        dependent = other;
      } else if (hasMany && withMany) {
        cardinality = "many-to-many";
        principal = entity;
        dependent = other;
      } else {
        cardinality = hasOne ? "one-to-many" : "one-to-many";
        principal = hasOne ? other : entity;
        dependent = hasOne ? entity : other;
      }

      // Required unless the FK (or the navigation) is nullable.
      const depEntity = entityByName.get(dependent);
      const fkPropDecl = fkProp ? depEntity?.properties.find((p) => p.name === fkProp) : undefined;
      const required = isRequiredValue !== null
        ? isRequiredValue
        : fkPropDecl
          ? !fkPropDecl.nullable
          : navProp
            ? !navProp.nullable
            : true;

      const explicitDelete = onDelete ? enumMemberArg(onDelete.args) : null;
      const deleteBehavior: DeleteBehavior =
        explicitDelete && isDeleteBehavior(explicitDelete)
          ? explicitDelete
          : required
            ? "Cascade"
            : "ClientSetNull";

      addRelation({
        principal,
        dependent,
        foreignKeyProperty: fkProp,
        cardinality,
        dependentNavigation: hasOne ? navName : backNav,
        principalNavigation: hasOne ? backNav : navName,
        required,
        deleteBehavior,
        deleteBehaviorSource: explicitDelete ? "fluent" : "convention",
        source: "fluent",
      });
    }
  }

  // A navigation defines exactly one relationship. Fluent config may name a
  // foreign key that does not follow the "<Nav>Id" convention -- in
  // corpus-repo-a, ApplicationDocument.LicenseApplication is keyed by
  // ApplicationId -- so matching on the FK name alone lets the convention pass
  // add a second, foreign-key-less copy of a relationship it already has.
  const coveredNavigations = new Set<string>();
  for (const r of relations) {
    if (r.dependentNavigation) coveredNavigations.add(`${r.dependent}.${r.dependentNavigation}`);
    if (r.principalNavigation) coveredNavigations.add(`${r.principal}.${r.principalNavigation}`);
  }

  // 2) convention: a reference navigation plus a matching "<Nav>Id" scalar
  for (const e of entities) {
    for (const nav of e.properties) {
      if (!nav.isNavigation || nav.isCollection) continue;
      if (coveredNavigations.has(`${e.name}.${nav.name}`)) continue;
      const fkName = `${nav.name}Id`;
      const fkProp = e.properties.find((p) => p.name === fkName && !p.isNavigation);
      const principal = nav.baseType;
      if (!entityByName.has(principal)) continue;

      const id = `${e.name}.${fkProp?.name ?? nav.name}->${principal}`;
      if (seen.has(id)) continue;

      const required = fkProp ? !fkProp.nullable : !nav.nullable;
      // Does the principal declare a collection back to this entity?
      const back = entityByName
        .get(principal)!
        .properties.find((p) => p.isCollection && p.baseType === e.name);

      addRelation({
        principal,
        dependent: e.name,
        foreignKeyProperty: fkProp?.name ?? null,
        cardinality: back ? "one-to-many" : "one-to-one",
        dependentNavigation: nav.name,
        principalNavigation: back?.name ?? null,
        required,
        deleteBehavior: required ? "Cascade" : "ClientSetNull",
        deleteBehaviorSource: "convention",
        source: "convention",
      });
    }
  }

  // mark foreign-key properties now that every relation is known
  for (const r of relations) {
    if (!r.foreignKeyProperty) continue;
    const dep = entityByName.get(r.dependent);
    const p = dep?.properties.find((x) => x.name === r.foreignKeyProperty);
    if (p) p.isForeignKey = true;
  }

  // Everything the DbSet rule discarded, kept as shapes so a DTO can be
  // compared against the entity it mirrors.
  const shapes = pairShapes(entities, csharpShapes(parses, entityNames, unwrap), warnings);

  return {
    kind: "entity",
    repo: repoRoot,
    provider: "efcore",
    contextName: ctx.decl.name,
    entities: entities.sort((a, b) => a.name.localeCompare(b.name)),
    relations: relations.sort((a, b) => a.id.localeCompare(b.id)),
    shapes: shapes.sort((a, b) => a.name.localeCompare(b.name)),
    routes: [],
    warnings,
  };
}

/** Read a boolean argument: `IsRequired()` and `IsRequired(true)` are true. */
function callBool(call: { args: { text: string }[] }): boolean {
  if (call.args.length === 0) return true;
  return call.args.map((t) => t.text).join("").trim() !== "false";
}

function isDeleteBehavior(s: string): s is DeleteBehavior {
  return ["Cascade", "ClientSetNull", "SetNull", "Restrict", "NoAction"].includes(s);
}

const _unusedFactSource: FactSource = "convention";
void _unusedFactSource;
