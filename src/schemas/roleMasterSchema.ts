import { z } from "zod";

export const roleMasterSchema = z.object({
  RName: z.string().trim().min(1, "Role name is required").max(100),
  RDesc: z.string().max(255).optional().default(""),
});

export type RoleMasterForm = z.infer<typeof roleMasterSchema>;
