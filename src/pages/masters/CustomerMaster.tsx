import React from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { MasterPage, FieldDef, ColumnDef } from "@/components/MasterPage";

const fields: FieldDef[] = [
  { name: "name",         label: "Customer Name",    type: "text",     required: true },
  { name: "contact",      label: "Contact Person",   type: "text" },
  { name: "phone",        label: "Phone Number",     type: "text" },
  { name: "email",        label: "Email Address",    type: "text" },
  { name: "gst",          label: "GST Number",       type: "text",     uppercase: true },
  { name: "pan",          label: "PAN Number",       type: "text",     uppercase: true },
  { name: "type",         label: "Customer Type",    type: "select",   options: ["Individual", "Company", "Government", "NGO", "Other"] },
  { name: "paymentTerms", label: "Payment Terms",    type: "select",   options: ["Advance", "15 Days", "30 Days", "45 Days", "60 Days"] },
  { name: "creditLimit",  label: "Credit Limit (₹)", type: "number",   prefix: "₹" },
  { name: "address",      label: "Address",          type: "textarea", fullWidth: true },
  { name: "status",       label: "Status",           type: "toggle",   defaultValue: true },
];

const columns: ColumnDef[] = [
  { key: "name",         label: "Customer Name" },
  { key: "contact",      label: "Contact Person" },
  { key: "phone",        label: "Phone" },
  { key: "gst",          label: "GST No." },
  { key: "type",         label: "Type" },
  { key: "paymentTerms", label: "Payment Terms" },
  { key: "status",       label: "Status" },
];

const initialData: any[] = [];

const CustomerMaster: React.FC = () => (
  <>
      <Breadcrumbs items={["Dashboard", "Finance Module", "Customer Master"]} />
    <h1 className="text-xl font-heading font-bold text-foreground mb-4">Customer Master</h1>
    <MasterPage title="Customer" fields={fields} columns={columns} initialData={initialData} />
  </>
);

export default CustomerMaster;
