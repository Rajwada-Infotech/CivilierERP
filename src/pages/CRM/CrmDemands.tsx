import { CrmStatus } from "@/constants/crmStatuses";
import React, { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { translateError } from "@/lib/translateError";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { CrmShell } from "@/components/crm/CrmShell";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useAuth } from "@/contexts/AuthContext";
import {
  Search, Send, Undo2, Clock, CheckCircle2, AlertTriangle,
  ChevronDown, ChevronRight, Building2, User, Phone,
  CalendarClock, FileText, Hash, LayoutList, Rows3,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

const API = "/api/crm/payments";

type DemandStatus = "Pending" | "Demanded" | "Paid";
type TabKey = "overdue" | "pending" | "demanded" | "paid";

interface DemandRow {
  Id: number;
  MilestoneNo: number;
  MilestoneName: string;
  AmountDue: number;
  AmountPaid: number;
  Percent: number | null;
  DueDate: string | null;
  Status: string;
  DemandStatus: DemandStatus;
  DemandNo: string | null;
  DemandRaisedOn: string | null;
  DemandNotes: string | null;
  BookingId: number;
  BookingNo: string;
  ProjectName: string | null;
  UnitNo: string;
  ApplicantName: string;
  Mobile: string | null;
  AssignedToName: string | null;
  BookingGrandTotal: number | null;
  BookingTotalValue: number | null;
  IsOverdue: number;
  DaysOverdue: number | null;
}

interface BookingGroup {
  bookingId: number;
  bookingNo: string;
  projectName: string | null;
  unitNo: string;
  applicantName: string;
  mobile: string | null;
  assignedToName: string | null;
  milestones: DemandRow[]; // only the milestones belonging to THIS tab
  tabDue: number;
  tabPaid: number;
}

function fmt(v?: number | null) {
  if (v == null) return "—";
  return `₹${Number(v).toLocaleString("en-IN")}`;
}
function fmtDate(v?: string | null) {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v).slice(0, 10) : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

// Always fetches the full picture (view=all) — tabs are computed client-side
// from this one result set. Previously the page re-queried per status
// filter, which meant the summary strip's OTHER counts silently collapsed
// to 0 whenever a filter was active (e.g. filtering to "Demanded" made the
// backend compute pendingCount from an already-Demanded-only row set).
async function fetchDemands(search: string): Promise<{ demands: DemandRow[] }> {
  const q = new URLSearchParams();
  q.set("view", "all");
  if (search) q.set("search", search);
  const res = await fetchWithAuth(`${API}/demands?${q}`);
  if (!res.ok) throw new Error("Failed to load demands");
  return res.json();
}

// Every milestone belongs to exactly one tab — same "most urgent wins"
// priority the page always used (overdue > demanded > pending), just now
// applied per-milestone instead of per-booking, so a booking with a mix of
// statuses no longer dumps its whole balance into a single section.
function classify(m: DemandRow): TabKey | null {
  if (m.DemandStatus === CrmStatus.PAID) return "paid";
  if (m.IsOverdue) return "overdue";
  if (m.DemandStatus === CrmStatus.DEMANDED) return "demanded";
  if (m.DemandStatus === CrmStatus.PENDING) return "pending";
  return null;
}

function MilestoneStatusBadge({ status }: { status: DemandStatus }) {
  if (status === CrmStatus.PAID)
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"><CheckCircle2 className="w-3 h-3" /> Cleared</span>;
  if (status === CrmStatus.DEMANDED)
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400"><Send className="w-3 h-3" /> Demanded</span>;
  return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400"><Clock className="w-3 h-3" /> Not Raised</span>;
}

function ProgressBar({ paid, due }: { paid: number; due: number }) {
  if (due <= 0) return null;
  const pct = Math.min(100, (paid / due) * 100);
  return (
    <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden">
      <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
    </div>
  );
}

function MilestoneRow({
  m, canEdit, onRaise, onUndo, showBooking,
}: {
  m: DemandRow;
  canEdit: boolean;
  onRaise: (row: DemandRow) => void;
  onUndo: (row: DemandRow) => void;
  showBooking?: boolean;
}) {
  const balance = Math.max(0, Number(m.AmountDue || 0) - Number(m.AmountPaid || 0));
  const isOverdue = !!m.IsOverdue && m.DemandStatus !== CrmStatus.PAID;
  return (
    <div className={`flex items-center gap-3 px-4 py-2.5 text-sm ${isOverdue ? "bg-red-50/50 dark:bg-red-950/10" : ""}`}>
      {showBooking && (
        <div className="shrink-0 w-36">
          <div className="font-mono text-xs font-bold text-blue-400">{m.BookingNo}</div>
          <div className="text-xs text-card-foreground/70 truncate">{m.ApplicantName}</div>
        </div>
      )}
      <div className="shrink-0 w-7 h-7 rounded-full bg-muted flex items-center justify-center text-xs font-bold text-card-foreground/60">
        {m.MilestoneNo}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium truncate">{m.MilestoneName}</span>
          <MilestoneStatusBadge status={m.DemandStatus} />
        </div>
        <div className="flex items-center gap-3 mt-0.5 text-[11px] text-card-foreground/60 flex-wrap">
          {m.Percent != null && <span>{m.Percent}%</span>}
          <span className="flex items-center gap-1">
            <CalendarClock className="w-3 h-3" />
            {m.DueDate ? fmtDate(m.DueDate) : "No due date"}
          </span>
          {isOverdue && m.DaysOverdue != null && (
            <span className="text-red-600 dark:text-red-400 font-semibold flex items-center gap-0.5">
              <AlertTriangle className="w-3 h-3" /> {m.DaysOverdue}d overdue
            </span>
          )}
          {m.DemandNo && (
            <span className="flex items-center gap-1 font-mono text-blue-400">
              <Hash className="w-3 h-3" /> {m.DemandNo}
            </span>
          )}
        </div>
      </div>

      <div className="shrink-0 text-right w-28">
        <div className="font-semibold">{fmt(balance)}</div>
        <div className="text-[10px] text-card-foreground/50">{fmt(m.AmountPaid)} of {fmt(m.AmountDue)}</div>
      </div>

      <div className="shrink-0 w-20">
        {!canEdit ? null : m.DemandStatus === CrmStatus.PENDING && balance > 0 ? (
          <button
            onClick={(e) => { e.stopPropagation(); onRaise(m); }}
            className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 font-semibold w-full justify-center"
          >
            <Send className="w-3 h-3" /> Raise
          </button>
        ) : m.DemandStatus === CrmStatus.DEMANDED ? (
          <button
            onClick={(e) => { e.stopPropagation(); onUndo(m); }}
            className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] border border-border rounded-lg hover:bg-muted text-foreground/70 hover:text-foreground w-full justify-center"
          >
            <Undo2 className="w-3 h-3" /> Undo
          </button>
        ) : null}
      </div>
    </div>
  );
}

function BookingCard({
  group, canEdit, onRaise, onUndo, defaultExpanded,
}: {
  group: BookingGroup;
  canEdit: boolean;
  onRaise: (row: DemandRow) => void;
  onUndo: (row: DemandRow) => void;
  defaultExpanded: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const balance = Math.max(0, group.tabDue - group.tabPaid);

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors text-left"
      >
        <div className="shrink-0 text-muted-foreground">
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-sm font-bold text-blue-400">{group.bookingNo}</span>
            <span className="text-xs text-card-foreground/40">·</span>
            <span className="text-sm font-medium truncate">{group.applicantName}</span>
            <span className="text-[11px] text-card-foreground/50">({group.milestones.length} milestone{group.milestones.length !== 1 ? "s" : ""} in this view)</span>
          </div>
          <div className="flex items-center gap-3 mt-0.5 text-[11px] text-card-foreground/60 flex-wrap">
            <span className="flex items-center gap-1"><Building2 className="w-3 h-3" /> {group.projectName}</span>
            <span>Unit {group.unitNo}</span>
            {group.mobile && <span className="flex items-center gap-1"><Phone className="w-3 h-3" /> {group.mobile}</span>}
            {group.assignedToName && <span className="flex items-center gap-1"><User className="w-3 h-3" /> {group.assignedToName}</span>}
          </div>
        </div>

        <div className="shrink-0 text-right">
          <div className="text-sm font-bold">{fmt(balance)}</div>
          <div className="text-[10px] text-card-foreground/50">{fmt(group.tabPaid)} / {fmt(group.tabDue)}</div>
          <div className="w-24 mt-1">
            <ProgressBar paid={group.tabPaid} due={group.tabDue} />
          </div>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border divide-y divide-border/50">
          {group.milestones.map((m) => (
            <MilestoneRow key={m.Id} m={m} canEdit={canEdit} onRaise={onRaise} onUndo={onUndo} />
          ))}
        </div>
      )}
    </div>
  );
}

const TAB_CONFIG: Record<TabKey, { label: string; icon: React.ElementType; color: string; bgClass: string; borderClass: string; ring: string }> = {
  overdue:  { label: "Overdue",              icon: AlertTriangle, color: "text-red-700 dark:text-red-400",    bgClass: "bg-red-50 dark:bg-red-950/20",    borderClass: "border-red-200 dark:border-red-800",    ring: "ring-red-400/60 border-red-400" },
  pending:  { label: "Ready to Raise",       icon: Clock,         color: "text-amber-700 dark:text-amber-400", bgClass: "bg-amber-50 dark:bg-amber-950/20", borderClass: "border-amber-200 dark:border-amber-800", ring: "ring-amber-400/60 border-amber-400" },
  demanded: { label: "Raised — Awaiting Pay", icon: Send,          color: "text-blue-700 dark:text-blue-400",   bgClass: "bg-blue-50 dark:bg-blue-950/20",   borderClass: "border-blue-200 dark:border-blue-800",   ring: "ring-blue-400/60 border-blue-400" },
  paid:     { label: "Cleared",              icon: CheckCircle2,  color: "text-emerald-700 dark:text-emerald-400", bgClass: "bg-emerald-50 dark:bg-emerald-950/20", borderClass: "border-emerald-200 dark:border-emerald-800", ring: "ring-emerald-400/60 border-emerald-400" },
};

const CrmDemands: React.FC = () => {
  const qc = useQueryClient();
  const { canDoAction } = useAuth();
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [activeTab, setActiveTab] = useState<TabKey>("overdue");
  const [density, setDensity] = useState<"grouped" | "compact">("grouped");
  const [raiseRow, setRaiseRow] = useState<DemandRow | null>(null);
  const [raiseNotes, setRaiseNotes] = useState("");
  const [undoRow, setUndoRow] = useState<DemandRow | null>(null);
  const [raising, setRaising] = useState(false);
  const [undoing, setUndoing] = useState(false);

  // canDoAction is AuthContext's own permission check (backed by
  // AuthUtils.createPermissionCheckers) — using it directly instead of
  // poking at pagePermissions' internal shape myself.
  const canEdit = canDoAction("crm-payments", "edit");

  const { data, isLoading, dataUpdatedAt, isFetching, refetch } = useQuery({
    queryKey: ["crm-demands", search],
    queryFn: () => fetchDemands(search),
    placeholderData: (prev) => prev,
    staleTime: 30_000,
  });

  const rows = data?.demands ?? [];

  // Bucket every milestone into exactly one tab, then group by booking
  // WITHIN that tab — so a section's header total only ever sums the
  // milestones actually shown under it.
  const tabbed = useMemo(() => {
    const buckets: Record<TabKey, DemandRow[]> = { overdue: [], pending: [], demanded: [], paid: [] };
    for (const r of rows) {
      const key = classify(r);
      if (key) buckets[key].push(r);
    }

    const result: Record<TabKey, { groups: BookingGroup[]; amount: number; count: number }> = {
      overdue: { groups: [], amount: 0, count: 0 },
      pending: { groups: [], amount: 0, count: 0 },
      demanded: { groups: [], amount: 0, count: 0 },
      paid: { groups: [], amount: 0, count: 0 },
    };

    for (const key of Object.keys(buckets) as TabKey[]) {
      const map = new Map<number, BookingGroup>();
      for (const r of buckets[key]) {
        if (!map.has(r.BookingId)) {
          map.set(r.BookingId, {
            bookingId: r.BookingId, bookingNo: r.BookingNo, projectName: r.ProjectName,
            unitNo: r.UnitNo, applicantName: r.ApplicantName, mobile: r.Mobile,
            assignedToName: r.AssignedToName, milestones: [], tabDue: 0, tabPaid: 0,
          });
        }
        const g = map.get(r.BookingId)!;
        g.milestones.push(r);
        g.tabDue += Number(r.AmountDue || 0);
        g.tabPaid += Number(r.AmountPaid || 0);
      }
      const groups = Array.from(map.values());
      const amount = groups.reduce((s, g) => s + Math.max(0, g.tabDue - g.tabPaid), 0);
      const count = buckets[key].length;
      result[key] = { groups, amount, count };
    }
    return result;
  }, [rows]);

  function applySearch() {
    setSearch(searchInput.trim());
  }

  async function handleRaise() {
    if (!raiseRow) return;
    setRaising(true);
    try {
      const res = await fetchWithAuth(`${API}/${raiseRow.Id}/demand`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ Notes: raiseNotes || undefined }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed to raise demand");
      toast.success(`Demand raised — ${body.DemandNo}`);
      setRaiseRow(null);
      setRaiseNotes("");
      qc.invalidateQueries({ queryKey: ["crm-demands"] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setRaising(false);
    }
  }

  async function handleUndo() {
    if (!undoRow) return;
    setUndoing(true);
    try {
      const res = await fetchWithAuth(`${API}/${undoRow.Id}/demand/undo`, { method: "PATCH" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed to undo demand");
      toast.success("Demand reverted");
      setUndoRow(null);
      qc.invalidateQueries({ queryKey: ["crm-demands"] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setUndoing(false);
    }
  }

  // Single source of truth: derived from tabbed (classify()), same as the
  // tab bar below. Previously read from the backend's `summary` object,
  // which classifies overdue as an ADDITIVE flag (a Pending-and-overdue row
  // counted in both pendingCount and overdueCount) while classify() is
  // MUTUALLY EXCLUSIVE (overdue wins, so that row leaves the pending
  // bucket). The two disagreed on cards whenever any row was overdue.
  // pending/demanded here already EXCLUDE overdue rows (classify() moved
  // them out), so they must be added back in explicitly or the total silently
  // drops by the overdue amount.
  const totalOutstanding = tabbed.pending.amount + tabbed.demanded.amount + tabbed.overdue.amount;
  const activeConfig = TAB_CONFIG[activeTab];
  const activeGroups = tabbed[activeTab].groups;

  usePageRights("crm-payments");

  return (
    <>
      <Breadcrumbs items={["Dashboard", "CRM", "Demands"]} />
      <CrmShell
        title="CRM — Payment Demands"
      subtitle="Raise and track formal payment demands across all bookings"
      action={<RefreshButton dataUpdatedAt={dataUpdatedAt} isFetching={isFetching} onRefresh={refetch} />}
    >
      {/* Summary strip — always computed from the FULL result set (view=all,
          search only), so these numbers never collapse to 0 just because a
          tab/filter happens to be active. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-xl border border-border bg-card p-3.5">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">Total Outstanding</p>
          <p className="text-xl font-bold">{fmt(totalOutstanding)}</p>
          <p className="text-xs text-muted-foreground">{tabbed.pending.count + tabbed.demanded.count + tabbed.overdue.count} milestones</p>
        </div>

        {(["overdue", "pending", "demanded"] as TabKey[]).map((key) => {
          const cfg = TAB_CONFIG[key];
          return (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`text-left rounded-xl border p-3.5 transition-all hover:shadow-md ${activeTab === key ? `ring-2 ${cfg.ring}` : "border-border bg-card"}`}
            >
              <p className={`text-[10px] font-medium uppercase tracking-wide mb-1 flex items-center gap-1 ${cfg.color}`}><cfg.icon className="w-3 h-3" /> {cfg.label}</p>
              <p className={`text-xl font-bold ${cfg.color}`}>{tabbed[key].count}</p>
              <p className="text-xs text-muted-foreground">{fmt(tabbed[key].amount)}</p>
            </button>
          );
        })}
      </div>

      {/* Controls: search + density toggle */}
      <div className="flex gap-3 flex-wrap items-center">
        <div className="relative flex-1 min-w-48">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && applySearch()}
            placeholder="Search customer, booking, demand no..."
            className="w-full pl-8 pr-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <button onClick={applySearch} className="px-3 py-2 text-sm border border-border rounded-lg hover:bg-muted">Search</button>
        {search && (
          <button onClick={() => { setSearch(""); setSearchInput(""); }}
            className="px-3 py-2 text-sm text-muted-foreground hover:text-foreground">Clear</button>
        )}
        <div className="ml-auto flex items-center gap-1 rounded-lg border border-border p-0.5">
          <button
            onClick={() => setDensity("grouped")}
            title="Grouped by booking"
            className={`p-1.5 rounded-md ${density === "grouped" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          ><Rows3 className="w-4 h-4" /></button>
          <button
            onClick={() => setDensity("compact")}
            title="Compact scan view"
            className={`p-1.5 rounded-md ${density === "compact" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          ><LayoutList className="w-4 h-4" /></button>
        </div>
      </div>

      {/* Tab bar (Paid isn't a summary card since it's not "outstanding",
          but it's still a real, reachable tab so paid history is visible on
          this page rather than requiring a hunt through a different screen) */}
      <div className="flex items-center gap-1 border-b border-border">
        {(Object.keys(TAB_CONFIG) as TabKey[]).map((key) => {
          const cfg = TAB_CONFIG[key];
          const t = tabbed[key];
          return (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                activeTab === key ? `${cfg.color} border-current` : "text-muted-foreground border-transparent hover:text-foreground"
              }`}
            >
              <cfg.icon className="w-3.5 h-3.5" /> {cfg.label}
              <span className="text-[10px] opacity-70">({t.count})</span>
            </button>
          );
        })}
      </div>

      {isLoading && !data && (
        <div className="text-center py-12 text-muted-foreground text-sm">Loading demands...</div>
      )}

      {!isLoading && activeGroups.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <CheckCircle2 className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm font-medium">Nothing here right now</p>
          <p className="text-xs mt-1">No milestones currently fall under "{activeConfig.label}"</p>
        </div>
      ) : density === "grouped" ? (
        <div className="space-y-3">
          {activeGroups.map((g) => (
            <BookingCard
              key={g.bookingId}
              group={g}
              canEdit={canEdit}
              onRaise={(row) => { setRaiseRow(row); setRaiseNotes(""); }}
              onUndo={(row) => setUndoRow(row)}
              defaultExpanded={activeTab === "overdue" || activeGroups.length <= 3}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-hidden divide-y divide-border/50">
          {activeGroups.flatMap((g) => g.milestones.map((m) => (
            <MilestoneRow key={m.Id} m={m} canEdit={canEdit}
              onRaise={(row) => { setRaiseRow(row); setRaiseNotes(""); }}
              onUndo={(row) => setUndoRow(row)}
              showBooking
            />
          )))}
        </div>
      )}

      {/* Raise Demand Dialog */}
      <Dialog open={!!raiseRow} onOpenChange={(o) => { if (!o) { setRaiseRow(null); setRaiseNotes(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Raise Payment Demand</DialogTitle></DialogHeader>
          {raiseRow && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                This will generate a formal demand number and notify the assigned staff.
              </p>
              <div className="rounded-lg border border-border bg-muted/30 divide-y divide-border">
                {[
                  { label: "Booking", value: `${raiseRow.BookingNo} · ${raiseRow.ProjectName} · ${raiseRow.UnitNo}` },
                  { label: "Customer", value: raiseRow.ApplicantName },
                  { label: "Milestone", value: `#${raiseRow.MilestoneNo} ${raiseRow.MilestoneName}` },
                  { label: "Balance Due", value: fmt(Math.max(0, Number(raiseRow.AmountDue || 0) - Number(raiseRow.AmountPaid || 0))) },
                  { label: "Due Date", value: fmtDate(raiseRow.DueDate) },
                ].map(({ label, value }) => (
                  <div key={label} className="flex justify-between items-center px-3 py-2">
                    <span className="text-xs text-muted-foreground">{label}</span>
                    <span className="text-sm font-medium">{value}</span>
                  </div>
                ))}
              </div>
              {raiseRow.IsOverdue ? (
                <div className="rounded-md bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 px-3 py-2 text-xs text-red-700 dark:text-red-400 flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  This milestone is {raiseRow.DaysOverdue} days overdue
                </div>
              ) : null}
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Notes (optional)</label>
                <textarea value={raiseNotes} onChange={(e) => setRaiseNotes(e.target.value)} rows={2}
                  placeholder="Any remarks for this demand…"
                  className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background resize-none" />
              </div>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <button onClick={() => { setRaiseRow(null); setRaiseNotes(""); }} className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
            <button onClick={handleRaise} disabled={raising}
              className="flex items-center gap-1.5 px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40">
              <Send className="w-3.5 h-3.5" /> {raising ? "Raising…" : "Raise Demand"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Undo Confirmation */}
      <AlertDialog open={!!undoRow} onOpenChange={(o) => !o && setUndoRow(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Undo Demand?</AlertDialogTitle>
            <AlertDialogDescription>
              This will revert demand <strong>{undoRow?.DemandNo}</strong> for <strong>{undoRow?.ApplicantName}</strong> ({undoRow?.MilestoneName}) back to "Not Raised" and clear the demand number.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={undoing} onClick={handleUndo}>
              {undoing ? "Reverting…" : "Yes, Undo"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </CrmShell>
    </>
  );
};

export default CrmDemands;