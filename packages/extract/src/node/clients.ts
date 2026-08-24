import ts from "typescript";
import type { ClientCall, Route } from "@psq/schema";
import { isTestFile, repoRelative } from "../files.js";
import { importsExpress } from "./routes.js";

/**
 * HTTP call sites in client code, and the match against the extracted routes.
 *
 * Two rules admit a call, both heuristic and both stated as such:
 *   1. the callee is the global `fetch`, or a property access named after an
 *      HTTP verb — any receiver, so `axios.get(...)`, `api.post(...)` and
 *      hand-rolled wrappers all qualify without proving what the receiver is;
 *   2. the first argument is a string literal or a template literal whose only
 *      dynamic parts are ${} holes, and its static head starts with `/`.
 * Rule 2 is what keeps rule 1 from firing on `map.get(k)` or
 * `params.get("id")`. Everything the rules miss is catalogued on the
 * `ClientCall` schema; a miss is silent, never a warning, because a `.get(`
 * that is not a client call is not an unread construct.
 *
 * Express registrations satisfy both rules, and recording them would fabricate
 * a client call for every route and then match it to the route that produced
 * it. Two guards: a file that imports express is skipped whole, and a
 * property-access call whose second argument is an inline function (or an
 * array literal of them — a middleware chain) is rejected as a registration.
 * A bare `fetch` is different: its second argument names the method, so when
 * that argument is anything but an object literal the method is unknowable
 * and the call is skipped — defaulting to GET would fabricate a fact.
 */

/**
 * Deliberately NOT `METHODS` from routes.ts: that set includes "all", which on
 * the client side would catch `axios.all` (an alias for Promise.all).
 */
const CLIENT_METHODS = new Set([
  "get", "post", "put", "patch", "delete", "head", "options",
]);

/**
 * The literal text of a path argument with ${} holes as `*`, or null when the
 * argument is anything else. `"/api/x/" + id` is a BinaryExpression and
 * returns null — a documented miss.
 */
function literalPath(node: ts.Expression): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  if (ts.isTemplateExpression(node)) {
    return node.head.text + node.templateSpans.map((s) => `*${s.literal.text}`).join("");
  }
  return null;
}

/** `:params` become `*` so a route agrees with a call whose hole sits there. */
function normaliseRoutePath(path: string): string {
  return path.replace(/:[^/]+/g, "*");
}

/** Nearest enclosing named function, or null at module scope. */
function enclosingName(node: ts.Node): string | null {
  for (let cur = node.parent; cur; cur = cur.parent) {
    if (ts.isFunctionDeclaration(cur) && cur.name) return cur.name.text;
    if (ts.isMethodDeclaration(cur) && ts.isIdentifier(cur.name)) return cur.name.text;
    if (ts.isArrowFunction(cur) || ts.isFunctionExpression(cur)) {
      if (ts.isFunctionExpression(cur) && cur.name) return cur.name.text;
      if (ts.isVariableDeclaration(cur.parent) && ts.isIdentifier(cur.parent.name)) {
        return cur.parent.name.text;
      }
    }
  }
  return null;
}

/**
 * A bare `fetch`'s method, or null when the call must be skipped. No second
 * argument is GET. An object literal is read for a literal `method` under an
 * identifier or string-literal key; absent, GET. Everything that leaves the
 * method unknowable is null, never a guessed GET: a second argument that is
 * not an object literal at all (an identifier, a call, ...), a spread inside
 * the literal, a computed property key (which could be "method" for all the
 * reader can prove), a shorthand `{ method }` (forwarding a variable — the
 * hand-rolled-wrapper pattern), or a `method` whose value is not a string
 * literal.
 */
function fetchMethod(node: ts.CallExpression): string | null {
  const opts = node.arguments[1];
  if (opts === undefined) return "GET";
  if (!ts.isObjectLiteralExpression(opts)) return null;
  if (opts.properties.some((p) => ts.isSpreadAssignment(p) || (p.name && ts.isComputedPropertyName(p.name)))) return null;
  for (const prop of opts.properties) {
    const key =
      prop.name && (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name))
        ? prop.name.text
        : null;
    if (key !== "method") continue;
    if (
      ts.isPropertyAssignment(prop) &&
      (ts.isStringLiteral(prop.initializer) ||
        ts.isNoSubstitutionTemplateLiteral(prop.initializer))
    ) {
      return prop.initializer.text.toUpperCase();
    }
    // Shorthand, a non-literal value, or a `method() {}` member: unknowable.
    return null;
  }
  return "GET";
}

/**
 * Second Express guard, property-access calls only: an inline function — or
 * an array literal holding one, a middleware chain — as the second argument
 * is a handler, so the call is a route registration. Parentheses are
 * unwrapped first, so `(() => {})` is still a handler. An identifier or
 * object is fine: `api.post("/licenses", data)` is the standard axios
 * signature.
 */
function isRegistration(second: ts.Expression | undefined): boolean {
  if (second === undefined) return false;
  const inlineFn = (e: ts.Expression): boolean => {
    while (ts.isParenthesizedExpression(e)) e = e.expression;
    return ts.isArrowFunction(e) || ts.isFunctionExpression(e);
  };
  if (inlineFn(second)) return true;
  return (
    ts.isArrayLiteralExpression(second) &&
    second.elements.some((e) => inlineFn(e))
  );
}

export function readClientCalls(
  root: string,
  sources: readonly ts.SourceFile[],
  _warnings: string[],
): ClientCall[] {
  const out: ClientCall[] = [];

  for (const source of sources) {
    const rel = repoRelative(root, source.fileName);
    // A file that imports express registers routes; skipping it whole is the
    // first Express guard. A file doing both is a documented miss.
    if (isTestFile(rel) || importsExpress(source)) continue;

    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const callee = node.expression;
        let method: string | null = null;
        if (ts.isIdentifier(callee) && callee.text === "fetch") {
          // fetchMethod is null when the init argument leaves the method
          // unknowable; the call is then skipped, never defaulted to GET.
          method = fetchMethod(node);
        } else if (
          ts.isPropertyAccessExpression(callee) &&
          CLIENT_METHODS.has(callee.name.text) &&
          !isRegistration(node.arguments[1])
        ) {
          // The property name carries the method, so the second argument is
          // never ambiguous — recorded whatever it is, bar a handler.
          method = callee.name.text.toUpperCase();
        }

        if (method !== null && node.arguments.length > 0) {
          const raw = literalPath(node.arguments[0]!);
          if (raw !== null && raw.startsWith("/")) {
            const { line } = source.getLineAndCharacterOfPosition(node.getStart());
            out.push({
              method,
              path: raw.split("?")[0]!,
              file: rel,
              line: line + 1,
              enclosing: enclosingName(node),
              matches: null,
            });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }

  return out.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

/**
 * Decide which route each call hits, storing the decision on the fact — the
 * `pairShapes` split: pairing lives on the graph, drift stays derived.
 * A match needs equal method and equal normalised path; no baseURL inference
 * and no prefix fallback, because guessing is how a fact reader starts lying.
 * The only warning: a call whose path matches more than one route, which stays
 * unmatched and names its candidates, exactly as `pairShapes` does.
 */
export function linkCalls(
  routes: readonly Route[],
  calls: ClientCall[],
  warnings: string[],
): ClientCall[] {
  for (const call of calls) {
    const candidates = routes.filter(
      (r) => r.method === call.method && normaliseRoutePath(r.path) === call.path,
    );
    if (candidates.length === 1) {
      const route = candidates[0]!;
      call.matches = `${route.method} ${route.path}`;
    } else if (candidates.length > 1) {
      warnings.push(
        `${call.file}:${call.line}: ${call.method} ${call.path} could match ${candidates
          .map((r) => `${r.method} ${r.path}`)
          .join(" or ")}; not matched`,
      );
    }
  }
  return calls;
}
