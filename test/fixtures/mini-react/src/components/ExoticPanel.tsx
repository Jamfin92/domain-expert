import { exoticService } from "@/services/exotic.service";

/**
 * Touches ONLY the plain member. The calls inside the computed-key member,
 * the accessor and the spread must not attribute here through the object.
 */
export function ExoticPanel() {
  const load = () => exoticService.plain();
  return <pre onClick={load}>exotic</pre>;
}
