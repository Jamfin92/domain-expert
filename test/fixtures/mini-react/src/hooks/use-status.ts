import { statusService } from "@/services/status.service";

/**
 * The middle hop of the 3-hop chain, importing via `@/` on purpose: with a
 * relative import this file resolves under the fallback walk() program too,
 * and the fixture would stay green with the project-reference fix reverted.
 * The bare method reference (a value, not a call) must still produce an edge.
 */
export function useStatus(): { refresh: () => Promise<unknown> } {
  return { refresh: statusService.load };
}
