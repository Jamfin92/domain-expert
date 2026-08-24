/**
 * A C# lexer covering the whole literal grammar, not a regex sweep.
 *
 * Why hand-rolled: the prebuilt tree-sitter C# wasm grammars available on npm
 * are built against tree-sitter 0.20 and fail to parse modern C# — verified
 * against a corpus repo's entity classes, which use `required` members
 * and collection expressions (`= []`). The current grammar has no compatible
 * prebuilt wasm, and the native binding needs node-gyp.
 *
 * We only need a narrow, regular subset (type declarations, auto-properties,
 * attributes, and fluent call chains). Getting the *literals* right is what
 * matters: a `;` or `{` inside a string or comment must never be treated as
 * structure. That is exactly what this lexer guarantees.
 */

export type TokenKind =
  | "ident"
  | "keyword"
  | "number"
  | "string"
  | "char"
  | "punct";

export interface Token {
  kind: TokenKind;
  text: string;
  /** Byte offset of the token start. */
  start: number;
  /** 1-based line number, for warnings that a human has to act on. */
  line: number;
}

const KEYWORDS = new Set([
  "abstract", "as", "base", "bool", "break", "byte", "case", "catch", "char",
  "checked", "class", "const", "continue", "decimal", "default", "delegate",
  "do", "double", "else", "enum", "event", "explicit", "extern", "false",
  "finally", "fixed", "float", "for", "foreach", "goto", "if", "implicit",
  "in", "int", "interface", "internal", "is", "lock", "long", "namespace",
  "new", "null", "object", "operator", "out", "override", "params", "private",
  "protected", "public", "readonly", "ref", "return", "sbyte", "sealed",
  "short", "sizeof", "stackalloc", "static", "string", "struct", "switch",
  "this", "throw", "true", "try", "typeof", "uint", "ulong", "unchecked",
  "unsafe", "ushort", "using", "virtual", "void", "volatile", "while",
  // contextual keywords we care about structurally
  "get", "set", "init", "record", "required", "partial", "where", "global",
]);

const PUNCT3 = ["<<=", ">>=", "...", "??="];
const PUNCT2 = [
  "=>", "==", "!=", "<=", ">=", "&&", "||", "??", "?.", "::", "++", "--",
  "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "<<", ">>",
];

function isIdentStart(c: string): boolean {
  return /[A-Za-z_@]/.test(c);
}
function isIdentPart(c: string): boolean {
  return /[A-Za-z0-9_]/.test(c);
}

/**
 * Tokenize C# source. Comments and whitespace are dropped; every other
 * construct is preserved verbatim so offsets stay meaningful.
 */
export function lex(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  const n = src.length;

  const push = (kind: TokenKind, text: string, start: number): void => {
    tokens.push({ kind, text, start, line });
  };

  while (i < n) {
    const c = src[i]!;

    // newlines / whitespace
    if (c === "\n") {
      line++;
      i++;
      continue;
    }
    if (c === " " || c === "\t" || c === "\r") {
      i++;
      continue;
    }

    // comments
    if (c === "/" && src[i + 1] === "/") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) {
        if (src[i] === "\n") line++;
        i++;
      }
      i += 2;
      continue;
    }

    // preprocessor directives (#region, #if, ...) — skip the whole line
    if (c === "#") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }

    // String literals, in one place so the prefix is scanned before the fence.
    // C# allows $, $$, @, $@ and @$ prefixes on 1-quote and 3+-quote forms.
    // Checking $" before """ misreads $$"""..."""  and unbalances every brace
    // that follows it — verified against a corpus repo service that uses
    // $$""" JSON literals.
    if (c === '"' || c === "$" || c === "@") {
      let j = i;
      let dollars = 0;
      let at = false;
      while (src[j] === "$") {
        dollars++;
        j++;
      }
      if (src[j] === "@") {
        at = true;
        j++;
      }
      while (src[j] === "$") {
        dollars++;
        j++;
      }

      if (src[j] === '"') {
        const start = i;
        let fence = 0;
        let k = j;
        while (src[k] === '"') {
          fence++;
          k++;
        }

        if (fence >= 3) {
          // Raw string literal. The closing delimiter is a run of at least
          // `fence` quotes. Interpolation holes use `dollars` braces, which we
          // never need to interpret in order to find the end.
          let stop = n;
          for (let p = k; p < n; p++) {
            if (src[p] !== '"') continue;
            let run = 0;
            while (src[p + run] === '"') run++;
            if (run >= fence) {
              stop = p + run;
              break;
            }
            p += run - 1;
          }
          for (let q = start; q < stop; q++) if (src[q] === "\n") line++;
          push("string", src.slice(start, stop), start);
          i = stop;
          continue;
        }

        // A single quote opens the literal.
        k = j + 1;
        if (at) {
          // Verbatim: "" escapes a quote, newlines are allowed, no backslashes.
          while (k < n) {
            if (src[k] === '"' && src[k + 1] === '"') {
              k += 2;
              continue;
            }
            if (src[k] === '"') {
              k++;
              break;
            }
            if (src[k] === "\n") line++;
            k++;
          }
        } else {
          let depth = 0;
          while (k < n) {
            const d = src[k]!;
            if (d === "\\") {
              k += 2;
              continue;
            }
            if (d === "{" && src[k + 1] === "{") {
              k += 2;
              continue;
            }
            if (d === "{") {
              depth++;
              k++;
              continue;
            }
            if (d === "}") {
              if (depth > 0) depth--;
              k++;
              continue;
            }
            if (d === '"' && depth === 0) {
              k++;
              break;
            }
            if (d === "\n") {
              line++;
              k++;
              break; // unterminated; recover at the newline
            }
            k++;
          }
        }
        push("string", src.slice(start, k), start);
        i = k;
        continue;
      }
      // Not a string after all (a bare $ operator, or a @verbatim identifier)
      // — fall through to the identifier and punctuation branches.
    }

    // char literal
    if (c === "'") {
      const start = i;
      i++;
      while (i < n && src[i] !== "'") {
        if (src[i] === "\\") i++;
        i++;
      }
      i++;
      push("char", src.slice(start, i), start);
      continue;
    }

    // number
    if (/[0-9]/.test(c)) {
      const start = i;
      while (i < n && /[0-9A-Fa-fxXbBoO_.eE]/.test(src[i]!)) {
        // stop at a '.' that begins a member access rather than a decimal part
        if (src[i] === "." && !/[0-9]/.test(src[i + 1] ?? "")) break;
        i++;
      }
      while (i < n && /[uUlLfFdDmM]/.test(src[i]!)) i++;
      push("number", src.slice(start, i), start);
      continue;
    }

    // identifier / keyword
    if (isIdentStart(c)) {
      const start = i;
      if (src[i] === "@") i++; // verbatim identifier: @class
      while (i < n && isIdentPart(src[i]!)) i++;
      const text = src.slice(start, i);
      const bare = text.startsWith("@") ? text.slice(1) : text;
      push(KEYWORDS.has(bare) && !text.startsWith("@") ? "keyword" : "ident", text, start);
      continue;
    }

    // punctuation, longest match first
    const three = src.slice(i, i + 3);
    if (PUNCT3.includes(three)) {
      push("punct", three, i);
      i += 3;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (PUNCT2.includes(two)) {
      push("punct", two, i);
      i += 2;
      continue;
    }
    push("punct", c, i);
    i++;
  }

  return tokens;
}
