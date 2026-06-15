const { z } = require("zod");

// ── shared helpers ────────────────────────────────────────────────────────────

const emptyToUndefined = (value) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string" && value.trim() === "") return undefined;
  return value;
};

const optStr = (max) =>
  z.preprocess(emptyToUndefined, z.string().trim().max(max).optional());

const reqStr = (max, message) =>
  z.preprocess(
    (value) => (typeof value === "string" ? value.trim() : value),
    z
      .string({ required_error: message, invalid_type_error: message })
      .min(1, message)
      .max(max),
  );

const optInt = z.preprocess(
  emptyToUndefined,
  z.coerce.number().int().positive().optional(),
);

const reqInt = (message) =>
  z.preprocess(
    (value) => {
      const cleaned = emptyToUndefined(value);
      return cleaned === undefined ? cleaned : Number(cleaned);
    },
    z
      .number({ required_error: message, invalid_type_error: message })
      .int(message)
      .positive(message),
  );

const optNumber = z.preprocess(
  emptyToUndefined,
  z.coerce.number().finite().optional(),
);

const reqNonNegativeNumber = (message) =>
  z.preprocess(
    (value) => {
      const cleaned = emptyToUndefined(value);
      return cleaned === undefined ? cleaned : Number(cleaned);
    },
    z
      .number({ required_error: message, invalid_type_error: message })
      .finite(message)
      .min(0, message),
  );

const optDate = z.preprocess(emptyToUndefined, z.coerce.date().optional());

const reqDate = (message) =>
  z.preprocess(
    (value) => {
      const cleaned = emptyToUndefined(value);
      return cleaned === undefined ? cleaned : new Date(cleaned);
    },
    z.date({ required_error: message, invalid_type_error: message }),
  );

const jsonPassthrough = z.any().optional();

const noteField = z.object({ note: optStr(2000) }).passthrough();

// ── purchaseOrders ────────────────────────────────────────────────────────────

const poLineItemSchema = z
  .object({
    itemId: optStr(100),
    itemName: optStr(255),
    itemDescription: optStr(255),
    itemCode: optStr(50),
    description: optStr(4000),
    quantity: optNumber,
    rate: optNumber,
    amount: optNumber,
    unit: optStr(50),
    tax: optNumber,
  })
  .passthrough();

const purchaseOrderBaseSchema = z
  .object({
    PurchaseOrderNo: optStr(100),
    PODate: optDate,
    ExpectedDeliveryDate: optDate,
    SupplierID: optInt,
    CompanyId: optInt,
    ProjectId: optInt,
    ItemDescription: optStr(4000),
    Quantity: optNumber,
    Unit: optStr(50),
    Rate: optNumber,
    TotalAmount: optNumber,
    PaymentTerms: optStr(4000),
    Status: optStr(50),
    Remarks: optStr(4000),
    DocTypeId: optInt,
    finYear: optStr(20),
    POItems: z.union([z.array(poLineItemSchema), z.string()]).optional(),
    Discount: jsonPassthrough,
    GST: jsonPassthrough,
    SourceWOId: optInt,
    SourceWODocNo: optStr(100),
    SourceMRId: optInt,
    SourceMRDocNo: optStr(100),
    SourceWDId: optInt,
    SourceWDDocNo: optStr(100),
    POType: optStr(20),
  })
  .passthrough();

const purchaseOrderBodySchema = purchaseOrderBaseSchema.refine(
  (value) => value.DocTypeId || value.PurchaseOrderNo,
  {
    path: ["PurchaseOrderNo"],
    message: "Select a document type or enter a purchase order number",
  },
);

const purchaseOrderUpdateSchema = purchaseOrderBaseSchema
  .extend({
    DocNo: optStr(100),
  })
  .passthrough();

// ── grns ──────────────────────────────────────────────────────────────────────

const grnItemSchema = z
  .object({
    itemId: optStr(100),
    receivedQty: optNumber,
    quantity: optNumber,
    rate: optNumber,
    totalAmount: optNumber,
    uom: optStr(20),
  })
  .passthrough();

const grnBodySchema = z
  .object({
    grnNo: optStr(50),
    grnDate: reqDate("GRN date is required"),
    supplierId: reqInt("Supplier is required"),
    poId: optInt,
    grnItems: z.union([z.array(grnItemSchema), z.string()]).optional(),
    status: optStr(50),
    remarks: optStr(4000),
    docTypeId: optInt,
    docNo: optStr(100),
    finYear: optStr(20),
    parentDocNo: optStr(100),
    rootExBDocNo: optStr(100),
  })
  .passthrough();

// ── newPayment ────────────────────────────────────────────────────────────────

const paymentBodySchema = z.preprocess(
  (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return value;
    }

    const body = value;
    return {
      ...body,
      PPaymentName: body.PPaymentName ?? body.remarks ?? body.paymentName,
      PMode: body.PMode ?? body.mode,
      PAmount: body.PAmount ?? body.amount,
      PDocType: body.PDocType ?? body.docTypeId,
      PDate: body.PDate ?? body.docDate ?? body.date,
      PBankID: body.PBankID ?? body.bankId,
      PBankName: body.PBankName ?? body.bankName,
      PProject: body.PProject ?? body.projectId ?? body.project,
      PCompany: body.PCompany ?? body.companyId ?? body.company,
      PExpenseRef: body.PExpenseRef ?? body.supplierId ?? body.expenseRef,
      PChequeNo: body.PChequeNo ?? body.chequeNo,
      PChequeLotId: body.PChequeLotId ?? body.chequeLotId,
      PChequeLotNumber: body.PChequeLotNumber ?? body.chequeLotNumber,
      PChequeDate: body.PChequeDate ?? body.chequeDate,
      PChequeAccountNumber:
        body.PChequeAccountNumber ?? body.chequeAccountNumber,
      PChequeIfsc: body.PChequeIfsc ?? body.chequeIfsc,
      PIsPostDated: body.PIsPostDated ?? body.isPostDated,
      PNeftNumber: body.PNeftNumber ?? body.neftNumber,
      PUpiTransactionId: body.PUpiTransactionId ?? body.upiTransactionId,
      PRtgsReference: body.PRtgsReference ?? body.rtgsReference,
      PImpsReference: body.PImpsReference ?? body.impsReference,
    };
  },
  z
    .object({
      PPaymentName: optStr(200),
      PMode: reqStr(50, "Payment mode is required"),
      PAmount: reqNonNegativeNumber("Amount must be non-negative"),
      PDocType: optStr(50),
      PDate: optDate,
      PBankID: optInt,
      PBankName: optStr(200),
      PProject: optStr(200),
      PCompany: optStr(200),
      PExpenseRef: optStr(100),
      parentDocNo: optStr(100),
      rootExBDocNo: optStr(100),
      PChequeNo: optStr(50),
      PChequeLotId: optInt,
      PChequeLotNumber: optStr(100),
      PChequeDate: optDate,
      PChequeAccountNumber: optStr(50),
      PChequeIfsc: optStr(20),
      PIsPostDated: z.coerce.boolean().optional(),
      PNeftNumber: optStr(50),
      PUpiTransactionId: optStr(100),
      PRtgsReference: optStr(100),
      PImpsReference: optStr(100),
    })
    .passthrough(),
);

// ── workOrder ─────────────────────────────────────────────────────────────────

const workOrderHeaderBase = z
  .object({
    CompanyId: optInt,
    ProjectId: optInt,
    DocumentNumber: optStr(100),
    DocumentDate: optDate,
    ContractorId: optInt,
    SupplierId: optInt,
    TotalAmount: optNumber,
    Remarks: optStr(4000),
    TermsAndConditions: optStr(4000),
    DocTypeId: optInt,
    DocNo: optStr(100),
    finYear: optStr(10),
    GST: jsonPassthrough,
    BoqID: optInt,
  })
  .passthrough();

const workOrderActivitySchema = z
  .object({
    ActivityGroupId: optInt,
    ActivityId: optInt,
    UOMId: optInt,
    Rate: optNumber,
    Area: optNumber,
    LabourAmount: optNumber,
    MaterialAmount: optNumber,
    GrandTotal: optNumber,
    Remarks: optStr(500),
  })
  .passthrough();

const workOrderMaterialSchema = z
  .object({
    ItemId: z
      .string()
      .trim()
      .min(1, "ItemId is required")
      .uuid("Must be a valid UUID"),
    UOMId: optInt,
    Quantity: optNumber,
    Rate: optNumber,
    Remarks: optStr(2000),
    SupplierIdPerLine: optInt,
  })
  .passthrough();

const workOrderSaveFullSchema = z
  .object({
    header: workOrderHeaderBase.partial(),
    activities: z.array(z.any()),
  })
  .passthrough();

const workOrderCreateSchema = workOrderHeaderBase;
const workOrderUpdateSchema = workOrderHeaderBase.partial();

// ── amendments ────────────────────────────────────────────────────────────────

const amendmentBase = z
  .object({
    RefDocId: optInt,
    RefDocType: optStr(100),
    RefDocNo: optStr(100),
    OriginalValue: optNumber,
    RevisedValue: optNumber,
    ProjectName: optStr(200),
    CompanyName: optStr(200),
    Description: optStr(2000),
    Reason: optStr(2000),
    AmendmentDate: optDate,
  })
  .passthrough();

const amendmentLineChangeSchema = z
  .object({
    FieldName: z.string().trim().min(1, "FieldName required").max(200),
    FieldLabel: optStr(200),
    OldValue: z.string().nullable().optional(),
    NewValue: z.string().nullable().optional(),
  })
  .passthrough();

const amendmentLineChangesSchema = z
  .object({
    changes: z
      .array(amendmentLineChangeSchema)
      .min(1, "changes array must not be empty"),
  })
  .passthrough();

// ── boq ───────────────────────────────────────────────────────────────────────

const boqBase = z
  .object({
    BoqNo: optStr(100),
    BoqDate: optDate,
    CompanyId: optInt,
    ProjectId: optInt,
    Description: optStr(4000),
    BoqItems: jsonPassthrough,
    BoqActivities: jsonPassthrough,
    Status: optStr(50),
    Remarks: optStr(4000),
    DocTypeId: optInt,
    DocNo: optStr(100),
    finYear: optStr(10),
  })
  .passthrough();

// ── receivedPayment ───────────────────────────────────────────────────────────

const rpBase = z
  .object({
    RPCompanyName: optStr(255),
    RPCompanyId: optInt,
    RPReceivedFrom: optStr(255),
    RPCustomerName: optStr(255),
    RPProjectName: optStr(255),
    RPProjectId: optInt,
    RPDocDate: optDate,
    RPFinYear: optStr(10),
    RPDocTypeId: optInt,
    RPMode: optStr(50),
    RPAmount: optNumber,
    RPBankName: optStr(255),
    RPTransactionId: optStr(255),
    RPCheckNumber: optStr(100),
    RPRemarks: optStr(4000),
    RPDepositBankId: optInt,
    RPDepositBankName: optStr(255),
    RPIsEmi: z.coerce.boolean().optional(),
    RPEmiTotal: optNumber,
    RPEmiMonths: z.preprocess(
      emptyToUndefined,
      z.coerce.number().int().positive().optional(),
    ),
    RPEmiStartDate: optStr(30),
    RPEmiSchedule: jsonPassthrough,
    RPEmiPaying: jsonPassthrough,
  })
  .passthrough();

// ── exports ───────────────────────────────────────────────────────────────────

module.exports = {
  // purchaseOrders
  purchaseOrderBodySchema,
  purchaseOrderUpdateSchema,

  // grns
  grnBodySchema,

  // newPayment
  paymentBodySchema,

  // workOrder
  workOrderCreateSchema,
  workOrderUpdateSchema,
  workOrderActivitySchema,
  workOrderMaterialSchema,
  workOrderSaveFullSchema,

  // amendments
  amendmentCreateSchema: amendmentBase,
  amendmentUpdateSchema: amendmentBase.partial(),
  amendmentNoteSchema: noteField,
  amendmentLineChangesSchema,

  // boq
  boqCreateSchema: boqBase,
  boqUpdateSchema: boqBase.partial(),
  boqNoteSchema: noteField,

  // receivedPayment
  receivedPaymentCreateSchema: rpBase,
  receivedPaymentUpdateSchema: rpBase.partial(),
  receivedPaymentNoteSchema: noteField,
};