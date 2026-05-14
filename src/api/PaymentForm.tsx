import React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { PaymentPayloadSchema } from "@/schemas/transaction.schema";
import type { PaymentPayload } from "@/api/newPaymentApi";
import { useGlobalFilters } from "@/contexts/GlobalFilterContext";

export const PaymentForm = () => {
  const { selectedCompany, selectedProject, selectedFinancialYear } = useGlobalFilters();

  // 1. Form derives its entirely validation rules from the central schema
  const { register, handleSubmit, formState: { errors } } = useForm<PaymentPayload>({
    resolver: zodResolver(PaymentPayloadSchema),
    defaultValues: {
      companyId: selectedCompany || "",
      projectId: selectedProject || "",
      tenure: selectedFinancialYear || "",
      docDate: new Date().toISOString().split("T")[0],
      status: "DRAFT",
    },
  });

  const onSubmit = async (data: PaymentPayload) => {
    console.log("Validated payload ready for API:", data);
    // await addPayment(data);
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      {/* Schema handles the validation, React Hook Form handles the state */}
      <div>
        <label>Supplier ID</label>
        <input {...register("supplierId")} className="border p-2 w-full" />
        {errors.supplierId && <span className="text-red-500">{errors.supplierId.message}</span>}
      </div>

      <div>
        <label>Amount</label>
        <input type="number" step="0.01" {...register("amount", { valueAsNumber: true })} className="border p-2 w-full" />
        {errors.amount && <span className="text-red-500">{errors.amount.message}</span>}
      </div>
      
      {/* Additional fields... */}

      <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded">
        Save Payment
      </button>
    </form>
  );
};