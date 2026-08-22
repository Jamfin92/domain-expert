import { z } from "zod";

/** A zod schema and a type of the same name — corpus-repo-d does this 26 times. */
export const Crew = z.object({
  callsign: z.string(),
  name: z.string(),
  homePort: z.string().nullable(),
  foundedYear: z.number().int(),
});
export type Crew = z.infer<typeof Crew>;
