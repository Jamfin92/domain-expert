/**
 * Typed client for the psq API.
 *
 * Note what is absent: no answers, no reference queries. The server grades, so
 * the client never holds anything it could cheat with.
 */

export interface RepoSummary {
  id: string;
  path: string;
  name: string;
  contextName: string | null;
  entities: number;
  relations: number;
  questions: number;
  warnings: string[];
  seededRows: number;
  openedAt: string;
}

export interface LayoutNode {
  name: string; x: number; y: number; width: number; height: number;
  level: number; degree: number; rowCount: number;
}
export interface LayoutEdge {
  id: string; from: string; to: string; label: string;
  required: boolean; inferred: boolean;
}
export interface Layout {
  nodes: LayoutNode[]; edges: LayoutEdge[]; width: number; height: number;
}

// Mirrored from packages/graph/src/layout3d.ts, deliberately: apps/web takes
// no workspace deps, so shapes the server sends are restated here by hand.
export type DistrictBasis = "namespace" | "dir" | "component" | "single";
export interface Layout3DNode {
  name: string; district: string; x: number; z: number;
  width: number; depth: number; height: number;
  tier: number; degree: number; rowCount: number;
}
export interface Layout3DDistrict {
  name: string; x: number; z: number; width: number; depth: number;
}
export interface Layout3DEdge {
  id: string; from: string; to: string; label: string;
  required: boolean; inferred: boolean;
  cardinality: "one-to-one" | "one-to-many" | "many-to-many";
}
export interface Layout3D {
  districtBasis: DistrictBasis;
  districts: Layout3DDistrict[];
  nodes: Layout3DNode[];
  edges: Layout3DEdge[];
  width: number; depth: number;
}

export type Section = "entity" | "client" | "ds" | "agent-entities" | "agent-client" | "agent-ds";

export interface PublicQuestion {
  id: string;
  section: Section;
  kind: "mcq" | "cloze" | "short" | "sql";
  gradeMode: "token" | "exec" | "choice";
  generator: string;
  prompt: string;
  choices?: string[];
  subjects: string[];
  templated?: boolean;
}

export interface GradeResult {
  questionId: string;
  correct: boolean;
  detail: string;
}

export interface AnswerOutcome {
  result: GradeResult;
  modelAnswer: string;
  rationale: string;
  done: boolean;
}

export interface QuizState {
  session: {
    id: string; repoId: string; total: number; index: number;
    correct: number; results: GradeResult[];
  };
  questions: PublicQuestion[];
  weakAreas: Array<{ subject: string; missed: number }>;
}

export interface EntityProperty {
  name: string; type: string; nullable: boolean; isPrimaryKey: boolean;
  isForeignKey: boolean; isNavigation: boolean; isCollection: boolean;
}
export interface Entity {
  name: string; file: string; tableName: string; dbSetName: string | null;
  keys: string[]; properties: EntityProperty[];
}
export interface Relation {
  id: string; principal: string; dependent: string;
  foreignKeyProperty: string | null; cardinality: string; required: boolean;
  deleteBehavior: string; deleteBehaviorSource: string; source: string;
}
export interface ClientCall {
  method: string; path: string; file: string; line: number;
  /** Nearest enclosing named function, or null at module scope. */
  enclosing: string | null;
  /** The matched route's raw "METHOD path", or null when unmatched. */
  matches: string | null;
  /**
   * Component keys (`UiComponent.key`) this call attributes to, sorted. Empty
   * when the call is genuinely unowned; two or more when a shared helper is
   * reached from several components.
   */
  components: string[];
}
/**
 * The server calls this `Component`. Renamed here because a bare `Component`
 * in a React codebase reads as React's own component type at every call site.
 */
export interface UiComponent {
  key: string; name: string; file: string; line: number;
}
export interface EntityGraph {
  repo: string; provider: string; contextName: string | null;
  entities: Entity[]; relations: Relation[]; warnings: string[];
  clientCalls: ClientCall[]; components: UiComponent[];
  routes: Route[]; entityRefs: EntityRef[];
}

export interface ShapeField {
  name: string; type: string; baseType: string;
  optional: boolean; isCollection: boolean;
}
export interface Drift {
  entityOnly: string[];
  shapeOnly: string[];
  /** Both spellings, because a table and its DTO rarely agree on casing. */
  shared: Array<{ column: string; field: string }>;
}
export interface Shape {
  name: string; file: string; module: string | null;
  kind: "class" | "interface" | "type-alias" | "enum" | "zod";
  fields: ShapeField[]; members: string[];
  discriminator: string | null;
  mirrors: string | null;
  /** Present only when the shape is paired; null otherwise. */
  drift: Drift | null;
}
/**
 * The method that serves a route; mirrors `Route.handler` in `@psq/schema`.
 * test/web-schema-drift.test.ts pins this interface and `Route` against the
 * schema. Optional on `Route` because the Express reader, and any older server,
 * omits it. Kept as a named interface (not inlined) so the drift parser, which
 * is brace-depth-naive, can read `Route`.
 */
export interface RouteHandler {
  type: string; method: string; file: string; line: number;
}
export interface Route {
  method: string; path: string; file: string; line: number;
  handler?: RouteHandler;
}
export interface EntityRef {
  entity: string; file: string; line: number; type: string; method: string;
  via: "entityName" | "dbSetName";
}
export interface EntitySearchHit {
  name: string; tableName: string; namespace: string | null; file: string;
  reasons: Array<{ field: string; matched: string; property: string | null }>;
}
export interface EntityRefsResult {
  entity: string; via: string | null;
  /** false = the repo has no such entity; distinct from known with zero refs. */
  known: boolean;
  refs: EntityRef[];
}

// Mirrored from packages/graph/src/areas.ts (GET /api/repos/:id/areas).
export interface AreaHandler { type: string; method: string; file: string }
export interface Area {
  key: string; label: string; basis: "route" | "handler-dir";
  /** Raw "METHOD path" strings. */
  routes: string[];
  handlers: AreaHandler[];
  /** Component keys homed here. */
  components: string[];
  entities: string[];
  /** The subset of `entities` also touched by another area. */
  sharedEntities: string[];
}
export interface AreaEdge {
  kind: "calls-route" | "touches-entity";
  from: string; to: string; evidence: string[];
}
export interface AreasResult {
  areas: Area[];
  unassigned: { routes: string[]; components: string[]; entities: string[] };
  edges: AreaEdge[];
  entityOwner: Record<string, string>;
}

// Mirrored from packages/graph/src/flow.ts (GET /api/repos/:id/flow).
export interface FlowStart { type: string; method: string; file?: string; line?: number }
export interface FlowNode {
  type: string; method: string; file: string; line: number;
  /** Calls from the start; 0 for the start itself. */
  depth: number;
  path: string[];
  /** The path here crosses an edge with several possible implementers. */
  ambiguous: boolean;
  entities: string[];
  unresolvedCalls: number;
}
export interface Flow {
  start: FlowStart; maxDepth: number; nodes: FlowNode[];
  entities: string[];
  /** The depth cap stopped the walk with methods still unreached. */
  truncated: boolean;
}
export interface RouteFlowResult {
  method: string; path: string;
  /** false = no route in the repo carries this method and path. */
  known: boolean;
  /** One per route with this key. `flow` is null when the route has no handler psq can see. */
  flows: Array<{ route: { file: string; line: number }; flow: Flow | null }>;
}

class ApiError extends Error {}

/**
 * A hosted psq requires a bearer token on every /api call. It is entered once
 * by opening the page as `/#token=<t>` and lives in this browser afterwards.
 *
 * Storage is wrapped because a browser with site data blocked throws on the
 * property access itself, and a server with no token needs none of this to
 * work — no stored token means the exact request this app always sent.
 */
const TOKEN_KEY = "psq.token";

function storedToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

/**
 * Reads `#token=…` out of the URL, remembers it, and strips the fragment.
 *
 * A fragment is never sent to the server, so the token cannot land in an
 * access log on the way in. An empty value (`/#token=`) forgets the stored
 * one, which is how you sign out of a shared machine.
 */
export function adoptTokenFromFragment(): void {
  try {
    // The leading "#" must go: URLSearchParams would read it as part of the
    // first key and "#token" is not "token".
    const params = new URLSearchParams(location.hash.slice(1));
    const token = params.get("token");
    if (token === null) return;
    try {
      if (token === "") localStorage.removeItem(TOKEN_KEY);
      else localStorage.setItem(TOKEN_KEY, token);
    } catch {
      // Storage unavailable: the token simply is not remembered.
    }
    history.replaceState(null, "", location.pathname + location.search);
  } catch {
    // A malformed fragment must never stop the app from rendering.
  }
}

/** Shown on a 401, because "Request failed (401)" tells nobody what to do. */
const NEEDS_TOKEN =
  "This server requires a token. Open it once as /#token=<your PSQ_TOKEN>; " +
  "the token is then remembered in this browser.";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const token = storedToken();
  const res = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const message =
      res.status === 401
        ? NEEDS_TOKEN
        : body && typeof body === "object" && "error" in body
          ? String((body as { error: unknown }).error)
          : `Request failed (${res.status})`;
    throw new ApiError(message);
  }
  return body as T;
}

export const api = {
  health: () => call<{ ok: boolean; repos: number }>("/api/health"),

  listRepos: () => call<{ repos: RepoSummary[] }>("/api/repos"),

  openRepo: (path: string, opts: { seed?: number; rows?: number } = {}) =>
    call<{ repo: RepoSummary }>("/api/repos", {
      method: "POST",
      body: JSON.stringify({ path, ...opts }),
    }),

  closeRepo: (id: string) =>
    call<{ closed: boolean }>(`/api/repos/${id}`, { method: "DELETE" }),

  graph: (id: string) => call<{ graph: EntityGraph }>(`/api/repos/${id}/graph`),

  search: (id: string, q: string) =>
    call<{ query: string; searched: string[]; hits: EntitySearchHit[] }>(
      `/api/repos/${id}/search?q=${encodeURIComponent(q)}`,
    ),

  refs: (id: string, entity: string) =>
    call<EntityRefsResult>(`/api/repos/${id}/refs?entity=${encodeURIComponent(entity)}`),

  areas: (id: string) => call<AreasResult>(`/api/repos/${id}/areas`),

  flow: (id: string, method: string, path: string) =>
    call<RouteFlowResult>(
      `/api/repos/${id}/flow?method=${encodeURIComponent(method)}&path=${encodeURIComponent(path)}`,
    ),

  layout: (id: string) => call<{ layout: Layout }>(`/api/repos/${id}/layout`),
  layout3d: (id: string) => call<{ layout3d: Layout3D }>(`/api/repos/${id}/layout3d`),

  questions: (id: string) =>
    call<{
      total: number;
      byGenerator: Record<string, number>;
      byKind: Record<string, number>;
      bySection: Record<string, number>;
      subjects: string[];
    }>(`/api/repos/${id}/questions`),

  shapes: (id: string) =>
    call<{ shapes: Shape[]; routes: Route[] }>(`/api/repos/${id}/shapes`),

  selftest: (id: string) =>
    call<{ ok: boolean; findings: Array<{ questionId: string; generator: string; problem: string }> }>(
      `/api/repos/${id}/selftest`,
    ),

  startQuiz: (id: string, n: number, opts: { seed?: number; sections?: Section[] } = {}) =>
    call<{ session: { id: string; total: number }; questions: PublicQuestion[] }>(
      `/api/repos/${id}/quiz`,
      { method: "POST", body: JSON.stringify({ n, ...opts }) },
    ),

  quizState: (sessionId: string) => call<QuizState>(`/api/quiz/${sessionId}`),

  answer: (sessionId: string, questionId: string, answer: string) =>
    call<AnswerOutcome>(`/api/quiz/${sessionId}/answer`, {
      method: "POST",
      body: JSON.stringify({ questionId, answer }),
    }),
};
