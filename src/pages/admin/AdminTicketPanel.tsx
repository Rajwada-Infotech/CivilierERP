import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Clock,
  ExternalLink,
  Flame,
  Loader2,
  Lock,
  MessageCircle,
  RefreshCw,
  Send,
  ShieldAlert,
  User,
  UserCheck,
} from "lucide-react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { invalidateTicketQueries } from "@/lib/ticketQuerySync";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  created_at: string;
  updated_at: string | null;
}

interface TicketComment {
  id: number;
  comment: string;
  author_name: string;
  author_role: string;
  created_at: string;
}

interface TicketStats {
  counts: {
    total: number;
    pending: number;
    in_progress: number;
    resolved: number;
    closed: number;
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

const priorityStyle: Record<TicketPriority, { cls: string; dot: string; Icon: React.ElementType }> = {
  Urgent: { cls: "bg-red-500/10 text-red-600 border-red-400/20", dot: "bg-red-500", Icon: ShieldAlert },
  High: { cls: "bg-orange-500/10 text-orange-600 border-orange-400/20", dot: "bg-orange-500", Icon: Flame },
  Medium: { cls: "bg-amber-500/10 text-amber-600 border-amber-400/20", dot: "bg-amber-500", Icon: AlertCircle },
  Low: { cls: "bg-blue-500/10 text-blue-600 border-blue-400/20", dot: "bg-blue-500", Icon: AlertCircle },
};

const statusStyle: Record<TicketStatus, { cls: string; Icon: React.ElementType; label: string }> = {
  Pending: { cls: "bg-amber-500/10 text-amber-600 border-amber-400/20", Icon: Clock, label: "Pending" },
  InProgress: { cls: "bg-blue-500/10 text-blue-600 border-blue-400/20", Icon: RefreshCw, label: "In Progress" },
  Resolved: { cls: "bg-emerald-500/10 text-emerald-600 border-emerald-400/20", Icon: CheckCircle2, label: "Resolved" },
  Closed: { cls: "bg-muted text-muted-foreground border-border", Icon: Lock, label: "Closed" },
};

const fmtDate = (date?: string | null) =>
  date
    ? new Date(date).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "-";

function PriorityBadge({ priority }: { priority: TicketPriority }) {
  const cfg = priorityStyle[priority];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${cfg.cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {priority}
    </span>
  );
}

function StatusBadge({ status }: { status: TicketStatus }) {
  const cfg = statusStyle[status];
  const Icon = cfg.Icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${cfg.cls}`}>
      <Icon size={10} />
      {cfg.label}
    </span>
  );
}

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
  const [assigneeId, setAssigneeId] = useState("");
  const [comment, setComment] = useState("");
  const [resolutionNote, setResolutionNote] = useState("");
  const [showResolve, setShowResolve] = useState(false);

  const { data, isLoading } = useQuery<{ ticket: Ticket; comments: TicketComment[] }>({
    queryKey: ["admin-ticket-detail", ticket.id],
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/tickets/${ticket.id}`);
      if (!res.ok) throw new Error("Failed to load ticket");
      return res.json();
    },
    staleTime: 0,
    refetchInterval: 5_000,
    refetchOnWindowFocus: true,
  });

  const invalidate = () => {
    invalidateTicketQueries(queryClient);
  };

  const assignMutation = useMutation({
    mutationFn: async () => {
      const user = users.find((item) => String(item.id) === assigneeId);
      if (!user) throw new Error("Select a user");
      const res = await fetchWithAuth(`/api/tickets/assign/${ticket.id}`, {
        method: "PUT",
        body: JSON.stringify({ assigned_to_id: user.id, assigned_to: user.name }),
      });
      if (!res.ok) throw new Error("Failed to assign ticket");
    },
    onSuccess: () => {
      toast.success("Ticket assigned");
      invalidate();
    },
    onError: () => toast.error("Could not assign ticket"),
  });

  const resolveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetchWithAuth(`/api/tickets/resolve/${ticket.id}`, {
        method: "PUT",
        body: JSON.stringify({ resolution_note: resolutionNote }),
      });
      if (!res.ok) throw new Error("Failed to resolve ticket");
    },
    onSuccess: () => {
      toast.success("Ticket resolved");
      setShowResolve(false);
      setResolutionNote("");
      invalidate();
    },
    onError: () => toast.error("Could not resolve ticket"),
  });

  const closeMutation = useMutation({
    mutationFn: async () => {
      const res = await fetchWithAuth(`/api/tickets/close/${ticket.id}`, {
        method: "PUT",
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error("Failed to close ticket");
    },
    onSuccess: () => {
      toast.success("Ticket closed");
      invalidate();
    },
    onError: () => toast.error("Could not close ticket"),
  });

  const commentMutation = useMutation({
    mutationFn: async () => {
      const res = await fetchWithAuth(`/api/tickets/comment/${ticket.id}`, {
        method: "POST",
        body: JSON.stringify({ comment }),
      });
      if (!res.ok) throw new Error("Failed to add comment");
    },
    onSuccess: () => {
      toast.success("Comment added");
      setComment("");
      invalidate();
    },
    onError: () => toast.error("Could not add comment"),
  });

  const activeTicket = data?.ticket ?? ticket;
  const comments = data?.comments ?? [];
  const canWork = activeTicket.status === "Pending" || activeTicket.status === "InProgress";

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-start justify-between gap-3">
            <span className="leading-snug">{activeTicket.subject}</span>
            <span className="font-mono text-xs text-muted-foreground">#{activeTicket.id}</span>
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-3 py-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="h-10 rounded bg-muted animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="space-y-5">
            <div className="flex flex-wrap gap-2">
              <PriorityBadge priority={activeTicket.priority} />
              <StatusBadge status={activeTicket.status} />
              {activeTicket.assigned_to && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border bg-primary/10 text-primary border-primary/20">
                  <UserCheck size={10} />
                  {activeTicket.assigned_to}
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="rounded-lg bg-muted/40 px-3 py-2">
                <p className="uppercase tracking-widest text-[10px] font-semibold text-muted-foreground">Customer</p>
                <p className="font-medium text-foreground">{activeTicket.customer_name}</p>
              </div>
              <div className="rounded-lg bg-muted/40 px-3 py-2">
                <p className="uppercase tracking-widest text-[10px] font-semibold text-muted-foreground">Phone</p>
                <p className="font-medium text-foreground">{activeTicket.customer_phone || "-"}</p>
              </div>
              <div className="rounded-lg bg-muted/40 px-3 py-2">
                <p className="uppercase tracking-widest text-[10px] font-semibold text-muted-foreground">Raised By</p>
                <p className="font-medium text-foreground">{activeTicket.created_by || "-"}</p>
              </div>
              <div className="rounded-lg bg-muted/40 px-3 py-2">
                <p className="uppercase tracking-widest text-[10px] font-semibold text-muted-foreground">Created</p>
                <p className="font-medium text-foreground">{fmtDate(activeTicket.created_at)}</p>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-muted/20 px-4 py-3 text-sm whitespace-pre-wrap">
              {activeTicket.issue_details}
            </div>

            {activeTicket.resolution_note && (
              <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/5 px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-emerald-600">Resolution</p>
                <p className="mt-1 text-sm">{activeTicket.resolution_note}</p>
                {activeTicket.resolved_by && (
                  <p className="mt-1 text-xs text-muted-foreground">By {activeTicket.resolved_by}</p>
                )}
              </div>
            )}

            <div className="border-t border-border pt-4 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Admin Workflow</p>

              {canWork && (
                <div className="flex gap-2">
                  <Select value={assigneeId} onValueChange={setAssigneeId}>
                    <SelectTrigger className="h-9 flex-1 text-xs">
                      <SelectValue placeholder="Assign to required person" />
                    </SelectTrigger>
                    <SelectContent>
                      {users.map((user) => (
                        <SelectItem key={user.id} value={String(user.id)}>
                          {user.name} ({user.role})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!assigneeId || assignMutation.isPending}
                    onClick={() => assignMutation.mutate()}
                  >
                    {assignMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <UserCheck size={13} />}
                    Assign
                  </Button>
                </div>
              )}

              {canWork && !showResolve && (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-emerald-600 border-emerald-400/30 hover:bg-emerald-500/10"
                  onClick={() => setShowResolve(true)}
                >
                  <CheckCircle2 size={13} />
                  Mark Resolved
                </Button>
              )}

              {canWork && showResolve && (
                <div className="space-y-2">
                  <Textarea
                    value={resolutionNote}
                    onChange={(event) => setResolutionNote(event.target.value)}
                    placeholder="Resolution note"
                    rows={3}
                    className="resize-none"
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={resolveMutation.isPending}
                      onClick={() => resolveMutation.mutate()}
                    >
                      {resolveMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                      Resolve
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setShowResolve(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}

              {activeTicket.status === "Resolved" && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={closeMutation.isPending}
                  onClick={() => closeMutation.mutate()}
                >
                  {closeMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <Lock size={13} />}
                  Close Ticket
                </Button>
              )}
            </div>

            <div className="border-t border-border pt-4 space-y-3">
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                <MessageCircle size={12} />
                Trail ({comments.length})
              </p>

              {comments.length === 0 ? (
                <p className="text-xs text-muted-foreground">No comments yet.</p>
              ) : (
                <div className="max-h-48 overflow-y-auto space-y-2 pr-1">
                  {comments.map((item) => {
                    const adminComment = ["admin", "super_admin", "dba"].includes(item.author_role);
                    return (
                      <div
                        key={item.id}
                        className={cn(
                          "rounded-xl px-4 py-3 text-sm border",
                          adminComment ? "bg-primary/5 border-primary/20" : "bg-muted/30 border-border",
                        )}
                      >
                        <p className="whitespace-pre-wrap">{item.comment}</p>
                        <p className="mt-1 text-[10px] text-muted-foreground">
                          {item.author_name} - {adminComment ? "Admin" : "User"} - {fmtDate(item.created_at)}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}

              {activeTicket.status !== "Closed" && (
                <div className="flex gap-2">
                  <Textarea
                    value={comment}
                    onChange={(event) => setComment(event.target.value)}
                    placeholder="Add a comment or internal note"
                    rows={2}
                    className="resize-none"
                  />
                  <Button
                    size="icon"
                    disabled={!comment.trim() || commentMutation.isPending}
                    onClick={() => commentMutation.mutate()}
                  >
                    {commentMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function AdminTicketPanel() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<"open" | "resolved" | "closed" | "all">("open");
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);

  const {
    data: stats,
    isLoading: statsLoading,
    isFetching: statsFetching,
    refetch: refetchStats,
  } = useQuery<TicketStats>({
    queryKey: ["admin-ticket-stats"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/tickets/stats");
      if (!res.ok) throw new Error("Failed to load ticket stats");
      return res.json();
    },
    refetchInterval: 5_000,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

  const {
    data: allTickets = [],
    isLoading: ticketsLoading,
    isFetching: ticketsFetching,
    refetch: refetchTickets,
  } = useQuery<Ticket[]>({
    queryKey: ["admin-tickets"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/tickets");
      if (!res.ok) throw new Error("Failed to load tickets");
      return res.json();
    },
    staleTime: 0,
    refetchInterval: 5_000,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

  const { data: users = [] } = useQuery<AdminUser[]>({
    queryKey: ["admin-ticket-users"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/users");
      if (!res.ok) throw new Error("Failed to load users");
      const raw = await res.json();
      return Array.isArray(raw)
        ? raw
            .filter((user) => !user.discontinue)
            .map((user) => ({ id: user.id, name: user.name, role: user.role || user.roleName || "user" }))
        : [];
    },
    staleTime: 5 * 60_000,
  });

  const tickets = useMemo(() => {
    const filtered = allTickets.filter((ticket) => {
      if (filter === "open") return ticket.status === "Pending" || ticket.status === "InProgress";
      if (filter === "resolved") return ticket.status === "Resolved";
      if (filter === "closed") return ticket.status === "Closed";
      return true;
    });

    return filtered.sort((a, b) => {
      const statusA = a.status === "Pending" ? 0 : a.status === "InProgress" ? 1 : 2;
      const statusB = b.status === "Pending" ? 0 : b.status === "InProgress" ? 1 : 2;
      if (statusA !== statusB) return statusA - statusB;
      const priorityDiff = priorityRank[a.priority] - priorityRank[b.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [allTickets, filter]);

  const counts = stats?.counts;
  const isBusy = statsFetching || ticketsFetching;
  const pills = [
    { id: "open" as const, label: "Open", value: (counts?.pending ?? 0) + (counts?.in_progress ?? 0) },
    { id: "resolved" as const, label: "Resolved", value: counts?.resolved ?? 0 },
    { id: "closed" as const, label: "Closed", value: counts?.closed ?? 0 },
    { id: "all" as const, label: "All", value: counts?.total ?? 0 },
  ];

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <MessageCircle size={15} className="text-muted-foreground shrink-0" />
          <span className="text-sm font-semibold text-foreground">Support Tickets</span>
          {(counts?.urgent_open ?? 0) > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-red-500/10 text-red-600 border border-red-400/20">
              <ShieldAlert size={10} />
              {counts?.urgent_open} urgent
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              refetchStats();
              refetchTickets();
            }}
            disabled={isBusy}
            className="w-8 h-8 inline-flex items-center justify-center rounded-lg border border-border hover:bg-muted transition disabled:opacity-50"
            title="Refresh tickets"
          >
            <RefreshCw size={13} className={isBusy ? "animate-spin" : ""} />
          </button>
          <button
            onClick={() => navigate("/ticket")}
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            Ticket page
            <ExternalLink size={10} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-4 border-b border-border">
        {pills.map((pill) => (
          <button
            key={pill.id}
            onClick={() => setFilter(pill.id)}
            className={cn(
              "py-3 text-xs border-b-2 transition-colors",
              filter === pill.id ? "border-primary bg-primary/5" : "border-transparent hover:bg-muted/50",
            )}
          >
            <span className="block text-lg font-bold leading-none text-foreground">
              {statsLoading ? "-" : pill.value}
            </span>
            <span className="text-muted-foreground">{pill.label}</span>
          </button>
        ))}
      </div>

      <div className="divide-y divide-border max-h-96 overflow-y-auto">
        {ticketsLoading ? (
          Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="px-5 py-4 animate-pulse flex gap-3">
              <div className="w-1 h-12 rounded-full bg-muted" />
              <div className="flex-1 space-y-2">
                <div className="h-4 rounded bg-muted w-2/3" />
                <div className="h-3 rounded bg-muted w-1/3" />
              </div>
            </div>
          ))
        ) : tickets.length === 0 ? (
          <div className="py-10 flex flex-col items-center gap-2 text-muted-foreground">
            <CheckCircle2 size={24} className="opacity-25" />
            <p className="text-xs">{filter === "open" ? "No open tickets" : `No ${filter} tickets`}</p>
          </div>
        ) : (
          tickets.map((ticket) => {
            const cfg = priorityStyle[ticket.priority];
            return (
              <button
                key={ticket.id}
                onClick={() => setSelectedTicket(ticket)}
                className="w-full px-5 py-3.5 flex items-start gap-3 text-left hover:bg-muted/30 transition group"
              >
                <div className={`w-1 self-stretch rounded-full mt-0.5 shrink-0 ${cfg.dot}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium text-foreground truncate">{ticket.subject}</p>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <PriorityBadge priority={ticket.priority} />
                      <StatusBadge status={ticket.status} />
                    </div>
                  </div>
                  <div className="mt-1 flex items-center gap-3 flex-wrap text-[11px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <User size={9} />
                      {ticket.customer_name}
                    </span>
                    {ticket.assigned_to && (
                      <span className="inline-flex items-center gap-1">
                        <UserCheck size={9} />
                        {ticket.assigned_to}
                      </span>
                    )}
                    {(ticket.comment_count ?? 0) > 0 && (
                      <span className="inline-flex items-center gap-1">
                        <MessageCircle size={9} />
                        {ticket.comment_count}
                      </span>
                    )}
                    <span>{fmtDate(ticket.created_at)}</span>
                  </div>
                </div>
                <ChevronRight size={14} className="mt-1 text-muted-foreground opacity-0 group-hover:opacity-100 transition" />
              </button>
            );
          })
        )}
      </div>

      {selectedTicket && (
        <TicketDetailDialog
          ticket={selectedTicket}
          users={users}
          onClose={() => setSelectedTicket(null)}
        />
      )}
    </div>
  );
}
