import React, { useEffect, useState } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { MaterialShell } from "@/components/material/MaterialShell";
import {
  MasterPage,
  type FieldDef,
  type ColumnDef,
  type DataChangeEvent,
} from "@/components/MasterPage";

import { Book, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  useBillingTerms,
  type BillingTerm,
} from "@/contexts/BillingTermsContext";
import {
  getBillingTerms,
  addBillingTerm,
  updateBillingTerm,
  deleteBillingTerm,
  type BillingTermRow,
} from "@/api/billingTermsMasterApi";

// ─── Map DB row → context shape ───────────────────────────────────────────────
// NOTE: We also spread the raw DB column names (Name, CalculationType,
// DeductionType, IsActive) so that MasterPage's handleEdit can populate
// the form fields correctly when the user clicks Edit.
const mapRow = (
  row: BillingTermRow,
): BillingTerm & Record<string, unknown> => ({
  id: String(row.BillingTermID),
  _id: String(row.BillingTermID),
  // Context-shape fields
  name: row.Name ?? "",
  description: row.Description ?? "",
  billType: "Tax Invoice",
  discountType: "none",
  discountValue: 0,
  paymentDueDays: 0,
  appliedOn: row.CalculationType === "After GST" ? "post-gst" : "pre-gst",
  status: Boolean(row.IsActive),
  deductionType: row.DeductionType === "Deduction" ? "Deduction" : "Addition",
  // Raw DB columns — required by the form fields (Name, CalculationType, etc.)
  Name: row.Name ?? "",
  Description: row.Description ?? "",
  CalculationType: row.CalculationType ?? "Before GST",
  DeductionType: row.DeductionType ?? "Addition",
  IsActive: Boolean(row.IsActive),
});

// ─── Segmented toggler: Addition | Deduction ──────────────────────────────────
function DeductionToggler({
  value,
  onChange,
}: {
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const current = (value as string) || "Addition";
  return (
    <div className="flex items-center gap-1 p-1 rounded-lg bg-muted border border-border w-fit">
      {(["Addition", "Deduction"] as const).map((opt) => {
        const active = current === opt;
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            className={`px-4 py-1.5 rounded-md text-xs font-heading font-semibold transition-all ${
              active
                ? opt === "Addition"
                  ? "bg-green-500 text-white shadow-sm"
                  : "bg-destructive text-white shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {opt === "Addition" ? "+ Addition" : "− Deduction"}
          </button>
        );
      })}
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────
const BillingTermsMaster: React.FC = () => {
  const { billingTerms, setBillingTerms } = useBillingTerms();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getBillingTerms()
      .then((rows) => setBillingTerms(rows.map(mapRow)))
      .catch(() => toast.error("Failed to load billing terms"))
      .finally(() => setLoading(false));
  }, []);

  const refetch = async () => {
    const fresh = await getBillingTerms();
    setBillingTerms(fresh.map(mapRow));
  };

  const fields: FieldDef[] = [
    {
      name: "Name",
      label: "Term Name",
      type: "text",
      required: true,
    },
    {
      name: "CalculationType",
      label: "Calculation Type",
      type: "select",
      required: true,
      defaultValue: "Before GST",
      options: ["Before GST", "After GST"],
    },
    {
      name: "DeductionType",
      label: "Type",
      type: "custom",
      defaultValue: "Addition",
      render: ({ value, onChange }) => {
        return <DeductionToggler value={value} onChange={onChange} />;
      },
    },
    {
      name: "Description",
      label: "Description",
      type: "textarea",
      fullWidth: true,
    },
    {
      name: "IsActive",
      label: "Status",
      type: "toggle",
      defaultValue: true,
    },
  ];

  const columns: ColumnDef[] = [
    { key: "name", label: "Term Name" },
    { key: "CalculationType", label: "Calculation Type" },
    { key: "DeductionType", label: "Type" },
    { key: "description", label: "Remarks" },
    { key: "status", label: "Status" },
  ];

  const columnRenderers = {
    status: (value: unknown) => (
      <span
        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-heading border ${
          value
            ? "bg-primary/10 text-primary border-primary/20"
            : "bg-destructive/10 text-destructive border-destructive/20"
        }`}
      >
        <span
          className={`w-1.5 h-1.5 rounded-full mr-1.5 ${
            value ? "bg-primary" : "bg-destructive"
          }`}
        />
        {value ? "Active" : "Inactive"}
      </span>
    ),
    DeductionType: (value: unknown) => (
      <span
        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-heading border ${
          value === "Addition"
            ? "bg-green-500/10 text-green-500 border-green-500/20"
            : "bg-destructive/10 text-destructive border-destructive/20"
        }`}
      >
        {value === "Addition" ? "+ Addition" : "− Deduction"}
      </span>
    ),
    CalculationType: (value: unknown) => (
      <span className="text-xs text-muted-foreground font-heading">
        {String(value ?? "")}
      </span>
    ),
    description: (value: unknown) => (
      <span className="text-xs text-muted-foreground truncate max-w-[200px] block">
        {value ? String(value) : "—"}
      </span>
    ),
  };

  const handleDataEvent = async (event: DataChangeEvent) => {
    try {
      if (event.action === "add") {
        const record = event.record as Record<string, unknown>;
        const calcType = String(record.CalculationType ?? "Before GST");
        await addBillingTerm({
          Name: String(record.Name ?? ""),
          Description: String(record.Description ?? ""),
          CalculationType: calcType,
          DeductionType: String(record.DeductionType ?? "Addition"),
          IsActive:
            record.IsActive !== undefined ? Boolean(record.IsActive) : true,
        });
        toast.success("Billing term added!");
        await refetch();
      } else if (event.action === "update") {
        const record = event.record as Record<string, unknown>;
        const calcType = String(record["CalculationType"] ?? "Before GST");
        await updateBillingTerm(Number(event.id), {
          Name: String(record["Name"] ?? ""),
          Description: String(record["Description"] ?? ""),
          CalculationType: calcType,
          DeductionType: String(record["DeductionType"] ?? "Addition"),
          IsActive:
            record["IsActive"] !== undefined
              ? Boolean(record["IsActive"])
              : true,
        });
        toast.success("Billing term updated!");
        await refetch();
      } else if (event.action === "delete") {
        await deleteBillingTerm(Number(event.id));
        toast.success("Billing term deleted!");
        await refetch();
      }
    } catch (err: any) {
      toast.error(err.message || "Something went wrong");
    }
  };

  return (
    <>
      <Breadcrumbs items={["Masters", "Billing Terms"]} />
      <MaterialShell
        title="Billing Terms"
        subtitle="Configure billing terms and deduction types"
        icon={Book}
      >
        {loading ? (
          <div className="flex items-center justify-center py-20 gap-2 text-muted-foreground">
            <Loader2 size={18} className="animate-spin" />
            <span className="text-sm font-heading">Loading billing terms…</span>
          </div>
        ) : (
          <MasterPage
            title="Billing Term"
            fields={fields}
            columns={columns}
            columnRenderers={columnRenderers}
            initialData={billingTerms as unknown as Record<string, unknown>[]}
            onDataEvent={handleDataEvent}
            exportConfig={{
              title: "Billing Terms Master",
              filename: "billing-terms-master",
              columns: [
                { header: "Term Name", accessor: "Name" },
                { header: "Calculation Type", accessor: "CalculationType" },
                { header: "Type", accessor: "DeductionType" },
                { header: "Remarks", accessor: "Description" },
                {
                  header: "Status",
                  accessor: (r) => (r.IsActive ? "Active" : "Inactive"),
                },
              ],
            }}
          />
        )}
      </MaterialShell>
    </>
  );
};

export default BillingTermsMaster;
