import React, { useMemo } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import {
  HardHat, ShoppingCart, Landmark, Receipt, TrendingUp, Users,
  CheckCircle2, Clock, AlertCircle, ArrowRight, Circle,
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { useTask } from "@/contexts/TaskContext";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";

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
  { label: "Total Contractors", value: "24",        icon: HardHat,      color: "hsl(239, 84%, 67%)" },
  { label: "Active Suppliers",  value: "18",        icon: ShoppingCart, color: "hsl(263, 70%, 58%)" },
  { label: "Bank Accounts",     value: "6",         icon: Landmark,     color: "hsl(217, 91%, 60%)" },
  { label: "Monthly Expenses",  value: "₹4,82,000", icon: Receipt,      color: "hsl(174, 72%, 46%)" },
];

const STATUS_DOT: Record<string, string> = {
  open:        "bg-blue-400",
  in_progress: "bg-yellow-400",
  closed:      "bg-purple-400",
  reviewed:    "bg-green-400",
};

const tooltipStyle = {
  background: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: 8,
  color: "hsl(var(--foreground))",
};

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

const Dashboard = () => {
  const { tasks, getOverdueTasks, getDueSoonTasks } = useTask();
  const { currentUser } = useAuth();
  const navigate = useNavigate();

  const myTasks = useMemo(() => {
    if (!currentUser) return [];
    if (currentUser.role === "super_admin" || currentUser.role === "admin") return tasks;
    return tasks.filter(t => t.assignedTo === currentUser.id || t.createdBy === currentUser.id);
  }, [tasks, currentUser]);

  const overdueTasks = getOverdueTasks();
  const dueSoonTasks = getDueSoonTasks();
  const openTasks = myTasks.filter(t => t.status === "open" || t.status === "in_progress");
  const pendingReview = myTasks.filter(t => t.status === "closed");

  return (
    <AppLayout>
      <Breadcrumbs items={["Dashboard"]} />
      <div className="mb-6">
        <h1 className="text-2xl font-heading font-bold text-foreground">Welcome to CivilierERP</h1>
        <p className="text-sm text-muted-foreground mt-1">Your civil ERP command center</p>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl bg-card border border-border p-4 flex items-center gap-4" style={{ borderLeftWidth: 3, borderLeftColor: s.color }}>
            <div className="p-2 rounded-lg" style={{ background: `${s.color}20` }}>
              <s.icon size={22} style={{ color: s.color }} />
            </div>
            <div>
              <p className="text-xs text-muted-foreground font-heading">{s.label}</p>
              <p className="text-lg sm:text-xl font-heading font-bold text-foreground">{s.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Chart + Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
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

      {/* My Tasks Summary */}
      <div className="rounded-xl bg-card border border-border p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={18} className="text-primary" />
            <h2 className="font-heading font-semibold text-foreground">My Tasks</h2>
          </div>
          <button
            onClick={() => navigate("/tasks")}
            className="flex items-center gap-1 text-xs text-primary hover:underline font-heading"
          >
            View all <ArrowRight size={12} />
          </button>
        </div>

        {/* Task stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          {[
            { label: "Open / In Progress", value: openTasks.length,     color: "hsl(var(--primary))",   icon: Circle },
            { label: "Overdue",            value: overdueTasks.length,  color: "hsl(0,72%,51%)",        icon: AlertCircle },
            { label: "Due Within 48h",     value: dueSoonTasks.length,  color: "hsl(38,92%,50%)",       icon: Clock },
            { label: "Pending Review",     value: pendingReview.length, color: "hsl(263,70%,58%)",      icon: CheckCircle2 },
          ].map((s) => (
            <div
              key={s.label}
              className="rounded-lg bg-muted/40 p-3 text-center cursor-pointer hover:bg-muted/70 transition-colors"
              style={{ borderTop: `2px solid ${s.color}` }}
              onClick={() => navigate("/tasks")}
            >
              <p className="text-lg sm:text-xl font-heading font-bold text-foreground">{s.value}</p>
              <p className="text-xs text-muted-foreground font-heading mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Task list preview */}
        {myTasks.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">No tasks assigned to you.</p>
        ) : (
          <div className="divide-y divide-border">
            {myTasks.slice(0, 4).map((task) => (
              <div
                key={task.id}
                onClick={() => navigate(`/tasks/${task.id}`)}
                className="flex items-center gap-3 py-2.5 cursor-pointer hover:opacity-75 transition-opacity"
              >
                <div className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[task.status] || "bg-muted"}`} />
                <p className="text-sm text-foreground flex-1 truncate font-heading">{task.title}</p>
                <p className="text-xs text-muted-foreground shrink-0">
                  {new Date(task.dueDate) < new Date() && (task.status === "open" || task.status === "in_progress")
                    ? <span className="text-red-400">Overdue</span>
                    : new Date(task.dueDate).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                </p>
                <ArrowRight size={13} className="text-muted-foreground shrink-0" />
              </div>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
};

export default Dashboard;
