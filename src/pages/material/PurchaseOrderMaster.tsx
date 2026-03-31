import React from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { MasterPage, type ColumnDef, type FieldDef, type RecordWithId } from "@/components/MasterPage";

const FIELDS: FieldDef[] = [
  { name: "poNumber", label: "Purchase Order No", type: "text", required: true, uppercase: true },
  { name: "poDate", label: "PO Date", type: "text", required: true },
  { name: "expectedDate", label: "Expected Delivery", type: "text", required: true },
  {
    name: "supplier",
    label: "Supplier",
    type: "select",
    required: true,
    options: [
      "Shree Cement Distributors",
      "Metro Steel Traders",
      "Prime Electricals",
      "Apex Plumbing Supplies",
      "BuildWell Aggregates",
    ],
  },
  {
    name: "projectSite",
    label: "Project / Site",
    type: "select",
    required: true,
    options: [
      "Riverfront Residency",
      "Skyline Tower A",
      "Industrial Shed Phase 2",
      "Green Valley Villas",
      "Highway Utility Block",
    ],
  },
  { name: "itemDescription", label: "Item Description", type: "textarea", required: true, fullWidth: true },
  { name: "quantity", label: "Quantity", type: "number", required: true },
  { name: "unit", label: "Unit", type: "text", required: true },
  { name: "rate", label: "Rate", type: "number", required: true, prefix: "₹" },
  { name: "totalAmount", label: "Total Amount", type: "number", required: true, prefix: "₹" },
  { name: "paymentTerms", label: "Payment Terms", type: "textarea" },
  {
    name: "status",
    label: "Status",
    type: "select",
    required: true,
    options: ["Draft", "Issued", "Partially Received", "Received", "Closed"],
  },
  { name: "remarks", label: "Remarks", type: "textarea", fullWidth: true },
];

const COLUMNS: ColumnDef[] = [
  { key: "poNumber", label: "PO No" },
  { key: "supplier", label: "Supplier" },
  { key: "projectSite", label: "Project / Site", hideOnMobile: true },
  { key: "itemDescription", label: "Item", hideOnMobile: true },
  { key: "quantity", label: "Qty" },
  { key: "totalAmount", label: "Amount" },
  { key: "status", label: "Status" },
];

const INITIAL_DATA = [
  {
    poNumber: "PO-MAT-24001",
    poDate: "2024-11-07",
    expectedDate: "2024-11-14",
    supplier: "Metro Steel Traders",
    projectSite: "Skyline Tower A",
    itemDescription: "TMT Fe500D 16mm dia bars, 25MT for column reinforcement",
    quantity: 25,
    unit: "MT",
    rate: 62000,
    totalAmount: 1550000,
    paymentTerms: "30% advance, 60% on delivery, balance on acceptance",
    status: "Issued",
    remarks: "Urgent requirement for column casting next week. Prefer immediate dispatch.",
  },
  {
    poNumber: "PO-MAT-24002",
    poDate: "2024-11-05",
    expectedDate: "2024-11-12",
    supplier: "Shree Cement Distributors",
    projectSite: "Riverfront Residency",
    itemDescription: "OPC 53 Grade cement, 400 bags for plastering works",
    quantity: 400,
    unit: "Bags",
    rate: 380,
    totalAmount: 152000,
    paymentTerms: "100% on delivery",
    status: "Partially Received",
    remarks: "200 bags received, balance expected by 11th Nov.",
  },
  {
    poNumber: "PO-MAT-24003",
    poDate: "2024-10-30",
    expectedDate: "2024-11-18",
    supplier: "BuildWell Aggregates",
    projectSite: "Industrial Shed Phase 2",
    itemDescription: "20mm crushed stone aggregate, 150 brass",
    quantity: 150,
    unit: "Brass",
    rate: 850,
    totalAmount: 127500,
    paymentTerms: "Payment within 15 days of delivery",
    status: "Draft",
    remarks: "Pending approval from site engineer.",
  },
];

export default function PurchaseOrderMaster() {
  const columnRenderers = {
    poDate: (value: unknown) => {
      const date = new Date(String(value));
      return isNaN(date.getTime())
        ? String(value ?? "")
        : date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
    },
    totalAmount: (value: unknown) => `₹${Number(value || 0).toLocaleString("en-IN")}`,
    status: (value: unknown) => {
      const status = String(value ?? "");
      const statusClasses: Record<string, string> = {
        Draft: "bg-slate-100 text-slate-700 border-slate-200",
        Issued: "bg-blue-100 text-blue-700 border-blue-200",
        "Partially Received": "bg-amber-100 text-amber-700 border-amber-200",
        Received: "bg-emerald-100 text-emerald-700 border-emerald-200",
        Closed: "bg-slate-100 text-slate-700 border-slate-200",
      };
      return (
        <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-heading ${statusClasses[status] || "bg-muted text-muted-foreground border-border"}`}>
          <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-current" />
          {status}
        </span>
      );
    },
  };

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Material", "Purchase Order"]} />
      <MasterPage
        title="Purchase Order"
        fields={FIELDS}
        columns={COLUMNS}
        initialData={INITIAL_DATA}
        columnRenderers={columnRenderers}
      />
    </>
  );
}

