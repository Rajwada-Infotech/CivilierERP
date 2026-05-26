import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { DashboardBackground } from "@/components/DashboardBackground";
import {
  Ticket, HardHat, ChevronRight, Clock, CheckCircle2, AlertCircle,
  Loader2, RefreshCw, Building2, TrendingUp, MessageCircle,
  CalendarDays, Plus, Search, X, Bell,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
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

const statusConfig: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
  Open:       { label: "Open",      cls: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800",     icon: <AlertCircle size={10} /> },
  Pending:    { label: "Pending",   cls: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800", icon: <Clock size={10} /> },
  InProgress: { label: "Resolving", cls: "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:border-violet-800", icon: <Loader2 size={10} /> },
  Resolved:   { label: "Resolved",  cls: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800", icon: <CheckCircle2 size={10} /> },
  Closed:     { label: "Closed",    cls: "bg-muted text-muted-foreground border-border", icon: <X size={10} /> },
};
const priorityBar: Record<string, string> = {
  Low: "bg-emerald-400", Medium: "bg-amber-400", High: "bg-orange-500", Critical: "bg-red-600",
};

function StatusBadge({ status }: { status: string }) {
  const cfg = statusConfig[status] ?? statusConfig.Open;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium border ${cfg.cls}`}>
      {cfg.icon} {cfg.label}
    </span>
  );
}

function ProgressBar({ pct }: { pct: number }) {
  const c = Math.min(100, Math.max(0, pct));
  const color = c >= 75 ? "bg-emerald-500" : c >= 40 ? "bg-amber-500" : "bg-blue-500";
  return (
    <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
      <div className={`h-2 rounded-full transition-all duration-700 ${color}`} style={{ width: `${c}%` }} />
    </div>
  );
}

function TicketCard({ ticket, onClick }: { ticket: CustomerTicket; onClick: () => void }) {
  const bar = priorityBar[ticket.priority] ?? "bg-muted";
  return (
    <button onClick={onClick} className="w-full text-left rounded-xl border border-border bg-card hover:border-primary/30 hover:shadow-md transition-all group overflow-hidden">
      <div className="flex items-stretch">
        <div className={`w-1 shrink-0 ${bar}`} />
        <div className="flex-1 px-4 py-3.5 min-w-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-mono text-[10px] text-muted-foreground/60">#{ticket.id}</span>
                <h3 className="text-sm font-semibold text-foreground leading-snug truncate">{ticket.subject}</h3>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <span className="flex items-center gap-1 text-[11px] text-muted-foreground"><CalendarDays size={10} /> {fmtDate(ticket.created_at)}</span>
                {(ticket.comment_count ?? 0) > 0 && (
                  <span className="flex items-center gap-1 text-[11px] text-muted-foreground"><MessageCircle size={10} /> {ticket.comment_count} replies</span>
                )}
              </div>
              {ticket.description && <p className="mt-1.5 text-[11px] text-muted-foreground line-clamp-1">{ticket.description}</p>}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <StatusBadge status={ticket.status} />
              <ChevronRight size={14} className="text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" />
            </div>
          </div>
        </div>
      </div>
    </button>
  );
}

function UpdateCard({ update }: { update: ConstructionUpdate }) {
  const pct = parseFloat(update.PercentComplete) || 0;
  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold text-foreground">{update.Stage || "Update"}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">{fmtDate(update.UpdateDate)}</p>
        </div>
        <span className={`text-xs font-bold tabular-nums ${pct >= 75 ? "text-emerald-600" : pct >= 40 ? "text-amber-600" : "text-blue-600"}`}>{pct.toFixed(0)}%</span>
      </div>
      <ProgressBar pct={pct} />
      {update.Description && <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-2">{update.Description}</p>}
    </div>
  );
}

function ReminderRow({ item }: { item: { id: string | number; title: string; subtitle: string; dueDate: string; urgency: string; amount?: number } }) {
  const bg: Record<string, string> = {
    overdue: "bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-900",
    today:   "bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-900",
    soon:    "bg-blue-50 border-blue-200 dark:bg-blue-950/30 dark:border-blue-900",
    upcoming:"bg-card border-border",
  };
  const dot: Record<string, string> = { overdue: "bg-red-500", today: "bg-amber-500", soon: "bg-blue-500", upcoming: "bg-muted-foreground" };
  return (
    <div className={`rounded-lg border px-3 py-2.5 flex items-center gap-3 ${bg[item.urgency] ?? bg.upcoming}`}>
      <span className={`w-2 h-2 rounded-full shrink-0 ${dot[item.urgency] ?? "bg-muted-foreground"}`} />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-foreground truncate">{item.title}</p>
        <p className="text-[11px] text-muted-foreground truncate">{item.subtitle}</p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-[11px] text-muted-foreground">{formatDate(item.dueDate)}</p>
        {item.amount != null && <p className="text-[11px] font-semibold text-foreground">?{item.amount.toLocaleString("en-IN")}</p>}
      </div>
    </div>
  );
}

type Tab = "tickets" | "progress" | "reminders";
type StatusFilter = "All" | "Open" | "Pending" | "InProgress" | "Resolved" | "Closed";

export default function CustomerPortal() {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("tickets");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("All");
  const [search, setSearch] = useState("");

  const firstName = currentUser?.name?.split(" ")[0] ?? "there";
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  const { data: ticketsData, isLoading: ticketsLoading, isError: ticketsError, refetch: refetchTickets } =
    useQuery<{ tickets: CustomerTicket[]; total: number }>({
      queryKey: ["customer-tickets"],
      queryFn: async () => {
        const res = await fetchWithAuth("/api/tickets/my");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      },
      staleTime: 60_000,
      refetchInterval: 2 * 60_000,
    });

  const { data: updatesData, isLoading: updatesLoading } =
    useQuery<{ data: ConstructionUpdate[] }>({
      queryKey: ["customer-construction-updates"],
      queryFn: async () => {
        const res = await fetchWithAuth("/api/followup-construction-updates?pageSize=50");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      },
      staleTime: 5 * 60_000,
      enabled: tab === "progress",
    });

  const { reminders, loading: remindersLoading, refresh: refreshReminders } = useReminders({ pollingInterval: 0 });

  const allTickets: CustomerTicket[] = ticketsData?.tickets ?? [];
  const filtered = allTickets.filter((t) => {
    const matchStatus = statusFilter === "All" || t.status === statusFilter;
    const matchSearch = !search || t.subject.toLowerCase().includes(search.toLowerCase());
    return matchStatus && matchSearch;
  });

  const openCount     = allTickets.filter((t) => ["Open","Pending","InProgress"].includes(t.status)).length;
  const resolvedCount = allTickets.filter((t) => ["Resolved","Closed"].includes(t.status)).length;
  const updates       = updatesData?.data ?? [];

  const tabs = [
    { id: "tickets"   as Tab, label: "My Tickets",      icon: <Ticket size={14} /> },
    { id: "progress"  as Tab, label: "Project Progress", icon: <HardHat size={14} /> },
    { id: "reminders" as Tab, label: "Reminders",        icon: <Bell size={14} /> },
  ];

  return (
    <div className="min-h-screen bg-background">
      <DashboardBackground />
      <div className="relative z-10 max-w-3xl mx-auto px-4 py-6 space-y-6">

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs text-muted-foreground">{greeting},</p>
            <h1 className="text-xl font-bold text-foreground">{firstName}</h1>
            <p className="text-xs text-muted-foreground mt-0.5">Customer Portal</p>
          </div>
          <button
            onClick={() => navigate("/ticket/create")}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors shadow-sm"
          >
            <Plus size={13} /> New Ticket
          </button>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Active",   value: openCount,         icon: <AlertCircle size={14} className="text-amber-500" />,    bg: "bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800" },
            { label: "Resolved", value: resolvedCount,     icon: <CheckCircle2 size={14} className="text-emerald-500" />, bg: "bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800" },
            { label: "Total",    value: allTickets.length, icon: <Ticket size={14} className="text-primary" />,           bg: "bg-card border-border" },
          ].map((s) => (
            <div key={s.label} className={`rounded-xl border p-3 text-center ${s.bg}`}>
              <div className="flex justify-center mb-1">{s.icon}</div>
              <p className="text-lg font-bold text-foreground">{s.value}</p>
              <p className="text-[10px] text-muted-foreground">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-muted/50 rounded-xl p-1 border border-border">
          {tabs.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                tab === t.id ? "bg-background text-foreground shadow-sm border border-border" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {/* Tickets */}
        {tab === "tickets" && (
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="relative">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tickets…"
                  className="w-full pl-8 pr-3 py-2 text-sm bg-card border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30" />
                {search && <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"><X size={12} /></button>}
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {(["All","Open","Pending","InProgress","Resolved","Closed"] as StatusFilter[]).map((s) => (
                  <button key={s} onClick={() => setStatusFilter(s)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors ${
                      statusFilter === s ? "bg-primary text-primary-foreground border-primary" : "bg-card text-muted-foreground border-border hover:border-primary/40"
                    }`}
                  >{s === "InProgress" ? "Resolving" : s}</button>
                ))}
              </div>
            </div>
            {ticketsLoading ? (
              <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground"><Loader2 size={16} className="animate-spin" /> Loading tickets…</div>
            ) : ticketsError ? (
              <div className="flex flex-col items-center gap-3 py-12 text-center">
                <AlertCircle size={24} className="text-destructive" />
                <p className="text-sm text-muted-foreground">Failed to load tickets</p>
                <button onClick={() => refetchTickets()} className="text-xs text-primary hover:underline flex items-center gap-1"><RefreshCw size={11} /> Retry</button>
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-12 text-center">
                <Ticket size={28} className="text-muted-foreground/40" />
                <p className="text-sm font-medium text-foreground">No tickets found</p>
                <p className="text-xs text-muted-foreground">{search || statusFilter !== "All" ? "Try changing your filters" : "Raise a ticket and our team will get back to you"}</p>
                {!search && statusFilter === "All" && (
                  <button onClick={() => navigate("/ticket/create")} className="mt-1 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90">
                    <Plus size={12} /> Raise Ticket
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {filtered.map((t) => <TicketCard key={t.id} ticket={t} onClick={() => navigate(`/ticket/my?id=${t.id}`)} />)}
              </div>
            )}
          </div>
        )}

        {/* Progress */}
        {tab === "progress" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Construction Updates</h2>
                <p className="text-xs text-muted-foreground mt-0.5">Block & floor-wise progress for your units</p>
              </div>
              <Building2 size={18} className="text-muted-foreground/50" />
            </div>
            {updatesLoading ? (
              <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground"><Loader2 size={16} className="animate-spin" /> Loading…</div>
            ) : updates.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-12 text-center">
                <HardHat size={28} className="text-muted-foreground/40" />
                <p className="text-sm font-medium text-foreground">No updates yet</p>
                <p className="text-xs text-muted-foreground">Construction updates will appear here as your project progresses</p>
              </div>
            ) : (
              <>
                {(() => {
                  const avg = updates.reduce((a, u) => a + (parseFloat(u.PercentComplete) || 0), 0) / updates.length;
                  return (
                    <div className="rounded-xl border border-border bg-card p-4">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2"><TrendingUp size={14} className="text-primary" /><p className="text-xs font-semibold text-foreground">Overall Progress</p></div>
                        <span className="text-sm font-bold text-foreground">{avg.toFixed(0)}%</span>
                      </div>
                      <ProgressBar pct={avg} />
                      <p className="text-[11px] text-muted-foreground mt-2">{updates.length} update{updates.length !== 1 ? "s" : ""} recorded</p>
                    </div>
                  );
                })()}
                <div className="space-y-2">{updates.map((u) => <UpdateCard key={u.CUId} update={u} />)}</div>
              </>
            )}
          </div>
        )}

        {/* Reminders */}
        {tab === "reminders" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Payment Reminders</h2>
                <p className="text-xs text-muted-foreground mt-0.5">EMI installments and upcoming dues</p>
              </div>
              <button onClick={() => refreshReminders(true)} className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground"><RefreshCw size={13} /></button>
            </div>
            {remindersLoading ? (
              <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground"><Loader2 size={16} className="animate-spin" /> Loading…</div>
            ) : reminders.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-12 text-center">
                <Bell size={28} className="text-muted-foreground/40" />
                <p className="text-sm font-medium text-foreground">No pending reminders</p>
                <p className="text-xs text-muted-foreground">You're all caught up on payments</p>
              </div>
            ) : (
              <div className="space-y-2">{reminders.map((r) => <ReminderRow key={r.id} item={r} />)}</div>
            )}
          </div>
        )}

        <p className="text-center text-[10px] text-muted-foreground/50 pb-2">
          Civilier Customer Portal · For support contact your relationship manager
        </p>
      </div>
    </div>
  );
}