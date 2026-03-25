import React from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { MasterPage, FieldDef, ColumnDef } from "@/components/MasterPage";

const fields: FieldDef[] = [
  { name: "bankName", label: "Bank Name", type: "text", required: true },
  { name: "branch", label: "Branch Name", type: "text" },
  { name: "accountNo", label: "Account Number", type: "text", required: true },
  { name: "ifsc", label: "IFSC Code", type: "text", uppercase: true, required: true },
  { name: "accountType", label: "Account Type", type: "select", options: ["Current", "Savings", "Overdraft (OD)", "Cash Credit"] },
  { name: "bankType", label: "Bank Type", type: "select", options: ["Nationalized", "Private", "Co-operative", "Foreign", "Regional Rural"] },
  { name: "holderName", label: "Account Holder Name", type: "text" },
  { name: "openingBalance", label: "Opening Balance (₹)", type: "number", prefix: "₹" },
  { name: "address", label: "Address", type: "textarea", fullWidth: true },
  { name: "status", label: "Status", type: "toggle", defaultValue: true },
];

const columns: ColumnDef[] = [
  { key: "bankName", label: "Bank Name" },
  { key: "branch", label: "Branch" },
  { key: "accountNo", label: "Account No." },
  { key: "ifsc", label: "IFSC" },
  { key: "accountType", label: "Account Type" },
  { key: "bankType", label: "Bank Type" },
  { key: "status", label: "Status" },
];

const initialData = [
  { bankName: "HDFC Bank", branch: "Andheri West", accountNo: "50100012345678", ifsc: "HDFC0001234", accountType: "Current", bankType: "Private", holderName: "Civilier Infra Pvt Ltd", openingBalance: "2500000", address: "Mumbai, MH", status: true },
  { bankName: "State Bank of India", branch: "Main Branch", accountNo: "38765432109876", ifsc: "SBIN0001111", accountType: "Savings", bankType: "Nationalized", holderName: "Civilier Infra Pvt Ltd", openingBalance: "800000", address: "Pune, MH", status: true },
  { bankName: "ICICI Bank", branch: "Koregaon Park", accountNo: "12345678901234", ifsc: "ICIC0002222", accountType: "Overdraft (OD)", bankType: "Private", holderName: "Civilier Infra Pvt Ltd", openingBalance: "1200000", address: "Pune, MH", status: true },
];

const BankMaster: React.FC = () => (
  <>
      <Breadcrumbs items={["Dashboard", "Finance Module", "Bank Master"]} />
    <h1 className="text-xl font-heading font-bold text-foreground mb-4">Bank Master</h1>
    <MasterPage title="Bank" fields={fields} columns={columns} initialData={initialData} />
  </>
);

export default BankMaster;
