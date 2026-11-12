import { CrmStatus } from "@/constants/crmStatuses";
import React, { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { translateError } from "@/lib/translateError";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { Send, Undo2, AlertTriangle, Zap, RefreshCw, Download } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CrmCompanyProjectBlockFilter } from "@/components/crm/CrmCompanyProjectBlockFilter";
import { ApplicantNames } from "@/components/crm/ApplicantNames";
import {
  CrmGrid, GridColumnChooser, GridSavedViews, GridSearch, GridTabs, GridToneMark,
  exportGrid, useGridPrefs, GRID_BTN, GRID_CARD, GRID_PAGE_SIZES, GRID_SHEET_KEYS, type GridCol,
} from "@/components/crm/CrmDataTable";
import { useCrmListState, useSticky, listParams, type CrmSort } from "@/hooks/useCrmListState";
import { useUrlParam } from "@/hooks/useUrlParam";
import { fmtRupees } from "@/components/crm/FinancialStatusBar";
import { BAND_DOT, BAND_KEY, BAND_KEY_MAIN, Initials, MoneyBand, asName } from "./payments/parts";
import { fmtShort } from "./payments/config";
import { INP, KEY_INK, KEY_LINE, LBL, RULE, RULE_SOFT, TEXTAREA } from "./customers/config";

// A demand needs no approval: it is raised when a milestone falls due, or by hand here.
const API = "/api/crm/payments";
const PREFS_KEY = "crm-demands-cols-v1";
const VIEWS_KEY = "crm-demands-views";
const DEFAULT_SORT: CrmSort = { key: "", dir: "asc" };
const DIALOG = "rounded-none p-5 gap-4";
const SMALL = "h-7 px-2.5";

type DemandStatus = "Pending" | "Demanded" | "Paid";
type TabKey = "all" | "overdue" | "pending" | "demanded" | "paid";
interface DemandRow {
  Id: number; MilestoneNo: number; MilestoneName: string; AmountDue: number; AmountPaid: number; Percent: number | null; DueDate: string | null; Status: string;
  DemandStatus: DemandStatus; DemandNo: string | null; DemandRaisedOn: string | null; DemandNotes: string | null; BookingId: number; BookingNo: string;
  ProjectName: string | null; UnitNo: string; ApplicantName: string; Mobile: string | null; AssignedToName: string | null; IsOverdue: number; OverdueShort: number; Missing: number; DaysOverdue: number | null;
}
type Tabs = Record<Exclude<TabKey, "all">, { count: number; amount: number }>;

const TABS: { key: TabKey; label: string }[] = [
  { key: "all", label: "All demands" }, { key: "overdue", label: "Overdue" }, { key: "pending", label: "Not raised" },
  { key: "demanded", label: "Raised, awaiting payment" }, { key: "paid", label: "Paid" },
];
const fmt = (v?: number | null) => (v == null ? "—" : fmtRupees(Number(v)));
function fmtDate(v?: string | null) {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v).slice(0, 10) : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}
const balanceOf = (m: DemandRow) => Math.max(0, Number(m.AmountDue || 0) - Number(m.AmountPaid || 0));
const stateOf = (m: DemandRow): { label: string; tone: "done" | "waiting" | "stopped" | "draft" } => (
  m.DemandStatus === CrmStatus.PAID ? { label: "Paid", tone: "done" }
    : m.IsOverdue ? { label: "Overdue", tone: "stopped" }
    : m.DemandStatus === CrmStatus.DEMANDED ? { label: "Raised", tone: "waiting" }
    : { label: "Not raised", tone: "draft" }
);

async function fetchDemands(params: URLSearchParams): Promise<{ demands: DemandRow[]; total: number; summary: { tabs: Tabs } }> {
  const res = await fetchWithAuth(`${API}/demands?${params}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "Could not load demands");
  return data;
}

function demandCols(canEdit: boolean, onRaise: (m: DemandRow) => void, onUndo: (m: DemandRow) => void): GridCol<DemandRow>[] {
  return [
    { id: "customer", label: "Customer", locked: true, sortKey: "ApplicantName", csv: (m) => m.ApplicantName, cell: (m) => (
      <span className="flex items-center gap-3 py-1.5 min-w-0">
        <Initials name={m.ApplicantName} />
        <span className="min-w-0">
          <span className="block font-semibold text-foreground capitalize truncate" title={m.ApplicantName}>{asName(m.ApplicantName)}</span>
          <span className="block text-xs text-muted-foreground tabular-nums truncate">{m.BookingNo} · {m.UnitNo}{m.ProjectName ? ` · ${m.ProjectName}` : ""}</span>
        </span>
      </span>
    ) },
    { id: "milestone", label: "Milestone", sortKey: "MilestoneName", csv: (m) => m.MilestoneName, cell: (m) => (
      <span className="inline-flex flex-col leading-tight">
        <span className="font-medium"><span className="text-muted-foreground tabular-nums mr-1.5">{m.MilestoneNo}</span>{m.MilestoneName}</span>
        <span className="mt-0.5 text-xs text-muted-foreground tabular-nums">{m.DemandNo || "No demand yet"}{m.DemandRaisedOn ? ` · ${fmtDate(m.DemandRaisedOn)}` : ""}</span>
      </span>
    ) },
    { id: "due", label: "Due date", sortKey: "DueDate", csv: (m) => m.DueDate, cell: (m) => (
      <span className="inline-flex flex-col leading-tight">
        <span className="tabular-nums">{m.DueDate ? fmtDate(m.DueDate) : "No due date"}</span>
        {!!m.IsOverdue && m.DaysOverdue != null && <span className="mt-0.5 text-xs font-semibold text-destructive tabular-nums">{m.DaysOverdue} days late</span>}
      </span>
    ) },
    { id: "amount", label: "Amount", align: "right", sortKey: "AmountDue", csv: (m) => m.AmountDue, cell: (m) => <span className="tabular-nums" title={fmt(m.AmountDue)}>{fmtShort(m.AmountDue)}</span> },
    { id: "balance", label: "Balance", align: "right", sortKey: "Balance", csv: (m) => m.Missing, cell: (m) => {
      const held = Math.max(0, balanceOf(m) - Number(m.Missing || 0));
      return (
        <span className="inline-flex flex-col items-end leading-tight" title={`Amount ${fmt(m.AmountDue)} · Adjusted ${fmt(m.AmountPaid)} · On account or entered ${fmt(held)} · Balance ${fmt(m.Missing)}`}>
          <span className={cn("tabular-nums font-semibold", m.IsOverdue ? "text-destructive" : Number(m.Missing) > 0 ? "text-foreground" : "text-muted-foreground")}>{Number(m.Missing) > 0 ? fmtShort(m.Missing) : "Nil"}</span>
          {held > 0 && <span className="mt-0.5 text-xs text-muted-foreground tabular-nums">{fmtShort(held)} on account</span>}
        </span>
      );
    } },
    { id: "status", label: "Status", csv: (m) => stateOf(m).label, cell: (m) => { const s = stateOf(m); return <GridToneMark text={s.label} tone={s.tone} />; } },
    { id: "act", label: "Actions", locked: true, cell: (m) => (!canEdit ? null
      : m.DemandStatus === CrmStatus.PENDING && balanceOf(m) > 0
        ? <button type="button" onClick={(e) => { e.stopPropagation(); onRaise(m); }} className={cn(GRID_SHEET_KEYS.KEY_INK, SMALL)}><Send size={12} /> Raise</button>
      : m.DemandStatus === CrmStatus.DEMANDED
        ? <button type="button" onClick={(e) => { e.stopPropagation(); onUndo(m); }} className={cn(GRID_SHEET_KEYS.KEY_LINE, SMALL)}><Undo2 size={12} /> Undo</button>
      : null) },
    { id: "booking", label: "Booking", hiddenByDefault: true, sortKey: "BookingNo", csv: (m) => m.BookingNo, cell: (m) => <span className="tabular-nums">{m.BookingNo}</span> },
    { id: "project", label: "Project", hiddenByDefault: true, csv: (m) => m.ProjectName, cell: (m) => m.ProjectName || "—" },
    { id: "unit", label: "Unit", hiddenByDefault: true, csv: (m) => m.UnitNo, cell: (m) => m.UnitNo },
    { id: "mobile", label: "Mobile", hiddenByDefault: true, csv: (m) => m.Mobile, cell: (m) => <span className="tabular-nums">{m.Mobile || "—"}</span> },
    { id: "owner", label: "Owner", hiddenByDefault: true, csv: (m) => m.AssignedToName, cell: (m) => m.AssignedToName || "—" },
    { id: "share", label: "Share of value", align: "right", hiddenByDefault: true, csv: (m) => m.Percent, cell: (m) => (m.Percent != null ? <span className="tabular-nums">{m.Percent}%</span> : "—") },
    { id: "adjusted", label: "Adjusted", align: "right", hiddenByDefault: true, csv: (m) => m.AmountPaid, cell: (m) => <span className="tabular-nums">{fmt(m.AmountPaid)}</span> },
    { id: "demandNo", label: "Demand no", hiddenByDefault: true, sortKey: "DemandNo", csv: (m) => m.DemandNo, cell: (m) => <span className="tabular-nums">{m.DemandNo || "—"}</span> },
    { id: "notes", label: "Notes", hiddenByDefault: true, csv: (m) => m.DemandNotes, cell: (m) => m.DemandNotes || "—" },
  ];
}

const CrmDemands: React.FC = () => {
  const qc = useQueryClient();
  const { canDoAction } = useAuth();
  const canEdit = canDoAction("crm-payments", "edit");
  const [pageSize, setPageSize] = useState<number>(GRID_PAGE_SIZES[0]);
  const list = useCrmListState({ pageSize, defaultSort: DEFAULT_SORT });
  // In the address, so a refresh or a shared link keeps it.
  const [tab, setTabRaw] = useUrlParam<TabKey>("tab", "all", TABS.map((t) => t.key));
  const setTab = (t: TabKey) => { setTabRaw(t); list.setPage(1); };
  const [raiseRow, setRaiseRow] = useState<DemandRow | null>(null);
  const [raiseNotes, setRaiseNotes] = useState("");
  const [undoRow, setUndoRow] = useState<DemandRow | null>(null);
  const [raising, setRaising] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkMilestone, setBulkMilestone] = useState("");
  const [bulkRunning, setBulkRunning] = useState(false);
  const [exporting, setExporting] = useState(false);

  const params = useMemo(() => {
    const p = listParams({ ...list.query, status: "All" });
    p.set("view", "all");
    if (tab !== "all") p.set("focus", tab);
    return p;
  }, [list.query, tab]);
  const { data, isLoading, error, isFetching, refetch } = useQuery({ queryKey: ["crm-demands", params.toString()], queryFn: () => fetchDemands(params), staleTime: 30_000 });
  const result = useSticky(data);
  const t = result?.summary?.tabs;
  const zero = { count: 0, amount: 0 };
  const overdue = t?.overdue ?? zero, ready = t?.pending ?? zero, raised = t?.demanded ?? zero, paid = t?.paid ?? zero;
  const outstanding = overdue.amount + ready.amount + raised.amount;
  const counts: Record<TabKey, number> = { all: overdue.count + ready.count + raised.count + paid.count, overdue: overdue.count, pending: ready.count, demanded: raised.count, paid: paid.count };

  const changed = () => { qc.invalidateQueries({ queryKey: ["crm-demands"] }); qc.invalidateQueries({ queryKey: ["crm-milestones"] }); };
  const openRaise = (row: DemandRow) => { setRaiseRow(row); setRaiseNotes(""); };
  const cols = demandCols(canEdit, openRaise, setUndoRow);
  const [prefs, setPrefs] = useGridPrefs(PREFS_KEY, cols);

  async function handleRaise() {
    if (!raiseRow) return;
    setRaising(true);
    try {
      const res = await fetchWithAuth(`${API}/${raiseRow.Id}/demand`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ Notes: raiseNotes || undefined }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Could not raise demand");
      toast.success(`Demand raised: ${body.DemandNo}`);
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
      if (!res.ok) throw new Error(body.error || "Could not undo demand");
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
        body: JSON.stringify({ companyId: list.cpb.companyId || undefined, projectId: list.cpb.projectId || undefined, blockId: list.cpb.blockId || undefined, milestoneName: bulkMilestone.trim() || undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Bulk demand failed");
      toast.success(`Raised ${body.raised} demand${body.raised !== 1 ? "s" : ""}${body.skipped ? ` · ${body.skipped} already raised` : ""}${body.errors?.length ? ` · ${body.errors.length} error(s)` : ""}`);
      setBulkOpen(false); setBulkMilestone("");
      changed();
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setBulkRunning(false); }
  }
  const handleExport = async () => {
    setExporting(true);
    try {
      const p = new URLSearchParams(params);
      p.delete("page"); p.delete("pageSize");
      exportGrid((await fetchDemands(p)).demands, cols, `demands-${tab}`);
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setExporting(false); }
  };
  const w = (n: number) => `${outstanding > 0 ? (n / outstanding) * 100 : 0}%`;

  return (
    <div className="space-y-4">
      <Breadcrumbs items={["Dashboard", "CRM", "Demands"]} />
      <MoneyBand eyebrow="CRM · Finance" title="Payment Demands" sub="Raised when a milestone falls due, or by hand here. A demand needs no approval."
        actions={<>
          {canEdit && <button type="button" onClick={() => setBulkOpen(true)} className={BAND_KEY_MAIN}><Zap size={13} /> Raise all</button>}
          <button type="button" onClick={() => refetch()} disabled={isFetching} className={cn(BAND_KEY, "w-9 !px-0")} title="Refresh" aria-label="Refresh"><RefreshCw size={13} className={isFetching ? "animate-spin" : ""} /></button>
        </>}
        lead={fmtShort(outstanding)} leadNote={result ? `balance to collect · ${counts.all - paid.count} open milestones` : ""}
        bar={<span className="flex w-full h-2.5 rounded-full overflow-hidden bg-white/15" title={`Overdue ${fmt(overdue.amount)} · Raised ${fmt(raised.amount)} · Not raised ${fmt(ready.amount)}`}>
          {overdue.amount > 0 && <span className={BAND_DOT.overdue} style={{ width: w(overdue.amount), minWidth: 3 }} />}
          {raised.amount > 0 && <span className={BAND_DOT.finance} style={{ width: w(raised.amount), minWidth: 3 }} />}
          {ready.amount > 0 && <span className={BAND_DOT.notDue} style={{ width: w(ready.amount), minWidth: 3 }} />}
        </span>}
        figures={[
          { label: "Overdue", dot: BAND_DOT.overdue, value: fmtShort(overdue.amount), note: `${overdue.count} milestone${overdue.count === 1 ? "" : "s"}`, exact: fmt(overdue.amount), alert: overdue.count > 0 },
          { label: "Raised, awaiting payment", dot: BAND_DOT.finance, value: fmtShort(raised.amount), note: `${raised.count} milestone${raised.count === 1 ? "" : "s"}`, exact: fmt(raised.amount) },
          { label: "Not raised", dot: BAND_DOT.notDue, value: fmtShort(ready.amount), note: `${ready.count} milestone${ready.count === 1 ? "" : "s"}`, exact: fmt(ready.amount) },
          { label: "Paid", dot: BAND_DOT.collected, value: fmtShort(paid.amount), note: `${paid.count} milestone${paid.count === 1 ? "" : "s"}`, exact: fmt(paid.amount) },
        ]} />
      <div className={cn(GRID_CARD, "rounded-xl overflow-hidden")}>
        <GridTabs<TabKey> label="Demands" active={tab} onChange={setTab} tabs={TABS.map((x) => ({ ...x, count: result ? counts[x.key] : null }))} />
        <div className="px-3 py-2 flex flex-wrap items-center gap-2 border-b border-border">
          <GridSearch value={list.searchInput} onChange={list.setSearchInput} placeholder="Customer, booking or milestone" />
          <CrmCompanyProjectBlockFilter value={list.cpb} onChange={list.setCpb} />
          {list.hasFilters && <button type="button" onClick={list.reset} className={GRID_BTN}>Clear filters</button>}
          <div className="ml-auto flex items-center gap-2">
            <GridSavedViews storageKey={VIEWS_KEY}
              current={{ status: tab, search: list.searchInput.trim(), cpb: list.cpb, sort: list.sort, pageSize }}
              onApply={(v) => {
                setPageSize(GRID_PAGE_SIZES.includes(v.pageSize as typeof GRID_PAGE_SIZES[number]) ? v.pageSize : GRID_PAGE_SIZES[0]);
                list.apply({ ...v, status: "All" });
                setTabRaw(TABS.some((x) => x.key === v.status) ? (v.status as TabKey) : "all");
              }} />
            <GridColumnChooser cols={cols} prefs={prefs} onChange={setPrefs} />
            <button type="button" onClick={handleExport} disabled={exporting} className={GRID_BTN} title="Export to Excel"><Download size={13} /> <span className="hidden md:inline">{exporting ? "Exporting…" : "Export"}</span></button>
          </div>
        </div>
        <CrmGrid cols={cols} prefs={prefs} onPrefs={setPrefs} rows={result?.demands ?? []} rowKey={(m) => m.Id} noRowNumbers
          loading={isLoading} fetching={isFetching} error={error ? translateError((error as Error).message) : null} onRetry={() => refetch()}
          sort={list.sort} onSort={list.toggleSort} empty={`Nothing under "${TABS.find((x) => x.key === tab)!.label}" right now.`}
          page={list.page} pageSize={pageSize} total={result?.total ?? 0} onPage={list.setPage} onPageSize={(n) => { setPageSize(n); list.setPage(1); }} />
      </div>

      {raiseRow && (
        <Dialog open onOpenChange={(o) => { if (!o) { setRaiseRow(null); setRaiseNotes(""); } }}>
          <DialogContent className={`max-w-md ${DIALOG}`} style={{ border: RULE }}>
            <DialogHeader>
              <DialogTitle className="font-heading">Raise payment demand</DialogTitle>
              <DialogDescription className="text-xs">Gives it a demand number and notifies the assigned staff.</DialogDescription>
            </DialogHeader>
            <div style={{ border: RULE_SOFT }}>
              {[
                { label: "Booking", value: `${raiseRow.BookingNo}${raiseRow.ProjectName ? ` · ${raiseRow.ProjectName}` : ""} · ${raiseRow.UnitNo}` },
                { label: "Customer", value: raiseRow.ApplicantName },
                { label: "Milestone", value: `#${raiseRow.MilestoneNo} ${raiseRow.MilestoneName}` },
                { label: "Amount", value: fmt(balanceOf(raiseRow)), num: true },
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
            <DialogFooter className="gap-2">
              <button onClick={() => { setRaiseRow(null); setRaiseNotes(""); }} className={`${KEY_LINE} h-9 px-4`}>Cancel</button>
              <button onClick={handleRaise} disabled={raising} className={`${KEY_INK} h-9 px-4`}><Send className="w-3.5 h-3.5" /> {raising ? "Raising…" : "Raise demand"}</button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {undoRow && (
        <Dialog open onOpenChange={(o) => !o && setUndoRow(null)}>
          <DialogContent className={`max-w-md ${DIALOG}`} style={{ border: RULE }}>
            <DialogHeader><DialogTitle className="font-heading">Undo demand {undoRow.DemandNo}?</DialogTitle></DialogHeader>
            <p className="text-sm text-muted-foreground">
              It goes back to "Not raised" for <span className="font-semibold text-foreground"><ApplicantNames name={undoRow.ApplicantName} bookingId={undoRow.BookingId} /></span> ({undoRow.MilestoneName}) and its demand number is cleared.
            </p>
            <DialogFooter className="gap-2">
              <button onClick={() => setUndoRow(null)} className={`${KEY_LINE} h-9 px-4`}>Keep it</button>
              <button onClick={handleUndo} disabled={undoing} className={`${KEY_INK} h-9 px-4 !bg-destructive !border-destructive`}><Undo2 className="w-3.5 h-3.5" /> {undoing ? "Reverting…" : "Undo demand"}</button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {bulkOpen && (
        <Dialog open onOpenChange={(o) => { if (!o) { setBulkOpen(false); setBulkMilestone(""); } }}>
          <DialogContent className={`max-w-md ${DIALOG}`} style={{ border: RULE }}>
            <DialogHeader>
              <DialogTitle className="font-heading flex items-center gap-2"><Zap size={16} /> Raise all eligible demands</DialogTitle>
              <DialogDescription className="text-xs">
                Raises a demand for every milestone not yet raised that still has a balance, in the company / project / block chosen on the page{list.cpb.projectId || list.cpb.companyId ? "" : " (none chosen: every project you can see)"}. Raised or paid milestones are skipped.
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
      )}
    </div>
  );
};

export default CrmDemands;
