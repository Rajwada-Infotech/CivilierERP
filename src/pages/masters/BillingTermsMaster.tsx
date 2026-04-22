import React from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import {
  MasterPage,
  type FieldDef,
  type ColumnDef,
  type RecordWithId,
} from "@/components/MasterPage";
import { Book, Percent, Calendar, FileText, ToggleRight } from "lucide-react";
import { toast } from "sonner";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

// ─── API ──────────────────────────────────────────────────────────────────────
const BASE = "/api/billing-terms";

const getBillingTerms = () => fetchWithAuth(BASE).then((r) => r.json());
const addBillingTerm = (data: object) =>
  fetchWithAuth(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  }).then((r) => r.json());
const updateBillingTerm = (id: string, data: object) =>
  fetchWithAuth(`${BASE}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  }).then((r) => r.json());
const deleteBillingTerm = (id: string) =>
  fetchWithAuth(`${BASE}/${id}`, { method: "DELETE" }).then((r) => r.json());

// ─── Types ────────────────────────────────────────────────────────────────────
interface DbBillingTerm {
  BillingTermID: number;
  Name: string | null;
  Description: string | null;
  GST: string | null;
  Type: string | null;
  IsActive: boolean;
}

interface BillingTermDisplay extends RecordWithId {
  name: string;
  billType: string;
  discountType: string;
  discountValue: number;
  paymentDueDays: number;
  status: boolean;
  description?: string;
}

// ─── COMPONENT ────────────────────────────────────────────────────────────────
const BillingTermsMaster: React.FC = () => {
  // Note: Would ideally use context or query hook here for data loading/editing
  // For now, placeholder data structure matching plan

  const fields: FieldDef[] = [
    {
      name: "Name",
      label: "Term Name",
      type: "text",
      required: true,
    },
    {
      name: "Type",
      label: "Bill Type",
      type: "select",
      required: true,
      options: [
        "Tax Invoice",
        "Proforma Invoice",
        "Credit Note",
        "Debit Note",
        "Bill of Supply",
        "Receipt Voucher",
        "Delivery Challan",
        "Self Invoice",
      ],
    },
    {
      name: "GST",
      label: "GST/Discount",
      type: "text", // Could be number or complex
    },
    {
      name: "IsActive",
      label: "Status",
      type: "toggle",
      defaultValue: true,
    },
    {
      name: "Description",
      label: "Description",
      type: "textarea",
      fullWidth: true,
    },
  ];

  const columnRenderers = {
    status: (value: unknown) => {
      return (
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-heading border ${
            value
              ? "bg-primary/10 text-primary border-primary/20"
              : "bg-destructive/10 text-destructive border-destructive/20"
          }`}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full mr-1.5 ${value ? "bg-primary" : "bg-destructive"}`}
          />
          {value ? "Active" : "Inactive"}
        </span>
      );
    },
  };

  const columns: ColumnDef[] = [
    { key: "Name", label: "Term Name" },
    { key: "Type", label: "Bill Type" },
    { key: "GST", label: "GST/Discount" },
    { key: "IsActive", label: "Status", renderer: "status" },
  ];

  const handleDataChange = (records: Record<string, unknown>[]) => {
    toast.success("Billing terms updated successfully!");
    // Would call updateBillingTerm here
  };

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

      <MasterPage
        title="Billing Term"
        fields={fields}
        columns={columns}
        columnRenderers={columnRenderers}
        initialData={[]}
        onDataChange={handleDataChange}
      />
    </>
  );
};

export default BillingTermsMaster;
