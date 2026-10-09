/**
 * Which entity the refs panel looks up. Pure so the rule is testable without a
 * renderer.
 *
 * The panel's lookup runs when its `target` state changes. "Look up anyway"
 * sets `target` locally without telling the parent, so `selected` (the prop) can
 * lag behind. Clicking a search hit whose name equals `selected` then changes
 * nothing in the parent, and an effect keyed on `selected` never fires.
 */
export interface HitClick {
  /** Parent call: `onSelect(name)`. Always made, so the parent stays authoritative. */
  select: string;
  /** New local lookup target, or null when `target` already holds it. */
  setTarget: string | null;
}

export function onHitClick(name: string, selected: string | null, target: string | null): HitClick {
  // If the parent will see a different selection, its prop change retargets us.
  // Otherwise (prop already equals `name`) we must retarget ourselves, unless we
  // are already looking at it.
  const parentWillChange = selected !== name;
  return { select: name, setTarget: !parentWillChange && target !== name ? name : null };
}
