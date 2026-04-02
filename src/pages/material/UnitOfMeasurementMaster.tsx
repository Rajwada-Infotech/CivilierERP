import React from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import {
  MasterPage,
  type ColumnDef,
  type FieldDef,
  type RecordWithId,
} from "@/components/MasterPage";
import { BadgeCheck, Ruler, Hash, ToggleRight, CalendarRange } from "lucide-react";

const FIELDS: FieldDef[] = [
  {
    name: "code",
    label: "Unit Code",
    type: "text",
    required: true,
    uppercase: true,
  },
  {
    name: "name",
    label: "Unit Name",
    type: "text",
    required: true,
  },
  {
    name: "symbol",
    label: "Symbol",
    type: "text",
    required: true,
  },
  {
    name: "type",
    label: "Type",
    type: "select",
    required: true,
    options: [
      "Simple",
      "Compound",
      "Base",
    ],
  },
  {
    name: "decimalPlaces",
    label: "Decimal Places",
    type: "number",
    min: 0,
    max: 6,
    required: true,
  },
  {
    name: "conversionFactor",
    label: "Conversion Factor",
    type: "number",
    required: false,
  },
  {
    name: "isBaseUnit",
    label: "Base Unit",
    type: "toggle",
    defaultValue: false,
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
  { key: "code", label: "Code" },
  { key: "name", label: "Name" },
  { key: "symbol", label: "Symbol" },
  { key: "decimalPlaces", label: "Decimals" },
  { key: "type", label: "Type", hideOnMobile: true },
  { key: "status", label: "Status" },
];

const INITIAL_DATA: RecordWithId[] = [
  {
    id: "kg",
    code: "KG",
    name: "Kilogram",
    symbol: "kg",
    type: "Base",
    decimalPlaces: 3,
    conversionFactor: 1,
    isBaseUnit: true,
    remarks: "Standard weight unit for most materials",
    status: true,
  },
  {
    id: "mt",
    code: "MT",
    name: "Metric Ton",
    symbol: "MT",
    type: "Compound",
    decimalPlaces: 0,
    conversionFactor: 1000,
    isBaseUnit: false,
    remarks: "1 MT = 1000 KG",
    status: true,
  },
  {
    id: "ltr",
    code: "LTR",
    name: "Litre",
    symbol: "L",
    type: "Base",
    decimalPlaces: 2,
    conversionFactor: 1,
    isBaseUnit: true,
    remarks: "Volume unit for liquids",
    status: true,
  },
  {
    id: "m",
    code: "M",
    name: "Meter",
    symbol: "m",
    type: "Base",
    decimalPlaces: 2,
    conversionFactor: 1,
    isBaseUnit: true,
    remarks: "Standard length unit",
    status: true,
  },
  {
    id: "sqm",
    code: "SQM",
    name: "Square Meter",
    symbol: "m²",
    type: "Compound",
    decimalPlaces: 2,
    conversionFactor: 1,
    isBaseUnit: false,
    remarks: "Area unit for sheets/plates",
    status: true,
  },
];

const columnRenderers = {
  code: (value: unknown) => (
    <div className="flex items-center gap-2 min-w-[100px]">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Hash size={15} />
      </span>
      <span className="font-heading font-semibold text-foreground">
        {String(value ?? "")}
      </span>
    </div>
  ),
  symbol: (value: unknown) => (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/60 px-2.5 py-1 text-[11px] font-heading text-foreground">
      <Ruler size={11} className="text-primary" />
      {String(value ?? "")}
    </span>
  ),
  type: (value: unknown) => (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-[11px] font-heading text-primary">
      <BadgeCheck size={11} />
      {String(value ?? "")}
    </span>
  ),
  decimalPlaces: (value: unknown) => (
    <span className="text-sm font-mono text-foreground">
      {String(value ?? 0)} places
    </span>
  ),
  status: (value: unknown) => (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-heading ${
        value
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-amber-200 bg-amber-50 text-amber-700"
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

export default function UnitOfMeasurementMaster() {
  return (
    <>
      <Breadcrumbs items={["Dashboard", "Material Module", "Unit of Measurement"]} />
      <MasterPage
        title="Unit of Measurement Master"
        fields={FIELDS}
        columns={COLUMNS}
        initialData={INITIAL_DATA}
        columnRenderers={columnRenderers}
      />
    </>
  );
}
