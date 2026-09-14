const { z } = require("zod");

const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;

const trimString = (max, message = `Must be ${max} characters or less`) =>
  z.preprocess(
    (value) => (typeof value === "string" ? value.trim() : value),
    z.string().max(max, message),
  );

const nullableString = (max) =>
  z.preprocess((value) => {
    if (value === undefined || value === null) return null;
    const trimmed = String(value).trim();
    return trimmed === "" ? null : trimmed;
  }, z.string().max(max).nullable());

const requiredString = (max, message) =>
  trimString(max).pipe(z.string().min(1, message));

const ifscSchema = z.preprocess(
  (value) => {
    if (value === undefined || value === null) return "";
    return String(value).trim().toUpperCase();
  },
  z
    .string()
    .regex(
      IFSC_REGEX,
      "Invalid IFSC Code format. Expected format: 4 letters + 0 + 6 alphanumeric (e.g. SBIN0001234)",
    ),
);

const openingBalanceSchema = z.preprocess((value) => {
  if (value === undefined || value === null || value === "") return 0;
  return Number(value);
}, z.number().finite().nonnegative("Opening balance must be 0 or greater"));

const bankMasterCreateSchema = z.object({
  BName: requiredString(200, "Bank Name is required"),
  BBranch: nullableString(100),
  BAccountNumber: requiredString(20, "Account Number is required"),
  BIfscCode: ifscSchema,
  BAccountType: nullableString(50),
  BBankType: nullableString(50),
  BAccountHolderName: nullableString(150),
  BOpeningBalance: openingBalanceSchema.default(0),
  BAddress: nullableString(300),
  BStatus: z.coerce.boolean().default(true),
  BCompanyName: nullableString(500),
  BLBelongsTo: z.preprocess(
    (v) => (v === undefined || v === null || v === "" ? null : Number(v)),
    z.number().int().positive().nullable(),
  ),
  // Optional Project tagging (see routes/bankMaster.js + crmProjectBanks.js).
  // Zod strips unknown keys by default and validateBody replaces req.body
  // with the parsed result, so this must be declared here or it silently
  // vanishes before the route ever sees it.
  ProjectIds: z.array(z.union([z.number(), z.string()])).optional(),
});

const bankMasterUpdateSchema = bankMasterCreateSchema.partial().extend({
  BOpeningBalance: openingBalanceSchema.optional(),
  BStatus: z.coerce.boolean().optional(),
});

module.exports = {
  bankMasterCreateSchema,
  bankMasterUpdateSchema,
};
