import React, { useState, useEffect } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { SummaryCards }           from "@/components/reports/SummaryCards";
import { IncomeVsExpenseChart }   from "@/components/reports/IncomeVsExpenseChart";
import { ExpenseByCategoryChart } from "@/components/reports/ExpenseByCategoryChart";
import { CashFlowChart }          from "@/components/reports/CashFlowChart";
import { TopPartiesTable }        from "@/components/reports/TopPartiesTable";

interface ReportsSummary {
  totalIncome: number;
  totalExpenses: number;
  netProfit: number;
  transactionCount: number;
}
interface MonthlyPoint  { month: string; income: number; expense: number; }
interface CategoryPoint { name: string; value: number; color: string; }
interface CashFlowPoint { month: string; balance: number; }
interface TopParty      { name: string; txns: number; total: number; }
interface ReportsData {
  summary: ReportsSummary;
  charts: {
    monthly:    MonthlyPoint[];
    categories: CategoryPoint[];
    cashFlow:   CashFlowPoint[];
  };
  topParties: TopParty[];
}

const Reports: React.FC = () => {
  const [data, setData]       = useState<ReportsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

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

  if (loading) return <div className="py-20 text-center text-muted-foreground animate-pulse">Loading reports...</div>;
  if (error)   return <div className="py-20 text-center text-destructive">{error}</div>;
  if (!data)   return null;

  const { summary, charts, topParties } = data;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Reports"]} />
      <h1 className="text-xl font-heading font-bold text-foreground mb-4">Reports</h1>

      <SummaryCards summary={summary} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <IncomeVsExpenseChart   data={charts.monthly} />
        <ExpenseByCategoryChart data={charts.categories} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <CashFlowChart    data={charts.cashFlow} />
        <TopPartiesTable  parties={topParties} />
      </div>
    </>
  );
};

export default Reports;
