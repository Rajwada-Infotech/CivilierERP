const { z } = require("zod");
const { normalizePhone } = require("./phone");

// Shared helper: treat empty string / null as "not provided"
const emptyToUndef = (schema) =>
  z.preprocess((v) => (v === "" || v === null ? undefined : v), schema.optional());

// POST /api/crm/bookings — createCrmBookingRecord caller
// Mirrors the fields read off req.body in crmBookings.js POST /.
// Numeric IDs must be positive integers; optional fields accept ""/""/null.
const bookingCreateSchema = z.object({
  ApplicationId:     z.coerce.number().int().positive({ message: "ApplicationId is required" }),
  UnitIds:           z.array(z.coerce.number().int().positive()).min(1, "At least one unit must be selected").optional(),
  PlotIds:           z.array(z.coerce.number().int().positive()).optional(),
  PaymentPlanId:     emptyToUndef(z.coerce.number().int().positive()),
  BookingDate:       emptyToUndef(z.string()),
  TotalValue:        emptyToUndef(z.coerce.number().nonnegative()),
  BookingAmount:     emptyToUndef(z.coerce.number().nonnegative()),
  Notes:             emptyToUndef(z.string().max(4000)),
  BrokerId:          emptyToUndef(z.coerce.number().int().positive()),
  BrokerageRatePercent: emptyToUndef(z.coerce.number().min(0).max(100)),
}).refine(
  (data) => (data.UnitIds && data.UnitIds.length > 0) || (data.PlotIds && data.PlotIds.length > 0),
  { message: "Either UnitIds or PlotIds must be provided", path: ["UnitIds"] }
);

// POST /api/crm/payments/demands/bulk
const bulkDemandSchema = z.object({
  projectName: emptyToUndef(z.string().trim().min(1)),
  projectIds:  z.array(z.coerce.number().int().positive()).optional(),
  dueDate:     emptyToUndef(z.string()),
}).refine(
  (data) => data.projectName || (data.projectIds && data.projectIds.length > 0),
  { message: "Either projectName or projectIds must be provided" }
);

// POST /api/crm/customers — create customer
const customerCreateSchema = z.object({
  CustomerName: z.string().trim().min(1, "Customer name is required"),
  // Indian mobile, or a number from outside India with its country code (validation/phone.js).
  Mobile:       emptyToUndef(
    z.string().superRefine((v, ctx) => { const r = normalizePhone(v, "Mobile"); if (r.error) ctx.addIssue({ code: "custom", message: r.error }); })
  ),
  AltMobile:    emptyToUndef(
    z.string().superRefine((v, ctx) => { const r = normalizePhone(v, "Alt mobile"); if (r.error) ctx.addIssue({ code: "custom", message: r.error }); })
  ),
  Email:        emptyToUndef(z.string().email("Invalid email address")),
  AadhaarNo:    emptyToUndef(z.string().max(20)),
  PanNo:        emptyToUndef(z.string().max(20)),
});

// POST /api/crm/refunds — initiate refund
const refundCreateSchema = z.object({
  SourceOnAccountId: z.coerce.number().int().positive({ message: "SourceOnAccountId is required" }),
  TargetBookingId:   emptyToUndef(z.coerce.number().int().positive()),
  Amount:            z.coerce.number().positive({ message: "Amount must be a positive number" }),
  RefundMode:        emptyToUndef(z.string().max(50)),
  BankDetails:       emptyToUndef(z.string().max(500)),
  Remarks:           emptyToUndef(z.string().max(1000)),
});

module.exports = {
  bookingCreateSchema,
  bulkDemandSchema,
  customerCreateSchema,
  refundCreateSchema,
};
