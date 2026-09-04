const { z } = require("zod");

// Frontend forms routinely send "" for an unset optional field rather than
// omitting the key — normalize that to undefined before the real check
// runs, matching what backend/routes/crmMutation.js's own handler already
// treats as absent.
const emptyToUndef = (schema) => z.preprocess((v) => (v === "" ? undefined : v), schema.optional());

// Mirrors the exact fields backend/routes/crmMutation.js POST / already
// reads off req.body.
const crmMutationCreateSchema = z.object({
  BookingId: z.coerce.number().int().positive(),
  ApplicationNo: emptyToUndef(z.string().trim().max(100)),
  ApplicationDate: emptyToUndef(z.coerce.date()),
  Authority: emptyToUndef(z.string().trim().max(200)),
  OldKhataNo: emptyToUndef(z.string().trim().max(100)),
  MutationFee: emptyToUndef(z.coerce.number().nonnegative()),
  Remarks: z.string().trim().optional(),
});

// PUT /:id/approve — NewKhataNo is the one hard-required field; ApprovedNo/
// ApprovedDate are optional (default to now server-side if omitted).
const crmMutationApproveSchema = z.object({
  NewKhataNo: z.string().trim().min(1, "New Khata No. is required").max(100),
  ApprovedNo: emptyToUndef(z.string().trim().max(100)),
  ApprovedDate: emptyToUndef(z.coerce.date()),
  Remarks: z.string().trim().optional(),
});

module.exports = { crmMutationCreateSchema, crmMutationApproveSchema };
