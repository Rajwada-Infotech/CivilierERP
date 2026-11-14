// CRM Agreements: the Agreement for Sale. One list; one page per agreement with its details, legal work and approvals,
// papers, AFS stamp duty payment, AFS registry and history together, the step it is on highlighted and the one next
// action in the band. The server decides every rule.
import React, { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  ArrowLeft, CalendarDays, CheckCircle2, Clock, Download, ExternalLink, FileText, FolderCheck, FolderClock, History, Landmark, Lock, Pencil,
  Plus, ReceiptIndianRupee, RefreshCw, ScrollText, Send, ShieldAlert, Upload, UserCircle2, XCircle,
} from "lucide-react";
import { CrmStatus } from "@/constants/crmStatuses";
import { useSheetAsk } from "@/components/sheet/SheetAsk";
import { translateError } from "@/lib/translateError";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { ApplicantNames } from "@/components/crm/ApplicantNames";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { ApprovalActions } from "@/components/ApprovalActions";
import { ApprovalTrailTimeline } from "@/components/ApprovalStatusChain";
import { FinancialStatusBar, fmtRupees } from "@/components/crm/FinancialStatusBar";
import { ProxyActionDialog, type ProxyMethod } from "@/components/crm/ProxyActionDialog";
import { CrmCompanyProjectBlockFilter } from "@/components/crm/CrmCompanyProjectBlockFilter";
import {
  CrmGrid, GridDateFilter, GridDialog, GridFacts, GridFormField, GridFormSection, GridRelated, GridSearch, GridTabs, GridToneMark,
  exportGrid, resolveGridDateRange, useGridPrefs, GRID_ANY_DATE, GRID_BTN, GRID_BTN_BRAND, GRID_CARD, GRID_INPUT, GRID_PAGE_SIZES, GRID_SHEET_KEYS,
  type GridCol, type GridDateRange,
} from "@/components/crm/CrmDataTable";
import { useCrmListState, useSticky, listParams, type CrmSort } from "@/hooks/useCrmListState";
import { cn } from "@/lib/utils";
import CrmAfsQueryPayment from "@/pages/CRM/CrmAfsQueryPayment";
import CrmAfsRegistry from "@/pages/CRM/CrmAfsRegistry";
import { DateInput } from "@/components/ui/date-input";
import { SearchableSelect } from "@/components/SearchableSelect";
import {
  API, DOC_TYPES, isBookingCancelled, unverifiedMandatoryDocs, followupProgress, type AgrTab, TAB_SLUGS, agreementStepStates,
  rowFollowupProgress, AGREEMENT_STEP_NAMES, agreementAlerts, agreementCurrentIndex, agreementDaysAtStep, type AgreementAlertTone,
} from "./agreement/config";
import { EMPTY_AGR_FORM, fetchUsers, EMPTY_DOC_FORM, EMPTY_DOC_REQUEST_FORM } from "./agreement/forms";
import { DocumentCentre, FilePicker, StepBox, auditToHistory } from "./salesDeed/parts";
import { fetchAgreementsList, fetchAllAgreements, fetchAgreementDetail, fetchAgreementIdByBooking, fetchDateHistory, fetchRevisions, fetchBookings, fetchWelcomeCallsForBooking } from "./agreement/api";
import { BAND_DOT, BAND_KEY, BAND_KEY_MAIN, BandNext, CollectionBar, MoneyBand, StepBar, personName, type StepState } from "./payments/parts";
import { fmtShort } from "./payments/config";
import { fmtDate } from "./salesDeed/config";

const { KEY_INK, KEY_LINE, KEY_RED, LBL, RULE_SOFT } = GRID_SHEET_KEYS;
const ALL = "All";
const AGR_STATUSES = [CrmStatus.DRAFT, CrmStatus.EXECUTED, CrmStatus.REGISTERED, CrmStatus.CANCELLED];
const STATUS_LABEL: Record<string, string> = { Draft: "In preparation", Executed: "Executed, to register", Registered: "Registered", Cancelled: "Cancelled" };
const statusText = (s: string) => STATUS_LABEL[s] || s;
const DEFAULT_SORT: CrmSort = { key: "CreatedAt", dir: "desc" };
const KEY = "crm-agreements";
const PAGE_PAPERS = "crm-documents";
// Each step's work, as a section of the record (config.tsx names which part works each step).
const SECTION_OF: Record<AgrTab, string> = { Timeline: "details", Overview: "details", "Legal & Approval": "legal", Documents: "documents", "AFS Payment": "afsPayment", "AFS Registry": "afsRegistry" };
const SECTION_TITLE: Record<string, string> = { details: "Agreement Details", legal: "Legal Work", documents: "Documents", afsPayment: "Registration Fees", afsRegistry: "Registry" };

const ALERT_INK: Record<AgreementAlertTone, string> = {
  stopped: "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/25",
  waiting: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30",
  moving: "bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/25",
};
const AlertPill: React.FC<{ tone: AgreementAlertTone; label: string }> = ({ tone, label }) => (
  <span className={cn("inline-flex items-center h-5 px-2 rounded-full border text-[0.6875rem] font-medium whitespace-nowrap", ALERT_INK[tone])}>{label}</span>
);

/** The agreement's nine steps as the shared bar, with the one it is on named. */
export function agreementBar(a: any, progress: Parameters<typeof agreementStepStates>[1]): { steps: { label: string; state: StepState }[]; caption: string } {
  const states = agreementStepStates(a, progress);
  const stopped = a?.Status === CrmStatus.CANCELLED || isBookingCancelled(a) || agreementAlerts(a).some((x) => x.tone === "stopped");
  const at = agreementCurrentIndex(a, progress);
  const steps = states.map((s, i) => ({ label: AGREEMENT_STEP_NAMES[i], state: (s.state === "done" ? "done" : i === at ? (stopped ? "stopped" : "active") : "off") as StepState }));
  const caption = a?.Status === CrmStatus.REGISTERED ? "Registered" : a?.Status === CrmStatus.CANCELLED ? "Cancelled"
    : a?.Status === CrmStatus.EXECUTED ? `Step ${states.length} of ${states.length}: executed, to register` : at < 0 ? "Complete" : `Step ${at + 1} of ${states.length}: ${AGREEMENT_STEP_NAMES[at]}`;
  return { steps, caption };
}

const COLS: GridCol<any>[] = [
  { id: "customer", label: "Customer", locked: true, sortKey: "ApplicantName", csv: (a) => personName(a.ApplicantName), cell: (a) => (
    <span className="block py-1.5 min-w-0">
      <span className="block font-semibold text-foreground capitalize truncate" title={a.ApplicantName}>{personName(a.ApplicantName)}</span>
      <span className="block text-xs text-muted-foreground tabular-nums">{a.AgreementNo}{a.VersionNo > 1 ? ` v${a.VersionNo}` : ""} · {a.BookingNo}</span>
    </span>
  ) },
  { id: "unit", label: "Unit and legal executive", sortKey: "LegalExecutiveName", csv: (a) => [a.ProjectName, a.UnitNo].filter(Boolean).join(" / "), cell: (a) => (
    <span className="block py-1.5 min-w-0">
      <span className="block font-medium truncate">{[a.ProjectName, a.UnitNo].filter(Boolean).join(" · ") || "—"}</span>
      <span className={cn("block text-xs truncate", a.LegalExecutiveName ? "text-muted-foreground" : "text-amber-700 dark:text-amber-300 font-medium")}>{a.LegalExecutiveName || "No legal executive"}</span>
    </span>
  ) },
  { id: "progress", label: "Progress", csv: (a) => agreementBar(a, rowFollowupProgress(a)).caption, cell: (a) => { const b = agreementBar(a, rowFollowupProgress(a)); return <span className="block min-w-[15rem] py-1.5"><StepBar steps={b.steps} caption={b.caption} /></span>; } },
  { id: "action", label: "Needs action", csv: (a) => agreementAlerts(a).map((x) => x.label).join("; "), cell: (a) => {
    const al = agreementAlerts(a);
    return al.length ? <span className="flex flex-wrap gap-1 py-1">{al.map((x) => <AlertPill key={x.key} tone={x.tone} label={x.label} />)}</span> : <span className="text-muted-foreground">—</span>;
  } },
  { id: "days", label: "Days at step", align: "right", csv: (a) => agreementDaysAtStep(a, rowFollowupProgress(a)), cell: (a) => <span className="tabular-nums">{agreementDaysAtStep(a, rowFollowupProgress(a)) ?? "—"}</span> },
  { id: "value", label: "Value", sortKey: "GrandTotal", align: "right", csv: (a) => a.GrandTotal, cell: (a) => <span className="tabular-nums">{a.GrandTotal ? fmtShort(a.GrandTotal) : "—"}</span> },
  // In the export only.
  { id: "status", label: "Status", hiddenByDefault: true, csv: (a) => a.Status, cell: () => null },
  { id: "signing", label: "Signing date", hiddenByDefault: true, csv: (a) => fmtDate(a.AgreementDate), cell: () => null },
  { id: "papers", label: "Papers uploaded", hiddenByDefault: true, csv: (a) => `${rowFollowupProgress(a).uploaded}/${rowFollowupProgress(a).required}`, cell: () => null },
  { id: "senior", label: "Senior approval", hiddenByDefault: true, csv: (a) => a.SeniorApprovalStatus, cell: () => null },
  { id: "customerOk", label: "Customer approval", hiddenByDefault: true, csv: (a) => a.CustomerApprovalStatus, cell: () => null },
  { id: "sent", label: "Sent to customer", hiddenByDefault: true, csv: (a) => fmtDate(a.SentToCustomerAt), cell: () => null },
  { id: "regNo", label: "Registration no.", hiddenByDefault: true, csv: (a) => a.AfsRegistrationNo, cell: () => null },
  { id: "regDate", label: "Registered on", hiddenByDefault: true, csv: (a) => fmtDate(a.AfsRegistrationDate), cell: () => null },
];

/** What happened on the agreement, newest first: approvals, sending, the customer's answers, dates, versions, papers. */
const AgreementActivity: React.FC<{ agreement: any; documents: any[]; dateHistory: any[]; revisions: any[] }> = ({ agreement: a, documents, dateHistory, revisions }) => {
  const [all, setAll] = useState(false);
  if (!a) return null;
  const ev: { at: string; title: string; detail?: string; tone?: AgreementAlertTone | "done" }[] = [];
  if (a.CreatedAt) ev.push({ at: a.CreatedAt, title: "Agreement made", detail: a.CreatedByName ? `by ${a.CreatedByName}` : undefined });
  if (a.SeniorApprovedAt) ev.push({ at: a.SeniorApprovedAt, title: `Senior approval: ${a.SeniorApprovalStatus}`, detail: a.SeniorApprovalRemarks || undefined, tone: a.SeniorApprovalStatus === CrmStatus.APPROVED ? "done" : "stopped" });
  if (a.SentToCustomerAt) ev.push({ at: a.SentToCustomerAt, title: "Sent to the customer portal" });
  if (a.CustomerApprovedAt) ev.push({ at: a.CustomerApprovedAt, title: "Customer approved", tone: "done" });
  if (a.CustomerApprovalStatus === "RecheckRequested") ev.push({ at: a.UpdatedAt, title: `Customer asked for a recheck${a.RecheckCount > 1 ? ` (${a.RecheckCount} times)` : ""}`, detail: a.LastRecheckRemarks || undefined, tone: "stopped" });
  for (const h of dateHistory) ev.push({ at: h.CreatedAt, title: `${h.ProposedBy === "Customer" ? "Customer" : "We"} proposed ${fmtDate(h.ProposedDate)}`, detail: [h.Reason, h.CreatedByName && `by ${h.CreatedByName}`].filter(Boolean).join(" · ") || undefined });
  for (const r of revisions) ev.push({ at: r.CreatedAt, title: `Version ${r.VersionNo} superseded`, detail: [r.Reason, r.CreatedByName && `by ${r.CreatedByName}`].filter(Boolean).join(" · ") || undefined });
  for (const d of documents) if (d.UploadedAt) ev.push({ at: d.UploadedAt, title: `${d.Label || d.DocumentType} uploaded`, detail: d.Status ? `now ${d.Status}` : undefined, tone: d.Status === "Verified" ? "done" : d.Status === "Rejected" ? "stopped" : undefined });
  if (a.AfsRegistrationDate) ev.push({ at: a.AfsRegistrationDate, title: "Registered at the Sub-Registrar", detail: a.AfsRegistrationNo ? `Doc no. ${a.AfsRegistrationNo}` : undefined, tone: "done" });
  ev.sort((p, q) => new Date(q.at).getTime() - new Date(p.at).getTime());
  const LIMIT = 10;
  const shown = all ? ev : ev.slice(0, LIMIT);
  const dot = (t?: string) => t === "done" ? "bg-emerald-600" : t === "stopped" ? "bg-rose-600" : t === "waiting" ? "bg-amber-500" : "bg-primary";
  if (!ev.length) return <p className="px-4 py-4 text-xs text-muted-foreground">Nothing recorded yet.</p>;
  return (
    <div className="px-4 py-4">
      <ol className="relative ml-1.5 border-l border-border space-y-3">
        {shown.map((e, k) => (
          <li key={k} className="relative pl-4">
            <span className={cn("absolute -left-[5px] top-1 w-2.5 h-2.5 rounded-full ring-2 ring-card", dot(e.tone))} />
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[0.8125rem] font-semibold">{e.title}</span>
              <span className="text-xs text-muted-foreground tabular-nums shrink-0">{fmtDate(e.at)}</span>
            </div>
            {e.detail && <p className="text-xs text-muted-foreground mt-0.5">{e.detail}</p>}
          </li>
        ))}
      </ol>
      {ev.length > LIMIT && <button type="button" onClick={() => setAll((v) => !v)} className="mt-3 text-xs text-primary hover:underline">{all ? "Show fewer" : `Show all ${ev.length}`}</button>}
    </div>
  );
};

/** Uploads a requested paper for the customer when they sent it another way (phone, email, in person). */
const ProxyUpload: React.FC<{ agreementId: number; doc: any; onDone: () => void }> = ({ agreementId, doc, onDone }) => {
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const submit = async (method: ProxyMethod, remarks: string) => {
    if (!file) return;
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append("file", file); fd.append("ProxyMethod", method); fd.append("ProxyRemarks", remarks);
      const res = await fetchWithAuth(`${API}/${agreementId}/documents/${doc.Id}/proxy-attach`, { method: "POST", body: fd });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Upload failed");
      toast.success("Paper submitted on the customer's behalf");
      setFile(null);
      onDone();
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setSaving(false); }
  };
  return (
    <>
      <FilePicker onFiles={(files) => setFile(files[0])} label="For customer" className={cn(GRID_BTN, "h-7 px-2.5")} />
      {file && (
        <ProxyActionDialog title="Upload on the customer's behalf" description={`${file.name}: record how the customer sent this paper.`}
          confirmLabel="Submit Paper" saving={saving} onClose={() => setFile(null)} onConfirm={submit} />
      )}
    </>
  );
};

const EMPTY_REG = { AfsRegistrationNo: "", AfsRegistrationDate: "", AfsStampDuty: "", AfsRegistrationFee: "" };
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const AADHAAR_RE = /^\d{12}$/;

const CrmAgreement: React.FC = () => {
  const ask = useSheetAsk();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const bkgFilter = sp.get("bookingId") || "";
  const rawId = sp.get("id") ? parseInt(sp.get("id")!, 10) : null;
  const idFilter = rawId !== null && rawId > 0 ? rawId : null;
  const tabParam = sp.get("tab");
  const [selectedId, setSelectedId] = useState<number | null>(idFilter);
  const [pageSize, setPageSize] = useState<number>(GRID_PAGE_SIZES[0]);
  const s = useCrmListState({ pageSize, defaultSort: DEFAULT_SORT, defaultStatus: ALL });
  const [signed, setSignedRaw] = useState<GridDateRange>(GRID_ANY_DATE);
  const setSigned = (v: GridDateRange) => { setSignedRaw(v); s.setPage(1); };
  const listFiltered = s.hasFilters || signed.preset !== "any";
  const [exporting, setExporting] = useState(false);
  const rights = usePageRights("crm-agreements");
  const paperRights = usePageRights(PAGE_PAPERS);
  const afsPayRights = usePageRights("crm-afs-query-payment");
  const afsRegRights = usePageRights("crm-afs-registry");
  const canWork = rights.canEdit;

  const selectAgreement = (id: number) => { setSelectedId(id); setSp((p) => { p.set("id", String(id)); return p; }, { replace: true }); };
  const backToList = () => { setSelectedId(null); setSp((p) => { p.delete("id"); p.delete("tab"); p.delete("bookingId"); return p; }, { replace: true }); };

  // Dialogs.
  const [dialog, setDialog] = useState<null | "new" | "send" | "propose" | "register" | "addDoc" | "requestDoc" | "edit" | "proxyApprove" | "proxyRecheck" | "proxyDate" | "proxyPropose">(null);
  const close = () => setDialog(null);
  const [saving, setSaving] = useState(false);
  const [agrForm, setAgrForm] = useState({ ...EMPTY_AGR_FORM, BookingId: bkgFilter });
  const [sendDate, setSendDate] = useState("");
  const [regForm, setRegForm] = useState({ ...EMPTY_REG });
  const [regFeesLocked, setRegFeesLocked] = useState(false);
  const [docForm, setDocForm] = useState({ ...EMPTY_DOC_FORM });
  const [docRequestForm, setDocRequestForm] = useState({ ...EMPTY_DOC_REQUEST_FORM });
  const [editForm, setEditForm] = useState({ LegalName: "", LegalAddress: "", PanNo: "", AadhaarNo: "", RevisionReason: "", LegalExecutiveId: "" });
  const [proxyProposedDate, setProxyProposedDate] = useState("");
  const [proxySaving, setProxySaving] = useState(false);
  const [selectedLegal, setSelectedLegal] = useState("");
  const [assigningLegal, setAssigningLegal] = useState(false);

  // The list.
  const listQs = useMemo(() => {
    const p = listParams(s.query, ALL);
    const { from, to } = resolveGridDateRange(signed);
    if (from) p.set("dateFrom", from);
    if (to) p.set("dateTo", to);
    return p;
  }, [s.query, signed]);
  const { data: listData, isLoading, isError, error, isFetching, refetch } = useQuery({ queryKey: [KEY, listQs.toString()], queryFn: () => fetchAgreementsList(listQs), staleTime: 0, enabled: selectedId == null });
  const listResult = useSticky(listData);
  const counts: Record<string, number> = listResult?.statusCounts ?? {};
  const allCount = Object.values(counts).reduce((n, x) => n + x, 0);
  const [prefs, setPrefs] = useGridPrefs("crm-agreements-cols-v2", COLS);
  // The band's figures cover every agreement under the search and filters (any status).
  const scopeQs = useMemo(() => { const p = new URLSearchParams(listQs); ["page", "pageSize", "status", "sortKey", "sortDir"].forEach((k) => p.delete(k)); return p; }, [listQs]);
  const { data: scopeRows = [] } = useQuery({ queryKey: [KEY, "scope", scopeQs.toString()], queryFn: () => fetchAllAgreements(scopeQs), staleTime: 60_000, enabled: selectedId == null });

  // One agreement.
  const { data: detail, isError: detailFailed, error: detailError, isFetching: detailFetching, refetch: refetchDetail } = useQuery({
    queryKey: ["crm-agreement-detail", selectedId], queryFn: () => fetchAgreementDetail(selectedId!), enabled: selectedId != null, staleTime: 0, retry: false,
  });
  const { data: bookings = [] } = useQuery({ queryKey: ["crm-agreement-eligible-bookings"], queryFn: fetchBookings, staleTime: 5 * 60_000, enabled: rights.canCreate });
  const { data: users = [] } = useQuery({ queryKey: ["crm-legal-executives"], queryFn: fetchUsers, staleTime: 5 * 60_000 });
  const { data: dateHistory = [] } = useQuery({ queryKey: ["crm-agreement-date-history", selectedId], queryFn: () => fetchDateHistory(selectedId!), enabled: selectedId != null });
  const { data: revisions = [] } = useQuery({ queryKey: ["crm-agreement-revisions", selectedId], queryFn: () => fetchRevisions(selectedId!), enabled: selectedId != null });
  const { data: welcomeCalls = [] } = useQuery({
    queryKey: ["crm-welcome-calls-for-bkg", (detail as any)?.agreement?.BookingId],
    queryFn: () => fetchWelcomeCallsForBooking((detail as any).agreement.BookingId), enabled: (detail as any)?.agreement?.BookingId != null, staleTime: 60_000,
  });
  const preferredAgrDate = (() => { const hit = (welcomeCalls as any[]).find((c: any) => c.PreferredAgreementDate); return hit ? String(hit.PreferredAgreementDate).slice(0, 10) : ""; })();

  const refreshDetail = () => ["crm-agreement-detail", "crm-agreement-date-history", "crm-agreement-revisions"].forEach((k) => qc.invalidateQueries({ queryKey: [k, selectedId] }));
  const refreshAll = () => { refreshDetail(); [KEY, "crm-agreement-eligible-bookings", "crm-legal-milestones", "crm-booking-lifecycle", "crm-dashboard"].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); };

  // ?bookingId opens the booking's agreement, or New Agreement for it.
  const [linkDone, setLinkDone] = useState(false);
  useEffect(() => {
    if (!bkgFilter || idFilter || linkDone) return;
    setLinkDone(true);
    fetchAgreementIdByBooking(bkgFilter).then((agId) => {
      if (agId) selectAgreement(agId);
      else if (rights.canCreate) { setAgrForm((f) => ({ ...f, BookingId: bkgFilter })); setDialog("new"); }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bkgFilter, idFilter]);
  // ?tab= (links from other pages, e.g. tab=Legal & Approval) brings that section into view once the agreement is open.
  useEffect(() => {
    const t = tabParam ? (TAB_SLUGS[tabParam.toLowerCase()] ?? (tabParam as AgrTab)) : null;
    const id = t && SECTION_OF[t];
    if (!(detail as any)?.agreement || !id) return;
    const jump = () => document.getElementById(`agr-${id}`)?.scrollIntoView({ block: "start" });
    jump();
    const again = window.setTimeout(jump, 900);
    return () => window.clearTimeout(again);
  }, [(detail as any)?.agreement?.Id, tabParam]);
  // New Agreement: the legal details come from the booking.
  useEffect(() => {
    if (!agrForm.BookingId || dialog !== "new") return;
    const bkg = (bookings as any[]).find((b) => String(b.Id) === String(agrForm.BookingId));
    if (!bkg) return;
    setAgrForm((f) => ({ ...f, LegalName: f.LegalName || bkg.LegalName || "", PanNo: f.PanNo || bkg.PanNo || "", AadhaarNo: f.AadhaarNo || bkg.AadhaarNo || "", LegalAddress: f.LegalAddress || bkg.LegalAddress || "" }));
  }, [agrForm.BookingId, dialog]);

  const send = async (url: string, method: string, body?: unknown) => {
    const res = await fetchWithAuth(url, body instanceof FormData ? { method, body } : { method, headers: body !== undefined ? { "Content-Type": "application/json" } : undefined, body: body !== undefined ? JSON.stringify(body) : undefined });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d?.error || `The request could not be completed (${res.status}).`);
    return d;
  };
  const run = async (work: () => Promise<any>, done: string | ((d: any) => string), after?: () => void) => {
    setSaving(true);
    try { const d = await work(); toast.success(typeof done === "function" ? done(d) : done); close(); refreshAll(); after?.(); return d; }
    catch (e: any) { toast.error(translateError(e.message)); return null; }
    finally { setSaving(false); }
  };
  const proxy = async (path: string, body: Record<string, unknown>, done: string) => {
    setProxySaving(true);
    try { await send(`${API}/${selectedId}/${path}`, "PUT", body); toast.success(done); close(); refreshAll(); }
    catch (e: any) { toast.error(translateError(e.message)); }
    finally { setProxySaving(false); }
  };

  // ── Actions ──
  const createAgreement = () => {
    if (!agrForm.BookingId) return void toast.error("Select a booking.");
    if (agrForm.PanNo && !PAN_RE.test(agrForm.PanNo.trim())) return void toast.error("Enter a valid PAN, e.g. ABCDE1234F");
    if (agrForm.AadhaarNo && !AADHAAR_RE.test(agrForm.AadhaarNo.trim())) return void toast.error("Aadhaar must be exactly 12 digits");
    run(() => send(API, "POST", { ...agrForm, BookingId: parseInt(agrForm.BookingId) }), (d) => `Agreement ${d.AgreementNo} created`, () => setAgrForm({ ...EMPTY_AGR_FORM, BookingId: "" }))
      .then((d) => { if (d?.id != null) selectAgreement(d.id); });
  };
  const openSend = (a: any) => { setSendDate(a?.ProposedDate ? String(a.ProposedDate).slice(0, 10) : ""); setDialog("send"); };
  const openPropose = (date: string) => { setSendDate(date); setDialog("propose"); };
  const acceptDate = () => run(() => send(`${API}/${selectedId}/date/accept`, "PUT"), "Date accepted: sent for approval of the date");
  const markExecuted = () => run(() => send(`${API}/${selectedId}/mark-executed`, "PUT"), (d) => `Agreement marked ${d.status || "Executed"}`,
    () => toast.info("Executed: the registration fees and Legal Milestones can go ahead.", { action: { label: "Go to Legal Milestones", onClick: () => navigate("/crm/legal-milestones") } }));
  const openRegister = (ag: any) => {
    // The fees come from the confirmed AFS payment when there is one, then its quote, then the agreement's own figures.
    let stamp = "", fee = "";
    if (ag?.AfsQpConfirmedAmount != null) {
      if (ag.AfsQpStampDuty != null && ag.AfsQpRegistrationFee != null) { stamp = String(ag.AfsQpStampDuty); fee = String(ag.AfsQpRegistrationFee); }
      else stamp = String(ag.AfsQpConfirmedAmount);
    } else if (ag?.AfsQpStampDuty != null || ag?.AfsQpRegistrationFee != null) {
      stamp = ag.AfsQpStampDuty != null ? String(ag.AfsQpStampDuty) : ""; fee = ag.AfsQpRegistrationFee != null ? String(ag.AfsQpRegistrationFee) : "";
    } else {
      stamp = ag?.AfsStampDuty != null ? String(ag.AfsStampDuty) : ""; fee = ag?.AfsRegistrationFee != null ? String(ag.AfsRegistrationFee) : "";
    }
    setRegForm({ ...EMPTY_REG, AfsStampDuty: stamp, AfsRegistrationFee: fee });
    setRegFeesLocked(stamp !== "" || fee !== "");
    setDialog("register");
  };
  const markRegistered = () => {
    if (!regForm.AfsRegistrationNo.trim()) return void toast.error("Agreement registration no. is required");
    if (!regForm.AfsRegistrationDate) return void toast.error("Registration date is required");
    run(() => send(`${API}/${selectedId}/mark-registered`, "PUT", {
      AfsRegistrationNo: regForm.AfsRegistrationNo.trim(), AfsRegistrationDate: regForm.AfsRegistrationDate,
      AfsStampDuty: regForm.AfsStampDuty !== "" ? regForm.AfsStampDuty : undefined, AfsRegistrationFee: regForm.AfsRegistrationFee !== "" ? regForm.AfsRegistrationFee : undefined,
    }), "Agreement marked Registered", () => toast.info("Registered: the NOC can be requested now.", { action: { label: "Go to NOC", onClick: () => navigate("/crm/noc") } }));
  };
  const cancelAgreement = async (a: any) => {
    if (await ask.confirm(`Cancel agreement ${a.AgreementNo}?`, { okLabel: "Cancel Agreement", cancelLabel: "Keep It", danger: true })) run(() => send(`${API}/${selectedId}/cancel`, "PUT"), "Agreement cancelled");
  };
  const assignLegal = async (id: string) => {
    setAssigningLegal(true);
    try { await send(`${API}/${selectedId}/assign-legal`, "PUT", { LegalExecutiveId: id || null }); toast.success(id ? "Legal executive assigned" : "Legal executive unassigned"); setSelectedLegal(""); refreshAll(); }
    catch (e: any) { toast.error(translateError(e.message)); }
    finally { setAssigningLegal(false); }
  };
  const openEdit = (a: any) => {
    setEditForm({
      LegalName: a.LegalName || a.ApplicantName || "", LegalAddress: a.LegalAddress || "", PanNo: a.PanNo || a.CustomerPanNo || "",
      AadhaarNo: a.AadhaarNo || a.CustomerAadhaarNo || "", RevisionReason: "", LegalExecutiveId: a.LegalExecutiveId != null ? String(a.LegalExecutiveId) : "",
    });
    setDialog("edit");
  };
  const saveEdit = () => {
    if (editForm.PanNo && !PAN_RE.test(editForm.PanNo.trim())) return void toast.error("Enter a valid PAN, e.g. ABCDE1234F");
    if (editForm.AadhaarNo && !AADHAAR_RE.test(editForm.AadhaarNo.trim())) return void toast.error("Aadhaar must be exactly 12 digits");
    run(() => send(`${API}/${selectedId}`, "PUT", editForm), (d) => (d.versionBumped ? "Details updated: the earlier version is kept in the history" : "Details updated"));
  };
  const uploadDocFiles = (files: File[]) => {
    const fd = new FormData();
    fd.append("DocumentType", docForm.DocumentType);
    if (docForm.IssuedBy) fd.append("IssuedBy", docForm.IssuedBy);
    if (docForm.Remarks) fd.append("Remarks", docForm.Remarks);
    files.forEach((f) => fd.append("files", f));
    run(() => send(`${API}/${selectedId}/documents/upload`, "POST", fd), (d) => `${d.count ?? files.length} file(s) uploaded`, () => setDocForm({ ...EMPTY_DOC_FORM }));
  };
  const addDocLink = () => {
    if (!docForm.DocumentUrl.trim()) return void toast.error("Enter a link, or upload a file instead.");
    run(() => send(`${API}/${selectedId}/documents`, "POST", docForm), "Document added", () => setDocForm({ ...EMPTY_DOC_FORM }));
  };
  const requestDoc = () => run(() => send(`${API}/${selectedId}/documents/request`, "POST", docRequestForm), "Requested: the customer sees it in their portal", () => setDocRequestForm({ ...EMPTY_DOC_REQUEST_FORM }));

  const handleExport = async () => {
    setExporting(true);
    try { exportGrid(await fetchAllAgreements(scopeQs), COLS, `agreements-${s.status.toLowerCase()}`); }
    catch (e: any) { toast.error(translateError(e.message)); }
    finally { setExporting(false); }
  };

  // ── One agreement ──
  const record = () => {
    if (detailFailed && !detail) return (
      <div className={cn(GRID_CARD, "px-4 py-10 text-center text-sm")}>
        <p className="text-destructive">{translateError((detailError as Error)?.message)}</p>
        <button type="button" onClick={backToList} className={cn(GRID_BTN, "mt-3")}>All agreements</button>
      </div>
    );
    if (!detail?.agreement) return <div className="px-4 py-10 text-center text-sm text-muted-foreground">Loading…</div>;
    const a = detail.agreement;
    const documents: any[] = detail.documents || [];
    const papers = followupProgress(documents);
    const pendingDocs = unverifiedMandatoryDocs(documents);
    const bar = agreementBar(a, documents);
    const bookingGone = isBookingCancelled(a);
    const closed = a.Status === CrmStatus.CANCELLED || a.Status === CrmStatus.REGISTERED;
    const locked = bookingGone || a.Status === CrmStatus.CANCELLED;
    const atStep = agreementCurrentIndex(a, documents);
    const focus = closed || atStep < 0 ? null : SECTION_OF[agreementStepStates(a, documents)[atStep].tab];
    const step = (key: string, node: React.ReactNode) => <div id={`agr-${key}`} className={cn("rounded-lg scroll-mt-4", focus === key && "ring-2 ring-primary/50")}>{node}</div>;
    const go = (key: string) => () => document.getElementById(`agr-${key}`)?.scrollIntoView({ block: "start" });
    const seniorStatus = a.SeniorApprovalStatus;
    const senior = seniorStatus === CrmStatus.APPROVED;
    const sent = !!a.SentToCustomerAt;
    const custStatus = a.CustomerApprovalStatus;
    const custApproved = custStatus === CrmStatus.APPROVED;
    const recheck = custStatus === "RecheckRequested";
    const dated = !!a.AgreementDate;
    const executed = a.Status === CrmStatus.EXECUTED || a.Status === CrmStatus.REGISTERED;
    const collected = Number(detail.financialSummary?.cleared || 0);
    const grand = Number(a.GrandTotal || 0) > 0 ? Number(a.GrandTotal) : Number(a.TotalValue || 0) + Number(a.UnitGstAmount || 0) + Number(a.ParkingTotal || 0) + Number(a.ExtraChargesTotal || 0);
    const execBlocked = bookingGone ? "The booking is cancelled: it can't be marked executed"
      : !(senior && custApproved && dated) ? "Needs senior approval, customer approval and an agreed date"
      : a.LegalExecutiveId == null ? "Assign a legal executive first"
      : pendingDocs.length ? `Mandatory papers not verified yet: ${pendingDocs.map((d: any) => d.Label || d.DocumentType).join(", ")}` : null;
    const regBlocked = bookingGone ? "The booking is cancelled: it can't be marked registered"
      : a.AfsRegistryStatus !== "Completed" ? "Complete the Agreement Registry at the Sub-Registrar first" : null;

    // What the agreement waits on now, and the one action that moves it on.
    let next = ""; let action: { label: string; run: () => void } | null = null; let finished = false;
    if (a.Status === CrmStatus.CANCELLED) { next = "Cancelled."; finished = true; }
    else if (bookingGone) {
      next = `The booking is ${a.BookingStatus || "inactive"}: this agreement is locked. Cancel it to close it out.`;
      action = a.Status === CrmStatus.REGISTERED ? null : { label: "Cancel Agreement", run: () => cancelAgreement(a) };
      finished = !action;
    }
    else if (a.Status === CrmStatus.REGISTERED) { next = `Registered at the Sub-Registrar${a.AfsRegistrationDate ? ` on ${fmtDate(a.AfsRegistrationDate)}` : ""}${a.AfsRegistrationNo ? ` (doc no. ${a.AfsRegistrationNo})` : ""}.`; finished = true; }
    else if (a.Status === CrmStatus.EXECUTED) {
      const paid = a.AfsQpConfirmedAmount != null || !!a.AfsRegistryStatus;
      next = !regBlocked ? "Executed and the registry is complete: record the registration"
        : paid ? "Executed: complete the registry, then record the registration" : "Executed: confirm the customer paid the registration fees, then the registry";
      action = !regBlocked ? { label: "Mark Registered", run: () => openRegister(a) } : paid ? { label: "Go to Registry", run: go("afsRegistry") } : { label: "Go to Registration Fees", run: go("afsPayment") };
    } else if (a.LegalExecutiveId == null) { next = "Assign the legal executive who prepares the paperwork"; action = { label: "Go to Legal Work", run: go("legal") }; }
    else if (seniorStatus === CrmStatus.PENDING) next = "Waiting for senior approval (Approval Inbox)";
    else if (!senior) {
      next = seniorStatus === CrmStatus.REJECTED ? `Senior approval rejected${a.SeniorApprovalRemarks ? `: ${a.SeniorApprovalRemarks}` : ""}: correct it and submit again` : "Prepare the papers, then submit for senior approval";
      action = { label: "Go to Legal Work", run: go("legal") };
    } else if (!sent) { next = "Senior-approved: share with the customer"; action = { label: "Send to Customer Portal", run: () => openSend(a) }; }
    else if (recheck) { next = `The customer asked for a recheck${a.LastRecheckRemarks ? `: "${a.LastRecheckRemarks}"` : ""}`; action = { label: "Resend to Customer", run: () => openSend(a) }; }
    else if (!custApproved) next = `Sent to the customer on ${fmtDate(a.SentToCustomerAt)}: waiting for their review`;
    else if (!dated) {
      if (a.DateApprovalStatus === CrmStatus.PENDING) next = "Both sides agreed a date: waiting for its approval";
      else if (a.ProposedDateStatus === CrmStatus.PENDING_CUSTOMER_REVIEW) next = `We proposed ${fmtDate(a.ProposedDate)}: waiting for the customer's answer`;
      else if (a.ProposedDateStatus === "PendingCompanyReview") { next = `The customer proposed ${fmtDate(a.ProposedDate)}: accept it or propose another`; action = { label: "Accept Date", run: acceptDate }; }
      else { next = "The customer approved: propose the signing date"; action = { label: "Propose Signing Date", run: () => openPropose(preferredAgrDate) }; }
    } else if (pendingDocs.length) { next = `${pendingDocs.length} mandatory paper${pendingDocs.length > 1 ? "s" : ""} still to verify: ${pendingDocs.map((d: any) => d.Label || d.DocumentType).join(", ")}`; action = { label: "Go to Documents", run: go("documents") }; }
    else { next = "Every check has passed: mark the agreement executed"; action = { label: "Mark Executed", run: markExecuted }; }
    if (!canWork && action && !action.label.startsWith("Go to")) action = null;
    if (!action && focus && SECTION_TITLE[focus] && !finished) action = { label: `Go to ${SECTION_TITLE[focus]}`, run: go(focus) };

    const approvals = [
      { n: 1, title: "Senior review", text: "An approver (Approval Setup: CRM Agreement) approves the agreement before it is shared with the customer.", done: senior, active: seniorStatus === CrmStatus.PENDING || (!senior && !seniorStatus), stopped: seniorStatus === CrmStatus.REJECTED, mark: seniorStatus || "Not submitted" },
      { n: 2, title: "Shared with the customer", text: "The customer reviews the agreement in their portal and approves it or asks for a recheck.", done: sent && !recheck, active: senior && (!sent || recheck), stopped: false, mark: sent ? "Sent" : "Not sent" },
      { n: 3, title: "Customer review", text: "The customer's answer from the portal, or recorded by staff when they answered another way.", done: custApproved, active: sent && !custApproved && !recheck, stopped: recheck, mark: recheck ? "Recheck requested" : custStatus || "Pending" },
      { n: 4, title: "Signing date", text: "Both sides agree a signing date; an approver confirms it.", done: dated, active: custApproved && !dated, stopped: false, mark: dated ? fmtDate(a.AgreementDate) : a.ProposedDate ? `Proposed ${fmtDate(a.ProposedDate)}` : "Not set" },
      { n: 5, title: "Execution and registration", text: "Every mandatory paper verified, signed and executed, then registered at the Sub-Registrar.", done: a.Status === CrmStatus.REGISTERED, active: dated && a.Status !== CrmStatus.REGISTERED, stopped: false, mark: a.Status === CrmStatus.REGISTERED ? "Registered" : a.Status === CrmStatus.EXECUTED ? "Executed" : "Pending" },
    ];
    const keyBtn = `${KEY_LINE} h-8 px-3`;

    return (
      <div className="space-y-4">
        <MoneyBand eyebrow={`Agreement for Sale · ${a.AgreementNo ?? ""}${a.VersionNo > 1 ? ` · version ${a.VersionNo}` : ""}`} title={<span className="capitalize">{personName(a.ApplicantName)}</span>}
          status={<span className="inline-flex items-center h-5 px-2 rounded-full border border-white/30 text-[0.6875rem] font-semibold text-white">{bookingGone ? "Booking cancelled" : statusText(a.Status)}</span>}
          sub={[a.ProjectName, a.UnitNo && `Unit ${a.UnitNo}`, a.BookingNo].filter(Boolean).join(" · ")}
          actions={<>
            <button type="button" onClick={backToList} className={BAND_KEY}><ArrowLeft size={13} /> All agreements</button>
            <button type="button" onClick={() => navigate(`/crm/bookings?view=${a.BookingId}`)} className={BAND_KEY}><ExternalLink size={13} /> Open Booking</button>
            {canWork && a.Status === CrmStatus.DRAFT && !bookingGone && <button type="button" onClick={() => openEdit(a)} className={BAND_KEY}><Pencil size={13} /> Edit Details</button>}
            {canWork && (a.Status === CrmStatus.DRAFT || a.Status === CrmStatus.EXECUTED) && <button type="button" onClick={() => cancelAgreement(a)} className={cn(BAND_KEY, "!text-rose-300")}><XCircle size={13} /> Cancel Agreement</button>}
            <button type="button" onClick={() => refetchDetail()} disabled={detailFetching} className={cn(BAND_KEY, "w-9 !px-0")} title="Refresh" aria-label="Refresh"><RefreshCw size={13} className={detailFetching ? "animate-spin" : ""} /></button>
          </>}
          lead={grand ? fmtShort(grand) : "—"} leadNote={a.IsPlotSale ? "total value (land)" : "total value (incl. GST)"}
          bar={<StepBar steps={bar.steps} caption={bar.caption} onDark />}
          figures={[
            { label: "Collected", dot: BAND_DOT.collected, value: fmtShort(collected), exact: fmtRupees(collected), note: grand ? `${Math.round((collected / grand) * 100)}% of the value` : "—" },
            { label: "Signing date", value: dated ? fmtDate(a.AgreementDate) : "—", note: dated ? "Agreed and approved" : a.ProposedDate ? `Proposed ${fmtDate(a.ProposedDate)}` : "Not set yet" },
            { label: "Papers", dot: papers.required && papers.uploaded === papers.required ? BAND_DOT.collected : BAND_DOT.finance, value: papers.required ? `${papers.uploaded} of ${papers.required}` : "—", note: papers.required ? "Mandatory uploaded" : "None asked for yet" },
            { label: "Agreement registration", value: a.AfsRegistrationNo || "—", note: a.AfsRegistrationNo ? `Registered ${fmtDate(a.AfsRegistrationDate)}` : `Registry: ${a.AfsRegistryStatus || "not started"}` },
          ]}
          footer={<BandNext text={next} finished={finished} action={action} />} />

        {step("details", (
          <GridRelated icon={ScrollText} title="Agreement Details" action={canWork && a.Status === CrmStatus.DRAFT && !bookingGone ? <button type="button" onClick={() => openEdit(a)} className={cn(GRID_BTN, "h-8")}><Pencil size={12} /> Edit Details</button> : undefined}>
            <GridFacts items={[
              { label: "Booking", value: a.BookingNo },
              { label: "Project and unit", value: [a.ProjectName, a.UnitNo].filter(Boolean).join(" · ") },
              { label: "Legal name", value: a.LegalName || a.ApplicantName },
              { label: "PAN", value: a.PanNo || a.CustomerPanNo },
              { label: "Aadhaar", value: a.AadhaarNo || a.CustomerAadhaarNo },
              { label: "Signing date", value: dated ? fmtDate(a.AgreementDate) : null },
              { label: "Legal address", value: a.LegalAddress, wide: true },
              { label: a.IsPlotSale ? "Total value (land, no GST)" : "Total value (incl. GST)", wide: true, value: grand ? (
                <span><span className="font-semibold tabular-nums">{fmtRupees(grand)}</span>
                  <span className="text-xs text-muted-foreground tabular-nums"> · {a.IsPlotSale ? "Land" : "Unit"} {fmtRupees(a.TotalValue)}{a.UnitGstAmount > 0 ? ` + GST ${fmtRupees(a.UnitGstAmount)}` : ""}{a.ParkingTotal > 0 ? ` + Parking ${fmtRupees(a.ParkingTotal)}` : ""}{a.ExtraChargesTotal > 0 ? ` + Extra ${fmtRupees(a.ExtraChargesTotal)}` : ""}</span></span>
              ) : null },
              { label: "Agreement registration no.", value: a.AfsRegistrationNo },
              { label: "Registered on", value: a.AfsRegistrationDate ? fmtDate(a.AfsRegistrationDate) : null },
              { label: "Stamp duty paid", value: a.AfsStampDuty != null ? fmtRupees(a.AfsStampDuty) : null },
              { label: "Registration fee", value: a.AfsRegistrationFee != null ? fmtRupees(a.AfsRegistrationFee) : null },
            ]} />
            {detail.financialSummary && grand > 0 && (
              <div className="px-4 pb-3"><FinancialStatusBar grandTotal={grand} cleared={collected} pendingReceipts={Number(detail.financialSummary.mrOnAccount || 0)} approvedOnAccount={Number(detail.financialSummary.approvedOnAccount || 0)} compact /></div>
            )}
            {(revisions as any[]).length > 0 && (
              <div className="px-4 py-3 space-y-1.5" style={{ borderTop: RULE_SOFT }}>
                <p className={LBL}>Earlier versions (before version {a.VersionNo})</p>
                {(revisions as any[]).map((r) => (
                  <div key={r.Id} className="text-xs rounded-md border border-border px-2.5 py-2">
                    <span className="font-semibold">Version {r.VersionNo}</span><span className="text-muted-foreground"> · {r.Reason || "No reason given"} · {fmtDate(r.CreatedAt)}{r.CreatedByName ? ` · ${r.CreatedByName}` : ""}</span>
                    <div className="mt-1 text-muted-foreground">{[r.LegalName && `Name: ${r.LegalName}`, r.PanNo && `PAN: ${r.PanNo}`, r.AadhaarNo && `Aadhaar: ${r.AadhaarNo}`, r.AgreementDate && `Date: ${fmtDate(r.AgreementDate)}`].filter(Boolean).join(" · ")}</div>
                  </div>
                ))}
              </div>
            )}
          </GridRelated>
        ))}

        {step("legal", (
          <GridRelated icon={ShieldAlert} title="Legal Work and Approvals">
            <div className="px-4 py-3 space-y-2" style={{ borderBottom: RULE_SOFT }}>
              <div className="flex items-center justify-between gap-2"><span className="text-[0.8125rem] font-semibold">Legal executive</span><GridToneMark text={a.LegalExecutiveId ? "Assigned" : "Unassigned"} tone={a.LegalExecutiveId ? "done" : "waiting"} /></div>
              <p className="text-xs text-muted-foreground">The person who prepares this agreement's paperwork. Needed before execution.</p>
              {a.LegalExecutiveId && !selectedLegal ? (
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-2 flex-1 px-3 h-9 rounded-md" style={{ border: RULE_SOFT }}><UserCircle2 size={14} className="shrink-0" /><span className="text-sm font-medium">{a.LegalExecutiveName}</span><Lock size={11} className="text-muted-foreground ml-auto shrink-0" /></div>
                  {canWork && !closed && !locked && <button onClick={() => setSelectedLegal(String(a.LegalExecutiveId))} className={`${KEY_LINE} h-9 px-3 shrink-0`}>Change</button>}
                </div>
              ) : closed || locked || !canWork ? (
                <div className="font-medium text-sm">{a.LegalExecutiveName || <span className="text-muted-foreground">Unassigned</span>}</div>
              ) : (
                <div className="flex items-center gap-2">
                  <div className="flex-1"><SearchableSelect value={selectedLegal} onChange={setSelectedLegal} placeholder="Select legal executive" searchPlaceholder="Search people…" options={users as any[]} /></div>
                  <button onClick={() => assignLegal(selectedLegal)} disabled={!selectedLegal || assigningLegal || selectedLegal === String(a.LegalExecutiveId ?? "")} className={`${KEY_INK} h-9 px-3`}>{assigningLegal ? "Assigning…" : "Assign"}</button>
                  {a.LegalExecutiveId && <button onClick={() => setSelectedLegal("")} className={`${KEY_LINE} h-9 px-3 shrink-0`}>Cancel</button>}
                </div>
              )}
            </div>
            {approvals.map((x) => (
              <div key={x.n} className="px-4 py-4 flex items-start gap-3" style={{ borderBottom: x.n < 5 ? RULE_SOFT : undefined }}>
                <StepBox n={x.n} done={x.done} active={x.active} stopped={x.stopped} />
                <div className="flex-1 min-w-0 space-y-1.5">
                  <div className="flex items-center justify-between gap-2 flex-wrap"><span className="text-[0.8125rem] font-semibold">{x.title}</span><GridToneMark text={x.mark} tone={x.stopped ? "stopped" : x.done ? "done" : "waiting"} /></div>
                  <p className="text-xs text-muted-foreground">{x.text}</p>

                  {x.n === 1 && senior && a.SeniorApprovedAt && <p className="text-xs flex items-center gap-1 tabular-nums"><CheckCircle2 size={11} /> Approved {fmtDate(a.SeniorApprovedAt)}{a.SeniorApprovalRemarks && <span className="text-muted-foreground ml-1">· {a.SeniorApprovalRemarks}</span>}</p>}
                  {x.n === 1 && seniorStatus === CrmStatus.REJECTED && a.SeniorApprovalRemarks && <p className="text-xs text-destructive rounded-md px-2 py-1.5 border border-destructive/40"><strong>Rejection reason:</strong> {a.SeniorApprovalRemarks}</p>}
                  {x.n === 1 && !locked && !senior && (
                    <div className="flex items-center gap-2 flex-wrap pt-0.5">
                      <ApprovalActions status={seniorStatus} recordId={a.Id} endpoint={API} submitOnly onSuccess={refreshAll} />
                      {seniorStatus === CrmStatus.PENDING && <span className="text-xs text-muted-foreground">Awaiting review in the Approval Inbox</span>}
                    </div>
                  )}

                  {x.n === 2 && sent && <p className="text-xs flex items-center gap-1 tabular-nums"><Send size={11} /> Sent {fmtDate(a.SentToCustomerAt)}</p>}
                  {x.n === 2 && recheck && <p className="text-xs text-destructive rounded-md px-2 py-1.5 border border-destructive/40"><strong>Recheck requested{a.RecheckCount > 1 ? ` (${a.RecheckCount} times)` : ""}:</strong> {a.LastRecheckRemarks || "No remark given"}</p>}
                  {x.n === 2 && senior && (!sent || recheck) && !locked && canWork && <button onClick={() => openSend(a)} className={`${KEY_INK} h-8 px-3`}>{recheck ? "Resend to Customer" : "Send to Customer Portal"}</button>}

                  {x.n === 3 && custApproved && a.CustomerApprovedAt && <p className="text-xs flex items-center gap-1 tabular-nums"><CheckCircle2 size={11} /> Approved by the customer {fmtDate(a.CustomerApprovedAt)}</p>}
                  {x.n === 3 && sent && !custApproved && !recheck && !locked && canWork && (
                    <div className="flex gap-2 flex-wrap pt-0.5">
                      <button onClick={() => setDialog("proxyApprove")} className={keyBtn}><UserCircle2 size={11} /> Record Approval (offline)</button>
                      <button onClick={() => setDialog("proxyRecheck")} className={`${keyBtn} !text-destructive`}><UserCircle2 size={11} /> Record Recheck (offline)</button>
                    </div>
                  )}

                  {x.n === 4 && !dated && custApproved && !locked && (
                    a.DateApprovalStatus === CrmStatus.PENDING ? <p className="text-xs flex items-center gap-1.5"><Clock size={11} /> Date agreed by both sides: waiting for its approval</p>
                    : a.ProposedDateStatus === CrmStatus.PENDING_CUSTOMER_REVIEW ? (
                      <div className="space-y-1.5">
                        <p className="text-xs text-muted-foreground flex items-center gap-1"><Clock size={11} /> Waiting for the customer's answer on {fmtDate(a.ProposedDate)}</p>
                        {canWork && <button onClick={() => setDialog("proxyDate")} className={keyBtn}><UserCircle2 size={11} /> Record Their Acceptance (offline)</button>}
                      </div>
                    ) : a.ProposedDateStatus === "PendingCompanyReview" ? (
                      canWork && <div className="flex items-center gap-2 flex-wrap">
                        <button onClick={acceptDate} disabled={saving} className={`${KEY_INK} h-8 px-3`}>Accept {fmtDate(a.ProposedDate)}</button>
                        <button onClick={() => openPropose(a.ProposedDate ? String(a.ProposedDate).slice(0, 10) : "")} className={keyBtn}>Propose Another Date</button>
                      </div>
                    ) : canWork && (
                      <div className="space-y-2">
                        <button onClick={() => openPropose(preferredAgrDate)} className={`${KEY_INK} h-8 px-3`}><CalendarDays size={12} /> Propose Signing Date</button>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs text-muted-foreground">Customer gave a date another way?</span>
                          <DateInput value={proxyProposedDate} onChange={(e) => setProxyProposedDate(e.target.value)} className={cn(GRID_INPUT, "h-8 w-40")} />
                          <button onClick={() => proxyProposedDate && setDialog("proxyPropose")} disabled={!proxyProposedDate} className={keyBtn}><UserCircle2 size={11} /> Record Their Date</button>
                        </div>
                      </div>
                    )
                  )}
                  {x.n === 4 && (dateHistory as any[]).length > 0 && (
                    <div className="pt-1 space-y-1">
                      <p className={cn(LBL, "flex items-center gap-1")}><FolderClock size={11} /> Date history</p>
                      {(dateHistory as any[]).map((h) => <p key={h.Id} className="text-xs text-muted-foreground tabular-nums">{h.ProposedBy === "Customer" ? "Customer" : "We"} proposed {fmtDate(h.ProposedDate)} · {fmtDate(h.CreatedAt)}{h.CreatedByName ? ` by ${h.CreatedByName}` : ""}</p>)}
                    </div>
                  )}

                  {x.n === 5 && a.Status === CrmStatus.DRAFT && canWork && (
                    <div className="space-y-1">
                      <button onClick={markExecuted} disabled={!!execBlocked || saving} title={execBlocked ?? undefined} className={cn(execBlocked ? keyBtn : `${KEY_INK} h-8 px-3`, "disabled:opacity-60")}><CheckCircle2 size={12} /> Mark Executed</button>
                      {execBlocked && <p className="text-xs text-muted-foreground">{execBlocked}.</p>}
                    </div>
                  )}
                  {x.n === 5 && a.Status === CrmStatus.EXECUTED && canWork && (
                    <div className="space-y-1">
                      <button onClick={() => openRegister(a)} disabled={!!regBlocked} title={regBlocked ?? undefined} className={cn(regBlocked ? keyBtn : `${KEY_INK} h-8 px-3`, "disabled:opacity-60")}><CheckCircle2 size={12} /> Mark Registered</button>
                      {regBlocked && <p className="text-xs text-muted-foreground">{regBlocked}.</p>}
                    </div>
                  )}
                  {x.n === 5 && a.Status === CrmStatus.REGISTERED && a.AfsRegistrationNo && <p className="text-xs flex items-center gap-1 tabular-nums"><CheckCircle2 size={11} /> Registration no. {a.AfsRegistrationNo} · {fmtDate(a.AfsRegistrationDate)}</p>}
                </div>
              </div>
            ))}
          </GridRelated>
        ))}

        {step("documents", (
          <GridRelated icon={FolderCheck} title="Documents" count={documents.length}>
            <div className="p-4">
              <DocumentCentre documents={documents} onChanged={refreshDetail}
                hasFile={(d) => !!d.FilePath || !!d.HasFile} fileUrl={(d) => `${API}/documents/file/${d.Id}`}
                review={(d, verify, remarks) => send(`${API}/${a.Id}/documents/${d.Id}`, "PUT", verify ? { Status: "Verified" } : { Status: CrmStatus.REJECTED, Remarks: remarks })}
                attach={(d, f) => { const fd = new FormData(); fd.append("file", f); return send(`${API}/${a.Id}/documents/${d.Id}/attach`, "POST", fd); }}
                upload={{ withLabel: false, types: DOC_TYPES.map((t) => ({ value: t, label: t.replace(/([a-z])([A-Z])/g, "$1 $2") })),
                  run: (files, type) => { const fd = new FormData(); fd.append("DocumentType", type); files.forEach((f) => fd.append("files", f)); return send(`${API}/${a.Id}/documents/upload`, "POST", fd); } }}
                history={async (d) => { const r = await fetchWithAuth(`${API}/documents/${d.Id}/audit`); return r.ok ? auditToHistory(await r.json()) : []; }}
                canAttach={{ ok: (paperRights.canCreate || canWork) && !locked, reason: locked ? "The agreement is locked: papers can't change." : "Changing papers needs the documents right." }}
                canReview={{ ok: (paperRights.canEdit || canWork) && !locked, reason: locked ? "The agreement is locked: papers can't change." : "Reviewing papers needs the documents right." }}
                nextStep={(d) => {
                  const awaiting = d.Status === "Requested" && !d.FilePath && !d.DocumentUrl;
                  if (awaiting && d.UploadedByType === "Customer") return `Waiting for the customer to upload it${d.RequestedAt ? ` (asked ${fmtDate(d.RequestedAt)})` : ""}.`;
                  if (awaiting) return "Waiting for the legal executive to attach it.";
                  return undefined;
                }}
                extraTag={(d) => d.UploadedByType === "Customer" ? <span className="inline-flex items-center gap-1 h-5 px-2 rounded-full border border-border text-[0.6875rem] text-muted-foreground"><UserCircle2 size={10} /> Customer</span> : null}
                rowActions={(d) => canWork && !locked && d.UploadedByType === "Customer" && d.Status === "Requested" && !d.FilePath ? <ProxyUpload agreementId={a.Id} doc={d} onDone={refreshDetail} /> : null}
                headerActions={(paperRights.canCreate || canWork) && !locked ? <>
                  <button type="button" onClick={() => { setDocRequestForm({ ...EMPTY_DOC_REQUEST_FORM }); setDialog("requestDoc"); }} className={GRID_BTN}><Send size={13} /> Request from Customer</button>
                  <button type="button" onClick={() => { setDocForm({ ...EMPTY_DOC_FORM }); setDialog("addDoc"); }} className={GRID_BTN}><Upload size={13} /> Add with Details</button>
                </> : undefined}
                emptyRequired={<p className="text-xs text-muted-foreground">No mandatory paper asked for yet. Request one from the customer, or add it with its details.</p>} />
            </div>
          </GridRelated>
        ))}

        {afsPayRights.canView && step("afsPayment", (
          <GridRelated icon={ReceiptIndianRupee} title="Agreement Registration Fees">
            <div className="p-4">
              <CrmAfsQueryPayment embeddedBookingId={a.BookingId} agreementStatus={a.Status}
                onChanged={() => { refreshAll(); qc.invalidateQueries({ queryKey: ["crm-afs-query-payment-booking", a.BookingId] }); qc.invalidateQueries({ queryKey: ["crm-afs-registry-booking", a.BookingId] }); }} />
            </div>
          </GridRelated>
        ))}
        {afsRegRights.canView && step("afsRegistry", (
          <GridRelated icon={Landmark} title="Agreement Registry (Sub-Registrar)">
            <div className="p-4">
              <CrmAfsRegistry embeddedBookingId={a.BookingId} onChanged={() => { refreshAll(); qc.invalidateQueries({ queryKey: ["crm-afs-registry-booking", a.BookingId] }); }} />
            </div>
          </GridRelated>
        ))}

        {step("history", (
          <GridRelated icon={History} title="History">
            <AgreementActivity agreement={a} documents={documents} dateHistory={dateHistory as any[]} revisions={revisions as any[]} />
            <div className="px-4 py-3 text-xs" style={{ borderTop: RULE_SOFT }}>
              <p className={cn(LBL, "mb-2")}>Approval trail</p>
              <ApprovalTrailTimeline table="CrmAgreement" recordId={a.Id} refreshKey={a.UpdatedAt} empty={<span className="text-muted-foreground">No approval steps recorded yet.</span>} />
            </div>
          </GridRelated>
        ))}

        <GridRelated icon={FileText} title="Related">
          <div className="px-4 py-3 flex flex-wrap gap-2">
            {[["Payments", `/crm/payments?bookingId=${a.BookingId}`], ["NOC", `/crm/noc?bookingId=${a.BookingId}`], ["Sale Deed", `/crm/sales-deed?bookingId=${a.BookingId}`], ["Legal Milestones", `/crm/legal-milestones?bookingId=${a.BookingId}`]].map(([label, to]) => (
              <button key={label} type="button" onClick={() => navigate(to)} className={cn(GRID_BTN, "h-8")}><ExternalLink size={12} /> {label}</button>
            ))}
          </div>
        </GridRelated>
      </div>
    );
  };

  // ── The list ──
  const drafts = counts[CrmStatus.DRAFT] ?? 0, executedN = counts[CrmStatus.EXECUTED] ?? 0, registered = counts[CrmStatus.REGISTERED] ?? 0;
  const needs = (scopeRows as any[]).filter((r) => agreementAlerts(r).length > 0).length;
  const value = (scopeRows as any[]).filter((r) => r.Status !== CrmStatus.CANCELLED).reduce((t, r) => t + Number(r.GrandTotal || 0), 0);
  const current = detail?.agreement;
  const dsub = current ? `${personName(current.ApplicantName)} · ${current.AgreementNo}` : "";

  return (
    <div className="space-y-4">
      {ask.node}
      <Breadcrumbs items={["Dashboard", "CRM", "Agreements"]} />
      {selectedId != null ? record() : (
        <>
          <MoneyBand eyebrow="CRM" title="Agreements" sub="The Agreement for Sale: legal paperwork, senior and customer approval, the signing date, execution, then the registration fees and the registry."
            actions={<>
              {rights.canCreate && <button type="button" onClick={() => { setAgrForm({ ...EMPTY_AGR_FORM, BookingId: "" }); setDialog("new"); }} className={BAND_KEY_MAIN}><Plus size={13} /> New Agreement</button>}
              <button type="button" onClick={() => refetch()} disabled={isFetching} className={cn(BAND_KEY, "w-9 !px-0")} title="Refresh" aria-label="Refresh"><RefreshCw size={13} className={isFetching ? "animate-spin" : ""} /></button>
            </>}
            lead={`${registered} of ${allCount - (counts[CrmStatus.CANCELLED] ?? 0)}`} leadNote="agreements registered"
            bar={<CollectionBar onDark due={allCount - (counts[CrmStatus.CANCELLED] ?? 0)} collected={registered} finance={executedN} recorded={0} />}
            figures={[
              { label: "In preparation", value: String(drafts), note: "Papers, approvals and the date" },
              { label: "Executed, to register", dot: BAND_DOT.finance, value: String(executedN), note: "With the Sub-Registrar" },
              { label: "Needs action", dot: needs > 0 ? BAND_DOT.overdue : undefined, value: String(needs), note: "Recheck, date, legal executive and more", alert: needs > 0 },
              { label: "Agreement value", value: fmtShort(value), exact: fmtRupees(value), note: "Live agreements" },
            ]} />
          <div className={cn(GRID_CARD, "rounded-xl overflow-hidden")}>
            <GridTabs<string> label="Agreements" active={s.status} onChange={s.setStatus}
              tabs={[ALL, ...AGR_STATUSES].map((k) => ({ key: k, label: k === ALL ? "All agreements" : statusText(k), count: listResult ? (k === ALL ? allCount : counts[k] ?? 0) : null }))} />
            <div className="px-3 py-2 flex flex-wrap items-center gap-2 border-b border-border">
              <GridSearch value={s.searchInput} onChange={s.setSearchInput} placeholder="Customer, agreement or booking" />
              <CrmCompanyProjectBlockFilter value={s.cpb} onChange={s.setCpb} />
              <GridDateFilter label="Signing date" value={signed} onChange={setSigned} />
              {listFiltered && <button type="button" onClick={() => { s.reset(); setSignedRaw(GRID_ANY_DATE); }} className={GRID_BTN}>Clear filters</button>}
              <button type="button" onClick={handleExport} disabled={exporting || !allCount} className={cn(GRID_BTN, "ml-auto")} title="Export to Excel"><Download size={13} /> <span className="hidden md:inline">{exporting ? "Exporting…" : "Export"}</span></button>
            </div>
            <CrmGrid cols={COLS} prefs={prefs} onPrefs={setPrefs} rows={listResult?.rows ?? []} rowKey={(a) => a.Id} noRowNumbers
              loading={isLoading} fetching={isFetching} error={isError ? translateError((error as Error)?.message) : null} onRetry={() => refetch()}
              sort={s.sort} onSort={s.toggleSort} onRowClick={(a) => selectAgreement(a.Id)}
              empty={listFiltered ? "No agreement matches these filters." : "No agreement yet. One is made when a booking has everything it needs."}
              page={s.page} pageSize={pageSize} total={listResult?.total ?? 0} onPage={s.setPage} onPageSize={(n) => { setPageSize(n); s.setPage(1); }} />
          </div>
        </>
      )}

      {dialog === "new" && (
        <GridDialog onClose={close} icon={ScrollText} title="New Agreement" description="The Agreement for Sale for a booking whose welcome call is done and whose bank, PAN and Aadhaar details are on file."
          footer={<><button onClick={close} className={GRID_BTN}>Cancel</button><button onClick={createAgreement} disabled={saving || !agrForm.BookingId} className={GRID_BTN_BRAND}>{saving ? "Creating…" : "Create Agreement"}</button></>}>
          <GridFormSection title="Booking">
            <GridFormField label="Booking" required wide hint={(bookings as any[]).length ? undefined : "No booking is eligible yet: it needs to be approved, its welcome call done, and the customer's bank, PAN and Aadhaar on file."}>
              <SearchableSelect value={agrForm.BookingId} onChange={(v) => setAgrForm((f) => ({ ...f, BookingId: v, LegalName: "", PanNo: "", AadhaarNo: "", LegalAddress: "" }))}
                placeholder="Select booking" searchPlaceholder="Search booking or customer…" options={(bookings as any[]).map((b) => ({ value: String(b.Id), label: `${b.BookingNo} · ${personName(b.ApplicantName)}` }))} />
            </GridFormField>
            <GridFormField label="Legal executive" wide hint="The person who prepares the paperwork.">
              <SearchableSelect value={agrForm.LegalExecutiveId} onChange={(v) => setAgrForm((f) => ({ ...f, LegalExecutiveId: v }))} placeholder="Unassigned" searchPlaceholder="Search people…" options={users as any[]} />
            </GridFormField>
          </GridFormSection>
          <GridFormSection title="Legal details">
            <GridFormField label="Legal name"><input value={agrForm.LegalName} onChange={(e) => setAgrForm((f) => ({ ...f, LegalName: e.target.value }))} className={GRID_INPUT} /></GridFormField>
            <GridFormField label="PAN"><input value={agrForm.PanNo} onChange={(e) => setAgrForm((f) => ({ ...f, PanNo: e.target.value.toUpperCase() }))} className={cn(GRID_INPUT, "tabular-nums")} /></GridFormField>
            <GridFormField label="Aadhaar"><input value={agrForm.AadhaarNo} onChange={(e) => setAgrForm((f) => ({ ...f, AadhaarNo: e.target.value }))} className={cn(GRID_INPUT, "tabular-nums")} /></GridFormField>
            <GridFormField label="Legal address" wide><textarea rows={2} value={agrForm.LegalAddress} onChange={(e) => setAgrForm((f) => ({ ...f, LegalAddress: e.target.value }))} className={cn(GRID_INPUT, "h-auto py-2 resize-none")} /></GridFormField>
            <GridFormField label="Notes" wide><textarea rows={2} value={agrForm.Notes} onChange={(e) => setAgrForm((f) => ({ ...f, Notes: e.target.value }))} className={cn(GRID_INPUT, "h-auto py-2 resize-none")} /></GridFormField>
          </GridFormSection>
        </GridDialog>
      )}

      {dialog === "edit" && (
        <GridDialog onClose={close} icon={Pencil} title="Edit Agreement Details" description={dsub}
          footer={<><button onClick={close} className={GRID_BTN}>Cancel</button><button onClick={saveEdit} disabled={saving} className={GRID_BTN_BRAND}>{saving ? "Saving…" : "Save Details"}</button></>}>
          <GridFormSection title="Legal details">
            <GridFormField label="Legal executive" wide><SearchableSelect value={editForm.LegalExecutiveId} onChange={(v) => setEditForm((f) => ({ ...f, LegalExecutiveId: v }))} placeholder="Unassigned" searchPlaceholder="Search people…" options={users as any[]} /></GridFormField>
            <GridFormField label="Legal name"><input value={editForm.LegalName} onChange={(e) => setEditForm((f) => ({ ...f, LegalName: e.target.value }))} className={GRID_INPUT} /></GridFormField>
            <GridFormField label="PAN"><input value={editForm.PanNo} onChange={(e) => setEditForm((f) => ({ ...f, PanNo: e.target.value.toUpperCase() }))} className={cn(GRID_INPUT, "tabular-nums")} /></GridFormField>
            <GridFormField label="Aadhaar"><input value={editForm.AadhaarNo} onChange={(e) => setEditForm((f) => ({ ...f, AadhaarNo: e.target.value }))} className={cn(GRID_INPUT, "tabular-nums")} /></GridFormField>
            <GridFormField label="Legal address" wide><textarea rows={2} value={editForm.LegalAddress} onChange={(e) => setEditForm((f) => ({ ...f, LegalAddress: e.target.value }))} className={cn(GRID_INPUT, "h-auto py-2 resize-none")} /></GridFormField>
            <GridFormField label="Reason for this change" wide hint="Kept with the earlier version in the history."><input value={editForm.RevisionReason} placeholder="e.g. Customer asked to correct the spelling" onChange={(e) => setEditForm((f) => ({ ...f, RevisionReason: e.target.value }))} className={GRID_INPUT} /></GridFormField>
          </GridFormSection>
        </GridDialog>
      )}

      {(dialog === "send" || dialog === "propose") && (
        <GridDialog onClose={close} icon={dialog === "send" ? Send : CalendarDays} width="max-w-2xl" title={dialog === "send" ? (current?.CustomerApprovalStatus === "RecheckRequested" ? "Resend to Customer" : "Send to Customer Portal") : "Propose Signing Date"} description={dsub}
          footer={<><button onClick={close} className={GRID_BTN}>Cancel</button>
            <button disabled={saving || (dialog === "propose" && !sendDate)} onClick={() => dialog === "send"
              ? run(() => send(`${API}/${selectedId}/send-to-customer`, "PUT", { proposedDate: sendDate || null }), "Sent to the customer portal")
              : run(() => send(`${API}/${selectedId}/propose-date`, "PUT", { proposedDate: sendDate }), "Proposed date sent to the customer")} className={GRID_BTN_BRAND}>
              {saving ? "Saving…" : dialog === "send" ? "Send" : "Propose Date"}</button></>}>
          <p className="text-sm text-muted-foreground">{dialog === "send" ? "The customer reviews the agreement and its papers in their portal, and approves it or asks for a recheck." : "This date goes to the customer to review. They can accept it, or propose another back."}</p>
          <GridFormField label={dialog === "send" ? "Proposed signing date (optional)" : "Proposed signing date"} required={dialog === "propose"}
            hint={dialog === "send" ? "If the customer proposes the same date, it becomes the signing date." : preferredAgrDate && sendDate === preferredAgrDate ? "Filled from the welcome call." : undefined}>
            <DateInput value={sendDate} onChange={(e) => setSendDate(e.target.value)} className={GRID_INPUT} />
          </GridFormField>
        </GridDialog>
      )}

      {dialog === "register" && (
        <GridDialog onClose={close} icon={Landmark} width="max-w-2xl" title="Mark Agreement Registered" description={`${dsub} · the details from the Sub-Registrar's office`}
          footer={<><button onClick={close} className={GRID_BTN}>Cancel</button><button onClick={markRegistered} disabled={saving || !regForm.AfsRegistrationNo.trim() || !regForm.AfsRegistrationDate} className={GRID_BTN_BRAND}>{saving ? "Saving…" : "Confirm Registration"}</button></>}>
          <GridFormSection title="Registration">
            <GridFormField label="Agreement registration no." required hint="The document no. the Sub-Registrar issued."><input value={regForm.AfsRegistrationNo} placeholder="e.g. SRO/WB/2026/001234" onChange={(e) => setRegForm((f) => ({ ...f, AfsRegistrationNo: e.target.value }))} className={cn(GRID_INPUT, "tabular-nums")} /></GridFormField>
            <GridFormField label="Registration date" required><DateInput value={regForm.AfsRegistrationDate} onChange={(e) => setRegForm((f) => ({ ...f, AfsRegistrationDate: e.target.value }))} className={GRID_INPUT} /></GridFormField>
          </GridFormSection>
          <GridFormSection title="Government fees">
            <GridFormField label="Stamp duty (₹)"><input type="number" value={regForm.AfsStampDuty} readOnly={regFeesLocked} onChange={(e) => setRegForm((f) => ({ ...f, AfsStampDuty: e.target.value }))} className={cn(GRID_INPUT, "tabular-nums read-only:bg-muted/40")} /></GridFormField>
            <GridFormField label="Registration fee (₹)"><input type="number" value={regForm.AfsRegistrationFee} readOnly={regFeesLocked} onChange={(e) => setRegForm((f) => ({ ...f, AfsRegistrationFee: e.target.value }))} className={cn(GRID_INPUT, "tabular-nums read-only:bg-muted/40")} /></GridFormField>
            <GridFormField label="Amounts" wide hint={regFeesLocked ? "Filled from the confirmed registration fees: check them against the Sub-Registrar's receipt." : "The stamp duty paid here is credited against the Sale Deed's stamp duty."}>
              <button type="button" onClick={() => setRegFeesLocked((l) => !l)} className={cn(GRID_BTN, "h-9")}>{regFeesLocked ? <><Pencil size={12} /> Edit Amounts</> : <><Lock size={12} /> Lock Amounts</>}</button>
            </GridFormField>
          </GridFormSection>
        </GridDialog>
      )}

      {dialog === "addDoc" && (
        <GridDialog onClose={close} icon={Upload} width="max-w-2xl" title="Add Document" description={dsub}
          footer={<button onClick={close} className={GRID_BTN}>Close</button>}>
          <GridFormSection>
            <GridFormField label="Document type" required>
              <select value={docForm.DocumentType} onChange={(e) => setDocForm((f) => ({ ...f, DocumentType: e.target.value }))} className={GRID_INPUT}>{DOC_TYPES.map((t) => <option key={t} value={t}>{t.replace(/([a-z])([A-Z])/g, "$1 $2")}</option>)}</select>
            </GridFormField>
            <GridFormField label="Issued by"><input value={docForm.IssuedBy} placeholder="e.g. Legal team, bank, Registrar's office" onChange={(e) => setDocForm((f) => ({ ...f, IssuedBy: e.target.value }))} className={GRID_INPUT} /></GridFormField>
            <GridFormField label="Remarks" wide><textarea rows={2} value={docForm.Remarks} onChange={(e) => setDocForm((f) => ({ ...f, Remarks: e.target.value }))} className={cn(GRID_INPUT, "h-auto py-2 resize-none")} /></GridFormField>
            <GridFormField label="File" wide hint="PDF, images, Word or Excel: up to 10 files, 25 MB each.">
              <FilePicker multiple onFiles={uploadDocFiles} busy={saving} label="Upload File(s)" className={cn(GRID_BTN, "h-9")} />
            </GridFormField>
            <GridFormField label="Or a link" wide>
              <span className="flex gap-2"><input value={docForm.DocumentUrl} placeholder="https://…" onChange={(e) => setDocForm((f) => ({ ...f, DocumentUrl: e.target.value }))} className={GRID_INPUT} />
                <button type="button" onClick={addDocLink} disabled={saving || !docForm.DocumentUrl.trim()} className={cn(GRID_BTN, "h-9 shrink-0")}>Add Link</button></span>
            </GridFormField>
          </GridFormSection>
        </GridDialog>
      )}

      {dialog === "requestDoc" && (
        <GridDialog onClose={close} icon={Send} width="max-w-2xl" title="Request Document from Customer" description={dsub}
          footer={<><button onClick={close} className={GRID_BTN}>Cancel</button><button onClick={requestDoc} disabled={saving} className={GRID_BTN_BRAND}>{saving ? "Requesting…" : "Request"}</button></>}>
          <GridFormSection>
            <GridFormField label="Document type" required>
              <select value={docRequestForm.DocumentType} onChange={(e) => setDocRequestForm((f) => ({ ...f, DocumentType: e.target.value }))} className={GRID_INPUT}>{DOC_TYPES.map((t) => <option key={t} value={t}>{t.replace(/([a-z])([A-Z])/g, "$1 $2")}</option>)}</select>
            </GridFormField>
            <GridFormField label="Label the customer sees"><input value={docRequestForm.Label} placeholder="e.g. Latest bank statement" onChange={(e) => setDocRequestForm((f) => ({ ...f, Label: e.target.value }))} className={GRID_INPUT} /></GridFormField>
            <GridFormField label="Required" wide>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={docRequestForm.IsMandatory} onChange={(e) => setDocRequestForm((f) => ({ ...f, IsMandatory: e.target.checked }))} /> Needed before the customer can approve the agreement</label>
            </GridFormField>
          </GridFormSection>
        </GridDialog>
      )}

      {dialog === "proxyApprove" && <ProxyActionDialog title="Record Customer Approval" description="The customer reviewed and approved the agreement without using the portal." confirmLabel="Record Approval" saving={proxySaving} onClose={close}
        onConfirm={(m, r) => proxy("proxy-customer-approve", { ProxyMethod: m, ProxyRemarks: r }, "Customer approval recorded")} />}
      {dialog === "proxyRecheck" && <ProxyActionDialog title="Record Customer Recheck" description="The customer flagged an issue or asked for changes without using the portal." confirmLabel="Record Recheck" saving={proxySaving} onClose={close}
        onConfirm={(m, r) => proxy("proxy-customer-recheck", { ProxyMethod: m, ProxyRemarks: r }, "Customer recheck recorded")} />}
      {dialog === "proxyPropose" && <ProxyActionDialog title="Record Customer's Proposed Date" description={`The customer proposed ${fmtDate(proxyProposedDate)} as the signing date without using the portal.`} confirmLabel="Record Date" saving={proxySaving} onClose={close}
        onConfirm={(m, r) => proxy("proxy-propose-date", { ProxyMethod: m, ProxyRemarks: r, ProposedDate: proxyProposedDate }, "Customer's proposed date recorded").then(() => setProxyProposedDate(""))} />}
      {dialog === "proxyDate" && <ProxyActionDialog title="Record Customer's Date Acceptance" description="The customer agreed to the proposed signing date without using the portal." confirmLabel="Record Acceptance" saving={proxySaving} onClose={close}
        onConfirm={(m, r) => proxy("proxy-date-accept", { ProxyMethod: m, ProxyRemarks: r }, "Customer's acceptance recorded")} />}
    </div>
  );
};

export default CrmAgreement;
