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
 * EF's DeleteBehavior set. `source` matters: corpus-repo-a declares no
 * OnDelete at all, so its behavior is derived from EF convention (required FK
 * => Cascade, optional => ClientSetNull). corpus-repo-b declares seven
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

export const FactSource = z.enum(["fluent", "attribute", "convention", "inferred"]);
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

export const EntityGraph = z.object({
  kind: z.literal("entity"),
  repo: z.string(),
  /** "efcore" | "sqlite-ddl" | "sqlalchemy" */
  provider: z.string(),
  contextName: z.string().nullable(),
  entities: z.array(Entity),
  relations: z.array(Relation),
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
