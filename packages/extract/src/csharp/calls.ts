import type { Call, CallSite, UnresolvedCalls } from "@psq/schema";
import type { Token } from "./lex.js";
import type { FileParse, MethodDecl, TypeDecl } from "./structure.js";

/**
 * A method-to-method call graph over the repo's own C#, read from tokens.
 *
 * ## What is resolved
 *
 * Only a call whose target can be named from the text alone:
 *   - `this.M(` and a bare `M(`: a method of the same type, its partial parts,
 *     or a repo-declared base class;
 *   - `x.M(` where `x` is a method parameter, a field, a property (which is how
 *     a primary-constructor parameter arrives) or a local that is TRIVIALLY
 *     typed (`var x = new T(`, `T x ...`), and whose declared type is a
 *     repo-declared class or interface. This is the DI pattern: the field
 *     `private readonly IFoo _foo;` is typed by its declaration, and the
 *     constructor assignment `_foo = foo;` adds nothing the declaration lacks;
 *   - `T.M(` where `T` is a repo-declared type and `M` is `static` there.
 * Through an interface the edge goes to the interface member AND to every repo
 * implementer that declares the method: one implementer is linked plainly,
 * several are linked all with `ambiguous: true`.
 *
 * ## What is not
 *
 * Everything else is counted per method (`UnresolvedCalls`), never guessed and
 * never warned about per call — most are framework calls (`Ok(`, `ToList(`).
 * That includes chained calls (`a.b.M(`, `f().M(`), extension methods, a
 * receiver whose name a local we cannot type shadows, a type name declared
 * twice (outside `partial`), generic repo types matched only by exact text,
 * `base.M(`, virtual dispatch to a subclass, and delegates.
 *
 * ## Overloads
 *
 * psq does no overload resolution. A node is `type` + method NAME: every
 * overload is one node, and `to.line` is the first overload's declaration.
 * That is the same key `EntityRef` joins on, so the two stay consistent.
 *
 * Calls made from constructors and property accessors are not read: the
 * structure reader does not capture those bodies as methods.
 */

interface Group {
  name: string;
  keyword: string;
  parts: Array<{ decl: TypeDecl; file: string }>;
}

const TYPE_KEYWORDS = new Set([
  "bool", "byte", "char", "decimal", "double", "float", "int", "long", "object",
  "sbyte", "short", "string", "uint", "ulong", "ushort", "void",
]);
/** Words that precede `(` without being a call to a repo method. */
const NOT_CALLS = new Set(["nameof", "when", "await", "yield", "var", "dynamic", "from", "where", "select"]);
/** An ident here before a name is NOT a type: `await M(`, `yield ...`. */
const NOT_A_TYPE = new Set(["await", "yield", "var", "from", "where", "select", "not", "and", "or"]);
const DECL_NEXT = new Set(["=", ";", ",", ")", "in"]);

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** `Ns.IFoo<Bar>?` -> `IFoo<Bar>`; the exact text two sites must share to name one type. */
function typeKey(text: string): string {
  let t = text.replace(/\s+/g, "");
  if (t.endsWith("?")) t = t.slice(0, -1);
  const lt = t.indexOf("<");
  const head = lt === -1 ? t : t.slice(0, lt);
  const dot = head.lastIndexOf(".");
  return (dot === -1 ? head : head.slice(dot + 1)) + (lt === -1 ? "" : t.slice(lt));
}

function headOf(key: string): string {
  const lt = key.indexOf("<");
  return lt === -1 ? key : key.slice(0, lt);
}

/** Index just past a balanced generic argument list starting at `j` (`<`), or -1. */
function skipGenericArgs(body: Token[], j: number): number {
  let depth = 0;
  for (let k = j; k < body.length; k++) {
    const t = body[k]!;
    if (t.text === "<") depth++;
    else if (t.text === ">") depth--;
    else if (t.text === ">>") depth -= 2;
    else if (
      !(t.kind === "ident" || t.kind === "keyword" || [",", ".", "?", "[", "]"].includes(t.text))
    ) {
      return -1;
    }
    if (depth === 0) return k + 1;
    if (depth < 0) return -1;
  }
  return -1;
}

/**
 * Local declarations in a body, name -> type name, or null when the name is
 * declared in a way this reader cannot type (or twice with different types).
 * A null entry still shadows a field of the same name, which is the point.
 */
function scanLocals(body: Token[]): { locals: Map<string, string | null>; localFns: Set<string> } {
  const locals = new Map<string, string | null>();
  const localFns = new Set<string>();
  const put = (name: string, type: string | null): void => {
    if (!locals.has(name)) locals.set(name, type);
    else if (locals.get(name) !== type) locals.set(name, null);
  };
  for (let i = 1; i < body.length - 1; i++) {
    const t = body[i]!;
    if (t.kind !== "ident") continue;
    const prev = body[i - 1]!;
    const next = body[i + 1]!;
    const prevIsType =
      (prev.kind === "ident" && !NOT_A_TYPE.has(prev.text)) || TYPE_KEYWORDS.has(prev.text);

    if (next.text === "(" && prevIsType) localFns.add(t.text);

    if (prev.text === "var" && prev.kind === "ident" && DECL_NEXT.has(next.text)) {
      // var x = new T(...)  is trivially typed; any other initializer is not.
      let type: string | null = null;
      if (next.text === "=" && body[i + 2]?.text === "new") {
        let k = i + 3;
        let last: Token | undefined;
        while (body[k]?.kind === "ident") {
          last = body[k];
          if (body[k + 1]?.text === ".") k += 2;
          else {
            k++;
            break;
          }
        }
        if (last && (body[k]?.text === "(" || body[k]?.text === "{")) type = last.text;
      }
      put(t.text, type);
    } else if (prevIsType && DECL_NEXT.has(next.text)) {
      put(t.text, prev.text);
    } else if ([">", "]"].includes(prev.text) && ["=", ";", "in", ","].includes(next.text)) {
      put(t.text, null);
    }
  }
  return { locals, localFns };
}

export interface CallGraph {
  calls: Call[];
  unresolved: UnresolvedCalls[];
}

export function collectCalls(parses: FileParse[]): CallGraph {
  // ---- type index -------------------------------------------------------
  const entries = new Map<string, Group["parts"]>();
  for (const parse of parses) {
    for (const decl of parse.types) {
      if (decl.keyword === "enum") continue;
      const list = entries.get(decl.name) ?? [];
      list.push({ decl, file: parse.file });
      entries.set(decl.name, list);
    }
  }
  const groups = new Map<string, Group>();
  for (const [name, parts] of entries) {
    // One declaration, or all-`partial` parts. Two plain declarations of one
    // name (two namespaces) cannot be told apart without a symbol table.
    const ok = parts.length === 1 || parts.every((p) => p.decl.modifiers.includes("partial"));
    if (ok) groups.set(name, { name, keyword: parts[0]!.decl.keyword, parts });
  }

  const isClassLike = (g: Group): boolean => g.keyword !== "interface";

  /** The repo group a base-list entry names, when it names exactly one. */
  const groupOfKey = (key: string): Group | undefined => groups.get(headOf(key));

  const baseKeys = (g: Group): string[] =>
    g.parts.flatMap((p) => p.decl.bases.map(typeKey));

  interface Found {
    group: Group;
    file: string;
    line: number;
    method: MethodDecl | null;
  }

  /** Method by name on a group, then up its base chain (classes up classes, interfaces up interfaces). */
  const findMethod = (g: Group, name: string, seen = new Set<string>()): Found | null => {
    if (seen.has(g.name)) return null;
    seen.add(g.name);
    for (const p of g.parts) {
      const m = p.decl.methods.find((x) => x.name === name);
      if (m) return { group: g, file: p.file, line: m.line, method: m };
    }
    for (const p of g.parts) {
      const s = p.decl.signatures.find((x) => x.name === name);
      if (s) return { group: g, file: p.file, line: s.line, method: null };
    }
    for (const key of baseKeys(g)) {
      const b = groupOfKey(key);
      if (!b || isClassLike(b) !== isClassLike(g)) continue;
      const hit = findMethod(b, name, seen);
      if (hit) return hit;
    }
    return null;
  };

  /** Every base type text a group reaches, through repo-declared bases. */
  const closureCache = new Map<string, Set<string>>();
  const closure = (g: Group, trail = new Set<string>()): Set<string> => {
    const hit = closureCache.get(g.name);
    if (hit) return hit;
    const out = new Set<string>();
    if (trail.has(g.name)) return out;
    trail.add(g.name);
    for (const key of baseKeys(g)) {
      out.add(key);
      const b = groupOfKey(key);
      if (b) for (const k of closure(b, trail)) out.add(k);
    }
    trail.delete(g.name);
    closureCache.set(g.name, out);
    return out;
  };

  /** Classes that implement `key` and have a bodied method `name`, as distinct targets. */
  const implementers = (key: string, name: string): Found[] => {
    const out = new Map<string, Found>();
    for (const g of groups.values()) {
      if (!isClassLike(g) || !closure(g).has(key)) continue;
      const f = findMethod(g, name);
      if (!f || f.method === null) continue;
      out.set(`${f.group.name}|${f.file}|${f.line}`, f);
    }
    return [...out.values()].sort(
      (a, b) => cmp(a.group.name, b.group.name) || cmp(a.file, b.file) || a.line - b.line,
    );
  };

  /** Declared type text of a field or property on a group or its class bases. */
  const memberType = (g: Group, name: string, seen = new Set<string>()): string | undefined => {
    if (seen.has(g.name)) return undefined;
    seen.add(g.name);
    for (const p of g.parts) {
      const f = p.decl.fields.find((x) => x.name === name);
      if (f) return f.type;
      const prop = p.decl.properties.find((x) => x.name === name);
      if (prop) return prop.type;
    }
    for (const key of baseKeys(g)) {
      const b = groupOfKey(key);
      if (b && isClassLike(b)) {
        const t = memberType(b, name, seen);
        if (t !== undefined) return t;
      }
    }
    return undefined;
  };

  // ---- the scan ---------------------------------------------------------
  const calls: Call[] = [];
  const seenCalls = new Set<string>();
  const unresolved: UnresolvedCalls[] = [];

  for (const parse of parses) {
    for (const decl of parse.types) {
      const self = groups.get(decl.name);
      for (const method of decl.methods) {
        const from: CallSite = {
          type: decl.name, method: method.name, file: parse.file, line: method.line,
        };
        const body = method.body;
        const { locals, localFns } = scanLocals(body);
        const params = new Map(method.params.map((p) => [p.name, p.type]));
        let misses = 0;

        const link = (found: Found, name: string, line: number, ambiguous: boolean): void => {
          const key = [
            from.file, from.line, found.group.name, name, found.file, found.line, line,
          ].join("|");
          if (seenCalls.has(key)) return;
          seenCalls.add(key);
          calls.push({
            from,
            to: { type: found.group.name, method: name, file: found.file, line: found.line },
            line,
            ...(ambiguous ? { ambiguous: true } : {}),
          });
        };

        /** Call `name` on a receiver of declared type text `typeText`. */
        const callOn = (typeText: string, name: string, line: number): boolean => {
          const key = typeKey(typeText);
          const g = groupOfKey(key);
          if (!g) return false;
          const found = findMethod(g, name);
          if (!found) return false;
          link(found, name, line, false);
          if (g.keyword === "interface") {
            const impls = implementers(key, name);
            for (const impl of impls) link(impl, name, line, impls.length > 1);
          }
          return true;
        };

        for (let i = 0; i < body.length; i++) {
          const tok = body[i]!;
          if (tok.kind !== "ident" || NOT_CALLS.has(tok.text)) continue;
          let open = i + 1;
          if (body[open]?.text === "<") {
            const after = skipGenericArgs(body, open);
            if (after === -1) continue;
            open = after;
          }
          if (body[open]?.text !== "(") continue;

          const prev = i > 0 ? body[i - 1]! : null;
          if (prev?.text === "new" || prev?.text === "::") continue;

          if (prev !== null && (prev.text === "." || prev.text === "?.")) {
            const recv = i >= 2 ? body[i - 2]! : null;
            const before = i >= 3 ? body[i - 3]! : null;
            const chained =
              before !== null &&
              (before.text === "." || before.text === "?.") &&
              !(i >= 4 && body[i - 4]!.text === "this");
            let ok = false;
            if (recv && !chained && self) {
              if (recv.text === "this" && recv.kind === "keyword") {
                const f = findMethod(self, tok.text);
                if (f) {
                  link(f, tok.text, tok.line, false);
                  ok = true;
                }
              } else if (recv.kind === "ident") {
                let typeText: string | null | undefined;
                if (locals.has(recv.text)) typeText = locals.get(recv.text);
                else if (params.has(recv.text)) typeText = params.get(recv.text);
                else typeText = memberType(self, recv.text);
                if (typeText) ok = callOn(typeText, tok.text, tok.line);
                else if (typeText === undefined) {
                  // Not a variable: a static call on a repo type, if `M` is static there.
                  const g = groups.get(recv.text);
                  const f = g ? findMethod(g, tok.text) : null;
                  if (f && f.method?.modifiers.includes("static")) {
                    link(f, tok.text, tok.line, false);
                    ok = true;
                  }
                }
              }
            }
            if (!ok) misses++;
            continue;
          }

          // A bare `M(`. After a type it is a local function's declaration.
          if (
            prev !== null &&
            ((prev.kind === "ident" && !NOT_A_TYPE.has(prev.text)) ||
              TYPE_KEYWORDS.has(prev.text) ||
              prev.text === ">" ||
              prev.text === "]")
          ) {
            continue;
          }
          let ok = false;
          if (self && !localFns.has(tok.text)) {
            const f = findMethod(self, tok.text);
            if (f) {
              link(f, tok.text, tok.line, false);
              ok = true;
            }
          }
          if (!ok) misses++;
        }

        if (misses > 0) {
          unresolved.push({
            type: decl.name, method: method.name, file: parse.file, line: method.line,
            count: misses,
          });
        }
      }
    }
  }

  calls.sort(
    (a, b) =>
      cmp(a.from.file, b.from.file) ||
      a.from.line - b.from.line ||
      cmp(a.from.type, b.from.type) ||
      cmp(a.from.method, b.from.method) ||
      a.line - b.line ||
      cmp(a.to.type, b.to.type) ||
      cmp(a.to.method, b.to.method) ||
      cmp(a.to.file, b.to.file) ||
      a.to.line - b.to.line,
  );
  unresolved.sort(
    (a, b) =>
      cmp(a.file, b.file) || a.line - b.line || cmp(a.type, b.type) || cmp(a.method, b.method),
  );
  return { calls, unresolved };
}
