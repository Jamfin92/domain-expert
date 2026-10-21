import { z } from "zod";

/**
 * The contract every psq package speaks. Zod only, no I/O.
 *
 * Extraction is the ONLY producer of a graph; generators and graders are pure
 * consumers. If a fact is not in the graph, no question may assert it.
 */

// ---------------------------------------------------------------------------
// Entity graph — the relational layer (EF Core, raw DDL, SQLAlchemy, ...)
// ---------------------------------------------------------------------------

export const Cardinality = z.enum(["one-to-one", "one-to-many", "many-to-many"]);
export type Cardinality = z.infer<typeof Cardinality>;

/**
 * EF's DeleteBehavior set. `source` matters: corpus repo A declares no
 * OnDelete at all, so its behavior is derived from EF convention (required FK
 * => Cascade, optional => ClientSetNull). Corpus repo B declares its own
 * explicitly. A question must never present a convention-derived value as if
 * it were written in the source.
 */
export const DeleteBehavior = z.enum([
  "Cascade",
  "ClientSetNull",
  "SetNull",
  "Restrict",
  "NoAction",
]);
export type DeleteBehavior = z.infer<typeof DeleteBehavior>;

/**
 * How psq came to know a fact.
 *  - fluent: the repo wrote it, in EF's configuration API
 *  - attribute: a C# attribute the repo wrote (EF annotations, ASP.NET routing)
 *  - declared: the repo wrote the fact out literally: raw DDL, a literal
 *    Express path (the receiver name `app`/`router`/`api` is guessed, the path
 *    is not), a call site lexically inside its owner (the owner being a
 *    component is a JSX + PascalCase heuristic; the containment is lexical)
 *  - convention: the framework implied it
 *  - inferred: psq matched by name, path or reference walk; the repo never
 *    states the link, and psq says so
 *
 * Provenance is stamped on a fact, never on the absence of one (P2c). For
 * every nullable fact `X` with a provenance field `XSource`,
 * `X === null` iff `XSource === null`; a non-nullable fact (a route, a call
 * edge, an entity ref, a component) always carries a non-null `source`.
 */
export const FactSource = z.enum([
  "fluent",
  "attribute",
  "declared",
  "convention",
  "inferred",
]);
export type FactSource = z.infer<typeof FactSource>;

export const Property = z.object({
  name: z.string(),
  /** Declared type as written, e.g. "int", "string?", "ICollection<Order>". */
  type: z.string(),
  /** Type with nullability and collection wrapper stripped: "Order". */
  baseType: z.string(),
  nullable: z.boolean(),
  isPrimaryKey: z.boolean(),
  isForeignKey: z.boolean(),
  /** True when this property is a reference/collection to another entity. */
  isNavigation: z.boolean(),
  isCollection: z.boolean(),
  maxLength: z.number().int().positive().optional(),
  precision: z.tuple([z.number().int(), z.number().int()]).optional(),
  /** Column name once naming conventions are applied. */
  column: z.string(),
});
export type Property = z.infer<typeof Property>;

export const Index = z.object({
  properties: z.array(z.string()).min(1),
  isUnique: z.boolean(),
  source: FactSource,
});
export type Index = z.infer<typeof Index>;

export const Relation = z.object({
  id: z.string(),
  /** The "one" side / the entity being pointed at. */
  principal: z.string(),
  /** The entity holding the foreign key. */
  dependent: z.string(),
  foreignKeyProperty: z.string().nullable(),
  cardinality: Cardinality,
  /** Navigation on the dependent pointing at the principal, if any. */
  dependentNavigation: z.string().nullable(),
  /** Navigation on the principal pointing back, if any. */
  principalNavigation: z.string().nullable(),
  required: z.boolean(),
  deleteBehavior: DeleteBehavior,
  deleteBehaviorSource: FactSource,
  source: FactSource,
});
export type Relation = z.infer<typeof Relation>;

export const Entity = z.object({
  name: z.string(),
  namespace: z.string().nullable(),
  /** Repo-relative path of the declaring file. */
  file: z.string(),
  tableName: z.string(),
  /** Property name on the DbContext, absent for Identity-derived entities. */
  dbSetName: z.string().nullable(),
  keys: z.array(z.string()),
  properties: z.array(Property),
  indexes: z.array(Index),
  /** True for framework-supplied entities (IdentityUserRole and friends). */
  isFramework: z.boolean(),
});
export type Entity = z.infer<typeof Entity>;

// ---------------------------------------------------------------------------
// Shapes — the declared data structures beside the relational layer
// ---------------------------------------------------------------------------

/**
 * How a shape was declared — a fact, not a role. Whether a shape is a DTO is
 * not written anywhere in a repo; `mirrors` says what psq worked out instead.
 */
export const ShapeKind = z.enum(["class", "interface", "type-alias", "enum", "zod"]);
export type ShapeKind = z.infer<typeof ShapeKind>;

export const ShapeField = z.object({
  name: z.string(),
  /** Declared type as written, e.g. "string | null", "Task[]". */
  type: z.string(),
  /** Type with nullability and collection wrapper stripped: "Task". */
  baseType: z.string(),
  /**
   * `?:`, `| null` and `| undefined` are one axis here. A row type says
   * `project_id: string | null` where its DTO says `projectId?: string`, and
   * those describe the same fact — treating them apart reports drift on every
   * nullable column in the schema.
   */
  optional: z.boolean(),
  isCollection: z.boolean(),
});
export type ShapeField = z.infer<typeof ShapeField>;

export const Shape = z.object({
  name: z.string(),
  /** Repo-relative path of the declaring file. */
  file: z.string(),
  /** Namespace (C#) or module specifier (TS), when one is declared. */
  module: z.string().nullable(),
  kind: ShapeKind,
  fields: z.array(ShapeField),
  /** Enum members or string-literal union members, in declared order. */
  members: z.array(z.string()),
  /** Discriminant property of a discriminated union, else null. */
  discriminator: z.string().nullable(),
  /**
   * Entity this shape mirrors, else null. Pairing is refused unless the names
   * normalize equal AND the fields substantially overlap, because a wrong
   * pairing invents drift that is not there.
   */
  mirrors: z.string().nullable(),
  /**
   * How the pairing was made (`inferred`: name + field overlap), or null
   * exactly when `mirrors` is null. In a merged fullstack graph a TS shape's
   * `mirrors: null` means "not computed cross-stack", not "no mirror"; its
   * `mirrorSource` is null too, because there is no pairing to source.
   */
  mirrorSource: FactSource.nullable(),
});
export type Shape = z.infer<typeof Shape>;

/** An HTTP route, extracted as a fact. Questions about routes arrive in M5. */
export const Route = z.object({
  method: z.string(),
  path: z.string(),
  file: z.string(),
  line: z.number().int().nonnegative(),
  /**
   * `attribute` for an ASP.NET attribute route (the only kind the .NET reader
   * records); `declared` for an Express registration, which is recorded only
   * when its path is a string literal.
   */
  source: FactSource,
  /**
   * The code the route dispatches to, when the reader can name it. Both the
   * .NET attribute-route reader and the Express reader set it. Express: the
   * handler is the last argument of the registration call. A reference
   * resolves to its single declaration (`type` = enclosing class, the
   * variable holding an object literal, or — for a plain function — the
   * module file basename without extension). An INLINE function has
   * `method: "<inline>"`, `type` = the module file basename without
   * extension, and `file`/`line` equal to the route's own. An unresolvable
   * handler (wrapper call, `.bind`, array, overload) leaves it off.
   * `type` and `method` are the class and method names exactly as an
   * `EntityRef` spells them, so a route joins to the entities its handler
   * mentions by `(handler.type, handler.method)`. `handler.line` is the
   * method's declaration; `Route.line` is the attribute that declares the route.
   */
  handler: z
    .object({
      type: z.string(),
      method: z.string(),
      file: z.string(),
      line: z.number().int().nonnegative(),
    })
    .optional(),
});
export type Route = z.infer<typeof Route>;

/**
 * An HTTP call site in client code, matched to a Route when the evidence
 * allows. Detection is a heuristic and deliberately partial. Catalogued
 * misses, all silent — a `.get(` that is not a client call is not an unread
 * construct, it is a call the reader is not about:
 *   - calls through a wrapper function: `call<T>(...)` in this repo's own
 *     apps/web/src/lib/api.ts is invisible, because the wrapper's inner fetch
 *     receives a parameter, never a literal
 *   - URLs built by string concatenation ("/api/x/" + id is a
 *     BinaryExpression; rejected outright)
 *   - non-literal URLs: identifiers, config lookups, absolute external URLs
 *   - `fetch(url, init)` where init is an identifier, a call, or an object
 *     literal with a spread, a computed property key, or a `method` that is
 *     shorthand (`{ method, body }` — a wrapper forwarding its argument) or
 *     has a non-literal value: the method is unknowable, so the call is
 *     skipped rather than fabricated as a GET
 *   - calls relative to a configured baseURL: no prefix inference, so they
 *     are recorded but match nothing
 *   - a file that both imports express and makes client calls is skipped whole
 * Attribution (`components`, M5b) has its own catalogued misses, also silent:
 *   - only the NEAREST component in the reference graph is recorded; ancestor
 *     components above it are deliberately absent, because attributing to
 *     every reaching component makes the root App own every call in the app
 *   - the provider swallow, by name: a context provider component that itself
 *     contains the auth calls is attributed, and the components consuming its
 *     hook are not — the hook reads a context value, so no reference edge
 *     connects the consumers to the call. No heuristic skips providers; that
 *     would be a guess
 *   - reverse reachability stops silently at depth 8, so a chain more than
 *     eight definitions deep loses its component
 *   - a component the JSX+PascalCase detector cannot see (a lowercase-named
 *     component, a component whose JSX is produced indirectly — returned from
 *     a helper, built with createElement) is never attributed to
 *   - an anonymous `export default` keys as "default", which fails the
 *     PascalCase test, so an anonymous default-exported component can never
 *     be detected or attributed to
 *   - a CLASS component's own calls: a method of a class is its own
 *     definition, and no reference edge connects a class's methods to the
 *     class, so a fetch inside `load()` of a JSX-rendering class stays
 *     unattributed unless some other definition references that method
 *   - an object-literal member that cannot be a definition (a computed key,
 *     a spread, an accessor), a class member other than a named method (a
 *     constructor, a property arrow, an accessor, a computed-name method, a
 *     static block), and every member of a class EXPRESSION: a call inside
 *     one is unattributed — the construct is dropped, and ownership never
 *     spills outward to the holding object, class, or variable, where it
 *     would fan out to every component touching any sibling. The
 *     constructor gets no exception: a type annotation, instanceof, a
 *     static access and extends all reference a class without constructing
 *     it, and the reader cannot tell them from `new`
 *   - a call inside a SIBLING-BEARING container that is not itself a set of
 *     definitions — an object literal passed to a factory call, returned
 *     from a factory arrow or an IIFE, or an array of handler objects, with
 *     two or more members — is unattributed when the enclosing definition
 *     is not a component: attributing it would fan out across every
 *     sibling's callers. Inside a COMPONENT the same shape (the
 *     useMutation({ mutationFn, ... }) options object) attributes to that
 *     component, which is its genuine owner. A SINGLE-member container
 *     (`mk({ only() { fetch(...) } })`, `forwardRef(cb)`) still attributes
 *     to the enclosing definition — accepted because there are no siblings
 *     to fan across, NOT because every referrer provably reaches the call:
 *     a referrer that only takes the definition's type still gets counted
 *     as an owner. A decision, stated as one
 *   - everything inside a namespace (a ModuleDeclaration) is invisible to
 *     attribution: its statements are not SourceFile-scope definitions, so
 *     its calls are unattributed and nothing references into or out of it
 *   - an overloaded function's canonical declaration is its first SIGNATURE,
 *     which has no body: an overloaded component is undetectable, and a call
 *     in the overload implementation is unattributed
 *   - member keys do not escape ".": `{ "a.b": x }` and a nested
 *     `a: { b: y }` in one file produce the same key — the second warns and
 *     is dropped like any collision, unattributed rather than merged
 *   - two definitions sharing one key keep the first and warn; calls owned by
 *     the second stay unattributed rather than mis-attributed (the loser's
 *     declaration is recorded, and ownership walks stop at it instead of
 *     spilling to the enclosing declaration)
 * And one catalogued false positive, the reverse of a miss: in a file with no
 * express import, a router-shaped registration whose extra arguments are
 * identifiers rather than inline functions — `router.get("/users",
 * authenticate, listUsers)`, `router.get("/things", ctrl.list)` — is recorded
 * as a client call: neither guard can tell it from an axios-style call. It
 * can only ever sit unmatched (`matches: null`), because `readRoutes` skips
 * the same files, but the record itself is a guessed fact.
 */
export const ClientCall = z.object({
  method: z.string(),
  /**
   * The call's path as written, with ${} holes as * and any query string
   * dropped. Route :params are normalised to * at match time only; a literal
   * `:id` in a call path is stored verbatim.
   */
  path: z.string(),
  file: z.string(),
  line: z.number().int().nonnegative(),
  /** Nearest enclosing named function, or null at module scope. */
  enclosing: z.string().nullable(),
  /** The matched route's raw "METHOD path", or null when unmatched. */
  matches: z.string().nullable(),
  /**
   * `inferred` when `matches` is set, null exactly when it is null. Both the
   * literal-path match and the base-prefixed match are path equality, not a
   * proven wire, so neither is stronger than `inferred`.
   */
  matchSource: FactSource.nullable(),
  /**
   * Component keys (`Component.key`) this call attributes to, sorted;
   * resolved against `EntityGraph.components`. KEYS, not names: the same
   * component name recurs across directories in real repos, and a bare name
   * resolving against several entries is a fabricated fact. Empty when the
   * call is genuinely unowned (module scope, or no component reaches it
   * through the reference graph).
   */
  components: z.array(z.string()),
  /**
   * How `components` was attributed; null exactly when it is empty.
   * `declared`: the call site is lexically inside the component definition.
   * `inferred`: the component was reached by the reference walk. `[]` with
   * null also covers the `ref-no-ast` case, where attribution could not run
   * (and said so in a warning).
   */
  componentsSource: FactSource.nullable(),
});
export type ClientCall = z.infer<typeof ClientCall>;

/**
 * A UI component definition, found by a stack-specific detector (today:
 * JSX + PascalCase, i.e. React). `key` is "<repo-relative file>#<name>" and
 * is what `ClientCall.components` stores — names alone are ambiguous in any
 * repo with two same-named components.
 *
 * `source` is always `inferred`: componenthood is the JSX + PascalCase
 * heuristic, never something the repo states. The provenance of an
 * ATTRIBUTION (which component owns a call) lives where that fact is, on
 * `ClientCall.componentsSource`.
 */
export const Component = z.object({
  key: z.string(),
  name: z.string(),
  /** Repo-relative path of the declaring file. */
  file: z.string(),
  line: z.number().int().nonnegative(),
  source: FactSource,
});
export type Component = z.infer<typeof Component>;

/**
 * Which of the two name rules matched a token.
 *
 * `entityName` — the token text equals `Entity.name` (the C# class name).
 * `dbSetName`  — the token text equals `Entity.dbSetName` AND is immediately
 *                preceded by a `.`, i.e. `_db.Students`.
 *
 * Both are exact-text rules, never substring — the deliberate contrast with
 * `searchEntities`, which is human-facing and matches partials.
 */
export const RefVia = z.enum(["entityName", "dbSetName"]);
export type RefVia = z.infer<typeof RefVia>;

/**
 * One place in the repo that MENTIONS an entity. Not a call site.
 *
 * Nothing here distinguishes a call from a mention: `Student s = null;`,
 * `typeof(Student)`, `nameof(Student)` and an attribute argument all produce
 * an `EntityRef`. Narrowing to call sites needs argument-list and receiver
 * analysis and is deliberately not done (D-Hb-14).
 *
 * `method` is NOT nullable. Only method bodies are scanned, so a ref with no
 * enclosing method is unreachable and a nullable field would be dead code.
 *
 * Known blind spots, all recorded rather than guessed at:
 *   - constructor bodies are invisible, because `parseCSharp` never captures
 *     a constructor as a method at all
 *   - expression-bodied methods reach the walker with `body: []`
 *     (`csharp/structure.ts:338`)
 *   - `#if` blocks and comments are dropped by the lexer, never tokens
 *   - the match is keyed by NAME, with no symbol table: a same-named class in
 *     a namespace the DbContext does not import is reported as a ref to the
 *     entity (D-Hb-13). That is why `source` is the constant `inferred`:
 *     every ref is a name match, never a resolved symbol. `via` records which
 *     of the two name rules hit; `source` records that both are inference.
 */
export const EntityRef = z.object({
  /** `Entity.name`, always — never the DbSet property name. */
  entity: z.string(),
  /** Repo-relative path of the REFERENCING file, not the declaring one. */
  file: z.string(),
  /** 1-based line of the matched token, not of the enclosing method. */
  line: z.number().int().nonnegative(),
  /** Name of the type declaring the enclosing method. */
  type: z.string(),
  /** Name of the enclosing method. */
  method: z.string(),
  via: RefVia,
  /** Always `inferred`: the match is keyed on names, with no symbol table. */
  source: FactSource,
});
export type EntityRef = z.infer<typeof EntityRef>;

/** A method as a call-graph node: the class and method names exactly as an `EntityRef` spells them. */
export const CallSite = z.object({
  type: z.string(),
  method: z.string(),
  file: z.string(),
  /** 1-based line of the method's declaration (the interface member, for an interface). */
  line: z.number().int().nonnegative(),
});
export type CallSite = z.infer<typeof CallSite>;

/**
 * One call from a C# method to another repo-declared method (flow).
 *
 * Resolved syntactically and conservatively; an unresolvable call is never
 * guessed, only counted (`EntityGraph.unresolvedCalls`). Overloads are NOT
 * told apart: a node is `type` + `method` name, so every overload of `Save`
 * is one node and `to.line` is the first overload's declaration.
 *
 * A call through an interface yields an edge to the interface member AND one to
 * each repo implementer that declares the method; when there are several
 * implementers those edges carry `ambiguous: true` (any one may run).
 *
 * `source`: `declared` for a call the code spells out (`this.M(`, a typed
 * receiver, a static call, a bare `M(`, and the edge to the interface member
 * itself); `inferred` for every edge to an implementer reached by interface
 * dispatch. `inferred` WITHOUT `ambiguous` is a unique dispatch guess (one
 * implementer). When the same edge is reached both ways, `declared` wins and
 * the edge is no longer `ambiguous` (the code names that target directly), so
 * `ambiguous` implies `inferred` in every order.
 */
export const Call = z.object({
  from: CallSite,
  to: CallSite,
  /** 1-based line of the call site, inside `from.file`. */
  line: z.number().int().nonnegative(),
  source: FactSource,
  ambiguous: z.boolean().optional(),
});
export type Call = z.infer<typeof Call>;

/** How many calls in a method body no rule could resolve to a repo method. */
export const UnresolvedCalls = z.object({
  type: z.string(),
  method: z.string(),
  file: z.string(),
  line: z.number().int().nonnegative(),
  count: z.number().int().positive(),
});
export type UnresolvedCalls = z.infer<typeof UnresolvedCalls>;

// ---------------------------------------------------------------------------
// Coverage — what each reader ran over, so an empty facet can say why (P2a)
// ---------------------------------------------------------------------------

/**
 * complete   = the reader ran over every eligible file under its roots (says
 *              nothing about recall)
 * partial    = the reader ran but knowingly left eligible input out (walk limit
 *              hit, referenced projects not read, cross-stack pairing not computed)
 * not-read   = no reader for this facet ran under this provider
 * none-found = the reader ran to completion and produced zero facts
 */
export const CoverageStatus = z.enum(["complete", "partial", "not-read", "none-found"]);
export type CoverageStatus = z.infer<typeof CoverageStatus>;

/** `unreadable` = a file the reader could not open (an I/O error; P2b). */
export const SkipReason = z.enum([
  "test-file", "migrations", "declaration", "walk-limit", "other-project", "unreadable",
]);
export type SkipReason = z.infer<typeof SkipReason>;

export const FacetCoverage = z
  .object({
    status: CoverageStatus,
    /** e.g. ["efcore"], ["sqlite-ddl"], ["aspnet-routes","express-routes"], [] */
    readers: z.array(z.string()),
    /** Repo-relative; "." = the repo root. */
    roots: z.array(z.string()),
    /** FILE-level count for that reader run, not per facet. */
    filesRead: z.number().int().nonnegative(),
    skipped: z.array(z.object({ why: SkipReason, count: z.number().int().positive() })),
    reason: z.string().nullable(),
  })
  .refine((f) => f.status === "complete" || (f.reason !== null && f.reason.length > 0), {
    message: "reason required unless status is complete",
  });
export type FacetCoverage = z.infer<typeof FacetCoverage>;

/** Nine facets; `pairing` is shape-to-entity mirroring. */
export const Coverage = z.object({
  entities: FacetCoverage,
  relations: FacetCoverage,
  shapes: FacetCoverage,
  routes: FacetCoverage,
  clientCalls: FacetCoverage,
  components: FacetCoverage,
  entityRefs: FacetCoverage,
  calls: FacetCoverage,
  pairing: FacetCoverage,
});
export type Coverage = z.infer<typeof Coverage>;

/** What on disk decided `provider`. Test-only counts are files under test paths. */
export const ProviderBasis = z.object({
  csFiles: z.number().int(),
  csprojFiles: z.number().int(),
  tsFiles: z.number().int(),
  testOnlyCs: z.number().int(),
  testOnlyCsproj: z.number().int(),
  testOnlyTs: z.number().int(),
  packageJson: z.boolean(),
  tsconfig: z.boolean(),
});
export type ProviderBasis = z.infer<typeof ProviderBasis>;

// ---------------------------------------------------------------------------
// Warning records — the typed twin of `warnings` (P2b)
// ---------------------------------------------------------------------------

/**
 * One code per CLASS of warning, not per push site. kebab-case like
 * `SkipReason`. Each line says what the record's `about` names (null when the
 * text names nothing). `file`/`line` always name where the text's own
 * `file:line:` prefix points, when it has one.
 */
export const WarningCode = z.enum([
  // ---- C# structure (`csharp/structure.ts`) ----
  /** A method body, accessor block or type body whose brace never closes. about: the member or type. */
  "cs-unbalanced-body",
  /** An expression-bodied method with no terminating `;`. about: the method. */
  "cs-member-not-terminated",
  /** A type header that stopped before `{` or `;`. about: the type. */
  "cs-type-header-not-terminated",
  // ---- C# routes (`csharp/routes.ts`) ----
  /** Actions or a class [Route] inherited from a repo-local base; not read. about: the controller. */
  "route-inherited-not-read",
  /** A controller in an [Area]; area routes are not read. about: the controller. */
  "route-area-not-read",
  /** A [Route]/verb template that is not a plain string literal. about: `Controller` or `Controller.Action`. */
  "route-template-not-literal",
  /** An [ActionName] whose argument is not a plain string literal. about: `Controller.Action`. */
  "route-action-name-not-literal",
  /** An action using [AcceptVerbs]. about: `Controller.Action`. */
  "route-accept-verbs",
  /** A public method without an HTTP-method attribute under a class [Route]. about: `Controller.Action`. */
  "route-verb-undecided",
  /** A [Route] that accepts every verb; no verb is invented. about: `Controller.Action`. */
  "route-any-verb",
  /** Conventionally routed: no attribute route, or MapControllerRoute-style registration. about: `Controller.Action` or the registration call. */
  "route-conventional",
  /** A template psq cannot substitute (unknown or unterminated token). about: `Controller.Action`. */
  "route-template-invalid",
  /** `[action]` on a method ending in Async: MVC may trim the suffix, psq cannot see the option. about: `Controller.Action`. */
  "route-action-name-undecided",
  /** A minimal-API registration (MapGet etc.); not read. about: the registration call. */
  "route-minimal-api",
  // ---- C# model (`dotnet.ts`) ----
  /** Several declarations of an entity type; the first was taken. about: the type. */
  "type-ambiguous",
  /** A `.cs` file the reader could not open (I/O). about: null. */
  "cs-unreadable",
  /** More than one DbContext; one was elected. about: the elected context. */
  "dbcontext-election",
  /** A DbSet<T> whose T has no declaration. about: the type. */
  "dbset-type-missing",
  /** An entity with no primary key by convention or HasKey. about: the entity. */
  "entity-no-key",
  /** The elected DbContext contributed no entities. about: the context. */
  "dbcontext-empty",
  // ---- pairing (`pair.ts`) ----
  /** A shape that could mirror more than one entity; not paired. about: the shape. */
  "shape-mirror-ambiguous",
  // ---- Node (`node.ts`, `node/*.ts`) ----
  /** tsconfig.json could not be read; defaults used. about: null. */
  "tsconfig-diagnostic",
  /** Only one of several referenced tsconfig projects was read. about: null. */
  "tsconfig-references-partial",
  /** tsconfig.json yielded no files; a directory scan was used. about: null. */
  "tsconfig-fallback-scan",
  /** A directory walk stopped at its file limit. about: null. */
  "walk-limit",
  /** Shapes but no CREATE TABLE schema (rewritten by the fullstack merge). about: null. */
  "no-schema",
  /** CREATE TABLE in a template literal with substitutions; not read. about: null. */
  "ddl-substitution-literal",
  /** A DDL candidate literal that SQLite refused. about: null. */
  "ddl-candidate-failed",
  /** A shared key column that names no single owner; no relation inferred. about: the column. */
  "ddl-relation-ambiguous",
  /** A TypeScript declaration the checker could not resolve. about: null. */
  "shape-unresolved",
  /** An Express route registered with a regular expression. about: the HTTP method. */
  "route-regex",
  /** A client base that is not a statically readable path prefix. about: the base expression. */
  "client-base-unreadable",
  /** A client call matching more than one route; not matched. about: `METHOD /path` of the call. */
  "client-call-ambiguous",
  /** Two definitions producing the same component key; the first kept. about: the key. */
  "ref-key-collision",
  /** A client call with no recorded AST node; not attributed. about: null. */
  "ref-no-ast",
  // ---- fullstack merge (`merge.ts`) ----
  /** No root tsconfig and several candidates below it. about: null. */
  "node-root-ambiguous",
  /** Both stacks contributed entities. about: null. */
  "two-entity-languages",
  /** TypeScript shapes never paired against the .NET model. about: null. */
  "shapes-unpaired",
  // ---- provider detection (`detect.ts`) ----
  /** No reader for this repo. about: null. */
  "no-reader",
]);
export type WarningCode = z.infer<typeof WarningCode>;

/**
 * The typed twin of one `warnings` string. `graph.warningRecords[i].text ===
 * graph.warnings[i]` for every graph `@psq/extract` produces: the strings are
 * derived from the records.
 */
export const WarningRecord = z.object({
  code: WarningCode,
  /**
   * Repo-relative, forward slashes, never absolute. The file the text's
   * `file:line:` / `file:` prefix names; `"tsconfig.json"` for the tsconfig
   * warnings (which fire only when that file exists); null when the text names
   * no file.
   */
  file: z.string().nullable(),
  /** 1-based; the line the text's `file:line:` prefix names, else null. */
  line: z.number().int().positive().nullable(),
  /** What the warning is about (entity, route, shape, type, column, key); see each `WarningCode`. */
  about: z.string().nullable(),
  /** Exactly the string in `warnings` at the same index. */
  text: z.string().min(1),
});
export type WarningRecord = z.infer<typeof WarningRecord>;

export const EntityGraph = z.object({
  kind: z.literal("entity"),
  repo: z.string(),
  /**
   * Which reader produced this graph. An enum rather than a string so the
   * compiler can find every consumer when a provider is added: each
   * `provider === "..."` narrows, and a switch with a missing arm stops
   * compiling. "fullstack" is both readers merged (`extract/src/merge.ts`).
   */
  provider: z.enum(["efcore", "sqlite-ddl", "fullstack", "none"]),
  contextName: z.string().nullable(),
  entities: z.array(Entity),
  relations: z.array(Relation),
  /** Declared structures beside the tables: DTOs, interfaces, enums, zod. */
  shapes: z.array(Shape),
  /** HTTP surface, when the repo has one. Facts only; questions are M5b+. */
  routes: z.array(Route),
  /** HTTP call sites in the repo's client code, matched against `routes`. */
  clientCalls: z.array(ClientCall),
  /** UI component definitions; `ClientCall.components` resolves against this. */
  components: z.array(Component),
  /**
   * Every mention of an entity inside a C# method body (H-b1).
   *
   * `.default([])` so an envelope stored before this field existed still
   * parses, and the inferred OUTPUT type still makes the field required so
   * `tsc` enumerates every construction site. Paired with the
   * `EXTRACTOR_VERSION` bump: without it an old graph would serve `[]`
   * forever instead of re-extracting.
   */
  entityRefs: z.array(EntityRef).default([]),
  /**
   * Method-to-method calls inside the repo's C# (flow). Optional so providers
   * that cannot read calls (Node, DDL) stay valid and old envelopes still parse.
   */
  calls: z.array(Call).optional(),
  /**
   * Methods with at least one call no rule resolved. Mostly framework calls
   * (`Ok(`, `ToList(`), so read it as "how much of this body psq cannot follow",
   * not as a defect count.
   */
  unresolvedCalls: z.array(UnresolvedCalls).optional(),
  /** Non-fatal parse problems. Never silently dropped. */
  warnings: z.array(z.string()),
  /**
   * `warnings` as typed records, same length and order (P2b). Optional so
   * hand-built graphs and envelopes stored before it existed still parse;
   * every graph `@psq/extract` produces carries it. Not `.default([])`: a
   * defaulted `[]` beside a non-empty `warnings` would break the invariant.
   */
  warningRecords: z.array(WarningRecord).optional(),
  /**
   * Per-facet record of what the readers ran over. Optional so hand-built
   * graphs and envelopes stored before it existed still parse; every graph
   * `@psq/extract` produces carries it.
   */
  coverage: Coverage.optional(),
  /** The file counts that decided `provider`. Optional for the same reason. */
  providerBasis: ProviderBasis.optional(),
});
export type EntityGraph = z.infer<typeof EntityGraph>;

// ---------------------------------------------------------------------------
// Entity search — the wire types for `searchEntities` and GET .../search
// ---------------------------------------------------------------------------

/**
 * Which declared string a hit matched on.
 *
 * Three fields, not four: `column` is always `property.name` at both and only
 * construction sites (`dotnet.ts:398`, `node/ddl.ts:182` — no `[Column]` or
 * `HasColumnName` handling exists), so a `columnName` reason could never be
 * distinct from a `propertyName` one. Shapes are deliberately excluded: a
 * shape is not an entity. `EntitySearchResult.searched` reports the cut at the
 * API surface rather than leaving it silent.
 */
export const EntityMatchField = z.enum(["entityName", "tableName", "propertyName"]);
export type EntityMatchField = z.infer<typeof EntityMatchField>;

export const EntityMatchReason = z.object({
  field: EntityMatchField,
  /** The RAW declared string that matched — never lowercased; a UI renders it. */
  matched: z.string(),
  /** The property that matched, set iff `field` is "propertyName". */
  property: z.string().nullable(),
});
export type EntityMatchReason = z.infer<typeof EntityMatchReason>;

/**
 * One entity, with every reason it matched. An entity appears at most once.
 *
 * Node-side entities carry `tableName === name` (`node/ddl.ts:186-191`), so a
 * Node entity matching on its name also carries a `tableName` reason. That is
 * real output, not a bug: both strings genuinely contain the needle.
 */
export const EntitySearchHit = z.object({
  name: z.string(),
  tableName: z.string(),
  namespace: z.string().nullable(),
  file: z.string(),
  reasons: z.array(EntityMatchReason),
});
export type EntitySearchHit = z.infer<typeof EntitySearchHit>;

export const EntitySearchResult = z.object({
  /** The query as received, before trimming. */
  query: z.string(),
  /** Derived from `MATCH_FIELDS` in `@psq/graph`, never hardcoded. */
  searched: z.array(EntityMatchField),
  hits: z.array(EntitySearchHit),
});
export type EntitySearchResult = z.infer<typeof EntitySearchResult>;

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

export const Section = z.enum([
  "entity",
  "client",
  "ds",
  "agent-entities",
  "agent-client",
  "agent-ds",
]);
export type Section = z.infer<typeof Section>;

export const QuestionKind = z.enum(["mcq", "cloze", "short", "sql"]);
export type QuestionKind = z.infer<typeof QuestionKind>;

/**
 * How an answer is checked. Never a model.
 *  - token: normalize + alias-set membership
 *  - exec:  run candidate SQL and reference SQL, compare result sets
 *  - choice: index into `choices`
 */
export const GradeMode = z.enum(["token", "exec", "choice"]);
export type GradeMode = z.infer<typeof GradeMode>;

export const Question = z.object({
  id: z.string(),
  section: Section,
  kind: QuestionKind,
  gradeMode: GradeMode,
  /** Generator that produced it — used to pick a mutation in selftest. */
  generator: z.string(),
  prompt: z.string(),
  /** MCQ options, in stable order. */
  choices: z.array(z.string()).optional(),
  /** Index into `choices` for gradeMode "choice". */
  answerIndex: z.number().int().nonnegative().optional(),
  /** Canonical answer(s) for "token". Multiple blanks => multiple entries. */
  answers: z.array(z.string()).optional(),
  /** Accepted equivalents per blank, generated from the graph. */
  aliases: z.array(z.array(z.string())).optional(),
  /** Reference query for gradeMode "exec". */
  referenceSql: z.string().optional(),
  /**
   * SQL with `____` placeholders. When present, the answers are substituted
   * into it to build the candidate query; when absent, the whole response is
   * treated as the query.
   */
  sqlTemplate: z.string().optional(),
  /** Entities/components this question depends on — drives weak-area rollups. */
  subjects: z.array(z.string()),
  /** Human-readable justification pointing at the source fact. */
  rationale: z.string(),
});
export type Question = z.infer<typeof Question>;

export const GradeResult = z.object({
  questionId: z.string(),
  correct: z.boolean(),
  /** What the grader actually compared, for transparency in review. */
  detail: z.string(),
});
export type GradeResult = z.infer<typeof GradeResult>;
