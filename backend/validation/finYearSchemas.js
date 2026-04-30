const { z } = require("zod");

const dateSchema = z.coerce.date();

const finYearBaseSchema = z.object({
  FName: z.string().trim().min(1, "Financial year is required").max(20),
  FStartDate: dateSchema,
  FEndDate: dateSchema,
  FStatus: z.coerce.boolean().default(true),
  FisLocked: z.coerce.boolean().default(false),
});

const finYearCreateSchema = finYearBaseSchema
  .refine((value) => value.FEndDate >= value.FStartDate, {
    path: ["FEndDate"],
    message: "End date must be on or after start date",
  });

const finYearUpdateSchema = finYearBaseSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, "At least one field is required")
  .refine(
    (value) =>
      !value.FStartDate || !value.FEndDate || value.FEndDate >= value.FStartDate,
    {
      path: ["FEndDate"],
      message: "End date must be on or after start date",
    },
  );

module.exports = { finYearCreateSchema, finYearUpdateSchema };
