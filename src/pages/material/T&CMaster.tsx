import React from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import {
  MasterPage,
  type ColumnDef,
  type FieldDef,
} from "@/components/MasterPage";
import { FileText, CalendarRange } from "lucide-react";

const FIELDS: FieldDef[] = [
  {
    name: "name",
    label: "Name",
    type: "text",
    required: true,
    uppercase: true,
  },
  {
    name: "terms",
    label: "Terms & Condition",
    type: "textarea",
    fullWidth: true,
    required: true,
  },
  {
    name: "remarks",
    label: "Remarks",
    type: "textarea",
    fullWidth: true,
  },
  {
    name: "status",
    label: "Active",
    type: "toggle",
    defaultValue: true,
  },
];

const COLUMNS: ColumnDef[] = [
  { key: "name", label: "Name" },
  { key: "terms", label: "Terms Preview", hideOnMobile: false },
  { key: "status", label: "Status" },
];

const INITIAL_DATA = [
  {
    name: "Standard T&C",
    terms: "Standard terms and conditions for all material supply contracts. Payment within 30 days. No advance without PO. etc.",
    remarks: "Default T&C for new suppliers",
    status: true,
  },
  {
    name: "Advance Payment T&C",
    terms: "25% advance payment required. Balance on delivery. Interest on delayed payment @18% p.a.",
    remarks: "For high value or custom items",
    status: true,
  },
  {
    name: "Credit T&C",
    terms: "Credit period 45 days max. Security deposit required for new parties.",
    remarks: "Approved credit customers only",
    status: true,
  },
];

const columnRenderers = {
  name: (value: unknown) => (
    <div className="flex items-center gap-2">
      <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <FileText size={13} />
      </div>
      <span className="font-heading font-semibold text-sm">{String(value ?? "")}</span>
    </div>
  ),
  terms: (value: unknown, row: Record<string, unknown>) => (
    <div className="max-w-xs">
      <p className="text-xs line-clamp-2 text-foreground">{String(value ?? "")}</p>
      {row.remarks && (
        <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-1">{row.remarks}</p>
      )}
    </div>
  ),
  status: (value: unknown) => (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-heading border ${
        value
          ? "border-emerald-200/60 bg-emerald-50/80 text-emerald-700"
          : "border-amber-200/60 bg-amber-50/80 text-amber-700"
      }`}
    >
      <span
        className={`mr-1 h-1.5 w-1.5 rounded-full ${
          value ? "bg-emerald-500" : "bg-amber-500"
        }`}
      />
      {value ? "Active" : "Inactive"}
    </span>
  ),
};

export default function TCMaster() {
  return (
    <>
      <Breadcrumbs items={["Dashboard", "Material", "T&C"]} />
      <MasterPage
        title="T&C Master"
        fields={FIELDS}
        columns={COLUMNS}
        initialData={INITIAL_DATA}
        columnRenderers={columnRenderers}
      />
    </>
  );
}

