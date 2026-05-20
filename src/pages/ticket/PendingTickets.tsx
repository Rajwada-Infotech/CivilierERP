import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  Clock,
  Loader2,
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
  status: "Pending" | "Resolved" | "InProgress";
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
  const cfg = priorityConfig[priority] ?? {
    cls: "bg-muted text-muted-foreground border-border",
    dot: "bg-muted",
  };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium border ${cfg.cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {priority}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    Resolved:   "bg-emerald-500/10 text-emerald-600 border-emerald-400/20",
    Pending:    "bg-amber-500/10 text-amber-600 border-amber-400/20",
    InProgress: "bg-blue-500/10 text-blue-600 border-blue-400/20",
  };
  const Icon = status === "Resolved" ? CheckCircle2 : Clock;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium border ${map[status] ?? "bg-muted text-muted-foreground border-border"}`}>
      <Icon size={10} />
      {status}
    </span>
  );
}

function TicketCard({
  ticket,
  onResolve,
  resolving,
}: {
  ticket: Ticket;
  onResolve: (id: number) => void;
  resolving: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden hover:border-border/80 hover:shadow-sm transition-all">
      <div className="px-5 py-4">
        <div className="flex items-start gap-3">
          <div className={`w-1 self-stretch rounded-full shrink-0 mt-0.5 ${priorityConfig[ticket.priority]?.dot ?? "bg-muted"}`} />
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-sm font-heading font-semibold text-foreground leading-snug">
                {ticket.subject}
              </h3>
              <div className="flex items-center gap-1.5 shrink-0">
                <PriorityBadge priority={ticket.priority} />
                <StatusBadge status={ticket.status} />
              </div>
            </div>
            <div className="flex items-center gap-3 mt-1.5 flex-wrap">
              <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <User size={10} />
                <span>{ticket.customer_name || "—"}</span>
              </div>
              {ticket.customer_phone && (
                <span className="text-[11px] text-muted-foreground">{ticket.customer_phone}</span>
              )}
              {fmtDate(ticket.created_at) && (
                <span className="text-[11px] text-muted-foreground">{fmtDate(ticket.created_at)}</span>
              )}
              <span className="text-[11px] font-mono text-muted-foreground/60">#{ticket.id}</span>
            </div>
            {ticket.issue_details && (
              <div className="mt-2">
                <p className={`text-xs text-muted-foreground leading-relaxed ${expanded ? "" : "line-clamp-2"}`}>
                  {ticket.issue_details}
                </p>
                {ticket.issue_details.length > 120 && (
                  <button
                    onClick={() => setExpanded((p) => !p)}
                    className="text-[11px] text-primary mt-0.5 hover:underline flex items-center gap-0.5"
                  >
                    {expanded ? "Show less" : "Show more"}
                    <ChevronDown size={10} className={`transition-transform ${expanded ? "rotate-180" : ""}`} />
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      {/* Resolve button — always shown on pending tickets in admin view */}
      {ticket.status === "Pending" && (
        <div className="px-5 py-2.5 border-t border-border bg-muted/20 flex justify-end">
          <button
            onClick={() => onResolve(ticket.id)}
            disabled={resolving}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading font-medium text-emerald-600 hover:bg-emerald-500/10 border border-emerald-400/20 transition-colors disabled:opacity-50"
          >
            {resolving ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />}
            Mark Resolved
          </button>
        </div>
      )}
    </div>
  );
}

// ─── PendingTickets page ──────────────────────────────────────────────────────
// Admin/super_admin only. Shows ALL tickets with status/priority filters.
// Admin can mark pending tickets as resolved from here.

const PendingTickets: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"All" | "Pending" | "Resolved">("All");
  const [priorityFilter, setPriorityFilter] = useState<string>("All Priority");
  const [resolvingId, setResolvingId] = useState<number | null>(null);

  // Fetch ALL tickets — admin endpoint
  const { data: allTickets = [], isLoading, isError, refetch, isFetching } =
    useQuery<Ticket[]>({
      queryKey: ["tickets", "all"],
      queryFn: async () => {
        const res = await fetchWithAuth("/api/tickets");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      },
      staleTime: 0,
      refetchOnWindowFocus: true,
    });

  const resolveMutation = useMutation({
    mutationFn: async (id: number) => {
      setResolvingId(id);
      const res = await fetchWithAuth(`/api/tickets/resolve/${id}`, {
        method: "PUT",
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error("Failed to resolve");
    },
    onSuccess: () => {
      toast.success("Ticket resolved");
      queryClient.invalidateQueries({ queryKey: ["tickets"] });
    },
    onError: () => toast.error("Failed to resolve ticket"),
    onSettled: () => setResolvingId(null),
  });

  const tickets = useMemo(() => {
    let list = [...allTickets];

    if (statusFilter !== "All") list = list.filter((t) => t.status === statusFilter);

    if (priorityFilter !== "All Priority") list = list.filter((t) => t.priority === priorityFilter);

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (t) =>
          t.subject.toLowerCase().includes(q) ||
          t.customer_name?.toLowerCase().includes(q) ||
          t.issue_details?.toLowerCase().includes(q),
      );
    }
    return list;
  }, [allTickets, statusFilter, priorityFilter, search]);

  const pendingCount = allTickets.filter((t) => t.status === "Pending").length;
  const urgentCount = allTickets.filter((t) => t.priority === "Urgent").length;

  return (
    <>
      <Breadcrumbs items={["Tickets", "Pending Tickets"]} />

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
              <h1 className="text-xl font-heading font-bold text-foreground">All Tickets</h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                {pendingCount} pending · {allTickets.length} total
                {urgentCount > 0 && (
                  <span className="text-red-500 ml-1.5 font-medium">· {urgentCount} urgent</span>
                )}
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

        {/* Error */}
        {isError && (
          <div className="px-4 py-3 rounded-xl bg-red-500/10 text-red-600 text-sm border border-red-500/20 flex items-center gap-2">
            <AlertCircle size={14} /> Failed to load tickets. Try refreshing.
          </div>
        )}

        {/* Filters row */}
        <div className="space-y-2">
          {/* Search */}
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tickets…"
              className="w-full pl-8 pr-8 py-2 rounded-xl border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
            />
            {search && (
              <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                <X size={12} />
              </button>
            )}
          </div>

          {/* Status + Priority filters */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Status */}
            <div className="flex items-center gap-1">
              {(["All", "Pending", "Resolved"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-heading font-medium transition-all ${
                    statusFilter === s
                      ? "bg-primary text-primary-foreground"
                      : "border border-border text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>

            <div className="w-px h-5 bg-border" />

            {/* Priority */}
            <div className="flex items-center gap-1">
              {(["All Priority", "Urgent", "High", "Medium", "Low"] as const).map((p) => (
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
        </div>

        {/* List */}
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-border bg-card p-5 animate-pulse">
                <div className="flex gap-3">
                  <div className="w-1 h-16 bg-muted rounded-full" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-muted rounded w-2/3" />
                    <div className="h-3 bg-muted rounded w-1/3" />
                    <div className="h-3 bg-muted rounded w-full" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : tickets.length === 0 ? (
          <div className="rounded-xl border border-border bg-card py-16 flex flex-col items-center gap-3 text-muted-foreground">
            <CheckCircle2 size={32} className="opacity-20" />
            <p className="text-sm">
              {search || statusFilter !== "All" || priorityFilter !== "All Priority"
                ? "No tickets match your filters"
                : "No tickets yet"}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {tickets.map((t) => (
              <TicketCard
                key={t.id}
                ticket={t}
                onResolve={(id) => resolveMutation.mutate(id)}
                resolving={resolvingId === t.id && resolveMutation.isPending}
              />
            ))}
          </div>
        )}

        {!isLoading && tickets.length > 0 && (search || statusFilter !== "All" || priorityFilter !== "All Priority") && (
          <p className="text-xs text-muted-foreground text-center">
            Showing {tickets.length} of {allTickets.length} tickets
          </p>
        )}
      </div>
    </>
  );
};

export default PendingTickets;