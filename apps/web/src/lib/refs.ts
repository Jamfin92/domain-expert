import type { EntityRef } from "@/lib/api";

/**
 * Grouping for the refs panel: file, then the method inside it. Pure.
 * `import type` only: see client-calls.ts.
 */

export interface MethodRefs {
  type: string;
  method: string;
  refs: EntityRef[];
}
export interface FileRefs {
  file: string;
  methods: MethodRefs[];
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Files, then `type.method`, then lines, all ascending in code-unit order. */
export function groupRefs(refs: EntityRef[]): FileRefs[] {
  const files = new Map<string, Map<string, MethodRefs>>();
  for (const r of refs) {
    let methods = files.get(r.file);
    if (!methods) {
      methods = new Map();
      files.set(r.file, methods);
    }
    const mkey = `${r.type}.${r.method}`;
    const m = methods.get(mkey);
    if (m) m.refs.push(r);
    else methods.set(mkey, { type: r.type, method: r.method, refs: [r] });
  }
  return [...files.keys()].sort(cmp).map((file) => {
    const methods = files.get(file) as Map<string, MethodRefs>;
    return {
      file,
      methods: [...methods.keys()].sort(cmp).map((k) => {
        const m = methods.get(k) as MethodRefs;
        return { ...m, refs: [...m.refs].sort((a, b) => a.line - b.line) };
      }),
    };
  });
}

export type RefsState =
  | { kind: "unknown" }
  | { kind: "none" }
  | { kind: "some"; count: number; files: FileRefs[] };

/**
 * `known:false` (the repo has never heard of the name) and `known` with zero
 * refs (an entity nothing mentions) are different facts and must read
 * differently, so they are different states, not one empty list.
 */
export function refsState(result: { known: boolean; refs: EntityRef[] }): RefsState {
  if (!result.known) return { kind: "unknown" };
  if (result.refs.length === 0) return { kind: "none" };
  return { kind: "some", count: result.refs.length, files: groupRefs(result.refs) };
}
