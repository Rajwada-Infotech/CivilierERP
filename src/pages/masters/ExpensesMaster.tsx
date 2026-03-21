import React from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { MasterPage, FieldDef, ColumnDef } from "@/components/MasterPage";

const fields: FieldDef[] = [
  { name: "name", label: "Expense Name", type: "text", required: true },
  { name: "code", label: "Expense Code", type: "text" },
  { name: "category", label: "Expense Category", type: "select", options: ["Direct", "Indirect", "Administrative", "Capital", "Operational"] },
  { name: "linkedHead", label: "Linked Account Head", type: "select", options: ["Office Expenses", "Site Expenses", "Labour Cost", "Material Cost"] },
  { name: "tax", label: "Tax Applicable", type: "select", options: ["None", "GST 5%", "GST 12%", "GST 18%", "GST 28%"] },
  { name: "description", label: "Description", type: "textarea", fullWidth: true },
  { name: "status", label: "Status", type: "toggle", defaultValue: true },
];

const columns: ColumnDef[] = [
  { key: "name", label: "Expense Name" },
  { key: "code", label: "Code" },
  { key: "category", label: "Category" },
  { key: "linkedHead", label: "Linked Account Head" },
  { key: "tax", label: "Tax" },
  { key: "status", label: "Status" },
];

const initialData = [
  { name: "Site Material Purchase", code: "EXP-001", category: "Direct", linkedHead: "Material Cost", tax: "GST 18%", description: "Raw materials for sites", status: true },
  { name: "Labour Wages", code: "EXP-002", category: "Direct", linkedHead: "Labour Cost", tax: "None", description: "Daily labour wages", status: true },
  { name: "Office Rent", code: "EXP-003", category: "Administrative", linkedHead: "Office Expenses", tax: "GST 18%", description: "Monthly office rent", status: true },
];

const ExpensesMaster: React.FC = () => (
  <AppLayout>
    <Breadcrumbs items={["Dashboard", "Finance Module", "Expenses Master"]} />
    <h1 className="text-xl font-heading font-bold text-foreground mb-4">Expenses Master</h1>
    <MasterPage title="Expense" fields={fields} columns={columns} initialData={initialData} />
  </AppLayout>
);

export default ExpensesMaster;
