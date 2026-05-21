import { z } from "zod";

const chequeNumber = z.union([z.number().int().positive(), z.literal("")]);

export const chequeMasterSchema = z
  .object({
    companyId: z.string().min(1, "Company is required"),
    bankId: z.string().min(1, "Bank is required"),
    bankName: z.string(),
    accountNumber: z.string().trim().min(1, "Account number is required"),
    ifscCode: z.string(),
    lotNumber: z.string().trim().min(1, "Lot number is required").max(100),
    chqStart: chequeNumber.refine(
      (value) => value !== "",
      "Start number is required",
    ),
    chqEnd: chequeNumber.refine(
      (value) => value !== "",
      "End number is required",
    ),
    totalCheques: z.number().int().nonnegative(),
    remarks: z.string().max(500),
    status: z.boolean(),
  })
  .refine((value) => Number(value.chqEnd) >= Number(value.chqStart), {
    path: ["chqEnd"],
    message: "End must be greater than or equal to start",
  });

export type ChequeMasterForm = z.infer<typeof chequeMasterSchema>;
