import React from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { MasterPage, FieldDef, ColumnDef } from "@/components/MasterPage";

const fields: FieldDef[] = [
  {
    name: "code",
    label: "HSN Code",
    type: "text",
    required: true,
    uppercase: true,
  },
  {
    name: "shortDesc",
    label: "Short Description",
    type: "text",
    required: true,
  },
  {
    name: "description",
    label: "Full Description",
    type: "textarea",
    fullWidth: true,
  },
  { name: "igstRate", label: "IGST Rate (%)", type: "number" },
  { name: "cgstRate", label: "CGST Rate (%)", type: "number" },
  { name: "sgstRate", label: "SGST Rate (%)", type: "number" },
  { name: "status", label: "Status", type: "toggle", defaultValue: true },
];

const columns: ColumnDef[] = [
  { key: "code", label: "HSN Code" },
  { key: "shortDesc", label: "Short Desc" },
  { key: "igstRate", label: "IGST %" },
  { key: "cgstRate", label: "CGST %" },
  { key: "sgstRate", label: "SGST %" },
  { key: "status", label: "Status" },
];

const initialData = [
  {
    code: "21069099",
    shortDesc: "Food Prep",
    description: "Food preparations nes",
    igstRate: 0,
    cgstRate: 4.5,
    sgstRate: 4.5,
    status: true,
  },
  {
    code: "25232990",
    shortDesc: "Cement",
    description: "Cement (Portland, aluminous, slag)",
    igstRate: 18,
    cgstRate: 0,
    sgstRate: 0,
    status: true,
  },
  {
    code: "72142090",
    shortDesc: "TMT Steel",
    description: "Steel bars and rods - TMT bars",
    igstRate: 18,
    cgstRate: 0,
    sgstRate: 0,
    status: true,
  },
  {
    code: "73089099",
    shortDesc: "Steel Structures",
    description: "Structures and parts of structures of iron/steel",
    igstRate: 18,
    cgstRate: 0,
    sgstRate: 0,
    status: true,
  },
  {
    code: "84118100",
    shortDesc: "Gas Turbines",
    description: "Gas turbines for construction equipment",
    igstRate: 18,
    cgstRate: 0,
    sgstRate: 0,
    status: true,
  },
  {
    code: "84272000",
    shortDesc: "JCB Parts",
    description: "Other lifts and skip hoists (JCB parts)",
    igstRate: 18,
    cgstRate: 0,
    sgstRate: 0,
    status: true,
  },
  {
    code: "84314990",
    shortDesc: "Crane Parts",
    description: "Parts of cranes, bulldozers, graders",
    igstRate: 18,
    cgstRate: 0,
    sgstRate: 0,
    status: true,
  },
  {
    code: "84791000",
    shortDesc: "Road Roller",
    description: "Machinery for public works (road rollers)",
    igstRate: 18,
    cgstRate: 0,
    sgstRate: 0,
    status: true,
  },
  {
    code: "87089900",
    shortDesc: "Vehicle Parts",
    description: "Parts for construction vehicles",
    igstRate: 18,
    cgstRate: 0,
    sgstRate: 0,
    status: true,
  },
  {
    code: "90158090",
    shortDesc: "Survey Equip",
    description: "Surveying instruments for site survey",
    igstRate: 18,
    cgstRate: 0,
    sgstRate: 0,
    status: true,
  },
];

const HsnMaster: React.FC = () => (
  <>
    <Breadcrumbs items={["Dashboard", "Masters", "HSN Master"]} />
    <h1 className="text-xl font-heading font-bold text-foreground mb-4">HSN Master</h1>
    <MasterPage title="HSN" fields={fields} columns={columns} initialData={initialData} />
  </>
);

export default HsnMaster;
