const { z } = require("zod");

const nullableString = (max) =>
  z.preprocess((value) => {
    if (value === undefined || value === null) return null;
    const trimmed = String(value).trim();
    return trimmed === "" ? null : trimmed;
  }, z.string().max(max).nullable());

const cardMasterSchema = z.object({
  company_name: nullableString(200),
  bank_id: z.coerce.number().int().nullable().optional(),
  bank_name: nullableString(200),
  account_number: nullableString(50),
  ifsc_code: nullableString(20),
  card_network: nullableString(50),
  card_type: nullableString(50),
  card_holder_name: nullableString(150),
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
