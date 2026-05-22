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
  RotateCcw,
  Search,
  Star,
  User,
  UserCheck,
  X,
  XCircle,
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

type ActionModal =
  | { type: "resolve"; ticket: Ticket }
  | { type: "open" | "close"; ticket: Ticket }
  | null;

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
  const cfg = priorityConfig[priority] ?? { cls: "bg-muted text-muted-foreground border-border", dot: "bg-muted" };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium border ${cfg.cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {priority}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cfg = statusConfig[status] ?? { cls: "bg-muted text-muted-foreground border-border", label: status };
  const Icon = status === "Resolved" ? CheckCircle2 : Clock;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium border ${cfg.cls}`}>
      <Icon size={10} />
      {cfg.label}
    </span>
  );
}

// ─── Star Rating ──────────────────────────────────────────────────────────────

function StarRating({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const [hovered, setHovered] = useState(0);
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          onMouseEnter={() => setHovered(star)}
          onMouseLeave={() => setHovered(0)}
          onClick={() => onChange(star)}
          className="transition-transform hover:scale-110 focus:outline-none"
        >
          <Star
            size={22}
            className={`transition-colors ${
              star <= (hovered || value)
                ? "fill-amber-400 text-amber-400"
                : "fill-none text-muted-foreground/30"
            }`}
          />
        </button>
      ))}
      {value > 0 && (
        <span className="ml-1.5 text-xs text-muted-foreground">
          {["", "Poor", "Fair", "Good", "Very Good", "Excellent"][value]}
        </span>
      )}
    </div>
  );
}

// ─── Resolve Review Modal ─────────────────────────────────────────────────────

function ResolveModal({
  ticket,
  onClose,
  onSubmit,
  isPending,
}: {
  ticket: Ticket;
  onClose: () => void;
  onSubmit: (rating: number, remarks: string) => void;
  isPending: boolean;
}) {
  const [rating, setRating] = useState(0);
  const [remarks, setRemarks] = useState("");

  const canSubmit = rating > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative z-10 w-full max-w-md bg-card rounded-2xl border border-border shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <div className="px-5 py-4 border-b border-border flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0">
            <CheckCircle2 size={15} className="text-emerald-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground">Resolve Ticket</p>
            <p className="text-[11px] text-muted-foreground truncate">
              #{ticket.id} · {ticket.subject}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div className="rounded-xl bg-muted/40 border border-border px-4 py-3 space-y-1">
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <User size={10} />
              <span>{ticket.customer_name || "—"}</span>
              {ticket.customer_phone && (
                <span className="text-muted-foreground/50">· {ticket.customer_phone}</span>
              )}
            </div>
            <p className="text-xs text-foreground leading-relaxed line-clamp-2">
              {ticket.issue_details}
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground flex items-center gap-1">
              Resolution Rating
              <span className="text-red-500 normal-case tracking-normal font-normal">*</span>
            </label>
            <StarRating value={rating} onChange={setRating} />
            {rating === 0 && (
              <p className="text-[10px] text-muted-foreground/60">
                Please select a rating to continue
              </p>
            )}
          </div>

          {rating > 0 && (
            <div className="space-y-1.5 animate-in fade-in slide-in-from-bottom-2 duration-200">
              <label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                Review Remarks
                <span className="ml-1 text-muted-foreground/50 normal-case tracking-normal font-normal">
                  (optional)
                </span>
              </label>
              <textarea
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="Describe the resolution quality or add any notes…"
                rows={3}
                className="w-full resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
              />
            </div>
          )}
        </div>

        <div className="px-5 py-3.5 border-t border-border flex items-center justify-end gap-2.5">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:bg-muted transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onSubmit(rating, remarks)}
            disabled={!canSubmit || isPending}
            className="flex items-center gap-2 px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isPending ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <CheckCircle2 size={13} />
            )}
            {isPending ? "Resolving…" : "Submit & Resolve"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Confirm Modal (for Open / Close) ────────────────────────────────────────

function ConfirmModal({
  type,
  ticket,
  onClose,
  onConfirm,
  isPending,
}: {
  type: "open" | "close";
  ticket: Ticket;
  onClose: () => void;
  onConfirm: () => void;
  isPending: boolean;
}) {
  const cfg = {
    open: {
      icon: RotateCcw,
      iconBg: "bg-blue-500/10",
      iconColor: "text-blue-600",
      title: "Reopen Ticket",
      desc: "This will move the ticket back to Pending status.",
      btnCls: "bg-blue-600 hover:bg-blue-700",
      btnLabel: "Reopen",
    },
    close: {
      icon: XCircle,
      iconBg: "bg-slate-500/10",
      iconColor: "text-slate-500",
      title: "Close Ticket",
      desc: "This will permanently close the ticket. It will appear in the resolved section.",
      btnCls: "bg-slate-700 hover:bg-slate-800",
      btnLabel: "Close Ticket",
    },
  }[type];

  const Icon = cfg.icon;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-sm bg-card rounded-2xl border border-border shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <div className="px-5 py-4 border-b border-border flex items-center gap-3">
          <div className={`w-8 h-8 rounded-lg ${cfg.iconBg} flex items-center justify-center`}>
            <Icon size={15} className={cfg.iconColor} />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">{cfg.title}</p>
            <p className="text-[11px] text-muted-foreground truncate max-w-[220px]">
              #{ticket.id} · {ticket.subject}
            </p>
          </div>
        </div>
        <div className="px-5 py-4">
          <p className="text-sm text-muted-foreground">{cfg.desc}</p>
        </div>
        <div className="px-5 py-3.5 border-t border-border flex items-center justify-end gap-2.5">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:bg-muted transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isPending}
            className={`flex items-center gap-2 px-5 py-2 rounded-lg text-white text-sm font-medium transition-colors disabled:opacity-50 ${cfg.btnCls}`}
          >
            {isPending ? <Loader2 size={13} className="animate-spin" /> : <Icon size={13} />}
            {isPending ? "Please wait…" : cfg.btnLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Ticket Card ──────────────────────────────────────────────────────────────

function TicketCard({
  ticket,
  onAction,
}: {
  ticket: Ticket;
  onAction: (type: "open" | "resolve" | "close", ticket: Ticket) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const isActive = ticket.status === "Pending" || ticket.status === "InProgress";
  const isClosed = ticket.status === "Closed";

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden hover:border-border/80 hover:shadow-sm transition-all">
      <div className="px-5 py-4">
        <div className="flex items-start gap-3">
          <div
            className={`w-1 self-stretch rounded-full shrink-0 mt-0.5 ${
              priorityConfig[ticket.priority]?.dot ?? "bg-muted"
            }`}
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
                <span className="text-[11px] text-muted-foreground">{ticket.customer_phone}</span>
              )}
              {fmtDate(ticket.created_at) && (
                <span className="text-[11px] text-muted-foreground">{fmtDate(ticket.created_at)}</span>
              )}
              {ticket.assigned_to && (
                <span className="flex items-center gap-1 text-[11px] text-blue-600">
                  <UserCheck size={10} />
                  {ticket.assigned_to}
                </span>
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
                    <ChevronDown
                      size={10}
                      className={`transition-transform ${expanded ? "rotate-180" : ""}`}
                    />
                  </button>
                )}
              </div>
            )}

            {/* ── Action buttons ── */}
            <div className="flex items-center gap-1.5 mt-3 pt-3 border-t border-border/50">
              {/* Reopen — shown when not active */}
              {!isActive && (
                <button
                  onClick={() => onAction("open", ticket)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium border border-blue-400/30 bg-blue-500/5 text-blue-600 hover:bg-blue-500/10 transition-colors"
                >
                  <RotateCcw size={10} />
                  {isClosed ? "Reopen" : "Open"}
                </button>
              )}

              {/* Resolve — shown when active (Pending / InProgress) */}
              {isActive && (
                <button
                  onClick={() => onAction("resolve", ticket)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium border border-emerald-400/30 bg-emerald-500/5 text-emerald-600 hover:bg-emerald-500/10 transition-colors"
                >
                  <CheckCircle2 size={10} />
                  Resolve
                </button>
              )}

              {/* Close — shown when not already closed */}
              {!isClosed && (
                <button
                  onClick={() => onAction("close", ticket)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium border border-slate-400/20 bg-slate-500/5 text-slate-500 hover:bg-slate-500/10 transition-colors"
                >
                  <XCircle size={10} />
                  Close
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── AllTickets page ──────────────────────────────────────────────────────────

const STATUS_TABS: StatusFilter[] = ["All", "Pending", "InProgress", "Resolved", "Closed"];

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

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("All");
  const [priorityFilter, setPriorityFilter] = useState<string>("All");
  const [modal, setModal] = useState<ActionModal>(null);

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

  // ── Mutations ────────────────────────────────────────────────────────────────

  const invalidate = () => invalidateTicketQueries(queryClient);

  const openMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetchWithAuth(`/api/tickets/reopen/${id}`, { method: "PUT" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    },
    onSuccess: () => {
      toast.success("Ticket reopened to Pending");
      setModal(null);
      invalidate();
    },
    onError: () => toast.error("Failed to reopen ticket"),
  });

  const resolveMutation = useMutation({
    mutationFn: async ({
      id,
      rating,
      remarks,
    }: {
      id: number;
      rating: number;
      remarks: string;
    }) => {
      const res = await fetchWithAuth(`/api/tickets/resolve/${id}`, {
        method: "PUT",
        body: JSON.stringify({ resolution_note: null, rating, review_remarks: remarks || null }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    },
    onSuccess: () => {
      toast.success("Ticket resolved successfully");
      setModal(null);
      invalidate();
    },
    onError: () => toast.error("Failed to resolve ticket"),
  });

  const closeMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetchWithAuth(`/api/tickets/close/${id}`, { method: "PUT" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    },
    onSuccess: () => {
      toast.success("Ticket closed");
      setModal(null);
      invalidate();
    },
    onError: () => toast.error("Failed to close ticket"),
  });

  // ── Filter / search ──────────────────────────────────────────────────────────

  const tickets = useMemo(() => {
    let list = [...allTickets];
    if (statusFilter !== "All") list = list.filter((t) => t.status === statusFilter);
    if (priorityFilter !== "All") list = list.filter((t) => t.priority === priorityFilter);
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

  const tabCounts: Record<StatusFilter, number> = {
    All: allTickets.length,
    Pending: allTickets.filter((t) => t.status === "Pending").length,
    InProgress: allTickets.filter((t) => t.status === "InProgress").length,
    Resolved: allTickets.filter((t) => t.status === "Resolved").length,
    Closed: allTickets.filter((t) => t.status === "Closed").length,
  };

  const urgentCount = allTickets.filter((t) => t.priority === "Urgent").length;
  const isFiltered = statusFilter !== "All" || priorityFilter !== "All" || search.trim();

  const handleAction = (type: "open" | "resolve" | "close", ticket: Ticket) => {
    setModal({ type, ticket } as ActionModal);
  };

  // ── Render ───────────────────────────────────────────────────────────────────

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
              <h1 className="text-xl font-heading font-bold text-foreground">All Tickets</h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                {allTickets.length} total
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
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
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
            <span className="text-[11px] text-muted-foreground font-medium">Priority:</span>
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
              {isFiltered ? "No tickets match your filters" : "No tickets found"}
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
            {tickets.map((t) => (
              <TicketCard key={t.id} ticket={t} onAction={handleAction} />
            ))}
          </div>
        )}

        {!isLoading && tickets.length > 0 && isFiltered && (
          <p className="text-xs text-muted-foreground text-center">
            Showing {tickets.length} of {allTickets.length} tickets
          </p>
        )}
      </div>

      {/* ── Modals ── */}
      {modal?.type === "resolve" && (
        <ResolveModal
          ticket={modal.ticket}
          onClose={() => setModal(null)}
          isPending={resolveMutation.isPending}
          onSubmit={(rating, remarks) =>
            resolveMutation.mutate({ id: modal.ticket.id, rating, remarks })
          }
        />
      )}

      {(modal?.type === "open" || modal?.type === "close") && (
        <ConfirmModal
          type={modal.type}
          ticket={modal.ticket}
          onClose={() => setModal(null)}
          isPending={
            modal.type === "open" ? openMutation.isPending : closeMutation.isPending
          }
          onConfirm={() =>
            modal.type === "open"
              ? openMutation.mutate(modal.ticket.id)
              : closeMutation.mutate(modal.ticket.id)
          }
        />
      )}
    </>
  );
};

export default AllTickets;