import React from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { MasterPage, FieldDef, ColumnDef } from "@/components/MasterPage";

const fields: FieldDef[] = [
  { name: "name", label: "Supplier Name", type: "text", required: true },
  { name: "contact", label: "Contact Person", type: "text" },
  { name: "phone", label: "Phone Number", type: "text" },
  { name: "email", label: "Email Address", type: "text" },
  { name: "gst", label: "GST Number", type: "text", uppercase: true },
  { name: "pan", label: "PAN Number", type: "text", uppercase: true },
  { name: "category", label: "Supplier Category", type: "select", options: ["Material", "Equipment", "Labour", "Services", "Transport"] },
  { name: "paymentTerms", label: "Payment Terms", type: "select", options: ["Advance", "15 Days", "30 Days", "45 Days", "60 Days"] },
  { name: "creditLimit", label: "Credit Limit (₹)", type: "number", prefix: "₹" },
  { name: "address", label: "Address", type: "textarea", fullWidth: true },
  { name: "status", label: "Status", type: "toggle", defaultValue: true },
];

const columns: ColumnDef[] = [
  { key: "name", label: "Supplier Name" },
  { key: "contact", label: "Contact Person" },
  { key: "phone", label: "Phone" },
  { key: "gst", label: "GST No." },
  { key: "category", label: "Category" },
  { key: "paymentTerms", label: "Payment Terms" },
  { key: "status", label: "Status" },
];

const initialData = [
  { name: "Metro Hardware", contact: "Amit Shah", phone: "9876000111", email: "amit@metro.com", gst: "27AABCM1111F1Z1", pan: "AABCM1111F", category: "Material", paymentTerms: "30 Days", creditLimit: "500000", address: "Pune, MH", status: true },
  { name: "Bharat Steel Traders", contact: "Ravi Jain", phone: "9876000222", email: "ravi@bharatsteel.in", gst: "24BBDCB2222G2Z2", pan: "BBDCB2222G", category: "Material", paymentTerms: "45 Days", creditLimit: "800000", address: "Surat, GJ", status: true },
  { name: "Quick Transport Co", contact: "Dinesh Rao", phone: "9876000333", email: "dinesh@quicktrans.co", gst: "29CDEQT3333H3Z3", pan: "CDEQT3333H", category: "Transport", paymentTerms: "15 Days", creditLimit: "200000", address: "Bangalore, KA", status: true },
];

const SupplierMaster: React.FC = () => (
  <AppLayout>
    <Breadcrumbs items={["Dashboard", "Finance Module", "Supplier Master"]} />
    <h1 className="text-xl font-heading font-bold text-foreground mb-4">Supplier Master</h1>
    <MasterPage title="Supplier" fields={fields} columns={columns} initialData={initialData} />
  </AppLayout>
);

export default SupplierMaster;
