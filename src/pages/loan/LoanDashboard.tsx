import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { GlassShell, GlassCard, GlassSection } from "@/components/dashboard/GlassShell";
import { MoneyRecive, DocumentText } from "iconsax-react";
import {
  CalendarClock,
  CheckCircle2,
  TrendingUp,
  ChevronRight,
  Inbox,
  PieChart as PieChartIcon,
} from "lucide-react";
import { useState, type ElementType, type ReactNode } from "react";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import { getLoanSanctions, type LoanType } from "@/api/loanSanctionApi";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { getCompanyOptions, type CompanyOption } from "@/api/bankMasterApi";
import { CompanyFilterCombo } from "@/components/CompanyFilterCombo";
import { useTheme } from "@/contexts/ThemeContext";

const ACCENT = "#22c55e";

const fmt = (n: number) =>
  "₹" + new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n);

const LOAN_TYPE_COLORS: Record<LoanType, string> = {
  "Inter-Company": "#3b82f6",
  "Bank Loan": "#0ea5e9",
  "Customer Loan": "#f59e0b",
};

interface UpcomingEmi {
  EMIId: number;
  LoanId: number;
  InstallmentNo: number;
  DueDate: string;
  EMIAmount: number;
  LoanNo: string;
  BorrowerName: string;
}

function EmptyState({ icon: Icon, message, accent }: { icon: typeof Inbox; message: string; accent: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border py-10 flex flex-col items-center gap-2.5">
      <div
        className="w-10 h-10 rounded-xl flex items-center justify-center"
        style={{ background: `${accent}14`, border: `1px solid ${accent}28` }}
      >
        <Icon size={17} style={{ color: accent }} />
      </div>
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

// ── Chart cards ──────────────────────────────────────────────────────────
// Same card chrome + recharts setup FinanceDashboard/CrmDashboard use, kept
// local to this file since none of the other module dashboards share theirs
// either — each just re-styles Pie/Line for its own data shape.
function ChartCardShell({
  title,
  icon: Icon,
  accentColor,
  isDark,
  children,
}: {
  title: string;
  icon: ElementType;
  accentColor: string;
  isDark: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{
        background: isDark ? "rgba(15,17,26,0.5)" : "rgba(255,255,255,0.72)",
        border: isDark ? "1px solid rgba(34,197,94,0.15)" : "1px solid rgba(34,197,94,0.18)",
        backdropFilter: "blur(16px) saturate(150%)",
        WebkitBackdropFilter: "blur(16px) saturate(150%)",
      }}
    >
      <div
        className="flex items-center gap-2 px-4 py-3 border-b"
        style={{ borderColor: isDark ? "rgba(34,197,94,0.15)" : "rgba(34,197,94,0.12)" }}
      >
        <div className="w-5 h-5 rounded-md flex items-center justify-center" style={{ background: `${accentColor}26` }}>
          <Icon size={11} style={{ color: accentColor }} />
        </div>
        <span className="text-xs font-heading font-semibold" style={{ color: isDark ? "#e2e8f0" : "#1e1b4b" }}>
          {title}
        </span>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

interface DonutPoint {
  name: string;
  value: number;
  color: string;
}

function LoanTypeDonut({ data, isDark }: { data: DonutPoint[]; isDark: boolean }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <ChartCardShell title="Sanctioned by Loan Type" icon={PieChartIcon} accentColor="#8b5cf6" isDark={isDark}>
      {total === 0 ? (
        <div className="text-center text-muted-foreground py-10 text-sm">No data yet</div>
      ) : (
        <div className="flex flex-col sm:flex-row items-center gap-4">
          <ResponsiveContainer width="100%" height={180}>
            <PieChart>
              <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={45} outerRadius={75} paddingAngle={2} strokeWidth={0}>
                {data.map((d, i) => (
                  <Cell key={i} fill={d.color} />
                ))}
              </Pie>
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0];
                  return (
                    <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-lg">
                      <p className="text-xs font-heading font-semibold text-foreground">{d.name}</p>
                      <p className="text-xs text-muted-foreground">{fmt(d.value as number)}</p>
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
                <span className="text-xs text-muted-foreground ml-auto sm:ml-3">{fmt(d.value)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </ChartCardShell>
  );
}

interface MonthlyPoint {
  month: string;
  Sanctioned: number;
}

function SanctionTrendCard({ data, isDark }: { data: MonthlyPoint[]; isDark: boolean }) {
  const hasData = data.some((d) => d.Sanctioned > 0);
  return (
    <ChartCardShell title="Sanctioned Amount — Last 6 Months" icon={TrendingUp} accentColor="#22c55e" isDark={isDark}>
      {!hasData ? (
        <div className="text-center text-muted-foreground py-10 text-sm">No loans sanctioned in this period</div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke={isDark ? "rgba(148,163,184,0.12)" : "rgba(100,116,139,0.15)"}
              vertical={false}
            />
            <XAxis
              dataKey="month"
              tick={{ fontSize: 10, fill: isDark ? "#94a3b8" : "#64748b" }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 10, fill: isDark ? "#94a3b8" : "#64748b" }}
              axisLine={false}
              tickLine={false}
              width={40}
              tickFormatter={(v) => (v >= 100000 ? `${(v / 100000).toFixed(1)}L` : v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v))}
            />
            <Tooltip
              formatter={(value: number) => [fmt(value), "Sanctioned"]}
              contentStyle={{
                background: isDark ? "rgba(15,17,26,0.95)" : "rgba(255,255,255,0.95)",
                border: "1px solid #22c55e30",
                borderRadius: 8,
                fontSize: 12,
              }}
            />
            <Line type="monotone" dataKey="Sanctioned" stroke="#22c55e" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </ChartCardShell>
  );
}

export default function LoanDashboard() {
  const navigate = useNavigate();
  usePageRights("loan-sanction");
  // null = "All companies" — the dashboard's default view across every
  // company's loans, not a gate the user has to clear first.
  const [companyId, setCompanyId] = useState<number | null>(null);

  const { data: companies = [] } = useQuery<CompanyOption[]>({
    queryKey: ["company-options-loan-dashboard"],
    queryFn: getCompanyOptions,
    staleTime: 5 * 60_000,
  });

  const { data: loans = [], isLoading } = useQuery({
    queryKey: ["loan-sanctions", companyId],
    queryFn: () => getLoanSanctions(companyId),
    staleTime: 30_000,
  });

  const { data: upcomingEmis = [] } = useQuery({
    queryKey: ["loan-emi-reminders", companyId],
    queryFn: () =>
      fetchWithAuth(`/api/loan-sanction/emi-reminders${companyId ? `?companyId=${companyId}` : ""}`).then((r) =>
        r.ok ? (r.json() as Promise<UpcomingEmi[]>) : [],
      ),
    staleTime: 30_000,
  });

  const totalSanctioned = loans.reduce((s, l) => s + Number(l.Amount || 0), 0);
  const activeLoans = loans.filter((l) => l.Status !== "Closed");
  const closedLoans = loans.filter((l) => l.Status === "Closed");
  const outstanding = loans.reduce((s, l) => {
    const total = l.TotalEMIs ?? 0;
    const paid = l.PaidEMIs ?? 0;
    if (!total) return s + Number(l.Amount || 0);
    return s + (Number(l.Amount || 0) * (total - paid)) / total;
  }, 0);

  const recentLoans = [...loans]
    .sort((a, b) => new Date(b.CreatedAt ?? 0).getTime() - new Date(a.CreatedAt ?? 0).getTime())
    .slice(0, 5);

  const { theme } = useTheme();
  const isDark = theme !== "light";

  const loanTypeDonutData: DonutPoint[] = (Object.keys(LOAN_TYPE_COLORS) as LoanType[])
    .map((t) => ({
      name: t,
      value: loans.filter((l) => l.LoanType === t).reduce((s, l) => s + Number(l.Amount || 0), 0),
      color: LOAN_TYPE_COLORS[t],
    }))
    .filter((d) => d.value > 0);

  // Last 6 calendar months, oldest first — sums Amount for loans sanctioned
  // (CreatedAt) within each month, from whatever's already loaded above.
  const monthlyTrendData: MonthlyPoint[] = Array.from({ length: 6 }, (_, i) => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - (5 - i));
    return d;
  }).map((monthStart) => {
    const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1);
    const sum = loans
      .filter((l) => {
        if (!l.CreatedAt) return false;
        const c = new Date(l.CreatedAt);
        return c >= monthStart && c < monthEnd;
      })
      .reduce((s, l) => s + Number(l.Amount || 0), 0);
    return { month: monthStart.toLocaleDateString("en-IN", { month: "short", year: "2-digit" }), Sanctioned: sum };
  });

  return (
    <GlassShell
      title="Loan"
      subtitle="Inter-company, bank and customer loan overview"
      icon={MoneyRecive as any}
      accentColor={ACCENT}
    >
      <Breadcrumbs items={["Dashboard", "Loan"]} />
      <div className="mb-2">
        <CompanyFilterCombo companies={companies} value={companyId} onChange={setCompanyId} />
      </div>
      {/* Stat tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <GlassCard
          label="Total Sanctioned"
          value={isLoading ? "—" : fmt(totalSanctioned)}
          sub={`${loans.length} loan${loans.length === 1 ? "" : "s"}`}
          icon={MoneyRecive as any}
          accentColor={ACCENT}
        />
        <GlassCard
          label="Outstanding"
          value={isLoading ? "—" : fmt(outstanding)}
          sub="Across active loans"
          icon={TrendingUp}
          accentColor="#f59e0b"
        />
        <GlassCard
          label="Active Loans"
          value={isLoading ? "—" : activeLoans.length}
          sub={`${closedLoans.length} closed`}
          icon={DocumentText as any}
          accentColor="#3b82f6"
        />
        <GlassCard
          label="EMIs Due Soon"
          value={upcomingEmis.length}
          sub="Within 7 days"
          icon={CalendarClock}
          accentColor={upcomingEmis.length ? "#ef4444" : "#10b981"}
        />
      </div>

      {/* Breakdown charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <LoanTypeDonut data={loanTypeDonutData} isDark={isDark} />
        <SanctionTrendCard data={monthlyTrendData} isDark={isDark} />
      </div>

      {/* Recent loans */}
      <GlassSection title="Recent Loans" icon={DocumentText as any} accentColor={ACCENT}>
        {recentLoans.length === 0 ? (
          <EmptyState icon={Inbox} message="No loans sanctioned yet." accent={ACCENT} />
        ) : (
          <div className="space-y-2">
            {recentLoans.map((l) => {
              const typeColor = LOAN_TYPE_COLORS[l.LoanType];
              const borrower = l.BorrowerCompanyName || l.BorrowerCustomerName || "—";
              const total = l.TotalEMIs ?? 0;
              const paid = l.PaidEMIs ?? 0;
              const pct = total ? Math.round((paid / total) * 100) : 0;
              const closed = l.Status === "Closed";
              return (
                <button
                  key={l.LoanId}
                  onClick={() => navigate(`/loan/sanction?view=${l.LoanId}`)}
                  className="group w-full flex items-center gap-4 rounded-xl border border-border bg-card px-4 py-3.5 text-left hover:border-transparent hover:shadow-md transition-all"
                >
                  <div
                    className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                    style={{ background: `${typeColor}16`, border: `1px solid ${typeColor}30` }}
                  >
                    <MoneyRecive size={15} style={{ color: typeColor } as any} />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-foreground font-mono">{l.LoanNo}</p>
                      <span
                        className="px-1.5 py-0.5 rounded-full text-[10px] font-medium shrink-0"
                        style={{ background: `${typeColor}16`, color: typeColor }}
                      >
                        {l.LoanType}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                      {l.LenderCompanyName} <span className="opacity-50">→</span> {borrower}
                    </p>
                  </div>

                  {total > 0 && (
                    <div className="hidden sm:flex flex-col items-center gap-1 w-24 shrink-0">
                      <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${pct}%`, background: closed ? "#9ca3af" : "#22c55e" }}
                        />
                      </div>
                      <span className="text-[10px] text-muted-foreground">
                        {paid}/{total} EMIs
                      </span>
                    </div>
                  )}

                  <div className="text-right shrink-0 w-28">
                    <p className="text-sm font-mono font-semibold text-foreground">{fmt(Number(l.Amount))}</p>
                    <span
                      className={`inline-flex items-center gap-1 text-[11px] font-medium ${
                        closed ? "text-muted-foreground" : "text-emerald-600 dark:text-emerald-400"
                      }`}
                    >
                      {closed && <CheckCircle2 size={10} />}
                      {l.Status}
                    </span>
                  </div>

                  <ChevronRight
                    size={15}
                    className="text-muted-foreground/40 group-hover:text-muted-foreground group-hover:translate-x-0.5 transition-all shrink-0"
                  />
                </button>
              );
            })}
          </div>
        )}
      </GlassSection>
    </GlassShell>
  );
}
