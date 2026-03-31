import React from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { MasterPage, type ColumnDef, type FieldDef, type RecordWithId } from "@/components/MasterPage";

const FIELDS: FieldDef[] = [
  { name: "workOrderNo", label: "Work Order No", type: "text", required: true, uppercase: true },
  { name: "issueDate", label: "Issue Date", type: "text", required: true },
  { name: "targetDate", label: "Target Date", type: "text", required: true },
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
    name: "contractorVendor",
    label: "Contractor / Vendor",
    type: "select",
    required: true,
    options: [
      "ABC Contractors",
      "XYZ Builders",
      "Metro Steel Traders",
      "Apex Fabricators",
      "Prime Civil Works",
    ],
  },
  {
    name: "materialType",
    label: "Material Type",
    type: "select",
    required: true,
    options: ["Structural Steel", "Cement & Concrete", "Electrical", "Plumbing", "Finishing", "Fabrication"],
  },
  {
    name: "workScope",
    label: "Work Scope",
    type: "textarea",
    required: true,
    fullWidth: true,
  },
  { name: "workOrderAmount", label: "Work Order Amount", type: "number", required: true, prefix: "₹" },
  {
    name: "status",
    label: "Status",
    type: "select",
    required: true,
    options: ["Open", "In Progress", "Completed", "Closed", "On Hold"],
  },
  { name: "remarks", label: "Remarks", type: "textarea", fullWidth: true },
];

const COLUMNS: ColumnDef[] = [
  { key: "workOrderNo", label: "WO No" },
  { key: "projectSite", label: "Project / Site" },
  { key: "contractorVendor", label: "Contractor / Vendor", hideOnMobile: true },
  { key: "materialType", label: "Material Type", hideOnMobile: true },
  { key: "targetDate", label: "Target Date" },
  { key: "workOrderAmount", label: "Amount" },
  { key: "status", label: "Status" },
];

const INITIAL_DATA = [
  {
    workOrderNo: "WO-MAT-2401",
    issueDate: "2024-11-03",
    targetDate: "2024-11-28",
    projectSite: "Skyline Tower A",
    contractorVendor: "ABC Contractors",
    materialType: "Cement & Concrete",
    workScope: "Concrete pouring, shuttering support, and material handling for podium slab casting.",
    workOrderAmount: 875000,
    status: "In Progress",
    remarks: "Execution linked with weekly pour schedule and pump availability.",
  },
  {
    workOrderNo: "WO-MAT-2402",
    issueDate: "2024-11-06",
    targetDate: "2024-12-12",
    projectSite: "Industrial Shed Phase 2",
    contractorVendor: "Apex Fabricators",
    materialType: "Structural Steel",
    workScope: "Fabrication and erection of primary steel members, purlins, and connection plates.",
    workOrderAmount: 1645000,
    status: "Open",
    remarks: "Shop drawings released; dispatch to begin after first inspection clearance.",
  },
  {
    workOrderNo: "WO-MAT-2403",
    issueDate: "2024-10-25",
    targetDate: "2024-11-18",
    projectSite: "Green Valley Villas",
    contractorVendor: "Prime Civil Works",
    materialType: "Plumbing",
    workScope: "Supply support and installation of underground drainage lines and water supply sleeves.",
    workOrderAmount: 428000,
    status: "Completed",
    remarks: "Physical work completed and measurement sheet submitted for billing.",
  },
];

export default function WorkOrderMaster() {
  const columnRenderers = {
    targetDate: (value: unknown) => {
      const date = new Date(String(value));
      return isNaN(date.getTime())
        ? String(value ?? "")
        : date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
    },
    workOrderAmount: (value: unknown) => `₹${Number(value || 0).toLocaleString("en-IN")}`,
    status: (value: unknown, row: RecordWithId) => {
      const status = String(value ?? row.status ?? "");
      const statusClasses: Record<string, string> = {
        Open: "bg-blue-100 text-blue-700 border-blue-200",
        "In Progress": "bg-amber-100 text-amber-700 border-amber-200",
        Completed: "bg-emerald-100 text-emerald-700 border-emerald-200",
        Closed: "bg-slate-100 text-slate-700 border-slate-200",
        "On Hold": "bg-rose-100 text-rose-700 border-rose-200",
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
      <Breadcrumbs items={["Dashboard", "Material", "Work Order"]} />
      <MasterPage
        title="Work Order"
        fields={FIELDS}
        columns={COLUMNS}
        initialData={INITIAL_DATA}
        columnRenderers={columnRenderers}
      />
    </>
  );
}