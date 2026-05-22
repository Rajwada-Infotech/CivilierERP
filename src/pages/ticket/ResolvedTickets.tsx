import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useAuth } from "@/contexts/AuthContext";
import { useTicketSync } from "@/hooks/useTicketSync";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  RefreshCw,
  Search,
  User,
  X,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Ticket {
  id: number;
  subject: string;
  priority: "Low" | "Medium" | "High" | "Urgent";
  issue_details: string;
  customer_name: string;
  customer_phone: string;
  status: "Pending" | "Resolved" | "InProgress" | "Closed";
  created_at?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtDate = (d?: string | null) =>
  d
    ? new Date(d).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : null;

const priorityConfig: Record<string, { cls: string; dot: string }> = {
  Urgent: { cls: "bg-red-500/10 text-red-600 border-red-400/20", dot: "bg-red-500" },
  High:   { cls: "bg-orange-500/10 text-orange-600 border-orange-400/20", dot: "bg-orange-500" },
  Medium: { cls: "bg-amber-500/10 text-amber-600 border-amber-400/20", dot: "bg-amber-500" },
  Low:    { cls: "bg-blue-500/10 text-blue-600 border-blue-400/20", dot: "bg-blue-500" },
};

function PriorityBadge({ priority }: { priority: string }) {
  const cfg = priorityConfig[priority] ?? { cls: "bg-muted text-muted-foreground border-border", dot: "bg-muted" };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium border ${cfg.cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {priority}
    </span>
  );
}

function TicketCard({ ticket }: { ticket: Ticket }) {
  const statusLabel = ticket.status === "Closed" ? "Closed" : "Resolved";
  const statusCls = ticket.status === "Closed"
    ? "bg-slate-500/10 text-slate-500 border-slate-400/20"
    : "bg-emerald-500/10 text-emerald-600 border-emerald-400/20";
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden hover:border-border/80 hover:shadow-sm transition-all">
      <div className="px-5 py-4">
        <div className="flex items-start gap-3">
          <div className={`w-1 self-stretch rounded-full shrink-0 mt-0.5 ${priorityConfig[ticket.priority]?.dot ?? "bg-muted"}`} />
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-sm font-heading font-semibold text-foreground leading-snug">{ticket.subject}</h3>
              <div className="flex items-center gap-1.5 shrink-0">
                <PriorityBadge priority={ticket.priority} />
                <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium border ${statusCls}`}>
                  <CheckCircle2 size={10} /> {statusLabel}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-3 mt-1.5 flex-wrap">
              <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <User size={10} />
                <span>{ticket.customer_name || "—"}</span>
              </div>
              {ticket.customer_phone && <span className="text-[11px] text-muted-foreground">{ticket.customer_phone}</span>}
              {fmtDate(ticket.created_at) && <span className="text-[11px] text-muted-foreground">{fmtDate(ticket.created_at)}</span>}
              <span className="text-[11px] font-mono text-muted-foreground/60">#{ticket.id}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── ResolvedTickets page ─────────────────────────────────────────────────────
// Visible to all authenticated users.
// Admin → sees ALL resolved tickets (/api/tickets filtered)
// User  → sees only their own resolved tickets (/api/tickets/my filtered)

type ResolutionTab = "Resolved" | "Closed";

const ResolvedTickets: React.FC = () => {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const ADMIN_ROLES = ["super_admin", "admin", "dba"];
  const isAdmin = ADMIN_ROLES.includes(currentUser?.role ?? "");

  const [search, setSearch] = useState("");
  const [priorityFilter, setPriorityFilter] = useState<string>("All");
  const [activeTab, setActiveTab] = useState<ResolutionTab>("Resolved");

  const { data: allTickets = [], isLoading, isError, refetch, isFetching } =
    useQuery<Ticket[]>({
      queryKey: ["tickets", "resolved", isAdmin ? "all" : "my"],
      queryFn: async () => {
        const endpoint = isAdmin
          ? "/api/tickets?limit=100&status=Resolved,Closed"
          : "/api/tickets/my";
        const res = await fetchWithAuth(endpoint);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const payload = await res.json();
        // Handle both response shapes:
        // paginated: { data: [...], pagination: {...} }
        // plain array: [...]
        const raw: Ticket[] = Array.isArray(payload)
          ? payload
          : Array.isArray(payload?.data)
          ? payload.data
          : [];
        // Always filter to only Resolved/Closed regardless of endpoint
        return raw.filter(
          (t) => t.status === "Resolved" || t.status === "Closed",
        );
      },
      staleTime: 0,
      gcTime: 0,
      refetchOnWindowFocus: true,
    });

  useTicketSync(refetch);

  // Show resolved OR closed tickets based on active tab
  // Non-admin /my endpoint returns all statuses — filter to only resolved/closed here
  const filteredTickets = useMemo(() => {
    // allTickets already contains only Resolved/Closed (filtered in queryFn)
    let list = allTickets.filter((t) => t.status === activeTab);
    if (priorityFilter !== "All") list = list.filter((t) => t.priority === priorityFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (t) =>
          t.subject.toLowerCase().includes(q) ||
          t.customer_name?.toLowerCase().includes(q),
      );
    }
    return list;
  }, [allTickets, activeTab, priorityFilter, search]);

  const resolvedCount = allTickets.filter((t) => t.status === "Resolved").length;
  const closedCount = allTickets.filter((t) => t.status === "Closed").length;

  return (
    <>
      <Breadcrumbs items={["Tickets", "Resolved Tickets"]} />

      <div className="max-w-3xl mx-auto pb-10 space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate("/ticket")}
              className="w-8 h-8 flex items-center justify-center rounded-lg border border-border hover:bg-muted transition-colors text-muted-foreground"
            >
              <ArrowLeft size={14} />
            </button>
            <div>
              <h1 className="text-xl font-heading font-bold text-foreground">Resolved Tickets</h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                {resolvedCount} resolved · {closedCount} closed
              </p>
            </div>
          </div>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="w-8 h-8 flex items-center justify-center rounded-lg border border-border hover:bg-muted transition-colors text-muted-foreground disabled:opacity-50"
          >
            <RefreshCw size={13} className={isFetching ? "animate-spin" : ""} />
          </button>
        </div>

        {isError && (
          <div className="px-4 py-3 rounded-xl bg-red-500/10 text-red-600 text-sm border border-red-500/20 flex items-center gap-2">
            <AlertCircle size={14} /> Failed to load tickets. Try refreshing.
          </div>
        )}

        {/* Resolved / Closed tabs */}
        <div className="flex items-center gap-1.5">
          {(["Resolved", "Closed"] as ResolutionTab[]).map((tab) => {
            const count = tab === "Resolved" ? resolvedCount : closedCount;
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  activeTab === tab
                    ? "bg-primary text-primary-foreground"
                    : "border border-border text-muted-foreground hover:bg-muted"
                }`}
              >
                {tab}
                {!isLoading && (
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded-full font-mono ${
                      activeTab === tab
                        ? "bg-white/20 text-white"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-48">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${activeTab.toLowerCase()} tickets…`}
              className="w-full pl-8 pr-8 py-2 rounded-xl border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
            />
            {search && (
              <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                <X size={12} />
              </button>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {(["All", "Urgent", "High", "Medium", "Low"] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPriorityFilter(p)}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-heading font-medium transition-all ${
                  priorityFilter === p
                    ? "bg-primary text-primary-foreground"
                    : "border border-border text-muted-foreground hover:bg-muted"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        {/* List */}
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-border bg-card p-5 animate-pulse">
                <div className="flex gap-3">
                  <div className="w-1 h-16 bg-muted rounded-full" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-muted rounded w-2/3" />
                    <div className="h-3 bg-muted rounded w-1/3" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : filteredTickets.length === 0 ? (
          <div className="rounded-xl border border-border bg-card py-16 flex flex-col items-center gap-3 text-muted-foreground">
            <CheckCircle2 size={32} className="opacity-20" />
            <p className="text-sm">
              {search || priorityFilter !== "All"
                ? "No tickets match your filters"
                : `No ${activeTab.toLowerCase()} tickets yet`}
            </p>
            {(search || priorityFilter !== "All") && (
              <button
                onClick={() => { setSearch(""); setPriorityFilter("All"); }}
                className="text-xs text-primary hover:underline"
              >
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {filteredTickets.map((t) => (
              <TicketCard key={t.id} ticket={t} />
            ))}
          </div>
        )}

        {!isLoading && filteredTickets.length > 0 && (search || priorityFilter !== "All") && (
          <p className="text-xs text-muted-foreground text-center">
            Showing {filteredTickets.length} of {activeTab === "Resolved" ? resolvedCount : closedCount} {activeTab.toLowerCase()} tickets
          </p>
        )}
      </div>
    </>
  );
};

export default ResolvedTickets;