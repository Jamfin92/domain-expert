import { thingsService } from "@/services";

/**
 * Imports through the barrel (`@/services` -> export * -> things.service),
 * and touches only removeThing — so the fetch in getThings must not
 * attribute here, and the DELETE must attribute ONLY here.
 */
export function ThingRemover() {
  const remove = () => thingsService.removeThing("1");
  return <button onClick={remove}>x</button>;
}
