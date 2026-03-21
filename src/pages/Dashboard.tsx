import React, { useMemo } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { HardHat, ShoppingCart, Landmark, Receipt, TrendingUp, Users } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

const chartData = [
  { month: "Jan", expenses: 320000 },
  { month: "Feb", expenses: 410000 },
  { month: "Mar", expenses: 380000 },
  { month: "Apr", expenses: 482000 },
  { month: "May", expenses: 395000 },
  { month: "Jun", expenses: 520000 },
];

const activities = [
  { text: "New contractor 'Raj Builders' added", time: "2 hours ago" },
  { text: "Payment of ₹1,25,000 to Sai Suppliers", time: "4 hours ago" },
  { text: "Bank account 'HDFC Current' updated", time: "Yesterday" },
  { text: "Expense 'Site Material' created", time: "Yesterday" },
  { text: "Supplier 'Metro Hardware' marked active", time: "2 days ago" },
];

const stats = [
  { label: "Total Contractors", value: "24", icon: HardHat, color: "hsl(239, 84%, 67%)" },
  { label: "Active Suppliers", value: "18", icon: ShoppingCart, color: "hsl(263, 70%, 58%)" },
  { label: "Bank Accounts", value: "6", icon: Landmark, color: "hsl(217, 91%, 60%)" },
  { label: "Monthly Expenses", value: "₹4,82,000", icon: Receipt, color: "hsl(174, 72%, 46%)" },
];

const tooltipStyle = { background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, color: "hsl(var(--foreground))" };

const MemoizedChart = React.memo(() => (
  <ResponsiveContainer width="100%" height={260}>
    <BarChart data={chartData}>
      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
      <XAxis dataKey="month" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
      <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
      <Tooltip contentStyle={tooltipStyle} formatter={(value: number) => [`₹${value.toLocaleString("en-IN")}`, "Expenses"]} />
      <Bar dataKey="expenses" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
    </BarChart>
  </ResponsiveContainer>
));
MemoizedChart.displayName = "MemoizedChart";

const Dashboard = () => (
  <AppLayout>
    <Breadcrumbs items={["Dashboard"]} />
    <div className="mb-6">
      <h1 className="text-2xl font-heading font-bold text-foreground">Welcome to CivilierERP</h1>
      <p className="text-sm text-muted-foreground mt-1">Your civil ERP command center</p>
    </div>

    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
      {stats.map((s) => (
        <div key={s.label} className="rounded-xl bg-card border border-border p-4 flex items-center gap-4" style={{ borderLeftWidth: 3, borderLeftColor: s.color }}>
          <div className="p-2 rounded-lg" style={{ background: `${s.color}20` }}>
            <s.icon size={22} style={{ color: s.color }} />
          </div>
          <div>
            <p className="text-xs text-muted-foreground font-heading">{s.label}</p>
            <p className="text-xl font-heading font-bold text-foreground">{s.value}</p>
          </div>
        </div>
      ))}
    </div>

    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 rounded-xl bg-card border border-border p-5">
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp size={18} className="text-primary" />
          <h2 className="font-heading font-semibold text-foreground">Monthly Expenses</h2>
        </div>
        <MemoizedChart />
      </div>

      <div className="rounded-xl bg-card border border-border p-5">
        <div className="flex items-center gap-2 mb-4">
          <Users size={18} className="text-primary" />
          <h2 className="font-heading font-semibold text-foreground">Recent Activity</h2>
        </div>
        <div className="space-y-3">
          {activities.map((a, i) => (
            <div key={i} className="flex items-start gap-3">
              <div className="w-2 h-2 rounded-full bg-primary mt-1.5 shrink-0" />
              <div>
                <p className="text-sm text-foreground">{a.text}</p>
                <p className="text-xs text-muted-foreground">{a.time}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  </AppLayout>
);

export default Dashboard;
