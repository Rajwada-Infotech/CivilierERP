const { z } = require("zod");

const dateSchema = z.coerce.date();

const finYearBaseSchema = z.object({
  fy_label: z.string().trim().min(1, "Financial year is required").max(20),
  start_date: dateSchema,
  end_date: dateSchema,
  is_active: z.coerce.boolean().default(true),
  is_locked: z.coerce.boolean().default(false),
});

const finYearCreateSchema = finYearBaseSchema.refine(
  (value) => value.end_date >= value.start_date,
  {
    path: ["end_date"],
    message: "End date must be on or after start date",
  },
);

const finYearUpdateSchema = finYearBaseSchema
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

module.exports = { finYearCreateSchema, finYearUpdateSchema };
