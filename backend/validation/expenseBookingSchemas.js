const { z } = require("zod");

// ─── Shared primitives ────────────────────────────────────────────────────────

const optStr = (max) =>
  z.preprocess((v) => {
    if (v === undefined || v === null) return undefined;
    const t = String(v).trim();
    return t === "" ? undefined : t;
  }, z.string().max(max).optional());

const optCoerceNumber = z.preprocess(
  (v) => (v === null || v === undefined || v === "" ? undefined : Number(v)),
  z.number().optional(),
);
const optCoerceDate = z.preprocess(
  (v) => (v === null || v === undefined || v === "" ? undefined : v),
  z.coerce.date().optional(),
);
const optJsonPassthrough = z.any().optional(); // JSON blobs validated downstream

const VALID_STATUSES = [
  "Draft",
  "Pending",
  "Submitted",
  "Approved",
  "Rejected",
  "Paid",
  "Booked",
  "Hold",
];
const VALID_SOURCE_TYPES = [
  "PO",
  "WO",
  "WO_PO",
  "GRN",
  "TOD",
  "WORK_DONE",
  "Manual",
];

// ─── EName: self-healing ──────────────────────────────────────────────────────
// The frontend always sends a non-empty EName now (recordToDb + handleSave guard).
// This preprocess is a final backend safety net: if the field is somehow still
// blank/null/undefined, generate a dated fallback rather than hard-rejecting the
// entire request with a cryptic "Validation failed" 400.
const eName = z.preprocess((v) => {
  if (v === undefined || v === null) return _fallbackName();
  const t = String(v).trim();
  return t === "" ? _fallbackName() : t.slice(0, 200);
}, z.string().min(1).max(200));

function _fallbackName() {
  const now = new Date();
  const d = now.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  return `Expense ${d}`;
}

// ─── EAmount: null-safe ───────────────────────────────────────────────────────
// z.coerce.number() on null/undefined produces NaN which still fails .min(0).
// Convert null/undefined/NaN → 0 here. The frontend blocks save when amount
// is 0 for GRN, so 0 in the DB just means "not yet computed" for drafts.
const eAmount = z.preprocess(
  (v) => {
    if (v === undefined || v === null || v === "") return 0;
    const n = Number(v);
    return isNaN(n) ? 0 : n;
  },
  z.number().min(0, "Amount must be non-negative"),
);

// ─── ESourceType: tolerant enum ───────────────────────────────────────────────
// Unknown values fall back to null (optional) rather than rejecting the request.
const eSourceType = z.preprocess((v) => {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return VALID_SOURCE_TYPES.includes(s) ? s : undefined;
}, z.enum(VALID_SOURCE_TYPES).optional());

// ─── Core expense booking body (shared by POST and PUT /:id) ─────────────────

const expenseBookingBodySchema = z.object({
  EName: eName,
  EProjectName: optStr(200),
  EDocumentType: optStr(100),
  EDocDate: optCoerceDate,
  EAmount: eAmount,
  ENetAmount: z.preprocess(
    (v) => (v === null || v === undefined || v === "" ? undefined : Number(v)),
    z.number().min(0).optional(),
  ),
  ECgstRate: optCoerceNumber.pipe(z.number().min(0).max(100).optional()),
  ESgstRate: optCoerceNumber.pipe(z.number().min(0).max(100).optional()),
  EIgstRate: optCoerceNumber.pipe(z.number().min(0).max(100).optional()),
  EPaymentType: z.preprocess(
    (v) => (v === "partial" ? "partial" : "full"),
    z.enum(["full", "partial"]),
  ),
  EPartialAmount: z.preprocess(
    (v) => (v === null || v === undefined || v === "" ? undefined : Number(v)),
    z.number().min(0).optional(),
  ),
  EDiscountData: optJsonPassthrough,
  EDocNo: optStr(100),
  EEmiPayment: z.coerce.boolean().optional(),
  EEmiData: optJsonPassthrough,
  EInstallmentCount: z.preprocess(
    (v) => (v === null || v === undefined || v === "" ? undefined : v),
    z.coerce.number().int().min(1).max(360).optional(),
  ),
  EEmiAmount: z.preprocess(
    (v) => (v === null || v === undefined || v === "" ? undefined : v),
    z.coerce.number().min(0).optional(),
  ),
  EEmiStartDate: optCoerceDate,
  EReminder: optCoerceDate,
  ERemarks: optStr(1000),
  EStatus: z.enum(VALID_STATUSES).default("Draft"),
  ECompanyId: optCoerceNumber,
  EDocTypeId: z.preprocess(
    (v) => (v === null || v === undefined || v === "" ? undefined : v),
    z.coerce.number().int().positive().optional(),
  ),
  EFinYear: optStr(20),
  ESourceType: eSourceType,
  ESourceId: z.coerce.number().int().positive().optional(),
  // Multiple GRNs (same PO) combined into one invoice — see
  // backend/services/invoiceLinking.js. Optional; a single-element or
  // absent array means "book against ESourceId as usual".
  linkedGrnIds: z.array(z.coerce.number().int().positive()).optional(),
  EBillingTermId: z.preprocess(
    (v) => (v === null || v === undefined || v === "" ? undefined : Number(v)),
    z.number().optional(),
  ),
  EBillingTermName: optStr(200),
  EBillingTermsData: optJsonPassthrough,
  ETCId: z.preprocess(
    (v) => (v === null || v === undefined || v === "" ? undefined : Number(v)),
    z.number().optional(),
  ),
  ETCName: optStr(200),
  ETCText: z.preprocess((v) => {
    if (v === undefined || v === null) return undefined;
    const t = String(v).trim();
    return t === "" ? undefined : t;
  }, z.string().optional()),
  EVendorInvoiceNo: optStr(100),
  EVendorInvoiceDate: z.preprocess(
    (v) => (v === null || v === undefined || v === "" ? undefined : v),
    z.coerce.date().optional(),
  ),
  EAdditionalCharges: optJsonPassthrough,
  ECostCenter: optStr(200),
  EGLAccount: optStr(200),
  EWorkDoneRef: z.preprocess(
    (v) => (v === null || v === undefined || v === "" ? undefined : Number(v)),
    z.number().optional(),
  ),
  // AccountHeadMaster.LHeadId for the supplier chosen directly on the form —
  // only actually consulted by the backend when the booking has no PO/WO/GRN
  // source document to derive the supplier from (direct/manual bookings).
  LHeadId: z.preprocess(
    (v) => (v === null || v === undefined || v === "" ? undefined : Number(v)),
    z.number().int().positive().optional(),
  ),
});

// PUT /:id — partial update (all fields optional except numeric consistency)
const expenseBookingUpdateSchema = expenseBookingBodySchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, "At least one field is required");

// PUT /:id/emi-schedule/:no/pay
const emiPaySchema = z.object({
  paymentRef: optStr(200),
});

// PUT /:id/emi-toggle
const emiToggleSchema = z.object({
  enabled: z.coerce.boolean({
    errorMap: () => ({ message: "enabled must be a boolean" }),
  }),
  deleteUnpaid: z.coerce.boolean().default(true),
});

// PUT /:id/reject
const expenseRejectSchema = z.object({
  note: optStr(500),
});

module.exports = {
  expenseBookingBodySchema,
  expenseBookingUpdateSchema,
  emiPaySchema,
  emiToggleSchema,
  expenseRejectSchema,
};
