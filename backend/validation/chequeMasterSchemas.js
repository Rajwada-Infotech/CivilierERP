const { z } = require("zod");

const chequeMasterCreateSchema = z
  .object({
    CompanyId: z.coerce.number().int().positive("Company is required"),
    BankId: z.coerce.number().int().positive("Bank is required"),
    AccountNumber: z.string().trim().min(1, "Account number is required").max(50),
    // IFSCCode is a NOT NULL column in dbo.ChequeMaster with no fallback
    // default in the insert — marking it optional here let a request through
    // that crashed with an unhandled SQL "Cannot insert the value NULL" 500
    // instead of this clean validation error. Same bug class found and
    // fixed in purchaseOrders.js, expenseBooking.js, workOrder.js, and
    // materialIssues.js during a live-DB workflow test.
    IFSCCode: z.string().trim().min(1, "IFSC code is required").max(20),
    ChequeLotNumber: z.string().trim().min(1, "Lot number is required").max(100),
    ChequeStartNumber: z.coerce.number().int().positive("Start number is required"),
    ChequeEndNumber: z.coerce.number().int().positive("End number is required"),
    // Full padded cheque-number string (leading zeros preserved), optionally with
    // the 9-char city/bank/branch MICR suffix. Without declaring these here, zod's
    // .object() strips them before the route handler ever sees req.body — they
    // were reaching the API from the frontend but being silently dropped, so
    // ChequeStartNumber/ChequeEndNumber saved fine while these stayed NULL.
    ChequeStartMICR: z.string().trim().max(15).nullable().optional(),
    ChequeEndMICR: z.string().trim().max(15).nullable().optional(),
    TotalCheques: z.coerce.number().int().positive().nullable().optional(),
    Remarks: z.string().trim().max(500).nullable().optional(),
    Status: z.coerce.boolean().default(true),
  })
  .refine((value) => value.ChequeEndNumber >= value.ChequeStartNumber, {
    path: ["ChequeEndNumber"],
    message: "End must be greater than or equal to start",
  })
  .transform((value) => ({
    ...value,
    TotalCheques: value.ChequeEndNumber - value.ChequeStartNumber + 1,
  }));

const chequeMasterUpdateSchema = chequeMasterCreateSchema;

module.exports = { chequeMasterCreateSchema, chequeMasterUpdateSchema };