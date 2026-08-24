/**
 * The client half. No axios — it is not a dependency of this repo — so the
 * "shared instance" shape real clients use is a hand-rolled `api` object.
 * No express import, so the client reader walks this file.
 */

/**
 * Wrapper methods, axios-style. The fetch inside each receives a parameter,
 * never a literal — a documented miss the reader stays silent about. The
 * `api.get("/...")` call sites below are what it records instead.
 */
export const api = {
  get(path: string): Promise<Response> {
    return fetch(path);
  },
  post(path: string, body: unknown): Promise<Response> {
    return fetch(path, { method: "POST", body: JSON.stringify(body) });
  },
};

/** Direct fetch with no options: GET by default. */
export function listItems(): Promise<Response> {
  return fetch("/api/items");
}

/** Direct fetch with an explicit method: the option wins over the default. */
export function createItem(body: unknown): Promise<Response> {
  return fetch("/api/items", { method: "POST", body: JSON.stringify(body) });
}

/** Template-literal path; the ${} hole must agree with the route's :id. */
export const itemById = (id: string): Promise<Response> => fetch(`/api/items/${id}`);

/** Axios-style call through the hand-rolled instance. */
export function checkHealth(): Promise<Response> {
  return api.get("/health");
}

/** Matches no route: recorded, `matches` stays null, and no warning. */
export function submitOrder(qty: number): Promise<Response> {
  return api.post("/api/orders", { qty });
}

/** Module scope, with a query string that is split off before matching. */
export const firstPage = fetch("/api/items?limit=10");

/** A URL built at runtime is not a literal: silently ignored. */
export function fetchFrom(url: string): Promise<Response> {
  return fetch(url);
}

/** Concatenation is a BinaryExpression: rejected outright, silently. */
export function concatenated(id: string): Promise<Response> {
  return fetch("/api/items/" + id);
}

/**
 * Identifier body — the standard axios signature (`api.post(url, data)`).
 * The method comes from the property name, so the second argument is never
 * ambiguous: this MUST be recorded.
 */
export function replaceItems(body: unknown): Promise<Response> {
  return api.post("/api/items", body);
}

/**
 * Identifier init on a bare fetch: the method is unknowable, so the call is
 * skipped — a documented miss. Defaulting to GET would fabricate a fact.
 */
export function withInit(init: RequestInit): Promise<Response> {
  return fetch("/api/orders", init);
}

/** A `.get(...)` that is not HTTP. Rule 2 (leading slash) keeps it out. */
export function decoy(): number | undefined {
  const cache = new Map<string, number>();
  cache.set("total", 1);
  return cache.get("total");
}

/**
 * A router-shaped registration in a file with no express import — the case
 * the file skip cannot see. The inline handler as second argument is what
 * marks it a registration; the handler-argument guard must reject it.
 */
export const bus = {
  get(_path: string, _handler: () => void): void {},
};
export function registerLocal(): void {
  bus.get("/local/route", () => {});
}

/**
 * Shorthand `method` forwards a variable — how a hand-rolled fetch wrapper
 * passes its argument through. The method is unknowable, so the call is
 * skipped, never fabricated as a GET.
 */
export function forward(method: string, body: string): Promise<Response> {
  return fetch("/api/orders", { method, body });
}

/** A string-literal key is still a literal `method`: read as POST, recorded. */
export function quotedKey(body: unknown): Promise<Response> {
  return fetch("/api/items", { "method": "POST", body: JSON.stringify(body) });
}

/**
 * A spread AFTER the literal method: `opts` can carry `method: "POST"`, so
 * the written GET proves nothing. The call is skipped, never recorded as the
 * GET that appears first.
 */
export function spreadLast(opts: RequestInit): Promise<Response> {
  return fetch("/api/items", { method: "GET", ...opts });
}

/**
 * A computed key AFTER the literal method: `k` can be "method" for all the
 * reader can prove, so the written GET proves nothing. Skipped, same as the
 * spread.
 */
export function computedLast(k: string, v: string): Promise<Response> {
  return fetch("/api/items", { method: "GET", [k]: v });
}
