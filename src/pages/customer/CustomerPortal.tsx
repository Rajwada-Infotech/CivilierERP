import React, { useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Clock,
  Loader2,
  MessageCircle,
  Plus,
  Search,
  Tag,
  Ticket,
  Users,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { TicketChat, type TicketChatMessage } from "@/pages/ticket/TicketChat";

// ─── Types ────────────────────────────────────────────────────────────────────

type Ticket = {
  id: number;
  ticket_number?: string;
  subject: string;
  issue_details?: string;
  status: string;
  priority: string;
  category?: string;
  created_at: string;
  updated_at?: string;
  customer_name?: string;
  assigned_to_name?: string;
};

type TicketDetail = {
  ticket: Ticket;
  comments: TicketChatMessage[];
  attachments?: unknown[];
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getInitials(name: string) {
  return (name ?? "U")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

function relativeTime(dateString: string) {
  const diff = Date.now() - new Date(dateString).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateString).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

const STATUS_CONFIG: Record<string, { label: string; color: string; dot: string }> = {
  Open:        { label: "Open",        color: "border-sky-400/30 bg-sky-500/10 text-sky-700",         dot: "bg-sky-500" },
  "In Progress":{ label: "In Progress",color: "border-amber-400/30 bg-amber-500/10 text-amber-700",   dot: "bg-amber-500" },
  Resolved:    { label: "Resolved",    color: "border-emerald-400/30 bg-emerald-500/10 text-emerald-700", dot: "bg-emerald-500" },
  Closed:      { label: "Closed",      color: "border-slate-400/30 bg-slate-500/10 text-slate-600",   dot: "bg-slate-400" },
};

const PRIORITY_CONFIG: Record<string, { color: string; bar: string }> = {
  Low:      { color: "text-slate-500",   bar: "bg-slate-400" },
  Medium:   { color: "text-amber-600",   bar: "bg-amber-500" },
  High:     { color: "text-orange-600",  bar: "bg-orange-500" },
  Urgent:   { color: "text-red-600",     bar: "bg-red-500" },
  Critical: { color: "text-red-700",     bar: "bg-red-600" },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? { label: status, color: "border-border bg-muted text-muted-foreground", dot: "bg-muted-foreground" };
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold", cfg.color)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", cfg.dot)} />
      {cfg.label}
    </span>
  );
}

function PriorityBadge({ priority }: { priority: string }) {
  const cfg = PRIORITY_CONFIG[priority] ?? { color: "text-muted-foreground", bar: "bg-muted-foreground" };
  return (
    <span className={cn("text-[10px] font-semibold uppercase tracking-wide", cfg.color)}>
      {priority}
    </span>
  );
}

// ─── Participants strip ───────────────────────────────────────────────────────
// Derived from the comment thread — all unique users who've participated.

function ParticipantsStrip({ comments }: { comments: TicketChatMessage[] }) {
  const participants = useMemo(() => {
    const seen = new Map<string, { name: string; role: string | null; count: number }>();
    for (const c of comments) {
      const key = c.author_id != null ? `id:${c.author_id}` : `name:${c.author_name}`;
      if (seen.has(key)) {
        seen.get(key)!.count += 1;
      } else {
        seen.set(key, { name: c.author_name, role: c.author_role, count: 1 });
      }
    }
    return Array.from(seen.values()).sort((a, b) => b.count - a.count);
  }, [comments]);

  if (participants.length === 0) return null;

  function roleColor(role: string | null) {
    const r = (role ?? "").toLowerCase();
    if (["admin", "super_admin", "dba"].includes(r)) return "bg-indigo-500 text-white";
    if (r === "engineer") return "bg-emerald-500 text-white";
    if (["customer", "user"].includes(r)) return "bg-sky-500 text-white";
    return "bg-slate-500 text-white";
  }

  return (
    <div className="rounded-2xl border border-border bg-card px-4 py-3">
      <div className="mb-2.5 flex items-center gap-2">
        <Users size={13} className="text-muted-foreground" />
        <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
          Participants ({participants.length})
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {participants.map((p, i) => (
          <div
            key={i}
            className="group flex items-center gap-2 rounded-full border border-border/60 bg-muted/30 px-2.5 py-1 transition-colors hover:bg-muted/60"
            title={`${p.name} · ${p.count} message${p.count === 1 ? "" : "s"}`}
          >
            <Avatar className="h-5 w-5 shrink-0">
              <AvatarFallback className={cn("text-[9px] font-bold", roleColor(p.role))}>
                {getInitials(p.name)}
              </AvatarFallback>
            </Avatar>
            <span className="text-[11px] font-medium text-foreground">{p.name}</span>
            {p.role && (
              <Badge variant="outline" className="h-3.5 rounded-full px-1 text-[9px] capitalize text-muted-foreground border-border/40">
                {p.role.replace(/_/g, " ")}
              </Badge>
            )}
            <span className="text-[9px] text-muted-foreground/50">{p.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({
  label,
  count,
  icon: Icon,
  color,
  active,
  onClick,
}: {
  label: string;
  count: number;
  icon: React.ElementType;
  color: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex flex-1 flex-col gap-1.5 rounded-2xl border p-4 text-left transition-all hover:shadow-md",
        active
          ? "border-primary/30 bg-primary/5 shadow-sm ring-1 ring-primary/20"
          : "border-border bg-card hover:border-border/80",
      )}
    >
      <div className={cn("flex h-8 w-8 items-center justify-center rounded-xl", color)}>
        <Icon size={15} />
      </div>
      <p className="text-2xl font-bold tabular-nums text-foreground">{count}</p>
      <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
    </button>
  );
}

// ─── Ticket row ───────────────────────────────────────────────────────────────

function TicketRow({ ticket, onClick }: { ticket: Ticket; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="group flex w-full items-start gap-4 rounded-2xl border border-border bg-card px-4 py-4 text-left transition-all hover:border-primary/30 hover:shadow-md active:scale-[0.995]"
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/10">
        <Ticket size={15} />
      </div>

      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          {ticket.ticket_number && (
            <span className="text-[10px] font-mono font-semibold text-muted-foreground/60">
              #{ticket.ticket_number}
            </span>
          )}
          <StatusBadge status={ticket.status} />
          <PriorityBadge priority={ticket.priority} />
          {ticket.category && (
            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/60">
              <Tag size={9} />
              {ticket.category}
            </span>
          )}
        </div>

        <p className="text-sm font-semibold text-foreground line-clamp-1">{ticket.subject}</p>

        {ticket.issue_details && (
          <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
            {ticket.issue_details}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground/60">
          <span className="flex items-center gap-1">
            <Clock size={9} />
            {relativeTime(ticket.updated_at ?? ticket.created_at)}
          </span>
          {ticket.assigned_to_name && (
            <span className="flex items-center gap-1">
              <Users size={9} />
              {ticket.assigned_to_name}
            </span>
          )}
        </div>
      </div>

      <ChevronRight
        size={16}
        className="mt-1 shrink-0 text-muted-foreground/30 transition-transform group-hover:translate-x-0.5 group-hover:text-primary/50"
      />
    </button>
  );
}

// ─── Ticket detail panel ──────────────────────────────────────────────────────

function TicketDetailPanel({
  ticketId,
  currentUser,
  onBack,
}: {
  ticketId: number;
  currentUser: { id: number; name: string; role: string };
  onBack: () => void;
}) {
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery<TicketDetail>({
    queryKey: ["ticket-detail", ticketId],
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/tickets/${ticketId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    enabled: !!ticketId,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20">
        <Loader2 size={22} className="animate-spin text-primary/50" />
        <p className="text-sm text-muted-foreground">Loading ticket…</p>
      </div>
    );
  }

  if (isError || !data?.ticket) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20">
        <AlertCircle size={22} className="text-red-400" />
        <p className="text-sm text-muted-foreground">Failed to load ticket.</p>
        <Button variant="outline" size="sm" onClick={onBack}>Go back</Button>
      </div>
    );
  }

  const { ticket, comments } = data;
  // Customer sees only public replies (no internal notes)
  const visibleComments = (comments ?? []).filter(
    (c) => !c.is_internal || c.is_internal === 0 || c.is_internal === false,
  );

  return (
    <div className="space-y-4">
      {/* Back + meta header */}
      <div className="flex items-start gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="shrink-0 gap-1.5 rounded-xl text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft size={14} />
          Back
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            {ticket.ticket_number && (
              <span className="text-xs font-mono text-muted-foreground/60">#{ticket.ticket_number}</span>
            )}
            <StatusBadge status={ticket.status} />
            <PriorityBadge priority={ticket.priority} />
          </div>
          <h2 className="text-base font-semibold text-foreground leading-snug">{ticket.subject}</h2>
          {ticket.issue_details && (
            <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">{ticket.issue_details}</p>
          )}
          <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-muted-foreground/60">
            <span className="flex items-center gap-1">
              <Clock size={10} />
              Opened {relativeTime(ticket.created_at)}
            </span>
            {ticket.assigned_to_name && (
              <span className="flex items-center gap-1">
                <Users size={10} />
                Assigned to {ticket.assigned_to_name}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Participants */}
      <ParticipantsStrip comments={comments ?? []} />

      {/* Chat */}
      <TicketChat
        ticketId={ticketId}
        currentUser={currentUser}
        initialMessages={visibleComments}
        ticketStatus={ticket.status}
        onSent={() => {
          queryClient.invalidateQueries({ queryKey: ["ticket-detail", ticketId] });
          queryClient.invalidateQueries({ queryKey: ["customer-tickets"] });
        }}
      />
    </div>
  );
}

// ─── CustomerPortal (main page) ───────────────────────────────────────────────

type StatusFilter = "all" | "Open" | "In Progress" | "Resolved" | "Closed";

export default function CustomerPortal() {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const [selectedTicketId, setSelectedTicketId] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");

  // Build chatUser — coerce id to number in case AuthContext stores it as string
  const chatUser = useMemo(() => {
    if (!currentUser) return null;
    return {
      id: Number(currentUser.id),
      name: currentUser.name ?? currentUser.email ?? "Me",
      role: String(currentUser.role ?? "customer"),
    };
  }, [currentUser]);

  const { data: ticketsData, isLoading, isError } = useQuery<Ticket[]>({
    queryKey: ["customer-tickets"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/tickets/my");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      // Normalise: bare array or { data: [...] }
      return Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : [];
    },
    enabled: !!currentUser?.id,
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const allTickets: Ticket[] = ticketsData ?? [];

  // Stats
  const stats = useMemo(() => ({
    all:        allTickets.length,
    open:       allTickets.filter((t) => t.status === "Open").length,
    inProgress: allTickets.filter((t) => t.status === "In Progress").length,
    resolved:   allTickets.filter((t) => ["Resolved", "Closed"].includes(t.status)).length,
  }), [allTickets]);

  // Filtered list
  const filtered = useMemo(() => {
    let list = allTickets;
    if (statusFilter !== "all") {
      list = list.filter((t) =>
        statusFilter === "Resolved"
          ? ["Resolved", "Closed"].includes(t.status)
          : t.status === statusFilter,
      );
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (t) =>
          t.subject.toLowerCase().includes(q) ||
          t.issue_details?.toLowerCase().includes(q) ||
          t.ticket_number?.toLowerCase().includes(q) ||
          String(t.id).includes(q),
      );
    }
    return list.sort(
      (a, b) => new Date(b.updated_at ?? b.created_at).getTime() - new Date(a.updated_at ?? a.created_at).getTime(),
    );
  }, [allTickets, statusFilter, search]);

  // Guard — should never happen inside RequireAuth, but keep TypeScript happy
  if (!chatUser) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={20} className="animate-spin text-primary/50" />
      </div>
    );
  }

  // ── Detail view ──
  if (selectedTicketId !== null) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-6">
        <TicketDetailPanel
          ticketId={selectedTicketId}
          currentUser={chatUser}
          onBack={() => setSelectedTicketId(null)}
        />
      </div>
    );
  }

  // ── List view ──
  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-6">
      {/* Page header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-foreground">Support Tickets</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Track and reply to your support requests
          </p>
        </div>
        <Button
          onClick={() => navigate("/customer/create-ticket")}
          className="gap-2 rounded-xl"
        >
          <Plus size={15} />
          New Ticket
        </Button>
      </div>

      {/* Stats */}
      <div className="flex gap-3">
        <StatCard
          label="All Tickets"
          count={stats.all}
          icon={Ticket}
          color="bg-primary/10 text-primary"
          active={statusFilter === "all"}
          onClick={() => setStatusFilter("all")}
        />
        <StatCard
          label="Open"
          count={stats.open}
          icon={MessageCircle}
          color="bg-sky-500/10 text-sky-600"
          active={statusFilter === "Open"}
          onClick={() => setStatusFilter("Open")}
        />
        <StatCard
          label="In Progress"
          count={stats.inProgress}
          icon={Clock}
          color="bg-amber-500/10 text-amber-600"
          active={statusFilter === "In Progress"}
          onClick={() => setStatusFilter("In Progress")}
        />
        <StatCard
          label="Resolved"
          count={stats.resolved}
          icon={CheckCircle2}
          color="bg-emerald-500/10 text-emerald-600"
          active={statusFilter === "Resolved"}
          onClick={() => setStatusFilter("Resolved")}
        />
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/50" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by subject, details, or ticket #…"
          className="rounded-xl pl-9 text-sm"
        />
      </div>

      {/* Ticket list */}
      {isLoading ? (
        <div className="flex flex-col items-center gap-3 py-16">
          <Loader2 size={20} className="animate-spin text-primary/50" />
          <p className="text-sm text-muted-foreground">Loading your tickets…</p>
        </div>
      ) : isError ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-red-500/20 bg-red-500/5 py-14 text-center">
          <AlertCircle size={20} className="text-red-400" />
          <p className="text-sm font-medium text-red-600">Failed to load tickets</p>
          <p className="text-xs text-muted-foreground">Please refresh or try again later.</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-muted/20 py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Ticket size={20} />
          </div>
          <p className="text-sm font-medium text-foreground">
            {search ? "No tickets match your search" : "No tickets yet"}
          </p>
          <p className="text-xs text-muted-foreground">
            {search ? "Try a different keyword." : "Raise a new ticket and our team will get back to you."}
          </p>
          {!search && (
            <Button
              size="sm"
              variant="outline"
              className="mt-2 gap-1.5 rounded-xl"
              onClick={() => navigate("/customer/create-ticket")}
            >
              <Plus size={13} />
              Raise a Ticket
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-2.5">
          <p className="text-xs text-muted-foreground">
            {filtered.length} ticket{filtered.length === 1 ? "" : "s"}
            {statusFilter !== "all" && ` · ${statusFilter}`}
          </p>
          {filtered.map((ticket) => (
            <TicketRow
              key={ticket.id}
              ticket={ticket}
              onClick={() => setSelectedTicketId(ticket.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}