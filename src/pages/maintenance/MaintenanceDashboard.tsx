import React from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer, LineChart, Line,
  CartesianGrid, XAxis, YAxis, Legend,
} from "recharts";
import { Wrench, Users, Receipt, ListChecks, Wallet, BarChart3, TrendingUp } from "lucide-react";
import { GlassCard, GlassSection } from "@/components/dashboard/GlassShell";
import { MaintenanceShell, MAINTENANCE_ACCENT as ACCENT } from "@/components/maintenance/MaintenanceShell";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { useTheme } from "@/contexts/ThemeContext";
import { getMaintenanceDirectory } from "@/api/maintenanceApi";
import { getActiveChargeHeads } from "@/api/chargeHeadApi";
import { getMaintenanceBills } from "@/api/maintenanceBillApi";

const fmt = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

// ─── Donut / trend chart cards — same visual language as Material/Finance
// dashboards (DonutCard/TrendCard there), themed to this module's accent. ──
interface DonutPoint { name: string; value: number; color: string; }

function DonutCard({
  title, icon: Icon, data, isDark, formatValue = (n) => `${n}`,
}: {
  title: string; icon: React.ElementType; data: DonutPoint[]; isDark: boolean;
  formatValue?: (n: number) => string;
}) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const glassStyle: React.CSSProperties = {
    background: isDark ? "rgba(10,15,8,0.45)" : "rgba(255,255,255,0.72)",
    border: isDark ? `1px solid ${ACCENT}26` : `1px solid ${ACCENT}30`,
    backdropFilter: "blur(16px) saturate(150%)",
    WebkitBackdropFilter: "blur(16px) saturate(150%)",
  };
  return (
    <div className="rounded-xl overflow-hidden" style={glassStyle}>
      <div className="flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor: `${ACCENT}20` }}>
        <div className="w-5 h-5 rounded-md flex items-center justify-center" style={{ background: `${ACCENT}26` }}>
          <Icon size={11} style={{ color: ACCENT }} />
        </div>
        <span className="text-xs font-heading font-semibold text-foreground">{title}</span>
      </div>
      <div className="p-4">
        {total === 0 ? (
          <div className="text-center text-muted-foreground py-10 text-sm">No data yet</div>
        ) : (
          <div className="flex flex-col sm:flex-row items-center gap-4">
            <ResponsiveContainer width="100%" height={180}>
              <PieChart>
                <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={45} outerRadius={75} paddingAngle={2} strokeWidth={0}>
                  {data.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Pie>
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0];
                    return (
                      <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-lg">
                        <p className="text-xs font-heading font-semibold text-foreground">{d.name}</p>
                        <p className="text-xs text-muted-foreground">{formatValue(d.value as number)}</p>
                      </div>
                    );
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="space-y-2 w-full sm:w-auto shrink-0">
              {data.map((d) => (
                <div key={d.name} className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: d.color }} />
                  <span className="text-xs text-foreground whitespace-nowrap">{d.name}</span>
                  <span className="text-xs text-muted-foreground ml-auto sm:ml-3">{formatValue(d.value)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TrendCard({
  title, icon: Icon, data, isDark,
}: {
  title: string; icon: React.ElementType;
  data: { date: string; amount: number }[]; isDark: boolean;
}) {
  const hasData = data.some((d) => d.amount > 0);
  const glassStyle: React.CSSProperties = {
    background: isDark ? "rgba(10,15,8,0.45)" : "rgba(255,255,255,0.72)",
    border: isDark ? `1px solid ${ACCENT}26` : `1px solid ${ACCENT}30`,
    backdropFilter: "blur(16px) saturate(150%)",
    WebkitBackdropFilter: "blur(16px) saturate(150%)",
  };
  return (
    <div className="rounded-xl overflow-hidden" style={glassStyle}>
      <div className="flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor: `${ACCENT}20` }}>
        <div className="w-5 h-5 rounded-md flex items-center justify-center" style={{ background: `${ACCENT}26` }}>
          <Icon size={11} style={{ color: ACCENT }} />
        </div>
        <span className="text-xs font-heading font-semibold text-foreground">{title}</span>
      </div>
      <div className="p-4">
        {!hasData ? (
          <div className="text-center text-muted-foreground py-10 text-sm">No billing activity in the last 14 days</div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={isDark ? "rgba(148,163,184,0.12)" : "rgba(100,116,139,0.15)"} vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={(d) => new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                tick={{ fontSize: 10, fill: isDark ? "#94a3b8" : "#64748b" }}
                axisLine={false} tickLine={false}
                interval={Math.max(0, Math.floor(data.length / 6) - 1)}
              />
              <YAxis
                tick={{ fontSize: 10, fill: isDark ? "#94a3b8" : "#64748b" }}
                axisLine={false} tickLine={false} width={40}
                tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v))}
              />
              <Tooltip
                labelFormatter={(d) => new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                formatter={(value: number) => [fmt(value), "Billed Amount"]}
                contentStyle={{
                  background: isDark ? "rgba(15,17,26,0.95)" : "rgba(255,255,255,0.95)",
                  border: `1px solid ${ACCENT}30`, borderRadius: 8, fontSize: 12,
                }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={8} />
              <Line type="monotone" dataKey="amount" name="Billed Amount" stroke={ACCENT} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

// Requests/schedules/work-orders still have no data model — no tile for
// those yet. Everything shown here is real, pulled from the Customer
// Directory, Charge Head master, and Bills already built for this module.
export default function MaintenanceDashboard() {
  usePageRights("maintenance-dashboard");
  const navigate = useNavigate();
  const { theme } = useTheme();
  const isDark = theme !== "light";

  const { data: directory, isLoading: directoryLoading } = useQuery({
    queryKey: ["maintenance-directory", ""],
    queryFn: () => getMaintenanceDirectory(""),
    staleTime: 60 * 1000,
  });
  const { data: chargeHeads, isLoading: chargeHeadsLoading } = useQuery({
    queryKey: ["charge-heads", "active"],
    queryFn: getActiveChargeHeads,
    staleTime: 60 * 1000,
  });
  const { data: bills, isLoading: billsLoading } = useQuery({
    queryKey: ["maintenance-bills", {}],
    queryFn: () => getMaintenanceBills(),
    staleTime: 60 * 1000,
  });

  const directoryRows = Array.isArray(directory) ? directory : [];
  const chargeHeadRows = chargeHeads || [];
  const billRows = Array.isArray(bills) ? bills : [];
  const activeBills = billRows.filter((b) => b.Status === "Active");
  const cancelledBills = billRows.filter((b) => b.Status === "Cancelled");
  const totalBilled = activeBills.reduce((s, b) => s + (Number(b.GrandTotal) || 0), 0);

  const billedCustomerCount = new Set(activeBills.map((b) => b.BookingId)).size;
  const unbilledCustomerCount = Math.max(0, directoryRows.length - billedCustomerCount);

  // Last 14 days of billing activity, by Bill Date.
  const trendData = React.useMemo(() => {
    const days: { date: string; amount: number }[] = [];
    const byDate = new Map<string, number>();
    activeBills.forEach((b) => {
      if (!b.BillDate) return;
      const key = b.BillDate.slice(0, 10);
      byDate.set(key, (byDate.get(key) || 0) + (Number(b.GrandTotal) || 0));
    });
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      days.push({ date: key, amount: byDate.get(key) || 0 });
    }
    return days;
  }, [activeBills]);

  return (
    <MaintenanceShell
      title="Maintenance"
      subtitle="Upkeep, repairs & servicing"
      icon={Wrench}
    >
      <Breadcrumbs items={["Dashboard", "Maintenance"]} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <GlassCard
          label="Confirmed Customers"
          value={directoryLoading ? "…" : directoryRows.length}
          icon={Users}
          accentColor={ACCENT}
          onClick={() => navigate("/maintenance/directory")}
        />
        <GlassCard
          label="Active Charge Heads"
          value={chargeHeadsLoading ? "…" : chargeHeadRows.length}
          icon={ListChecks}
          accentColor="#0ea5e9"
          onClick={() => navigate("/masters/charge-head")}
        />
        <GlassCard
          label="Bills Issued"
          value={billsLoading ? "…" : activeBills.length}
          icon={Receipt}
          accentColor="#f59e0b"
          onClick={() => navigate("/maintenance/bills")}
        />
        <GlassCard
          label="Total Billed"
          value={billsLoading ? "…" : fmt(totalBilled)}
          icon={Wallet}
          accentColor="#22c55e"
          onClick={() => navigate("/maintenance/bills")}
        />
      </div>

      <GlassSection title="Breakdown" icon={BarChart3} accentColor={ACCENT}>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <DonutCard
            title="Bill Status"
            icon={Receipt}
            isDark={isDark}
            data={[
              { name: "Active", value: activeBills.length, color: ACCENT },
              { name: "Cancelled", value: cancelledBills.length, color: "#ef4444" },
            ]}
          />
          <DonutCard
            title="Billed vs Unbilled Customers"
            icon={Users}
            isDark={isDark}
            data={[
              { name: "Billed", value: billedCustomerCount, color: ACCENT },
              { name: "Not Yet Billed", value: unbilledCustomerCount, color: "#94a3b8" },
            ]}
          />
        </div>
        <div className="mt-4">
          <TrendCard title="Billing Amount — Last 14 Days" icon={TrendingUp} isDark={isDark} data={trendData} />
        </div>
      </GlassSection>
    </MaintenanceShell>
  );
}
