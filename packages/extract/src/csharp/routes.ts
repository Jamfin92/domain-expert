import type { Route } from "@psq/schema";
import { lex } from "./lex.js";
import type { AttributeRef, FileParse, MethodDecl, TypeDecl } from "./structure.js";

/**
 * ASP.NET Core attribute routing, read from the structural parse.
 *
 * Attribute routes are the only form psq reads. Everything else that can put an
 * HTTP route on a .NET app -- conventional routing, minimal APIs, `[AcceptVerbs]`,
 * areas -- is reported through `warnings` and produces no route. A missing route
 * costs one question; a guessed route costs the premise of the tool.
 *
 * Route paths keep ASP.NET's own syntax (`/api/courses/{id:int}`): the leading
 * slash is added, parameters and constraints are left as written. Reconciling
 * that with a TypeScript client's `${id}` is the matcher's job (`linkCalls`),
 * not this file's.
 */

const VERBS: Record<string, string> = {
  HttpGet: "GET",
  HttpPost: "POST",
  HttpPut: "PUT",
  HttpDelete: "DELETE",
  HttpPatch: "PATCH",
  HttpHead: "HEAD",
  HttpOptions: "OPTIONS",
};

/** `Microsoft.AspNetCore.Mvc.HttpGetAttribute` -> `HttpGet`. */
function attrKey(a: AttributeRef): string {
  let n = a.name.slice(a.name.lastIndexOf(".") + 1);
  if (n.endsWith("Attribute") && n.length > "Attribute".length) n = n.slice(0, -"Attribute".length);
  return n;
}

type Template = { kind: "none" } | { kind: "literal"; value: string } | { kind: "unreadable" };

/** A plain `"..."` literal's content, or null for anything psq will not evaluate. */
function plainString(raw: string): string | null {
  if (raw.length < 2 || !raw.startsWith('"') || !raw.endsWith('"')) return null;
  const inner = raw.slice(1, -1);
  if (inner.includes('"') || inner.includes("\\")) return null; // concatenation, raw string, escapes
  return inner;
}

/** The route template an attribute carries: positional first argument or `Template = "..."`. */
function templateOf(a: AttributeRef): Template {
  const named = a.args.find((x) => /^Template=/.test(x));
  if (named) {
    const v = plainString(named.slice("Template=".length));
    return v === null ? { kind: "unreadable" } : { kind: "literal", value: v };
  }
  const first = a.args[0];
  if (first === undefined || /^[A-Za-z_]\w*=(?!=)/.test(first)) return { kind: "none" };
  const v = plainString(first);
  return v === null ? { kind: "unreadable" } : { kind: "literal", value: v };
}

function short(name: string): string {
  const head = name.split("<")[0]!;
  return head.slice(head.lastIndexOf(".") + 1);
}

/**
 * Substitute `[controller]` / `[action]`. Text inside `{...}` is left alone (a
 * regex constraint may contain brackets); `[[` and `]]` are escapes for literal
 * brackets. Returns a string for an unknown token instead of guessing.
 */
function substitute(
  template: string,
  tokens: { controller: string; action: string; actionSafe: boolean },
): { value: string } | { error: string } {
  let out = "";
  let depth = 0;
  for (let i = 0; i < template.length; i++) {
    const c = template[i]!;
    if (c === "{") depth++;
    if (c === "}") depth = Math.max(0, depth - 1);
    if (depth > 0) {
      out += c;
      continue;
    }
    if (c === "[") {
      if (template[i + 1] === "[") {
        out += "[";
        i++;
        continue;
      }
      const end = template.indexOf("]", i);
      if (end === -1) return { error: `unterminated token in template "${template}"` };
      const name = template.slice(i + 1, end);
      if (name === "controller") out += tokens.controller;
      else if (name === "action") {
        if (!tokens.actionSafe) {
          return {
            error:
              "template uses [action] on a method ending in Async; MVC may trim that suffix " +
              "depending on a framework option psq cannot see",
          };
        }
        out += tokens.action;
      } else return { error: `unsupported token [${name}] in template "${template}"` };
      i = end;
      continue;
    }
    if (c === "]" && template[i + 1] === "]") {
      out += "]";
      i++;
      continue;
    }
    out += c;
  }
  return { value: out };
}

/** ASP.NET's `AttributeRouteModel.CombineTemplates`, minus the cases psq refuses. */
export function combineTemplates(cls: string | null, action: string | null): string {
  const a = action ?? "";
  if (a.startsWith("/") || a.startsWith("~/")) return a.replace(/^~?\//, "");
  const c = cls ?? "";
  if (c === "") return a;
  if (a === "") return c;
  return `${c.replace(/\/+$/, "")}/${a}`;
}

function toPath(template: string): string {
  const t = template.replace(/^~?\/+/, "").replace(/\/+$/, "");
  return `/${t}`;
}

export interface RouteReadResult {
  routes: Route[];
  warnings: string[];
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function readAspNetRoutes(parses: FileParse[]): RouteReadResult {
  const warnings: string[] = [];
  const routes: Route[] = [];

  const classes = new Map<string, TypeDecl[]>();
  for (const p of parses) {
    for (const t of p.types) {
      if (t.keyword !== "class") continue;
      const list = classes.get(t.name) ?? [];
      list.push(t);
      classes.set(t.name, list);
    }
  }

  /** Attributes of a class, unioned across its `partial` declarations. */
  const classAttrs = (t: TypeDecl): AttributeRef[] => {
    if (!t.modifiers.includes("partial")) return t.attributes;
    return (classes.get(t.name) ?? [t])
      .filter((o) => o.modifiers.includes("partial") && o.namespace === t.namespace)
      .flatMap((o) => o.attributes);
  };

  const localBase = (t: TypeDecl): TypeDecl | null => {
    for (const b of t.bases) {
      const hit = classes.get(short(b));
      if (hit && hit.length === 1 && hit[0] !== t) return hit[0]!;
    }
    return null;
  };

  const isController = (t: TypeDecl, depth = 0): boolean => {
    if (t.name.endsWith("Controller")) return true;
    if (classAttrs(t).some((a) => attrKey(a) === "ApiController")) return true;
    if (t.bases.some((b) => short(b) === "ControllerBase" || short(b) === "Controller")) return true;
    if (depth > 6) return false;
    const base = localBase(t);
    return base !== null && isController(base, depth + 1);
  };

  /** A repo-local ancestor that declares a class `[Route]`, if the class has none itself. */
  const inheritedRoute = (t: TypeDecl, depth = 0): TypeDecl | null => {
    if (depth > 6) return null;
    const base = localBase(t);
    if (!base) return null;
    if (classAttrs(base).some((a) => attrKey(a) === "Route")) return base;
    return inheritedRoute(base, depth + 1);
  };

  for (const parse of parses) {
    for (const t of parse.types) {
      if (t.keyword !== "class" || t.modifiers.includes("static")) continue;
      if (!isController(t)) continue;

      const attrs = classAttrs(t);
      const loc = `${parse.file}:${t.line}`;
      const routeAttrs = attrs.filter((a) => attrKey(a) === "Route");
      const actionish = (m: MethodDecl): boolean =>
        m.attributes.some((a) => {
          const k = attrKey(a);
          return k in VERBS || k === "Route" || k === "AcceptVerbs";
        });

      if (t.modifiers.includes("abstract")) {
        if (t.methods.some(actionish)) {
          warnings.push(
            `${loc}: abstract controller ${t.name} declares actions; actions inherited by ` +
              "derived controllers are not read",
          );
        }
        continue;
      }

      if (attrs.some((a) => attrKey(a) === "Area")) {
        warnings.push(`${loc}: controller ${t.name} is in an area ([Area]); area routes are not read`);
        continue;
      }
      if (routeAttrs.length === 0) {
        const from = inheritedRoute(t);
        if (from) {
          warnings.push(
            `${loc}: controller ${t.name} inherits [Route] from ${from.name}; inherited class ` +
              "routes are not read",
          );
          continue;
        }
      }

      const classTemplates: Array<string | null> = [];
      let classOk = true;
      for (const a of routeAttrs) {
        const tpl = templateOf(a);
        if (tpl.kind === "unreadable") {
          warnings.push(`${parse.file}:${a.line}: [Route] on ${t.name} has a template that is not a plain string literal; controller routes not read`);
          classOk = false;
        } else classTemplates.push(tpl.kind === "literal" ? tpl.value : "");
      }
      if (!classOk) continue;
      if (classTemplates.length === 0) classTemplates.push(null);

      const controllerName =
        t.name.endsWith("Controller") && t.name.length > "Controller".length
          ? t.name.slice(0, -"Controller".length)
          : t.name;

      for (const m of t.methods) {
        const mloc = `${parse.file}:${m.line}`;
        if (!m.modifiers.includes("public") || m.modifiers.includes("static")) continue;
        if (m.attributes.some((a) => attrKey(a) === "NonAction")) continue;

        if (m.attributes.some((a) => attrKey(a) === "AcceptVerbs")) {
          warnings.push(`${mloc}: ${t.name}.${m.name} uses [AcceptVerbs]; the route was not read`);
          continue;
        }

        const verbAttrs = m.attributes.filter((a) => attrKey(a) in VERBS);
        const methodRoutes = m.attributes.filter((a) => attrKey(a) === "Route");

        if (verbAttrs.length === 0 && methodRoutes.length === 0) {
          if (routeAttrs.length > 0) {
            warnings.push(
              `${mloc}: public method ${t.name}.${m.name} has no HTTP method attribute; ` +
                "whether it is an action under the class [Route] was not decided",
            );
          }
          continue;
        }

        interface Selector { verbs: string[]; template: string | null; line: number }
        const selectors: Selector[] = [];
        const bareVerbs: string[] = [];
        let bareLine = m.line;
        let bad = false;

        for (const a of verbAttrs) {
          const verb = VERBS[attrKey(a)]!;
          const tpl = templateOf(a);
          if (tpl.kind === "unreadable") {
            warnings.push(`${parse.file}:${a.line}: ${t.name}.${m.name} has a template that is not a plain string literal; route not read`);
            bad = true;
          } else if (tpl.kind === "literal") selectors.push({ verbs: [verb], template: tpl.value, line: a.line });
          else {
            bareVerbs.push(verb);
            bareLine = a.line;
          }
        }
        for (const a of methodRoutes) {
          const tpl = templateOf(a);
          if (tpl.kind === "unreadable") {
            warnings.push(`${parse.file}:${a.line}: ${t.name}.${m.name} has a template that is not a plain string literal; route not read`);
            bad = true;
          } else if (bareVerbs.length === 0) {
            warnings.push(`${parse.file}:${a.line}: ${t.name}.${m.name} has [Route] and no HTTP method attribute, so it accepts every verb; route not read`);
            bad = true;
          } else selectors.push({ verbs: bareVerbs, template: tpl.kind === "literal" ? tpl.value : "", line: a.line });
        }
        if (bad) continue;
        if (selectors.length === 0 && methodRoutes.length === 0 && bareVerbs.length > 0) {
          selectors.push({ verbs: bareVerbs, template: null, line: bareLine });
        }

        const nameAttr = m.attributes.find((a) => attrKey(a) === "ActionName");
        let actionName = m.name;
        if (nameAttr) {
          const v = nameAttr.args[0] === undefined ? null : plainString(nameAttr.args[0]);
          if (v === null) {
            warnings.push(`${mloc}: ${t.name}.${m.name} has an [ActionName] that is not a plain string literal; route not read`);
            continue;
          }
          actionName = v;
        }

        for (const cls of classTemplates) {
          for (const sel of selectors) {
            const combined = combineTemplates(cls, sel.template);
            const sub = substitute(combined, {
              controller: controllerName,
              action: actionName,
              actionSafe: nameAttr !== undefined || !m.name.endsWith("Async"),
            });
            if ("error" in sub) {
              warnings.push(`${parse.file}:${sel.line}: ${t.name}.${m.name}: ${sub.error}; route not read`);
              continue;
            }
            for (const verb of sel.verbs) {
              routes.push({
                method: verb,
                path: toPath(sub.value),
                file: parse.file,
                line: sel.line,
                handler: { type: t.name, method: m.name, file: parse.file, line: m.line },
              });
            }
          }
        }
      }
    }
  }

  routes.sort(
    (a, b) =>
      cmp(a.file, b.file) || a.line - b.line || cmp(a.method, b.method) || cmp(a.path, b.path),
  );
  return { routes, warnings };
}

const MINIMAL = new Set(["MapGet", "MapPost", "MapPut", "MapDelete", "MapPatch", "MapMethods"]);
const CONVENTIONAL = new Set([
  "MapControllerRoute", "MapDefaultControllerRoute", "MapAreaControllerRoute",
  "UseMvc", "UseMvcWithDefaultRoute",
]);

/**
 * Registrations that put routes on the app without an attribute. Token-based, so
 * a name in a comment or string never fires; requires a `.` before the name and a
 * `(` after, so a method DECLARED with one of these names does not either. Runs
 * over the lexed source because top-level statements (`Program.cs`) are not types.
 */
export function scanUnattributedRouting(src: string, file: string): string[] {
  if (!/Map(Get|Post|Put|Delete|Patch|Methods|ControllerRoute|DefaultControllerRoute|AreaControllerRoute)|UseMvc/.test(src)) {
    return [];
  }
  const out: string[] = [];
  const toks = lex(src);
  for (let i = 1; i < toks.length - 1; i++) {
    const t = toks[i]!;
    if (toks[i - 1]!.text !== "." || toks[i + 1]!.text !== "(") continue;
    if (MINIMAL.has(t.text)) {
      out.push(`${file}:${t.line}: minimal API ${t.text}(...) is not read; routes registered this way are not extracted`);
    } else if (CONVENTIONAL.has(t.text)) {
      out.push(`${file}:${t.line}: conventional routing ${t.text}(...) is not read; routes registered this way are not extracted`);
    }
  }
  return out;
}
