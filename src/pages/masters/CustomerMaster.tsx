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

const initialData = [
  { name: "ABC Developers", contact: "Anand Mehta", phone: "9876111222", email: "anand@abcdev.com", gst: "27AABCA1111F1Z1", pan: "AABCA1111F", type: "Company",    paymentTerms: "30 Days", creditLimit: "1000000", address: "Mumbai, MH",    status: true },
  { name: "XYZ Infra Ltd",  contact: "Priya Singh", phone: "9876222333", email: "priya@xyzinfra.in", gst: "07BBDCX2222G2Z2", pan: "BBDCX2222G", type: "Company",    paymentTerms: "45 Days", creditLimit: "2000000", address: "Delhi, DL",     status: true },
  { name: "PQR Constructions",contact: "Ramesh Nair",phone: "9876333444", email: "ramesh@pqr.co",    gst: "32CDEPQ3333H3Z3", pan: "CDEPQ3333H", type: "Individual", paymentTerms: "15 Days", creditLimit: "500000",  address: "Kochi, KL",     status: true },
];

const CustomerMaster: React.FC = () => (
  <>
      <Breadcrumbs items={["Dashboard", "Finance Module", "Customer Master"]} />
    <h1 className="text-xl font-heading font-bold text-foreground mb-4">Customer Master</h1>
    <MasterPage title="Customer" fields={fields} columns={columns} initialData={initialData} />
  </>
);

export default CustomerMaster;
