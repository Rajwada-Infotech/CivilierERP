import React from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import {
  MasterPage,
  type ColumnDef,
  type FieldDef,
  type RecordWithId,
} from "@/components/MasterPage";
import { BadgeCheck, CalendarRange, FileBadge2, ShieldCheck } from "lucide-react";

const FIELDS: FieldDef[] = [
  {
    name: "cardNumber",
    label: "Card Number",
    type: "text",
    required: true,
    uppercase: true,
  },
  {
    name: "cardType",
    label: "Card Type",
    type: "select",
    required: true,
    options: [
      "Material Issue Card",
      "Vehicle Entry Pass",
      "Contractor ID Card",
      "Site Access Card",
      "Temporary Gate Pass",
    ],
  },
  {
    name: "holderName",
    label: "Holder Name",
    type: "text",
    required: true,
  },
  {
    name: "issuedFor",
    label: "Issued For",
    type: "select",
    required: true,
    options: ["Employee", "Contractor", "Driver", "Vendor", "Visitor", "Vehicle"],
  },
  {
    name: "vendorContractor",
    label: "Vendor / Contractor",
    type: "text",
    required: true,
  },
  {
    name: "siteProject",
    label: "Site / Project",
    type: "select",
    required: true,
    options: [
      "Metro Line Extension",
      "Riverfront Retaining Wall",
      "Industrial Shed Phase 2",
      "Highway Package A1",
      "Cement Yard Central Depot",
    ],
  },
  {
    name: "materialCategory",
    label: "Material Category",
    type: "select",
    required: true,
    options: [
      "Steel",
      "Cement",
      "Aggregates",
      "Electrical",
      "Mechanical",
      "General Consumables",
      "Vehicle Movement",
    ],
  },
  {
    name: "validity",
    label: "Validity Period",
    type: "select",
    required: true,
    options: ["Daily", "Weekly", "Monthly", "Quarterly", "Annual", "Project Based"],
  },
  {
    name: "accessLevel",
    label: "Access Level",
    type: "select",
    required: true,
    options: ["Gate Only", "Store", "Yard", "Site Zone", "All Material Areas"],
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
  { key: "cardNumber", label: "Card No." },
  { key: "holderName", label: "Holder" },
  { key: "cardType", label: "Card Type", hideOnMobile: true },
  { key: "siteProject", label: "Site / Project", hideOnMobile: true },
  { key: "accessLevel", label: "Access", hideOnMobile: true },
  { key: "validity", label: "Validity", hideOnMobile: true },
  { key: "status", label: "Status" },
];

const INITIAL_DATA = [
  {
    cardNumber: "MAT-CP-001",
    cardType: "Material Issue Card",
    holderName: "Rakesh Yadav",
    issuedFor: "Contractor",
    vendorContractor: "Shiv Shakti Infratech",
    siteProject: "Metro Line Extension",
    materialCategory: "Steel",
    validity: "Monthly",
    accessLevel: "Store",
    remarks: "Authorized for rebar issue and inward verification during day shift.",
    status: true,
  },
  {
    cardNumber: "VEH-GP-014",
    cardType: "Vehicle Entry Pass",
    holderName: "RJ14-GD-9087",
    issuedFor: "Vehicle",
    vendorContractor: "Maa Transport Co.",
    siteProject: "Highway Package A1",
    materialCategory: "Aggregates",
    validity: "Daily",
    accessLevel: "Yard",
    remarks: "Tipper access approved for aggregate unloading up to 8 PM.",
    status: true,
  },
  {
    cardNumber: "CON-ID-027",
    cardType: "Contractor ID Card",
    holderName: "Imran Khan",
    issuedFor: "Contractor",
    vendorContractor: "Prime Build Services",
    siteProject: "Industrial Shed Phase 2",
    materialCategory: "Mechanical",
    validity: "Project Based",
    accessLevel: "Site Zone",
    remarks: "Mechanical installation supervisor with controlled workshop entry.",
    status: true,
  },
  {
    cardNumber: "TMP-GP-009",
    cardType: "Temporary Gate Pass",
    holderName: "Suresh Patel",
    issuedFor: "Visitor",
    vendorContractor: "Cementech Supplies",
    siteProject: "Cement Yard Central Depot",
    materialCategory: "Cement",
    validity: "Weekly",
    accessLevel: "Gate Only",
    remarks: "Inspection pass for supplier representative; escort mandatory.",
    status: false,
  },
];

export default function CardMaster() {
  const columnRenderers = {
    cardNumber: (value: unknown) => (
      <div className="flex items-center gap-2 min-w-[140px]">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <FileBadge2 size={15} />
        </span>
        <span className="font-heading font-semibold text-foreground">
          {String(value ?? "")}
        </span>
      </div>
    ),
    cardType: (value: unknown) => (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/60 px-2.5 py-1 text-[11px] font-heading text-foreground">
        <BadgeCheck size={11} className="text-primary" />
        {String(value ?? "")}
      </span>
    ),
    accessLevel: (value: unknown) => (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-[11px] font-heading text-primary">
        <ShieldCheck size={11} />
        {String(value ?? "")}
      </span>
    ),
    validity: (value: unknown, row: RecordWithId) => (
      <div className="flex flex-col">
        <span className="inline-flex items-center gap-1.5 text-sm text-foreground">
          <CalendarRange size={13} className="text-muted-foreground" />
          {String(value ?? "")}
        </span>
        <span className="text-[11px] text-muted-foreground">
          {String(row.materialCategory ?? "")}
        </span>
      </div>
    ),
    status: (value: unknown) => (
      <span
        className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-heading ${
          value
            ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-400"
            : "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-400"
        }`}
      >
        <span
          className={`mr-1.5 h-1.5 w-1.5 rounded-full ${
            value ? "bg-emerald-500" : "bg-amber-500"
          }`}
        />
        {value ? "Active" : "Inactive"}
      </span>
    ),
  };

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Material Module", "Card Master"]} />
      <MasterPage
        title="Card Master"
        fields={FIELDS}
        columns={COLUMNS}
        initialData={INITIAL_DATA}
        columnRenderers={columnRenderers}
      />
    </>
  );
}