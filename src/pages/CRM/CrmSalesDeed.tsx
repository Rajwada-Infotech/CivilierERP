// CRM Sale Deeds: the conveyance deed that transfers legal ownership (s.54 TPA 1882). One list; one page per deed with
// its details, legal work and approvals, documents, stamp duty payment, registry and history together, the step it is
// on highlighted and the one next action in the band. The server decides every rule.
import React, { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  ArrowLeft, ArrowRight, CheckCircle2, Download, ExternalLink, FolderCheck, History, Lock, Pencil, Plus,
  RefreshCw, ScrollText, Send, ShieldAlert, UserCircle2, X, XCircle,
} from "lucide-react";
import { CrmStatus } from "@/constants/crmStatuses";
import { usePageRights } from "@/hooks/usePageRights";
import { useCanApprove } from "@/hooks/useCanApprove";
import { useAuth } from "@/contexts/AuthContext";
import { translateError } from "@/lib/translateError";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { cn } from "@/lib/utils";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { ApplicantNames } from "@/components/crm/ApplicantNames";
import { ProxyActionDialog, type ProxyMethod } from "@/components/crm/ProxyActionDialog";
import { ApprovalActions } from "@/components/ApprovalActions";
import { CrmCompanyProjectBlockFilter } from "@/components/crm/CrmCompanyProjectBlockFilter";
import { fmtRupees } from "@/components/crm/FinancialStatusBar";
import { DateInput } from "@/components/ui/date-input";
import { SearchableSelect } from "@/components/SearchableSelect";
import {
  CrmGrid, GridDateFilter, GridDialog, GridFormField, GridFormSection, GridRelated, GridSearch, GridTabs, GridToneMark,
  exportGrid, resolveGridDateRange, useGridPrefs, GRID_ANY_DATE, GRID_BTN, GRID_BTN_BRAND, GRID_CARD, GRID_INPUT, GRID_PAGE_SIZES, GRID_SHEET_KEYS,
  type GridCol, type GridDateRange,
} from "@/components/crm/CrmDataTable";
import { useCrmListState, useSticky, listParams, type CrmSort } from "@/hooks/useCrmListState";
import { BAND_DOT, BAND_KEY, BAND_KEY_MAIN, BandNext, CollectionBar, MoneyBand, StepBar, personName, type StepState } from "./payments/parts";
import { fmtShort } from "./payments/config";
import {
  API, EMPTY_FORM, LOG_ACTION_LABEL, STATUSES, DEED_ALERTS, DEED_STEP_NAMES,
  deedTone, fmtDate, deedDocumentProgress, deedStepStates, fetchBookingContext, fetchDeedsList, fetchAllDeeds,
  fetchEligible, fetchLegalExecutives, rowDeedProgress, deedAlerts, type DeedAlertTone, type DeedTab,
} from "./salesDeed/config";
import { DeedDetailsSection, DocumentCentre, StepBox, auditToHistory } from "./salesDeed/parts";
import { QueryPaymentTab, useDeedQueryPayment } from "./salesDeed/QueryPaymentTab";
import { RegistryTab, useDeedRegistry } from "./salesDeed/RegistryTab";

const { INP, KEY_INK, KEY_LINE, LBL, RULE_SOFT } = GRID_SHEET_KEYS;
const ALL = "All";
const DEFAULT_SORT: CrmSort = { key: "CreatedAt", dir: "desc" };
const KEY = "crm-sales-deed";
const OTHER_KEYS = ["crm-sales-deed-eligible", "crm-sales-deed-context", "crm-booking-lifecycle", "crm-legal-milestones", "crm-dashboard"];
// Each step's work, as a section of the record (the server names the steps; config.tsx says which part works each).
const SECTION_OF: Record<DeedTab, string> = { Timeline: "details", Overview: "details", "Legal & Approval": "legal", Documents: "documents", "Query Payment": "stampDuty", Registry: "registry", History: "history" };
const ALERT_INK: Record<DeedAlertTone, string> = {
  stopped: "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/25",
  waiting: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30",
  moving: "bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/25",
};
const AlertPill: React.FC<{ tone: DeedAlertTone; label: string }> = ({ tone, label }) => (
  <span className={cn("inline-flex items-center h-5 px-2 rounded-full border text-[0.6875rem] font-medium whitespace-nowrap", ALERT_INK[tone])}>{label}</span>
);
const NEW_DEED_FIELDS: [string, keyof typeof EMPTY_FORM, "number" | "date"][] = [
  ["Deed value", "DeedValue", "number"], ["Stamp duty", "StampDuty", "number"], ["Registration fee", "RegistrationFee", "number"],
  ["AFS stamp duty credit", "StampDutyCredit", "number"], ["Deed date", "DeedDate", "date"], ["Registration deadline (RERA)", "RegistrationDeadline", "date"],
];

/** The deed's nine steps as the shared bar, with the one it is on named. */
export function deedBar(d: any): { steps: { label: string; state: StepState }[]; caption: string } {
  const states = deedStepStates(d);
  const stopped = d.Status === CrmStatus.CANCELLED || d.BookingStatus === "Cancelled" || deedAlerts(d).some((a) => a.tone === "stopped");
  const steps = states.map((s) => ({ label: s.label, state: (s.state === "done" ? "done" : s.state === "current" ? (stopped ? "stopped" : "active") : "off") as StepState }));
  const at = states.findIndex((s) => s.state === "current");
  const caption = d.Status === CrmStatus.REGISTERED ? "Registered" : d.Status === CrmStatus.CANCELLED ? "Cancelled" : at < 0 ? "Complete" : `Step ${at + 1} of ${states.length}: ${DEED_STEP_NAMES[at]}`;
  return { steps, caption };
}

const COLS: GridCol<any>[] = [
  { id: "customer", label: "Customer", locked: true, sortKey: "ApplicantName", csv: (d) => personName(d.ApplicantName), cell: (d) => (
    <span className="block py-1.5 min-w-0">
      <span className="block font-semibold text-foreground capitalize truncate" title={d.ApplicantName}>{personName(d.ApplicantName)}</span>
      <span className="block text-xs text-muted-foreground tabular-nums">{d.DeedNo}{d.VersionNo > 1 ? ` v${d.VersionNo}` : ""} · {d.BookingNo}</span>
    </span>
  ) },
  { id: "unit", label: "Unit and legal executive", sortKey: "LegalExecutiveName", csv: (d) => [d.ProjectName, d.UnitNo].filter(Boolean).join(" / "), cell: (d) => (
    <span className="block py-1.5 min-w-0">
      <span className="block font-medium truncate">{[d.ProjectName, d.UnitNo].filter(Boolean).join(" · ") || "—"}</span>
      <span className={cn("block text-xs truncate", d.LegalExecutiveName ? "text-muted-foreground" : "text-amber-700 dark:text-amber-300 font-medium")}>{d.LegalExecutiveName || "No legal executive"}</span>
    </span>
  ) },
  { id: "progress", label: "Progress", csv: (d) => deedBar(d).caption, cell: (d) => { const b = deedBar(d); return <span className="block min-w-[15rem] py-1.5"><StepBar steps={b.steps} caption={b.caption} /></span>; } },
  { id: "action", label: "Needs action", csv: (d) => deedAlerts(d).map((x) => x.label).join("; "), cell: (d) => {
    if (d.BookingStatus === "Cancelled") return <span className="text-destructive font-semibold text-xs">Booking cancelled: locked</span>;
    const al = deedAlerts(d);
    return al.length ? <span className="flex flex-wrap gap-1 py-1">{al.map((x) => <AlertPill key={x.key} tone={x.tone} label={x.label} />)}</span> : <span className="text-muted-foreground">—</span>;
  } },
  { id: "deadline", label: "Register by", sortKey: "RegistrationDeadline", csv: (d) => fmtDate(d.RegistrationDeadline), cell: (d) => <span className={cn("tabular-nums", d.Status === "Overdue" && "text-destructive font-semibold")}>{fmtDate(d.RegistrationDeadline)}</span> },
  { id: "value", label: "Deed value", sortKey: "DeedValue", align: "right", csv: (d) => d.DeedValue, cell: (d) => <span className="tabular-nums">{d.DeedValue ? fmtShort(d.DeedValue) : "—"}</span> },
  // In the export only.
  { id: "status", label: "Status", hiddenByDefault: true, csv: (d) => d.Status, cell: () => null },
  { id: "deedDate", label: "Deed date", hiddenByDefault: true, csv: (d) => fmtDate(d.DeedDate), cell: () => null },
  { id: "papers", label: "Papers uploaded", hiddenByDefault: true, csv: (d) => `${rowDeedProgress(d).uploaded}/${rowDeedProgress(d).required}`, cell: () => null },
  { id: "stamp", label: "Stamp duty", hiddenByDefault: true, csv: (d) => d.StampDuty, cell: () => null },
  { id: "qp", label: "Stamp duty payment", hiddenByDefault: true, csv: (d) => d.ListQpStatus, cell: () => null },
  { id: "registry", label: "Registry", hiddenByDefault: true, csv: (d) => d.ListRegistryStatus, cell: () => null },
  { id: "regNo", label: "Registration no.", hiddenByDefault: true, csv: (d) => d.RegistrationNo, cell: () => null },
  { id: "regDate", label: "Registered on", hiddenByDefault: true, csv: (d) => fmtDate(d.RegistrationDate), cell: () => null },
];

const CrmSalesDeed: React.FC = () => {
  const rights = usePageRights("crm-sales-deed");
  // Query Payment and Registry were their own pages; either their own right or the deed's works their sections.
  const qpRights = usePageRights("crm-query-payment");
  const regRights = usePageRights("crm-registry");
  const { currentUser } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const deepLinkBookingId = sp.get("bookingId");
  const deedIdParam = sp.get("deedId");
  const tabParam = sp.get("tab");
  const [deepLinkDone, setDeepLinkDone] = useState(false);

  const [pageSize, setPageSize] = useState<number>(GRID_PAGE_SIZES[0]);
  const s = useCrmListState({ pageSize, defaultSort: DEFAULT_SORT, defaultStatus: ALL });
  const [deedDates, setDeedDatesRaw] = useState<GridDateRange>(GRID_ANY_DATE);
  // "Needs action" narrows the list to one alert's deeds (worked out on the server).
  const [alertKey, setAlertKeyRaw] = useState<string>("");
  const setAlertKey = (k: string) => { setAlertKeyRaw(k); s.setPage(1); };
  const setDeedDates = (v: GridDateRange) => { setDeedDatesRaw(v); s.setPage(1); };
  const listFiltered = s.hasFilters || deedDates.preset !== "any" || !!alertKey;
  const clearFilters = () => { s.reset(); setDeedDatesRaw(GRID_ANY_DATE); setAlertKeyRaw(""); };
  const [exporting, setExporting] = useState(false);

  const [dialog, setDialog] = useState<"new" | "cancel" | "proxyApprove" | "proxyRecheck" | "rework" | null>(null);
  const [reworkReason, setReworkReason] = useState("");
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [stepSaving, setStepSaving] = useState(false);
  const [deedDetailSaving, setDeedDetailSaving] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(deedIdParam && /^\d+$/.test(deedIdParam) ? Number(deedIdParam) : null);
  const [sendingToCustomer, setSendingToCustomer] = useState(false);
  const [proxySaving, setProxySaving] = useState(false);
  const [execForm, setExecForm] = useState({ ExecutedBy: "", RegistrationNo: "", BookNo: "", PartNo: "", RegistrationDate: "", PossessionDate: "" });
  const [execSaving, setExecSaving] = useState(false);
  const [execEditing, setExecEditing] = useState(false);
  const [assigningLegal, setAssigningLegal] = useState(false);
  const [selectedLegalExec, setSelectedLegalExec] = useState("");
  const [requestingDoc, setRequestingDoc] = useState(false);

  const listQs = useMemo(() => {
    const p = listParams(s.query, ALL);
    const { from, to } = resolveGridDateRange(deedDates);
    if (from) p.set("dateFrom", from);
    if (to) p.set("dateTo", to);
    if (alertKey) p.set("alert", alertKey);
    return p;
  }, [s.query, deedDates, alertKey]);
  // The band's money and the Needs action counts cover every deed under the search and filters.
  const scopeQs = useMemo(() => {
    const p = new URLSearchParams(listQs);
    ["page", "pageSize", "status", "sortKey", "sortDir", "alert"].forEach((k) => p.delete(k));
    return p;
  }, [listQs]);
  const getJson = async (url: string) => {
    const r = await fetchWithAuth(url);
    const d = await r.json().catch(() => null);
    if (!r.ok) throw new Error(d?.error || `Could not load (${r.status}).`);
    return d;
  };
  const { data: insights } = useQuery({ queryKey: [KEY, "insights", scopeQs.toString()], queryFn: () => getJson(`${API}/insights?${scopeQs}`), staleTime: 60_000, enabled: detailId == null });
  const { data: listData, isLoading, isError, error, isFetching, refetch } = useQuery({ queryKey: [KEY, listQs.toString()], queryFn: () => fetchDeedsList(listQs), staleTime: 0, enabled: detailId == null });
  const listResult = useSticky(listData);
  const [gridPrefs, setGridPrefs] = useGridPrefs("crm-sales-deed-cols-v2", COLS);
  const counts = listResult?.statusCounts ?? {};
  const allCount = Object.values(counts).reduce((n, x) => n + x, 0);
  const { data: eligible = [] } = useQuery({ queryKey: ["crm-sales-deed-eligible"], queryFn: fetchEligible, staleTime: 60_000, enabled: rights.canCreate });
  const { data: context, isFetching: contextLoading } = useQuery({ queryKey: ["crm-sales-deed-context", form.BookingId], queryFn: () => fetchBookingContext(form.BookingId), enabled: !!form.BookingId });

  const { data: deedDetail, isError: detailIsError, error: detailError, isFetching: detailFetching, refetch: refetchDetail } = useQuery({
    queryKey: ["crm-sale-deed-detail", detailId],
    queryFn: () => getJson(`${API}/${detailId}`),
    enabled: detailId != null, staleTime: 0, retry: false,
  });
  const { data: users = [] } = useQuery({ queryKey: ["crm-legal-executives"], queryFn: fetchLegalExecutives, staleTime: 300_000 });
  const detail = deedDetail?.deed ?? null;
  const { data: detailContext } = useQuery({
    queryKey: ["crm-sales-deed-context", detail ? String(detail.BookingId) : ""],
    queryFn: () => fetchBookingContext(String(detail?.BookingId ?? "")),
    enabled: detail?.BookingId != null,
  });
  const deedCancelled = detail?.Status === CrmStatus.CANCELLED;
  // Stamp duty and registry belong to the booking: a cancelled deed shows them only as the current deed's.
  const { registry, history: bookingRegistryHistory } = useDeedRegistry(deedCancelled ? null : detail?.BookingId);
  const registryHistory = deedCancelled ? [] : bookingRegistryHistory;
  const { data: currentDeed } = useQuery({
    queryKey: ["crm-sales-deed-current", detail?.BookingId],
    queryFn: () => getJson(`${API}/booking/${detail?.BookingId}/deed`),
    enabled: deedCancelled && detail?.BookingId != null,
  });

  // Who may work the papers, confirm the stamp duty payment and complete or cancel the registry is set in Approval
  // Setup (Super Admin always, in parallel): the server answers, the page keeps no list of roles.
  const docsApprover = useCanApprove("crm-sales-deed-docs");
  const canConfirmPayment = useCanApprove("crm-query-payment-confirm");
  const canCompleteRegistry = useCanApprove("crm-registry-complete");
  const canCancelRegistry = useCanApprove("crm-registry-cancel");
  const qpCanCreate = rights.canCreate || qpRights.canCreate;
  const qpCanEdit = rights.canEdit || qpRights.canEdit;
  const regCanCreate = rights.canCreate || regRights.canCreate;
  const regCanEdit = rights.canEdit || regRights.canEdit;

  const agreementRegistered = context?.agreement?.Status === "Registered";
  const isLoanFinanced = context?.booking?.FinancingType === "LoanFinanced";
  const loanCleared = !context?.loanBlockReason;
  const handoverCleared = !context?.requiresHandoverBeforeDeed || context?.handoverStatus === "Completed";
  const canCreate = !!form.BookingId && agreementRegistered && loanCleared && handoverCleared && !contextLoading;

  const bookingCancelled = detail?.BookingStatus === "Cancelled";
  // A cancelled deed is closed (the server refuses every change): the booking's work goes on in a new deed.
  const closed = bookingCancelled || deedCancelled;
  const progressLocked = detail?.Status === CrmStatus.REGISTERED || detail?.Status === CrmStatus.CANCELLED;
  // Every change to the deed needs the edit right (the server refuses otherwise).
  const canWork = rights.canEdit && !closed;
  // Mirrors the server's requireAssignedLegalOrApprover: the deed's documents are worked by its assigned Legal
  // Executive (or Legal / admin), not anyone with page rights.
  const canActAsLegal = !detail?.LegalExecutiveId ? false : docsApprover || String(detail.LegalExecutiveId) === String(currentUser?.id ?? "");
  const legalLockReason = !detail?.LegalExecutiveId ? "Assign a Legal Executive to this deed first" : "Locked to the assigned Legal Executive (or someone named for sale deed papers in Approval Setup)";

  // Deep links: ?deedId opens that deed; ?bookingId opens the booking's deed (found on the server), or, when it has
  // none and is eligible, the New Sale Deed dialog.
  useEffect(() => {
    if (deepLinkDone || !deepLinkBookingId || deedIdParam) return;
    let stop = false;
    (async () => {
      const r = await fetchWithAuth(`${API}/booking/${deepLinkBookingId}/deed`).catch(() => null);
      const row = r?.ok ? await r.json().catch(() => null) : null;
      if (stop) return;
      if (row?.Id) { setDeepLinkDone(true); selectDetail(row.Id); return; }
      if (rights.canCreate && (eligible as any[]).some((b: any) => String(b.Id) === deepLinkBookingId)) {
        setDeepLinkDone(true);
        setForm((f) => ({ ...f, BookingId: deepLinkBookingId }));
        setDialog("new");
      }
    })();
    return () => { stop = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkBookingId, deedIdParam, deepLinkDone, (eligible as any[]).length, rights.canCreate]);
  // ?tab= (links from other pages, e.g. tab=Registry) brings that section into view once the deed is open.
  useEffect(() => {
    const id = tabParam && SECTION_OF[tabParam as DeedTab];
    if (!detail || !id) return;
    const jump = () => document.getElementById(`deed-${id}`)?.scrollIntoView({ block: "start" });
    jump();
    // The stamp duty and registry parts load their own data and can push the section down: jump again once they have.
    const again = window.setTimeout(jump, 900);
    return () => window.clearTimeout(again);
  }, [detail?.Id, tabParam]);
  useEffect(() => {
    if (!context?.agreement) return;
    const credit = Number(context.agreement.AfsStampDuty ?? 0) || 0;
    if (credit > 0) setForm((f) => ({ ...f, StampDutyCredit: f.StampDutyCredit === "" ? String(credit) : f.StampDutyCredit }));
  }, [context?.agreement?.AfsStampDuty]);

  const invalidate = () => {
    [KEY, ...OTHER_KEYS].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    if (detailId != null) qc.invalidateQueries({ queryKey: ["crm-sale-deed-detail", detailId] });
  };
  const invalidateDetail = () => qc.invalidateQueries({ queryKey: ["crm-sale-deed-detail", detailId] });
  const send = async (url: string, method: string, body?: any) => {
    const res = await fetchWithAuth(url, body instanceof FormData ? { method, body } : { method, headers: { "Content-Type": "application/json" }, body: body !== undefined ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  };

  const closeNew = () => { setDialog(null); setForm({ ...EMPTY_FORM }); };
  const handleCreate = async () => {
    if (!form.BookingId) { toast.error("Booking is required"); return; }
    if (!canCreate) { toast.error("This booking isn't eligible yet"); return; }
    setSaving(true);
    try {
      const data = await send(API, "POST", { ...form, BookingId: parseInt(form.BookingId) });
      toast.success(`Sale deed ${data.DeedNo} created`);
      closeNew();
      invalidate();
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setSaving(false); }
  };
  const backToList = () => {
    setDetailId(null);
    setSp((p) => { p.delete("deedId"); p.delete("tab"); p.delete("bookingId"); return p; }, { replace: true });
  };
  function selectDetail(id: number) {
    setExecEditing(false);
    setSelectedLegalExec("");
    setDetailId(id);
    setSp((p) => { p.set("deedId", String(id)); return p; }, { replace: true });
  }
  const startExec = () => {
    setExecForm({
      ExecutedBy: detail?.ExecutedBy || "", RegistrationNo: detail?.RegistrationNo || "", BookNo: detail?.BookNo || "", PartNo: detail?.PartNo || "",
      RegistrationDate: detail?.RegistrationDate ? String(detail.RegistrationDate).slice(0, 10) : "",
      PossessionDate: detail?.PossessionDate ? String(detail.PossessionDate).slice(0, 10) : "",
    });
    setExecEditing(true);
    document.getElementById("deed-legal")?.scrollIntoView({ block: "start" });
  };
  const saveFields = (fields: Record<string, any>) => send(`${API}/${detailId}`, "PUT", fields);
  const handleSaveDeedDetails = async (fields: Record<string, string>) => {
    setDeedDetailSaving(true);
    try { await saveFields(fields); toast.success("Deed details updated"); invalidate(); }
    catch (e: any) { toast.error(translateError(e.message)); }
    finally { setDeedDetailSaving(false); }
  };
  const handleSaveIndex2 = async (date: string) => {
    setStepSaving(true);
    try { await saveFields({ Index2ReceivedDate: date || null }); toast.success("Index II received date saved"); invalidate(); }
    catch (e: any) { toast.error(translateError(e.message)); }
    finally { setStepSaving(false); }
  };
  const handleSaveExecution = async () => {
    if (!execForm.ExecutedBy.trim()) { toast.error("Enter who executed the deed"); return; }
    setExecSaving(true);
    try {
      const data = await saveFields(execForm);
      toast.success(`Deed status: ${data?.status || "updated"}`);
      setExecEditing(false);
      invalidate();
      qc.invalidateQueries({ queryKey: ["crm-handover-eligible"] });
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setExecSaving(false); }
  };
  const handleSendToCustomer = async () => {
    setSendingToCustomer(true);
    try { await send(`${API}/${detailId}/send-to-customer`, "PUT"); toast.success("Sent to customer for approval"); invalidate(); }
    catch (e: any) { toast.error(translateError(e.message)); }
    finally { setSendingToCustomer(false); }
  };
  const handleProxy = async (path: "proxy-customer-approve" | "proxy-customer-recheck", method: ProxyMethod, remarks: string) => {
    setProxySaving(true);
    try {
      await send(`${API}/${detailId}/${path}`, "PUT", { ProxyMethod: method, ProxyRemarks: remarks });
      toast.success(path === "proxy-customer-approve" ? "Customer approval recorded" : "Customer recheck request recorded");
      setDialog(null);
      invalidate();
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setProxySaving(false); }
  };
  const handleAssignLegal = async (legalExecutiveId: string) => {
    setAssigningLegal(true);
    try {
      await send(`${API}/${detailId}/assign-legal`, "PUT", { LegalExecutiveId: legalExecutiveId || null });
      toast.success("Legal executive assigned");
      setSelectedLegalExec("");
      invalidate();
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setAssigningLegal(false); }
  };
  // The document centre's calls (the server's own rules decide who may do each).
  const docAttach = (doc: any, file: File) => { const fd = new FormData(); fd.append("file", file); return send(`${API}/${detailId}/documents/${doc.Id}/attach`, "POST", fd); };
  const docUpload = (files: File[], documentType: string, label?: string) => {
    const fd = new FormData();
    files.forEach((f) => fd.append("files", f));
    fd.append("DocumentType", documentType);
    if (label) fd.append("Label", label);
    return send(`${API}/${detailId}/documents/upload`, "POST", fd);
  };
  const docReview = (doc: any, verify: boolean, remarks?: string) => send(`${API}/${detailId}/documents/${doc.Id}`, "PUT", verify ? { Status: "Verified" } : { Status: "Rejected", Remarks: remarks });
  const docHistory = async (doc: any) => { const r = await fetchWithAuth(`${API}/documents/${doc.Id}/audit`); return r.ok ? auditToHistory(await r.json()) : []; };
  const handleRequestDoc = async (documentType: string, label?: string) => {
    setRequestingDoc(true);
    try { await send(`${API}/${detailId}/documents/request`, "POST", { DocumentType: documentType, Label: label, IsMandatory: true }); toast.success("Mandatory document requested"); invalidateDetail(); }
    catch (e: any) { toast.error(translateError(e.message)); }
    finally { setRequestingDoc(false); }
  };
  const openRework = () => { setReworkReason(detail?.CustomerApprovalStatus === "RecheckRequested" ? detail?.CustomerRecheckRemarks || "" : ""); setDialog("rework"); };
  const handleRework = async () => {
    setSaving(true);
    try { await send(`${API}/${detailId}/rework`, "PUT", { Remarks: reworkReason.trim() }); toast.success("Sent back to legal to correct"); setDialog(null); invalidate(); }
    catch (e: any) { toast.error(translateError(e.message)); }
    finally { setSaving(false); }
  };
  const handleResubmit = async () => {
    try { await send(`${API}/${detailId}/submit`, "PUT"); toast.success("Submitted for senior approval"); invalidate(); }
    catch (e: any) { toast.error(translateError(e.message)); }
  };
  const handleCancelDeed = async () => {
    setSaving(true);
    try { await send(`${API}/${detailId}/cancel`, "PUT"); toast.success("Sale deed cancelled"); setDialog(null); invalidate(); }
    catch (e: any) { toast.error(translateError(e.message)); }
    finally { setSaving(false); }
  };
  const handleExport = async () => {
    setExporting(true);
    try { exportGrid(await fetchAllDeeds(listQs), COLS, `sale-deeds-${s.status.toLowerCase()}`); }
    catch (e: any) { toast.error(translateError(e.message)); }
    finally { setExporting(false); }
  };

  // ── One deed ──
  const record = () => {
    if (detailIsError && !detail) return (
      <div className={cn(GRID_CARD, "px-4 py-10 text-center text-sm")}>
        <p className="text-destructive">{translateError((detailError as Error)?.message)}</p>
        <button type="button" onClick={backToList} className={cn(GRID_BTN, "mt-3")}>All sale deeds</button>
      </div>
    );
    if (!detail) return <div className="px-4 py-10 text-center text-sm text-muted-foreground">Loading…</div>;
    const d = detail;
    const documents: any[] = deedDetail?.documents || [];
    const papers = deedDocumentProgress(documents);
    const pendingDocs = documents.filter((doc) => doc.IsMandatory && doc.Status !== "Verified");
    const bar = deedBar(d);
    const payable = Math.max(0, Number(d.StampDuty || 0) + Number(d.RegistrationFee || 0) - Number(d.StampDutyCredit || 0));
    const focus = d.Status === CrmStatus.CANCELLED || d.Status === CrmStatus.REGISTERED ? null : SECTION_OF[deedStepStates(d).find((x) => x.state === "current")?.tab ?? "Overview"];
    const step = (key: string, node: React.ReactNode) => <div id={`deed-${key}`} className={cn("rounded-lg scroll-mt-4", focus === key && "ring-2 ring-primary/50")}>{node}</div>;

    // What the deed waits on now, and the one action that moves it on.
    let next = ""; let action: { label: string; run: () => void } | null = null;
    if (d.Status === CrmStatus.CANCELLED) next = "Cancelled.";
    else if (bookingCancelled) next = `The booking is ${d.BookingStatus || "inactive"}: this deed is locked. Cancel the deed to close it out.`;
    else if (d.Status === CrmStatus.REGISTERED) next = "Registered at the Sub-Registrar.";
    else if (d.Status === "Executed") next = "Executed: complete the registry to record the registration number.";
    else if (!d.LegalExecutiveId) next = "Assign the legal executive who prepares the paperwork";
    else if (d.SeniorApprovalStatus == null) {
      const ready = papers.required > 0 && pendingDocs.length === 0;
      // Sent back (director's rejection, or the customer's recheck): say why, from the latest history entry.
      const last = ((deedDetail?.approvalLog || []) as any[]).reduce((m: any, l: any) => (!m || new Date(l.CreatedAt) > new Date(m.CreatedAt) ? l : m), null);
      const back = last && ["DirectorReject", "SentBackToLegal"].includes(last.Action) ? `${LOG_ACTION_LABEL[last.Action]}${last.Remarks ? `: ${last.Remarks}` : ""}. ` : "";
      next = back + (ready ? "Papers verified: submit for senior approval" : papers.required ? `Rework and verify the mandatory papers (${papers.required - pendingDocs.length} of ${papers.required})` : "Request the deed draft");
      if (ready && canActAsLegal) action = { label: "Submit for Senior Approval", run: handleResubmit };
    } else if (d.SeniorApprovalStatus === "Rejected") { next = `Senior approval rejected${d.SeniorApprovalRemarks ? `: ${d.SeniorApprovalRemarks}` : ""}`; action = { label: "Resubmit for Approval", run: handleResubmit }; }
    else if (d.SeniorApprovalStatus !== "Approved") next = "Waiting for senior approval";
    else if (!d.SentToCustomerAt) { next = "Senior-approved: share with the customer"; action = { label: "Send to Customer Portal", run: handleSendToCustomer }; }
    else if (d.CustomerApprovalStatus === "RecheckRequested") { next = `The customer asked for a recheck${d.CustomerRecheckRemarks ? `: "${d.CustomerRecheckRemarks}"` : ""}. Resend it as it is, or send it back to legal to correct it (Legal Work and Approvals).`; action = { label: "Resend to Customer", run: handleSendToCustomer }; }
    else if (d.CustomerApprovalStatus !== "Approved") next = `Sent to the customer${d.SentToCustomerAt ? ` on ${fmtDate(d.SentToCustomerAt)}` : ""}: waiting for their review`;
    else if (d.DirectorApprovalStatus !== "Approved") next = "The customer approved: waiting for the director's sign-off";
    else if (detailContext?.queryPaymentStatus !== "Confirmed" && payable <= 0 && !Number(d.StampDuty) && !Number(d.RegistrationFee)) { next = "The deed has no stamp duty or registration fee, so the payment can't start: send it back to legal to enter them"; action = { label: "Send Back to Legal", run: openRework }; }
    else if (detailContext?.queryPaymentStatus !== "Confirmed") next = "Confirm the customer's stamp duty payment";
    else if (pendingDocs.length) next = `${pendingDocs.length} mandatory document${pendingDocs.length > 1 ? "s" : ""} still to verify: ${pendingDocs.map((doc) => doc.Label || doc.DocumentType).join(", ")}`;
    else { next = "Every check has passed: record the execution"; action = { label: "Record Execution", run: startExec }; }
    if (!canWork) action = null;
    // When the next step is worked inside a section (stamp duty, registry, documents), the band takes you to it.
    const SECTION_TITLE: Record<string, string> = { details: "Deed Details", legal: "Legal Work", documents: "Documents", stampDuty: "Stamp Duty", registry: "Registry" };
    if (!action && focus && SECTION_TITLE[focus]) action = { label: `Go to ${SECTION_TITLE[focus]}`, run: () => document.getElementById(`deed-${focus}`)?.scrollIntoView({ block: "start" }) };

    const history = [
      ...((deedDetail?.approvalLog || []) as any[]).map((l) => ({ id: `a${l.Id}`, at: l.CreatedAt, title: LOG_ACTION_LABEL[l.Action] || l.Action, by: l.ActorName, type: l.ActorType, note: l.Remarks, bad: /Reject|Recheck|Cancel|SentBack/.test(l.Action) })),
      ...(registryHistory as any[]).map((l) => ({ id: `r${l.Id}`, at: l.CreatedAt, title: `Registry: ${l.Action}`, by: l.ActorName, type: l.ActorType, note: l.Remarks, bad: false })),
      ...(d.CreatedAt ? [{ id: "made", at: d.CreatedAt, title: "Deed made", by: null, type: null, note: null, bad: false }] : []),
    ].sort((p, q) => new Date(q.at).getTime() - new Date(p.at).getTime());
    // The column's starting value ("NotRequired") means the director hasn't been asked yet.
    const directorStatus = d.DirectorApprovalStatus === "NotRequired" ? null : d.DirectorApprovalStatus;
    const approvals = [
      { n: 1, title: "Senior review", text: "An admin or super-admin approves this deed before it's shared with the customer.", status: d.SeniorApprovalStatus },
      { n: 2, title: "Shared with customer", text: "The customer can view this deed in their portal and approve it or request a recheck.", status: d.SentToCustomerAt ? "Sent" : null },
      { n: 3, title: "Customer review", text: "The customer's response from the portal: approve, or request changes.", status: d.CustomerApprovalStatus },
      { n: 4, title: "Director review", text: "Final internal sign-off by the director before execution.", status: directorStatus },
    ];
    const executed = !!d.ExecutedBy;
    // Send back to legal: after senior approval, until execution, while the stamp duty payment isn't confirmed.
    const canSendBack = canWork && d.SeniorApprovalStatus === "Approved" && !executed && !d.RegistrationNo && detailContext?.queryPaymentStatus !== "Confirmed";
    // The server's rule: every approval, and the stamp duty payment confirmed (the deed is signed on paid stamp paper).
    const stampPaid = detailContext?.queryPaymentStatus === "Confirmed";
    const readyToExecute = d.SeniorApprovalStatus === "Approved" && d.CustomerApprovalStatus === "Approved" && d.DirectorApprovalStatus === "Approved" && stampPaid;

    return (
      <div className="space-y-4">
        <MoneyBand eyebrow={`Sale Deed · ${d.DeedNo ?? ""}${d.VersionNo > 1 ? ` · version ${d.VersionNo}` : ""}`} title={<span className="capitalize">{personName(d.ApplicantName)}</span>}
          status={<span className="inline-flex items-center h-5 px-2 rounded-full border border-white/30 text-[0.6875rem] font-semibold text-white">{bookingCancelled ? "Booking cancelled" : d.Status}</span>}
          sub={[d.ProjectName, d.UnitNo && `Unit ${d.UnitNo}`, d.BookingNo].filter(Boolean).join(" · ")}
          actions={<>
            <button type="button" onClick={backToList} className={BAND_KEY}><ArrowLeft size={13} /> All sale deeds</button>
            <button type="button" onClick={() => navigate(`/crm/bookings?view=${d.BookingId}`)} className={BAND_KEY}><ExternalLink size={13} /> Open Booking</button>
            {rights.canEdit && d.Status !== CrmStatus.REGISTERED && d.Status !== CrmStatus.CANCELLED && <button type="button" onClick={() => setDialog("cancel")} className={cn(BAND_KEY, "!text-rose-300")}><XCircle size={13} /> Cancel Deed</button>}
            <button type="button" onClick={() => refetchDetail()} disabled={detailFetching} className={cn(BAND_KEY, "w-9 !px-0")} title="Refresh" aria-label="Refresh"><RefreshCw size={13} className={detailFetching ? "animate-spin" : ""} /></button>
          </>}
          lead={d.DeedValue ? fmtShort(d.DeedValue) : "—"} leadNote="deed value"
          bar={<StepBar steps={bar.steps} caption={bar.caption} onDark />}
          figures={[
            { label: "Stamp duty", value: d.StampDuty ? fmtShort(d.StampDuty) : "—", exact: d.StampDuty ? fmtRupees(d.StampDuty) : undefined, note: d.RegistrationFee ? `Fee ${fmtShort(d.RegistrationFee)}` : "Fee not set" },
            { label: "Register by", dot: d.Status === "Overdue" ? BAND_DOT.overdue : undefined, value: fmtDate(d.RegistrationDeadline), note: d.Status === "Overdue" ? "Overdue" : "RERA deadline", alert: d.Status === "Overdue" },
            { label: "Papers", dot: papers.required && papers.uploaded === papers.required ? BAND_DOT.collected : BAND_DOT.finance, value: `${papers.uploaded} of ${papers.required}`, note: "Mandatory uploaded" },
            { label: "Payable to government", value: payable > 0 ? fmtShort(payable) : "—", exact: payable > 0 ? fmtRupees(payable) : undefined, note: "Less AFS credit" },
          ]}
          footer={<BandNext text={next} finished={d.Status === CrmStatus.REGISTERED || d.Status === CrmStatus.CANCELLED} action={action} />} />

        {/* The deed's own figures, edited in place (its panel shows them once). */}
        {step("details", <DeedDetailsSection key={`${d.Id}-${d.UpdatedAt ?? ""}`} detail={d} onSave={handleSaveDeedDetails} saving={deedDetailSaving} canEdit={canWork && !progressLocked} />)}

        {step("legal", (
          <GridRelated icon={ShieldAlert} title="Legal Work and Approvals">
            <div className="px-4 py-3 space-y-2" style={{ borderBottom: RULE_SOFT }}>
              <div className="flex items-center justify-between gap-2"><span className="text-[0.8125rem] font-semibold">Legal executive</span><GridToneMark text={d.LegalExecutiveId ? "Assigned" : "Unassigned"} tone={d.LegalExecutiveId ? "done" : "waiting"} /></div>
              <p className="text-xs text-muted-foreground">The person responsible for preparing this deed's paperwork. Required before execution.</p>
              {d.LegalExecutiveId && !selectedLegalExec ? (
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-2 flex-1 px-3 h-9 rounded-md" style={{ border: RULE_SOFT }}><UserCircle2 size={14} className="shrink-0" /><span className="text-sm font-medium">{d.LegalExecutiveName}</span><Lock size={11} className="text-muted-foreground ml-auto shrink-0" /></div>
                  {canWork && !progressLocked && <button onClick={() => setSelectedLegalExec(String(d.LegalExecutiveId))} className={`${KEY_LINE} h-9 px-3 shrink-0`}>Change</button>}
                </div>
              ) : progressLocked || !canWork ? (
                <div className="font-medium text-sm">{d.LegalExecutiveName || <span className="text-muted-foreground">Unassigned</span>}</div>
              ) : (
                <div className="flex items-center gap-2">
                  <div className="flex-1"><SearchableSelect value={selectedLegalExec} onChange={setSelectedLegalExec} placeholder="Select legal executive" searchPlaceholder="Search people…" options={users} /></div>
                  <button onClick={() => handleAssignLegal(selectedLegalExec)} disabled={!selectedLegalExec || assigningLegal || selectedLegalExec === String(d.LegalExecutiveId ?? "")} className={`${KEY_INK} h-9 px-3`}>{assigningLegal ? "Assigning…" : "Assign"}</button>
                  {d.LegalExecutiveId && <button onClick={() => setSelectedLegalExec("")} className={`${KEY_LINE} h-9 px-3 shrink-0`}>Cancel</button>}
                </div>
              )}
            </div>
            {approvals.map((a) => {
              const s1 = a.status;
              const done = a.n === 2 ? !!d.SentToCustomerAt : s1 === "Approved";
              const stopped = s1 === "Rejected" || s1 === "RecheckRequested";
              const active = a.n === 1 ? s1 === "Pending" : a.n === 2 ? d.SeniorApprovalStatus === "Approved" : a.n === 3 ? !!d.SentToCustomerAt : d.CustomerApprovalStatus === "Approved";
              const label = a.n === 1 && s1 == null ? "Not submitted" : a.n === 4 && s1 == null ? "Not requested" : a.n === 2 ? (s1 ? "Sent" : "Not sent") : s1 === "RecheckRequested" ? "Recheck requested" : s1 || "Pending";
              return (
                <div key={a.n} className="px-4 py-4 flex items-start gap-3" style={{ borderBottom: RULE_SOFT }}>
                  <StepBox n={a.n} done={done} active={active} stopped={stopped} />
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <div className="flex items-center justify-between gap-2 flex-wrap"><span className="text-[0.8125rem] font-semibold">{a.title}</span><GridToneMark text={label} tone={stopped ? "stopped" : done ? "done" : ((a.n === 1 || a.n === 4) && s1 == null) ? "waiting" : deedTone(label)} /></div>
                    <p className="text-xs text-muted-foreground">{a.text}</p>
                    {a.n === 1 && done && d.SeniorApprovedAt && <p className="text-xs flex items-center gap-1 tabular-nums"><CheckCircle2 size={11} /> Approved {fmtDate(d.SeniorApprovedAt)}{d.SeniorApprovalRemarks && <span className="text-muted-foreground ml-1">· {d.SeniorApprovalRemarks}</span>}</p>}
                    {a.n === 1 && s1 === "Rejected" && d.SeniorApprovalRemarks && <p className="text-xs text-destructive rounded-md px-2 py-1.5 border border-destructive/40"><strong>Rejection reason:</strong> {d.SeniorApprovalRemarks}</p>}
                    {a.n === 1 && s1 == null && canWork && (
                      <div className="pt-0.5">
                        <button onClick={handleResubmit} disabled={!papers.required || pendingDocs.length > 0 || !canActAsLegal} title={!canActAsLegal ? legalLockReason : pendingDocs.length ? `${papers.required - pendingDocs.length}/${papers.required} mandatory documents verified — all must be verified first` : undefined} className={`${KEY_INK} h-8 px-3 disabled:opacity-50`}>Submit for Senior Approval</button>
                        {(pendingDocs.length > 0 || !papers.required) && <p className="text-xs text-muted-foreground mt-1 tabular-nums">{papers.required === 0 ? "Request a mandatory document in Documents first." : `${papers.required - pendingDocs.length}/${papers.required} mandatory documents verified.`}</p>}
                      </div>
                    )}
                    {a.n === 1 && s1 === "Pending" && !closed && <div className="flex items-center gap-2 flex-wrap pt-0.5"><ApprovalActions status={s1} recordId={d.Id} endpoint={API} actionPathSuffix="" module="crm-sales-deed-senior" submitOnly={false} onSuccess={invalidate} /></div>}
                    {a.n === 1 && s1 === "Rejected" && canWork && <button onClick={handleResubmit} className={`${KEY_INK} h-8 px-3 mt-1`}>Resubmit for Approval</button>}
                    {a.n === 2 && d.SentToCustomerAt && <p className="text-xs flex items-center gap-1 tabular-nums"><Send size={11} /> Sent {fmtDate(d.SentToCustomerAt)}</p>}
                    {a.n === 2 && d.SeniorApprovalStatus === "Approved" && canWork && d.CustomerApprovalStatus !== "Approved" && <button onClick={handleSendToCustomer} disabled={sendingToCustomer} className={`${KEY_INK} h-8 px-3 mt-0.5`}>{sendingToCustomer ? "Sending…" : d.SentToCustomerAt ? "Resend to Customer" : "Send to Customer Portal"}</button>}
                    {a.n === 3 && done && d.CustomerApprovedAt && <p className="text-xs flex items-center gap-1 tabular-nums"><CheckCircle2 size={11} /> Approved {fmtDate(d.CustomerApprovedAt)}</p>}
                    {a.n === 3 && s1 === "RecheckRequested" && d.CustomerRecheckRemarks && <p className="text-xs text-destructive rounded-md px-2 py-1.5 border border-destructive/40"><strong>Recheck reason:</strong> {d.CustomerRecheckRemarks}</p>}
                    {a.n === 3 && s1 === "RecheckRequested" && canWork && (
                      <div className="pt-0.5">
                        <button onClick={openRework} className={`${KEY_LINE} h-8 px-3`}>Send Back to Legal</button>
                        <p className="text-xs text-muted-foreground mt-1">When the deed itself must change: new version, papers reworked, then senior, customer and director again.</p>
                      </div>
                    )}
                    {a.n === 3 && d.SentToCustomerAt && !done && canWork && (
                      <div className="flex gap-2 flex-wrap mt-2">
                        <button onClick={() => setDialog("proxyApprove")} className={`${KEY_LINE} h-8 px-3`}><UserCircle2 size={11} /> Record Approval (offline)</button>
                        <button onClick={() => setDialog("proxyRecheck")} className={`${KEY_LINE} h-8 px-3 !text-destructive`}><UserCircle2 size={11} /> Record Recheck (offline)</button>
                      </div>
                    )}
                    {a.n === 4 && done && d.DirectorApprovedAt && <p className="text-xs flex items-center gap-1 tabular-nums"><CheckCircle2 size={11} /> Approved {fmtDate(d.DirectorApprovedAt)}</p>}
                    {a.n === 4 && s1 === "Rejected" && d.DirectorApprovalRemarks && <p className="text-xs text-destructive rounded-md px-2 py-1.5 border border-destructive/40"><strong>Rejection reason:</strong> {d.DirectorApprovalRemarks}</p>}
                    {a.n === 4 && !closed && s1 === "Pending" && <div className="flex items-center gap-2 flex-wrap pt-0.5"><ApprovalActions status={s1} recordId={d.Id} endpoint={API} actionPathSuffix="director" module="crm-sales-deed-director" onSuccess={invalidate} /></div>}
                  </div>
                </div>
              );
            })}
            {canSendBack && d.CustomerApprovalStatus !== "RecheckRequested" && (
              <div className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap" style={{ borderBottom: RULE_SOFT }}>
                <p className="text-xs text-muted-foreground">Found a mistake after approval (figures, names, the draft)? Send it back to legal: a new version, then senior, customer and director again.</p>
                <button onClick={openRework} className={`${KEY_LINE} h-8 px-3 shrink-0`}>Send Back to Legal</button>
              </div>
            )}
            {/* Execution: the end of the senior → customer → director chain (and, on the server, every mandatory document verified). */}
            <div className="px-4 py-4 space-y-2">
              <div className="flex items-center justify-between gap-2"><span className="text-[0.8125rem] font-semibold">Deed execution</span><GridToneMark text={executed ? "Executed" : "Not executed"} tone={executed ? "done" : "waiting"} /></div>
              {!progressLocked && !execEditing && (
                !executed && !readyToExecute ? <p className="text-xs text-muted-foreground">Needs senior, customer and director approval and the stamp duty payment confirmed first. Now senior: {d.SeniorApprovalStatus || "not requested"}, customer: {d.CustomerApprovalStatus || "not sent"}, director: {directorStatus || "not requested"}, stamp duty: {stampPaid ? "confirmed" : (detailContext?.queryPaymentStatus || "not started")}.</p>
                : !executed ? (canWork ? <button onClick={startExec} className={`${KEY_INK} h-8 px-3`}>Record Execution</button> : <p className="text-xs text-muted-foreground">Not executed yet.</p>)
                : <div className="flex items-center gap-3"><p className="text-xs text-muted-foreground">Executed by <span className="font-medium text-foreground">{d.ExecutedBy}</span></p>{canWork && <button onClick={startExec} className={`${KEY_LINE} h-7 px-2`}><Pencil size={10} /> Edit</button>}</div>
              )}
              {execEditing && canWork && (
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground">Status follows what's recorded: executed by → Executed; registration no. → Registered. Every mandatory document must be verified (the server checks).</p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <label className="sm:col-span-3 space-y-1"><span className={`block ${LBL}`}>Executed by *</span><input className={INP} value={execForm.ExecutedBy} onChange={(e) => setExecForm((f) => ({ ...f, ExecutedBy: e.target.value }))} placeholder="Authorised signatory name" /></label>
                    <label className="space-y-1"><span className={`block ${LBL}`}>Registration no.</span><input className={`${INP} tabular-nums`} value={execForm.RegistrationNo} onChange={(e) => setExecForm((f) => ({ ...f, RegistrationNo: e.target.value }))} /></label>
                    <label className="space-y-1"><span className={`block ${LBL}`}>Registration date</span><DateInput className={INP} value={execForm.RegistrationDate} onChange={(e) => setExecForm((f) => ({ ...f, RegistrationDate: e.target.value }))} /></label>
                    <label className="space-y-1"><span className={`block ${LBL}`}>Possession date</span><DateInput className={INP} value={execForm.PossessionDate} onChange={(e) => setExecForm((f) => ({ ...f, PossessionDate: e.target.value }))} /></label>
                    <label className="space-y-1"><span className={`block ${LBL}`}>Book no.</span><input className={INP} value={execForm.BookNo} onChange={(e) => setExecForm((f) => ({ ...f, BookNo: e.target.value }))} /></label>
                    <label className="space-y-1"><span className={`block ${LBL}`}>Part no.</span><input className={INP} value={execForm.PartNo} onChange={(e) => setExecForm((f) => ({ ...f, PartNo: e.target.value }))} /></label>
                  </div>
                  <div className="flex justify-end gap-2">
                    <button onClick={() => setExecEditing(false)} className={`${KEY_LINE} h-8 px-3`}>Cancel</button>
                    <button onClick={handleSaveExecution} disabled={execSaving} className={`${KEY_INK} h-8 px-3`}>{execSaving ? "Saving…" : "Save Execution"}</button>
                  </div>
                </div>
              )}
              {progressLocked && (executed ? (
                <div className="space-y-0.5 text-xs text-muted-foreground">
                  <p>By <span className="text-foreground font-medium">{d.ExecutedBy}</span></p>
                  {d.RegistrationNo && <p className="tabular-nums">Reg no. <span className="text-foreground">{d.RegistrationNo}</span> · {fmtDate(d.RegistrationDate)}</p>}
                  {d.BookNo && <p className="tabular-nums">Book / part: {d.BookNo} / {d.PartNo}</p>}
                </div>
              ) : <p className="text-xs text-muted-foreground">Not executed.</p>)}
            </div>
          </GridRelated>
        ))}

        {step("documents", (() => {
          const canDocs = canWork && !progressLocked;
          return (
            <GridRelated icon={FolderCheck} title="Documents" count={documents.length}>
              <div className="p-4">
                <DocumentCentre documents={documents} hasFile={(doc) => !!doc.HasFile} fileUrl={(doc) => `${API}/documents/file/${doc.Id}`} onChanged={invalidateDetail}
                  requiredTitle="Required for senior approval" review={docReview} attach={docAttach} history={docHistory}
                  upload={{ types: [{ value: "ExecutedDeed", label: "Executed deed copy" }, { value: "Other", label: "Other" }], run: docUpload }}
                  canAttach={{ ok: canDocs && canActAsLegal, reason: !canDocs ? (progressLocked ? "The deed is closed: papers can't change." : "Changing papers needs the edit right.") : legalLockReason }}
                  canReview={{ ok: canDocs, reason: progressLocked ? "The deed is closed: papers can't change." : "Reviewing papers needs the edit right." }}
                  emptyRequired={(
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <p className="text-xs text-muted-foreground">No mandatory paper asked for yet. Senior approval waits until one is requested and verified.</p>
                      {canDocs && <button type="button" onClick={() => handleRequestDoc("DeedDraft", "Sale Deed Draft (Physical Legal Document)")} disabled={requestingDoc} className={GRID_BTN_BRAND}>{requestingDoc ? "Requesting…" : "Request Deed Draft"}</button>}
                    </div>
                  )} />
              </div>
            </GridRelated>
          );
        })())}

        {deedCancelled ? (
          <div className={cn(GRID_CARD, "px-4 py-3 flex items-center justify-between gap-3 flex-wrap text-sm")}>
            <span className="text-muted-foreground">Stamp duty and registry belong to the booking, not to this cancelled deed{currentDeed?.Id && currentDeed.Id !== d.Id ? "; they are worked on the booking's current deed." : "."}</span>
            {currentDeed?.Id && currentDeed.Id !== d.Id && <button type="button" onClick={() => selectDetail(currentDeed.Id)} className={GRID_BTN}>Open Current Deed <ArrowRight size={13} /></button>}
          </div>
        ) : <>
        {step("stampDuty", <QueryPaymentTab key={d.Id} detail={d} canCreate={qpCanCreate && !closed} canEdit={qpCanEdit && !closed} canConfirm={qpCanEdit && !closed && canConfirmPayment} onChanged={invalidate} />)}

        {step("registry", <RegistryTab key={d.Id} detail={d} qpConfirmed={detailContext?.queryPaymentStatus === "Confirmed"} canCreate={regCanCreate && !closed} canEdit={regCanEdit && !closed}
          canComplete={regCanEdit && !closed && canCompleteRegistry} canCancel={regCanEdit && !closed && canCancelRegistry} canEditDeed={canWork} onSaveIndex2={handleSaveIndex2} savingIndex2={stepSaving} onChanged={invalidate} />)}
        </>}

        {step("history", (
          <GridRelated icon={History} title="History" count={history.length}>
            {history.length ? (
              <ol className="px-4 py-4 relative ml-3 border-l border-border space-y-4">
                {history.map((e) => (
                  <li key={e.id} className="relative pl-5">
                    <span className={cn("absolute -left-[5px] top-1 w-2.5 h-2.5 rounded-full ring-2 ring-card", e.bad ? "bg-rose-600" : "bg-primary")} />
                    <div className="flex items-baseline justify-between gap-2 flex-wrap">
                      <span className={cn("text-[0.8125rem] font-semibold", e.bad && "text-destructive")}>{e.title}</span>
                      <span className="text-xs text-muted-foreground tabular-nums">{fmtDate(e.at)}</span>
                    </div>
                    {e.by && <div className="text-xs text-muted-foreground mt-0.5">By {e.by}{e.type ? ` (${e.type})` : ""}</div>}
                    {e.note && <p className="mt-1 text-xs rounded-md bg-muted/60 px-2 py-1.5 whitespace-pre-line">{e.note}</p>}
                  </li>
                ))}
              </ol>
            ) : <p className="px-4 py-4 text-xs text-muted-foreground">Nothing recorded yet.</p>}
            <div className="px-4 py-3 border-t border-border flex flex-wrap gap-2">
              {([["Agreement", `/crm/agreements?bookingId=${d.BookingId}`], ["Payments", `/crm/payments?bookingId=${d.BookingId}`], ["Possession & Handover", `/crm/possession?bookingId=${d.BookingId}`],
                ["Property Mutation", `/crm/mutation?bookingId=${d.BookingId}`], ["Legal Milestones", `/crm/legal-milestones?bookingId=${d.BookingId}`]] as [string, string][]).map(([label, to]) => (
                <button key={label} type="button" onClick={() => navigate(to)} className={cn(GRID_SHEET_KEYS.KEY_LINE, "h-7 px-2.5")}>{label} <ArrowRight size={11} /></button>
              ))}
            </div>
          </GridRelated>
        ))}
      </div>
    );
  };

  const alerts = insights?.alerts ?? {};
  const money = insights?.money;
  const registered = counts.Registered ?? 0;
  const open = allCount - registered - (counts.Cancelled ?? 0);

  return (
    <div className="space-y-4">
      <Breadcrumbs items={["Dashboard", "CRM", "Sale Deeds"]} />
      {detailId != null ? record() : (
        <>
          <MoneyBand eyebrow="CRM" title="Sale Deeds" sub="Conveyance deeds transferring legal ownership: paperwork, senior, customer and director approval, stamp duty, execution, then registry."
            actions={<>
              {rights.canCreate && <button type="button" onClick={() => setDialog("new")} className={BAND_KEY_MAIN}><Plus size={13} /> New Sale Deed</button>}
              <button type="button" onClick={() => refetch()} disabled={isFetching} className={cn(BAND_KEY, "w-9 !px-0")} title="Refresh" aria-label="Refresh"><RefreshCw size={13} className={isFetching ? "animate-spin" : ""} /></button>
            </>}
            lead={`${registered} of ${allCount - (counts.Cancelled ?? 0)}`} leadNote="deeds registered"
            bar={<CollectionBar onDark due={allCount - (counts.Cancelled ?? 0)} collected={registered} finance={counts.Executed ?? 0} recorded={0} />}
            figures={[
              { label: "In preparation", dot: BAND_DOT.notDue, value: String(open - (counts.Executed ?? 0)), note: "Paperwork to execution" },
              { label: "Executed, to register", dot: BAND_DOT.finance, value: String(counts.Executed ?? 0), note: "With the Sub-Registrar" },
              { label: "Overdue", dot: (counts.Overdue ?? 0) > 0 ? BAND_DOT.overdue : undefined, value: String(counts.Overdue ?? 0), note: "Past the registration deadline", alert: (counts.Overdue ?? 0) > 0 },
              { label: "Net payable to government", value: money ? fmtShort(money.netPayable) : "—", exact: money ? fmtRupees(money.netPayable) : undefined, note: "Stamp duty and fee, less AFS credit" },
            ]} />
          <div className={cn(GRID_CARD, "rounded-xl overflow-hidden")}>
            <GridTabs label="Sale Deeds" active={s.status} onChange={s.setStatus} tabs={[ALL, ...STATUSES].map((k) => ({ key: k, label: k === ALL ? "All sale deeds" : k, count: listResult ? (k === ALL ? allCount : counts[k] ?? 0) : null }))} />
            {DEED_ALERTS.some((a) => alerts[a.key]) && (
              <div className="px-3 py-2 flex flex-wrap items-center gap-2 border-b border-border bg-muted/30">
                <span className="text-xs font-semibold text-muted-foreground">Needs action</span>
                {DEED_ALERTS.filter((a) => alerts[a.key]).map((a) => (
                  <button key={a.key} type="button" onClick={() => setAlertKey(alertKey === a.key ? "" : a.key)} aria-pressed={alertKey === a.key}
                    className={cn("inline-flex items-center gap-1.5 rounded-full", alertKey === a.key && "ring-2 ring-primary/50")}>
                    <AlertPill tone={a.tone} label={`${a.label} · ${alerts[a.key]}`} />
                  </button>
                ))}
                {alertKey && <button type="button" onClick={() => setAlertKey("")} className="inline-flex items-center gap-1 text-xs text-primary hover:underline"><X size={12} /> Show all</button>}
              </div>
            )}
            <div className="px-3 py-2 flex flex-wrap items-center gap-2 border-b border-border">
              <GridSearch value={s.searchInput} onChange={s.setSearchInput} placeholder="Customer, deed or booking" />
              <CrmCompanyProjectBlockFilter value={s.cpb} onChange={s.setCpb} />
              <GridDateFilter label="Deed date" value={deedDates} onChange={setDeedDates} />
              {listFiltered && <button type="button" onClick={clearFilters} className={GRID_BTN}>Clear filters</button>}
              <button type="button" onClick={handleExport} disabled={exporting || !allCount} className={cn(GRID_BTN, "ml-auto")} title="Export to Excel"><Download size={13} /> <span className="hidden md:inline">{exporting ? "Exporting…" : "Export"}</span></button>
            </div>
            <CrmGrid cols={COLS} prefs={gridPrefs} onPrefs={setGridPrefs} rows={listResult?.rows ?? []} rowKey={(d: any) => d.Id} noRowNumbers
              loading={isLoading} fetching={isFetching} error={isError ? translateError((error as Error)?.message) : null} onRetry={() => refetch()}
              sort={s.sort} onSort={s.toggleSort} onRowClick={(d: any) => selectDetail(d.Id)}
              empty={listFiltered ? "No sale deed matches these filters." : "No sale deeds yet. One is made once a booking's agreement is registered."}
              page={s.page} pageSize={pageSize} total={listResult?.total ?? 0} onPage={s.setPage} onPageSize={(n) => { setPageSize(n); s.setPage(1); }} />
          </div>
        </>
      )}

      {dialog === "new" && (
        <GridDialog onClose={closeNew} icon={ScrollText} title="New Sale Deed" description="Needs the agreement registered and, for a loan, the loan cleared."
          footer={<><button onClick={closeNew} className={GRID_BTN}>Cancel</button><button onClick={handleCreate} disabled={saving || !canCreate} className={GRID_BTN_BRAND}>{saving ? "Creating…" : "Create Sale Deed"}</button></>}>
          <GridFormSection title="Booking">
            <GridFormField label="Booking" required wide hint={(eligible as any[]).length ? undefined : "No eligible bookings: the agreement must be registered first."}>
              <SearchableSelect value={form.BookingId} onChange={(v) => setForm((f) => ({ ...f, BookingId: v, DeedValue: "" }))} placeholder="Select booking" searchPlaceholder="Search booking, customer or unit…"
                options={(eligible as any[]).map((b: any) => ({ value: String(b.Id), label: [b.BookingNo, personName(b.ApplicantName), b.UnitNo].filter(Boolean).join(" · ") }))} />
            </GridFormField>
            {form.BookingId && (
              <div className="sm:col-span-2 rounded-md px-3 py-2.5 space-y-1.5 border border-border bg-muted/40 text-xs">
                {contextLoading ? <p className="text-muted-foreground">Checking eligibility…</p> : !context ? <p className="text-muted-foreground">Couldn't load booking details.</p> : (
                  <>
                    <p className="text-sm font-semibold"><ApplicantNames name={context.booking?.ApplicantName} bookingId={context.booking?.Id} applicationId={context.booking?.ApplicationId} /></p>
                    <p className="text-muted-foreground tabular-nums">{context.booking?.BookingNo} · {context.booking?.UnitNo} · {fmtRupees(context.booking?.GrandTotal)}</p>
                    <p className={cn("flex items-center gap-1.5", !agreementRegistered && "text-destructive")}>{agreementRegistered ? <CheckCircle2 size={12} /> : <XCircle size={12} />} Agreement {context.agreement ? `${context.agreement.AgreementNo}: ${context.agreement.Status}` : "not created yet"}</p>
                    {context.requiresHandoverBeforeDeed && (
                      <p className={cn("flex items-center gap-1.5", !handoverCleared && "text-destructive")}>{handoverCleared ? <CheckCircle2 size={12} /> : <XCircle size={12} />} Handover (under-construction project): {context.handoverStatus || "not started"}
                        {!handoverCleared && <button onClick={() => navigate(`/crm/possession?bookingId=${form.BookingId}`)} className="inline-flex items-center gap-1 underline underline-offset-2 ml-1">Go to Possession & Handover <ExternalLink size={10} /></button>}</p>
                    )}
                    {isLoanFinanced && (
                      <p className={cn("flex items-center gap-1.5", !loanCleared && "text-destructive")}>{loanCleared ? <CheckCircle2 size={12} /> : <XCircle size={12} />} Loan processing: {loanCleared ? "cleared" : context.loanBlockReason}
                        {!loanCleared && <button onClick={() => navigate(`/crm/loan-details?bookingId=${form.BookingId}`)} className="inline-flex items-center gap-1 underline underline-offset-2 ml-1">Go to loan tracking <ExternalLink size={10} /></button>}</p>
                    )}
                  </>
                )}
              </div>
            )}
          </GridFormSection>
          <GridFormSection title="Deed">
            {NEW_DEED_FIELDS.map(([lbl, key, type]) => (
              <GridFormField key={key} label={lbl}>
                {type === "date" ? <DateInput className={GRID_INPUT} value={form[key]} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))} />
                  : <input type="number" min="0" className={cn(GRID_INPUT, "tabular-nums")} value={form[key]} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))} />}
              </GridFormField>
            ))}
            <GridFormField label="Sub-Registrar office" wide hint={context?.agreement?.AfsStampDuty != null ? `AFS stamp duty ${fmtRupees(context.agreement.AfsStampDuty)} is pre-filled as credit: check it against the Sub-Registrar receipt before saving.` : undefined}>
              <input className={GRID_INPUT} value={form.SubRegistrarOffice} onChange={(e) => setForm((f) => ({ ...f, SubRegistrarOffice: e.target.value }))} />
            </GridFormField>
          </GridFormSection>
        </GridDialog>
      )}
      {dialog === "cancel" && detail && (
        <GridDialog onClose={() => setDialog(null)} icon={XCircle} width="max-w-xl" title="Cancel Sale Deed" description={`${detail.DeedNo} · ${personName(detail.ApplicantName)}`}
          footer={<><button onClick={() => setDialog(null)} className={GRID_BTN}>Keep It</button><button onClick={handleCancelDeed} disabled={saving} className={cn(GRID_SHEET_KEYS.KEY_RED, "h-9 px-3")}>{saving ? "Cancelling…" : "Cancel Deed"}</button></>}>
          <p className="text-sm">Cancel this sale deed? A new one can then be made for the booking.</p>
        </GridDialog>
      )}
      {dialog === "rework" && detail && (
        <GridDialog onClose={() => setDialog(null)} icon={ArrowLeft} width="max-w-xl" title="Send Back to Legal" description={`${detail.DeedNo} · ${personName(detail.ApplicantName)}`}
          footer={<><button onClick={() => setDialog(null)} className={GRID_BTN}>Keep It</button><button onClick={handleRework} disabled={saving || !reworkReason.trim()} className={cn(GRID_SHEET_KEYS.KEY_INK, "h-9 px-3")}>{saving ? "Sending…" : "Send Back"}</button></>}>
          <div className="space-y-3 text-sm">
            <p>The deed goes back to the legal executive to correct: a new version (the current figures are kept as a revision), the mandatory papers reworked, then senior, customer and director approval again. A stamp duty payment not yet confirmed starts again.</p>
            <GridFormField label="What must be corrected" required><textarea className={cn(GRID_INPUT, "min-h-[5rem]")} value={reworkReason} onChange={(e) => setReworkReason(e.target.value)} placeholder="e.g. Stamp duty and registration fee missing" /></GridFormField>
          </div>
        </GridDialog>
      )}
      {dialog === "proxyApprove" && <ProxyActionDialog title="Record Customer Approval" description="The customer reviewed and approved the sale deed without using the portal." confirmLabel="Record Approval" saving={proxySaving} onClose={() => setDialog(null)} onConfirm={(m, r) => handleProxy("proxy-customer-approve", m, r)} />}
      {dialog === "proxyRecheck" && <ProxyActionDialog title="Record Customer Recheck Request" description="The customer flagged an issue or asked for changes to the sale deed without using the portal." confirmLabel="Record Recheck Request" saving={proxySaving} onClose={() => setDialog(null)} onConfirm={(m, r) => handleProxy("proxy-customer-recheck", m, r)} />}
    </div>
  );
};

export default CrmSalesDeed;
