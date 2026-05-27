import { useState, useEffect, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate, useParams } from "react-router-dom";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { DashboardBackground } from "@/components/DashboardBackground";
import {
  Ticket, HardHat, ChevronRight, Clock, CheckCircle2, AlertCircle,
  Loader2, RefreshCw, Building2, TrendingUp, MessageCircle,
  CalendarDays, Plus, Search, X, Bell,
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

const statusConfig: Record<string, { label: string; cls: string; icon: ReactNode }> = {
  Open:       { label: "Open",      cls: "bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-700",         icon: <AlertCircle size={12} /> },
  Pending:    { label: "Pending",   cls: "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-700",   icon: <Clock size={12} /> },
  InProgress: { label: "Resolving", cls: "bg-violet-100 text-violet-800 border-violet-300 dark:bg-violet-950 dark:text-violet-300 dark:border-violet-700", icon: <Loader2 size={12} /> },
  Resolved:   { label: "Resolved",  cls: "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-700", icon: <CheckCircle2 size={12} /> },
  Closed:     { label: "Closed",    cls: "bg-slate-100 text-slate-600 border-slate-300 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-600",   icon: <X size={12} /> },
};
const priorityBar: Record<string, string> = {
  Low: "bg-emerald-500", Medium: "bg-amber-500", High: "bg-orange-500", Critical: "bg-red-600",
};

function StatusBadge({ status }: { status: string }) {
  const cfg = statusConfig[status] ?? statusConfig.Open;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${cfg.cls}`}>
      {cfg.icon} {cfg.label}
    </span>
  );
}

function ProgressBar({ pct }: { pct: number }) {
  const c = Math.min(100, Math.max(0, pct));
  const color = c >= 75 ? "bg-emerald-500" : c >= 40 ? "bg-amber-500" : "bg-blue-500";
  return (
    <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2.5 overflow-hidden">
      <div className={`h-2.5 rounded-full transition-all duration-700 ${color}`} style={{ width: `${c}%` }} />
    </div>
  );
}

function TicketCard({ ticket, onClick }: { ticket: CustomerTicket; onClick: () => void }) {
  const bar = priorityBar[ticket.priority] ?? "bg-slate-400";
  return (
    <button onClick={onClick} className="w-full text-left rounded-xl border border-border bg-card hover:border-primary/50 hover:shadow-md transition-all group overflow-hidden flex flex-col">
      <div className="flex items-stretch w-full">
        <div className={`w-1.5 shrink-0 ${bar}`} />
        <div className="flex-1 px-4 py-4 min-w-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="font-mono text-xs text-muted-foreground/80 shrink-0">#{ticket.id}</span>
                <h3 className="text-sm font-semibold text-foreground leading-snug truncate">{ticket.subject}</h3>
              </div>
              <div className="flex items-center gap-4 flex-wrap mt-2">
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><CalendarDays size={14} /> {fmtDate(ticket.created_at)}</span>
                {(ticket.comment_count ?? 0) > 0 && (
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><MessageCircle size={14} /> {ticket.comment_count} replies</span>
                )}
              </div>
              {ticket.description && <p className="mt-2 text-xs text-muted-foreground line-clamp-2">{ticket.description}</p>}
            </div>
            <div className="flex flex-col items-end gap-2 shrink-0">
              <StatusBadge status={ticket.status} />
              <ChevronRight size={16} className="text-muted-foreground/40 group-hover:text-foreground mt-1 transition-colors" />
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
    <div className="rounded-xl border border-border bg-card p-4 space-y-3 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-foreground">{update.Stage || "Update"}</p>
          <p className="text-xs text-muted-foreground mt-1">{fmtDate(update.UpdateDate)}</p>
        </div>
        <span className={`text-sm font-bold tabular-nums ${pct >= 75 ? "text-emerald-600 dark:text-emerald-400" : pct >= 40 ? "text-amber-600 dark:text-amber-400" : "text-blue-600 dark:text-blue-400"}`}>{pct.toFixed(0)}%</span>
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
    <div className={`rounded-xl border px-4 py-3 flex items-center gap-3 shadow-sm ${bg[item.urgency] ?? bg.upcoming}`}>
      <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${dot[item.urgency] ?? "bg-slate-400"}`} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">{item.title}</p>
        <p className="text-xs text-muted-foreground truncate mt-0.5">{item.subtitle}</p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-xs text-muted-foreground">{formatDate(item.dueDate)}</p>
        {item.amount != null && <p className="text-sm font-semibold text-foreground mt-0.5">₹{item.amount.toLocaleString("en-IN")}</p>}
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
        return res.json();
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
        return res.json();
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

  const openCount     = allTickets.filter((t) => ["Open","Pending","InProgress"].includes(t.status)).length;
  const resolvedCount = allTickets.filter((t) => ["Resolved","Closed"].includes(t.status)).length;
  const updates       = updatesData?.data ?? [];

  const tabs = [
    { id: "tickets"   as Tab, label: "My Tickets",      icon: <Ticket size={16} /> },
    { id: "progress"  as Tab, label: "Progress",        icon: <HardHat size={16} /> },
    { id: "reminders" as Tab, label: "Reminders",       icon: <Bell size={16} /> },
  ];

  return (
    <div className="min-h-screen bg-background">
      <DashboardBackground />
      <div className="relative z-10 max-w-3xl mx-auto px-4 py-6 space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-muted-foreground">{greeting},</p>
            <h1 className="text-2xl font-bold text-foreground tracking-tight">{firstName}</h1>
          </div>
          <button
            onClick={() => navigate("/ticket/create")}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors shadow-sm"
          >
            <Plus size={16} /> New Ticket
          </button>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: "Active Tickets",   value: openCount,         icon: <AlertCircle size={18} className="text-amber-600 dark:text-amber-400" />,    bg: "bg-amber-50 border-amber-200 dark:bg-amber-950 dark:border-amber-800" },
            { label: "Resolved", value: resolvedCount,     icon: <CheckCircle2 size={18} className="text-emerald-600 dark:text-emerald-400" />, bg: "bg-emerald-50 border-emerald-200 dark:bg-emerald-950 dark:border-emerald-800" },
            { label: "Total",    value: allTickets.length, icon: <Ticket size={18} className="text-blue-600 dark:text-blue-400" />,           bg: "bg-blue-50 border-blue-200 dark:bg-blue-950 dark:border-blue-800" },
          ].map((s) => (
            <div key={s.label} className={`rounded-xl border p-4 text-center shadow-sm ${s.bg}`}>
              <div className="flex justify-center mb-2">{s.icon}</div>
              <p className="text-2xl font-bold text-foreground">{s.value}</p>
              <p className="text-xs font-medium text-muted-foreground mt-1">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex gap-2 bg-muted/30 p-1.5 rounded-xl border border-border">
          {tabs.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                tab === t.id ? "bg-background text-foreground shadow-sm border border-border/50" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              }`}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {/* Tickets */}
        {tab === "tickets" && (
          <div className="space-y-4">
            <div className="space-y-3">
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tickets…"
                  className="w-full pl-9 pr-9 py-2.5 text-sm bg-card border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all shadow-sm" />
                {search && <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"><X size={14} /></button>}
              </div>
              <div className="flex gap-2 flex-wrap">
                {(["All","Open","Pending","InProgress","Resolved","Closed"] as StatusFilter[]).map((s) => (
                  <button key={s} onClick={() => setStatusFilter(s)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                      statusFilter === s ? "bg-primary text-primary-foreground border-primary shadow-sm" : "bg-card text-muted-foreground border-border hover:border-primary/40 hover:text-foreground hover:bg-accent/50"
                    }`}
                  >{s === "InProgress" ? "Resolving" : s}</button>
                ))}
              </div>
            </div>
            {ticketsLoading ? (
              <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground">
                <Loader2 size={16} className="animate-spin" /> Loading tickets...
              </div>
            ) : ticketsError ? (
              <div className="flex flex-col items-center gap-3 py-12 text-center">
                <AlertCircle size={24} className="text-destructive" />
                <p className="text-sm text-muted-foreground">Failed to load tickets</p>
                <button
                  onClick={() => refetchTickets()}
                  className="text-xs text-primary hover:underline flex items-center gap-1"
                >
                  <RefreshCw size={11} /> Retry
                </button>
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-12 text-center bg-card rounded-xl border border-dashed border-border shadow-sm">
                <Ticket size={32} className="text-muted-foreground/40" />
                <div>
                  <p className="text-sm font-medium text-foreground">No tickets found</p>
                  <p className="text-xs text-muted-foreground mt-1">{search || statusFilter !== "All" ? "Try changing your filters" : "Raise a ticket and our team will get back to you"}</p>
                </div>
                {!search && statusFilter === "All" && (
                  <button onClick={() => navigate("/ticket/create")} className="mt-2 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 shadow-sm transition-colors">
                    <Plus size={16} /> Raise Ticket
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
              <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground">
                <Loader2 size={16} className="animate-spin" /> Loading...
              </div>
            ) : updates.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-12 text-center bg-card rounded-xl border border-dashed border-border shadow-sm">
                <HardHat size={32} className="text-muted-foreground/40" />
                <div>
                  <p className="text-sm font-medium text-foreground">No updates yet</p>
                  <p className="text-xs text-muted-foreground mt-1">Construction updates will appear here as your project progresses</p>
                </div>
              </div>
            ) : (
              <>
                {(() => {
                  const avg = updates.reduce((a, u) => a + (parseFloat(u.PercentComplete) || 0), 0) / updates.length;
                  return (
                    <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2.5"><TrendingUp size={18} className="text-primary" /><p className="text-sm font-semibold text-foreground">Overall Progress</p></div>
                        <span className="text-lg font-bold text-foreground">{avg.toFixed(0)}%</span>
                      </div>
                      <ProgressBar pct={avg} />
                      <p className="text-xs text-muted-foreground mt-3">{updates.length} update{updates.length !== 1 ? "s" : ""} recorded</p>
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
              <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground"><Loader2 size={16} className="animate-spin" /> Loading...</div>
            ) : reminders.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-12 text-center bg-card rounded-xl border border-dashed border-border shadow-sm">
                <Bell size={32} className="text-muted-foreground/40" />
                <div>
                  <p className="text-sm font-medium text-foreground">No pending reminders</p>
                  <p className="text-xs text-muted-foreground mt-1">You're all caught up on payments</p>
                </div>
              </div>
            ) : (
              <div className="space-y-2">{reminders.map((r) => <ReminderRow key={r.id} item={r} />)}</div>
            )}
          </div>
        )}

        <p className="text-center text-xs text-muted-foreground/70 pb-4">
          Civilier Customer Portal &middot; For support contact your relationship manager
        </p>
      </div>
    </div>
  );
}