const { z } = require("zod");

// Frontend forms across this codebase routinely send "" for an unset
// optional field rather than omitting the key — the existing handler
// already treats that as absent (`b.Field != null && b.Field !== ""`).
// z.coerce.date()/z.coerce.number() would otherwise reject "" as an invalid
// date/number, which would be a real regression, not a validation
// improvement. Normalize "" to undefined before the real check runs.
const emptyToUndef = (schema) => z.preprocess((v) => (v === "" ? undefined : v), schema.optional());

const money = emptyToUndef(z.coerce.number().nonnegative());
const optDate = emptyToUndef(z.coerce.date());
const optStr = (max) => emptyToUndef(z.string().trim().max(max));

// Mirrors the exact fields backend/routes/crmSalesDeed.js POST / already
// reads off req.body — this schema doesn't change what's accepted, it just
// rejects garbage (non-numeric BookingId, negative money) before any of
// that handler's own DB reads run, instead of letting a malformed value
// surface as a raw SQL/JS error later in the request.
const crmSalesDeedCreateSchema = z.object({
  BookingId: z.coerce.number().int().positive(),
  AgreementId: emptyToUndef(z.coerce.number().int().positive()),
  DeedValue: money,
  StampDuty: money,
  RegistrationFee: money,
  StampDutyCredit: money,
  SubRegistrarOffice: optStr(255),
  DeedDate: optDate,
  RegistrationDeadline: optDate,
  WitnessNames: optStr(500),
  Notes: z.string().trim().optional(),
});

module.exports = { crmSalesDeedCreateSchema };
