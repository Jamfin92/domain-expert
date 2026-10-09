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
 * A base prefix the client carries outside the call's own path: an axios
 * instance's `baseURL`, or a `const X = "/api"` heading a template literal.
 * Kept off the schema on purpose: `ClientCall.path` stays the literal text at
 * the call site. Read only by `linkCalls`, as a second attempt after the
 * literal path finds nothing. `mergeGraphs` copies calls, so it re-registers
 * the prefix on each copy.
 */
const basePrefixes = new WeakMap<ClientCall, string>();
export const basePrefixOf = (c: ClientCall): string | undefined => basePrefixes.get(c);
export const setBasePrefix = (c: ClientCall, prefix: string): void => {
  if (prefix !== "") basePrefixes.set(c, prefix);
};

/** A statically readable base, or the source text of one that is not. */
type Base = { prefix: string } | { unreadable: string };

/** `"/api/"` -> `"/api"`; null when the text cannot head a path (not "" or "/..."). */
function cleanPrefix(text: string): string | null {
  if (text !== "" && !text.startsWith("/")) return null;
  return text.replace(/\/+$/, "");
}

/** The variable declaration an identifier resolves to, through imports. */
function variableDeclaration(expr: ts.Expression, checker: ts.TypeChecker): ts.VariableDeclaration | null {
  if (!ts.isIdentifier(expr)) return null;
  let sym = checker.getSymbolAtLocation(expr);
  if (sym && sym.flags & ts.SymbolFlags.Alias) sym = checker.getAliasedSymbol(sym);
  const decl = sym?.valueDeclaration;
  return decl && ts.isVariableDeclaration(decl) && decl.parent.flags & ts.NodeFlags.Const ? decl : null;
}

/** A string literal, or an identifier that is a `const` bound to one. */
function stringValue(expr: ts.Expression, checker: ts.TypeChecker): string | null {
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) return expr.text;
  const init = variableDeclaration(expr, checker)?.initializer;
  if (init && (ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init))) return init.text;
  return null;
}

/**
 * The base of `X` in `const X = axios.create({ baseURL })`, or null when `X` is
 * not such an instance. An object with a spread or a computed key may carry a
 * baseURL the reader cannot see, so it is unreadable rather than "no base".
 */
function instanceBase(receiver: ts.Expression, checker: ts.TypeChecker): Base | null {
  const init = variableDeclaration(receiver, checker)?.initializer;
  if (
    !init ||
    !ts.isCallExpression(init) ||
    !ts.isPropertyAccessExpression(init.expression) ||
    init.expression.name.text !== "create" ||
    !ts.isIdentifier(init.expression.expression) ||
    init.expression.expression.text !== "axios"
  ) {
    return null;
  }
  const config = init.arguments[0];
  if (config === undefined) return { prefix: "" };
  if (!ts.isObjectLiteralExpression(config)) return { unreadable: config.getText() };
  let found: Base = { prefix: "" };
  for (const prop of config.properties) {
    if (ts.isSpreadAssignment(prop)) return { unreadable: prop.getText() };
    const key = prop.name && (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name)) ? prop.name.text : null;
    if (key === null) return { unreadable: prop.getText() };
    if (key !== "baseURL") continue;
    if (!ts.isPropertyAssignment(prop)) return { unreadable: prop.getText() };
    const text = stringValue(prop.initializer, checker);
    const prefix = text === null ? null : cleanPrefix(text);
    found = prefix === null ? { unreadable: prop.initializer.getText() } : { prefix };
  }
  return found;
}

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

/**
 * `:params` (Express) and `{params}` (ASP.NET, including constraints such as
 * `{id:int}`, `{id?}` and `{*rest}`) become `*` so a route agrees with a call
 * whose hole sits there. Braces are scanned with a depth counter because a
 * constraint may itself contain braces: `{code:regex(^\d{3}$)}`.
 */
export function normaliseRoutePath(path: string, aspnet = false): string {
  // Braces are ASP.NET syntax only. In an Express 5 path `{/:id}` is an
  // optional group, so rewriting it would change what node routes match.
  if (!aspnet) return path.replace(/:[^/]+/g, "*");
  let out = "";
  let depth = 0;
  for (const c of path) {
    if (c === "{") {
      if (depth === 0) out += "*";
      depth++;
    } else if (c === "}" && depth > 0) depth--;
    else if (depth === 0) out += c;
  }
  return out.replace(/:[^/]+/g, "*");
}

/**
 * Nearest enclosing named function, or null at module scope. The named forms:
 * function declarations (an anonymous `export default function () {}` is
 * "default"), methods, constructors ("constructor"), get/set-accessors, named
 * function expressions, and arrows/function expressions whose name comes from
 * the binding site — a variable, an object-literal property, a class
 * property, or `export default` ("default"). An arrow bound to none of those
 * (an inline callback argument, say) contributes no name and the walk
 * continues outward, exactly as before.
 */
function enclosingName(node: ts.Node): string | null {
  for (let cur = node.parent; cur; cur = cur.parent) {
    if (ts.isFunctionDeclaration(cur)) return cur.name?.text ?? "default";
    if (ts.isMethodDeclaration(cur) && ts.isIdentifier(cur.name)) return cur.name.text;
    if (ts.isConstructorDeclaration(cur)) return "constructor";
    if (
      (ts.isGetAccessorDeclaration(cur) || ts.isSetAccessorDeclaration(cur)) &&
      ts.isIdentifier(cur.name)
    ) {
      return cur.name.text;
    }
    if (ts.isArrowFunction(cur) || ts.isFunctionExpression(cur)) {
      if (ts.isFunctionExpression(cur) && cur.name) return cur.name.text;
      const holder = cur.parent;
      if (ts.isVariableDeclaration(holder) && ts.isIdentifier(holder.name)) {
        return holder.name.text;
      }
      if (
        (ts.isPropertyAssignment(holder) || ts.isPropertyDeclaration(holder)) &&
        (ts.isIdentifier(holder.name) || ts.isStringLiteral(holder.name))
      ) {
        return holder.name.text;
      }
      if (ts.isExportAssignment(holder)) return "default";
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
  warnings: string[],
  /**
   * Filled with the AST node of every recorded call, for the attribution
   * pass (`refs.ts`) that runs after matching. The node never enters the
   * schema; `components` on the call is what survives.
   */
  callNodes?: Map<ClientCall, ts.CallExpression>,
  /** Resolves instance and const bases; without it no base is read. */
  checker?: ts.TypeChecker,
): ClientCall[] {
  const out: ClientCall[] = [];
  const warnedBases = new Set<string>();
  const warnBase = (text: string, where: string): void => {
    if (warnedBases.has(text)) return;
    warnedBases.add(text);
    warnings.push(
      `${where}: client base \`${text}\` is not a statically readable path prefix; ` +
        "calls through it may be unmatched",
    );
  };

  for (const source of sources) {
    const rel = repoRelative(root, source.fileName);
    // A file that imports express registers routes; skipping it whole is the
    // first Express guard. A file doing both is a documented miss.
    if (isTestFile(rel) || importsExpress(source)) continue;

    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const callee = node.expression;
        let method: string | null = null;
        let viaFetch = false;
        if (ts.isIdentifier(callee) && callee.text === "fetch") {
          viaFetch = true;
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
          const arg = node.arguments[0]!;
          const { line } = source.getLineAndCharacterOfPosition(node.getStart());
          let raw = literalPath(arg);
          let prefix = "";
          let readable = true;

          // The receiver's own base, when it is an axios instance.
          const inst =
            checker && ts.isPropertyAccessExpression(callee)
              ? instanceBase(callee.expression, checker)
              : null;
          if (inst) {
            if ("prefix" in inst) prefix = inst.prefix;
            else warnBase(inst.unreadable, `${rel}:${line + 1}`);
          }

          // `${BASE}/x`: a template whose head hole is a base.
          if (
            checker &&
            ts.isTemplateExpression(arg) &&
            arg.head.text === "" &&
            arg.templateSpans.length > 0
          ) {
            const [first, ...others] = arg.templateSpans;
            const rest = first!.literal.text + others.map((s) => `*${s.literal.text}`).join("");
            if (rest.startsWith("/")) {
              const value = stringValue(first!.expression, checker);
              const head = value === null ? null : cleanPrefix(value);
              if (head !== null) {
                raw = rest;
                prefix += head;
              } else {
                // Only a fetch or an instance call is surely a client call;
                // map.get(`${k}/a`) is not an unread construct.
                if (viaFetch || inst) warnBase(first!.expression.getText(), `${rel}:${line + 1}`);
                readable = false;
              }
            }
          }

          if (readable && raw !== null && raw.startsWith("/")) {
            const call: ClientCall = {
              method,
              path: raw.split("?")[0]!,
              file: rel,
              line: line + 1,
              enclosing: enclosingName(node),
              matches: null,
              // Overwritten for every call by the attribution pass; [] here
              // is "attribution has not run", not a finding.
              components: [],
            };
            setBasePrefix(call, prefix);
            out.push(call);
            callNodes?.set(call, node);
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
 * A match needs equal method and equal normalised path. A base prefix is used
 * only when the client statically declared one (`basePrefixOf`: an axios
 * `baseURL` literal or a const heading a template) and only AFTER the literal
 * path found no route; a base that is undeclared or unreadable is never
 * inferred from the routes, because guessing is how a fact reader starts lying.
 * The only warning: a call whose path matches more than one route, which stays
 * unmatched and names its candidates, exactly as `pairShapes` does.
 */
export function linkCalls(
  routes: readonly Route[],
  calls: ClientCall[],
  warnings: string[],
  opts: { aspnet?: boolean } = {},
): ClientCall[] {
  // `aspnet`: `{param}` syntax, and case-insensitive paths. ASP.NET routing is
  // case-insensitive and `[controller]` substitutes the class name as written,
  // so `/api/Courses` must meet a client's `/api/courses`. Opt-in: the Express
  // default (exact, `:param` only) is unchanged.
  const aspnet = opts.aspnet === true;
  const fold = (s: string): string => (aspnet ? s.toLowerCase() : s);
  for (const call of calls) {
    const find = (path: string): Route[] =>
      routes.filter(
        (r) => r.method === call.method && fold(normaliseRoutePath(r.path, aspnet)) === fold(path),
      );
    let candidates = find(call.path);
    let shown = call.path;
    const base = basePrefixOf(call);
    if (candidates.length === 0 && base !== undefined) {
      shown = base + call.path;
      candidates = find(shown);
    }
    if (candidates.length === 1) {
      const route = candidates[0]!;
      call.matches = `${route.method} ${route.path}`;
    } else if (candidates.length > 1) {
      warnings.push(
        `${call.file}:${call.line}: ${call.method} ${shown} could match ${candidates
          .map((r) => `${r.method} ${r.path}`)
          .join(" or ")}; not matched`,
      );
    }
  }
  return calls;
}
