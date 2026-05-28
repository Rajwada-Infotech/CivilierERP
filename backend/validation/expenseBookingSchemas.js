const { z } = require("zod");

// ─── Shared primitives ────────────────────────────────────────────────────────

const optStr = (max) =>
  z.preprocess((v) => {
    if (v === undefined || v === null) return undefined;
    const t = String(v).trim();
    return t === "" ? undefined : t;
  }, z.string().max(max).optional());

const optCoerceNumber = z.coerce.number().optional();
const optCoerceDate = z.coerce.date().optional();
const optJsonPassthrough = z.any().optional(); // JSON blobs validated downstream

const VALID_STATUSES = ["Draft", "Submitted", "Approved", "Rejected", "Paid"];
const VALID_SOURCE_TYPES = [
  "PO",
  "WO",
  "WO_PO",
  "GRN",
  "TOD",
  "WORK_DONE",
  "Manual",
];

// ─── Core expense booking body (shared by POST and PUT /:id) ─────────────────

const expenseBookingBodySchema = z.object({
  EName: z.preprocess(
    (v) => (typeof v === "string" ? v.trim() : v),
    z.string().min(1, "Expense name is required").max(200),
  ),
  EProjectName: optStr(200),
  EDocumentType: optStr(100),
  EDocDate: optCoerceDate,
  EAmount: z.coerce.number().min(0, "Amount must be non-negative"),
  ENetAmount: z.coerce.number().min(0).optional(),
  ECgstRate: z.coerce.number().min(0).max(100).optional(),
  ESgstRate: z.coerce.number().min(0).max(100).optional(),
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
  ESourceType: z.enum(VALID_SOURCE_TYPES).optional(),
  ESourceId: z.coerce.number().int().positive().optional(),
  EBillingTermId: optCoerceNumber,
  EBillingTermName: optStr(200),
  EBillingTermsData: optJsonPassthrough,
  ETCId: optCoerceNumber,
  ETCName: optStr(200),
  ETCText: z.preprocess((v) => {
    if (v === undefined || v === null) return undefined;
    const t = String(v).trim();
    return t === "" ? undefined : t;
  }, z.string().optional()),
  EVendorInvoiceNo: optStr(100),
  EVendorInvoiceDate: optCoerceDate,
  EAdditionalCharges: optJsonPassthrough,
  ECostCenter: optStr(200),
  EGLAccount: optStr(200),
  EWorkDoneRef: optCoerceNumber,
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
