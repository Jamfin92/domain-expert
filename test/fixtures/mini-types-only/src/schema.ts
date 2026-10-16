import { z } from "zod";

/** A zod object, read through zod's own `_output` type like any other shape. */
export const Comment = z.object({
  id: z.string(),
  postId: z.string(),
  body: z.string(),
  createdAt: z.string().nullable(),
});

export type Comment = z.infer<typeof Comment>;
