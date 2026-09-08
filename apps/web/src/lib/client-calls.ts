import type { ClientCall, UiComponent } from "@/lib/api";

/**
 * Grouping for the component -> call -> matched route panel. Pure, no React,
 * so the ordering rules are unit-testable without a renderer.
 *
 * The `@/lib/api` import MUST stay `import type`: the root vitest config
 * declares no `@` alias, so the specifier only survives because it is erased
 * at compile time. A value import from here fails to resolve under vitest.
 */

export interface CallGroup {
  /** null is the unattributed bucket, and sorts last. */
  component: UiComponent | null;
  calls: ClientCall[];
}

/**
 * Groups calls under the components they attribute to.
 *
 * - groups ordered by `component.key` ascending, plain `<`/`>` (never
 *   `localeCompare`, which is locale-dependent);
 * - the unattributed bucket is last, and is omitted when nothing is
 *   unattributed;
 * - components owning no calls are omitted entirely — `mini-react` has 15
 *   components and 5 attributed calls, and 10 empty groups is noise;
 * - calls within a group sorted by `file` then `line`, both ascending; equal
 *   keys keep input order (Array.prototype.sort is stable, ES2019+);
 * - a call carrying two component keys appears in BOTH groups. Intended, not a
 *   bug: it is one call the two components share.
 */
export function groupCallsByComponent(
  components: UiComponent[],
  calls: ClientCall[],
): CallGroup[] {
  const byKey = new Map<string, UiComponent>();
  for (const c of components) byKey.set(c.key, c);

  const grouped = new Map<string, ClientCall[]>();
  const unattributed: ClientCall[] = [];
  for (const call of calls) {
    if (call.components.length === 0) {
      unattributed.push(call);
      continue;
    }
    for (const key of call.components) {
      // A key with no component to resolve against would render a group with
      // no header, so it is dropped rather than guessed at.
      if (!byKey.has(key)) continue;
      const bucket = grouped.get(key);
      if (bucket) bucket.push(call);
      else grouped.set(key, [call]);
    }
  }

  const groups: CallGroup[] = [...grouped.keys()]
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((key) => ({
      component: byKey.get(key) as UiComponent,
      calls: [...(grouped.get(key) as ClientCall[])].sort(compareCalls),
    }));

  if (unattributed.length > 0) {
    groups.push({ component: null, calls: [...unattributed].sort(compareCalls) });
  }
  return groups;
}

function compareCalls(a: ClientCall, b: ClientCall): number {
  if (a.file !== b.file) return a.file < b.file ? -1 : 1;
  return a.line - b.line;
}

/**
 * The bare `name` when it is unique across ALL components in the graph, else
 * the name with its file. Display only — keys remain the join.
 */
export function componentLabel(component: UiComponent, allComponents: UiComponent[]): string {
  const sameName = allComponents.filter((c) => c.name === component.name);
  return sameName.length > 1 ? `${component.name} (${component.file})` : component.name;
}
