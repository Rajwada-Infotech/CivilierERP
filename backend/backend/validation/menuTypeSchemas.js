const { z } = require("zod");

const nullableString = (max) =>
  z.preprocess((value) => {
    if (value === undefined || value === null) return null;
    const trimmed = String(value).trim();
    return trimmed === "" ? null : trimmed;
  }, z.string().max(max).nullable());

const menuTypeSchema = z.object({
  MenuReceipt: nullableString(200),
  MenuPayment: nullableString(200),
  MenuBOQ: nullableString(200),
  MenuPurchaseOrder: nullableString(200),
  MenuWorkOrder: nullableString(200),
  CreatedBy: nullableString(100).optional(),
  UpdatedBy: nullableString(100).optional(),
  ApprovedBy: nullableString(100).optional(),
  ApprovedAt: z
    .preprocess((value) => (value === "" || value === undefined ? null : value), z.coerce.date().nullable())
    .optional(),
});

module.exports = {
  menuTypeCreateSchema: menuTypeSchema,
  menuTypeUpdateSchema: menuTypeSchema.partial(),
};
