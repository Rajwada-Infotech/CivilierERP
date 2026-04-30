const { z } = require("zod");

const chequeMasterCreateSchema = z
  .object({
    CompanyId: z.coerce.number().int().positive("Company is required"),
    BankId: z.coerce.number().int().positive("Bank is required"),
    AccountNumber: z.string().trim().min(1, "Account number is required").max(50),
    IFSCCode: z.string().trim().max(20).nullable().optional(),
    ChequeLotNumber: z.string().trim().min(1, "Lot number is required").max(100),
    ChequeStartNumber: z.coerce.number().int().positive("Start number is required"),
    ChequeEndNumber: z.coerce.number().int().positive("End number is required"),
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
