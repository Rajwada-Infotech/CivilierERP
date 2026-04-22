import React, { useState, useEffect } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line,
} from "recharts";
import { TrendingUp, FileText, IndianRupee, PieChart as PieChartIcon } from "lucide-react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

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

const fmt = (n: number) =>
  "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });

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

  const summaryCards = [
    { label: "Total Income",    value: fmt(summary.totalIncome),    icon: IndianRupee,   color: "hsl(142, 71%, 45%)" },
    { label: "Total Expenses",  value: fmt(summary.totalExpenses),  icon: TrendingUp,    color: "hsl(0, 72%, 51%)" },
    { label: "Net Profit",      value: fmt(summary.netProfit),      icon: FileText,      color: "hsl(var(--primary))" },
    { label: "Transactions",    value: String(summary.transactionCount), icon: PieChartIcon, color: "hsl(var(--secondary))" },
  ];

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Reports"]} />
      <h1 className="text-xl font-heading font-bold text-foreground mb-4">Reports</h1>

      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {summaryCards.map((s) => (
          <div key={s.label} className="rounded-xl bg-card border border-border p-4 flex items-center gap-4"
            style={{ borderLeftWidth: 3, borderLeftColor: s.color }}>
            <div className="p-2 rounded-lg" style={{ background: `${s.color}20` }}>
              <s.icon size={20} style={{ color: s.color }} />
            </div>
            <div>
              <p className="text-xs text-muted-foreground font-heading">{s.label}</p>
              <p className="text-base sm:text-lg font-heading font-bold text-foreground">{s.value}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Income vs Expense */}
        <div className="rounded-xl bg-card border border-border p-5">
          <h2 className="font-heading font-semibold text-foreground text-sm mb-4">Income vs Expenses (6 Months)</h2>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={charts.monthly}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="month" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
              <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
              <Tooltip
                contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, color: "hsl(var(--foreground))" }}
                formatter={(value: number) => [`₹${value.toLocaleString("en-IN")}`, ""]} />
              <Bar dataKey="income"  fill="hsl(142, 71%, 45%)" radius={[4,4,0,0]} name="Income" />
              <Bar dataKey="expense" fill="hsl(0, 72%, 51%)"   radius={[4,4,0,0]} name="Expense" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Expense by Category */}
        <div className="rounded-xl bg-card border border-border p-5">
          <h2 className="font-heading font-semibold text-foreground text-sm mb-4">Expense by Category</h2>
          <div className="flex flex-col sm:flex-row items-center gap-4">
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={charts.categories} dataKey="value" cx="50%" cy="50%" outerRadius={80} innerRadius={40}>
                  {charts.categories.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                </Pie>
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0];
                    return (
                      <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-lg">
                        <p className="text-xs font-heading font-semibold text-foreground">{d.name}</p>
                        <p className="text-xs text-muted-foreground">₹{(d.value as number).toLocaleString("en-IN")}</p>
                      </div>
                    );
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="space-y-2">
              {charts.categories.map((c) => (
                <div key={c.name} className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full shrink-0" style={{ background: c.color }} />
                  <span className="text-xs text-foreground">{c.name}</span>
                  <span className="text-xs text-muted-foreground ml-auto">₹{(c.value / 1000).toFixed(0)}k</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Cash Flow Trend */}
        <div className="rounded-xl bg-card border border-border p-5">
          <h2 className="font-heading font-semibold text-foreground text-sm mb-4">Cash Flow Trend</h2>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={charts.cashFlow}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="month" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
              <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                tickFormatter={(v) => `₹${(v / 100000).toFixed(1)}L`} />
              <Tooltip
                contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, color: "hsl(var(--foreground))" }}
                formatter={(value: number) => [`₹${value.toLocaleString("en-IN")}`, "Balance"]} />
              <Line type="monotone" dataKey="balance" stroke="hsl(var(--primary))"
                strokeWidth={2} dot={{ fill: "hsl(var(--primary))", r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Top Parties */}
        <div className="rounded-xl bg-card border border-border p-5">
          <h2 className="font-heading font-semibold text-foreground text-sm mb-4">Top Parties by Volume</h2>
          <div className="space-y-3">
            {topParties.map((p, i) => (
              <div key={p.name} className="flex items-center gap-3">
                <span className="w-6 h-6 rounded-full bg-primary/15 text-primary text-xs font-heading font-bold flex items-center justify-center">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground font-medium truncate">{p.name}</p>
                  <p className="text-xs text-muted-foreground">{p.txns} transactions</p>
                </div>
                <span className="text-sm font-heading font-semibold text-foreground">{fmt(p.total)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
};

export default Reports;
