// CRM NOC: one No Objection Certificate per booking, once the Agreement for Sale is registered: from the bank when the
// booking is loan-financed (the lender releases its charge), from the developer otherwise (no dues outstanding).
// Requested, approved, then issued; Handover waits for it.
import { CrmStatus } from "@/constants/crmStatuses";
import React, { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  AlertTriangle, ArrowLeft, Building2, CheckCircle2, CheckSquare, Copy, Download, FileText, Home, Info, Landmark, Lock, PenSquare,
  Plus, RefreshCw, RotateCcw, ShieldCheck,
} from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SearchableSelect } from "@/components/SearchableSelect";
import { ApprovalActions } from "@/components/ApprovalActions";
import { ApprovalTrailTimeline } from "@/components/ApprovalStatusChain";
import { ApplicantNames } from "@/components/crm/ApplicantNames";
import { CrmCompanyProjectBlockFilter } from "@/components/crm/CrmCompanyProjectBlockFilter";
import {
  CrmAppPage, CrmGrid, GridBulkBar, GridColumnChooser, GridDateFilter, GridFields, GridGuidance, GridHighlights, GridMetric, GridPath,
  GridRelated, GridSavedViews, GridSearch, GridSegment, GridStatusPill, GridTabs, exportGrid, gridListMeta, gridVisibleCols,
  resolveGridDateRange, useGridPrefs, GRID_ANY_DATE, GRID_BTN, GRID_BTN_BRAND, GRID_CARD, GRID_INPUT, GRID_LABEL, GRID_PAGE_SIZES,
  type GridCol, type GridDateRange, type GridGuidanceTone, type GridPathState,
} from "@/components/crm/CrmDataTable";
import { fmtRupees } from "@/components/crm/FinancialStatusBar";
import { usePageRights } from "@/hooks/usePageRights";
import { useUrlParam } from "@/hooks/useUrlParam";
import { useCrmListState, useSticky, listParams, type CrmListQuery, type CrmSort } from "@/hooks/useCrmListState";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { promptNextStep } from "@/lib/workflowNav";
import { translateError } from "@/lib/translateError";
import { cn } from "@/lib/utils";

const API = "/api/crm/noc";
const PREFS_KEY = "crm-noc-grid";
const VIEWS_KEY = "crm-noc-saved-views";
const ALL = "All";
const DEFAULT_SORT: CrmSort = { key: "CreatedAt", dir: "desc" };
const STATUSES = ["Pending", "Approved", "Issued", "Rejected"] as const;
const STATUS_LABEL: Record<string, string> = { Pending: "Awaiting approval", Approved: "To be issued", Issued: "Issued", Rejected: "Rejected" };
const statusText = (s: string) => STATUS_LABEL[s] || s;
type TypeKey = "All" | "Organisation" | "Bank";
const typeText = (t: string) => (t === "Bank" ? "Bank" : "Developer");
const TypeIcon = (t: string) => (t === "Bank" ? Landmark : Building2);

const fmt = (n: number | null | undefined) => (n != null ? fmtRupees(Number(n)) : "—");
const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");

/** This page's own filters beyond the common list ones: who issues it, and when it was requested. */
interface ExtraFilters { type: TypeKey; requested: GridDateRange }
const NO_EXTRA: ExtraFilters = { type: "All", requested: GRID_ANY_DATE };
function queryString(q: CrmListQuery, x: ExtraFilters): URLSearchParams {
  const p = listParams(q, ALL);
  if (x.type !== "All") p.set("type", x.type);
  const { from, to } = resolveGridDateRange(x.requested);
  if (from) p.set("dateFrom", from);
  if (to) p.set("dateTo", to);
  return p;
}
interface NocList { rows: any[]; total: number; statusCounts: Record<string, number>; typeCounts: Record<string, number> }
// Throws, so a failed load shows as one instead of an empty list.
async function fetchNocList(q: CrmListQuery, x: ExtraFilters): Promise<NocList> {
  const r = await fetchWithAuth(`${API}?${queryString(q, x)}`);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error || `Could not load the NOCs (${r.status}).`);
  return { rows: data.rows || [], total: Number(data.total || 0), statusCounts: data.statusCounts || {}, typeCounts: data.typeCounts || {} };
}
async function fetchAllNocs(q: CrmListQuery, x: ExtraFilters): Promise<any[]> {
  const p = queryString(q, x);
  p.delete("page"); p.delete("pageSize");
  const r = await fetchWithAuth(`${API}?${p}`);
  const data = await r.json().catch(() => []);
  if (!r.ok) throw new Error((data as any)?.error || `Could not export the NOCs (${r.status}).`);
  return data;
}
async function fetchNoc(id: number): Promise<any> {
  const r = await fetchWithAuth(`${API}/${id}`);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error || `Could not load this NOC (${r.status}).`);
  return data;
}
// The NOC type is resolved per booking from how it is financed, never chosen.
async function fetchEligibleBookings(): Promise<any[]> {
  try { const r = await fetchWithAuth(`${API}/eligible-bookings`); return r.ok ? r.json() : []; } catch { return []; }
}
async function fetchBookingContext(bookingId: string): Promise<any> {
  if (!bookingId) return null;
  try { const r = await fetchWithAuth(`${API}/booking/${bookingId}/context`); return r.ok ? r.json() : null; } catch { return null; }
}
// The NOC of one booking, straight from the server (the list is paged). No type unless the link names one.
async function fetchNocByBooking(bookingId: string, nocType?: string | null): Promise<any | null> {
  try {
    const params = new URLSearchParams({ bookingId });
    if (nocType) params.set("nocType", nocType);
    const r = await fetchWithAuth(`${API}/by-booking?${params}`);
    return r.ok ? r.json() : null;
  } catch { return null; }
}

const EMPTY_FORM = { BookingId: "", NocType: "Organisation" as string, NocDate: "", Reason: "", BankName: "", LoanAccountNo: "", LoanAmount: "" };

const TypeTag: React.FC<{ type: string }> = ({ type }) => {
  const Icon = TypeIcon(type);
  return <span className="inline-flex items-center gap-1.5"><Icon size={13} className="text-muted-foreground" />{typeText(type)}</span>;
};

const NOC_COLS: GridCol<any>[] = [
  { id: "no", label: "NOC", sortKey: "NocNo", locked: true, cell: (n) => <span className="font-semibold text-primary hover:underline tabular-nums">{n.NocNo}</span>, csv: (n) => n.NocNo },
  {
    id: "customer", label: "Customer", sortKey: "ApplicantName",
    cell: (n) => <span className="truncate block max-w-[16rem]" onClick={(e) => e.stopPropagation()}><ApplicantNames name={n.ApplicantName} bookingId={n.BookingId} applicationId={n.ApplicationId} /></span>,
    csv: (n) => n.ApplicantName,
  },
  { id: "booking", label: "Booking", sortKey: "BookingNo", cell: (n) => <span className="tabular-nums">{n.BookingNo}</span>, csv: (n) => n.BookingNo },
  {
    id: "unit", label: "Project · unit", sortKey: "ProjectName",
    cell: (n) => <span className="truncate block max-w-[14rem]">{[n.ProjectName, n.UnitNo].filter(Boolean).join(" · ") || "—"}</span>,
    csv: (n) => [n.ProjectName, n.UnitNo].filter(Boolean).join(" · "),
  },
  { id: "type", label: "From", sortKey: "NocType", cell: (n) => <TypeTag type={n.NocType} />, csv: (n) => typeText(n.NocType) },
  { id: "lender", label: "Lender", cell: (n) => (n.NocType === "Bank" ? n.BankName || "—" : <span className="text-muted-foreground">—</span>), csv: (n) => (n.NocType === "Bank" ? n.BankName : "") },
  { id: "loan", label: "Loan amount", sortKey: "LoanAmount", align: "right", cell: (n) => <span className="tabular-nums">{n.NocType === "Bank" && n.LoanAmount ? fmt(n.LoanAmount) : "—"}</span>, csv: (n) => (n.NocType === "Bank" ? n.LoanAmount : "") },
  { id: "loanAc", label: "Loan account", hiddenByDefault: true, cell: (n) => <span className="tabular-nums">{n.LoanAccountNo || "—"}</span>, csv: (n) => n.LoanAccountNo },
  { id: "requested", label: "Requested", sortKey: "NocDate", cell: (n) => <span className="tabular-nums">{fmtDate(n.NocDate)}</span>, csv: (n) => fmtDate(n.NocDate) },
  { id: "approved", label: "Approved", sortKey: "ApprovalDate", hiddenByDefault: true, cell: (n) => <span className="tabular-nums">{fmtDate(n.ApprovalDate)}</span>, csv: (n) => fmtDate(n.ApprovalDate) },
  { id: "issued", label: "Issued", sortKey: "IssuedDate", cell: (n) => <span className="tabular-nums">{fmtDate(n.IssuedDate)}</span>, csv: (n) => fmtDate(n.IssuedDate) },
  { id: "status", label: "Status", sortKey: "Status", cell: (n) => <GridStatusPill status={n.Status} label={statusText(n.Status)} />, csv: (n) => statusText(n.Status) },
  { id: "agreement", label: "Agreement", hiddenByDefault: true, cell: (n) => <span className="tabular-nums">{n.AgreementNo || "—"}</span>, csv: (n) => n.AgreementNo },
  { id: "reason", label: "Reason", hiddenByDefault: true, cell: (n) => <span className="truncate block max-w-[18rem]" title={n.Reason || ""}>{n.Reason || "—"}</span>, csv: (n) => n.Reason },
  { id: "notes", label: "Notes", hiddenByDefault: true, cell: (n) => <span className="truncate block max-w-[18rem]" title={n.Notes || ""}>{n.Notes || "—"}</span>, csv: (n) => n.Notes },
];

/** The NOC's stages, read from what is recorded. */
function nocPath(n: any): { label: string; state: GridPathState; note?: string }[] {
  const rejected = n.Status === CrmStatus.REJECTED;
  const approved = n.Status === CrmStatus.APPROVED || n.Status === "Issued";
  const agreementOk = n.AgreementStatus === CrmStatus.REGISTERED || !!n.AgreementNo;
  return [
    { label: "Agreement registered", state: agreementOk ? "done" : "current", note: n.AgreementNo ? `Agreement ${n.AgreementNo} · ${n.AgreementStatus}` : undefined },
    { label: "Requested", state: "done", note: `Requested ${fmtDate(n.NocDate)}` },
    {
      label: rejected ? "Rejected" : "Approved", state: rejected ? "failed" : approved ? "done" : "current",
      note: rejected ? "Rejected in approval. Correct it and send it again." : approved ? `Approved ${fmtDate(n.ApprovalDate)}` : "Waiting for an approver.",
    },
    { label: "Issued", state: n.Status === "Issued" ? "done" : n.Status === CrmStatus.APPROVED ? "current" : "todo", note: n.Status === "Issued" ? `Issued ${fmtDate(n.IssuedDate)}` : "Mark it issued when the certificate is handed over." },
  ];
}

// Only the notes are kept here: loan sanction and disbursement live on Loan Tracking (the real record).
function EditNotesDialog({ noc, onClose, onSaved }: { noc: any; onClose: () => void; onSaved: () => void }) {
  const [notes, setNotes] = useState(noc.Notes || "");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${noc.Id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ Notes: notes || null }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Could not save the notes.");
      toast.success("Notes saved");
      onSaved();
      onClose();
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setSaving(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm p-5 gap-4">
        <DialogHeader><DialogTitle>Notes · {noc.NocNo}</DialogTitle></DialogHeader>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={5} className={cn(GRID_INPUT, "h-auto py-2 text-sm resize-none")} aria-label="Notes" />
        <DialogFooter className="gap-2">
          <button type="button" onClick={onClose} className={GRID_BTN}>Cancel</button>
          <button type="button" onClick={save} disabled={saving} className={GRID_BTN_BRAND}>{saving ? "Saving…" : "Save notes"}</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Record page ──────────────────────────────────────────────────────────────
const NocRecord: React.FC<{ id: number; canEdit: boolean; onChanged: () => void }> = ({ id, canEdit, onChanged }) => {
  const navigate = useNavigate();
  const [markingIssued, setMarkingIssued] = useState(false);
  const [editNotes, setEditNotes] = useState(false);
  const { data: n, isLoading, isError, error, refetch } = useQuery({ queryKey: ["crm-noc-record", id], queryFn: () => fetchNoc(id), staleTime: 15_000, retry: false });
  if (isLoading) return <div className={cn(GRID_CARD, "py-16 text-center text-sm text-muted-foreground")}>Loading…</div>;
  if (isError || !n) return <div className={cn(GRID_CARD, "py-16 text-center text-sm text-destructive")}>{(error as Error)?.message || "Could not load this NOC."}</div>;

  const changed = () => { refetch(); onChanged(); };
  const markIssued = async () => {
    setMarkingIssued(true);
    try {
      const res = await fetchWithAuth(`${API}/${n.Id}/mark-issued`, { method: "PUT" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Could not mark it issued.");
      toast.success("NOC issued");
      changed();
      // The issued NOC is what Handover waits for.
      promptNextStep(navigate, "NOC issued: the handover can be scheduled once the possession notice is acknowledged.", "/crm/handover", "Go to Handover");
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setMarkingIssued(false); }
  };

  const bank = n.NocType === "Bank";
  const guidance: { tone: GridGuidanceTone; title: string; text: string; action?: React.ReactNode } =
    n.Status === "Issued" ? {
      tone: "done", title: `Issued ${fmtDate(n.IssuedDate)}`, text: "Nothing more to do here. The handover can be scheduled once the possession notice is acknowledged.",
      action: <button type="button" className={GRID_BTN} onClick={() => navigate("/crm/handover")}>Go to Handover</button>,
    } : n.Status === CrmStatus.APPROVED ? {
      tone: "moving", title: "Approved: ready to issue", text: `Hand the certificate over${bank ? ` (the lender, ${n.BankName || "the bank"}, releases its charge)` : ""}, then mark it issued. Handover waits for this.`,
      action: canEdit ? <button type="button" className={GRID_BTN_BRAND} onClick={markIssued} disabled={markingIssued}><CheckCircle2 size={13} /> {markingIssued ? "Marking…" : "Mark issued"}</button> : undefined,
    } : n.Status === CrmStatus.REJECTED ? {
      tone: "stopped", title: "Rejected", text: "An approver rejected this NOC. See the approval history for why, correct it, then send it again.",
    } : {
      tone: "waiting", title: "Waiting for approval", text: "It sits in the Approval Inbox. An approver can also approve or reject it from this page.",
    };

  return (
    <div className="space-y-4">
      <GridHighlights icon={ShieldCheck} object={`${typeText(n.NocType)} NOC · ${n.NocNo}`}
        title={<ApplicantNames name={n.ApplicantName} bookingId={n.BookingId} applicationId={n.ApplicationId} />}
        status={<GridStatusPill status={n.Status} label={statusText(n.Status)} />}
        sub={[n.BookingNo, [n.ProjectName, n.UnitNo].filter(Boolean).join(" · "), n.Mobile].filter(Boolean).join(" · ")}
        actions={<>
          {n.Status === CrmStatus.PENDING && <ApprovalActions status={n.Status} recordId={n.Id} endpoint={API} module="crm-noc" onSuccess={changed} />}
          {n.Status === CrmStatus.REJECTED && <ApprovalActions status={n.Status} recordId={n.Id} endpoint={API} submitOnly onSuccess={changed} />}
          {n.Status === CrmStatus.APPROVED && canEdit && (
            <button type="button" onClick={markIssued} disabled={markingIssued} className={GRID_BTN_BRAND}><CheckCircle2 size={13} /> {markingIssued ? "Marking…" : "Mark issued"}</button>
          )}
          {/* Notes stay editable until issued, with the edit right. */}
          {canEdit && n.Status !== "Issued" && <button type="button" onClick={() => setEditNotes(true)} className={GRID_BTN}><PenSquare size={13} /> Notes</button>}
          <button type="button" className={GRID_BTN} onClick={() => navigate(`/crm/bookings?view=${n.BookingId}`)}><Home size={13} /> Open booking</button>
        </>}
        fields={[
          { label: "Issued by", value: <TypeTag type={n.NocType} /> },
          { label: "Requested", value: fmtDate(n.NocDate) },
          { label: "Approved", value: fmtDate(n.ApprovalDate) },
          { label: "Issued", value: fmtDate(n.IssuedDate) },
          { label: "Agreement", value: n.AgreementNo || "—" },
          { label: bank ? "Lender" : "Dues", value: bank ? (n.BankName || "—") : "None outstanding" },
        ]} />

      <GridPath steps={nocPath(n)} />
      <GridGuidance tone={guidance.tone} title={guidance.title} text={guidance.text} action={guidance.action} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem] items-start">
        <div className="space-y-4 min-w-0">
          <GridRelated icon={FileText} title="Request"
            action={canEdit && n.Status !== "Issued" ? <button type="button" className={cn(GRID_BTN, "h-7")} onClick={() => setEditNotes(true)}><PenSquare size={12} /> Edit notes</button> : undefined}>
            <GridFields fields={[
              { label: "NOC no.", value: <span className="tabular-nums">{n.NocNo}</span> },
              { label: "Issued by", value: <TypeTag type={n.NocType} /> },
              { label: "Requested on", value: <span className="tabular-nums">{fmtDate(n.NocDate)}</span> },
              { label: "Approved on", value: <span className="tabular-nums">{fmtDate(n.ApprovalDate)}</span> },
              { label: "Issued on", value: <span className="tabular-nums">{fmtDate(n.IssuedDate)}</span> },
              { label: "Status", value: <GridStatusPill status={n.Status} label={statusText(n.Status)} /> },
              { label: "Reason", value: n.Reason || "—", wide: true },
              { label: "Notes", value: n.Notes ? <span className="whitespace-pre-line">{n.Notes}</span> : "—", wide: true },
            ]} />
          </GridRelated>

          {bank && (
            <GridRelated icon={Landmark} title="Lender">
              <GridFields fields={[
                { label: "Bank", value: n.BankName || "—" },
                { label: "Loan account no.", value: <span className="tabular-nums">{n.LoanAccountNo || "—"}</span> },
                { label: "Loan amount", value: <span className="tabular-nums">{n.LoanAmount ? fmt(n.LoanAmount) : "—"}</span> },
                { label: "Where it comes from", value: <span className="text-muted-foreground">Loan Tracking keeps the sanction and disbursement.</span> },
              ]} />
            </GridRelated>
          )}

          <GridRelated icon={Home} title="Booking">
            <GridFields fields={[
              { label: "Buyer", value: <ApplicantNames name={n.ApplicantName} bookingId={n.BookingId} applicationId={n.ApplicationId} /> },
              { label: "Mobile", value: <span className="tabular-nums">{n.Mobile || "—"}</span> },
              { label: "Booking", value: <span className="tabular-nums">{n.BookingNo}</span> },
              { label: "Project · unit", value: [n.ProjectName, n.UnitNo].filter(Boolean).join(" · ") || "—" },
              { label: "Agreement for Sale", value: n.AgreementNo ? <span className="tabular-nums">{n.AgreementNo} · {n.AgreementStatus}</span> : "—" },
            ]} />
          </GridRelated>
        </div>

        <aside className="space-y-4 min-w-0 xl:sticky xl:top-4">
          <GridRelated icon={ShieldCheck} title="Approval history">
            <div className="px-4 py-4 text-xs">
              <ApprovalTrailTimeline table="CrmNoc" recordId={n.Id} refreshKey={n.UpdatedAt}
                empty={<span className="text-muted-foreground">{n.Status === CrmStatus.PENDING ? "Waiting for an approver. No level has acted yet." : "No approval steps recorded."}</span>} />
            </div>
          </GridRelated>
          <section className={cn(GRID_CARD, "px-4 py-3 text-xs text-muted-foreground flex gap-2")}>
            <Info size={14} className="shrink-0 mt-0.5 text-primary" />
            <p>{bank
              ? "A bank NOC: the lender confirms it releases its charge on the property, so the buyer can take possession."
              : "A developer NOC: the developer confirms no dues are outstanding on the booking."} Handover waits for it.</p>
          </section>
        </aside>
      </div>

      {editNotes && <EditNotesDialog noc={n} onClose={() => setEditNotes(false)} onSaved={changed} />}
    </div>
  );
};

// ── Page ─────────────────────────────────────────────────────────────────────
const CrmNoc: React.FC = () => {
  const rights = usePageRights("crm-noc");
  const qc = useQueryClient();
  const [sp, setSp] = useSearchParams();
  const deepLinkBookingId = sp.get("bookingId");
  const deepLinkNocType = sp.get("nocType");
  // The open NOC lives in the address (?id=), so a refresh or a shared link lands on it.
  const [idParam, setIdParam] = useUrlParam("id");
  const openId = /^\d+$/.test(idParam) ? Number(idParam) : null;

  const [pageSize, setPageSize] = useState<number>(GRID_PAGE_SIZES[0]);
  const s = useCrmListState({ pageSize, defaultSort: DEFAULT_SORT, defaultStatus: ALL });
  const [extra, setExtraRaw] = useState<ExtraFilters>(NO_EXTRA);
  const setExtra = (x: Partial<ExtraFilters>) => { setExtraRaw((cur) => ({ ...cur, ...x })); s.setPage(1); };
  const filtered = s.hasFilters || extra.type !== "All" || extra.requested.preset !== "any";
  const clearFilters = () => { s.reset(); setExtraRaw(NO_EXTRA); };
  const [selected, setSelected] = useState<Map<string | number, any>>(new Map());
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [bankFieldsLocked, setBankFieldsLocked] = useState(true);

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["crm-noc", s.query, extra],
    queryFn: () => fetchNocList(s.query, extra),
    staleTime: 30_000,
  });
  const result = useSticky(data);
  const rows = result?.rows ?? [];
  const total = result?.total ?? 0;
  const sCounts = result?.statusCounts ?? {};
  const tCounts = result?.typeCounts ?? {};
  const allCount = Object.values(sCounts).reduce((a, b) => a + b, 0);
  const allTypes = Object.values(tCounts).reduce((a, b) => a + b, 0);
  const [prefs, setPrefs] = useGridPrefs(PREFS_KEY, NOC_COLS);

  const { data: eligibleBookings = [], isFetching: bkgFetching } = useQuery({ queryKey: ["crm-noc-eligible"], queryFn: fetchEligibleBookings, enabled: dialogOpen, staleTime: 0 });
  const { data: context, isFetching: contextLoading } = useQuery({
    queryKey: ["crm-noc-context", form.BookingId], queryFn: () => fetchBookingContext(form.BookingId), enabled: !!form.BookingId,
  });
  // The server's gate: the Agreement for Sale must be registered.
  const agreementRegistered = context?.agreement?.Status === CrmStatus.REGISTERED;
  const canRequest = !!form.BookingId && agreementRegistered && !contextLoading && !saving;

  // ?bookingId=X[&nocType=…] opens that booking's NOC, or the Request dialog for it.
  const [deepLinkResolved, setDeepLinkResolved] = useState(false);
  useEffect(() => {
    if (!deepLinkBookingId || deepLinkResolved) return;
    setDeepLinkResolved(true);
    setSp((prev) => { const next = new URLSearchParams(prev); next.delete("bookingId"); next.delete("nocType"); return next; }, { replace: true });
    fetchNocByBooking(deepLinkBookingId, deepLinkNocType).then((existing) => {
      if (existing) setIdParam(String(existing.Id));
      else if (rights.canCreate) { setForm({ ...EMPTY_FORM, BookingId: deepLinkBookingId }); setDialogOpen(true); }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkBookingId]);

  // The type follows the booking's financing (resolved by the server on the eligible list).
  useEffect(() => {
    if (!form.BookingId) return;
    const bk = (eligibleBookings as any[]).find((b: any) => String(b.Id) === form.BookingId);
    if (!bk) return;
    const resolved = bk.NocType || (bk.HasLoan ? "Bank" : "Organisation");
    setForm((f) => (f.NocType === resolved ? f : { ...f, NocType: resolved }));
  }, [form.BookingId, eligibleBookings]);

  // Bank NOC fills its lender details from Loan Tracking.
  useEffect(() => {
    if (form.NocType !== "Bank" || !context) return;
    setForm((f) => ({
      ...f,
      BankName: f.BankName || context.loanDetail?.BankName || "",
      LoanAccountNo: f.LoanAccountNo || context.loanDetail?.LoanAccountNo || "",
      LoanAmount: f.LoanAmount || (context.loanDetail?.LoanAmount != null ? String(context.loanDetail.LoanAmount) : ""),
    }));
    setBankFieldsLocked(true);
  }, [form.NocType, context]);

  const invalidate = useMemo(() => () => ["crm-noc", "crm-noc-record", "crm-noc-eligible", "crm-legal-milestones", "crm-booking-lifecycle", "crm-dashboard", "crm-handover-eligible"]
    .forEach((k) => qc.invalidateQueries({ queryKey: [k] })), [qc]);
  const closeRequest = () => { setDialogOpen(false); setForm({ ...EMPTY_FORM }); };

  const handleCreate = async () => {
    if (!form.BookingId) return void toast.error("Select a booking.");
    if (!agreementRegistered) return void toast.error("The Agreement for Sale must be registered before a NOC can be requested.");
    setSaving(true);
    try {
      const res = await fetchWithAuth(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, BookingId: parseInt(form.BookingId), LoanAmount: form.LoanAmount || null }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Could not request the NOC.");
      toast.success(`NOC ${d.NocNo} requested`);
      const bookingId = form.BookingId;
      closeRequest();
      invalidate();
      // Open what was just requested.
      fetchNocByBooking(bookingId).then((x) => x && setIdParam(String(x.Id)));
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setSaving(false); }
  };

  const runExport = async () => {
    setExporting(true); setExportError(null);
    try { exportGrid(await fetchAllNocs(s.query, extra), gridVisibleCols(NOC_COLS, prefs), `nocs-${s.status.toLowerCase()}`); }
    catch (e) { setExportError((e as Error).message); } finally { setExporting(false); }
  };
  const exportSelected = () => exportGrid([...selected.values()], gridVisibleCols(NOC_COLS, prefs), `nocs-selected-${selected.size}`);
  const copySelected = async () => {
    try { await navigator.clipboard.writeText([...selected.values()].map((n) => n.NocNo).join("\n")); toast.success(`Copied ${selected.size} NOC number${selected.size === 1 ? "" : "s"}`); }
    catch { toast.error("Could not copy. Your browser blocked the clipboard."); }
  };

  const tabs = [ALL, ...STATUSES].map((k) => ({ key: k, label: k === ALL ? "All" : statusText(k), count: result ? (k === ALL ? allCount : sCounts[k] ?? 0) : null }));

  return (
    <>
      <Breadcrumbs items={openId != null ? ["Dashboard", "CRM", "NOC", "Record"] : ["Dashboard", "CRM", "NOC"]} />
      <CrmAppPage icon={ShieldCheck} section="CRM · Legal & Possession" title="No Objection Certificates"
        subtitle={openId != null ? undefined : "One per booking once the agreement is registered: from the bank when it is loan-financed (the lender releases its charge), from the developer otherwise (no dues outstanding)."}
        actions={<>
          {openId != null && <button type="button" onClick={() => setIdParam("")} className={GRID_BTN}><ArrowLeft size={13} /> All NOCs</button>}
          {rights.canCreate && <button type="button" onClick={() => setDialogOpen(true)} className={GRID_BTN_BRAND}><Plus size={13} /> Request NOC</button>}
        </>}>

        {/* The list stays mounted while a record is open, so its tab, search, filters, sort and page survive the round trip. */}
        <div hidden={openId != null} className={cn(GRID_CARD, "overflow-hidden")}>
          <div className="px-4 pt-3 pb-2">
            <h2 className="text-base font-bold leading-tight">{s.status === ALL ? "All NOCs" : statusText(s.status)}</h2>
            <p className="text-xs text-muted-foreground mt-0.5">{gridListMeta(total, NOC_COLS, s.sort, filtered)}</p>
          </div>
          <GridTabs label="Status" tabs={tabs} active={s.status} onChange={s.setStatus} />
          <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-border border-b border-border">
            <GridMetric label="NOCs" value={total.toLocaleString("en-IN")} />
            <GridMetric label="Awaiting approval" value={(sCounts.Pending ?? 0).toLocaleString("en-IN")} />
            <GridMetric label="To be issued" value={(sCounts.Approved ?? 0).toLocaleString("en-IN")} strong />
            <GridMetric label="Issued" value={(sCounts.Issued ?? 0).toLocaleString("en-IN")} />
          </div>

          {selected.size > 0 && (
            <GridBulkBar count={selected.size} onClear={() => setSelected(new Map())}>
              <button type="button" className={GRID_BTN} onClick={exportSelected}><Download size={13} /> Export selected</button>
              <button type="button" className={GRID_BTN} onClick={copySelected}><Copy size={13} /> Copy numbers</button>
            </GridBulkBar>
          )}

          <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-border bg-muted/30">
            <GridSearch value={s.searchInput} onChange={s.setSearchInput} placeholder="Search customer, booking, unit, NOC no." />
            <GridSegment label="Issued by" value={extra.type} onChange={(t) => setExtra({ type: t })} options={[
              { key: "All", label: "All", count: result ? allTypes : null },
              { key: "Bank", label: "Bank", icon: Landmark, count: result ? tCounts.Bank ?? 0 : null },
              { key: "Organisation", label: "Developer", icon: Building2, count: result ? tCounts.Organisation ?? 0 : null },
            ]} />
            <CrmCompanyProjectBlockFilter value={s.cpb} onChange={s.setCpb} />
            <GridDateFilter label="Requested" value={extra.requested} onChange={(v) => setExtra({ requested: v })} />
            {filtered && (
              <button type="button" onClick={clearFilters} className="inline-flex items-center gap-1 h-8 px-2 text-xs text-primary hover:underline">
                <RotateCcw size={12} /> Clear filters
              </button>
            )}
            <div className="ml-auto flex items-center gap-2 flex-wrap">
              {exportError && <span className="text-xs text-destructive">{exportError}</span>}
              <button type="button" className={cn(GRID_BTN, "w-9 px-0")} onClick={() => refetch()} aria-label="Refresh" title="Refresh">
                <RefreshCw size={13} className={isFetching ? "animate-spin" : ""} />
              </button>
              <GridSavedViews storageKey={VIEWS_KEY}
                current={{ status: s.status, search: s.searchInput.trim(), cpb: s.cpb, sort: s.sort, pageSize, extra: { ...extra } }}
                onApply={(v) => {
                  setPageSize(GRID_PAGE_SIZES.includes(v.pageSize as typeof GRID_PAGE_SIZES[number]) ? v.pageSize : GRID_PAGE_SIZES[0]);
                  s.apply(v);
                  const x = (v.extra ?? {}) as Partial<ExtraFilters>;
                  setExtraRaw({ type: x.type === "Bank" || x.type === "Organisation" ? x.type : "All", requested: x.requested?.preset ? x.requested : GRID_ANY_DATE });
                }} />
              <GridColumnChooser cols={NOC_COLS} prefs={prefs} onChange={setPrefs} />
              <button type="button" className={GRID_BTN} onClick={runExport} disabled={exporting || total === 0} title="Export to Excel">
                <Download size={13} /> <span className="hidden md:inline">{exporting ? "Exporting…" : "Export"}</span>
              </button>
            </div>
          </div>

          <CrmGrid cols={NOC_COLS} prefs={prefs} onPrefs={setPrefs} rows={rows} rowKey={(n) => n.Id}
            loading={isLoading} fetching={isFetching} error={error ? (error as Error).message : null} onRetry={() => refetch()}
            sort={s.sort} onSort={s.toggleSort} onRowClick={(n) => setIdParam(String(n.Id))} activeKey={openId}
            selected={selected} onSelect={setSelected}
            empty={filtered ? "No NOC matches these filters." : "No NOC requested yet. Request one once a booking's agreement is registered."}
            page={s.page} pageSize={pageSize} total={total} onPage={s.setPage} onPageSize={(x) => { setPageSize(x); s.setPage(1); }} />
        </div>

        {openId != null && <NocRecord key={openId} id={openId} canEdit={rights.canEdit} onChanged={invalidate} />}
      </CrmAppPage>

      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) closeRequest(); }}>
        <DialogContent className="max-w-md p-5 gap-4">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><ShieldCheck size={16} className="text-primary" /> Request NOC</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground -mt-2">One NOC per booking: from the bank if it is loan-financed, from the developer if self-funded. How the booking is financed decides it.</p>
          <label className="block space-y-1">
            <span className={cn("block font-medium", GRID_LABEL)}>Booking <span className="text-destructive">*</span></span>
            {bkgFetching ? (
              <span className="block text-xs text-muted-foreground py-2">Loading eligible bookings…</span>
            ) : (eligibleBookings as any[]).length === 0 && !form.BookingId ? (
              <span className="flex items-start gap-2 text-xs rounded-md px-3 py-2.5 border border-amber-500/30 bg-amber-500/5">
                <AlertTriangle size={13} className="shrink-0 mt-0.5 text-amber-600" /> No booking can request one: it needs the Agreement for Sale registered and no NOC already on file.
              </span>
            ) : (
              <SearchableSelect value={form.BookingId} onChange={(v) => { setForm((f) => ({ ...f, BookingId: v, BankName: "", LoanAccountNo: "", LoanAmount: "" })); setBankFieldsLocked(true); }}
                placeholder="Select booking" searchPlaceholder="Search booking, customer or unit…"
                options={(eligibleBookings as any[]).map((b: any) => ({ value: String(b.Id), label: [b.BookingNo, b.ApplicantName, b.UnitNo, b.HasLoan ? "home loan" : null].filter(Boolean).join(" · ") }))} />
            )}
          </label>

          {form.BookingId && (
            <div className="rounded-md border border-border bg-muted/30 px-3 py-2.5 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className={GRID_LABEL}>Issued by</span>
                <TypeTag type={form.NocType} />
              </div>
              {contextLoading ? (
                <p className="text-xs text-muted-foreground">Checking the agreement…</p>
              ) : context ? (
                <div className="text-xs space-y-1">
                  <p className="font-semibold"><ApplicantNames name={context.booking.ApplicantName} bookingId={context.booking.Id} applicationId={context.booking.ApplicationId} /><span className="text-muted-foreground font-normal"> · {context.booking.UnitNo}</span></p>
                  {context.agreement ? (
                    <p className={cn("flex items-center gap-1.5", agreementRegistered ? "text-emerald-700 dark:text-emerald-300" : "text-destructive")}>
                      {agreementRegistered ? <CheckSquare size={12} /> : <AlertTriangle size={12} />}
                      <span className="tabular-nums">{context.agreement.AgreementNo}</span> · {context.agreement.Status}{!agreementRegistered && " (must be Registered)"}
                    </p>
                  ) : <p className="flex items-center gap-1.5 text-destructive"><AlertTriangle size={12} /> No agreement on file</p>}
                </div>
              ) : null}
            </div>
          )}

          {form.NocType === "Bank" && form.BookingId && (
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className={cn("flex items-center gap-1 font-medium", GRID_LABEL)}><Landmark size={12} /> Lender (from Loan Tracking)</span>
                <button type="button" onClick={() => setBankFieldsLocked((l) => !l)} className={cn(GRID_BTN, "h-7 px-2")}>
                  {bankFieldsLocked ? <><PenSquare size={11} /> Edit</> : <><Lock size={11} /> Lock</>}
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {([["Bank", "BankName", "text"], ["Loan account no", "LoanAccountNo", "text"], ["Loan amount", "LoanAmount", "number"]] as const).map(([ph, key, type]) => (
                  <input key={key} type={type} placeholder={ph} aria-label={ph} value={form[key]} readOnly={bankFieldsLocked}
                    onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))} className={cn(GRID_INPUT, "text-sm tabular-nums read-only:bg-muted/40")} />
                ))}
              </div>
            </div>
          )}

          <label className="block space-y-1">
            <span className={cn("block font-medium", GRID_LABEL)}>Reason</span>
            <textarea value={form.Reason} onChange={(e) => setForm((f) => ({ ...f, Reason: e.target.value }))} rows={2} placeholder="Purpose (optional)" className={cn(GRID_INPUT, "h-auto py-2 text-sm resize-none")} />
          </label>
          <DialogFooter className="gap-2">
            <button type="button" onClick={closeRequest} className={GRID_BTN}>Cancel</button>
            <button type="button" onClick={handleCreate} disabled={!canRequest || !rights.canCreate} title={!agreementRegistered && form.BookingId ? "The agreement must be registered first" : undefined}
              className={GRID_BTN_BRAND}>{saving ? "Requesting…" : "Request NOC"}</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default CrmNoc;
