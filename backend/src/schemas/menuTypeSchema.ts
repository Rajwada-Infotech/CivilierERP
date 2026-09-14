import { z } from "zod";

export const menuTypeSchema = z.object({
  MenuReceipt: z.string().max(200).optional().default(""),
  MenuPayment: z.string().max(200).optional().default(""),
  MenuBOQ: z.string().max(200).optional().default(""),
  MenuPurchaseOrder: z.string().max(200).optional().default(""),
  MenuWorkOrder: z.string().max(200).optional().default(""),
  CreatedBy: z.string().max(100).optional().default(""),
  UpdatedBy: z.string().max(100).optional().default(""),
  ApprovedBy: z.string().max(100).optional().default(""),
});

export type MenuTypeForm = z.infer<typeof menuTypeSchema>;
