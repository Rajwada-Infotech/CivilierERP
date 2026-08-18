import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { AdminShell } from "@/components/admin/AdminShell";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { invalidateTicketQueries } from "@/lib/ticketQuerySync";
import { unwrapTicketList } from "@/lib/ticketListResponse";
import { useTicketSync } from "@/hooks/useTicketSync";
import { cn } from "@/lib/utils";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Clock,
  Flame,
  Loader2,
  RefreshCw,
  Search,
  ShieldAlert,
  User,
  X,
  MessageCircle,
  CalendarDays,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

// ─── Types ────────────────────────────────────────────────────────────────────

type Priority = "Low" | "Medium" | "High" | "Urgent";
type Status = "Pending" | "InProgress" | "Resolved" | "Closed";

interface Ticket {
  id: number;
  subject: string;
  priority: Priority;
  issue_details: string;
  customer_name: string;
  customer_phone: string | null;
  status: Status;
  assigned_to: string | null;
  created_by: string | null;
  comment_count?: number;
  created_at: string;
  updated_at: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtDate = (d?: string | null) =>
  d
    ? new Date(d).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";

const fmtTime = (d?: string | null) =>
  d
    ? new Date(d).toLocaleTimeString("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

const priorityRank: Record<Priority, number> = {
  Urgent: 0,
  High: 1,
  Medium: 2,
  Low: 3,
};

const priorityCfg: Record<Priority, { cls: string; dot: string; bar: string }> =
  {
    Urgent: {
      cls: "bg-red-500/10 text-red-600 border-red-400/20",
      dot: "bg-red-500",
      bar: "bg-red-500",
    },
    High: {
      cls: "bg-orange-500/10 text-orange-600 border-orange-400/20",
      dot: "bg-orange-500",
      bar: "bg-orange-500",
    },
    Medium: {
      cls: "bg-amber-500/10 text-amber-600 border-amber-400/20",
      dot: "bg-amber-400",
      bar: "bg-amber-400",
    },
    Low: {
      cls: "bg-blue-500/10 text-blue-600 border-blue-400/20",
      dot: "bg-blue-400",
      bar: "bg-blue-400",
    },
  };

const statusCfg: Record<Status, { cls: string; label: string }> = {
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

// ─── Badges ───────────────────────────────────────────────────────────────────

function PriorityBadge({ priority }: { priority: Priority }) {
  const cfg = priorityCfg[priority];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold border",
        cfg.cls,
      )}
    >
      <span className={cn("w-1.5 h-1.5 rounded-full", cfg.dot)} />
      {priority}
    </span>
  );
}

function StatusBadge({ status }: { status: Status }) {
  const cfg = statusCfg[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border",
        cfg.cls,
      )}
    >
      <Clock size={9} />
      {cfg.label}
    </span>
  );
}

// ─── Resolve Dialog ───────────────────────────────────────────────────────────

function ResolveDialog({
  ticket,
  onClose,
  onConfirm,
  pending,
}: {
  ticket: Ticket;
  onClose: () => void;
  onConfirm: (note: string) => void;
  pending: boolean;
}) {
  const [note, setNote] = useState("");

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md p-0 gap-0 overflow-hidden">
        <DialogTitle className="sr-only">Resolve Ticket #{ticket.id}</DialogTitle>
        <DialogDescription className="sr-only">
          Approve resolution for this support ticket
        </DialogDescription>

        {/* Header */}
        <div className="px-5 py-4 border-b border-border flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0">
            <CheckCircle2 size={15} className="text-emerald-600" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">
              Approve Resolution
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5 truncate max-w-[280px]">
              #{ticket.id} · {ticket.subject}
            </p>
          </div>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-3">
          <div className="rounded-xl bg-muted/40 border border-border px-4 py-3 space-y-1.5">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <User size={11} />
              <span>{ticket.customer_name || "—"}</span>
              {ticket.customer_phone && (
                <span className="text-muted-foreground/60">
                  · {ticket.customer_phone}
                </span>
              )}
            </div>
            <p className="text-xs text-foreground leading-relaxed line-clamp-3">
              {ticket.issue_details}
            </p>
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              Resolution Note{" "}
              <span className="text-muted-foreground/50 normal-case tracking-normal font-normal">
                (optional)
              </span>
            </label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Describe how this was resolved…"
              rows={3}
              className="resize-none text-sm"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-border flex items-center justify-end gap-2.5">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:bg-muted transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(note)}
            disabled={pending}
            className="flex items-center gap-2 px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium transition-colors disabled:opacity-60"
          >
            {pending ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <CheckCircle2 size={13} />
            )}
            {pending ? "Resolving…" : "Confirm Resolution"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Ticket Row ───────────────────────────────────────────────────────────────

function TicketRow({
  ticket,
  onResolve,
}: {
  ticket: Ticket;
  onResolve: (t: Ticket) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const bar = priorityCfg[ticket.priority]?.bar ?? "bg-muted";
  const isLong = (ticket.issue_details?.length ?? 0) > 100;

  return (
    <div className="group rounded-xl border border-border bg-card hover:border-primary/30 hover:shadow-md hover:bg-card/80 transition-all overflow-hidden">
      <div className="flex items-stretch">
        {/* Priority bar */}
        <div className={cn("w-1 shrink-0", bar)} />

        <div className="flex-1 px-4 py-3.5 min-w-0">
          {/* Top row */}
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-[10px] text-muted-foreground/60">
                  #{ticket.id}
                </span>
                <h3 className="text-sm font-semibold text-foreground leading-snug truncate">
                  {ticket.subject}
                </h3>
              </div>

              {/* Meta */}
              <div className="flex items-center gap-3 mt-1 flex-wrap">
                <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <User size={10} />
                  <span>{ticket.customer_name || "—"}</span>
                </div>
                {ticket.assigned_to && (
                  <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <span className="text-muted-foreground/40">→</span>
                    <span>{ticket.assigned_to}</span>
                  </div>
                )}
                <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <CalendarDays size={10} />
                  <span>
                    {fmtDate(ticket.created_at)} {fmtTime(ticket.created_at)}
                  </span>
                </div>
                {(ticket.comment_count ?? 0) > 0 && (
                  <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <MessageCircle size={10} />
                    <span>{ticket.comment_count}</span>
                  </div>
                )}
              </div>

              {/* Issue details */}
              {ticket.issue_details && (
                <div className="mt-2">
                  <p
                    className={cn(
                      "text-xs text-muted-foreground leading-relaxed",
                      !expanded && "line-clamp-2",
                    )}
                  >
                    {ticket.issue_details}
                  </p>
                  {isLong && (
                    <button
                      onClick={() => setExpanded((p) => !p)}
                      className="text-[11px] text-primary mt-0.5 hover:underline flex items-center gap-0.5"
                    >
                      {expanded ? "Show less" : "Show more"}
                      <ChevronDown
                        size={10}
                        className={cn(
                          "transition-transform",
                          expanded && "rotate-180",
                        )}
                      />
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Right: badges + action */}
            <div className="flex flex-col items-end gap-2 shrink-0">
              <div className="flex items-center gap-1.5">
                <PriorityBadge priority={ticket.priority} />
                <StatusBadge status={ticket.status} />
              </div>
              <button
                onClick={() => onResolve(ticket)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-emerald-600 hover:bg-emerald-500/10 border border-emerald-400/20 transition-colors"
              >
                <CheckCircle2 size={11} />
                Resolve
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Stat pill ────────────────────────────────────────────────────────────────

function StatPill({
  icon: Icon,
  label,
  value,
  color,
  bg,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  color: string;
  bg: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 px-4 py-3 rounded-xl border border-border",
        bg,
      )}
    >
      <div
        className={cn(
          "w-8 h-8 rounded-lg flex items-center justify-center",
          bg,
        )}
      >
        <Icon size={14} className={color} />
      </div>
      <div>
        <p className="text-lg font-bold text-foreground leading-none">
          {value}
        </p>
        <p className="text-[11px] text-muted-foreground mt-0.5">{label}</p>
      </div>
    </div>
  );
}

// ─── Recently Resolved Panel ──────────────────────────────────────────────────

function RecentlyResolvedPanel() {
  const { data: resolved = [], isLoading } = useQuery<Ticket[]>({
    queryKey: ["admin-resolution-recent"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/tickets?limit=100");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const all = unwrapTicketList<Ticket>(await res.json().catch(() => ({}))).data;
      return all
        .filter((t) => t.status === "Resolved" || t.status === "Closed")
        .sort(
          (a, b) =>
            new Date(b.updated_at ?? b.created_at).getTime() -
            new Date(a.updated_at ?? a.created_at).getTime(),
        )
        .slice(0, 8);
    },
    staleTime: 30_000,
  });

  if (isLoading) return null;
  if (resolved.length === 0) return null;

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <CheckCircle2 size={13} className="text-emerald-600" />
        <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Recently Resolved
        </h3>
      </div>
      <div className="divide-y divide-border">
        {resolved.map((t) => (
          <div key={t.id} className="py-2.5 first:pt-0 last:pb-0">
            <div className="flex items-start gap-2">
              <div className={cn("w-1.5 h-1.5 rounded-full shrink-0 mt-1", priorityCfg[t.priority]?.dot ?? "bg-muted")} />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-foreground truncate leading-snug">{t.subject}</p>
                <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                  {t.customer_name}
                  {t.assigned_to && <span className="text-muted-foreground/50"> · {t.assigned_to}</span>}
                </p>
                <p className="text-[10px] text-muted-foreground/50 mt-0.5">{fmtDate(t.updated_at ?? t.created_at)}</p>
              </div>
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold border bg-emerald-500/10 text-emerald-600 border-emerald-400/20 shrink-0">
                <CheckCircle2 size={8} />
                {t.status === "Closed" ? "Closed" : "Done"}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const PRIORITIES: Priority[] = ["Urgent", "High", "Medium", "Low"];

export default function TicketResolution() {
  const queryClient = useQueryClient();
  const rights = usePageRights("tickets");

  const [search, setSearch] = useState("");
  const [priorityFilter, setPriority] = useState<Priority | "All">("All");
  const [statusFilter, setStatus] = useState<"Pending" | "InProgress" | "All">(
    "All",
  );
  const [resolveTarget, setResolveTarget] = useState<Ticket | null>(null);

  // ── Fetch unresolved tickets ──────────────────────────────────────────────
  const {
    data: allTickets = [],
    isLoading,
    isError,
    refetch,
    isFetching,
  } = useQuery<Ticket[]>({
    queryKey: ["admin-resolution-tickets"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/tickets?limit=100");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const all = unwrapTicketList<Ticket>(await res.json().catch(() => ({}))).data;
      // Only unresolved: Pending or InProgress
      return all.filter(
        (t) => t.status === "Pending" || t.status === "InProgress",
      );
    },
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: () =>
      document.visibilityState === "visible" ? 20_000 : false,
  });

  useTicketSync(refetch);

  // ── Resolve mutation ──────────────────────────────────────────────────────
  const resolveMutation = useMutation({
    mutationFn: async ({ id, note }: { id: number; note: string }) => {
      const res = await fetchWithAuth(`/api/tickets/resolve/${id}`, {
        method: "PUT",
        body: JSON.stringify({ resolution_note: note }),
      });
      if (!res.ok) throw new Error("Failed to resolve");
    },
    onSuccess: () => {
      toast.success("Ticket marked as resolved");
      setResolveTarget(null);
      invalidateTicketQueries(queryClient);
      queryClient.invalidateQueries({ queryKey: ["admin-resolution-tickets"] });
    },
    onError: () => toast.error("Failed to resolve ticket"),
  });

  // ── Derived ───────────────────────────────────────────────────────────────
  const urgentCount = allTickets.filter((t) => t.priority === "Urgent").length;
  const highCount = allTickets.filter((t) => t.priority === "High").length;
  const pendingCount = allTickets.filter((t) => t.status === "Pending").length;
  const inProgressCount = allTickets.filter(
    (t) => t.status === "InProgress",
  ).length;

  const tickets = useMemo(() => {
    let list = [...allTickets];
    if (priorityFilter !== "All")
      list = list.filter((t) => t.priority === priorityFilter);
    if (statusFilter !== "All")
      list = list.filter((t) => t.status === statusFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (t) =>
          t.subject.toLowerCase().includes(q) ||
          t.customer_name?.toLowerCase().includes(q) ||
          t.issue_details?.toLowerCase().includes(q),
      );
    }
    return list.sort((a, b) => {
      const pd = priorityRank[a.priority] - priorityRank[b.priority];
      if (pd !== 0) return pd;
      const sd =
        (a.status === "Pending" ? 0 : 1) - (b.status === "Pending" ? 0 : 1);
      if (sd !== 0) return sd;
      return (
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    });
  }, [allTickets, priorityFilter, statusFilter, search]);

  const isFiltered =
    priorityFilter !== "All" || statusFilter !== "All" || search.trim();

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      <Breadcrumbs items={["Admin", "Support Tickets", "Resolution"]} />

      <AdminShell
        title="Ticket Resolution"
        subtitle={
          <>
            {allTickets.length} unresolved ticket{allTickets.length !== 1 ? "s" : ""} awaiting admin approval
            {urgentCount > 0 && (
              <span className="text-red-500 ml-1.5 font-medium">· {urgentCount} urgent</span>
            )}
          </>
        }
        icon={ShieldAlert}
        action={
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="w-8 h-8 flex items-center justify-center rounded-lg border border-border hover:bg-muted transition-colors text-muted-foreground disabled:opacity-50"
          >
            <RefreshCw size={13} className={isFetching ? "animate-spin" : ""} />
          </button>
        }
      >
      {/* ── Full-width stat pills ── */}
      {!isLoading && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          <StatPill icon={Clock} label="Pending" value={pendingCount} color="text-amber-600" bg="bg-amber-500/5" />
          <StatPill icon={RefreshCw} label="Resolving" value={inProgressCount} color="text-blue-600" bg="bg-blue-500/5" />
          <StatPill icon={ShieldAlert} label="Urgent" value={urgentCount} color="text-red-600" bg="bg-red-500/5" />
          <StatPill icon={Flame} label="High" value={highCount} color="text-orange-600" bg="bg-orange-500/5" />
        </div>
      )}

      {isError && (
        <div className="mb-5 px-4 py-3 rounded-xl bg-red-500/10 text-red-600 text-sm border border-red-500/20 flex items-center gap-2">
          <AlertCircle size={14} /> Failed to load tickets. Try refreshing.
        </div>
      )}

      {/* ── Two-column layout ── */}
      <div className="flex gap-5 items-start">

        {/* LEFT — main ticket list */}
        <div className="flex-1 min-w-0 space-y-4">

          {/* ── Filters ── */}
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
                <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  <X size={12} />
                </button>
              )}
            </div>
            <div className="flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-muted-foreground font-medium">Status:</span>
                {(["All", "Pending", "InProgress"] as const).map((s) => (
                  <button key={s} onClick={() => setStatus(s)}
                    className={cn("px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all",
                      statusFilter === s ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground hover:bg-muted")}>
                    {s === "InProgress" ? "Resolving" : s}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-muted-foreground font-medium">Priority:</span>
                {(["All", ...PRIORITIES] as const).map((p) => (
                  <button key={p} onClick={() => setPriority(p as Priority | "All")}
                    className={cn("px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all",
                      priorityFilter === p ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground hover:bg-muted")}>
                    {p}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* ── Ticket list ── */}
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="rounded-xl border border-border bg-card overflow-hidden animate-pulse">
                  <div className="flex">
                    <div className="w-1 bg-muted" />
                    <div className="flex-1 px-4 py-4 space-y-2">
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
              <CheckCircle2 size={36} className="opacity-20" />
              <p className="text-sm font-medium">
                {isFiltered ? "No tickets match your filters" : "All caught up — no unresolved tickets!"}
              </p>
              {isFiltered && (
                <button onClick={() => { setSearch(""); setPriority("All"); setStatus("All"); }}
                  className="text-xs text-primary hover:underline">
                  Clear filters
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-2.5">
              {tickets.map((t) => (
                <TicketRow key={t.id} ticket={t} onResolve={setResolveTarget} />
              ))}
            </div>
          )}

          {!isLoading && tickets.length > 0 && isFiltered && (
            <p className="text-xs text-muted-foreground text-center">
              Showing {tickets.length} of {allTickets.length} unresolved tickets
            </p>
          )}
        </div>{/* end LEFT */}

        {/* RIGHT — sidebar */}
        <div className="w-80 shrink-0 space-y-4">

          {/* Priority breakdown */}
          <div className="rounded-xl border border-border bg-card p-4 space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Priority Breakdown</h3>
            {PRIORITIES.map((p) => {
              const count = allTickets.filter((t) => t.priority === p).length;
              const total = allTickets.length || 1;
              const pct = Math.round((count / total) * 100);
              const cfg = priorityCfg[p];
              return (
                <div key={p} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 text-foreground font-medium">
                      <span className={cn("w-2 h-2 rounded-full", cfg.dot)} />
                      {p}
                    </span>
                    <span className="text-muted-foreground">{count} ticket{count !== 1 ? "s" : ""}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div className={cn("h-full rounded-full transition-all duration-500", cfg.bar)} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
            {allTickets.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-2">No open tickets</p>
            )}
          </div>

          {/* Assignee breakdown */}
          {(() => {
            const assigneeMap: Record<string, number> = {};
            allTickets.forEach((t) => {
              const name = t.assigned_to || "Unassigned";
              assigneeMap[name] = (assigneeMap[name] ?? 0) + 1;
            });
            const entries = Object.entries(assigneeMap).sort((a, b) => b[1] - a[1]).slice(0, 6);
            return (
              <div className="rounded-xl border border-border bg-card p-4 space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Assigned To</h3>
                {entries.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-2">No open tickets</p>
                ) : entries.map(([name, count]) => (
                  <div key={name} className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                        <User size={10} className="text-primary" />
                      </div>
                      <span className="text-xs text-foreground truncate">{name}</span>
                    </div>
                    <span className="text-xs font-semibold text-muted-foreground shrink-0">{count}</span>
                  </div>
                ))}
              </div>
            );
          })()}

          {/* Recently resolved */}
          {!isLoading && <RecentlyResolvedPanel />}
        </div>{/* end RIGHT */}

      </div>{/* end two-col */}
      </AdminShell>

      {/* ── Resolve dialog ── */}
      {resolveTarget && (
        <ResolveDialog
          ticket={resolveTarget}
          onClose={() => setResolveTarget(null)}
          onConfirm={(note) =>
            resolveMutation.mutate({ id: resolveTarget.id, note })
          }
          pending={resolveMutation.isPending}
        />
      )}
    </>
  );
}