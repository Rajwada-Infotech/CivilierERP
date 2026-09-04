const { z } = require("zod");

// Mirrors the exact fields backend/routes/crmCancellations.js POST / already
// reads off req.body. DeductionPercent's 0-100 bound was previously checked
// manually inline (still is, as defense in depth — this schema doesn't
// replace that check, it just rejects garbage earlier). Frontend forms
// often send "" for an unset optional field rather than omitting it.
const emptyToUndef = (schema) => z.preprocess((v) => (v === "" ? undefined : v), schema.optional());

const crmCancellationCreateSchema = z.object({
  BookingId: z.coerce.number().int().positive(),
  Reason: z.string().trim().optional(),
  DeductionPercent: emptyToUndef(z.coerce.number().min(0).max(100)),
});

module.exports = { crmCancellationCreateSchema };
