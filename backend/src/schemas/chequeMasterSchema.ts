import { z } from "zod";

// MICR cheque number: 6-digit cheque sequence, optionally followed by the
// 9-digit city/bank/branch suffix for the full 15-char MICR code.
// Layout: [6 cheque seq][3 city][3 bank][3 branch]
const micrChequeNumber = z
  .string()
  .trim()
  .regex(
    /^[A-Za-z0-9]{6}([A-Za-z0-9]{9})?$/,
    "Must be at least the 6-digit cheque number (optionally the full 15-character MICR code)",
  );

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
      // Suffix (city+bank+branch) only needs to match when both sides carry
      // the full 15-char MICR code — a bare 6-digit cheque number has no suffix to compare.
      if (v.chqStart.length < 15 || v.chqEnd.length < 15) return true;
      return v.chqStart.slice(6) === v.chqEnd.slice(6);
    },
    { path: ["chqEnd"], message: "City, bank, and branch codes must match between first and last cheque" },
  );

export type ChequeMasterForm = z.infer<typeof chequeMasterSchema>;
