import React from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { CreditCard, ArrowUpRight, ArrowDownLeft, IndianRupee } from "lucide-react";

const mockTransactions = [
  { id: "TXN-001", date: "2025-03-18", type: "Payment", party: "Raj Builders", description: "Site concrete work - Phase 2", amount: 125000, mode: "Bank Transfer", status: "Completed" },
  { id: "TXN-002", date: "2025-03-17", type: "Receipt", party: "ABC Developers", description: "Project milestone payment received", amount: 450000, mode: "NEFT", status: "Completed" },
  { id: "TXN-003", date: "2025-03-17", type: "Payment", party: "Metro Hardware", description: "Steel rods & cement purchase", amount: 87500, mode: "Cheque", status: "Pending" },
  { id: "TXN-004", date: "2025-03-16", type: "Payment", party: "Quick Transport Co", description: "Material transport charges", amount: 22000, mode: "UPI", status: "Completed" },
  { id: "TXN-005", date: "2025-03-15", type: "Receipt", party: "XYZ Infra Ltd", description: "Advance for new project", amount: 300000, mode: "Bank Transfer", status: "Completed" },
  { id: "TXN-006", date: "2025-03-15", type: "Journal", party: "Internal", description: "Depreciation entry - Office equipment", amount: 15000, mode: "—", status: "Posted" },
  { id: "TXN-007", date: "2025-03-14", type: "Payment", party: "SiteCraft Engineers", description: "Electrical wiring - Block A", amount: 68000, mode: "NEFT", status: "Completed" },
  { id: "TXN-008", date: "2025-03-13", type: "Contra", party: "Internal", description: "Cash deposited to HDFC Current A/c", amount: 200000, mode: "Cash Deposit", status: "Completed" },
  { id: "TXN-009", date: "2025-03-12", type: "Payment", party: "Labour Wages", description: "Weekly wages - Site workers", amount: 96000, mode: "Cash", status: "Completed" },
  { id: "TXN-010", date: "2025-03-11", type: "Receipt", party: "PQR Constructions", description: "Final settlement - Project Alpha", amount: 175000, mode: "Cheque", status: "Pending" },
];

const summaryStats = [
  { label: "Total Payments", value: "₹3,98,500", change: "-12%", icon: ArrowUpRight, color: "hsl(0, 72%, 51%)" },
  { label: "Total Receipts", value: "₹9,25,000", change: "+24%", icon: ArrowDownLeft, color: "hsl(142, 71%, 45%)" },
  { label: "Net Cash Flow", value: "₹5,26,500", change: "+18%", icon: IndianRupee, color: "hsl(var(--primary))" },
  { label: "Pending Txns", value: "2", change: "", icon: CreditCard, color: "hsl(var(--secondary))" },
];

const Transactions: React.FC = () => (
  <AppLayout>
    <Breadcrumbs items={["Dashboard", "Transactions"]} />
    <h1 className="text-xl font-heading font-bold text-foreground mb-4">Transactions</h1>

    {/* Summary Cards */}
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
      {summaryStats.map((s) => (
        <div key={s.label} className="rounded-xl bg-card border border-border p-4 flex items-center gap-4" style={{ borderLeftWidth: 3, borderLeftColor: s.color }}>
          <div className="p-2 rounded-lg" style={{ background: `${s.color}20` }}>
            <s.icon size={20} style={{ color: s.color }} />
          </div>
          <div>
            <p className="text-xs text-muted-foreground font-heading">{s.label}</p>
            <p className="text-base sm:text-lg font-heading font-bold text-foreground">{s.value}</p>
            {s.change && <p className={`text-xs ${s.change.startsWith("+") ? "text-green-500" : "text-red-500"}`}>{s.change} vs last month</p>}
          </div>
        </div>
      ))}
    </div>

    {/* Transactions Table */}
    <div className="rounded-xl bg-card border border-border overflow-hidden">
      <div className="p-4 border-b border-border flex items-center justify-between">
        <h2 className="font-heading font-semibold text-foreground text-sm">Recent Transactions</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              {["ID", "Date", "Type", "Party", "Description", "Amount (₹)", "Mode", "Status"].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-xs font-heading text-muted-foreground font-semibold whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {mockTransactions.map((txn, i) => (
              <tr key={txn.id} className={`border-b border-border transition-colors hover:bg-muted/50 ${i % 2 === 1 ? "bg-muted/20" : ""}`}>
                <td className="px-4 py-3 text-primary font-heading text-xs">{txn.id}</td>
                <td className="px-4 py-3 text-foreground whitespace-nowrap">{txn.date}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-heading ${
                    txn.type === "Payment" ? "bg-destructive/15 text-destructive" :
                    txn.type === "Receipt" ? "bg-green-500/15 text-green-500" :
                    txn.type === "Journal" ? "bg-primary/15 text-primary" :
                    "bg-secondary/15 text-secondary"
                  }`}>{txn.type}</span>
                </td>
                <td className="px-4 py-3 text-foreground font-medium whitespace-nowrap">{txn.party}</td>
                <td className="px-4 py-3 text-muted-foreground max-w-[200px] truncate">{txn.description}</td>
                <td className="px-4 py-3 text-foreground font-heading font-medium whitespace-nowrap">₹{txn.amount.toLocaleString("en-IN")}</td>
                <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{txn.mode}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-heading ${
                    txn.status === "Completed" ? "bg-green-500/15 text-green-500" :
                    txn.status === "Pending" ? "bg-yellow-500/15 text-yellow-500" :
                    "bg-primary/15 text-primary"
                  }`}>{txn.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  </AppLayout>
);

export default Transactions;
