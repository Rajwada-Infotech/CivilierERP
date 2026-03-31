import React from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { MasterPage, type ColumnDef, type FieldDef, type RecordWithId } from "@/components/MasterPage";

const FIELDS: FieldDef[] = [
  { name: "bookingReference", label: "Booking Reference", type: "text", required: true, uppercase: true },
  { name: "bookingDate", label: "Booking Date", type: "text", required: true },
  {
    name: "supplier",
    label: "Vendor / Supplier",
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
  {
    name: "materialCategory",
    label: "Material Category",
    type: "select",
    required: true,
    options: ["Cement", "Steel", "Electrical", "Plumbing", "Aggregates", "Finishing Material"],
  },
  { name: "invoiceReference", label: "Invoice Reference", type: "text", required: true, uppercase: true },
  { name: "amount", label: "Basic Amount", type: "number", required: true, prefix: "₹" },
  { name: "taxAmount", label: "Tax Amount", type: "number", required: true, prefix: "₹" },
  { name: "totalAmount", label: "Total Amount", type: "number", required: true, prefix: "₹" },
  {
    name: "status",
    label: "Booking Status",
    type: "select",
    required: true,
    options: ["Draft", "Approved", "Booked", "Hold"],
  },
  { name: "remarks", label: "Remarks", type: "textarea", fullWidth: true },
];

const COLUMNS: ColumnDef[] = [
  { key: "bookingReference", label: "Reference" },
  { key: "bookingDate", label: "Date" },
  { key: "supplier", label: "Supplier" },
  { key: "projectSite", label: "Project / Site", hideOnMobile: true },
  { key: "materialCategory", label: "Category", hideOnMobile: true },
  { key: "totalAmount", label: "Total Amount" },
  { key: "status", label: "Status" },
];

const INITIAL_DATA = [
  {
    bookingReference: "MEB-24001",
    bookingDate: "2024-11-05",
    supplier: "Shree Cement Distributors",
    projectSite: "Riverfront Residency",
    materialCategory: "Cement",
    invoiceReference: "INV-CEM-1184",
    amount: 185000,
    taxAmount: 33300,
    totalAmount: 218300,
    status: "Booked",
    remarks: "Bulk cement procurement booked against slab casting schedule for Block B.",
  },
  {
    bookingReference: "MEB-24002",
    bookingDate: "2024-11-08",
    supplier: "Metro Steel Traders",
    projectSite: "Skyline Tower A",
    materialCategory: "Steel",
    invoiceReference: "INV-STL-4421",
    amount: 412500,
    taxAmount: 74250,
    totalAmount: 486750,
    status: "Approved",
    remarks: "TMT steel requirement approved for podium beam reinforcement.",
  },
  {
    bookingReference: "MEB-24003",
    bookingDate: "2024-11-10",
    supplier: "Prime Electricals",
    projectSite: "Highway Utility Block",
    materialCategory: "Electrical",
    invoiceReference: "INV-ELC-2097",
    amount: 96800,
    taxAmount: 17424,
    totalAmount: 114224,
    status: "Hold",
    remarks: "Awaiting store verification for cable drum quantities before final booking.",
  },
];

export default function MaterialExpenseBooking() {
  const columnRenderers = {
    bookingDate: (value: unknown) => {
      const date = new Date(String(value));
      return isNaN(date.getTime())
        ? String(value ?? "")
        : date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
    },
    totalAmount: (value: unknown) => `₹${Number(value || 0).toLocaleString("en-IN")}`,
    status: (value: unknown, row: RecordWithId) => {
      const status = String(value ?? row.status ?? "");
      const statusClasses: Record<string, string> = {
        Draft: "bg-slate-100 text-slate-700 border-slate-200",
        Approved: "bg-blue-100 text-blue-700 border-blue-200",
        Booked: "bg-emerald-100 text-emerald-700 border-emerald-200",
        Hold: "bg-amber-100 text-amber-700 border-amber-200",
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
      <Breadcrumbs items={["Dashboard", "Material", "Expense Booking"]} />
      <MasterPage
        title="Expense Booking"
        fields={FIELDS}
        columns={COLUMNS}
        initialData={INITIAL_DATA}
        columnRenderers={columnRenderers}
      />
    </>
  );
}