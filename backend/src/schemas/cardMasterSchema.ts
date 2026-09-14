import { z } from "zod";

const expiryRegex = /^(0[1-9]|1[0-2])\/\d{2}$/;

export const cardMasterSchema = z.object({
  companyName: z.string(),
  bankId: z.string().min(1, "Bank is required"),
  bankName: z.string(),
  accountNumber: z.string(),
  ifscCode: z.string(),
  network: z.string(),
  cardType: z.string(),
  cardHolder: z.string().max(150),
  cardNumber: z
    .string()
    .transform((value) => value.replace(/\D/g, "").slice(0, 16))
    .refine((value) => value.length >= 13, "Card number must be 13-16 digits"),
  cvv: z
    .string()
    .transform((value) => value.replace(/\D/g, "").slice(0, 4))
    .refine((value) => value.length >= 3, "CVC required (3-4 digits)"),
  expiryDate: z.string().regex(expiryRegex, "Valid expiry required (MM/YY)"),
  expiryMonth: z.number().int().min(1).max(12),
  expiryYear: z.number().int().min(2000),
  reminderEnabled: z.boolean(),
  reminderDays: z.number().int().min(1, "Reminder days must be at least 1"),
  status: z.boolean(),
});

export type CardMasterForm = z.infer<typeof cardMasterSchema>;
