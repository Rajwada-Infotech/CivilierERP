import React from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { MasterPage, FieldDef, ColumnDef } from "@/components/MasterPage";

const fields: FieldDef[] = [
  { 
    name: "name", 
    label: "Name", 
    type: "text", 
    required: true 
  },
  { 
    name: "description", 
    label: "Description", 
    type: "textarea", 
    fullWidth: true,
    required: true 
  },
  { 
    name: "gst", 
    label: "GST", 
    type: "select", 
    options: ["Before", "After"], 
    required: true 
  },
  { 
    name: "type", 
    label: "Type", 
    type: "select", 
    options: ["Increase", "Decrease"], 
    required: true 
  },
];

const columns: ColumnDef[] = [
  { key: "name", label: "Name" },
  { key: "gst", label: "GST" },
  { key: "type", label: "Type" },
  { key: "description", label: "Description" },
];

const initialData = [
  {
    name: "Net 30 Days",
    description: "Payment due 30 days after invoice date",
    gst: "Before",
    type: "Increase"
  },
  {
    name: "Advance 50%",
    description: "50% advance payment required before work starts",
    gst: "After",
    type: "Decrease"
  },
  {
    name: "On Delivery",
    description: "Full payment on material delivery",
    gst: "Before",
    type: "Increase"
  },
  {
    name: "Credit 15 Days",
    description: "Credit period of 15 days for approved customers",
    gst: "After",
    type: "Decrease"
  }
];

const BillingTermsMaster: React.FC = () => (
  <>
    <Breadcrumbs items={["Dashboard", "Masters", "Billing Terms Master"]} />
    <h1 className="text-xl font-heading font-bold text-foreground mb-4">Billing Terms Master</h1>
    <MasterPage 
      title="Billing Term"
      fields={fields} 
      columns={columns} 
      initialData={initialData} 
    />
  </>
);


export default BillingTermsMaster;

