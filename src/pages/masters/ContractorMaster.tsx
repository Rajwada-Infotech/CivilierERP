import React from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { MasterPage, FieldDef, ColumnDef } from "@/components/MasterPage";

const fields: FieldDef[] = [
  { name: "name", label: "Contractor Name", type: "text", required: true },
  { name: "contact", label: "Contact Person", type: "text" },
  { name: "phone", label: "Phone Number", type: "text" },
  { name: "email", label: "Email Address", type: "text" },
  { name: "gst", label: "GST Number", type: "text", uppercase: true },
  { name: "pan", label: "PAN Number", type: "text", uppercase: true },
  { name: "type", label: "Contractor Type", type: "select", options: ["Civil", "Electrical", "Mechanical", "Plumbing", "General"] },
  { name: "paymentTerms", label: "Payment Terms", type: "select", options: ["Advance", "15 Days", "30 Days", "45 Days", "60 Days"] },
  { name: "address", label: "Address", type: "textarea", fullWidth: true },
  { name: "status", label: "Status", type: "toggle", defaultValue: true },
];

const columns: ColumnDef[] = [
  { key: "name", label: "Contractor Name" },
  { key: "contact", label: "Contact Person" },
  { key: "phone", label: "Phone" },
  { key: "gst", label: "GST No." },
  { key: "type", label: "Type" },
  { key: "paymentTerms", label: "Payment Terms" },
  { key: "status", label: "Status" },
];

const initialData = [
  { name: "Raj Builders", contact: "Rajesh Kumar", phone: "9876543210", email: "raj@builders.com", gst: "27AABCT1234F1Z5", pan: "AABCT1234F", type: "Civil", paymentTerms: "30 Days", address: "Mumbai, MH", status: true },
  { name: "SiteCraft Engineers", contact: "Meena Patel", phone: "9988776655", email: "meena@sitecraft.in", gst: "24BBDCS5678G2Z3", pan: "BBDCS5678G", type: "Electrical", paymentTerms: "15 Days", address: "Ahmedabad, GJ", status: true },
  { name: "Apex Constructions", contact: "Sunil Verma", phone: "9112233445", email: "sunil@apex.co", gst: "09CDEFT7890H3Z1", pan: "CDEFT7890H", type: "General", paymentTerms: "45 Days", address: "Lucknow, UP", status: false },
];

const ContractorMaster: React.FC = () => (
  <>
      <Breadcrumbs items={["Dashboard", "Finance Module", "Contractor Master"]} />
    <h1 className="text-xl font-heading font-bold text-foreground mb-4">Contractor Master</h1>
    <MasterPage title="Contractor" fields={fields} columns={columns} initialData={initialData} />
  </>
);

export default ContractorMaster;
