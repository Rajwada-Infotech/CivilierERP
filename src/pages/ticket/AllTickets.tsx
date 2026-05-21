import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { invalidateTicketQueries } from "@/lib/ticketQuerySync";
import { unwrapTicketList } from "@/lib/ticketListResponse";
import { useTicketSync } from "@/hooks/useTicketSync";
import { useAuth } from "@/contexts/AuthContext";
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
  UserCheck,
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
  assigned_to?: string | null;
  assigned_to_id?: number | null;
  created_by_id?: number | null;
  created_at?: string;
}

type StatusFilter = "All" | "Pending" | "InProgress" | "Resolved" | "Closed";

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
  Urgent: {
    cls: "bg-red-500/10 text-red-600 border-red-400/20",
    dot: "bg-red-500",
  },
  High: {
    cls: "bg-orange-500/10 text-orange-600 border-orange-400/20",
    dot: "bg-orange-500",
  },
  Medium: {
    cls: "bg-amber-500/10 text-amber-600 border-amber-400/20",
    dot: "bg-amber-500",
  },
  Low: {
    cls: "bg-blue-500/10 text-blue-600 border-blue-400/20",
    dot: "bg-blue-500",
  },
};

const statusConfig: Record<string, { cls: string; label: string }> = {
  Pending: {
    cls: "bg-amber-500/10 text-amber-600 border-amber-400/20",
    label: "Pending",
  },
  InProgress: {
    cls: "bg-blue-500/10 text-blue-600 border-blue-400/20",
    label: "Resolving",
  },
  Resolved: {
    cls: "bg-emerald-500/10 text-emerald-600 border-emerald-400/20",
    label: "Resolved",
  },
  Closed: {
    cls: "bg-slate-500/10 text-slate-500 border-slate-400/20",
    label: "Closed",
  },
};

function PriorityBadge({ priority }: { priority: string }) {
  const cfg = priorityConfig[priority] ?? {
    cls: "bg-muted text-muted-foreground border-border",
    dot: "bg-muted",
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium border ${cfg.cls}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {priority}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cfg = statusConfig[status] ?? {
    cls: "bg-muted text-muted-foreground border-border",
    label: status,
  };
  const Icon = status === "Resolved" ? CheckCircle2 : Clock;
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium border ${cfg.cls}`}
    >
      <Icon size={10} />
      {cfg.label}
    </span>
  );
}

function TicketCard({
  ticket,
  canAccept,
  isAccepting,
  onAccept,
}: {
  ticket: Ticket;
  canAccept: boolean;
  isAccepting: boolean;
  onAccept: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden hover:border-border/80 hover:shadow-sm transition-all">
      <div className="px-5 py-4">
        <div className="flex items-start gap-3">
          <div
            className={`w-1 self-stretch rounded-full shrink-0 mt-0.5 ${priorityConfig[ticket.priority]?.dot ?? "bg-muted"}`}
          />
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
                <span className="text-[11px] text-muted-foreground">
                  {ticket.customer_phone}
                </span>
              )}
              {fmtDate(ticket.created_at) && (
                <span className="text-[11px] text-muted-foreground">
                  {fmtDate(ticket.created_at)}
                </span>
              )}
              {ticket.assigned_to && (
                <span className="flex items-center gap-1 text-[11px] text-blue-600">
                  <UserCheck size={10} />
                  {ticket.assigned_to}
                </span>
              )}
              <span className="text-[11px] font-mono text-muted-foreground/60">
                #{ticket.id}
              </span>
            </div>
            {ticket.issue_details && (
              <div className="mt-2">
                <p
                  className={`text-xs text-muted-foreground leading-relaxed ${expanded ? "" : "line-clamp-2"}`}
                >
                  {ticket.issue_details}
                </p>
                {ticket.issue_details.length > 120 && (
                  <button
                    onClick={() => setExpanded((p) => !p)}
                    className="text-[11px] text-primary mt-0.5 hover:underline flex items-center gap-0.5"
                  >
                    {expanded ? "Show less" : "Show more"}
                    <ChevronDown
                      size={10}
                      className={`transition-transform ${expanded ? "rotate-180" : ""}`}
                    />
                  </button>
                )}
              </div>
            )}
            {canAccept && (
              <div className="mt-3">
                <button
                  type="button"
                  onClick={onAccept}
                  disabled={isAccepting}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 text-xs font-medium text-blue-700 transition-colors hover:bg-blue-100 disabled:opacity-60"
                >
                  {isAccepting ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <UserCheck size={12} />
                  )}
                  Accept
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── AllTickets page ──────────────────────────────────────────────────────────

const STATUS_TABS: StatusFilter[] = [
  "All",
  "Pending",
  "InProgress",
  "Resolved",
  "Closed",
];

const TAB_LABELS: Record<StatusFilter, string> = {
  All: "All",
  Pending: "Pending",
  InProgress: "Resolving",
  Resolved: "Resolved",
  Closed: "Closed",
};

const AllTickets: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { currentUser } = useAuth();
  const canCurrentUserAccept =
    !!currentUser?.can_accept_tickets ||
    ["admin", "super_admin", "dba"].includes(currentUser?.role ?? "");

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("All");
  const [priorityFilter, setPriorityFilter] = useState<string>("All");
  const [acceptingId, setAcceptingId] = useState<number | null>(null);

  const {
    data: allTickets = [],
    isLoading,
    isError,
    refetch,
    isFetching,
  } = useQuery<Ticket[]>({
    queryKey: ["tickets", "all"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/tickets?limit=100");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const payload = await res.json();
      return unwrapTicketList<Ticket>(payload).data;
    },
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  useTicketSync(refetch);

  const acceptMutation = useMutation({
    mutationFn: async (id: number) => {
      setAcceptingId(id);
      const res = await fetchWithAuth(`/api/tickets/accept/${id}`, {
        method: "PUT",
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to accept ticket");
      }
    },
    onSuccess: () => {
      toast.success("Ticket accepted. Status changed to Resolving.");
      invalidateTicketQueries(queryClient);
    },
    onError: (err: Error) => toast.error(err.message),
    onSettled: () => setAcceptingId(null),
  });

  const tickets = useMemo(() => {
    let list = [...allTickets];
    if (statusFilter !== "All")
      list = list.filter((t) => t.status === statusFilter);
    if (priorityFilter !== "All")
      list = list.filter((t) => t.priority === priorityFilter);
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

  // Counts per tab
  const tabCounts: Record<StatusFilter, number> = {
    All: allTickets.length,
    Pending: allTickets.filter((t) => t.status === "Pending").length,
    InProgress: allTickets.filter((t) => t.status === "InProgress").length,
    Resolved: allTickets.filter((t) => t.status === "Resolved").length,
    Closed: allTickets.filter((t) => t.status === "Closed").length,
  };

  const urgentCount = allTickets.filter((t) => t.priority === "Urgent").length;
  const isFiltered =
    statusFilter !== "All" || priorityFilter !== "All" || search.trim();

  return (
    <>
      <Breadcrumbs items={["Tickets", "All Tickets"]} />

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
              <h1 className="text-xl font-heading font-bold text-foreground">
                All Tickets
              </h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                {allTickets.length} total
                {urgentCount > 0 && (
                  <span className="text-red-500 ml-1.5 font-medium">
                    · {urgentCount} urgent
                  </span>
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

        {/* Status tabs */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setStatusFilter(tab)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                statusFilter === tab
                  ? "bg-primary text-primary-foreground"
                  : "border border-border text-muted-foreground hover:bg-muted"
              }`}
            >
              {TAB_LABELS[tab]}
              {!isLoading && (
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded-full font-mono ${
                    statusFilter === tab
                      ? "bg-white/20 text-white"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {tabCounts[tab]}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Search + Priority filter */}
        <div className="space-y-2">
          <div className="relative">
            <Search
              size={13}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by subject, customer, or issue…"
              className="w-full pl-8 pr-8 py-2 rounded-xl border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X size={12} />
              </button>
            )}
          </div>

          {/* Priority chips */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] text-muted-foreground font-medium">
              Priority:
            </span>
            {(["All", "Urgent", "High", "Medium", "Low"] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPriorityFilter(p)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all ${
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

        {/* Ticket list */}
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="rounded-xl border border-border bg-card p-5 animate-pulse"
              >
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
              {isFiltered
                ? "No tickets match your filters"
                : "No tickets found"}
            </p>
            {isFiltered && (
              <button
                onClick={() => {
                  setSearch("");
                  setPriorityFilter("All");
                  setStatusFilter("All");
                }}
                className="text-xs text-primary hover:underline"
              >
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {tickets.map((t) => {
              const canAccept =
                t.status === "Pending" &&
                !t.assigned_to_id &&
                canCurrentUserAccept &&
                String(t.created_by_id ?? "") !== String(currentUser?.id ?? "");
              return (
                <TicketCard
                  key={t.id}
                  ticket={t}
                  canAccept={canAccept}
                  isAccepting={acceptingId === t.id}
                  onAccept={() => acceptMutation.mutate(t.id)}
                />
              );
            })}
          </div>
        )}

        {!isLoading && tickets.length > 0 && isFiltered && (
          <p className="text-xs text-muted-foreground text-center">
            Showing {tickets.length} of {allTickets.length} tickets
          </p>
        )}
      </div>
    </>
  );
};

export default AllTickets;
