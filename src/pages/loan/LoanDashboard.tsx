import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { GlassShell, GlassCard, GlassSection } from "@/components/dashboard/GlassShell";
import { MoneyRecive, DocumentText } from "iconsax-react";
import {
  CalendarClock,
  CheckCircle2,
  TrendingUp,
  ChevronRight,
  PartyPopper,
  Inbox,
} from "lucide-react";
import { getLoanSanctions, type LoanType } from "@/api/loanSanctionApi";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

const ACCENT = "#22c55e";

const fmt = (n: number) =>
  "₹" + new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n);

const LOAN_TYPE_COLORS: Record<LoanType, string> = {
  "Inter-Company": "#3b82f6",
  "Intra-Company": "#22c55e",
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

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0]?.toUpperCase())
    .join("");
}

function daysUntil(dateStr: string) {
  const due = new Date(dateStr);
  const today = new Date();
  due.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);
  return Math.round((due.getTime() - today.getTime()) / 86400000);
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

export default function LoanDashboard() {
  const navigate = useNavigate();

  const { data: loans = [], isLoading } = useQuery({
    queryKey: ["loan-sanctions"],
    queryFn: getLoanSanctions,
  });

  const { data: upcomingEmis = [] } = useQuery({
    queryKey: ["loan-emi-reminders"],
    queryFn: () =>
      fetchWithAuth("/api/loan-sanction/emi-reminders").then((r) =>
        r.ok ? (r.json() as Promise<UpcomingEmi[]>) : [],
      ),
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

  return (
    <GlassShell
      title="Loan"
      subtitle="Inter-company, intra-company and customer loan overview"
      icon={MoneyRecive as any}
      accentColor={ACCENT}
    >
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

      {/* Upcoming EMIs */}
      <GlassSection title="Upcoming EMIs" icon={CalendarClock} accentColor="#ef4444">
        {upcomingEmis.length === 0 ? (
          <EmptyState icon={PartyPopper} message="Nothing due in the next 7 days — you're all caught up." accent="#22c55e" />
        ) : (
          <div className="grid sm:grid-cols-2 gap-2.5">
            {upcomingEmis.map((e) => {
              const days = daysUntil(e.DueDate);
              const overdue = days < 0;
              const today = days === 0;
              const urgencyColor = overdue ? "#ef4444" : today ? "#f97316" : "#eab308";
              const urgencyLabel = overdue ? `${Math.abs(days)}d overdue` : today ? "Due today" : `In ${days}d`;
              return (
                <button
                  key={e.EMIId}
                  onClick={() => navigate(`/loan/sanction?view=${e.LoanId}`)}
                  className="group relative flex items-center gap-3 rounded-xl border border-border bg-card px-3.5 py-3 text-left overflow-hidden hover:border-transparent hover:shadow-md transition-all"
                  style={{ boxShadow: undefined }}
                >
                  <div
                    className="absolute left-0 top-0 bottom-0 w-1"
                    style={{ background: urgencyColor }}
                  />
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-xs font-bold ml-1.5"
                    style={{ background: `${urgencyColor}16`, color: urgencyColor }}
                  >
                    {initials(e.BorrowerName || "?")}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground truncate">
                      {e.LoanNo} <span className="text-muted-foreground font-normal">· EMI {e.InstallmentNo}</span>
                    </p>
                    <p className="text-xs text-muted-foreground truncate">{e.BorrowerName}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-mono font-semibold text-foreground">{fmt(e.EMIAmount)}</p>
                    <span
                      className="inline-block mt-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-semibold"
                      style={{ background: `${urgencyColor}16`, color: urgencyColor }}
                    >
                      {urgencyLabel}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </GlassSection>

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
