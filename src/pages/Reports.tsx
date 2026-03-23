import React from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line } from "recharts";
import { TrendingUp, FileText, IndianRupee, PieChart as PieChartIcon } from "lucide-react";

const monthlyData = [
  { month: "Oct", income: 620000, expense: 410000 },
  { month: "Nov", income: 580000, expense: 390000 },
  { month: "Dec", income: 710000, expense: 520000 },
  { month: "Jan", income: 650000, expense: 480000 },
  { month: "Feb", income: 820000, expense: 450000 },
  { month: "Mar", income: 925000, expense: 398500 },
];

const categoryData = [
  { name: "Material", value: 185000, color: "hsl(239, 84%, 67%)" },
  { name: "Labour", value: 96000, color: "hsl(263, 70%, 58%)" },
  { name: "Transport", value: 22000, color: "hsl(217, 91%, 60%)" },
  { name: "Equipment", value: 45000, color: "hsl(174, 72%, 46%)" },
  { name: "Admin", value: 50500, color: "hsl(340, 75%, 55%)" },
];

const cashFlowData = [
  { month: "Oct", balance: 1200000 },
  { month: "Nov", balance: 1390000 },
  { month: "Dec", balance: 1580000 },
  { month: "Jan", balance: 1750000 },
  { month: "Feb", balance: 2120000 },
  { month: "Mar", balance: 2646500 },
];

const topParties = [
  { name: "Raj Builders", total: "₹4,25,000", txns: 12 },
  { name: "Metro Hardware", total: "₹3,87,500", txns: 8 },
  { name: "SiteCraft Engineers", total: "₹2,68,000", txns: 6 },
  { name: "Quick Transport Co", total: "₹1,54,000", txns: 15 },
  { name: "Bharat Steel Traders", total: "₹1,22,000", txns: 4 },
];

const Reports: React.FC = () => (
  <AppLayout>
    <Breadcrumbs items={["Dashboard", "Reports"]} />
    <h1 className="text-xl font-heading font-bold text-foreground mb-4">Reports</h1>

    {/* Summary */}
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
      {[
        { label: "Total Income", value: "₹43,05,000", icon: IndianRupee, color: "hsl(142, 71%, 45%)" },
        { label: "Total Expenses", value: "₹26,48,500", icon: TrendingUp, color: "hsl(0, 72%, 51%)" },
        { label: "Net Profit", value: "₹16,56,500", icon: FileText, color: "hsl(var(--primary))" },
        { label: "Transactions", value: "68", icon: PieChartIcon, color: "hsl(var(--secondary))" },
      ].map((s) => (
        <div key={s.label} className="rounded-xl bg-card border border-border p-4 flex items-center gap-4" style={{ borderLeftWidth: 3, borderLeftColor: s.color }}>
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
          <BarChart data={monthlyData}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="month" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
            <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
            <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, color: "hsl(var(--foreground))" }} formatter={(value: number) => [`₹${value.toLocaleString("en-IN")}`, ""]} />
            <Bar dataKey="income" fill="hsl(142, 71%, 45%)" radius={[4, 4, 0, 0]} name="Income" />
            <Bar dataKey="expense" fill="hsl(0, 72%, 51%)" radius={[4, 4, 0, 0]} name="Expense" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Expense by Category */}
      <div className="rounded-xl bg-card border border-border p-5">
        <h2 className="font-heading font-semibold text-foreground text-sm mb-4">Expense by Category</h2>
        <div className="flex flex-col sm:flex-row items-center gap-4">
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={categoryData} dataKey="value" cx="50%" cy="50%" outerRadius={80} innerRadius={40}>
                {categoryData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
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
            {categoryData.map((c) => (
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
          <LineChart data={cashFlowData}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="month" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
            <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} tickFormatter={(v) => `₹${(v / 100000).toFixed(1)}L`} />
            <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, color: "hsl(var(--foreground))" }} formatter={(value: number) => [`₹${value.toLocaleString("en-IN")}`, "Balance"]} />
            <Line type="monotone" dataKey="balance" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ fill: "hsl(var(--primary))", r: 4 }} />
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
              <span className="text-sm font-heading font-semibold text-foreground">{p.total}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  </AppLayout>
);

export default Reports;
