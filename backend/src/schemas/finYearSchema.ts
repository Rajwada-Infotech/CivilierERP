import { z } from "zod";

const dateSchema = z.coerce.date();

export const finYearBaseSchema = z.object({
  fy_label: z.string().trim().min(1, "Financial year is required").max(20),
  start_date: dateSchema,
  end_date: dateSchema,
  is_active: z.coerce.boolean().default(true),
  is_locked: z.coerce.boolean().default(false),
});

export const finYearCreateSchema = finYearBaseSchema.refine(
  (value) => value.end_date >= value.start_date,
  {
    path: ["end_date"],
    message: "End date must be on or after start date",
  },
);

export const finYearUpdateSchema = finYearBaseSchema
  .partial()
  .refine(
    (value) => Object.keys(value).length > 0,
    "At least one field is required",
  )
  .refine(
    (value) =>
      !value.start_date ||
      !value.end_date ||
      value.end_date >= value.start_date,
    {
      path: ["end_date"],
      message: "End date must be on or after start date",
    },
  );

export const finYearSchema = z
  .object({
    year: z.string().trim().min(1, "Financial year is required").max(20),
    startDate: z.string().trim().min(1, "Start date is required"),
    endDate: z.string().trim().min(1, "End date is required"),
    status: z.enum(["Active", "Closed"]),
    locked: z.boolean().default(false),
  })
  .refine((value) => new Date(value.endDate) >= new Date(value.startDate), {
    path: ["endDate"],
    message: "End date must be on or after start date",
  });

export type FinYearForm = z.infer<typeof finYearSchema>;
