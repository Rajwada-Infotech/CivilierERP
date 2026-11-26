import { useState, useEffect, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate, useParams } from "react-router-dom";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { DashboardBackground } from "@/components/DashboardBackground";
import {
  Ticket, HardHat, ChevronRight, Clock, CheckCircle2, AlertCircle,
  Loader2, RefreshCw, Building2, TrendingUp, MessageCircle,
  CalendarDays, Plus, Search, X, Bell, LifeBuoy, ArrowRight,
} from "lucide-react";
import { useReminders } from "@/hooks/useReminders";
import { formatDate } from "@/hooks/useReminders";

interface CustomerTicket {
  id: number; subject: string; description: string; status: string;
  priority: string; created_at: string; updated_at: string;
  comment_count?: number; customer_name?: string;
}
interface ConstructionUpdate {
  CUId: number; ApplicantId: string; ProjectId: string; Stage: string;
  PercentComplete: string; Description: string; UpdateDate: string;
  Status: string; SharedWith?: string;
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

// Status configuration — customer-friendly labels
const statusConfig: Record<string, { label: string; cls: string; dot: string; icon: ReactNode }> = {
  Open:       { label: "Open",        cls: "bg-blue-50 text-blue-700 border-blue-200",           dot: "bg-blue-500",    icon: <AlertCircle size={12} /> },
  Pending:    { label: "Waiting",     cls: "bg-amber-50 text-amber-700 border-amber-200",         dot: "bg-amber-500",   icon: <Clock size={12} /> },
  InProgress: { label: "Being fixed", cls: "bg-violet-50 text-violet-700 border-violet-200",     dot: "bg-violet-500",  icon: <Loader2 size={12} /> },
  Resolved:   { label: "Resolved ✓",  cls: "bg-emerald-50 text-emerald-700 border-emerald-200",  dot: "bg-emerald-500", icon: <CheckCircle2 size={12} /> },
  Closed:     { label: "Closed",      cls: "bg-slate-100 text-slate-500 border-slate-200",       dot: "bg-slate-400",   icon: <X size={12} /> },
};
const priorityBar: Record<string, string> = {
  Low: "bg-emerald-500", Medium: "bg-amber-500", High: "bg-orange-500", Critical: "bg-red-600",
};

function StatusBadge({ status }: { status: string }) {
  const cfg = statusConfig[status] ?? statusConfig.Open;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${cfg.cls}`}>
      {cfg.icon} {cfg.label}
    </span>
  );
}

function ProgressBar({ pct }: { pct: number }) {
  const c = Math.min(100, Math.max(0, pct));
  const color = c >= 75 ? "bg-emerald-500" : c >= 40 ? "bg-amber-500" : "bg-blue-500";
  return (
    <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-2 overflow-hidden">
      <div className={`h-2 rounded-full transition-all duration-700 ${color}`} style={{ width: `${c}%` }} />
    </div>
  );
}

function TicketCard({ ticket, onClick }: { ticket: CustomerTicket; onClick: () => void }) {
  const bar = priorityBar[ticket.priority] ?? "bg-slate-400";
  const cfg = statusConfig[ticket.status] ?? statusConfig.Open;
  const isActive = ["Open", "Pending", "InProgress"].includes(ticket.status);
  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-card border border-border hover:border-primary/40 hover:shadow-md transition-all group overflow-hidden flex flex-col rounded-2xl"
    >
      <div className="flex items-stretch w-full">
        {/* Priority colour strip */}
        <div className={`w-1 shrink-0 ${bar}`} />
        <div className="flex-1 px-4 py-4 min-w-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              {/* Ticket number + subject */}
              <div className="flex items-center gap-2 mb-2">
                <span className="font-mono text-xs text-muted-foreground/70 shrink-0">#{ticket.id}</span>
                <h3 className="text-sm font-semibold text-foreground leading-snug line-clamp-2">{ticket.subject}</h3>
              </div>
              {/* Status dot + text in plain language */}
              <div className="flex items-center gap-1.5 mb-2">
                <span className={`w-2 h-2 rounded-full ${cfg.dot}`} />
                <span className="text-xs text-muted-foreground font-medium">{cfg.label}</span>
              </div>
              <div className="flex items-center gap-4 flex-wrap">
                <span className="flex items-center gap-1 text-xs text-muted-foreground/80">
                  <CalendarDays size={12} /> {fmtDate(ticket.created_at)}
                </span>
                {(ticket.comment_count ?? 0) > 0 && (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground/80">
                    <MessageCircle size={12} /> {ticket.comment_count} {ticket.comment_count === 1 ? "reply" : "replies"}
                  </span>
                )}
              </div>
            </div>
            <div className="flex flex-col items-end gap-2 shrink-0">
              <StatusBadge status={ticket.status} />
              {isActive && (
                <span className="text-xs text-primary font-medium flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  View <ChevronRight size={12} />
                </span>
              )}
            </div>
          </div>
          {ticket.description && (
            <p className="mt-2 text-xs text-muted-foreground/70 line-clamp-1 leading-relaxed">{ticket.description}</p>
          )}
        </div>
      </div>
    </button>
  );
}

function UpdateCard({ update }: { update: ConstructionUpdate }) {
  const pct = parseFloat(update.PercentComplete) || 0;
  const pctColor = pct >= 75 ? "text-emerald-600" : pct >= 40 ? "text-amber-600" : "text-blue-600";
  return (
    <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-foreground">{update.Stage || "Update"}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{fmtDate(update.UpdateDate)}</p>
        </div>
        <span className={`text-lg font-bold tabular-nums ${pctColor}`}>{pct.toFixed(0)}%</span>
      </div>
      <ProgressBar pct={pct} />
      {update.Description && <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">{update.Description}</p>}
    </div>
  );
}

function ReminderRow({ item }: { item: { id: string | number; title: string; subtitle: string; dueDate: string; urgency: string; amount?: number } }) {
  const bg: Record<string, string> = {
    overdue: "bg-red-50 border-red-200 dark:bg-red-950 dark:border-red-800",
    today:   "bg-amber-50 border-amber-200 dark:bg-amber-950 dark:border-amber-800",
    soon:    "bg-blue-50 border-blue-200 dark:bg-blue-950 dark:border-blue-800",
    upcoming:"bg-card border-border",
  };
  const dot: Record<string, string> = { overdue: "bg-red-500", today: "bg-amber-500", soon: "bg-blue-500", upcoming: "bg-slate-400 dark:bg-slate-500" };
  return (
    <div className={`rounded-2xl border px-4 py-3.5 flex items-center gap-3 ${bg[item.urgency] ?? bg.upcoming}`}>
      <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${dot[item.urgency] ?? "bg-slate-400"}`} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-foreground truncate">{item.title}</p>
        <p className="text-xs text-muted-foreground truncate mt-0.5">{item.subtitle}</p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-xs text-muted-foreground">{formatDate(item.dueDate)}</p>
        {item.amount != null && <p className="text-sm font-bold text-foreground mt-0.5">₹{item.amount.toLocaleString("en-IN")}</p>}
      </div>
    </div>
  );
}

type Tab = "tickets" | "progress" | "reminders";
type StatusFilter = "All" | "Open" | "Pending" | "InProgress" | "Resolved" | "Closed";

export default function CustomerPortal() {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const { userId } = useParams<{ userId: string }>();

  // Redirect if userId param does not match the logged-in user
  useEffect(() => {
    if (currentUser?.id && (!userId || userId !== String(currentUser.id))) {
      navigate(`/customer-portal/${currentUser.id}`, { replace: true });
    }
  }, [userId, currentUser?.id, navigate]);

  const [tab, setTab] = useState<Tab>("tickets");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("All");
  const [search, setSearch] = useState("");

  const firstName = currentUser?.name?.split(" ")[0] ?? "there";
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  const { data: ticketsData, isLoading: ticketsLoading, isError: ticketsError, refetch: refetchTickets } =
    useQuery<CustomerTicket[]>({
      queryKey: ["customer-tickets"],
      queryFn: async () => {
        const res = await fetchWithAuth("/api/tickets/my");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json().catch(() => ({}));
      },
      staleTime: 60_000,
      refetchInterval: 2 * 60_000,
    });

  const { data: updatesData, isLoading: updatesLoading } =
    useQuery<{ data: ConstructionUpdate[] }>({
      queryKey: ["customer-construction-updates", tab],
      queryFn: async () => {
        const res = await fetchWithAuth("/api/followup-construction-updates?pageSize=50");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json().catch(() => ({}));
      },
      staleTime: 5 * 60_000,
      enabled: tab === "progress",
    });

  const { reminders, loading: remindersLoading, refresh: refreshReminders } = useReminders({ pollingInterval: 0 });

  const allTickets: CustomerTicket[] = ticketsData ?? [];
  const filtered = allTickets.filter((t) => {
    const matchStatus = statusFilter === "All" || t.status === statusFilter;
    const matchSearch = !search || t.subject.toLowerCase().includes(search.toLowerCase());
    return matchStatus && matchSearch;
  });

  const openCount     = allTickets.filter((t) => ["Open", "Pending", "InProgress"].includes(t.status)).length;
  const resolvedCount = allTickets.filter((t) => ["Resolved", "Closed"].includes(t.status)).length;
  const updates       = updatesData?.data ?? [];

  // Reminders by urgency
  const overdueReminders = reminders.filter((r) => r.urgency === "overdue");

  const tabs: { id: Tab; label: string; icon: ReactNode; count?: number }[] = [
    { id: "tickets",   label: "My Tickets",    icon: <Ticket size={15} />,    count: openCount > 0 ? openCount : undefined },
    { id: "progress",  label: "Construction",  icon: <HardHat size={15} /> },
    { id: "reminders", label: "Payments",      icon: <Bell size={15} />,      count: overdueReminders.length > 0 ? overdueReminders.length : undefined },
  ];

  return (
    <div className="min-h-screen bg-background">
      <DashboardBackground />
      <div className="relative z-10 max-w-2xl mx-auto px-4 py-6 space-y-5">

        {/* ── Welcome hero ── */}
        <div className="rounded-3xl overflow-hidden relative" style={{ background: "linear-gradient(135deg, #1E0B42 0%, #4C1D95 100%)" }}>
          <div className="absolute inset-0 opacity-20" style={{ backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.08) 1px, transparent 1px)", backgroundSize: "20px 20px" }} />
          <div className="relative px-5 py-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold tracking-widest uppercase" style={{ color: "rgba(201,162,39,0.85)" }}>{greeting}</p>
                <h1 className="text-2xl font-bold text-white mt-1 leading-tight">{firstName} 👋</h1>
                <p className="text-sm mt-1.5 leading-relaxed" style={{ color: "rgba(255,255,255,0.65)" }}>
                  Track your support tickets, construction progress and payment schedule — all in one place.
                </p>
              </div>
              <button
                onClick={() => navigate("/ticket/create")}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold whitespace-nowrap shrink-0 transition-opacity hover:opacity-90 active:scale-95"
                style={{ background: "rgba(201,162,39,1)", color: "#1E0B42" }}
              >
                <Plus size={14} /> New Ticket
              </button>
            </div>

            {/* Summary row inside hero */}
            <div className="grid grid-cols-3 gap-2 mt-4">
              {[
                { label: "Active",   value: openCount,         color: openCount > 0 ? "text-amber-300" : "text-white" },
                { label: "Resolved", value: resolvedCount,     color: "text-emerald-300" },
                { label: "Total",    value: allTickets.length, color: "text-white" },
              ].map((s) => (
                <div key={s.label} className="rounded-xl px-3 py-2.5 text-center" style={{ background: "rgba(255,255,255,0.08)" }}>
                  <p className={`text-xl font-bold tabular-nums ${s.color}`}>{s.value}</p>
                  <p className="text-[0.625rem] font-semibold uppercase tracking-wide mt-0.5" style={{ color: "rgba(255,255,255,0.5)" }}>{s.label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Overdue reminders callout — if any */}
        {overdueReminders.length > 0 && (
          <button
            onClick={() => setTab("reminders")}
            className="w-full flex items-center gap-3 rounded-2xl px-4 py-3.5 text-left border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 hover:shadow-sm transition-shadow"
          >
            <AlertCircle size={18} className="text-red-500 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-red-700 dark:text-red-300">
                {overdueReminders.length} payment{overdueReminders.length > 1 ? "s" : ""} overdue
              </p>
              <p className="text-xs text-red-600/70 dark:text-red-400/70 mt-0.5">Tap to see payment schedule</p>
            </div>
            <ArrowRight size={15} className="text-red-400 shrink-0" />
          </button>
        )}

        {/* ── Tabs ── */}
        <div className="flex gap-1.5 p-1.5 rounded-2xl border border-border bg-muted/20">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-2.5 rounded-xl text-sm font-semibold transition-all relative ${
                tab === t.id
                  ? "bg-background text-foreground shadow-sm border border-border/40"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
              }`}
            >
              {t.icon}
              <span className="hidden sm:inline">{t.label}</span>
              <span className="sm:hidden text-xs">{t.label.split(" ")[0]}</span>
              {!!t.count && (
                <span className="absolute -top-1.5 -right-1 text-[0.5625rem] font-bold rounded-full min-w-[16px] h-[16px] flex items-center justify-center px-0.5 bg-primary text-primary-foreground">
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* ── Tickets tab ── */}
        {tab === "tickets" && (
          <div className="space-y-3">
            {/* Search + filter */}
            <div className="space-y-2">
              <div className="relative">
                <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search your tickets…"
                  className="w-full pl-9 pr-9 py-2.5 text-sm bg-card border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                />
                {search && (
                  <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    <X size={14} />
                  </button>
                )}
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {(["All", "Open", "Pending", "InProgress", "Resolved", "Closed"] as StatusFilter[]).map((s) => {
                  const isActive = statusFilter === s;
                  const count = s === "All" ? allTickets.length : allTickets.filter((t) => t.status === s).length;
                  if (s !== "All" && count === 0) return null;
                  return (
                    <button
                      key={s}
                      onClick={() => setStatusFilter(s)}
                      className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors ${
                        isActive
                          ? "bg-foreground text-background border-foreground"
                          : "bg-card text-muted-foreground border-border hover:border-foreground/30"
                      }`}
                    >
                      {s === "InProgress" ? "Being Fixed" : s} {count > 0 && `(${count})`}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Ticket list */}
            {ticketsLoading ? (
              <div className="flex items-center justify-center py-16 gap-2 text-muted-foreground">
                <Loader2 size={16} className="animate-spin" /> Loading your tickets…
              </div>
            ) : ticketsError ? (
              <div className="flex flex-col items-center gap-3 py-16 text-center rounded-2xl border border-dashed border-border">
                <AlertCircle size={28} className="text-destructive" />
                <div>
                  <p className="text-sm font-semibold text-foreground">Couldn't load tickets</p>
                  <p className="text-xs text-muted-foreground mt-1">Please check your connection and try again.</p>
                </div>
                <button onClick={() => refetchTickets()} className="flex items-center gap-1.5 text-xs text-primary hover:underline font-medium">
                  <RefreshCw size={12} /> Try again
                </button>
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center gap-4 py-16 text-center rounded-2xl border border-dashed border-border bg-card">
                <div className="w-14 h-14 rounded-full bg-primary/8 flex items-center justify-center">
                  <LifeBuoy size={26} className="text-primary/50" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    {search || statusFilter !== "All" ? "No matching tickets" : "You have no tickets yet"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1.5 max-w-xs mx-auto leading-relaxed">
                    {search || statusFilter !== "All"
                      ? "Try clearing your filters to see all tickets."
                      : "Need help? Raise a ticket and our team will get back to you within 24 hours."}
                  </p>
                </div>
                {!search && statusFilter === "All" && (
                  <button
                    onClick={() => navigate("/ticket/create")}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 transition-opacity"
                  >
                    <Plus size={15} /> Raise a Ticket
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {filtered.map((t) => (
                  <TicketCard key={t.id} ticket={t} onClick={() => navigate("/ticket/my-tickets")} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Construction progress tab ── */}
        {tab === "progress" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-foreground">Construction Progress</h2>
                <p className="text-xs text-muted-foreground mt-0.5">Floor-wise updates as your home is built</p>
              </div>
              <Building2 size={18} className="text-muted-foreground/40" />
            </div>
            {updatesLoading ? (
              <div className="flex items-center justify-center py-16 gap-2 text-muted-foreground">
                <Loader2 size={16} className="animate-spin" /> Loading updates…
              </div>
            ) : updates.length === 0 ? (
              <div className="flex flex-col items-center gap-4 py-16 text-center rounded-2xl border border-dashed border-border bg-card">
                <div className="w-14 h-14 rounded-full bg-primary/8 flex items-center justify-center">
                  <HardHat size={26} className="text-primary/50" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">No updates yet</p>
                  <p className="text-xs text-muted-foreground mt-1.5 max-w-xs mx-auto leading-relaxed">
                    Construction updates will appear here as work progresses. Check back soon!
                  </p>
                </div>
              </div>
            ) : (
              <>
                {/* Overall progress summary */}
                {(() => {
                  const avg = updates.reduce((a, u) => a + (parseFloat(u.PercentComplete) || 0), 0) / updates.length;
                  const color = avg >= 75 ? "text-emerald-600" : avg >= 40 ? "text-amber-600" : "text-blue-600";
                  return (
                    <div className="rounded-2xl border border-border bg-card p-5">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <TrendingUp size={18} className="text-primary" />
                          <p className="text-sm font-semibold text-foreground">Overall Progress</p>
                        </div>
                        <span className={`text-2xl font-bold tabular-nums ${color}`}>{avg.toFixed(0)}%</span>
                      </div>
                      <ProgressBar pct={avg} />
                      <p className="text-xs text-muted-foreground mt-2.5">
                        {updates.length} update{updates.length !== 1 ? "s" : ""} recorded
                      </p>
                    </div>
                  );
                })()}
                <div className="space-y-2.5">
                  {updates.map((u) => <UpdateCard key={u.CUId} update={u} />)}
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Reminders / payments tab ── */}
        {tab === "reminders" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-foreground">Payment Schedule</h2>
                <p className="text-xs text-muted-foreground mt-0.5">EMIs, payment milestones and upcoming dues</p>
              </div>
              <button onClick={() => refreshReminders(true)} className="p-2 rounded-xl hover:bg-muted transition-colors text-muted-foreground" aria-label="Refresh">
                <RefreshCw size={14} />
              </button>
            </div>
            {remindersLoading ? (
              <div className="flex items-center justify-center py-16 gap-2 text-muted-foreground">
                <Loader2 size={16} className="animate-spin" /> Loading…
              </div>
            ) : reminders.length === 0 ? (
              <div className="flex flex-col items-center gap-4 py-16 text-center rounded-2xl border border-dashed border-border bg-card">
                <div className="w-14 h-14 rounded-full bg-emerald-50 dark:bg-emerald-950 flex items-center justify-center">
                  <CheckCircle2 size={26} className="text-emerald-500" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">All caught up! 🎉</p>
                  <p className="text-xs text-muted-foreground mt-1.5">No pending payments right now. Great work!</p>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {reminders.map((r) => <ReminderRow key={r.id} item={r} />)}
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <p className="text-center text-xs text-muted-foreground/50 pb-4">
          Civilier Home · For support, raise a ticket above
        </p>
      </div>
    </div>
  );
}
