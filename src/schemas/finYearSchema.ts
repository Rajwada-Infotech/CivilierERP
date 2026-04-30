import { z } from "zod";

export const finYearSchema = z
  .object({
    year: z.string().trim().min(1, "Year is required").max(20),
    startDate: z.string().min(1, "Start date is required"),
    endDate: z.string().min(1, "End date is required"),
    status: z.enum(["Active", "Closed"]),
    locked: z.boolean(),
  })
  .refine((value) => new Date(value.endDate) >= new Date(value.startDate), {
    path: ["endDate"],
    message: "End date must be on or after start date",
  });

export type FinYearForm = z.infer<typeof finYearSchema>;
