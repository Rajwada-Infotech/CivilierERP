const { z } = require("zod");

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
    SourceQTId: optInt,
    SourceQTDocNo: optStr(100),
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

const customerSaleOrderLineItemSchema = z
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
  })
  .passthrough();

const customerSaleOrderBaseSchema = z
  .object({
    SaleOrderNo: optStr(100),
    SODate: optDate,
    CustomerID: reqInt("Customer is required"),
    CompanyId: optInt,
    ProjectId: optInt,
    ItemDescription: optStr(4000),
    Quantity: optNumber,
    Unit: optStr(50),
    Rate: optNumber,
    TotalAmount: optNumber,
    ReceivingGodownId: optInt,
    ReferenceNumber: optStr(100),
    PaymentTerms: optStr(4000),
    Status: optStr(50),
    Remarks: optStr(4000),
    DocTypeId: optInt,
    finYear: optStr(20),
    SOItems: z.union([z.array(customerSaleOrderLineItemSchema), z.string()]).optional(),
  })
  .passthrough();

const customerSaleOrderBodySchema = customerSaleOrderBaseSchema.refine(
  (value) => value.DocTypeId || value.SaleOrderNo,
  {
    path: ["SaleOrderNo"],
    message: "Select a document type or enter a sale order number",
  },
);

const customerSaleOrderUpdateSchema = customerSaleOrderBaseSchema.passthrough();

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
    docDate: optDate,
    supplierId: reqInt("Supplier is required"),
    poId: optInt,
    vehicleInOutId: optInt,
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

const paymentBodySchema = z
  .preprocess((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return value;
    }

    const body = value;
    return {
      ...body,
      PPaymentName: body.PPaymentName ?? body.paymentName ?? body.remarks,
      PRemarks: body.PRemarks ?? body.notes,
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
      PCardReference: body.PCardReference ?? body.cardReference,
      PCardId: body.PCardId ?? body.cardId,
    };
  },
  z
    .object({
      PPaymentName: optStr(200),
      PRemarks: optStr(1000),
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
      PCardReference: optStr(100),
      PCardId: optInt,
    })
    .passthrough(),
  );

module.exports = {
  purchaseOrderBodySchema,
  purchaseOrderUpdateSchema,
  customerSaleOrderBodySchema,
  customerSaleOrderUpdateSchema,
  grnBodySchema,
  paymentBodySchema,
};