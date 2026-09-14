const { z } = require("zod");

const nullableString = (max) =>
  z.preprocess((value) => {
    if (value === undefined || value === null) return null;
    const trimmed = String(value).trim();
    return trimmed === "" ? null : trimmed;
  }, z.string().max(max).nullable());

// company_name, bank_name, card_type and card_holder_name are all NOT NULL
// columns in dbo.card_master with no fallback default in the insert —
// marking them nullable/optional here let a request through that crashed
// with an unhandled SQL "Cannot insert the value NULL" 500 instead of a
// clean validation error. Same bug class found and fixed across
// purchaseOrders.js, expenseBooking.js, workOrder.js, materialIssues.js,
// chequeMasterSchemas.js, and debitNote.js during a live-DB workflow test.
const requiredString = (max, message) =>
  z.preprocess(
    (value) => (typeof value === "string" ? value.trim() : value),
    z.string().min(1, message).max(max),
  );

const cardMasterSchema = z.object({
  company_name: requiredString(200, "Company name is required"),
  bank_id: z.coerce.number().int().nullable().optional(),
  bank_name: requiredString(200, "Bank name is required"),
  account_number: nullableString(50),
  ifsc_code: nullableString(20),
  card_network: nullableString(50),
  card_type: requiredString(50, "Card type is required"),
  card_holder_name: requiredString(150, "Card holder name is required"),
  card_number: z
    .string()
    .transform((value) => value.replace(/\D/g, "").slice(0, 16))
    .refine((value) => value.length >= 13, "Card number must be 13-16 digits"),
  cvv: z
    .string()
    .transform((value) => value.replace(/\D/g, "").slice(0, 4))
    .refine((value) => value.length >= 3, "CVC required (3-4 digits)"),
  expiry_month: z.coerce.number().int().min(1).max(12),
  expiry_year: z.coerce.number().int().min(2000),
  reminder_enabled: z.coerce.boolean().default(true),
  reminder_days: z.coerce.number().int().min(1).nullable().optional(),
  status: z.coerce.boolean().default(true),
});

module.exports = {
  cardMasterCreateSchema: cardMasterSchema,
  cardMasterUpdateSchema: cardMasterSchema,
};
