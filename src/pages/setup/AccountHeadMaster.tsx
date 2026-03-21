import React from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { MasterPage, FieldDef, ColumnDef } from "@/components/MasterPage";

const fields: FieldDef[] = [
  { name: "headName", label: "Account Head Name", type: "text", required: true },
  { name: "headCode", label: "Account Code", type: "text", required: true },
  { name: "accountGroup", label: "Account Group", type: "select", required: true, options: ["Fixed Assets", "Current Liabilities", "Revenue", "Direct Expenses"] },
  { name: "accountType", label: "Account Type", type: "select", options: ["Bank", "Cash", "Receivable", "Payable", "Revenue", "Expense", "Capital"] },
  { name: "openingBalance", label: "Opening Balance (₹)", type: "number", prefix: "₹" },
  { name: "balanceType", label: "Balance Type", type: "select", options: ["Debit", "Credit"] },
  { name: "description", label: "Description", type: "textarea", fullWidth: true },
  { name: "status", label: "Status", type: "toggle", defaultValue: true },
];

const columns: ColumnDef[] = [
  { key: "headName", label: "Account Head Name" },
  { key: "headCode", label: "Account Code" },
  { key: "accountGroup", label: "Account Group" },
  { key: "accountType", label: "Account Type" },
  { key: "openingBalance", label: "Opening Balance" },
  { key: "status", label: "Status" },
];

const initialData = [
  { headName: "Office Building", headCode: "AH-001", accountGroup: "Fixed Assets", accountType: "Capital", openingBalance: "1500000", balanceType: "Debit", description: "", status: true },
  { headName: "Trade Payables", headCode: "AH-002", accountGroup: "Current Liabilities", accountType: "Payable", openingBalance: "350000", balanceType: "Credit", description: "", status: true },
  { headName: "Contract Revenue", headCode: "AH-003", accountGroup: "Revenue", accountType: "Revenue", openingBalance: "0", balanceType: "Credit", description: "", status: true },
];

const AccountHeadMaster: React.FC = () => (
  <AppLayout>
    <Breadcrumbs items={["Dashboard", "Setup", "Account Head"]} />
    <h1 className="text-xl font-heading font-bold text-foreground mb-4">Account Head</h1>
    <MasterPage title="Account Head" fields={fields} columns={columns} initialData={initialData} />
  </AppLayout>
);

export default AccountHeadMaster;
