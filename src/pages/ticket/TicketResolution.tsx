import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { SheetShell, SheetMark } from "@/components/sheet/Sheet";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { invalidateTicketQueries } from "@/lib/ticketQuerySync";
import { unwrapTicketList } from "@/lib/ticketListResponse";
import { useTicketSync } from "@/hooks/useTicketSync";
import { cn } from "@/lib/utils";
import {
  CheckCircle2,
  ChevronDown,
  Loader2,
  RefreshCw,
  Search,
  X,
  MessageCircle,
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

const LBL = "font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground";
const HEAD = "font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground";
const RULE = "1px solid hsl(var(--foreground))";
const KEY = "font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
const KEY_INK = `${KEY} bg-foreground text-card border border-foreground`;
const KEY_LINE = `${KEY} border border-foreground text-foreground hover:bg-primary/10`;
const TAG = "inline-flex items-center gap-1 font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em] px-1.5 py-0.5 border whitespace-nowrap";
const chip = (on: boolean) =>
  `${KEY} h-7 px-2.5 border ${on ? "bg-foreground text-card border-foreground" : "border-foreground/40 text-muted-foreground hover:text-foreground hover:border-foreground"}`;

// Priority in ink: urgent is the one red thing, high solid ink, medium a lighter
// ink, low a faint rule. `bar` is the strip down a ticket's left edge.
const priorityCfg: Record<Priority, { tag: string; bar: string; fill: string }> = {
  Urgent: { tag: "text-destructive border-destructive", bar: "bg-destructive", fill: "hsl(var(--destructive))" },
  High: { tag: "bg-foreground text-card border-foreground", bar: "bg-foreground", fill: "hsl(var(--foreground))" },
  Medium: { tag: "text-foreground border-foreground", bar: "bg-foreground/45", fill: "hsl(var(--foreground) / 0.45)" },
  Low: { tag: "text-muted-foreground border-dashed border-foreground/50", bar: "bg-foreground/15", fill: "hsl(var(--foreground) / 0.15)" },
};

// ─── Marks ────────────────────────────────────────────────────────────────────

function PriorityBadge({ priority }: { priority: Priority }) {
  return <span className={cn(TAG, priorityCfg[priority]?.tag)}>{priority}</span>;
}

function StatusBadge({ status }: { status: Status }) {
  if (status === "Resolved" || status === "Closed") return <SheetMark text={status} tone="done" />;
  return <SheetMark text={status === "InProgress" ? "Resolving" : "Pending"} tone="waiting" />;
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
      <DialogContent className="sheet-frame max-w-md p-0 gap-0 overflow-hidden" style={{ margin: 0 }}>
        <DialogDescription className="sr-only">
          Approve resolution for this support ticket
        </DialogDescription>

        <div className="px-5 py-4" style={{ borderBottom: RULE }}>
          <p className={LBL}>Ticket #{ticket.id}</p>
          <DialogTitle className="font-heading text-lg font-bold tracking-tight mt-1">Approve resolution</DialogTitle>
          <p className="text-xs text-muted-foreground mt-1 truncate">{ticket.subject}</p>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div className="border-l-2 border-foreground/40 pl-3 py-0.5 space-y-1.5">
            <p className="text-xs text-muted-foreground">
              <span className="text-foreground font-medium">{ticket.customer_name || "—"}</span>
              {ticket.customer_phone && <span className="tabular-nums"> · {ticket.customer_phone}</span>}
            </p>
            <p className="text-xs text-foreground leading-relaxed line-clamp-3">{ticket.issue_details}</p>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="resolution-note" className={`${LBL} block`}>
              Resolution note <span className="normal-case tracking-normal font-normal">(optional)</span>
            </label>
            <Textarea
              id="resolution-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Describe how this was resolved…"
              rows={3}
              className="resize-none text-sm rounded-none border-foreground/40 focus-visible:border-foreground focus-visible:ring-0 focus-visible:ring-offset-0 bg-card"
            />
          </div>
        </div>

        <div className="px-5 py-3.5 flex items-center justify-end gap-2" style={{ borderTop: RULE }}>
          <button onClick={onClose} className={`${KEY_LINE} h-9 px-4`}>Cancel</button>
          <button onClick={() => onConfirm(note)} disabled={pending} className={`${KEY_INK} h-9 px-5`}>
            {pending ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
            {pending ? "Resolving…" : "Confirm resolution"}
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
  const bar = priorityCfg[ticket.priority]?.bar ?? "bg-foreground/15";
  const isLong = (ticket.issue_details?.length ?? 0) > 100;

  return (
    <div className="flex items-stretch border-b border-foreground/15 last:border-b-0 hover:bg-primary/5 transition-colors">
      {/* Priority strip */}
      <div className={cn("w-1 shrink-0", bar)} />

      <div className="flex-1 px-4 py-3.5 min-w-0">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="font-heading tabular-nums text-[0.6875rem] text-muted-foreground">#{ticket.id}</span>
              <h3 className="text-sm font-semibold text-foreground leading-snug truncate">{ticket.subject}</h3>
            </div>

            <div className="flex items-center gap-x-3 gap-y-1 mt-1 flex-wrap text-[0.6875rem] text-muted-foreground">
              <span className="text-foreground/80">{ticket.customer_name || "—"}</span>
              {ticket.assigned_to && <span>→ {ticket.assigned_to}</span>}
              <span className="tabular-nums">{fmtDate(ticket.created_at)} {fmtTime(ticket.created_at)}</span>
              {(ticket.comment_count ?? 0) > 0 && (
                <span className="inline-flex items-center gap-1 tabular-nums">
                  <MessageCircle size={10} /> {ticket.comment_count}
                </span>
              )}
            </div>

            {ticket.issue_details && (
              <div className="mt-2">
                <p className={cn("text-xs text-muted-foreground leading-relaxed", !expanded && "line-clamp-2")}>
                  {ticket.issue_details}
                </p>
                {isLong && (
                  <button
                    onClick={() => setExpanded((p) => !p)}
                    className={`${LBL} mt-1 text-foreground hover:underline inline-flex items-center gap-0.5`}
                  >
                    {expanded ? "Show less" : "Show more"}
                    <ChevronDown size={10} className={cn("transition-transform", expanded && "rotate-180")} />
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="flex flex-col items-end gap-2 shrink-0">
            <div className="flex items-center gap-2">
              <PriorityBadge priority={ticket.priority} />
              <StatusBadge status={ticket.status} />
            </div>
            <button onClick={() => onResolve(ticket)} className={`${KEY_LINE} h-8 px-3`}>
              <CheckCircle2 size={11} /> Resolve
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Side boxes ───────────────────────────────────────────────────────────────

function SideBox({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-card" style={{ border: RULE }}>
      <p className={`${HEAD} px-4 py-2.5`} style={{ borderBottom: RULE }}>{title}</p>
      <div className="px-4 py-3">{children}</div>
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
    <SideBox title="Recently resolved">
      <div className="-my-1">
        {resolved.map((t) => (
          <div key={t.id} className="py-2.5 border-b border-foreground/10 last:border-b-0 flex items-start gap-2.5">
            <span className={cn("w-1 self-stretch shrink-0", priorityCfg[t.priority]?.bar ?? "bg-foreground/15")} />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-foreground truncate leading-snug">{t.subject}</p>
              <p className="text-[0.6875rem] text-muted-foreground truncate mt-0.5">
                {t.customer_name}
                {t.assigned_to && <span> · {t.assigned_to}</span>}
              </p>
              <p className="text-[0.625rem] text-muted-foreground tabular-nums mt-0.5">{fmtDate(t.updated_at ?? t.created_at)}</p>
            </div>
            <SheetMark text={t.status === "Closed" ? "Closed" : "Done"} tone="done" />
          </div>
        ))}
      </div>
    </SideBox>
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

  const assignees = useMemo(() => {
    const map: Record<string, number> = {};
    allTickets.forEach((t) => {
      const name = t.assigned_to || "Unassigned";
      map[name] = (map[name] ?? 0) + 1;
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [allTickets]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      <Breadcrumbs items={["Admin", "Support Tickets", "Resolution"]} />

      <SheetShell
        eyebrow="CivilierERP · Admin · Support"
        title="Ticket resolution"
        subtitle={`${allTickets.length} unresolved ticket${allTickets.length !== 1 ? "s" : ""} awaiting admin approval, most urgent first.`}
        action={
          <button onClick={() => refetch()} disabled={isFetching} className={`${KEY_LINE} h-9 px-3`}>
            <RefreshCw size={12} className={isFetching ? "animate-spin" : ""} /> Re-read
          </button>
        }
      >
        {/* ── Counts ── */}
        <div className="bg-card" style={{ border: RULE }}>
          <div className="statrow four" style={{ padding: "16px 16px 18px" }}>
            {[
              { label: "Pending", value: pendingCount, note: "not yet picked up", red: false },
              { label: "Resolving", value: inProgressCount, note: "being worked on", red: false },
              { label: "Urgent", value: urgentCount, note: "urgent priority, open", red: urgentCount > 0 },
              { label: "High", value: highCount, note: "high priority, open", red: false },
            ].map((x) => (
              <div key={x.label}>
                <p className="label" style={x.red ? { color: "hsl(var(--destructive))" } : undefined}>{x.label}</p>
                <p className="figure" style={{ fontSize: "clamp(18px, 2vw, 26px)", marginTop: 9, color: x.red ? "hsl(var(--destructive))" : undefined }}>
                  {isLoading ? "…" : x.value}
                </p>
                <p style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }}>{x.note}</p>
              </div>
            ))}
          </div>
        </div>

        {isError && (
          <p className="text-sm text-destructive border border-destructive px-4 py-3 bg-card">
            Could not load the tickets. Use Re-read to try again.
          </p>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_20rem] gap-4 items-start">
          {/* LEFT — ticket list */}
          <div className="bg-card min-w-0" style={{ border: RULE }}>
            <div className="px-4 py-3 space-y-3" style={{ borderBottom: RULE }}>
              <div className="relative">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by subject, customer, or issue…"
                  aria-label="Search tickets"
                  className="w-full h-9 pl-8 pr-8 border border-foreground/40 focus:border-foreground bg-card text-sm text-foreground placeholder:text-muted-foreground/60 outline-none"
                />
                {search && (
                  <button onClick={() => setSearch("")} aria-label="Clear search" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    <X size={12} />
                  </button>
                )}
              </div>
              <div className="flex items-center gap-x-5 gap-y-2 flex-wrap">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className={`${LBL} mr-1`}>Status</span>
                  {(["All", "Pending", "InProgress"] as const).map((s) => (
                    <button key={s} onClick={() => setStatus(s)} aria-pressed={statusFilter === s} className={chip(statusFilter === s)}>
                      {s === "InProgress" ? "Resolving" : s}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className={`${LBL} mr-1`}>Priority</span>
                  {(["All", ...PRIORITIES] as const).map((p) => (
                    <button key={p} onClick={() => setPriority(p as Priority | "All")} aria-pressed={priorityFilter === p} className={chip(priorityFilter === p)}>
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {isLoading ? (
              <div>
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex border-b border-foreground/15 last:border-b-0 animate-pulse">
                    <div className="w-1 bg-foreground/15" />
                    <div className="flex-1 px-4 py-4 space-y-2">
                      <div className="h-4 bg-foreground/10 w-2/3" />
                      <div className="h-3 bg-foreground/10 w-1/3" />
                      <div className="h-3 bg-foreground/10 w-full" />
                    </div>
                  </div>
                ))}
              </div>
            ) : tickets.length === 0 ? (
              <div className="py-16 flex flex-col items-center gap-3 text-muted-foreground">
                <p className="text-sm">
                  {isFiltered ? "No tickets match these filters." : "All caught up — no unresolved tickets."}
                </p>
                {isFiltered && (
                  <button onClick={() => { setSearch(""); setPriority("All"); setStatus("All"); }} className={`${KEY_LINE} h-8 px-3`}>
                    Clear filters
                  </button>
                )}
              </div>
            ) : (
              <div>
                {tickets.map((t) => (
                  <TicketRow key={t.id} ticket={t} onResolve={setResolveTarget} />
                ))}
              </div>
            )}

            {!isLoading && tickets.length > 0 && isFiltered && (
              <p className="text-xs text-muted-foreground text-center py-2.5" style={{ borderTop: RULE }}>
                Showing {tickets.length} of {allTickets.length} unresolved tickets
              </p>
            )}
          </div>

          {/* RIGHT — breakdowns */}
          <div className="space-y-4">
            <SideBox title="Priority breakdown">
              {allTickets.length === 0 ? (
                <p className="text-xs text-muted-foreground py-1">No open tickets</p>
              ) : (
                <div className="space-y-3">
                  {PRIORITIES.map((p) => {
                    const count = allTickets.filter((t) => t.priority === p).length;
                    const pct = Math.round((count / (allTickets.length || 1)) * 100);
                    return (
                      <div key={p} className="space-y-1.5">
                        <div className="flex items-baseline justify-between text-xs">
                          <span className={LBL} style={{ color: p === "Urgent" && count > 0 ? "hsl(var(--destructive))" : "hsl(var(--foreground))" }}>{p}</span>
                          <span className="text-muted-foreground tabular-nums">{count} ticket{count !== 1 ? "s" : ""}</span>
                        </div>
                        <div className="h-2 border border-foreground/60">
                          <div className="h-full transition-all duration-500" style={{ width: `${pct}%`, background: priorityCfg[p].fill }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </SideBox>

            <SideBox title="Assigned to">
              {assignees.length === 0 ? (
                <p className="text-xs text-muted-foreground py-1">No open tickets</p>
              ) : (
                <div className="-my-1">
                  {assignees.map(([name, count]) => (
                    <div key={name} className="flex items-baseline justify-between gap-2 py-2 border-b border-foreground/10 last:border-b-0">
                      <span className={cn("text-xs truncate", name === "Unassigned" ? "text-muted-foreground italic" : "text-foreground")}>{name}</span>
                      <span className="font-heading text-sm font-semibold tabular-nums text-foreground shrink-0">{count}</span>
                    </div>
                  ))}
                </div>
              )}
            </SideBox>

            {!isLoading && <RecentlyResolvedPanel />}
          </div>
        </div>
      </SheetShell>

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
