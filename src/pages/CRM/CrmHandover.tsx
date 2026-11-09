// CRM Handover: scheduling the key handover, the snag inspection and its defect list, and completing the handover
// (the date, who handed the keys, final dues cleared and the customer's acknowledgement on record).
import { CrmStatus } from "@/constants/crmStatuses";
import React, { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeft, ArrowRight, Download, ExternalLink, Key, Plus, RefreshCw } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import {
  CrmGrid, GridColumnChooser, GridFields, GridMiniTable, GridRelated, GridSavedViews, GridSearch, GridTabs, GridToneMark,
  exportGrid, useGridPrefs, GRID_BTN, GRID_CARD, GRID_PAGE_SIZES, GRID_SHEET_KEYS, type GridCol,
} from "@/components/crm/CrmDataTable";
import { useCrmListState, useSticky, listParams } from "@/hooks/useCrmListState";
import { BAND_DOT, BAND_KEY, BAND_KEY_MAIN, CollectionBar, Initials, MoneyBand, asName } from "./payments/parts";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DateInput } from "@/components/ui/date-input";
import { SearchableSelect } from "@/components/SearchableSelect";
import { CrmCompanyProjectBlockFilter } from "@/components/crm/CrmCompanyProjectBlockFilter";
import { usePageRights } from "@/hooks/usePageRights";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { promptNextStep } from "@/lib/workflowNav";
import { translateError } from "@/lib/translateError";
import { KEY_INK, KEY_LINE, KEY_RED, LBL, RULE, RULE_SOFT } from "./customers/config";

const API = "/api/crm/handover";
const SA_LEADS_API = "/api/sa/leads";

// The server's state machine, mirrored so no step is offered that it would refuse.
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  Scheduled: ["SnagInspection", "Cancelled"],
  SnagInspection: ["SnagPending", "Completed", "Cancelled"],
  SnagPending: ["Completed", "Cancelled"],
  Completed: [],
  Cancelled: [],
};
const STEPS = ["Scheduled", "SnagInspection", "SnagPending", "Completed"] as const;
const STATUS_LABEL: Record<string, string> = { Scheduled: "Scheduled", SnagInspection: "Inspecting", SnagPending: "Snags to fix", Completed: "Completed", Cancelled: "Cancelled" };
const ACTION_LABEL: Record<string, string> = { SnagInspection: "Start inspection", SnagPending: "Inspection done", Completed: "Complete handover", Cancelled: "Cancel handover" };

const SNAG_CATEGORIES = ["Electrical", "Plumbing", "Civil", "Paint", "Carpentry", "Other"];
const INP = "w-full h-9 border border-foreground/40 focus:border-foreground bg-card px-2.5 text-sm text-foreground outline-none";

// Dates where the user is (toISOString gives the UTC date, a day behind before 05:30 IST).
const localDay = (offsetDays = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const fmtDate = (d: any) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const emptySchedule = () => ({ BookingId: "", ScheduledDate: localDay(7), Notes: "" });

async function fetchHandoverByBooking(bookingId: string): Promise<any | null> {
  try {
    const r = await fetchWithAuth(`${API}?bookingId=${bookingId}`);
    if (!r.ok) return null;
    const rows = await r.json();
    return Array.isArray(rows) && rows.length ? rows[0] : null;
  } catch { return null; }
}

// Throws, so a failed load shows as one instead of an empty list.
async function fetchHandoversList(params: URLSearchParams) {
  const r = await fetchWithAuth(`${API}?${params}`);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error || `Could not load the handovers (${r.status}).`);
  return { rows: (data.rows || []) as any[], total: Number(data.total || 0), statusCounts: (data.statusCounts || {}) as Record<string, number> };
}
async function fetchDetail(id: number): Promise<any> {
  const r = await fetchWithAuth(`${API}/${id}`);
  if (!r.ok) throw new Error("Could not load the handover.");
  return r.json();
}
async function fetchEligibleBookings(): Promise<any[]> {
  try { const r = await fetchWithAuth(`${API}/eligible-bookings`); return r.ok ? r.json() : []; } catch { return []; }
}
// Staff who can hand the keys over (readable with the Handover right; it needed Sales Automation's, so the list was
// empty and a handover could not be completed).
async function fetchUsers(): Promise<{ value: string; label: string }[]> {
  try {
    const r = await fetchWithAuth(`${SA_LEADS_API}/users`);
    if (!r.ok) return [];
    const d: any[] = await r.json();
    return d.map((u) => ({ value: String(u.Id), label: u.Name }));
  } catch { return []; }
}

const Field: React.FC<{ label: string; children: React.ReactNode; hint?: React.ReactNode }> = ({ label, children, hint }) => (
  <label className="block space-y-1"><span className={`block ${LBL}`}>{label}</span>{children}{hint && <span className="block text-[0.6875rem] text-muted-foreground">{hint}</span>}</label>
);
const Foot: React.FC<{ children: React.ReactNode }> = ({ children }) => <div className="flex justify-end gap-2 pt-3" style={{ borderTop: RULE }}>{children}</div>;
const Title: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <DialogHeader><DialogTitle className="font-heading text-[0.75rem] font-bold uppercase tracking-[0.14em] flex items-center gap-2">{children}</DialogTitle></DialogHeader>
);

/** The four steps as one line: green once complete, amber on the way, red if cancelled. */
const StepBar: React.FC<{ status: string; onDark?: boolean }> = ({ status, onDark }) => {
  const at = status === "Completed" ? STEPS.length : STEPS.indexOf(status as any) + 1;
  const off = onDark ? "bg-white/15" : "bg-slate-200 dark:bg-slate-700";
  return (
    <span className="flex gap-0.5 w-full">
      {STEPS.map((s, i) => (
        <span key={s} title={STATUS_LABEL[s]} className={cn("flex-1 rounded-full", onDark ? "h-2.5" : "h-1.5",
          status === "Cancelled" ? "bg-rose-500/60" : i < at ? (status === "Completed" ? (onDark ? BAND_DOT.collected : "bg-emerald-500") : (onDark ? BAND_DOT.finance : "bg-amber-400")) : off)} />
      ))}
    </span>
  );
};

const handoverDash = <span className="text-muted-foreground">—</span>;
const TAB_KEYS = ["All", ...STEPS, "Cancelled"];
const HO_COLS: GridCol<any>[] = [
  { id: "customer", label: "Customer", locked: true, sortKey: "ApplicantName", csv: (r) => r.ApplicantName, cell: (r) => (
    <span className="flex items-center gap-3 py-1.5 min-w-0">
      <Initials name={r.ApplicantName} />
      <span className="min-w-0">
        <span className="block font-semibold text-foreground capitalize truncate" title={r.ApplicantName}>{asName(r.ApplicantName)}</span>
        <span className="block text-xs text-muted-foreground tabular-nums truncate">{[r.BookingNo, r.UnitNo, r.ProjectName].filter(Boolean).join(" · ")}</span>
      </span>
    </span>
  ) },
  { id: "progress", label: "Progress", sortKey: "Status", csv: (r) => STATUS_LABEL[r.Status] ?? r.Status, cell: (r) => (
    <span className="block min-w-[13rem] py-1.5">
      <StepBar status={r.Status} />
      <span className="mt-1.5 flex justify-between gap-3 text-xs">
        <span className={cn("font-medium", r.Status === "Cancelled" ? "text-destructive" : "text-foreground")}>{STATUS_LABEL[r.Status] ?? r.Status}</span>
        <span className="text-muted-foreground tabular-nums">{r.Status === "Cancelled" ? "" : `${r.Status === "Completed" ? STEPS.length : STEPS.indexOf(r.Status) + 1} of ${STEPS.length}`}</span>
      </span>
    </span>
  ) },
  { id: "scheduled", label: "Scheduled for", sortKey: "ScheduledDate", csv: (r) => r.ScheduledDate, cell: (r) => <span className="tabular-nums">{fmtDate(r.ScheduledDate)}</span> },
  { id: "handed", label: "Handed over", sortKey: "ActualHandoverDate", csv: (r) => r.ActualHandoverDate, cell: (r) => <span className="tabular-nums">{fmtDate(r.ActualHandoverDate)}</span> },
  { id: "snags", label: "Open snags", align: "right", csv: (r) => r.OpenSnagCount, cell: (r) => (r.OpenSnagCount > 0 ? <span className="tabular-nums font-semibold text-destructive">{r.OpenSnagCount}</span> : handoverDash) },
  { id: "keys", label: "Keys handed by", csv: (r) => r.KeyHandoverByName, cell: (r) => r.KeyHandoverByName || handoverDash },
  { id: "booking", label: "Booking", hiddenByDefault: true, sortKey: "BookingNo", csv: (r) => r.BookingNo, cell: (r) => <span className="tabular-nums">{r.BookingNo}</span> },
  { id: "unit", label: "Unit", hiddenByDefault: true, csv: (r) => r.UnitNo, cell: (r) => r.UnitNo },
  { id: "project", label: "Project", hiddenByDefault: true, csv: (r) => r.ProjectName, cell: (r) => r.ProjectName || "—" },
  { id: "mobile", label: "Mobile", hiddenByDefault: true, csv: (r) => r.Mobile, cell: (r) => <span className="tabular-nums">{r.Mobile || "—"}</span> },
  { id: "dues", label: "Final dues", hiddenByDefault: true, csv: (r) => (r.FinalDuesCleared ? "Cleared" : "Not confirmed"), cell: (r) => (r.FinalDuesCleared ? "Cleared" : "Not confirmed") },
  { id: "notes", label: "Notes", hiddenByDefault: true, csv: (r) => r.Notes, cell: (r) => r.Notes || "—" },
];

const CrmHandover: React.FC = () => {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const deepLinkBookingId = sp.get("bookingId");
  const rights = usePageRights("crm-handover");

  // The open handover lives in the address, so a refresh or a shared link lands on it.
  const openParam = sp.get("open");
  const selectedId = openParam ? Number(openParam) : null;
  const openHandover = (id: number) => setSp((p) => { p.set("open", String(id)); return p; });
  const closeHandover = () => setSp((p) => { p.delete("open"); return p; });

  const [pageSize, setPageSize] = useState<number>(GRID_PAGE_SIZES[0]);
  const [exporting, setExporting] = useState(false);
  const list = useCrmListState({ pageSize, defaultSort: { key: "", dir: "desc" } });
  const [prefs, setPrefs] = useGridPrefs("crm-handover-cols-v1", HO_COLS);
  const [newDialog, setNewDialog] = useState(false);
  const [snagDialog, setSnagDialog] = useState(false);
  const [completeDialog, setCompleteDialog] = useState(false);
  const [cancelDialog, setCancelDialog] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newForm, setNewForm] = useState(emptySchedule);
  const [snagForm, setSnagForm] = useState({ Category: "Electrical", Description: "" });
  const [completeForm, setCompleteForm] = useState({ ActualHandoverDate: "", KeyHandoverBy: "", FinalDuesCleared: false, CustomerAcknowledged: false });

  const params = useMemo(() => listParams(list.query), [list.query]);
  const { data, isLoading, isError, error, isFetching, refetch } = useQuery({
    queryKey: ["crm-handovers", params.toString()],
    queryFn: () => fetchHandoversList(params),
    staleTime: 30_000,
  });
  const listResult = useSticky(data);
  const counts = listResult?.statusCounts ?? {};
  const countOf = (s: string) => (s === "All" ? Object.values(counts).reduce((a, b) => a + b, 0) : counts[s] || 0);

  const { data: detail, isError: detailError, isFetching: detailFetching, refetch: refetchDetail } = useQuery({
    queryKey: ["crm-handover-detail", selectedId],
    queryFn: () => fetchDetail(selectedId!),
    enabled: selectedId != null,
    staleTime: 30_000,
  });
  // Only bookings that pass every handover gate.
  const { data: eligibleBookings = [], isLoading: loadingEligible } = useQuery({
    queryKey: ["crm-handover-eligible"], queryFn: fetchEligibleBookings, staleTime: 2 * 60_000, enabled: newDialog,
  });
  const { data: users = [] } = useQuery({ queryKey: ["sa-users"], queryFn: fetchUsers, staleTime: 5 * 60_000, enabled: completeDialog });

  // ?bookingId=X opens that booking's handover, or the Schedule dialog for it.
  useEffect(() => {
    if (!deepLinkBookingId) return;
    fetchHandoverByBooking(deepLinkBookingId).then((existing) => {
      setSp((prev) => { prev.delete("bookingId"); if (existing) prev.set("open", String(existing.Id)); return prev; }, { replace: true });
      if (!existing && rights.canCreate) { setNewForm({ ...emptySchedule(), BookingId: deepLinkBookingId }); setNewDialog(true); }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkBookingId]);

  const refresh = (withDetail = true) => {
    ["crm-handovers", "crm-handover-eligible", "crm-booking-lifecycle", "crm-legal-milestones", "crm-dashboard", "crm-possession-notice"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    if (withDetail && selectedId != null) qc.invalidateQueries({ queryKey: ["crm-handover-detail", selectedId] });
  };
  const call = async (url: string, method: string, body?: unknown) => {
    const res = await fetchWithAuth(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || "The handover could not be changed.");
    return d;
  };

  const handleSchedule = async () => {
    if (!newForm.BookingId) return void toast.error("Select a booking.");
    setSaving(true);
    try {
      await call(API, "POST", { BookingId: parseInt(newForm.BookingId), ScheduledDate: newForm.ScheduledDate || null, Notes: newForm.Notes || null });
      toast.success("Handover scheduled");
      setNewDialog(false);
      // The default date comes back for the next one (it was left empty).
      setNewForm(emptySchedule());
      refresh(false);
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setSaving(false); }
  };

  const handleAddSnag = async () => {
    if (selectedId == null || !snagForm.Description.trim()) return void toast.error("Describe the defect.");
    setSaving(true);
    try {
      await call(`${API}/${selectedId}/snags`, "POST", snagForm);
      toast.success("Snag raised");
      setSnagDialog(false);
      setSnagForm({ Category: "Electrical", Description: "" });
      refresh();
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setSaving(false); }
  };

  const handleResolveSnag = async (snagId: number) => {
    if (selectedId == null) return;
    try {
      await call(`${API}/${selectedId}/snags/${snagId}`, "PUT", { Status: CrmStatus.RESOLVED });
      toast.success("Snag resolved");
      refresh();
    } catch (e: any) { toast.error(translateError(e.message)); }
  };

  const moveTo = async (targetStatus: string) => {
    if (selectedId == null) return;
    if (targetStatus === "Completed") {
      // Completing needs the full record; the date defaults to today.
      setCompleteForm({ ActualHandoverDate: localDay(), KeyHandoverBy: "", FinalDuesCleared: false, CustomerAcknowledged: false });
      return setCompleteDialog(true);
    }
    // Cancelling asks first (it went through on one click).
    if (targetStatus === "Cancelled") return setCancelDialog(true);
    try {
      await call(`${API}/${selectedId}`, "PUT", { Status: targetStatus });
      toast.success(`Handover: ${STATUS_LABEL[targetStatus] ?? targetStatus}`);
      refresh();
    } catch (e: any) { toast.error(translateError(e.message)); }
  };

  const handleCancel = async () => {
    if (selectedId == null) return;
    setSaving(true);
    try {
      await call(`${API}/${selectedId}`, "PUT", { Status: "Cancelled" });
      toast.success("Handover cancelled");
      setCancelDialog(false);
      refresh();
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setSaving(false); }
  };

  const handleComplete = async () => {
    if (selectedId == null) return;
    if (!completeForm.ActualHandoverDate) return void toast.error("Enter the handover date.");
    if (completeForm.ActualHandoverDate > localDay()) return void toast.error("The handover date can't be in the future.");
    if (!completeForm.KeyHandoverBy) return void toast.error("Select who handed over the keys.");
    if (!completeForm.FinalDuesCleared) return void toast.error("Confirm that every final due is cleared.");
    if (!completeForm.CustomerAcknowledged) return void toast.error("Confirm that the customer took possession.");
    setSaving(true);
    try {
      await call(`${API}/${selectedId}`, "PUT", {
        Status: "Completed", ActualHandoverDate: completeForm.ActualHandoverDate,
        KeyHandoverBy: parseInt(completeForm.KeyHandoverBy), FinalDuesCleared: true, CustomerAcknowledged: true,
      });
      toast.success("Handover completed");
      setCompleteDialog(false);
      refresh();
      promptNextStep(navigate, "Handover completed: raise after-sales service tickets for any warranty or follow-up issue.", "/crm/service-tickets", "Go to Service Tickets");
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setSaving(false); }
  };

  const h = detail?.handover;
  const currentStatus = h?.Status ?? "";
  const nextSteps = ALLOWED_TRANSITIONS[currentStatus] ?? [];
  const snags: any[] = detail?.snags ?? [];
  const openSnags = snags.filter((s) => s.Status !== CrmStatus.RESOLVED).length;

  const active = countOf("All") - countOf("Cancelled");
  const inspecting = countOf("SnagInspection") + countOf("SnagPending");
  const hasFilters = list.hasFilters;
  const handleExport = async () => {
    setExporting(true);
    try {
      const url = (n: number) => { const p = new URLSearchParams(params); p.set("page", String(n)); p.set("pageSize", "100"); return p; };
      const first = await fetchHandoversList(url(1));
      let out = first.rows;
      for (let n = 2; out.length < first.total; n++) { const more = await fetchHandoversList(url(n)); if (!more.rows.length) break; out = out.concat(more.rows); }
      exportGrid(out, HO_COLS, `handovers-${list.status}`);
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setExporting(false); }
  };
  const nextLine = !h ? "" : h.Status === "Completed" ? "Keys handed over. Any later defect goes to Service Tickets."
    : h.Status === "Cancelled" ? "Cancelled. A new handover can be scheduled."
    : openSnags > 0 ? `${openSnags} snag${openSnags === 1 ? "" : "s"} still open. They must be resolved before the handover can be completed.`
    : "Move it on when the step is done. Completing needs the date, who handed the keys, final dues and the customer's acknowledgement.";

  return (
    <div className="space-y-4">
      <Breadcrumbs items={["Dashboard", "CRM", "Handover"]} />
      {selectedId != null ? (
        detailError ? (
          <div className={cn(GRID_CARD, "px-4 py-10 text-center text-sm")}>
            <p className="text-destructive">Could not load this handover.</p>
            <button type="button" onClick={closeHandover} className={cn(GRID_BTN, "mt-3")}>All handovers</button>
          </div>
        ) : !h ? <div className="px-4 py-10 text-center text-sm text-muted-foreground">Loading…</div> : (
          <div className="space-y-4">
            <MoneyBand eyebrow="Handover" title={<span className="capitalize">{asName(h.ApplicantName)}</span>}
              status={<span className="inline-flex items-center h-5 px-2 rounded-full border border-white/30 text-[0.6875rem] font-semibold text-white">{STATUS_LABEL[h.Status] ?? h.Status}</span>}
              sub={[h.BookingNo, h.UnitNo, h.ProjectName, h.Mobile].filter(Boolean).join(" · ")}
              actions={<>
                <button type="button" onClick={closeHandover} className={BAND_KEY}><ArrowLeft size={13} /> All handovers</button>
                <Link to={`/crm/bookings?view=${h.BookingId}`} className={BAND_KEY}><ExternalLink size={13} /> Open booking</Link>
                {rights.canEdit && nextSteps.map((s) => (
                  <button key={s} type="button" onClick={() => moveTo(s)} disabled={s === "Completed" && openSnags > 0} title={s === "Completed" && openSnags > 0 ? "Resolve the open snags first." : undefined}
                    className={cn(s === "Cancelled" ? `${BAND_KEY} !text-rose-300` : s === "Completed" ? BAND_KEY_MAIN : BAND_KEY, "disabled:opacity-50")}>
                    {ACTION_LABEL[s] ?? s} {s !== "Cancelled" && <ArrowRight size={12} />}
                  </button>
                ))}
                <button type="button" onClick={() => refetchDetail()} disabled={detailFetching} className={cn(BAND_KEY, "w-9 !px-0")} title="Refresh" aria-label="Refresh"><RefreshCw size={13} className={detailFetching ? "animate-spin" : ""} /></button>
              </>}
              lead={STATUS_LABEL[h.Status] ?? h.Status} leadNote={h.Status === "Cancelled" ? "not going ahead" : `step ${h.Status === "Completed" ? STEPS.length : STEPS.indexOf(h.Status) + 1} of ${STEPS.length}`}
              bar={<StepBar status={h.Status} onDark />}
              figures={[
                { label: "Scheduled for", value: fmtDate(h.ScheduledDate), note: "Planned date" },
                { label: "Handed over", dot: h.ActualHandoverDate ? BAND_DOT.collected : undefined, value: fmtDate(h.ActualHandoverDate), note: h.KeyHandoverByName ? `By ${h.KeyHandoverByName}` : "Not yet" },
                { label: "Final dues", dot: h.FinalDuesCleared ? BAND_DOT.collected : undefined, value: h.FinalDuesCleared ? "Cleared" : "Not confirmed", note: "Confirmed at completion" },
                { label: "Open snags", dot: openSnags > 0 ? BAND_DOT.overdue : undefined, value: String(openSnags), note: `of ${snags.length} raised`, alert: openSnags > 0 },
              ]}
              footer={nextLine} />
            <GridRelated icon={AlertTriangle} title="Snags and defects" count={snags.length}
              action={rights.canCreate && !["Completed", "Cancelled"].includes(currentStatus) ? <button type="button" onClick={() => setSnagDialog(true)} className={cn(GRID_SHEET_KEYS.KEY_LINE, "h-7 px-2.5")}><Plus size={12} /> Raise snag</button> : undefined}>
              <GridMiniTable rows={snags} rowKey={(s: any) => s.Id} empty="No snags raised." cols={[
                { header: "Category", cell: (s: any) => <span className="font-medium">{s.Category}</span> },
                { header: "Defect", cell: (s: any) => <span className="block whitespace-normal max-w-[28rem]">{s.Description}</span> },
                { header: "Raised by", cell: (s: any) => <span className="text-muted-foreground">{s.RaisedByName || "—"}{s.CreatedAt ? ` · ${fmtDate(s.CreatedAt)}` : ""}</span> },
                { header: "Resolved by", cell: (s: any) => <span className="text-muted-foreground">{s.ResolvedByName ? `${s.ResolvedByName}${s.ResolvedAt ? ` · ${fmtDate(s.ResolvedAt)}` : ""}` : "—"}</span> },
                { header: "Status", cell: (s: any) => <GridToneMark text={s.Status === CrmStatus.RESOLVED ? "Resolved" : "Open"} tone={s.Status === CrmStatus.RESOLVED ? "done" : "stopped"} /> },
                { header: "Actions", cell: (s: any) => (s.Status !== CrmStatus.RESOLVED && rights.canEdit ? <button type="button" onClick={() => handleResolveSnag(s.Id)} className={cn(GRID_SHEET_KEYS.KEY_LINE, "h-7 px-2.5")}>Mark resolved</button> : null) },
              ]} />
            </GridRelated>
            <GridRelated icon={Key} title="Handover record">
              <GridFields fields={[
                { label: "Keys handed by", value: h.KeyHandoverByName || "—" },
                { label: "Customer", value: h.CustomerAcknowledged ? "Took possession" : "Not yet" },
                { label: "Notes", value: h.Notes || "—", wide: true },
              ]} />
            </GridRelated>
          </div>
        )
      ) : (
      <>
      <MoneyBand eyebrow="CRM · Possession" title="Handover" sub="Schedule the key handover, inspect for snags and fix them, then hand over."
        actions={<>
          {rights.canCreate && <button type="button" onClick={() => { setNewForm(emptySchedule()); setNewDialog(true); }} className={BAND_KEY_MAIN}><Key size={13} /> Schedule handover</button>}
          <button type="button" onClick={() => refetch()} disabled={isFetching} className={cn(BAND_KEY, "w-9 !px-0")} title="Refresh" aria-label="Refresh"><RefreshCw size={13} className={isFetching ? "animate-spin" : ""} /></button>
        </>}
        lead={`${countOf("Completed")} of ${active}`} leadNote="handovers completed"
        bar={<CollectionBar onDark due={active} collected={countOf("Completed")} finance={inspecting} recorded={0} />}
        figures={[
          { label: "Completed", dot: BAND_DOT.collected, value: String(countOf("Completed")), note: "Keys handed over" },
          { label: "Inspecting", dot: BAND_DOT.finance, value: String(inspecting), note: `${countOf("SnagPending")} with snags to fix`, alert: countOf("SnagPending") > 0 },
          { label: "Scheduled", dot: BAND_DOT.notDue, value: String(countOf("Scheduled")), note: "Inspection not started" },
          { label: "Cancelled", value: String(countOf("Cancelled")), note: "Not going ahead" },
        ]} />
      <div className={cn(GRID_CARD, "rounded-xl overflow-hidden")}>
        <GridTabs<string> label="Handovers" active={list.status} onChange={list.setStatus} tabs={TAB_KEYS.map((k) => ({ key: k, label: k === "All" ? "All handovers" : STATUS_LABEL[k], count: listResult ? countOf(k) : null }))} />
        <div className="px-3 py-2 flex flex-wrap items-center gap-2 border-b border-border">
          <GridSearch value={list.searchInput} onChange={list.setSearchInput} placeholder="Customer, booking or unit" />
          <CrmCompanyProjectBlockFilter value={list.cpb} onChange={list.setCpb} />
          {hasFilters && <button type="button" onClick={list.reset} className={GRID_BTN}>Clear filters</button>}
          <div className="ml-auto flex items-center gap-2">
            <GridSavedViews storageKey="crm-handover-views"
              current={{ status: list.status, search: list.searchInput.trim(), cpb: list.cpb, sort: list.sort, pageSize }}
              onApply={(v) => { setPageSize(GRID_PAGE_SIZES.includes(v.pageSize as typeof GRID_PAGE_SIZES[number]) ? v.pageSize : GRID_PAGE_SIZES[0]); list.apply(v); }} />
            <GridColumnChooser cols={HO_COLS} prefs={prefs} onChange={setPrefs} />
            <button type="button" onClick={handleExport} disabled={exporting} className={GRID_BTN} title="Export to Excel"><Download size={13} /> <span className="hidden md:inline">{exporting ? "Exporting…" : "Export"}</span></button>
          </div>
        </div>
        <CrmGrid cols={HO_COLS} prefs={prefs} onPrefs={setPrefs} rows={listResult?.rows ?? []} rowKey={(r) => r.Id} noRowNumbers
          loading={isLoading} fetching={isFetching} error={isError ? translateError((error as Error)?.message) : null} onRetry={() => refetch()}
          sort={list.sort} onSort={list.toggleSort} onRowClick={(r) => openHandover(r.Id)}
          empty={hasFilters ? "No handover matches these filters." : "No handover scheduled yet. One can be scheduled once the agreement is registered, the possession notice acknowledged, any NOC issued and every due cleared."}
          page={list.page} pageSize={pageSize} total={listResult?.total ?? 0} onPage={list.setPage} onPageSize={(n) => { setPageSize(n); list.setPage(1); }} />
      </div>
      </>
      )}

      <Dialog open={newDialog} onOpenChange={(o) => { if (!o) setNewDialog(false); }}>
        <DialogContent className="max-w-md p-5 gap-4 rounded-none" style={{ border: RULE }}>
          <Title><Key size={14} /> Schedule handover</Title>
          <Field label="Booking *" hint="Only bookings ready for it: agreement registered, Pre-Possession Ready, possession notice acknowledged, any NOC issued, every due cleared.">
            <SearchableSelect value={newForm.BookingId} onChange={(v) => setNewForm((f) => ({ ...f, BookingId: v }))}
              placeholder={loadingEligible ? "Loading bookings…" : eligibleBookings.length ? "Select booking" : "No booking is ready for handover"}
              searchPlaceholder="Search booking, customer or unit…"
              options={(eligibleBookings as any[]).map((b: any) => ({ value: String(b.Id), label: [b.BookingNo, b.ApplicantName, b.UnitNo].filter(Boolean).join(" · ") }))} />
          </Field>
          <Field label="Scheduled for"><DateInput value={newForm.ScheduledDate} onChange={(e) => setNewForm((f) => ({ ...f, ScheduledDate: e.target.value }))} className={INP} /></Field>
          <Field label="Notes"><textarea value={newForm.Notes} onChange={(e) => setNewForm((f) => ({ ...f, Notes: e.target.value }))} rows={2} className={`${INP} h-auto py-2 resize-none`} /></Field>
          <Foot>
            <button onClick={() => setNewDialog(false)} className={`${KEY_LINE} h-9 px-4`}>Cancel</button>
            <button onClick={handleSchedule} disabled={saving || !newForm.BookingId} className={`${KEY_INK} h-9 px-4`}>{saving ? "Scheduling…" : "Schedule"}</button>
          </Foot>
        </DialogContent>
      </Dialog>

      <Dialog open={snagDialog} onOpenChange={(o) => { if (!o) setSnagDialog(false); }}>
        <DialogContent className="max-w-sm p-5 gap-4 rounded-none" style={{ border: RULE }}>
          <Title><AlertTriangle size={14} /> Raise snag</Title>
          <Field label="Category">
            <select value={snagForm.Category} onChange={(e) => setSnagForm((f) => ({ ...f, Category: e.target.value }))} className={INP}>
              {SNAG_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Defect *"><textarea value={snagForm.Description} onChange={(e) => setSnagForm((f) => ({ ...f, Description: e.target.value }))} rows={3} className={`${INP} h-auto py-2 resize-none`} /></Field>
          <Foot>
            <button onClick={() => setSnagDialog(false)} className={`${KEY_LINE} h-9 px-4`}>Cancel</button>
            <button onClick={handleAddSnag} disabled={saving || !snagForm.Description.trim()} className={`${KEY_INK} h-9 px-4`}>{saving ? "Raising…" : "Raise snag"}</button>
          </Foot>
        </DialogContent>
      </Dialog>

      <Dialog open={cancelDialog} onOpenChange={(o) => { if (!o) setCancelDialog(false); }}>
        <DialogContent className="max-w-sm p-5 gap-4 rounded-none" style={{ border: RULE }}>
          <Title>Cancel handover</Title>
          <p className="text-sm">Cancel the handover for {h?.ApplicantName} ({h?.BookingNo})? It can't be resumed; a new one would be scheduled.</p>
          <Foot>
            <button onClick={() => setCancelDialog(false)} className={`${KEY_LINE} h-9 px-4`}>Keep</button>
            <button onClick={handleCancel} disabled={saving} className={`${KEY_RED} h-9 px-4`}>{saving ? "Cancelling…" : "Cancel handover"}</button>
          </Foot>
        </DialogContent>
      </Dialog>

      {/* The four things the server requires for Completed: the date, who handed the keys, final dues cleared, and
          the customer's acknowledgement. */}
      <Dialog open={completeDialog} onOpenChange={(o) => { if (!o) setCompleteDialog(false); }}>
        <DialogContent className="max-w-md p-5 gap-4 rounded-none" style={{ border: RULE }}>
          <Title><Key size={14} /> Complete handover</Title>
          <p className="text-xs text-muted-foreground -mt-2">The permanent record of the key handover; every item is needed.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Handed over on *"><DateInput value={completeForm.ActualHandoverDate} onChange={(e) => setCompleteForm((f) => ({ ...f, ActualHandoverDate: e.target.value }))} className={INP} /></Field>
            <Field label="Keys handed by *">
              <SearchableSelect value={completeForm.KeyHandoverBy} onChange={(v) => setCompleteForm((f) => ({ ...f, KeyHandoverBy: v }))}
                placeholder={users.length ? "Select staff" : "No staff listed"} searchPlaceholder="Search staff…" options={users} />
            </Field>
          </div>
          <div style={{ border: RULE }}>
            {([
              ["FinalDuesCleared", "Every final due is cleared: no payment demand remains on this booking."],
              ["CustomerAcknowledged", "The customer took possession and received the keys."],
            ] as const).map(([k, text], i) => (
              <label key={k} className="flex items-start gap-2.5 px-3 py-2.5 cursor-pointer hover:bg-primary/5" style={i === 0 ? { borderBottom: RULE_SOFT } : undefined}>
                <input type="checkbox" checked={completeForm[k]} onChange={(e) => setCompleteForm((f) => ({ ...f, [k]: e.target.checked }))} className="mt-0.5 w-4 h-4 accent-foreground" />
                <span className="text-sm">{text}</span>
              </label>
            ))}
          </div>
          <Foot>
            <button onClick={() => setCompleteDialog(false)} className={`${KEY_LINE} h-9 px-4`}>Cancel</button>
            <button onClick={handleComplete} disabled={saving} className={`${KEY_INK} h-9 px-4`}>{saving ? "Completing…" : "Complete handover"}</button>
          </Foot>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CrmHandover;
