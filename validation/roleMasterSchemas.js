const { z } = require("zod");

const cleanOptionalString = (max) =>
  z.preprocess((value) => {
    if (value === undefined || value === null) return undefined;
    const trimmed = String(value).trim();
    return trimmed === "" ? undefined : trimmed;
  }, z.string().max(max).optional());

const roleMasterCreateSchema = z.object({
  RName: z.preprocess(
    (value) => (typeof value === "string" ? value.trim() : value),
    z.string().min(1, "Role Name is required").max(100),
  ),
  RDesc: cleanOptionalString(255),
});

const roleMasterUpdateSchema = roleMasterCreateSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  "At least one field is required",
);

module.exports = { roleMasterCreateSchema, roleMasterUpdateSchema };
