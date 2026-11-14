// CRM NOC: one No Objection Certificate per booking, once the Agreement for Sale is registered: from the bank when the
// booking is loan-financed (the lender releases its charge), from the developer otherwise. Requested, approved, then
// issued; Handover waits for it. One list; one page per NOC with its request, lender, approval and booking together,
// and the one next action in the band. The server decides every rule.
import React, { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeft, Building2, CheckCircle2, CheckSquare, Download, ExternalLink, FileText, Home, Landmark, Lock, PenSquare, Plus, RefreshCw, ShieldCheck } from "lucide-react";
import { CrmStatus, POSSESSION_PAGE } from "@/constants/crmStatuses";
import { cn } from "@/lib/utils";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { translateError } from "@/lib/translateError";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { SearchableSelect } from "@/components/SearchableSelect";
import { ApprovalActions } from "@/components/ApprovalActions";
import { ApprovalTrailTimeline } from "@/components/ApprovalStatusChain";
import { ApplicantNames } from "@/components/crm/ApplicantNames";
import { CrmCompanyProjectBlockFilter } from "@/components/crm/CrmCompanyProjectBlockFilter";
import { fmtRupees } from "@/components/crm/FinancialStatusBar";
import {
  CrmGrid, GridDateFilter, GridDialog, GridFacts, GridFormField, GridFormSection, GridRelated, GridSearch, GridSegment, GridTabs, GridToneMark,
  exportGrid, resolveGridDateRange, useGridPrefs, GRID_ANY_DATE, GRID_BTN, GRID_BTN_BRAND, GRID_CARD, GRID_INPUT, GRID_PAGE_SIZES,
  type GridCol, type GridDateRange,
} from "@/components/crm/CrmDataTable";
import { usePageRights } from "@/hooks/usePageRights";
import { useUrlParam } from "@/hooks/useUrlParam";
import { useCrmListState, useSticky, listParams, type CrmListQuery } from "@/hooks/useCrmListState";
import { BAND_DOT, BAND_KEY, BAND_KEY_MAIN, BandNext, CollectionBar, MoneyBand, StepBar, personName, type StepState } from "./payments/parts";
import { fmtShort } from "./payments/config";
import { fmtDate, localDay } from "./salesDeed/config";

const API = "/api/crm/noc";
const KEY = "crm-noc";
const OTHER_KEYS = ["crm-legal-milestones", "crm-booking-lifecycle", "crm-dashboard", "crm-handover-eligible"];
const ALL = "All";
const STATUSES = ["Pending", "Approved", "Issued", "Rejected"] as const;
const STATUS_LABEL: Record<string, string> = { Pending: "Awaiting approval", Approved: "To be issued", Issued: "Issued", Rejected: "Rejected" };
const statusText = (s: string) => STATUS_LABEL[s] || s;
const statusTone = (s: string): "done" | "waiting" | "stopped" => (s === "Issued" ? "done" : s === CrmStatus.REJECTED ? "stopped" : "waiting");
type TypeKey = "All" | "Organisation" | "Bank";
const typeText = (t: string) => (t === "Bank" ? "Bank" : "Developer");
const money = (n: unknown) => (n != null && n !== "" ? fmtRupees(Number(n)) : "—");
const DAY_MS = 86_400_000;

/** Days since it was requested: still open, or what it took to issue. */
const daysOpen = (n: any): number | null => {
  const start = n.NocDate || n.CreatedAt;
  if (!start) return null;
  const end = n.Status === "Issued" && n.IssuedDate ? new Date(n.IssuedDate) : new Date();
  return Math.max(0, Math.floor((end.getTime() - new Date(start).getTime()) / DAY_MS));
};

/** Where a NOC stands, from what is recorded. One rule for the list and the record. */
export function nocSteps(n: any): { label: string; state: StepState }[] {
  const rejected = n.Status === CrmStatus.REJECTED;
  const approved = n.Status === CrmStatus.APPROVED || n.Status === "Issued";
  return [
    { label: "Agreement registered", state: n.AgreementStatus === CrmStatus.REGISTERED ? "done" : n.AgreementStatus === CrmStatus.CANCELLED ? "stopped" : "done" },
    { label: "Requested", state: "done" },
    { label: rejected ? "Rejected" : "Approved", state: rejected ? "stopped" : approved ? "done" : "active" },
    { label: "Issued", state: n.Status === "Issued" ? "done" : n.Status === CrmStatus.APPROVED ? "active" : "off" },
  ];
}
export function nocNext(n: any): { text: string; late?: boolean } {
  if (n.Status === "Issued") return { text: `Issued${n.IssuedDate ? ` on ${fmtDate(n.IssuedDate)}` : ""}: the handover can go ahead once the possession notice is acknowledged` };
  if (n.Status === CrmStatus.APPROVED) return { text: n.NocType === "Bank" ? `Hand the certificate over (${n.BankName || "the lender"} releases its charge), then mark it issued` : "Hand the certificate over, then mark it issued" };
  if (n.Status === CrmStatus.REJECTED) return { text: "Rejected in approval: see why in Approval, then send it again", late: true };
  return { text: "Waiting for an approver (Approval Inbox, or Approval below)" };
}

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
async function send(url: string, method = "GET", body?: unknown): Promise<any> {
  const res = await fetchWithAuth(url, { method, headers: body !== undefined ? { "Content-Type": "application/json" } : undefined, body: body !== undefined ? JSON.stringify(body) : undefined });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d?.error || `The request could not be completed (${res.status}).`);
  return d;
}
const fetchList = async (q: CrmListQuery, x: ExtraFilters) => {
  const d = await send(`${API}?${queryString(q, x)}`);
  return { rows: (d.rows ?? []) as any[], total: Number(d.total ?? 0), counts: (d.statusCounts ?? {}) as Record<string, number>, types: (d.typeCounts ?? {}) as Record<string, number> };
};
// The NOC of one booking, straight from the server (the list is paged). No type unless the link names one.
const fetchNocByBooking = (bookingId: string, nocType?: string | null) => {
  const p = new URLSearchParams({ bookingId });
  if (nocType) p.set("nocType", nocType);
  return send(`${API}/by-booking?${p}`).catch(() => null);
};

const COLS: GridCol<any>[] = [
  { id: "customer", label: "Customer", locked: true, sortKey: "ApplicantName", csv: (n) => personName(n.ApplicantName), cell: (n) => (
    <span className="block py-1.5 min-w-0">
      <span className="block font-semibold text-foreground capitalize truncate" title={n.ApplicantName}>{personName(n.ApplicantName)}</span>
      <span className="block text-xs text-muted-foreground tabular-nums">{n.NocNo} · {n.BookingNo}</span>
    </span>
  ) },
  { id: "unit", label: "Project, unit and issuer", sortKey: "ProjectName", csv: (n) => [n.ProjectName, n.UnitNo].filter(Boolean).join(" / "), cell: (n) => (
    <span className="block py-1.5 min-w-0">
      <span className="block font-medium truncate">{[n.ProjectName, n.UnitNo].filter(Boolean).join(" · ") || "—"}</span>
      <span className="flex items-center gap-1 text-xs text-muted-foreground truncate">
        {n.NocType === "Bank" ? <Landmark size={11} className="shrink-0" /> : <Building2 size={11} className="shrink-0" />}
        {n.NocType === "Bank" ? `Bank${n.BankName ? `: ${n.BankName}` : ""}` : "Developer"}
      </span>
    </span>
  ) },
  { id: "progress", label: "Progress", sortKey: "Status", csv: (n) => statusText(n.Status), cell: (n) => <span className="block min-w-[15rem] py-1.5"><StepBar steps={nocSteps(n)} /></span> },
  { id: "next", label: "Next step", csv: (n) => nocNext(n).text, cell: (n) => {
    const x = nocNext(n);
    return <span className={cn("block whitespace-normal text-[0.8125rem] leading-snug", x.late && "font-semibold text-destructive")}>{x.text}</span>;
  } },
  { id: "days", label: "Days", align: "right", csv: (n) => daysOpen(n), cell: (n) => <span className="tabular-nums" title={n.Status === "Issued" ? "Days it took to issue" : "Days since it was requested"}>{daysOpen(n) ?? "—"}</span> },
  { id: "loan", label: "Loan amount", align: "right", sortKey: "LoanAmount", csv: (n) => (n.NocType === "Bank" ? n.LoanAmount : ""), cell: (n) => <span className="tabular-nums">{n.NocType === "Bank" && n.LoanAmount ? fmtShort(n.LoanAmount) : "—"}</span> },
  // In the export only.
  { id: "nocNo", label: "NOC no.", hiddenByDefault: true, csv: (n) => n.NocNo, cell: () => null },
  { id: "booking", label: "Booking", hiddenByDefault: true, csv: (n) => n.BookingNo, cell: () => null },
  { id: "type", label: "Issued by", hiddenByDefault: true, csv: (n) => typeText(n.NocType), cell: () => null },
  { id: "lender", label: "Lender", hiddenByDefault: true, csv: (n) => (n.NocType === "Bank" ? n.BankName : ""), cell: () => null },
  { id: "loanAc", label: "Loan account", hiddenByDefault: true, csv: (n) => n.LoanAccountNo, cell: () => null },
  { id: "requested", label: "Requested on", hiddenByDefault: true, csv: (n) => fmtDate(n.NocDate), cell: () => null },
  { id: "approved", label: "Approved on", hiddenByDefault: true, csv: (n) => fmtDate(n.ApprovalDate), cell: () => null },
  { id: "issued", label: "Issued on", hiddenByDefault: true, csv: (n) => fmtDate(n.IssuedDate), cell: () => null },
  { id: "agreement", label: "Agreement", hiddenByDefault: true, csv: (n) => n.AgreementNo, cell: () => null },
  { id: "reason", label: "Reason", hiddenByDefault: true, csv: (n) => n.Reason, cell: () => null },
  { id: "notes", label: "Notes", hiddenByDefault: true, csv: (n) => n.Notes, cell: () => null },
];

const EMPTY_FORM = { BookingId: "", NocType: "Organisation" as string, NocDate: "", Reason: "", BankName: "", LoanAccountNo: "", LoanAmount: "" };

// ── One NOC ─────────────────────────────────────────────────────────────────────
function NocRecord({ id, onBack, refreshAll }: { id: number; onBack: () => void; refreshAll: () => void }) {
  const navigate = useNavigate();
  const rights = usePageRights("crm-noc");
  const { data: n, isLoading, isError, error, isFetching, refetch } = useQuery({ queryKey: [KEY, "record", id], queryFn: () => send(`${API}/${id}`), retry: false });
  const [dialog, setDialog] = useState<"notes" | "issue" | null>(null);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  if (isLoading) return <div className="px-4 py-10 text-center text-sm text-muted-foreground">Loading…</div>;
  if (isError || !n) return (
    <div className={cn(GRID_CARD, "px-4 py-10 text-center text-sm")}>
      <p className="text-destructive">{isError ? translateError((error as Error)?.message) : "NOC not found."}</p>
      <button type="button" onClick={onBack} className={cn(GRID_BTN, "mt-3")}>All NOCs</button>
    </div>
  );
  const bank = n.NocType === "Bank";
  const issued = n.Status === "Issued";
  const days = daysOpen(n);
  const next = nocNext(n);
  const changed = () => { refetch(); refreshAll(); };
  const run = async (work: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try { await work(); toast.success(done); setDialog(null); changed(); return true; }
    catch (e: any) { toast.error(translateError(e.message)); return false; }
    finally { setBusy(false); }
  };
  const toApproval = () => document.getElementById("noc-approval")?.scrollIntoView({ block: "start" });
  // The one action that moves it on, when there is one this user may take.
  const action = n.Status === CrmStatus.APPROVED && rights.canEdit ? { label: "Mark Issued", run: () => setDialog("issue") }
    : n.Status === CrmStatus.PENDING || n.Status === CrmStatus.REJECTED ? { label: "Go to Approval", run: toApproval }
    : issued ? { label: `Go to ${POSSESSION_PAGE}`, run: () => navigate("/crm/possession") } : null;
  const sub = `${personName(n.ApplicantName)} · ${n.NocNo}`;

  return (
    <div className="space-y-4">
      <MoneyBand eyebrow={`${typeText(n.NocType)} NOC · ${n.NocNo}`} title={<span className="capitalize">{personName(n.ApplicantName)}</span>}
        status={<span className="inline-flex items-center h-5 px-2 rounded-full border border-white/30 text-[0.6875rem] font-semibold text-white">{statusText(n.Status)}</span>}
        sub={[n.ProjectName, n.UnitNo && `Unit ${n.UnitNo}`, n.BookingNo, n.Mobile].filter(Boolean).join(" · ")}
        actions={<>
          <button type="button" onClick={onBack} className={BAND_KEY}><ArrowLeft size={13} /> All NOCs</button>
          <button type="button" onClick={() => navigate(`/crm/bookings?view=${n.BookingId}`)} className={BAND_KEY}><ExternalLink size={13} /> Open Booking</button>
          <button type="button" onClick={() => refetch()} disabled={isFetching} className={cn(BAND_KEY, "w-9 !px-0")} title="Refresh" aria-label="Refresh"><RefreshCw size={13} className={isFetching ? "animate-spin" : ""} /></button>
        </>}
        lead={days != null ? `${days} day${days === 1 ? "" : "s"}` : "—"} leadNote={issued ? "taken to issue" : `since requested${n.NocDate ? ` on ${fmtDate(n.NocDate)}` : ""}`}
        bar={<StepBar steps={nocSteps(n)} onDark />}
        figures={[
          { label: "Issued by", value: bank ? (n.BankName || "Bank") : "Developer", note: bank ? "The lender releases its charge" : "No-dues confirmation" },
          bank
            ? { label: "Loan amount", value: n.LoanAmount ? fmtShort(n.LoanAmount) : "—", exact: n.LoanAmount ? money(n.LoanAmount) : undefined, note: n.LoanAccountNo ? `Account ${n.LoanAccountNo}` : "Account not recorded" }
            : { label: "Booking", value: n.BookingNo || "—", note: [n.ProjectName, n.UnitNo].filter(Boolean).join(" · ") || "—" },
          { label: "Agreement", value: n.AgreementNo || "—", note: n.AgreementStatus || "Not found", dot: n.AgreementStatus === CrmStatus.REGISTERED ? BAND_DOT.collected : undefined },
          { label: issued ? "Issued on" : "Approved on", value: fmtDate(issued ? n.IssuedDate : n.ApprovalDate), note: issued ? `Approved ${fmtDate(n.ApprovalDate)}` : n.Status === CrmStatus.APPROVED ? "Not issued yet" : "Not approved yet" },
        ]}
        footer={<BandNext text={next.text} finished={issued} action={action} />} />

      <GridRelated icon={FileText} title="Request" action={rights.canEdit && !issued
        ? <button type="button" onClick={() => { setNotes(n.Notes || ""); setDialog("notes"); }} className={cn(GRID_BTN, "h-8")}><PenSquare size={12} /> Edit Notes</button>
        : <GridToneMark text={statusText(n.Status)} tone={statusTone(n.Status)} />}>
        <GridFacts items={[
          { label: "NOC no.", value: n.NocNo },
          { label: "Requested on", value: fmtDate(n.NocDate) },
          { label: "Approved on", value: fmtDate(n.ApprovalDate) },
          { label: "Issued on", value: fmtDate(n.IssuedDate) },
          { label: "Reason", value: n.Reason, wide: true },
          { label: "Notes", value: n.Notes ? <span className="whitespace-pre-line">{n.Notes}</span> : null, wide: true },
        ]} />
      </GridRelated>

      {bank && (
        <GridRelated icon={Landmark} title="Lender">
          {n.BankName || n.LoanAccountNo || n.LoanAmount ? (
            <GridFacts items={[
              { label: "Bank", value: n.BankName },
              { label: "Loan account no.", value: n.LoanAccountNo },
              { label: "Loan amount", value: n.LoanAmount ? money(n.LoanAmount) : null },
            ]} />
          ) : <p className="px-4 pt-3 text-[0.8125rem] text-muted-foreground">No lender details were recorded with this request.</p>}
          <p className="px-4 py-3 text-xs text-muted-foreground">Taken from Loan Tracking when the NOC was requested. Loan Tracking keeps the sanction and the disbursement.</p>
        </GridRelated>
      )}

      <div id="noc-approval" className="scroll-mt-4">
        <GridRelated icon={ShieldCheck} title="Approval" action={<GridToneMark text={statusText(n.Status)} tone={statusTone(n.Status)} />}>
          <div className="px-4 py-3 space-y-3">
            {n.Status === CrmStatus.PENDING && (
              <div className="flex flex-wrap items-center gap-2">
                <ApprovalActions status={n.Status} recordId={n.Id} endpoint={API} module="crm-noc" onSuccess={changed} />
                <span className="text-xs text-muted-foreground">Who approves is set in Approval Setup (CRM NOC).</span>
              </div>
            )}
            {n.Status === CrmStatus.REJECTED && (
              <div className="flex flex-wrap items-center gap-2">
                <ApprovalActions status={n.Status} recordId={n.Id} endpoint={API} submitOnly onSuccess={changed} />
                <span className="text-xs text-muted-foreground">The reason is in the history below. Correct it, then send it again.</span>
              </div>
            )}
            <div className="text-xs">
              <ApprovalTrailTimeline table="CrmNoc" recordId={n.Id} refreshKey={n.UpdatedAt}
                empty={<span className="text-muted-foreground">{n.Status === CrmStatus.PENDING ? "Waiting for an approver. No level has acted yet." : "No approval steps recorded."}</span>} />
            </div>
          </div>
        </GridRelated>
      </div>

      <GridRelated icon={Home} title="Booking and Agreement">
        <GridFacts items={[
          { label: "Buyer", value: <ApplicantNames name={n.ApplicantName} bookingId={n.BookingId} applicationId={n.ApplicationId} /> },
          { label: "Mobile", value: n.Mobile },
          { label: "Booking", value: n.BookingNo },
          { label: "Project and unit", value: [n.ProjectName, n.UnitNo].filter(Boolean).join(" · ") },
          { label: "Agreement for Sale", value: n.AgreementNo ? `${n.AgreementNo} · ${n.AgreementStatus}` : null },
        ]} />
      </GridRelated>

      {dialog === "notes" && (
        <GridDialog onClose={() => setDialog(null)} icon={PenSquare} width="max-w-2xl" title="Edit Notes" description={sub}
          footer={<><button onClick={() => setDialog(null)} className={GRID_BTN}>Cancel</button>
            <button disabled={busy} onClick={() => run(() => send(`${API}/${id}`, "PUT", { Notes: notes.trim() || null }), "Notes saved")} className={GRID_BTN_BRAND}>{busy ? "Saving…" : "Save Notes"}</button></>}>
          <GridFormField label="Notes" hint="Only the notes change here. The lender's details come from Loan Tracking.">
            <textarea value={notes} rows={5} onChange={(e) => setNotes(e.target.value)} className={cn(GRID_INPUT, "h-auto py-2 resize-none")} />
          </GridFormField>
        </GridDialog>
      )}
      {dialog === "issue" && (
        <GridDialog onClose={() => setDialog(null)} icon={CheckCircle2} width="max-w-2xl" title="Mark Issued" description={sub}
          footer={<><button onClick={() => setDialog(null)} className={GRID_BTN}>Cancel</button>
            <button disabled={busy} onClick={async () => {
              if (await run(() => send(`${API}/${id}/mark-issued`, "PUT"), "NOC issued")) {
                toast.info("The handover can be scheduled once the possession notice is acknowledged.", { action: { label: `Go to ${POSSESSION_PAGE}`, onClick: () => navigate("/crm/possession") } });
              }
            }} className={GRID_BTN_BRAND}>{busy ? "Saving…" : "Mark Issued"}</button></>}>
          <p className="text-sm">The certificate has been handed over{bank ? ` and ${n.BankName || "the lender"} releases its charge on the property` : ""}. It is recorded as issued today, and the handover can go ahead.</p>
        </GridDialog>
      )}
    </div>
  );
}

// ── The page ────────────────────────────────────────────────────────────────────
const CrmNoc: React.FC = () => {
  const qc = useQueryClient();
  const rights = usePageRights("crm-noc");
  const [sp, setSp] = useSearchParams();
  const linkedBooking = sp.get("bookingId");
  const linkedType = sp.get("nocType");
  // The open NOC lives in the address (?id=), so a refresh or a shared link lands on it.
  const [idParam, setIdParam] = useUrlParam("id");
  const openId = /^\d+$/.test(idParam) ? Number(idParam) : null;
  const [pageSize, setPageSize] = useState<number>(GRID_PAGE_SIZES[0]);
  const list = useCrmListState({ pageSize, defaultSort: { key: "CreatedAt", dir: "desc" }, defaultStatus: ALL });
  const [extra, setExtraRaw] = useState<ExtraFilters>(NO_EXTRA);
  const setExtra = (x: Partial<ExtraFilters>) => { setExtraRaw((cur) => ({ ...cur, ...x })); list.setPage(1); };
  const filtered = list.hasFilters || extra.type !== "All" || extra.requested.preset !== "any";
  const [prefs, setPrefs] = useGridPrefs("crm-noc-cols-v2", COLS);
  const [exporting, setExporting] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [lenderLocked, setLenderLocked] = useState(true);
  const [linkDone, setLinkDone] = useState(false);

  const { data, isLoading, isError, error, isFetching, refetch } = useQuery({ queryKey: [KEY, "list", list.query, extra], queryFn: () => fetchList(list.query, extra), staleTime: 0, enabled: openId == null });
  const board = useSticky(data);
  const counts = board?.counts ?? {};
  const types = board?.types ?? {};
  const all = Object.values(counts).reduce((n, x) => n + x, 0);
  const allTypes = Object.values(types).reduce((n, x) => n + x, 0);
  const { data: eligible = [], isFetching: eligibleLoading } = useQuery({ queryKey: [KEY, "eligible"], queryFn: () => send(`${API}/eligible-bookings`).catch(() => []), staleTime: 60_000, enabled: rights.canCreate });
  const { data: context, isFetching: contextLoading } = useQuery({
    queryKey: [KEY, "context", form.BookingId], queryFn: () => send(`${API}/booking/${form.BookingId}/context`).catch(() => null), enabled: !!form.BookingId,
  });
  const refreshAll = () => [KEY, ...OTHER_KEYS].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  // The server's gate: the Agreement for Sale must be registered.
  const agreementRegistered = context?.agreement?.Status === CrmStatus.REGISTERED;
  const canRequest = !!form.BookingId && agreementRegistered && !contextLoading && !saving && rights.canCreate;

  // ?bookingId=X[&nocType=…] opens that booking's NOC, or Request NOC for it when it has none and may have one.
  useEffect(() => {
    if (linkDone || !linkedBooking) return;
    setLinkDone(true);
    setSp((prev) => { const p = new URLSearchParams(prev); p.delete("bookingId"); p.delete("nocType"); return p; }, { replace: true });
    fetchNocByBooking(linkedBooking, linkedType).then((row) => {
      if (row?.Id) setIdParam(String(row.Id));
      else if (rights.canCreate) { setForm({ ...EMPTY_FORM, BookingId: linkedBooking }); setRequestOpen(true); }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkedBooking]);

  // The type follows the booking's financing (the server resolves it on the eligible list).
  useEffect(() => {
    if (!form.BookingId) return;
    const bk = (eligible as any[]).find((b) => String(b.Id) === form.BookingId);
    if (!bk) return;
    const resolved = bk.NocType || (bk.HasLoan ? "Bank" : "Organisation");
    setForm((f) => (f.NocType === resolved ? f : { ...f, NocType: resolved }));
  }, [form.BookingId, eligible]);
  // A bank NOC fills its lender from Loan Tracking.
  useEffect(() => {
    if (form.NocType !== "Bank" || !context) return;
    setForm((f) => ({
      ...f,
      BankName: f.BankName || context.loanDetail?.BankName || "",
      LoanAccountNo: f.LoanAccountNo || context.loanDetail?.LoanAccountNo || "",
      LoanAmount: f.LoanAmount || (context.loanDetail?.LoanAmount != null ? String(context.loanDetail.LoanAmount) : ""),
    }));
    setLenderLocked(true);
  }, [form.NocType, context]);

  const closeRequest = () => { setRequestOpen(false); setForm({ ...EMPTY_FORM }); };
  const handleRequest = async () => {
    if (!form.BookingId) return void toast.error("Select a booking.");
    setSaving(true);
    try {
      // Requested today, unless a date was given.
      const d = await send(API, "POST", { ...form, BookingId: parseInt(form.BookingId), NocDate: form.NocDate || localDay(), LoanAmount: form.LoanAmount || null });
      toast.success(`NOC ${d.NocNo} requested`);
      closeRequest();
      refreshAll();
      if (d.id) setIdParam(String(d.id));
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setSaving(false); }
  };
  const handleExport = async () => {
    setExporting(true);
    try {
      const p = queryString(list.query, extra);
      p.delete("page"); p.delete("pageSize");
      exportGrid(await send(`${API}?${p}`), COLS, `nocs-${list.status.toLowerCase()}`);
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setExporting(false); }
  };
  const issuedN = counts.Issued ?? 0, approvedN = counts.Approved ?? 0, pendingN = counts.Pending ?? 0, rejectedN = counts.Rejected ?? 0;
  const setField = (k: keyof typeof EMPTY_FORM, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="space-y-4">
      <Breadcrumbs items={["Dashboard", "CRM", "NOC"]} />
      {openId != null ? <NocRecord key={openId} id={openId} onBack={() => setIdParam("")} refreshAll={refreshAll} /> : (
        <>
          <MoneyBand eyebrow="CRM" title="No Objection Certificates" sub="One per booking once the Agreement for Sale is registered: from the bank when it is loan-financed, from the developer otherwise. Handover waits for it."
            actions={<>
              {rights.canCreate && <button type="button" onClick={() => { setForm({ ...EMPTY_FORM }); setRequestOpen(true); }} className={BAND_KEY_MAIN}><Plus size={13} /> Request NOC</button>}
              <button type="button" onClick={() => refetch()} disabled={isFetching} className={cn(BAND_KEY, "w-9 !px-0")} title="Refresh" aria-label="Refresh"><RefreshCw size={13} className={isFetching ? "animate-spin" : ""} /></button>
            </>}
            lead={`${issuedN} of ${all}`} leadNote="NOCs issued"
            bar={<CollectionBar onDark due={all} collected={issuedN} finance={approvedN} recorded={0} />}
            figures={[
              { label: "Awaiting approval", value: String(pendingN), note: "In the Approval Inbox" },
              { label: "To be issued", dot: BAND_DOT.finance, value: String(approvedN), note: "Approved, certificate not handed over" },
              { label: "Rejected", dot: rejectedN > 0 ? BAND_DOT.overdue : undefined, value: String(rejectedN), note: "To correct and send again", alert: rejectedN > 0 },
              { label: "Ready to request", value: rights.canCreate ? String((eligible as any[]).length) : "—", note: "Agreement registered, no NOC yet" },
            ]} />
          <div className={cn(GRID_CARD, "rounded-xl overflow-hidden")}>
            <GridTabs<string> label="NOC" active={list.status} onChange={list.setStatus}
              tabs={[ALL, ...STATUSES].map((k) => ({ key: k, label: k === ALL ? "All NOCs" : statusText(k), count: board ? (k === ALL ? all : counts[k] ?? 0) : null }))} />
            <div className="px-3 py-2 flex flex-wrap items-center gap-2 border-b border-border">
              <GridSearch value={list.searchInput} onChange={list.setSearchInput} placeholder="Customer, booking, unit or NOC no." />
              <GridSegment label="Issued by" value={extra.type} onChange={(t) => setExtra({ type: t })} options={[
                { key: "All", label: "All", count: board ? allTypes : null },
                { key: "Bank", label: "Bank", icon: Landmark, count: board ? types.Bank ?? 0 : null },
                { key: "Organisation", label: "Developer", icon: Building2, count: board ? types.Organisation ?? 0 : null },
              ]} />
              <CrmCompanyProjectBlockFilter value={list.cpb} onChange={list.setCpb} />
              <GridDateFilter label="Requested" value={extra.requested} onChange={(v) => setExtra({ requested: v })} />
              {filtered && <button type="button" onClick={() => { list.reset(); setExtraRaw(NO_EXTRA); }} className={GRID_BTN}>Clear filters</button>}
              <button type="button" onClick={handleExport} disabled={exporting || !all} className={cn(GRID_BTN, "ml-auto")} title="Export to Excel"><Download size={13} /> <span className="hidden md:inline">{exporting ? "Exporting…" : "Export"}</span></button>
            </div>
            <CrmGrid cols={COLS} prefs={prefs} onPrefs={setPrefs} rows={board?.rows ?? []} rowKey={(n) => n.Id} noRowNumbers
              loading={isLoading} fetching={isFetching} error={isError ? translateError((error as Error)?.message) : null} onRetry={() => refetch()}
              sort={list.sort} onSort={list.toggleSort} onRowClick={(n) => setIdParam(String(n.Id))}
              empty={filtered ? "No NOC matches these filters." : "No NOC yet. Request one once a booking's Agreement for Sale is registered."}
              page={list.page} pageSize={pageSize} total={board?.total ?? 0} onPage={list.setPage} onPageSize={(x) => { setPageSize(x); list.setPage(1); }} />
          </div>
        </>
      )}

      {requestOpen && (
        <GridDialog onClose={closeRequest} icon={ShieldCheck} title="Request NOC" description="One NOC per booking: from the bank when it is loan-financed, from the developer when self-funded. How the booking is financed decides it."
          footer={<><button onClick={closeRequest} className={GRID_BTN}>Cancel</button>
            <button onClick={handleRequest} disabled={!canRequest} title={form.BookingId && !agreementRegistered ? "The Agreement for Sale must be registered first" : undefined} className={GRID_BTN_BRAND}>{saving ? "Requesting…" : "Request NOC"}</button></>}>
          <GridFormSection title="Booking">
            <GridFormField label="Booking" required wide hint={eligibleLoading ? "Loading the bookings that may request one…" : (eligible as any[]).length ? "Only bookings with the Agreement for Sale registered and no NOC on file are listed." : undefined}>
              {!eligibleLoading && !(eligible as any[]).length && !form.BookingId ? (
                <span className="flex items-start gap-2 text-xs rounded-md px-3 py-2.5 border border-amber-500/30 bg-amber-500/5">
                  <AlertTriangle size={13} className="shrink-0 mt-0.5 text-amber-600" /> No booking can request one yet: it needs the Agreement for Sale registered and no NOC already on file.
                </span>
              ) : (
                <SearchableSelect value={form.BookingId} onChange={(v) => { setForm((f) => ({ ...f, BookingId: v, BankName: "", LoanAccountNo: "", LoanAmount: "" })); setLenderLocked(true); }}
                  placeholder="Select booking" searchPlaceholder="Search booking, customer or unit…"
                  options={(eligible as any[]).map((b) => ({ value: String(b.Id), label: [b.BookingNo, personName(b.ApplicantName), b.UnitNo, b.HasLoan ? "home loan" : null].filter(Boolean).join(" · ") }))} />
              )}
            </GridFormField>
            {form.BookingId && (
              <GridFormField label="Issued by" wide>
                <div className="rounded-md border border-border bg-muted/30 px-3 py-2.5 text-xs space-y-1">
                  <p className="flex items-center gap-1.5 font-semibold text-[0.8125rem]">{form.NocType === "Bank" ? <Landmark size={13} /> : <Building2 size={13} />} {typeText(form.NocType)}</p>
                  {contextLoading ? <p className="text-muted-foreground">Checking the agreement…</p>
                    : context?.agreement ? (
                      <p className={cn("flex items-center gap-1.5", agreementRegistered ? "text-emerald-700 dark:text-emerald-300" : "text-destructive")}>
                        {agreementRegistered ? <CheckSquare size={12} /> : <AlertTriangle size={12} />}
                        Agreement <span className="tabular-nums">{context.agreement.AgreementNo}</span> · {context.agreement.Status}{!agreementRegistered && " (must be Registered)"}
                      </p>
                    ) : context ? <p className="flex items-center gap-1.5 text-destructive"><AlertTriangle size={12} /> No agreement on file</p> : null}
                </div>
              </GridFormField>
            )}
          </GridFormSection>
          {form.NocType === "Bank" && form.BookingId && (
            <GridFormSection title="Lender (from Loan Tracking)">
              <GridFormField label="Bank"><input value={form.BankName} readOnly={lenderLocked} onChange={(e) => setField("BankName", e.target.value)} className={cn(GRID_INPUT, "read-only:bg-muted/40")} /></GridFormField>
              <GridFormField label="Loan account no."><input value={form.LoanAccountNo} readOnly={lenderLocked} onChange={(e) => setField("LoanAccountNo", e.target.value)} className={cn(GRID_INPUT, "tabular-nums read-only:bg-muted/40")} /></GridFormField>
              <GridFormField label="Loan amount"><input type="number" min="0" value={form.LoanAmount} readOnly={lenderLocked} onChange={(e) => setField("LoanAmount", e.target.value)} className={cn(GRID_INPUT, "tabular-nums read-only:bg-muted/40")} /></GridFormField>
              <GridFormField label="Lender details" hint="Filled from Loan Tracking. Change them only when the lender's papers differ.">
                <button type="button" onClick={() => setLenderLocked((l) => !l)} className={cn(GRID_BTN, "h-9")}>{lenderLocked ? <><PenSquare size={12} /> Edit Lender</> : <><Lock size={12} /> Lock Lender</>}</button>
              </GridFormField>
            </GridFormSection>
          )}
          <GridFormSection title="Request">
            <GridFormField label="Reason" wide><textarea value={form.Reason} rows={2} placeholder="Purpose (optional)" onChange={(e) => setField("Reason", e.target.value)} className={cn(GRID_INPUT, "h-auto py-2 resize-none")} /></GridFormField>
          </GridFormSection>
        </GridDialog>
      )}
    </div>
  );
};

export default CrmNoc;
