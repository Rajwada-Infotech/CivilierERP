import React from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { MasterPage, FieldDef, ColumnDef } from "@/components/MasterPage";

// ── HSN Fields ─────────────────────────────────────────────────────────────────
const fields: FieldDef[] = [
  { name: "code", label: "HSN Code", type: "text", required: true, uppercase: true },
{ name: "digits", label: "Short Description", type: "text", required: true },
  { name: "description", label: "Description", type: "textarea", required: true, fullWidth: true },
  { name: "type", label: "Type", type: "select", required: true, options: ["Goods", "Service", "Composite"] },
  { name: "igstRate", label: "IGST Rate %", type: "number", prefix: "%" },
  { name: "cgstRate", label: "CGST Rate %", type: "number", prefix: "%" },
  { name: "sgstRate", label: "SGST Rate %", type: "number", prefix: "%" },
  { name: "status", label: "Active", type: "toggle", defaultValue: true },
];

// ── Table Columns ─────────────────────────────────────────────────────────────
const columns: ColumnDef[] = [
  { key: "code", label: "HSN Code" },
{ key: "digits", label: "Short Description" },
  { key: "description", label: "Description" },
  { key: "type", label: "Type" },
  { key: "igstRate", label: "IGST %" },
  { key: "status", label: "Status" },
];

// ── Realistic Seed Data (India GST HSN examples) ───────────────────────────────
const initialData = [
  { code: "2523", digits: "Short", description: "Portland cement, aluminous cement, slag cement...", type: "Goods", igstRate: 18, cgstRate: 9, sgstRate: 9, status: true },
  { code: "7213", digits: "Short", description: "Bars and rods of iron/non-alloy steel", type: "Goods", igstRate: 18, cgstRate: 9, sgstRate: 9, status: true },
  { code: "9983", digits: "Short", description: "Other professional, technical and business services", type: "Service", igstRate: 18, cgstRate: 9, sgstRate: 9, status: true },
  { code: "9987", digits: "Short", description: "Rental and leasing services involving own or leased property", type: "Service", igstRate: 18, cgstRate: 9, sgstRate: 9, status: true },
  { code: "0803", digits: "Short", description: "Bananas including plantains", type: "Goods", igstRate: 5, cgstRate: 2.5, sgstRate: 2.5, status: true },
  { code: "2701", digits: "Short", description: "Coal; briquettes, ovoids and similar solid fuels...", type: "Goods", igstRate: 5, cgstRate: 2.5, sgstRate: 2.5, status: true },
  { code: "8703", digits: "Short", description: "Motor cars and other motor vehicles principally designed...", type: "Goods", igstRate: 28, cgstRate: 14, sgstRate: 14, status: true },
  { code: "9018", digits: "Short", description: "Instruments and appliances used in medical/surgical sciences", type: "Goods", igstRate: 12, cgstRate: 6, sgstRate: 6, status: true },
];

const HsnMaster: React.FC = () => (
  <AppLayout>
    <Breadcrumbs items={["Dashboard", "Masters", "HSN Master"]} />
    <h1 className="text-xl font-heading font-bold text-foreground mb-4">HSN Master</h1>
    <MasterPage title="HSN" fields={fields} columns={columns} initialData={initialData} />
  </AppLayout>
);

export default HsnMaster;

