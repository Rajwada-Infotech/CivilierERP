import React, { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { AdminShell } from "@/components/admin/AdminShell";
import { useAuth } from "@/contexts/AuthContext";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  Flame,
  Loader2,
  Lock,
  MessageCircle,
  RefreshCw,
  ShieldAlert,
  User,
  UserCheck,
  Workflow,
  X,
} from "lucide-react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useTicketSync } from "@/hooks/useTicketSync";
import { invalidateTicketQueries } from "@/lib/ticketQuerySync";
import {
  TicketListResponse,
  unwrapTicketList,
} from "@/lib/ticketListResponse";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import TicketChat from "@/pages/ticket/TicketChat";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type TicketStatus = "Pending" | "InProgress" | "Resolved" | "Closed";
type TicketPriority = "Low" | "Medium" | "High" | "Urgent";

interface Ticket {
  id: number;
  subject: string;
  priority: TicketPriority;
  issue_details: string;
  customer_name: string;
  customer_phone: string | null;
  status: TicketStatus;
  assigned_to: string | null;
  assigned_to_id: number | null;
  resolved_by: string | null;
  resolution_note: string | null;
  created_by: string | null;
  comment_count: number;
  escalated_at: string | null;
  escalation_level: number;
  escalation_reason: string | null;
  created_at: string;
  updated_at: string | null;
}

interface TicketComment {
  id: number;
  ticket_id: number;
  comment: string;
  author_name: string;
  author_role: string;
  created_at: string;
  is_internal?: boolean | number;
}

interface TicketStats {
  counts: {
    total: number;
    pending: number;
    in_progress: number;
    resolved: number;
    closed: number;
    escalated_open: number;
    urgent_open: number;
    high_open: number;
  };
}

interface AdminUser {
  id: number;
  name: string;
  role: string;
}

const priorityRank: Record<TicketPriority, number> = {
  Urgent: 0,
  High: 1,
  Medium: 2,
  Low: 3,
};

const priorityBar: Record<TicketPriority, string> = {
  Urgent: "bg-red-500",
  High: "bg-orange-500",
  Medium: "bg-amber-400",
  Low: "bg-blue-400",
};

const priorityBadge: Record<TicketPriority, string> = {
  Urgent: "bg-red-50 text-red-800 border-red-200",
  High: "bg-orange-50 text-orange-800 border-orange-200",
  Medium: "bg-amber-50 text-amber-800 border-amber-200",
  Low: "bg-blue-50 text-blue-800 border-blue-200",
};

const priorityDot: Record<TicketPriority, string> = {
  Urgent: "bg-red-500",
  High: "bg-orange-500",
  Medium: "bg-amber-400",
  Low: "bg-blue-400",
};

const statusBadge: Record<
  TicketStatus,
  { cls: string; Icon: React.ElementType; label: string }
> = {
  Pending: {
    cls: "bg-amber-50 text-amber-800 border-amber-200",
    Icon: Clock,
    label: "Pending",
  },
  InProgress: {
    cls: "bg-blue-50 text-blue-800 border-blue-200",
    Icon: RefreshCw,
    label: "Resolving",
  },
  Resolved: {
    cls: "bg-green-50 text-green-800 border-green-200",
    Icon: CheckCircle2,
    label: "Resolved",
  },
  Closed: {
    cls: "bg-slate-100 text-slate-500 border-slate-200",
    Icon: Lock,
    label: "Closed",
  },
};

const fmtDate = (date?: string | null) =>
  date
    ? new Date(date).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";

function PriorityBadge({ priority }: { priority: TicketPriority }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border",
        priorityBadge[priority],
      )}
    >
      <span className={cn("w-1.5 h-1.5 rounded-full", priorityDot[priority])} />
      {priority}
    </span>
  );
}

function StatusBadge({ status }: { status: TicketStatus }) {
  const cfg = statusBadge[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border",
        cfg.cls,
      )}
    >
      <cfg.Icon size={9} />
      {cfg.label}
    </span>
  );
}

/* ─── Ticket detail modal ─────────────────────────────────────────── */

function TicketDetailDialog({
  ticket,
  users,
  onClose,
}: {
  ticket: Ticket;
  users: AdminUser[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { currentUser } = useAuth();
  const [assigneeId, setAssigneeId] = useState<string | undefined>(undefined);
  const [resolutionNote, setResolutionNote] = useState("");
  const [showResolve, setShowResolve] = useState(false);

  const { data, isLoading, refetch } = useQuery<{
    ticket: Ticket;
    comments: TicketComment[];
  }>({
    queryKey: ["admin-ticket-detail", ticket.id],
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/tickets/${ticket.id}`);
      if (!res.ok) throw new Error("Failed to load ticket");
      return res.json().catch(() => ({}));
    },
    staleTime: 0,
    refetchInterval: () =>
      document.visibilityState === "visible" ? 15_000 : false,
    refetchOnWindowFocus: true,
  });

  useTicketSync(refetch, ticket.id);

  const inv = () => invalidateTicketQueries(queryClient);

  const assignMutation = useMutation({
    mutationFn: async () => {
      const user = users.find((u) => String(u.id) === assigneeId);
      if (!user) throw new Error("Select a user");
      const res = await fetchWithAuth(`/api/tickets/assign/${ticket.id}`, {
        method: "PUT",
        body: JSON.stringify({
          assigned_to_id: user.id,
          assigned_to: user.name,
        }),
      });
      if (!res.ok) throw new Error("Failed");
    },
    onSuccess: () => {
      toast.success("Ticket assigned");
      inv();
    },
    onError: () => toast.error("Could not assign ticket"),
  });

  const resolveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetchWithAuth(`/api/tickets/resolve/${ticket.id}`, {
        method: "PUT",
        body: JSON.stringify({ resolution_note: resolutionNote }),
      });
      if (!res.ok) throw new Error("Failed");
    },
    onSuccess: () => {
      toast.success("Ticket resolved");
      setShowResolve(false);
      setResolutionNote("");
      inv();
    },
    onError: () => toast.error("Could not resolve ticket"),
  });

  const closeMutation = useMutation({
    mutationFn: async () => {
      const res = await fetchWithAuth(`/api/tickets/close/${ticket.id}`, {
        method: "PUT",
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error("Failed");
    },
    onSuccess: () => {
      toast.success("Ticket closed");
      inv();
    },
    onError: () => toast.error("Could not close ticket"),
  });

  const t = data?.ticket ?? ticket;
  const comments = data?.comments ?? [];
  const canWork = t.status === "Pending" || t.status === "InProgress";

  return (
    <Dialog open onOpenChange={onClose}>
      {/*
        Hide shadcn's default absolute close button — we render our own inside the header row.
        The [&>button:first-of-type]:hidden selector targets the auto-injected × button.
      */}
      <DialogContent className="max-w-xl p-0 gap-0 overflow-hidden [&>button:first-of-type]:hidden">
        {/* Header — ticket id | subject | close — all in one row, no overlap possible */}
        <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-border">
          <span className="shrink-0 font-mono text-[11px] font-medium text-muted-foreground bg-muted border border-border rounded px-1.5 py-0.5">
            #{t.id}
          </span>
          <h2 className="flex-1 text-sm font-semibold text-foreground leading-snug truncate">
            {t.subject}
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 w-7 h-7 flex items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition"
          >
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto max-h-[75vh] px-5 py-4 space-y-4">
          {isLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-10 rounded-lg bg-muted animate-pulse" />
            ))
          ) : (
            <>
              {/* Badges */}
              <div className="flex flex-wrap gap-1.5">
                <PriorityBadge priority={t.priority} />
                <StatusBadge status={t.status} />
                {t.assigned_to && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border bg-primary/5 text-primary border-primary/20">
                    <UserCheck size={9} />
                    {t.assigned_to}
                  </span>
                )}
                {t.escalated_at && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border bg-red-50 text-red-800 border-red-200">
                    <ShieldAlert size={9} />
                    Escalated
                  </span>
                )}
              </div>

              {/* Meta grid */}
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: "Customer", value: t.customer_name },
                  { label: "Phone", value: t.customer_phone || "—" },
                  { label: "Raised by", value: t.created_by || "—" },
                  { label: "Created", value: fmtDate(t.created_at) },
                ].map(({ label, value }) => (
                  <div key={label} className="rounded-lg bg-muted/50 px-3 py-2">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-0.5">
                      {label}
                    </p>
                    <p className="text-xs font-medium text-foreground">
                      {value}
                    </p>
                  </div>
                ))}
              </div>

              {/* Issue details */}
              <div className="rounded-lg border border-border bg-muted/20 px-3.5 py-2.5 text-sm whitespace-pre-wrap leading-relaxed text-foreground">
                {t.issue_details}
              </div>

              {/* Resolution note */}
              {t.resolution_note && (
                <div className="rounded-lg border border-green-200 bg-green-50 px-3.5 py-2.5">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-green-700 mb-1">
                    Resolution
                  </p>
                  <p className="text-sm text-green-900">{t.resolution_note}</p>
                  {t.resolved_by && (
                    <p className="mt-1 text-xs text-green-600">
                      By {t.resolved_by}
                    </p>
                  )}
                </div>
              )}

              {t.escalated_at && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5">
                  <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-red-700 mb-1">
                    <ShieldAlert size={11} />
                    Escalation
                  </p>
                  <p className="text-sm text-red-900">
                    {t.escalation_reason || "This ticket was auto-escalated."}
                  </p>
                  <p className="mt-1 text-xs text-red-600">
                    {fmtDate(t.escalated_at)}
                  </p>
                </div>
              )}

              {/* Admin workflow */}
              <div className="rounded-lg border border-border bg-muted/30 px-3.5 py-3 space-y-2.5">
                <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  <Workflow size={11} />
                  Admin workflow
                </p>

                {canWork && (
                  <div className="flex gap-2">
                    <Select value={assigneeId} onValueChange={setAssigneeId}>
                      <SelectTrigger className="h-8 flex-1 text-xs">
                        <SelectValue placeholder="Assign to required person" />
                      </SelectTrigger>
                      <SelectContent>
                        {users.map((u) => (
                          <SelectItem
                            key={u.id}
                            value={String(u.id)}
                            className="text-xs"
                          >
                            {u.name} ({u.role})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs px-3"
                      disabled={!assigneeId || assignMutation.isPending}
                      onClick={() => assignMutation.mutate()}
                    >
                      {assignMutation.isPending ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <UserCheck size={12} />
                      )}
                      Assign
                    </Button>
                  </div>
                )}

                {canWork && !showResolve && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs px-3 text-green-700 border-green-200 bg-green-50 hover:bg-green-100 hover:text-green-800"
                    onClick={() => setShowResolve(true)}
                  >
                    <CheckCircle2 size={12} />
                    Mark resolved
                  </Button>
                )}

                {canWork && showResolve && (
                  <div className="space-y-2">
                    <Textarea
                      value={resolutionNote}
                      onChange={(e) => setResolutionNote(e.target.value)}
                      placeholder="Resolution note (optional)"
                      rows={3}
                      className="resize-none text-xs"
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        className="h-8 text-xs bg-gradient-to-r from-blue-500 to-indigo-600 shadow-sm text-white hover:opacity-90"
                        disabled={resolveMutation.isPending}
                        onClick={() => resolveMutation.mutate()}
                      >
                        {resolveMutation.isPending ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : (
                          <CheckCircle2 size={12} />
                        )}
                        Resolve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-xs"
                        onClick={() => setShowResolve(false)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}

                {t.status === "Resolved" && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs px-3"
                    disabled={closeMutation.isPending}
                    onClick={() => closeMutation.mutate()}
                  >
                    {closeMutation.isPending ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <Lock size={12} />
                    )}
                    Close ticket
                  </Button>
                )}
              </div>

              <TicketChat
                ticketId={t.id}
                currentUser={{
                  id: Number(currentUser?.id ?? 0),
                  name: currentUser?.name ?? "Admin",
                  role: currentUser?.role ?? "admin",
                }}
                initialMessages={comments}
                ticketStatus={t.status}
                className="border-border"
                onSent={() => {
                  inv();
                }}
              />
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Admin ticket panel ──────────────────────────────────────────── */

export default function AdminTicketPanel() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<"open" | "resolved" | "closed" | "all">(
    "open",
  );
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [page, setPage] = useState(1);
  const limit = 25;

  const {
    data: stats,
    isLoading: statsLoading,
    isFetching: statsFetching,
    refetch: refetchStats,
  } = useQuery<TicketStats>({
    queryKey: ["admin-ticket-stats"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/tickets/stats");
      if (!res.ok) throw new Error("Failed");
      return res.json().catch(() => ({}));
    },
    refetchInterval: () =>
      document.visibilityState === "visible" ? 15_000 : false,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

  const {
    data: ticketResponse,
    isLoading: ticketsLoading,
    isFetching: ticketsFetching,
    refetch: refetchTickets,
  } = useQuery<TicketListResponse<Ticket>>({
    queryKey: ["admin-tickets", page, limit],
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/tickets?page=${page}&limit=${limit}`);
      if (!res.ok) throw new Error("Failed");
      return unwrapTicketList<Ticket>(await res.json().catch(() => ({})));
    },
    staleTime: 0,
    refetchInterval: () =>
      document.visibilityState === "visible" ? 15_000 : false,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

  const allTickets = ticketResponse?.data ?? [];
  const pagination = ticketResponse?.pagination;

  const { data: users = [] } = useQuery<AdminUser[]>({
    queryKey: ["admin-ticket-users"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/tickets/admin-users");
      if (!res.ok) throw new Error("Failed");
      const raw = await res.json().catch(() => ({}));
      return Array.isArray(raw)
        ? raw.map((u) => ({
            id: u.id,
            name: u.name,
            role: u.role || "user",
          }))
        : [];
    },
    staleTime: 5 * 60_000,
  });

  useTicketSync(
    useCallback(() => {
      refetchStats();
      refetchTickets();
    }, [refetchStats, refetchTickets]),
  );

  const tickets = useMemo(() => {
    const filtered = allTickets.filter((t) => {
      if (filter === "open")
        return t.status === "Pending" || t.status === "InProgress";
      if (filter === "resolved") return t.status === "Resolved";
      if (filter === "closed") return t.status === "Closed";
      return true;
    });
    return filtered.sort((a, b) => {
      const sa = a.status === "Pending" ? 0 : a.status === "InProgress" ? 1 : 2;
      const sb = b.status === "Pending" ? 0 : b.status === "InProgress" ? 1 : 2;
      if (sa !== sb) return sa - sb;
      const ea = a.escalated_at ? 0 : 1;
      const eb = b.escalated_at ? 0 : 1;
      if (ea !== eb) return ea - eb;
      const pd = priorityRank[a.priority] - priorityRank[b.priority];
      if (pd !== 0) return pd;
      return (
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    });
  }, [allTickets, filter]);

  const counts = stats?.counts;
  const isBusy = statsFetching || ticketsFetching;

  const tabs: {
    id: "open" | "resolved" | "closed" | "all";
    label: string;
    value: number;
    activeColor: string;
  }[] = [
    {
      id: "open",
      label: "Open",
      value: (counts?.pending ?? 0) + (counts?.in_progress ?? 0),
      activeColor: "text-amber-600",
    },
    {
      id: "resolved",
      label: "Resolved",
      value: counts?.resolved ?? 0,
      activeColor: "text-green-600",
    },
    {
      id: "closed",
      label: "Closed",
      value: counts?.closed ?? 0,
      activeColor: "text-slate-500",
    },
    {
      id: "all",
      label: "All",
      value: counts?.total ?? 0,
      activeColor: "text-foreground",
    },
  ];

  return (
    <>
      <Breadcrumbs items={["Admin", "Support Tickets"]} />
      <AdminShell title="Support Tickets" icon={MessageCircle}>
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {/* ── Header ── */}
        <div className="flex items-center justify-between gap-3 px-[18px] py-3.5 border-b border-border">
          <div className="flex items-center gap-2 min-w-0">
            <MessageCircle
              size={15}
              className="text-muted-foreground shrink-0"
            />
            <span className="text-[13px] font-medium text-foreground">
              Support Tickets
            </span>
            {(counts?.urgent_open ?? 0) > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-red-50 text-red-800 border border-red-200">
                <ShieldAlert size={9} />
                {counts.urgent_open} urgent
              </span>
            )}
            {(counts?.escalated_open ?? 0) > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-red-50 text-red-800 border border-red-200">
                <Flame size={9} />
                {counts.escalated_open} escalated
              </span>
            )}
          </div>
          <div className="flex items-center gap-2.5 shrink-0">
            <button
              onClick={() => {
                refetchStats();
                refetchTickets();
              }}
              disabled={isBusy}
              className="w-7 h-7 flex items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted hover:text-foreground transition disabled:opacity-40"
              title="Refresh"
            >
              <RefreshCw size={12} className={isBusy ? "animate-spin" : ""} />
            </button>
            <button
              onClick={() => navigate("/ticket")}
              className="flex items-center gap-1 text-[12px] font-medium text-primary hover:underline"
            >
              Ticket page <ExternalLink size={10} />
            </button>
          </div>
        </div>

        {/* ── Tabs ── */}
        <div className="grid grid-cols-4 border-b border-border">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => {
                setFilter(tab.id);
                setPage(1);
              }}
              className={cn(
                "py-3 text-center border-b-2 transition-colors",
                filter === tab.id
                  ? "bg-card border-primary"
                  : "border-transparent bg-muted/30 hover:bg-muted/50",
              )}
            >
              <span
                className={cn(
                  "block text-[22px] font-medium leading-tight tabular-nums",
                  filter === tab.id ? tab.activeColor : "text-foreground",
                  statsLoading && "opacity-30",
                )}
              >
                {statsLoading ? "—" : tab.value}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {tab.label}
              </span>
            </button>
          ))}
        </div>

        {/* ── Ticket rows ── */}
        <div className="max-h-96 overflow-y-auto">
          {ticketsLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="flex items-stretch gap-0 border-b border-border animate-pulse"
              >
                <div className="w-[3px] bg-muted shrink-0" />
                <div className="flex-1 px-4 py-3.5 space-y-2">
                  <div className="h-3.5 rounded bg-muted w-2/3" />
                  <div className="h-3 rounded bg-muted w-1/3" />
                </div>
              </div>
            ))
          ) : tickets.length === 0 ? (
            <div className="py-12 flex flex-col items-center gap-2 text-muted-foreground">
              <CheckCircle2 size={24} className="opacity-20" />
              <p className="text-xs">
                {filter === "open" ? "No open tickets" : `No ${filter} tickets`}
              </p>
            </div>
          ) : (
            tickets.map((ticket) => (
              <button
                key={ticket.id}
                onClick={() => setSelectedTicket(ticket)}
                className="w-full flex items-stretch text-left border-b border-border last:border-b-0 hover:bg-muted/40 active:bg-muted/60 transition-colors group"
              >
                {/* Priority colour bar — flush, no border-radius */}
                <div
                  className={cn(
                    "w-[3px] shrink-0",
                    priorityBar[ticket.priority],
                  )}
                  style={{ borderRadius: 0 }}
                />

                {/* Content */}
                <div className="flex flex-1 items-center justify-between gap-3 px-4 py-3 min-w-0">
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-foreground truncate leading-snug">
                      {ticket.subject}
                    </p>
                    <div className="mt-1 flex items-center gap-2.5 flex-wrap text-[11px] text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <User size={9} />
                        {ticket.customer_name}
                      </span>
                      {ticket.assigned_to && (
                        <span className="flex items-center gap-1">
                          <UserCheck size={9} />
                          {ticket.assigned_to}
                        </span>
                      )}
                      {(ticket.comment_count ?? 0) > 0 && (
                        <span className="flex items-center gap-1">
                          <MessageCircle size={9} />
                          {ticket.comment_count}
                        </span>
                      )}
                      {ticket.escalated_at && (
                        <span className="flex items-center gap-1 text-red-700">
                          <ShieldAlert size={9} />
                          Escalated
                        </span>
                      )}
                      <span>{fmtDate(ticket.created_at)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <PriorityBadge priority={ticket.priority} />
                    <StatusBadge status={ticket.status} />
                    <ChevronRight
                      size={13}
                      className="text-muted-foreground opacity-0 group-hover:opacity-60 transition ml-0.5 shrink-0"
                    />
                  </div>
                </div>
              </button>
            ))
          )}
        </div>

        {pagination && pagination.totalPages > 1 && (
          <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-t border-border bg-muted/20">
            <span className="text-[11px] text-muted-foreground tabular-nums">
              Page {pagination.page} of {pagination.totalPages} - {pagination.total} total
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setPage((value) => Math.max(1, value - 1))}
                disabled={pagination.page <= 1 || ticketsFetching}
                className="w-7 h-7 inline-flex items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
                title="Previous page"
              >
                <ChevronLeft size={13} />
              </button>
              <button
                type="button"
                onClick={() =>
                  setPage((value) => Math.min(pagination.totalPages, value + 1))
                }
                disabled={pagination.page >= pagination.totalPages || ticketsFetching}
                className="w-7 h-7 inline-flex items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
                title="Next page"
              >
                <ChevronRight size={13} />
              </button>
            </div>
          </div>
        )}

        {selectedTicket && (
          <TicketDetailDialog
            ticket={selectedTicket}
            users={users}
            onClose={() => setSelectedTicket(null)}
          />
        )}
      </div>
      </AdminShell>
    </>
  );
}
