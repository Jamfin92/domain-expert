import { lex, type Token } from "./lex.js";

/**
 * Structural reader for the C# subset psq needs: namespaces, usings, type
 * declarations, attributes, properties, and method bodies.
 *
 * It is deliberately tolerant. Anything it does not recognize is skipped and
 * reported through `warnings` on the parse result. A missing fact costs us a
 * question; a guessed fact would cost us the whole premise of the tool.
 */

export interface AttributeRef {
  name: string;
  /** Raw argument tokens, e.g. ["20"] for [MaxLength(20)]. */
  args: string[];
}

export interface PropertyDecl {
  name: string;
  /** Type exactly as written, e.g. "ICollection<ApplicationDocument>". */
  type: string;
  attributes: AttributeRef[];
  modifiers: string[];
  line: number;
  /** True for `=> Set<T>()` and other expression-bodied members. */
  expressionBodied: boolean;
  /** Initializer text after `=`, if present. */
  initializer: string | null;
}

export interface MethodDecl {
  name: string;
  modifiers: string[];
  /** Tokens strictly inside the outermost body braces. */
  body: Token[];
  line: number;
}

export interface TypeDecl {
  name: string;
  /** "class" | "record" | "struct" | "interface" | "enum" */
  keyword: string;
  modifiers: string[];
  /** Base types and interfaces as written, e.g. "IdentityDbContext<User, IdentityRole<Guid>, Guid>". */
  bases: string[];
  namespace: string | null;
  properties: PropertyDecl[];
  methods: MethodDecl[];
  line: number;
}

export interface FileParse {
  file: string;
  namespace: string | null;
  usings: string[];
  types: TypeDecl[];
  warnings: string[];
}

const TYPE_KEYWORDS = new Set(["class", "record", "struct", "interface", "enum"]);
const MODIFIERS = new Set([
  "public", "private", "protected", "internal", "static", "abstract", "sealed",
  "virtual", "override", "readonly", "partial", "required", "extern", "unsafe",
  "new", "const", "async", "volatile",
]);

/** Index of the token closing the bracket that opens at `open`. */
function matchBracket(tokens: Token[], open: number): number {
  const pairs: Record<string, string> = { "{": "}", "(": ")", "[": "]", "<": ">" };
  const openText = tokens[open]!.text;
  const closeText = pairs[openText];
  if (closeText === undefined) return -1;
  let depth = 0;
  for (let i = open; i < tokens.length; i++) {
    const t = tokens[i]!.text;
    if (t === openText) depth++;
    else if (t === closeText) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Read a type reference starting at `i`, consuming generic arguments, arrays,
 * nullable markers and dotted names. Returns the text and the next index.
 */
/**
 * The parameters of a primary constructor, as the properties they are.
 *
 * `record UserProfileDto(Guid Id, string? Phone, List<int> CountyIds)` declares
 * three public members; C# just lets you write them on one line. A reader that
 * skips the parameter list sees a record with no properties, which is how every
 * DTO in a modern codebase becomes invisible.
 */
function parseParameters(tokens: Token[], open: number, close: number): PropertyDecl[] {
  const out: PropertyDecl[] = [];
  let i = open + 1;

  while (i < close) {
    // attributes on a parameter: [FromRoute] int id
    while (tokens[i]?.text === "[") {
      const end = matchBracket(tokens, i);
      if (end === -1 || end >= close) return out;
      i = end + 1;
    }
    // `params`, `ref`, `in`, `out` sit between the comma and the type
    while (
      i < close &&
      ["params", "ref", "in", "out", "this", "readonly"].includes(tokens[i]?.text ?? "")
    ) {
      i++;
    }

    const { text: type, next } = readTypeRef(tokens, i);
    const nameTok = tokens[next];
    if (!type || !nameTok || (nameTok.kind !== "ident" && nameTok.kind !== "keyword")) {
      // Not a parameter shape this reader knows. Skip to the next comma rather
      // than guessing at what it was.
      while (i < close && tokens[i]!.text !== ",") i++;
      i++;
      continue;
    }

    out.push({
      name: nameTok.text,
      type,
      attributes: [],
      modifiers: [],
      line: nameTok.line,
      expressionBodied: false,
      initializer: null,
    });

    i = next + 1;
    let depth = 0;
    while (i < close) {
      const t = tokens[i]!.text;
      if (t === "(" || t === "[" || t === "<") depth++;
      else if (t === ")" || t === "]" || t === ">") depth--;
      else if (t === "," && depth <= 0) break;
      i++;
    }
    i++;
  }

  return out;
}

function readTypeRef(tokens: Token[], i: number): { text: string; next: number } {
  let out = "";
  let n = i;
  const atEnd = (): boolean => n >= tokens.length;

  // dotted name, possibly generic at each segment
  for (;;) {
    if (atEnd()) break;
    const t = tokens[n]!;
    if (t.kind !== "ident" && t.kind !== "keyword") break;
    out += t.text;
    n++;
    if (!atEnd() && tokens[n]!.text === "<") {
      const close = matchBracket(tokens, n);
      if (close === -1) break;
      out += tokens.slice(n, close + 1).map((x) => x.text).join("");
      n = close + 1;
    }
    if (!atEnd() && tokens[n]!.text === "." ) {
      out += ".";
      n++;
      continue;
    }
    break;
  }

  // trailing array ranks and nullable marker
  for (;;) {
    if (atEnd()) break;
    const t = tokens[n]!;
    if (t.text === "?") {
      out += "?";
      n++;
      continue;
    }
    if (t.text === "[" && tokens[n + 1]?.text === "]") {
      out += "[]";
      n += 2;
      continue;
    }
    break;
  }

  return { text: out, next: n };
}

/** Collect `[Attr(args)]` groups immediately preceding a member. */
function readAttributes(tokens: Token[], i: number): { attrs: AttributeRef[]; next: number } {
  const attrs: AttributeRef[] = [];
  let n = i;
  while (n < tokens.length && tokens[n]!.text === "[") {
    const close = matchBracket(tokens, n);
    if (close === -1) break;
    // may hold several comma-separated attributes
    let k = n + 1;
    while (k < close) {
      const nameTok = tokens[k];
      if (!nameTok || (nameTok.kind !== "ident" && nameTok.kind !== "keyword")) {
        k++;
        continue;
      }
      const { text: name, next } = readTypeRef(tokens, k);
      k = next;
      const args: string[] = [];
      if (k < close && tokens[k]!.text === "(") {
        const argClose = matchBracket(tokens, k);
        if (argClose !== -1) {
          let cur: string[] = [];
          for (let a = k + 1; a < argClose; a++) {
            if (tokens[a]!.text === "," ) {
              if (cur.length) args.push(cur.join(""));
              cur = [];
            } else cur.push(tokens[a]!.text);
          }
          if (cur.length) args.push(cur.join(""));
          k = argClose + 1;
        }
      }
      attrs.push({ name, args });
      if (k < close && tokens[k]!.text === ",") k++;
    }
    n = close + 1;
  }
  return { attrs, next: n };
}

/** Parse the members inside a type body. */
function parseBody(
  tokens: Token[],
  from: number,
  to: number,
  warnings: string[],
  file: string,
): { properties: PropertyDecl[]; methods: MethodDecl[] } {
  const properties: PropertyDecl[] = [];
  const methods: MethodDecl[] = [];
  let i = from;

  while (i < to) {
    const tok = tokens[i]!;

    // nested braces we do not care about — skip wholesale
    if (tok.text === "}") {
      i++;
      continue;
    }

    const { attrs, next: afterAttrs } = readAttributes(tokens, i);
    i = afterAttrs;
    if (i >= to) break;

    const modifiers: string[] = [];
    while (i < to && MODIFIERS.has(tokens[i]!.text)) {
      modifiers.push(tokens[i]!.text);
      i++;
    }
    if (i >= to) break;

    // nested type declaration — skip its whole body
    if (TYPE_KEYWORDS.has(tokens[i]!.text)) {
      let b = i;
      while (b < to && tokens[b]!.text !== "{" && tokens[b]!.text !== ";") b++;
      if (tokens[b]?.text === "{") {
        const close = matchBracket(tokens, b);
        i = close === -1 ? to : close + 1;
      } else i = b + 1;
      continue;
    }

    const declLine = tokens[i]!.line;
    const { text: typeText, next: afterType } = readTypeRef(tokens, i);
    if (!typeText) {
      i++;
      continue;
    }

    const nameTok = tokens[afterType];
    if (!nameTok || (nameTok.kind !== "ident" && nameTok.kind !== "keyword")) {
      // constructors, operators, destructors: skip to the next member boundary
      let b = afterType;
      while (b < to && tokens[b]!.text !== "{" && tokens[b]!.text !== ";") b++;
      if (tokens[b]?.text === "{") {
        const close = matchBracket(tokens, b);
        i = close === -1 ? to : close + 1;
      } else i = b + 1;
      continue;
    }

    const memberName = nameTok.text;
    let j = afterType + 1;

    // generic method type params
    if (tokens[j]?.text === "<") {
      const close = matchBracket(tokens, j);
      if (close !== -1) j = close + 1;
    }

    // method: name followed by a parameter list
    if (tokens[j]?.text === "(") {
      const parClose = matchBracket(tokens, j);
      if (parClose === -1) {
        i = j + 1;
        continue;
      }
      let k = parClose + 1;
      // constraint clauses
      while (k < to && tokens[k]!.text === "where") {
        while (k < to && tokens[k]!.text !== "{" && tokens[k]!.text !== ";") k++;
      }
      if (tokens[k]?.text === "{") {
        const close = matchBracket(tokens, k);
        if (close === -1) {
          warnings.push(`${file}:${declLine}: unbalanced body for method ${memberName}`);
          i = to;
          continue;
        }
        methods.push({
          name: memberName,
          modifiers,
          body: tokens.slice(k + 1, close),
          line: declLine,
        });
        i = close + 1;
        continue;
      }
      if (tokens[k]?.text === "=>") {
        while (k < to && tokens[k]!.text !== ";") k++;
        methods.push({ name: memberName, modifiers, body: [], line: declLine });
        i = k + 1;
        continue;
      }
      i = k + 1;
      continue;
    }

    // property with accessor block: Type Name { get; set; } [= init;]
    if (tokens[j]?.text === "{") {
      const close = matchBracket(tokens, j);
      if (close === -1) {
        warnings.push(`${file}:${declLine}: unbalanced accessor block for ${memberName}`);
        i = to;
        continue;
      }
      let initializer: string | null = null;
      let k = close + 1;
      if (tokens[k]?.text === "=") {
        k++;
        const parts: string[] = [];
        let depth = 0;
        while (k < to) {
          const t = tokens[k]!.text;
          if (t === "(" || t === "[" || t === "{") depth++;
          if (t === ")" || t === "]" || t === "}") depth--;
          if (t === ";" && depth <= 0) break;
          parts.push(t);
          k++;
        }
        initializer = parts.join(" ");
      }
      if (tokens[k]?.text === ";") k++;
      properties.push({
        name: memberName,
        type: typeText,
        attributes: attrs,
        modifiers,
        line: declLine,
        expressionBodied: false,
        initializer,
      });
      i = k;
      continue;
    }

    // expression-bodied property: DbSet<County> Counties => Set<County>();
    if (tokens[j]?.text === "=>") {
      const parts: string[] = [];
      let k = j + 1;
      let depth = 0;
      while (k < to) {
        const t = tokens[k]!.text;
        if (t === "(" || t === "[" || t === "{") depth++;
        if (t === ")" || t === "]" || t === "}") depth--;
        if (t === ";" && depth <= 0) break;
        parts.push(t);
        k++;
      }
      properties.push({
        name: memberName,
        type: typeText,
        attributes: attrs,
        modifiers,
        line: declLine,
        expressionBodied: true,
        initializer: parts.join(""),
      });
      i = k + 1;
      continue;
    }

    // field or event — walk to the statement end
    let k = j;
    while (k < to && tokens[k]!.text !== ";") k++;
    i = k + 1;
  }

  return { properties, methods };
}

/** Parse one C# file into the structures psq consumes. */
export function parseCSharp(src: string, file: string): FileParse {
  const tokens = lex(src);
  const warnings: string[] = [];
  const usings: string[] = [];
  const types: TypeDecl[] = [];
  let fileNamespace: string | null = null;

  let i = 0;
  while (i < tokens.length) {
    const tok = tokens[i]!;

    if (tok.text === "using") {
      // skip `using var x = ...` inside code and using-aliases we do not need
      const parts: string[] = [];
      let k = i + 1;
      if (tokens[k]?.text === "static") k++;
      while (k < tokens.length && tokens[k]!.text !== ";") {
        parts.push(tokens[k]!.text);
        k++;
      }
      const text = parts.join("");
      if (text && !text.includes("=")) usings.push(text);
      i = k + 1;
      continue;
    }

    if (tok.text === "namespace") {
      const { text, next } = readTypeRef(tokens, i + 1);
      fileNamespace = text;
      i = next;
      if (tokens[i]?.text === ";") i++;
      else if (tokens[i]?.text === "{") i++; // block-scoped: treat contents as flat
      continue;
    }

    // attributes then modifiers then a type keyword
    const { attrs: _attrs, next: afterAttrs } = readAttributes(tokens, i);
    let j = afterAttrs;
    const modifiers: string[] = [];
    while (j < tokens.length && MODIFIERS.has(tokens[j]!.text)) {
      modifiers.push(tokens[j]!.text);
      j++;
    }

    if (j < tokens.length && TYPE_KEYWORDS.has(tokens[j]!.text)) {
      const keyword = tokens[j]!.text;
      const line = tokens[j]!.line;
      let k = j + 1;
      const nameTok = tokens[k];
      if (!nameTok) break;
      const name = nameTok.text;
      k++;
      // generic parameters
      if (tokens[k]?.text === "<") {
        const close = matchBracket(tokens, k);
        if (close !== -1) k = close + 1;
      }
      // primary constructor (records / C# 12 classes)
      let positional: PropertyDecl[] = [];
      if (tokens[k]?.text === "(") {
        const close = matchBracket(tokens, k);
        if (close !== -1) {
          positional = parseParameters(tokens, k, close);
          k = close + 1;
        }
      }
      // base list
      const bases: string[] = [];
      if (tokens[k]?.text === ":") {
        k++;
        for (;;) {
          const { text, next } = readTypeRef(tokens, k);
          if (!text) break;
          bases.push(text);
          k = next;
          if (tokens[k]?.text === ",") {
            k++;
            continue;
          }
          break;
        }
      }
      // constraints
      while (tokens[k]?.text === "where") {
        while (k < tokens.length && tokens[k]!.text !== "{" && tokens[k]!.text !== ";") k++;
        if (tokens[k]?.text === ";") break;
      }

      if (tokens[k]?.text === "{") {
        const close = matchBracket(tokens, k);
        if (close === -1) {
          warnings.push(`${file}:${line}: unbalanced body for type ${name}`);
          break;
        }
        const { properties, methods } =
          keyword === "enum"
            ? { properties: [], methods: [] }
            : parseBody(tokens, k + 1, close, warnings, file);
        const declared = properties.map((prop) => prop.name);
        types.push({
          name,
          keyword,
          modifiers,
          bases,
          namespace: fileNamespace,
          properties: [...positional.filter((prop) => !declared.includes(prop.name)), ...properties],
          methods,
          line,
        });
        i = close + 1;
        continue;
      }
      // declaration without a body (e.g. `record X(...);`)
      types.push({
        name, keyword, modifiers, bases, namespace: fileNamespace,
        properties: positional, methods: [], line,
      });
      i = k + 1;
      continue;
    }

    i = Math.max(i + 1, afterAttrs);
  }

  return { file, namespace: fileNamespace, usings, types, warnings };
}
