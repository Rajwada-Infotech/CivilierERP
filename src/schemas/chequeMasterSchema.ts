import { z } from "zod";

// MICR cheque number: exactly 15 alphanumeric characters
// Layout: [6 cheque seq][3 city][3 bank][3 branch]
const micrChequeNumber = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9]{15}$/, "Must be exactly 15 alphanumeric characters (MICR format)");

export const chequeMasterSchema = z
  .object({
    companyId:    z.string().min(1, "Company is required"),
    bankId:       z.string().min(1, "Bank is required"),
    bankName:     z.string(),
    accountNumber: z.string().trim().min(1, "Account number is required"),
    ifscCode:     z.string(),
    lotNumber:    z.string().trim().min(1, "Lot number is required").max(100),
    chqStart:     micrChequeNumber,
    chqEnd:       micrChequeNumber,
    totalCheques: z.number().int().nonnegative(),
    remarks:      z.string().max(500),
    status:       z.boolean(),
  })
  .refine(
    (v) => {
      const startSeq = parseInt(v.chqStart.slice(0, 6), 10);
      const endSeq   = parseInt(v.chqEnd.slice(0, 6), 10);
      return endSeq >= startSeq;
    },
    { path: ["chqEnd"], message: "Last cheque number must be ≥ first cheque number" },
  )
  .refine(
    (v) => {
      // Suffix (city+bank+branch) must be identical on both ends
      return v.chqStart.slice(6) === v.chqEnd.slice(6);
    },
    { path: ["chqEnd"], message: "City, bank, and branch codes must match between first and last cheque" },
  );

export type ChequeMasterForm = z.infer<typeof chequeMasterSchema>;
