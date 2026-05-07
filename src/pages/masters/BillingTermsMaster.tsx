import React, { useEffect, useState } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import {
  MasterPage,
  type FieldDef,
  type ColumnDef,
  type DataChangeEvent,
} from "@/components/MasterPage";
import type { ExportColumn } from "@/lib/export";
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
} from "@/api/billingTermsMasterApi";             // ✅ correct filename

// ─── Map DB row → context shape ───────────────────────────────────────────────
const mapRow = (row: BillingTermRow): BillingTerm => ({
  _id: String(row.BillingTermID),                 // ✅ capital ID matches DB
  Name: row.Name ?? "",
  Description: row.Description ?? "",
  CalculationType:
    (row.CalculationType as BillingTerm["CalculationType"]) ?? "Before GST",
  IsActive: Boolean(row.IsActive),
});

// ─── Component ────────────────────────────────────────────────────────────────
const BillingTermsMaster: React.FC = () => {
  const { billingTerms, setBillingTerms } = useBillingTerms();
  const [loading, setLoading] = useState(true);

  // ── Fetch on mount ──────────────────────────────────────────────────────────
  useEffect(() => {
    getBillingTerms()
      .then((rows) => setBillingTerms(rows.map(mapRow)))
      .catch(() => toast.error("Failed to load billing terms"))
      .finally(() => setLoading(false));
  }, []);

  // ── Refetch helper ──────────────────────────────────────────────────────────
  const refetch = async () => {
    const fresh = await getBillingTerms();
    setBillingTerms(fresh.map(mapRow));
  };

  // ── Fields ──────────────────────────────────────────────────────────────────
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
      options: ["Fixed", "Percentage", "Custom"],
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

  // ── Columns ─────────────────────────────────────────────────────────────────
  const columns: ColumnDef[] = [
    { key: "Name", label: "Term Name" },
    { key: "CalculationType", label: "Calculation Type" },
    { key: "IsActive", label: "Status" },
  ];

  const columnRenderers = {
    IsActive: (value: unknown) => (
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
  };

  // ── Events ──────────────────────────────────────────────────────────────────
  const handleDataEvent = async (event: DataChangeEvent) => {
    try {
      if (event.action === "add") {
        const record = event.record as BillingTerm;
        await addBillingTerm({
          Name: record.Name,
          Description: record.Description,
          CalculationType: record.CalculationType,
          IsActive: record.IsActive,
        });
        toast.success("Billing term added!");
        await refetch();

      } else if (event.action === "update") {
        const record = event.record as BillingTerm;
        await updateBillingTerm(Number(event.id), {
          Name: record.Name,
          Description: record.Description,
          CalculationType: record.CalculationType,
          IsActive: record.IsActive,
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

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <>
      <Breadcrumbs items={["Masters", "Billing Terms"]} />

      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <Book className="w-6 h-6 text-primary" />
          <h1 className="text-xl font-heading font-bold text-foreground">
            Billing Terms Master
          </h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Configure standard billing terms for automated invoicing
        </p>
      </div>

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
          initialData={billingTerms}
          onDataEvent={handleDataEvent}
        exportConfig={{
          title: "Billing Terms Master",
          filename: "billing-terms-master",
          columns: [
            { header: "Term Name",        accessor: "Name" },
            { header: "Calculation Type", accessor: "CalculationType" },
            { header: "Status",           accessor: (r) => r.IsActive ? "Active" : "Inactive" },
          ],
        }}
        />
      )}
    </>
  );
};

export default BillingTermsMaster;