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
 *  - fluent/attribute: the repo wrote it, in EF's configuration API
 *  - declared: the repo wrote it, in raw DDL
 *  - convention: the framework implied it
 *  - inferred: psq guessed it from naming, and says so
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
  mirrorSource: FactSource,
});
export type Shape = z.infer<typeof Shape>;

/** An HTTP route, extracted as a fact. Questions about routes arrive in M5. */
export const Route = z.object({
  method: z.string(),
  path: z.string(),
  file: z.string(),
  line: z.number().int().nonnegative(),
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
   * Component keys (`Component.key`) this call attributes to, sorted;
   * resolved against `EntityGraph.components`. KEYS, not names: the same
   * component name recurs across directories in real repos, and a bare name
   * resolving against several entries is a fabricated fact. Empty when the
   * call is genuinely unowned (module scope, or no component reaches it
   * through the reference graph).
   */
  components: z.array(z.string()),
});
export type ClientCall = z.infer<typeof ClientCall>;

/**
 * A UI component definition, found by a stack-specific detector (today:
 * JSX + PascalCase, i.e. React). `key` is "<repo-relative file>#<name>" and
 * is what `ClientCall.components` stores — names alone are ambiguous in any
 * repo with two same-named components.
 */
export const Component = z.object({
  key: z.string(),
  name: z.string(),
  /** Repo-relative path of the declaring file. */
  file: z.string(),
  line: z.number().int().nonnegative(),
});
export type Component = z.infer<typeof Component>;

export const EntityGraph = z.object({
  kind: z.literal("entity"),
  repo: z.string(),
  /** "efcore" | "sqlite-ddl" | "none" */
  provider: z.string(),
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
  /** Non-fatal parse problems. Never silently dropped. */
  warnings: z.array(z.string()),
});
export type EntityGraph = z.infer<typeof EntityGraph>;

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
