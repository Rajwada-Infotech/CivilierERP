import { CrmStatus } from "@/constants/crmStatuses";
import React, { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { translateError } from "@/lib/translateError";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useAuth } from "@/contexts/AuthContext";
import {
  Send, Undo2, CheckCircle2, AlertTriangle, ChevronDown, ChevronRight, Building2, User, Phone,
  CalendarClock, Hash, LayoutList, Rows3, Zap, RefreshCw,
} from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CrmCompanyProjectBlockFilter, type CrmCompanyProjectBlockValue } from "@/components/crm/CrmCompanyProjectBlockFilter";
import { ApplicantNames } from "@/components/crm/ApplicantNames";
import { useSearchAsYouType } from "@/hooks/useSearchAsYouType";
import { SheetShell, SheetMark } from "@/components/sheet/Sheet";
import { fmtRupees } from "@/components/crm/FinancialStatusBar";
import { INP, KEY_INK, KEY_LINE, LBL, RULE, RULE_SOFT, TEXTAREA } from "./customers/config";

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

const fmt = (v?: number | null) => (v == null ? "—" : fmtRupees(Number(v)));
function fmtDate(v?: string | null) {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v).slice(0, 10) : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

// Fetched in full (view=all): each row is a milestone, bucketed into the four tabs and grouped per booking here —
// paginating the raw rows would split a booking across pages and break the grouping and the counts. Company /
// project / block narrow the set server-side.
interface DemandListFilters { search: string; companyId: string; projectId: string; blockId: string }
async function fetchDemands(filters: DemandListFilters): Promise<{ demands: DemandRow[] }> {
  const q = new URLSearchParams();
  q.set("view", "all");
  if (filters.search) q.set("search", filters.search);
  if (filters.companyId) q.set("companyId", filters.companyId);
  if (filters.projectId) q.set("projectId", filters.projectId);
  if (filters.blockId) q.set("blockId", filters.blockId);
  const res = await fetchWithAuth(`${API}/demands?${q}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "Failed to load demands");
  return data;
}

// Every milestone belongs to exactly one tab, most urgent first: overdue > demanded > pending.
function classify(m: DemandRow): TabKey | null {
  if (m.DemandStatus === CrmStatus.PAID) return "paid";
  if (m.IsOverdue) return "overdue";
  if (m.DemandStatus === CrmStatus.DEMANDED) return "demanded";
  if (m.DemandStatus === CrmStatus.PENDING) return "pending";
  return null;
}

const TABS: { key: TabKey; label: string }[] = [
  { key: "overdue", label: "Overdue" },
  { key: "pending", label: "Ready to raise" },
  { key: "demanded", label: "Raised — awaiting pay" },
  { key: "paid", label: "Cleared" },
];

function DemandMark({ status }: { status: DemandStatus }) {
  return <SheetMark text={status === CrmStatus.PAID ? "Cleared" : status === CrmStatus.DEMANDED ? "Demanded" : "Not raised"} tone={status === CrmStatus.PAID ? "done" : "waiting"} />;
}

function MilestoneRow({ m, canEdit, onRaise, onUndo, showBooking }: {
  m: DemandRow; canEdit: boolean; onRaise: (row: DemandRow) => void; onUndo: (row: DemandRow) => void; showBooking?: boolean;
}) {
  const balance = Math.max(0, Number(m.AmountDue || 0) - Number(m.AmountPaid || 0));
  const overdue = !!m.IsOverdue && m.DemandStatus !== CrmStatus.PAID;
  return (
    <div className="flex items-center gap-3 px-4 py-3 text-sm" style={{ borderBottom: RULE_SOFT, borderLeft: overdue ? "3px solid hsl(var(--destructive))" : undefined }}>
      {showBooking && (
        <div className="shrink-0 w-40 min-w-0">
          <div className="font-heading text-xs font-semibold tabular-nums">{m.BookingNo}</div>
          <div className="mt-1 text-xs text-muted-foreground truncate"><ApplicantNames name={m.ApplicantName} bookingId={m.BookingId} /></div>
        </div>
      )}
      <span className="shrink-0 w-7 h-7 flex items-center justify-center font-heading text-xs font-bold tabular-nums" style={{ border: RULE_SOFT }}>{m.MilestoneNo}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium">{m.MilestoneName}</span>
          <DemandMark status={m.DemandStatus} />
        </div>
        <div className="flex items-center gap-3 mt-1 text-[0.6875rem] text-muted-foreground flex-wrap tabular-nums">
          {m.Percent != null && <span>{m.Percent}%</span>}
          <span className="flex items-center gap-1"><CalendarClock className="w-3 h-3" />{m.DueDate ? fmtDate(m.DueDate) : "No due date"}</span>
          {overdue && m.DaysOverdue != null && <span className="text-destructive font-semibold flex items-center gap-0.5"><AlertTriangle className="w-3 h-3" /> {m.DaysOverdue}d overdue</span>}
          {m.DemandNo && <span className="flex items-center gap-1 font-heading text-foreground"><Hash className="w-3 h-3" />{m.DemandNo}</span>}
        </div>
      </div>
      <div className="shrink-0 text-right w-32">
        <div className={`font-heading font-semibold tabular-nums ${overdue ? "text-destructive" : ""}`}>{fmt(balance)}</div>
        <div className="mt-1 text-[0.6875rem] text-muted-foreground tabular-nums">{fmt(m.AmountPaid)} of {fmt(m.AmountDue)}</div>
      </div>
      <div className="shrink-0 w-20">
        {!canEdit ? null : m.DemandStatus === CrmStatus.PENDING && balance > 0 ? (
          <button onClick={(e) => { e.stopPropagation(); onRaise(m); }} className={`${KEY_INK} h-8 w-full`}><Send className="w-3 h-3" /> Raise</button>
        ) : m.DemandStatus === CrmStatus.DEMANDED ? (
          <button onClick={(e) => { e.stopPropagation(); onUndo(m); }} className={`${KEY_LINE} h-8 w-full`}><Undo2 className="w-3 h-3" /> Undo</button>
        ) : null}
      </div>
    </div>
  );
}

function BookingCard({ group, canEdit, onRaise, onUndo, defaultExpanded }: {
  group: BookingGroup; canEdit: boolean; onRaise: (row: DemandRow) => void; onUndo: (row: DemandRow) => void; defaultExpanded: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const balance = Math.max(0, group.tabDue - group.tabPaid);
  const paidPct = group.tabDue > 0 ? Math.min(100, (group.tabPaid / group.tabDue) * 100) : 0;
  return (
    <div className="bg-card" style={{ border: RULE }}>
      <button onClick={() => setExpanded(!expanded)} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-primary/5 transition-colors text-left">
        <span className="shrink-0 text-muted-foreground">{expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-heading text-sm font-bold tabular-nums">{group.bookingNo}</span>
            <span className="text-sm font-semibold truncate"><ApplicantNames name={group.applicantName} bookingId={group.bookingId} /></span>
            <span className="text-[0.6875rem] text-muted-foreground tabular-nums">({group.milestones.length} milestone{group.milestones.length !== 1 ? "s" : ""} here)</span>
          </div>
          <div className="flex items-center gap-3 mt-1 text-[0.6875rem] text-muted-foreground flex-wrap">
            {group.projectName && <span className="flex items-center gap-1"><Building2 className="w-3 h-3" /> {group.projectName}</span>}
            <span>Unit {group.unitNo}</span>
            {group.mobile && <span className="flex items-center gap-1 tabular-nums"><Phone className="w-3 h-3" /> {group.mobile}</span>}
            {group.assignedToName && <span className="flex items-center gap-1"><User className="w-3 h-3" /> {group.assignedToName}</span>}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="font-heading text-sm font-bold tabular-nums">{fmt(balance)}</div>
          <div className="mt-1 text-[0.6875rem] text-muted-foreground tabular-nums">{fmt(group.tabPaid)} / {fmt(group.tabDue)}</div>
          {group.tabDue > 0 && <div className="w-28 h-1.5 mt-1.5 ml-auto" style={{ border: RULE_SOFT }}><div className="h-full bg-foreground" style={{ width: `${paidPct}%` }} /></div>}
        </div>
      </button>
      {expanded && (
        <div style={{ borderTop: RULE_SOFT }}>
          {group.milestones.map((m) => <MilestoneRow key={m.Id} m={m} canEdit={canEdit} onRaise={onRaise} onUndo={onUndo} />)}
        </div>
      )}
    </div>
  );
}

const CrmDemands: React.FC = () => {
  const qc = useQueryClient();
  const { canDoAction } = useAuth();
  const canEdit = canDoAction("crm-payments", "edit");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  // Searches as you type (after a short pause); Enter still searches at once.
  useSearchAsYouType(searchInput, (v) => setSearch(v));
  const [cpb, setCpb] = useState<CrmCompanyProjectBlockValue>({ companyId: "", projectId: "", blockId: "" });
  const [activeTab, setActiveTab] = useState<TabKey>("overdue");
  const [density, setDensity] = useState<"grouped" | "compact">("grouped");
  const [raiseRow, setRaiseRow] = useState<DemandRow | null>(null);
  const [raiseNotes, setRaiseNotes] = useState("");
  const [undoRow, setUndoRow] = useState<DemandRow | null>(null);
  const [raising, setRaising] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkMilestone, setBulkMilestone] = useState("");
  const [bulkRunning, setBulkRunning] = useState(false);

  const listFilters: DemandListFilters = useMemo(
    () => ({ search, companyId: cpb.companyId, projectId: cpb.projectId, blockId: cpb.blockId }),
    [search, cpb]
  );
  const { data, isLoading, isError, error, isFetching, refetch } = useQuery({
    queryKey: ["crm-demands", listFilters],
    queryFn: () => fetchDemands(listFilters),
    placeholderData: (prev) => prev,
    staleTime: 30_000,
  });
  const rows = data?.demands ?? [];

  // Bucket every milestone into one tab, then group by booking within it — a group's total only sums what it shows.
  const tabbed = useMemo(() => {
    const result = {} as Record<TabKey, { groups: BookingGroup[]; amount: number; count: number }>;
    const buckets: Record<TabKey, DemandRow[]> = { overdue: [], pending: [], demanded: [], paid: [] };
    for (const r of rows) { const key = classify(r); if (key) buckets[key].push(r); }
    for (const key of Object.keys(buckets) as TabKey[]) {
      const map = new Map<number, BookingGroup>();
      for (const r of buckets[key]) {
        if (!map.has(r.BookingId)) {
          map.set(r.BookingId, { bookingId: r.BookingId, bookingNo: r.BookingNo, projectName: r.ProjectName, unitNo: r.UnitNo,
            applicantName: r.ApplicantName, mobile: r.Mobile, assignedToName: r.AssignedToName, milestones: [], tabDue: 0, tabPaid: 0 });
        }
        const g = map.get(r.BookingId)!;
        g.milestones.push(r);
        g.tabDue += Number(r.AmountDue || 0);
        g.tabPaid += Number(r.AmountPaid || 0);
      }
      const groups = Array.from(map.values());
      result[key] = { groups, amount: groups.reduce((s, g) => s + Math.max(0, g.tabDue - g.tabPaid), 0), count: buckets[key].length };
    }
    return result;
  }, [rows]);

  const changed = () => { qc.invalidateQueries({ queryKey: ["crm-demands"] }); qc.invalidateQueries({ queryKey: ["crm-milestones"] }); };

  async function handleRaise() {
    if (!raiseRow) return;
    setRaising(true);
    try {
      const res = await fetchWithAuth(`${API}/${raiseRow.Id}/demand`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ Notes: raiseNotes || undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Failed to raise demand");
      toast.success(`Demand raised — ${body.DemandNo}`);
      setRaiseRow(null); setRaiseNotes("");
      changed();
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setRaising(false); }
  }
  async function handleUndo() {
    if (!undoRow) return;
    setUndoing(true);
    try {
      const res = await fetchWithAuth(`${API}/${undoRow.Id}/demand/undo`, { method: "PATCH" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Failed to undo demand");
      toast.success("Demand reverted");
      setUndoRow(null);
      changed();
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setUndoing(false); }
  }
  async function handleBulkRaise() {
    setBulkRunning(true);
    try {
      const res = await fetchWithAuth(`${API}/demands/bulk`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // The page's company / project / block filter narrows it.
          companyId: cpb.companyId || undefined,
          projectId: cpb.projectId || undefined,
          blockId: cpb.blockId || undefined,
          milestoneName: bulkMilestone.trim() || undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Bulk demand failed");
      toast.success(`Raised ${body.raised} demand${body.raised !== 1 ? "s" : ""}${body.skipped ? ` · ${body.skipped} already raised` : ""}${body.errors?.length ? ` · ${body.errors.length} error(s)` : ""}`);
      setBulkOpen(false); setBulkMilestone("");
      changed();
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setBulkRunning(false); }
  }

  // pending / demanded exclude overdue rows (classify moved them), so the three add up to what's outstanding.
  const totalOutstanding = tabbed.pending.amount + tabbed.demanded.amount + tabbed.overdue.amount;
  const activeGroups = tabbed[activeTab].groups;
  const activeLabel = TABS.find((t) => t.key === activeTab)!.label;
  const figures: { label: string; value: string; note: string; tab: TabKey | null; red?: boolean }[] = [
    { label: "Outstanding", value: fmt(totalOutstanding), note: `${tabbed.pending.count + tabbed.demanded.count + tabbed.overdue.count} milestones`, tab: null },
    { label: "Overdue", value: String(tabbed.overdue.count), note: fmt(tabbed.overdue.amount), tab: "overdue", red: tabbed.overdue.count > 0 },
    { label: "Ready to raise", value: String(tabbed.pending.count), note: fmt(tabbed.pending.amount), tab: "pending" },
    { label: "Raised", value: String(tabbed.demanded.count), note: `${fmt(tabbed.demanded.amount)} awaiting payment`, tab: "demanded" },
  ];
  const tabClass = (on: boolean) => `inline-flex items-center gap-2 px-3 h-9 font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] shrink-0 transition-colors ${on ? "bg-foreground text-card" : "text-muted-foreground hover:text-foreground hover:bg-primary/5"}`;
  const DIALOG = "rounded-none p-5 gap-4";
  const openRaise = (row: DemandRow) => { setRaiseRow(row); setRaiseNotes(""); };

  return (
    <>
      <Breadcrumbs items={["Dashboard", "CRM", "Demands"]} />
      <SheetShell
        eyebrow="CivilierERP · CRM · Finance"
        title="Payment Demands"
        subtitle="Formal demands for each instalment across every booking: what's overdue, what's ready to raise, what's raised and awaiting payment, and what's cleared."
        action={
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button onClick={() => refetch()} disabled={isFetching} className={`${KEY_LINE} h-9 w-9`} title="Refresh"><RefreshCw size={13} className={isFetching ? "animate-spin" : ""} /></button>
            {canEdit && <button onClick={() => setBulkOpen(true)} className={`${KEY_INK} h-9 px-4`}><Zap size={13} /> Raise all</button>}
          </div>
        }
      >
        <div className="space-y-5">
          <div className="bg-card" style={{ border: RULE }}>
            <div className="statrow four" style={{ padding: "16px 16px 18px" }}>
              {figures.map((x) => (
                <div key={x.label}>
                  {x.tab ? <button onClick={() => setActiveTab(x.tab!)} className="label link">{x.label}</button> : <span className="label">{x.label}</span>}
                  <p className="figure" style={{ fontSize: "clamp(16px, 1.8vw, 24px)", marginTop: 9, color: x.red ? "var(--red)" : undefined }}>{isLoading && !data ? "…" : x.value}</p>
                  <p style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }} className="tabular-nums">{x.note}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-card" style={{ border: RULE }}>
            <div className="px-5 py-4 space-y-3" style={{ borderBottom: RULE }}>
              <div className="flex items-center gap-3 flex-wrap">
                <div className="inline-flex items-stretch flex-wrap" style={{ border: RULE }}>
                  {TABS.map((t) => (
                    <button key={t.key} onClick={() => setActiveTab(t.key)} style={{ borderRight: RULE_SOFT }}
                      className={`${tabClass(activeTab === t.key)} ${t.key === "overdue" && tabbed.overdue.count > 0 && activeTab !== t.key ? "!text-destructive" : ""}`}>
                      {t.label} <span className="tabular-nums">{tabbed[t.key].count}</span>
                    </button>
                  ))}
                </div>
                <div className="ml-auto inline-flex items-stretch" style={{ border: RULE }}>
                  <button onClick={() => setDensity("grouped")} title="Grouped by booking" className={tabClass(density === "grouped")} style={{ borderRight: RULE_SOFT }}><Rows3 className="w-3.5 h-3.5" /></button>
                  <button onClick={() => setDensity("compact")} title="One line per milestone" className={tabClass(density === "compact")}><LayoutList className="w-3.5 h-3.5" /></button>
                </div>
              </div>
              <div className="flex gap-3 flex-wrap items-center">
                <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && setSearch(searchInput.trim())}
                  placeholder="Search customer, booking, demand no…"
                  className="h-9 flex-1 min-w-48 border border-foreground/40 focus:border-foreground bg-card px-3 text-xs text-foreground outline-none" />
                <CrmCompanyProjectBlockFilter value={cpb} onChange={setCpb} />
              </div>
            </div>

            {isError ? (
              <p className="py-12 text-center text-sm text-destructive">{(error as Error)?.message}</p>
            ) : isLoading && !data ? (
              <p className="py-12 text-center text-sm text-muted-foreground">Loading demands…</p>
            ) : activeGroups.length === 0 ? (
              <div className="py-14 text-center text-muted-foreground">
                <CheckCircle2 className="w-8 h-8 mx-auto mb-2 opacity-40" />
                <p className="text-sm font-medium">Nothing under "{activeLabel}" right now.</p>
              </div>
            ) : density === "grouped" ? (
              <div className="p-4 space-y-3">
                {activeGroups.map((g) => (
                  <BookingCard key={g.bookingId} group={g} canEdit={canEdit} onRaise={openRaise} onUndo={setUndoRow}
                    defaultExpanded={activeTab === "overdue" || activeGroups.length <= 3} />
                ))}
              </div>
            ) : (
              <div>
                {activeGroups.flatMap((g) => g.milestones.map((m) => (
                  <MilestoneRow key={m.Id} m={m} canEdit={canEdit} showBooking onRaise={openRaise} onUndo={setUndoRow} />
                )))}
              </div>
            )}
          </div>
        </div>

        {/* Raise one demand */}
        <Dialog open={!!raiseRow} onOpenChange={(o) => { if (!o) { setRaiseRow(null); setRaiseNotes(""); } }}>
          <DialogContent className={`max-w-md ${DIALOG}`} style={{ border: RULE }}>
            <DialogHeader>
              <DialogTitle className="font-heading">Raise payment demand</DialogTitle>
              <DialogDescription className="text-xs">Gives it a demand number and notifies the assigned staff.</DialogDescription>
            </DialogHeader>
            {raiseRow && (
              <>
                <div style={{ border: RULE_SOFT }}>
                  {[
                    { label: "Booking", value: `${raiseRow.BookingNo}${raiseRow.ProjectName ? ` · ${raiseRow.ProjectName}` : ""} · ${raiseRow.UnitNo}` },
                    { label: "Customer", value: raiseRow.ApplicantName },
                    { label: "Milestone", value: `#${raiseRow.MilestoneNo} ${raiseRow.MilestoneName}` },
                    { label: "Balance due", value: fmt(Math.max(0, Number(raiseRow.AmountDue || 0) - Number(raiseRow.AmountPaid || 0))), num: true },
                    { label: "Due date", value: fmtDate(raiseRow.DueDate), num: true },
                  ].map(({ label, value, num }) => (
                    <div key={label} className="flex justify-between items-center gap-3 px-3 py-2" style={{ borderBottom: RULE_SOFT }}>
                      <span className={LBL}>{label}</span>
                      <span className={`text-sm font-medium text-right ${num ? "font-heading tabular-nums" : ""}`}>{value}</span>
                    </div>
                  ))}
                </div>
                {raiseRow.IsOverdue ? (
                  <p className="px-3 py-2 text-xs text-destructive flex items-center gap-1.5" style={{ border: "1px solid hsl(var(--destructive) / 0.4)", borderLeft: "3px solid hsl(var(--destructive))" }}>
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> This milestone is <span className="tabular-nums">{raiseRow.DaysOverdue}</span> days overdue.
                  </p>
                ) : null}
                <div>
                  <label className={`block mb-1 ${LBL}`}>Notes (optional)</label>
                  <textarea value={raiseNotes} onChange={(e) => setRaiseNotes(e.target.value)} rows={2} placeholder="Any remarks for this demand…" className={TEXTAREA} />
                </div>
              </>
            )}
            <DialogFooter className="gap-2">
              <button onClick={() => { setRaiseRow(null); setRaiseNotes(""); }} className={`${KEY_LINE} h-9 px-4`}>Cancel</button>
              <button onClick={handleRaise} disabled={raising} className={`${KEY_INK} h-9 px-4`}><Send className="w-3.5 h-3.5" /> {raising ? "Raising…" : "Raise demand"}</button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Undo a demand */}
        <Dialog open={!!undoRow} onOpenChange={(o) => !o && setUndoRow(null)}>
          <DialogContent className={`max-w-md ${DIALOG}`} style={{ border: RULE }}>
            <DialogHeader><DialogTitle className="font-heading">Undo demand {undoRow?.DemandNo}?</DialogTitle></DialogHeader>
            <p className="text-sm text-muted-foreground">
              It goes back to "Not raised" for <span className="font-semibold text-foreground"><ApplicantNames name={undoRow?.ApplicantName} bookingId={undoRow?.BookingId} /></span> ({undoRow?.MilestoneName}) and its demand number is cleared.
            </p>
            <DialogFooter className="gap-2">
              <button onClick={() => setUndoRow(null)} className={`${KEY_LINE} h-9 px-4`}>Keep it</button>
              <button onClick={handleUndo} disabled={undoing} className={`${KEY_INK} h-9 px-4 !bg-destructive !border-destructive`}><Undo2 className="w-3.5 h-3.5" /> {undoing ? "Reverting…" : "Undo demand"}</button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Raise every eligible demand */}
        <Dialog open={bulkOpen} onOpenChange={(o) => { if (!o) { setBulkOpen(false); setBulkMilestone(""); } }}>
          <DialogContent className={`max-w-md ${DIALOG}`} style={{ border: RULE }}>
            <DialogHeader>
              <DialogTitle className="font-heading flex items-center gap-2"><Zap size={16} /> Raise all eligible demands</DialogTitle>
              <DialogDescription className="text-xs">
                Raises a demand for every milestone not yet raised that still has a balance, in the company / project / block chosen on the page{cpb.projectId || cpb.companyId ? "" : " (none chosen: every project you can see)"}. Raised or paid milestones are skipped.
              </DialogDescription>
            </DialogHeader>
            <div>
              <label className={`block mb-1 ${LBL}`}>Only this milestone (optional)</label>
              <input type="text" value={bulkMilestone} onChange={(e) => setBulkMilestone(e.target.value)} placeholder="e.g. Slab completion" className={INP} />
            </div>
            <DialogFooter className="gap-2">
              <button onClick={() => { setBulkOpen(false); setBulkMilestone(""); }} className={`${KEY_LINE} h-9 px-4`}>Cancel</button>
              <button onClick={handleBulkRaise} disabled={bulkRunning} className={`${KEY_INK} h-9 px-4`}><Zap className="w-3.5 h-3.5" /> {bulkRunning ? "Raising…" : "Raise all"}</button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </SheetShell>
    </>
  );
};

export default CrmDemands;
