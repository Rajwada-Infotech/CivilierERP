import { z } from "zod";

export const TransactionStatusSchema = z.enum([
  "DRAFT",
  "PENDING",
  "APPROVED",
  "REJECTED",
  "CANCELLED",
  "COMPLETED",
]);

export const BaseTransactionSchema = z.object({
  companyId: z.union([z.string(), z.number()], { required_error: "Company is required" }),
  projectId: z.union([z.string(), z.number()], { required_error: "Project is required" }),
  tenure: z.string().optional().describe("Financial Year"),
  docNumber: z.string().optional(),
  docTypeId: z.union([z.string(), z.number()]).optional(),
  docDate: z.string().min(1, "Document date is required"),
  dueDate: z.string().optional(),
  remarks: z.string().optional(),
  status: TransactionStatusSchema.optional(),
  
  // Audit fields
  createdBy: z.union([z.string(), z.number()]).optional(),
  updatedBy: z.union([z.string(), z.number()]).optional(),
  approvedBy: z.union([z.string(), z.number()]).optional(),
  
  // Soft delete & Archival
  isDeleted: z.boolean().optional(),
  deletedAt: z.string().optional(),
  deletedBy: z.union([z.string(), z.number()]).optional(),
  isArchived: z.boolean().optional(),
  archivedAt: z.string().optional(),
  archivedBy: z.union([z.string(), z.number()]).optional(),
});

export const PaymentPayloadSchema = BaseTransactionSchema.extend({
  supplierId: z.union([z.string(), z.number()], { required_error: "Supplier is required" }),
  bankId: z.union([z.string(), z.number()]).optional(),
  amount: z.number().positive("Amount must be greater than zero"),
});