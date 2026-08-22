import { z } from "zod";
import { Crew } from "./base.js";

/**
 * `.extend()` over a schema declared in another file. Both halves have to
 * resolve for this to report six fields rather than two.
 */
export const CrewWithFleet = Crew.extend({
  fleet: z.string(),
  active: z.boolean().optional(),
});
export type CrewWithFleet = z.infer<typeof CrewWithFleet>;
