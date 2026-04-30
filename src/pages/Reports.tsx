import React, { useState, useEffect } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { SummaryCards } from "@/components/reports/SummaryCards";
import { IncomeVsExpenseChart } from "@/components/reports/IncomeVsExpenseChart";
import { ExpenseByCategoryChart } from "@/components/reports/ExpenseByCategoryChart";
import { CashFlowChart } from "@/components/reports/CashFlowChart";
import { TopPartiesTable } from "@/components/reports/TopPartiesTable";
import { ExportMenu } from "@/components/ExportMenu";
import type { ExportColumn } from "@/lib/export";

interface ReportsSummary {
  totalIncome: number;
  totalExpenses: number;
  netProfit: number;
  transactionCount: number;
}
interface MonthlyPoint {
  month: string;
  income: number;
  expense: number;
}
interface CategoryPoint {
  name: string;
  value: number;
  color: string;
}
interface CashFlowPoint {
  month: string;
  balance: number;
}
interface TopParty {
  name: string;
  txns: number;
  total: number;
}
interface ReportsData {
  summary: ReportsSummary;
  charts: {
    monthly: MonthlyPoint[];
    categories: CategoryPoint[];
    cashFlow: CashFlowPoint[];
  };
  topParties: TopParty[];
}

const Reports: React.FC = () => {
  const [data, setData] = useState<ReportsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchWithAuth("/api/reports")
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load reports");
        return r.json();
      })
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading)
    return (
      <div className="py-20 text-center text-muted-foreground animate-pulse">
        Loading reports...
      </div>
    );
  if (error)
    return <div className="py-20 text-center text-destructive">{error}</div>;
  if (!data) return null;

  const { summary, charts, topParties } = data;

  // ── Export column definitions ────────────────────────────────────────────────
  const TOP_PARTIES_COLUMNS: ExportColumn[] = [
    { header: "Party Name", accessor: "name" },
    { header: "Transactions", accessor: "txns" },
    { header: "Total (₹)", accessor: "total" },
  ];

  // Full summary export — flatten summary + monthly chart + top parties into rows
  const SUMMARY_COLUMNS: ExportColumn[] = [
    { header: "Metric", accessor: "metric" },
    { header: "Value", accessor: "value" },
  ];
  const summaryRows: Record<string, unknown>[] = [
    { metric: "Total Income (₹)", value: summary.totalIncome },
    { metric: "Total Expenses (₹)", value: summary.totalExpenses },
    { metric: "Net Profit (₹)", value: summary.netProfit },
    { metric: "Total Transactions", value: summary.transactionCount },
    { metric: "", value: "" },
    { metric: "── Monthly Breakdown ──", value: "" },
    ...charts.monthly.map((m) => ({
      metric: m.month,
      value: `Income: ₹${m.income.toLocaleString("en-IN")}  |  Expense: ₹${m.expense.toLocaleString("en-IN")}`,
    })),
    { metric: "", value: "" },
    { metric: "── Top Parties ──", value: "" },
    ...topParties.map((p, i) => ({
      metric: `${i + 1}. ${p.name}`,
      value: `${p.txns} txns · ₹${p.total.toLocaleString("en-IN")}`,
    })),
  ];

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Reports"]} />
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-heading font-bold text-foreground">
          Reports
        </h1>
        <ExportMenu
          data={summaryRows}
          columns={SUMMARY_COLUMNS}
          title="Financial Reports Summary"
          filename="reports-summary"
          subtitle={`Income: ₹${summary.totalIncome.toLocaleString("en-IN")} · Expenses: ₹${summary.totalExpenses.toLocaleString("en-IN")} · Net: ₹${summary.netProfit.toLocaleString("en-IN")}`}
        />
      </div>

      <SummaryCards summary={summary} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <IncomeVsExpenseChart data={charts.monthly} />
        <ExpenseByCategoryChart data={charts.categories} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <CashFlowChart data={charts.cashFlow} />
        <div className="relative">
          <TopPartiesTable parties={topParties} />
          <div className="absolute top-4 right-4">
            <ExportMenu
              data={topParties as Record<string, unknown>[]}
              columns={TOP_PARTIES_COLUMNS}
              title="Top Parties by Volume"
              filename="top-parties"
              disabled={topParties.length === 0}
            />
          </div>
        </div>
      </div>
    </>
  );
};

export default Reports;
