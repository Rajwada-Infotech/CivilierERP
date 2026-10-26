import { CrmStatus } from "@/constants/crmStatuses";
import { fmtIstIso } from "@/lib/istTime";
import React, { useEffect, useRef, useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { usePageRights } from "@/hooks/usePageRights";
import { useAuth } from "@/contexts/AuthContext";
import { translateError } from "@/lib/translateError";
import { ApplicantNames } from "@/components/crm/ApplicantNames";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import {
  Plus, CheckCircle2, XCircle, ExternalLink, Lock, Pencil, ScrollText, UserCircle2,
  FileText, Upload, Send, AlertCircle, Info, ArrowRight, ShieldAlert, RefreshCw, History,
} from "lucide-react";
import { ProxyActionDialog, type ProxyMethod } from "@/components/crm/ProxyActionDialog";
import { Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ApprovalActions } from "@/components/ApprovalActions";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { CrmCompanyProjectBlockFilter, type CrmCompanyProjectBlockValue } from "@/components/crm/CrmCompanyProjectBlockFilter";
import { CrmPaginationBar } from "@/components/crm/CrmPaginationBar";
import { DateInput } from "@/components/ui/date-input";
import { SearchableNativeSelect } from "@/components/SearchableNativeSelect";
import { useSearchAsYouType } from "@/hooks/useSearchAsYouType";
import { SheetShell, SheetMark } from "@/components/sheet/Sheet";
import { fmtRupees } from "@/components/crm/FinancialStatusBar";
import { INP, KEY_INK, KEY_LINE, LBL, RULE, RULE_SOFT } from "./customers/config";
import { TlRow } from "./agreement/Timeline";
import {
  API, DEED_TABS, DeedTab, EMPTY_FORM, PAGE_SIZE, DeedListFilters, CRM_REGISTRY_APPROVER_ROLES, LOG_ACTION_LABEL,
  deedTone, roleKey, fmtDate, deedDocumentProgress, deedStepStates, downloadFile, fetchBookingContext, fetchDeedsList,
  fetchEligible, fetchFileBlob, fetchLegalExecutives,
} from "./salesDeed/config";
import { DeedDetailsSection, DeedStepper, DocRow, Panel, StepBox } from "./salesDeed/parts";
import { QueryPaymentTab, useDeedQueryPayment } from "./salesDeed/QueryPaymentTab";
import { RegistryTab, useDeedRegistry } from "./salesDeed/RegistryTab";

const CrmSalesDeed: React.FC = () => {
  const rights = usePageRights("crm-sales-deed");
  // Query Payment and Registry were their own pages; either their own right or the deed's works their tabs.
  const qpRights = usePageRights("crm-query-payment");
  const regRights = usePageRights("crm-registry");
  const { currentUser, canDoAction } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const deepLinkBookingId = sp.get("bookingId");
  const deedIdParam = sp.get("deedId");
  const tabDeepLink = sp.get("tab");
  const [deepLinkDone, setDeepLinkDone] = useState(false);

  const [searchInput, setSearchInput] = useState("");
  useSearchAsYouType(searchInput, (v) => updateFilter(setSearch)(v));
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [cpb, setCpb] = useState<CrmCompanyProjectBlockValue>({ companyId: "", projectId: "", blockId: "" });
  const [page, setPage] = useState(1);
  function updateFilter<T>(setter: (v: T) => void) {
    return (v: T) => { setter(v); setPage(1); };
  }

  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [stepSaving, setStepSaving] = useState(false);
  const [deedDetailSaving, setDeedDetailSaving] = useState(false);

  const [detailId, setDetailId] = useState<number | null>(deedIdParam && /^\d+$/.test(deedIdParam) ? Number(deedIdParam) : null);
  const [sendingToCustomer, setSendingToCustomer] = useState(false);
  const [proxyApproveDialog, setProxyApproveDialog] = useState(false);
  const [proxyRecheckDialog, setProxyRecheckDialog] = useState(false);
  const [proxySaving, setProxySaving] = useState(false);

  const [execForm, setExecForm] = useState({ ExecutedBy: "", RegistrationNo: "", BookNo: "", PartNo: "", RegistrationDate: "", PossessionDate: "" });
  const [execSaving, setExecSaving] = useState(false);
  const [execEditing, setExecEditing] = useState(false);

  const [activeTab, setActiveTab] = useState<DeedTab>("Timeline");
  const [assigningLegal, setAssigningLegal] = useState(false);
  const [selectedLegalExec, setSelectedLegalExec] = useState("");
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const [newDocType, setNewDocType] = useState("ExecutedDeed");
  const [newDocLabel, setNewDocLabel] = useState("");
  const [requestingDoc, setRequestingDoc] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Documents open in an in-page preview (image / PDF) fetched with the page's auth; a bare window.open can't carry
  // the bearer token.
  const [previewDoc, setPreviewDoc] = useState<{ url: string; mime: string; name: string } | null>(null);
  const [previewLoading, setPreviewLoading] = useState<number | null>(null);
  const handlePreview = async (url: string, doc: any) => {
    setPreviewLoading(doc.Id);
    try {
      const blob = await fetchFileBlob(url);
      setPreviewDoc({ url: URL.createObjectURL(blob), mime: doc.MimeType, name: doc.FileName || doc.DocumentType });
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setPreviewLoading(null); }
  };
  const closePreview = () => {
    if (previewDoc) URL.revokeObjectURL(previewDoc.url);
    setPreviewDoc(null);
  };
  const deedFileUrl = (doc: any) => `${API}/documents/file/${doc.Id}`;

  const listFilters: DeedListFilters = useMemo(
    () => ({ search, status: statusFilter, companyId: cpb.companyId, projectId: cpb.projectId, blockId: cpb.blockId }),
    [search, statusFilter, cpb]
  );
  const { data: listResult, isLoading, isError, error, isFetching, refetch } = useQuery({
    queryKey: ["crm-sales-deed", listFilters, page], queryFn: () => fetchDeedsList(listFilters, page), staleTime: 30_000,
  });
  const deeds = listResult?.rows ?? [];
  const total = listResult?.total ?? 0;
  const counts = listResult?.statusCounts ?? {};
  const allCount = Object.values(counts).reduce((s, n) => s + n, 0);
  const { data: eligible = [] } = useQuery({
    queryKey: ["crm-sales-deed-eligible"], queryFn: fetchEligible, staleTime: 60_000, enabled: rights.canCreate,
  });
  const { data: context, isFetching: contextLoading } = useQuery({
    queryKey: ["crm-sales-deed-context", form.BookingId],
    queryFn: () => fetchBookingContext(form.BookingId),
    enabled: !!form.BookingId,
  });

  const { data: deedDetail, isError: detailIsError, error: detailError } = useQuery({
    queryKey: ["crm-sale-deed-detail", detailId],
    queryFn: async () => {
      const r = await fetchWithAuth(`${API}/${detailId}`);
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data?.error || `Could not load the sale deed (${r.status}).`);
      return data;
    },
    enabled: detailId != null,
    staleTime: 15_000,
    retry: false,
  });
  const { data: users = [] } = useQuery({ queryKey: ["crm-legal-executives"], queryFn: fetchLegalExecutives, staleTime: 300_000 });

  const detail = deedDetail?.deed ?? (detailId != null ? (deeds as any[]).find((d: any) => d.Id === detailId) : null);

  const { data: detailContext } = useQuery({
    queryKey: ["crm-sales-deed-context", detail ? String(detail.BookingId) : ""],
    queryFn: () => fetchBookingContext(String(detail?.BookingId ?? "")),
    enabled: detail?.BookingId != null,
  });
  const { data: qpDetail } = useDeedQueryPayment(detail?.BookingId);
  const { registry, history: registryHistory } = useDeedRegistry(detail?.BookingId);

  const role = roleKey(currentUser?.role);
  const legalOrInbox = CRM_REGISTRY_APPROVER_ROLES.includes(role) || canDoAction("approval-inbox" as any, "edit");
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
  const progressLocked = detail?.Status === CrmStatus.REGISTERED || detail?.Status === CrmStatus.CANCELLED;
  // Every change to the deed needs the edit right (the server refuses otherwise; most keys used to show to anyone).
  const canWork = rights.canEdit && !bookingCancelled;

  // Mirrors the server's requireAssignedLegalOrApprover: the deed's documents are worked by its assigned Legal
  // Executive (or Legal / admin), not anyone with page rights.
  const canActAsLegal = !detail?.LegalExecutiveId
    ? false
    : CRM_REGISTRY_APPROVER_ROLES.includes(role) || String(detail.LegalExecutiveId) === String(currentUser?.id ?? "");
  const legalLockReason = !detail?.LegalExecutiveId
    ? "Assign a Legal Executive to this deed first"
    : "Locked to the assigned Legal Executive (or Legal/admin)";

  // Deep links: ?deedId opens that deed; ?bookingId opens the booking's deed (found on the server: the page used to
  // look for it in the 20 rows on screen) or, when it has none and is eligible, the New deed dialog.
  useEffect(() => {
    if (deepLinkDone || !deepLinkBookingId || deedIdParam) return;
    let stop = false;
    (async () => {
      const r = await fetchWithAuth(`${API}/booking/${deepLinkBookingId}/deed`).catch(() => null);
      const row = r?.ok ? await r.json().catch(() => null) : null;
      if (stop) return;
      if (row?.Id) { setDeepLinkDone(true); selectDetail(row.Id, true); return; }
      if (rights.canCreate && (eligible as any[]).some((b: any) => String(b.Id) === deepLinkBookingId)) {
        setDeepLinkDone(true);
        setForm((f) => ({ ...f, BookingId: deepLinkBookingId }));
        setDialogOpen(true);
      }
    })();
    return () => { stop = true; };
  }, [deepLinkBookingId, deedIdParam, deepLinkDone, eligible.length, rights.canCreate]);

  useEffect(() => {
    if (tabDeepLink && detailId != null && (DEED_TABS as readonly string[]).includes(tabDeepLink)) setActiveTab(tabDeepLink as DeedTab);
  }, [tabDeepLink, detailId]);

  useEffect(() => {
    if (!context?.agreement) return;
    const credit = Number(context.agreement.AfsStampDuty ?? 0) || 0;
    if (credit > 0) setForm((f) => ({ ...f, StampDutyCredit: f.StampDutyCredit === "" ? String(credit) : f.StampDutyCredit }));
  }, [context?.agreement?.AfsStampDuty]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["crm-sales-deed"] });
    qc.invalidateQueries({ queryKey: ["crm-sales-deed-eligible"] });
    qc.invalidateQueries({ queryKey: ["crm-sales-deed-context"] });
    qc.invalidateQueries({ queryKey: ["crm-booking-lifecycle"] });
    qc.invalidateQueries({ queryKey: ["crm-legal-milestones"] });
    qc.invalidateQueries({ queryKey: ["crm-dashboard"] });
    if (detailId != null) qc.invalidateQueries({ queryKey: ["crm-sale-deed-detail", detailId] });
  };
  const invalidateDetail = () => qc.invalidateQueries({ queryKey: ["crm-sale-deed-detail", detailId] });

  const send = async (url: string, method: string, body?: any) => {
    const res = await fetchWithAuth(url, body instanceof FormData ? { method, body } : {
      method, headers: { "Content-Type": "application/json" }, body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  };

  const handleCreate = async () => {
    if (!form.BookingId) { toast.error("Booking is required"); return; }
    if (!canCreate) { toast.error("This booking isn't eligible yet"); return; }
    setSaving(true);
    try {
      const data = await send(API, "POST", { ...form, BookingId: parseInt(form.BookingId) });
      toast.success(`Sale deed ${data.DeedNo} created`);
      setDialogOpen(false);
      setForm({ ...EMPTY_FORM });
      invalidate();
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setSaving(false); }
  };

  const selectDetail = (id: number, keepTab = false) => {
    setExecEditing(false);
    setSelectedLegalExec("");
    setDetailId(id);
    setSp((p) => { p.set("deedId", String(id)); return p; }, { replace: true });
    if (!keepTab) setActiveTab("Timeline");
  };

  const startExec = () => {
    setExecForm({
      ExecutedBy: detail?.ExecutedBy || "", RegistrationNo: detail?.RegistrationNo || "",
      BookNo: detail?.BookNo || "", PartNo: detail?.PartNo || "",
      RegistrationDate: detail?.RegistrationDate ? String(detail.RegistrationDate).slice(0, 10) : "",
      PossessionDate: detail?.PossessionDate ? String(detail.PossessionDate).slice(0, 10) : "",
    });
    setExecEditing(true);
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
      setProxyApproveDialog(false); setProxyRecheckDialog(false);
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
  const handleAttachDoc = async (docId: number, file: File) => {
    try {
      const fd = new FormData(); fd.append("file", file);
      await send(`${API}/${detailId}/documents/${docId}/attach`, "POST", fd);
      toast.success("File attached");
      invalidateDetail();
    } catch (e: any) { toast.error(translateError(e.message)); }
  };
  const handleUploadDoc = async (file: File, documentType: string, label?: string) => {
    setUploadingDoc(true);
    try {
      const fd = new FormData(); fd.append("files", file); fd.append("DocumentType", documentType);
      if (label) fd.append("Label", label);
      await send(`${API}/${detailId}/documents/upload`, "POST", fd);
      toast.success("Document uploaded");
      invalidateDetail();
      setNewDocLabel("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setUploadingDoc(false); }
  };
  // Asks for a mandatory document: the way out when the deed has none to approve on.
  const handleRequestDoc = async (documentType: string, label?: string) => {
    setRequestingDoc(true);
    try {
      await send(`${API}/${detailId}/documents/request`, "POST", { DocumentType: documentType, Label: label, IsMandatory: true });
      toast.success("Mandatory document requested");
      invalidateDetail();
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setRequestingDoc(false); }
  };
  const handleResubmit = async () => {
    try { await send(`${API}/${detailId}/submit`, "PUT"); toast.success("Submitted for senior approval"); invalidate(); }
    catch (e: any) { toast.error(translateError(e.message)); }
  };
  // Rejecting needs remarks describing the mismatch.
  const handleReviewDoc = async (docId: number, verify: boolean) => {
    let remarks: string | undefined;
    if (!verify) {
      remarks = window.prompt("Describe what's wrong with this document (required):")?.trim();
      if (!remarks) return;
    }
    try {
      await send(`${API}/${detailId}/documents/${docId}`, "PUT", verify ? { Status: "Verified" } : { Status: "Rejected", Remarks: remarks });
      toast.success(verify ? "Document verified" : "Document rejected");
      invalidateDetail();
    } catch (e: any) { toast.error(translateError(e.message)); }
  };
  const handleCancelDeed = async () => {
    if (!window.confirm(`Cancel sale deed ${detail?.DeedNo}?`)) return;
    try { await send(`${API}/${detailId}/cancel`, "PUT"); toast.success("Sale deed cancelled"); invalidate(); }
    catch (e: any) { toast.error(translateError(e.message)); }
  };

  const figures = [
    { label: "Sale deeds", value: allCount, note: `${counts.Cancelled ?? 0} cancelled`, go: () => updateFilter(setStatusFilter)("") },
    { label: "Draft", value: counts.Draft ?? 0, note: "Being prepared and approved", go: () => updateFilter(setStatusFilter)("Draft") },
    { label: "Executed", value: counts.Executed ?? 0, note: "To be registered", go: () => updateFilter(setStatusFilter)("Executed") },
    { label: "Registered", value: counts.Registered ?? 0, note: `${counts.Overdue ?? 0} overdue`, go: () => updateFilter(setStatusFilter)("Registered") },
  ];

  return (
    <>
      <Breadcrumbs items={["Dashboard", "CRM", "Sale Deeds"]} />
      <SheetShell
        eyebrow="CivilierERP · CRM · Sale deed"
        title="Sale Deeds"
        subtitle="Conveyance deeds transferring legal ownership (s.54 TPA 1882): legal paperwork, senior, customer and director approval, stamp duty, execution, then registry."
        action={
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button onClick={() => refetch()} disabled={isFetching} className={`${KEY_LINE} h-9 w-9`} title="Refresh"><RefreshCw size={13} className={isFetching ? "animate-spin" : ""} /></button>
            {rights.canCreate && <button onClick={() => setDialogOpen(true)} className={`${KEY_INK} h-9 px-4`}><Plus size={13} /> New deed</button>}
          </div>
        }
      >
      <div className="space-y-4">
        <div className="bg-card" style={{ border: RULE }}>
          <div className="statrow four" style={{ padding: "16px 16px 18px" }}>
            {figures.map((x) => (
              <div key={x.label}>
                <button onClick={x.go} className="label link">{x.label}</button>
                <p className="figure" style={{ fontSize: "clamp(18px, 2vw, 26px)", marginTop: 9 }}>{isLoading ? "…" : x.value}</p>
                <p style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }}>{x.note}</p>
              </div>
            ))}
          </div>
        </div>

      <div className="flex flex-col md:flex-row gap-4 md:h-[calc(100vh-220px)]">
        {/* List */}
        <div className="w-full md:w-80 shrink-0 flex flex-col bg-card min-h-0" style={{ border: RULE }}>
          <div className="p-3 space-y-2" style={{ borderBottom: RULE }}>
            <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") updateFilter(setSearch)(searchInput); }}
              placeholder="Search customer, deed or booking…"
              className="h-9 w-full border border-foreground/40 focus:border-foreground bg-card px-3 text-xs text-foreground outline-none" />
            <select value={statusFilter} onChange={(e) => updateFilter(setStatusFilter)(e.target.value)} className={`${INP} text-xs`}>
              <option value="">All statuses ({allCount})</option>
              {["Draft", "Executed", "Registered", "Overdue", "Cancelled"].map((s) => <option key={s} value={s}>{s} ({counts[s] ?? 0})</option>)}
            </select>
            <CrmCompanyProjectBlockFilter stacked value={cpb} onChange={updateFilter(setCpb)} />
          </div>
          <div className="flex-1 overflow-y-auto thin-scroll max-h-[45vh] md:max-h-none">
            {isError ? (
              <p className="p-4 text-center text-sm text-destructive">{(error as Error)?.message}</p>
            ) : isLoading ? (
              <p className="p-4 text-center text-muted-foreground text-sm">Loading…</p>
            ) : deeds.length === 0 ? (
              <p className="p-4 text-center text-muted-foreground text-sm">{search || statusFilter || cpb.projectId ? "No deed matches." : "No sale deeds yet."}</p>
            ) : (deeds as any[]).map((d: any) => {
              const on = detailId === d.Id;
              return (
                <button key={d.Id} onClick={() => selectDetail(d.Id)}
                  className={`w-full text-left px-3 py-2.5 transition-colors ${on ? "bg-foreground text-card" : "hover:bg-primary/5"}`}
                  style={{ borderBottom: RULE_SOFT }}>
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-semibold leading-tight truncate"><ApplicantNames name={d.ApplicantName} bookingId={d.BookingId} applicationId={d.ApplicationId} /></span>
                    <span className={on ? "[&_*]:!text-card" : ""}><SheetMark text={d.Status} tone={deedTone(d.Status)} /></span>
                  </div>
                  <div className={`mt-1 text-[0.6875rem] tabular-nums truncate ${on ? "opacity-80" : "text-muted-foreground"}`}>
                    {[d.DeedNo, d.BookingNo, d.UnitNo].filter(Boolean).join(" · ")}{d.RegistrationNo ? ` · Reg ${d.RegistrationNo}` : ""}
                  </div>
                  <div className={`mt-0.5 text-[0.6875rem] truncate ${on ? "opacity-80" : ""}`}>
                    {d.BookingStatus === "Cancelled" ? <span className="text-destructive font-semibold">Booking cancelled: locked</span>
                      : d.LegalExecutiveName ? <span>{d.LegalExecutiveName}</span> : <span className="font-semibold">No legal executive</span>}
                  </div>
                </button>
              );
            })}
          </div>
          <div style={{ borderTop: RULE_SOFT }}><CrmPaginationBar page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} /></div>
        </div>

        {/* Detail */}
        <div className="flex-1 min-w-0 overflow-y-auto thin-scroll space-y-4">
          {detailId == null ? (
            <div className="h-full flex items-center justify-center text-muted-foreground text-sm">Select a deed to view details</div>
          ) : detailIsError && !detail ? (
            <div className="h-full flex items-center justify-center text-destructive text-sm">{(detailError as Error)?.message}</div>
          ) : !detail ? (
            <div className="h-full flex items-center justify-center text-muted-foreground text-sm">Loading…</div>
          ) : (
            <>
              {detail.Status !== "Cancelled" && (
                <div className="bg-card p-4 space-y-3" style={{ border: RULE }}>
                  <DeedStepper steps={deedStepStates(detail, deedDetail?.documents, detailContext)} activeTab={activeTab} onStepClick={setActiveTab} />
                  {(() => {
                    const d = detail;
                    const pendingDocs = deedDetail?.documents?.filter((doc: any) => doc.IsMandatory && doc.Status !== "Verified") || [];
                    type BannerVariant = "error" | "warning" | "info" | "success" | "action";
                    let variant: BannerVariant = "info";
                    let text = "";
                    let subtext = "";
                    let cta: { label: string; onClick: () => void } | null = null;
                    if (bookingCancelled) {
                      variant = "error";
                      text = `Booking is ${d.BookingStatus || "inactive"} — this deed is locked.`;
                      subtext = "Cancel the deed to formally close it out.";
                    } else if (d.Status === "Registered") {
                      variant = "success";
                      text = "Deed fully complete — Registered at Sub-Registrar.";
                    } else if (d.Status === "Executed") {
                      text = "Deed executed.";
                      subtext = "Complete the registry (Registry tab) to record the Registration No.";
                    } else if (!d.LegalExecutiveId) {
                      variant = "warning";
                      text = "No Legal Executive assigned.";
                      subtext = "Assign someone responsible for preparing the paperwork — required before execution.";
                    } else if (d.SeniorApprovalStatus !== "Approved") {
                      variant = "warning";
                      text = "Awaiting senior approval.";
                      subtext = "Upload all mandatory docs via the Documents tab, then submit for senior approval.";
                    } else if (!d.SentToCustomerAt) {
                      variant = "action";
                      text = "Senior-approved — ready to share with the customer.";
                      cta = { label: "Send to customer portal", onClick: handleSendToCustomer };
                    } else if (d.CustomerApprovalStatus === "RecheckRequested") {
                      variant = "error";
                      text = "Customer requested a recheck.";
                      subtext = d.CustomerRecheckRemarks ? `"${d.CustomerRecheckRemarks}"` : "Address the issue and resend.";
                      cta = { label: "Resend after recheck", onClick: handleSendToCustomer };
                    } else if (d.CustomerApprovalStatus !== "Approved") {
                      text = "Sent to customer — awaiting their review and approval.";
                      subtext = d.SentToCustomerAt ? `Sent ${fmtDate(d.SentToCustomerAt)}` : "";
                    } else if (d.DirectorApprovalStatus && d.DirectorApprovalStatus !== "NotRequired" && d.DirectorApprovalStatus !== "Approved") {
                      variant = "warning";
                      text = "Customer approved — awaiting the Director's internal sign-off.";
                    } else if (detailContext?.queryPaymentStatus !== "Confirmed") {
                      variant = "warning";
                      text = "Awaiting stamp duty payment confirmation.";
                      subtext = "Confirm the customer's government payment on the Query Payment tab.";
                    } else if (pendingDocs.length) {
                      variant = "warning";
                      text = `${pendingDocs.length} mandatory document${pendingDocs.length > 1 ? "s" : ""} still need verification.`;
                      subtext = pendingDocs.map((doc: any) => doc.Label || doc.DocumentType).join(", ");
                    } else {
                      variant = "action";
                      text = "All checks passed — ready to mark this deed executed.";
                      cta = { label: "Mark executed", onClick: () => { setActiveTab("Legal & Approval"); startExec(); } };
                    }
                    const edge = variant === "error" ? "hsl(var(--destructive))" : variant === "action" ? "hsl(var(--foreground))" : "hsl(var(--foreground) / 0.3)";
                    const icon = variant === "error" || variant === "warning" ? <AlertCircle size={15} className={`shrink-0 mt-0.5 ${variant === "error" ? "text-destructive" : ""}`} />
                      : variant === "success" ? <CheckCircle2 size={15} className="shrink-0 mt-0.5" /> : variant === "action" ? <ArrowRight size={15} className="shrink-0 mt-0.5" /> : <Info size={15} className="shrink-0 mt-0.5" />;
                    return (
                      <div className="flex items-start justify-between gap-3 flex-wrap px-4 py-3 bg-card" style={{ border: RULE_SOFT, borderLeft: `3px solid ${edge}` }}>
                        <div className="flex items-start gap-2.5">
                          {icon}
                          <div>
                            <p className={`text-sm font-semibold leading-snug ${variant === "error" ? "text-destructive" : "text-foreground"}`}>{text}</p>
                            {subtext && <p className="text-xs mt-0.5 text-muted-foreground">{subtext}</p>}
                          </div>
                        </div>
                        {cta && canWork && <button onClick={cta.onClick} disabled={sendingToCustomer} className={`${KEY_INK} h-9 px-4 shrink-0`}>{cta.label}</button>}
                      </div>
                    );
                  })()}
                </div>
              )}

              <div className="bg-card" style={{ border: RULE }}>
                <div className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <span className={`block ${LBL}`}>Sale deed</span>
                    <h2 className="font-heading font-bold text-lg text-foreground leading-tight truncate flex items-center gap-2">
                      <ScrollText size={16} /> <ApplicantNames name={detail.ApplicantName} bookingId={detail.BookingId} applicationId={detail.ApplicationId} />
                    </h2>
                    <p className="text-[0.6875rem] text-muted-foreground mt-0.5 tabular-nums">
                      {detail.DeedNo}
                      {detail.VersionNo > 1 && <span className="ml-1.5 font-semibold text-foreground">· version {detail.VersionNo}</span>}
                      <span className="ml-1.5">· {detail.BookingNo} · {detail.UnitNo}</span>
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <SheetMark text={detail.Status} tone={deedTone(detail.Status)} />
                    {bookingCancelled && (
                      <span title="Booking cancelled — edit / send / mark actions are locked." className="text-xs font-semibold text-destructive cursor-help">⚠ Booking cancelled</span>
                    )}
                    {canWork && detail.Status !== "Cancelled" && !detail.SentToCustomerAt && (
                      <button onClick={() => setActiveTab("Overview")} className={`${KEY_LINE} h-8 px-2.5`}>Edit details</button>
                    )}
                    {rights.canEdit && detail.Status !== "Registered" && detail.Status !== "Cancelled" && (
                      <button onClick={handleCancelDeed} className={`${KEY_LINE} h-8 px-2.5 !text-destructive !border-destructive`}>Cancel deed</button>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-stretch overflow-x-auto thin-scroll bg-card" style={{ border: RULE }}>
                {DEED_TABS.map((t) => (
                  <button key={t} onClick={() => setActiveTab(t)}
                    className={`px-4 h-10 font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] whitespace-nowrap shrink-0 transition-colors ${
                      activeTab === t ? "bg-foreground text-card" : "text-muted-foreground hover:text-foreground hover:bg-primary/5"
                    }`} style={{ borderRight: RULE_SOFT }}>
                    {t}
                  </button>
                ))}
              </div>

              {activeTab === "Timeline" && (() => {
                const steps = deedStepStates(detail, deedDetail?.documents, detailContext);
                const docs = deedDocumentProgress(deedDetail?.documents);
                const badges: (string | undefined)[] = [
                  detail.Status, undefined, docs.required > 0 ? `${docs.percent}%` : undefined,
                  detail.SeniorApprovalStatus, detail.CustomerApprovalStatus, detail.DirectorApprovalStatus,
                  qpDetail?.Status, undefined, registry?.Status,
                ];
                return (
                  <Panel title="Workflow timeline" icon={<ScrollText size={13} />}>
                    <div className="p-4">
                      {steps.map((s, i) => (
                        <TlRow key={s.label} n={i + 1} title={s.label} state={s.state}
                          badge={badges[i] || undefined} onJump={() => setActiveTab(s.tab)} last={i === steps.length - 1} />
                      ))}
                    </div>
                  </Panel>
                );
              })()}

              {activeTab === "Overview" && (
                <div className="space-y-4">
                  <div className="bg-card" style={{ border: RULE }}>
                    <div className="grid grid-cols-1 sm:grid-cols-3" style={{ borderBottom: RULE_SOFT }}>
                      <div className="px-4 py-3" style={{ borderRight: RULE_SOFT }}>
                        <p className={LBL}>Booking</p>
                        <p className="text-sm font-semibold tabular-nums mt-0.5">{detail.BookingNo}</p>
                        <p className="text-[0.6875rem] text-muted-foreground">{detail.UnitNo}</p>
                      </div>
                      <div className="px-4 py-3" style={{ borderRight: RULE_SOFT }}>
                        <p className={LBL}>Applicant</p>
                        <p className="text-sm font-semibold truncate mt-0.5">{detail.ApplicantName || "—"}</p>
                      </div>
                      <div className="px-4 py-3">
                        <p className={LBL}>Deed date</p>
                        {detail.DeedDate ? <p className="text-sm font-heading font-bold tabular-nums mt-0.5">{fmtDate(detail.DeedDate)}</p>
                          : <p className="text-sm text-muted-foreground/60 italic mt-0.5">Not set</p>}
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3" style={{ borderBottom: RULE_SOFT }}>
                      {([["Deed value", detail.DeedValue, true], ["Stamp duty", detail.StampDuty, false], ["Registration fee", detail.RegistrationFee, false]] as [string, any, boolean][]).map(([l, v, strong], i) => (
                        <div key={l} className="px-4 py-3" style={i < 2 ? { borderRight: RULE_SOFT } : undefined}>
                          <p className={LBL}>{l}</p>
                          <p className={`text-sm font-heading tabular-nums mt-0.5 ${strong ? "font-bold" : "font-semibold"}`}>{v ? fmtRupees(v) : "—"}</p>
                        </div>
                      ))}
                    </div>
                    <div className="px-4 py-3">
                      <p className={LBL}>Sub-Registrar office</p>
                      <p className="text-sm font-medium mt-0.5">{detail.SubRegistrarOffice || "—"}</p>
                    </div>
                  </div>
                  <DeedDetailsSection key={`${detail.Id}-${detail.UpdatedAt ?? ""}`} detail={detail} onSave={handleSaveDeedDetails} saving={deedDetailSaving} canEdit={canWork && !progressLocked} />
                </div>
              )}

              {activeTab === "Legal & Approval" && (
                <div className="space-y-4">
                  <Panel title="Legal executive" icon={<UserCircle2 size={13} />}
                    right={<SheetMark text={detail.LegalExecutiveId ? "Assigned" : "Unassigned"} tone={detail.LegalExecutiveId ? "done" : "waiting"} />}>
                    <div className="px-4 py-3 space-y-2">
                      <p className="text-xs text-muted-foreground">The person responsible for preparing this deed's paperwork. Required before execution.</p>
                      {detail.LegalExecutiveId && !selectedLegalExec ? (
                        <div className="flex items-center gap-2">
                          <div className="flex items-center gap-2 flex-1 px-3 h-9" style={{ border: RULE_SOFT }}>
                            <UserCircle2 size={14} className="shrink-0" />
                            <span className="text-sm font-medium">{detail.LegalExecutiveName}</span>
                            <Lock size={11} className="text-muted-foreground ml-auto shrink-0" />
                          </div>
                          {canWork && !progressLocked && (
                            <button onClick={() => setSelectedLegalExec(String(detail.LegalExecutiveId))} className={`${KEY_LINE} h-9 px-3 shrink-0`}>Change</button>
                          )}
                        </div>
                      ) : progressLocked || !canWork ? (
                        <div className="font-medium text-sm">{detail.LegalExecutiveName || <span className="text-muted-foreground">Unassigned</span>}</div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <SearchableNativeSelect value={selectedLegalExec} disabled={assigningLegal}
                            onChange={(e) => setSelectedLegalExec(e.target.value)} className={`${INP} flex-1`}>
                            <option value="">— Unassigned —</option>
                            {users.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
                          </SearchableNativeSelect>
                          <button onClick={() => handleAssignLegal(selectedLegalExec)}
                            disabled={!selectedLegalExec || assigningLegal || selectedLegalExec === String(detail.LegalExecutiveId ?? "")}
                            className={`${KEY_INK} h-9 px-3`}>
                            {assigningLegal ? "Assigning…" : "Assign"}
                          </button>
                          {detail.LegalExecutiveId && (
                            <button onClick={() => setSelectedLegalExec("")} className={`${KEY_LINE} h-9 px-3 shrink-0`}>Cancel</button>
                          )}
                        </div>
                      )}
                      {!detail.LegalExecutiveId && !progressLocked && canWork && (
                        <p className="text-xs text-muted-foreground">Assign someone now so they're notified and can start preparing the paperwork.</p>
                      )}
                    </div>
                  </Panel>

                  <Panel title="Approval timeline" icon={<ShieldAlert size={13} />}>
                    {/* Step 1 — Senior review. A deed never submitted (status NULL) is not the same as one awaiting a
                        decision: it gets its own Submit key instead of Approve / Reject (which the server refuses). */}
                    {(() => {
                      const status = detail.SeniorApprovalStatus;
                      const done = status === "Approved";
                      const rejected = status === "Rejected";
                      const notSubmitted = status == null;
                      const docs = deedDocumentProgress(deedDetail?.documents);
                      const docsReady = docs.required > 0 && docs.percent === 100;
                      return (
                        <div className="px-4 py-4 flex items-start gap-3" style={{ borderBottom: RULE_SOFT }}>
                          <StepBox n={1} done={done} active={status === "Pending"} stopped={rejected} />
                          <div className="flex-1 min-w-0 space-y-1.5">
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <span className="font-heading text-[0.75rem] font-bold uppercase tracking-[0.1em]">Senior review</span>
                              <SheetMark text={notSubmitted ? "Not submitted" : status} tone={notSubmitted ? "waiting" : deedTone(status)} />
                            </div>
                            <p className="text-xs text-muted-foreground">An admin or super-admin approves this deed before it's shared with the customer.</p>
                            {done && detail.SeniorApprovedAt && (
                              <p className="text-xs flex items-center gap-1 tabular-nums"><CheckCircle2 size={11} /> Approved {fmtDate(detail.SeniorApprovedAt)}
                                {detail.SeniorApprovalRemarks && <span className="text-muted-foreground ml-1">· {detail.SeniorApprovalRemarks}</span>}</p>
                            )}
                            {rejected && detail.SeniorApprovalRemarks && (
                              <p className="text-xs text-destructive px-2 py-1.5" style={{ border: "1px solid hsl(var(--destructive) / 0.4)" }}><strong>Rejection reason:</strong> {detail.SeniorApprovalRemarks}</p>
                            )}
                            {notSubmitted && canWork && (
                              <div className="pt-0.5">
                                <button onClick={handleResubmit} disabled={!docsReady || !canActAsLegal}
                                  title={!canActAsLegal ? legalLockReason : !docsReady ? `${docs.uploaded}/${docs.required} mandatory documents verified — all must be verified first` : undefined}
                                  className={`${KEY_INK} h-8 px-3`}>
                                  Submit for senior approval
                                </button>
                                {!docsReady && (
                                  <p className="text-xs text-muted-foreground mt-1 tabular-nums">
                                    {docs.required === 0 ? "Request a mandatory document from the Documents tab first." : `${docs.uploaded}/${docs.required} mandatory documents verified.`}
                                  </p>
                                )}
                              </div>
                            )}
                            {status === "Pending" && !bookingCancelled && (
                              <div className="flex items-center gap-2 flex-wrap pt-0.5">
                                <ApprovalActions status={status} recordId={detail.Id} endpoint={API} actionPathSuffix=""
                                  approverRoles={["admin", "dba", "super_admin"]} submitOnly={false} onSuccess={invalidate} />
                              </div>
                            )}
                            {rejected && canWork && (
                              <button onClick={handleResubmit} className={`${KEY_INK} h-8 px-3 mt-1`}>Resubmit for approval</button>
                            )}
                          </div>
                        </div>
                      );
                    })()}

                    {/* Step 2 — Shared with customer */}
                    {(() => {
                      const sent = !!detail.SentToCustomerAt;
                      const seniorApproved = detail.SeniorApprovalStatus === "Approved";
                      return (
                        <div className="px-4 py-4 flex items-start gap-3" style={{ borderBottom: RULE_SOFT }}>
                          <StepBox n={2} done={sent} active={seniorApproved} />
                          <div className="flex-1 min-w-0 space-y-1.5">
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <span className="font-heading text-[0.75rem] font-bold uppercase tracking-[0.1em]">Shared with customer</span>
                              <SheetMark text={sent ? "Sent" : "Not sent"} tone={sent ? "done" : "waiting"} />
                            </div>
                            <p className="text-xs text-muted-foreground">The customer can view this deed in their portal and approve it or request a recheck.</p>
                            {sent && <p className="text-xs flex items-center gap-1 tabular-nums"><Send size={11} /> Sent {fmtIstIso(detail.SentToCustomerAt)}</p>}
                            {seniorApproved && canWork && detail.CustomerApprovalStatus !== "Approved" && (
                              <button onClick={handleSendToCustomer} disabled={sendingToCustomer} className={`${KEY_INK} h-8 px-3 mt-0.5`}>
                                {sendingToCustomer ? "Sending…" : sent ? "Resend to customer" : "Send to customer portal"}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })()}

                    {/* Step 3 — Customer review */}
                    {(() => {
                      const status = detail.CustomerApprovalStatus;
                      const done = status === "Approved";
                      const recheck = status === "RecheckRequested";
                      const sent = !!detail.SentToCustomerAt;
                      return (
                        <div className="px-4 py-4 flex items-start gap-3" style={{ borderBottom: RULE_SOFT }}>
                          <StepBox n={3} done={done} active={sent} stopped={recheck} />
                          <div className="flex-1 min-w-0 space-y-1.5">
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <span className="font-heading text-[0.75rem] font-bold uppercase tracking-[0.1em]">Customer review</span>
                              <SheetMark text={recheck ? "Recheck requested" : status || "Pending"} tone={recheck ? "stopped" : done ? "done" : "waiting"} />
                            </div>
                            <p className="text-xs text-muted-foreground">The customer's response from the portal: approve, or request changes.</p>
                            {done && detail.CustomerApprovedAt && <p className="text-xs flex items-center gap-1 tabular-nums"><CheckCircle2 size={11} /> Approved {fmtDate(detail.CustomerApprovedAt)}</p>}
                            {recheck && detail.CustomerRecheckRemarks && (
                              <p className="text-xs text-destructive px-2 py-1.5" style={{ border: "1px solid hsl(var(--destructive) / 0.4)" }}><strong>Recheck reason:</strong> {detail.CustomerRecheckRemarks}</p>
                            )}
                            {sent && !done && canWork && (
                              <div className="flex gap-2 flex-wrap mt-2">
                                <button onClick={() => setProxyApproveDialog(true)} className={`${KEY_LINE} h-8 px-3`}><UserCircle2 size={11} /> Record approval (offline)</button>
                                <button onClick={() => setProxyRecheckDialog(true)} className={`${KEY_LINE} h-8 px-3 !text-destructive !border-destructive`}><UserCircle2 size={11} /> Record recheck (offline)</button>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })()}

                    {/* Step 4 — Director review */}
                    {(() => {
                      const status = detail.DirectorApprovalStatus;
                      const done = status === "Approved";
                      const rejected = status === "Rejected";
                      return (
                        <div className="px-4 py-4 flex items-start gap-3">
                          <StepBox n={4} done={done} active={detail.CustomerApprovalStatus === "Approved"} stopped={rejected} />
                          <div className="flex-1 min-w-0 space-y-1.5">
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <span className="font-heading text-[0.75rem] font-bold uppercase tracking-[0.1em]">Director review</span>
                              <SheetMark text={status || "Pending"} tone={status ? deedTone(status) : "waiting"} />
                            </div>
                            <p className="text-xs text-muted-foreground">Final internal sign-off by the director before execution.</p>
                            {done && detail.DirectorApprovedAt && <p className="text-xs flex items-center gap-1 tabular-nums"><CheckCircle2 size={11} /> Approved {fmtDate(detail.DirectorApprovedAt)}</p>}
                            {rejected && detail.DirectorApprovalRemarks && (
                              <p className="text-xs text-destructive px-2 py-1.5" style={{ border: "1px solid hsl(var(--destructive) / 0.4)" }}><strong>Rejection reason:</strong> {detail.DirectorApprovalRemarks}</p>
                            )}
                            {!bookingCancelled && status === "Pending" && (
                              <div className="flex items-center gap-2 flex-wrap pt-0.5">
                                <ApprovalActions status={status} recordId={detail.Id} endpoint={API} actionPathSuffix="director"
                                  approverRoles={["super_admin"]} onSuccess={invalidate} />
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                  </Panel>

                  {/* Deed execution: the end of the senior → customer → director chain (and, server-side, every
                      mandatory document verified). The registry only covers the Sub-Registrar visit after it. */}
                  {(() => {
                    const executed = !!detail.ExecutedBy;
                    const readyToExecute = detail.SeniorApprovalStatus === "Approved" && detail.CustomerApprovalStatus === "Approved" && detail.DirectorApprovalStatus === "Approved";
                    const notReadyReason = !readyToExecute
                      ? `Needs senior, customer and director approval first — now senior: ${detail.SeniorApprovalStatus || "not requested"}, customer: ${detail.CustomerApprovalStatus || "not sent"}, director: ${detail.DirectorApprovalStatus || "not requested"}.`
                      : null;
                    return (
                      <Panel title="Deed execution" icon={<FileText size={13} />}
                        right={<SheetMark text={executed ? "Executed" : "Not executed"} tone={executed ? "done" : "waiting"} />}>
                        <div className="px-4 py-3">
                          {!progressLocked && !execEditing && (
                            !executed && notReadyReason ? <p className="text-[0.6875rem] text-muted-foreground">{notReadyReason}</p>
                            : !executed ? (canWork ? <button onClick={startExec} className={`${KEY_INK} h-8 px-3`}>Record execution</button> : <p className="text-xs text-muted-foreground">Not executed yet.</p>)
                            : (
                              <div className="space-y-1">
                                <p className="text-xs text-muted-foreground">Executed by <span className="font-medium text-foreground">{detail.ExecutedBy}</span></p>
                                {canWork && <button onClick={startExec} className={`${KEY_LINE} h-7 px-2`}><Pencil size={10} /> Edit</button>}
                              </div>
                            )
                          )}
                          {execEditing && canWork && (
                            <div className="space-y-3">
                              <p className="text-[0.6875rem] text-muted-foreground">Status follows what's recorded: executed by → Executed; registration no. → Registered. Every mandatory document must be verified (the server checks).</p>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div className="sm:col-span-2 space-y-1">
                                  <label className={`block ${LBL}`}>Executed by *</label>
                                  <input className={INP} value={execForm.ExecutedBy} onChange={(e) => setExecForm((f) => ({ ...f, ExecutedBy: e.target.value }))} placeholder="Authorised signatory name" />
                                </div>
                                <div className="space-y-1">
                                  <label className={`block ${LBL}`}>Registration no.</label>
                                  <input className={`${INP} tabular-nums`} value={execForm.RegistrationNo} onChange={(e) => setExecForm((f) => ({ ...f, RegistrationNo: e.target.value }))} />
                                </div>
                                <div className="space-y-1">
                                  <label className={`block ${LBL}`}>Registration date</label>
                                  <DateInput className={INP} value={execForm.RegistrationDate} onChange={(e) => setExecForm((f) => ({ ...f, RegistrationDate: e.target.value }))} />
                                </div>
                                <div className="space-y-1">
                                  <label className={`block ${LBL}`}>Book no.</label>
                                  <input className={INP} value={execForm.BookNo} onChange={(e) => setExecForm((f) => ({ ...f, BookNo: e.target.value }))} />
                                </div>
                                <div className="space-y-1">
                                  <label className={`block ${LBL}`}>Part no.</label>
                                  <input className={INP} value={execForm.PartNo} onChange={(e) => setExecForm((f) => ({ ...f, PartNo: e.target.value }))} />
                                </div>
                                <div className="space-y-1">
                                  <label className={`block ${LBL}`}>Possession date</label>
                                  <DateInput className={INP} value={execForm.PossessionDate} onChange={(e) => setExecForm((f) => ({ ...f, PossessionDate: e.target.value }))} />
                                </div>
                              </div>
                              <div className="flex justify-end gap-2">
                                <button onClick={() => setExecEditing(false)} className={`${KEY_LINE} h-8 px-3`}>Cancel</button>
                                <button onClick={handleSaveExecution} disabled={execSaving} className={`${KEY_INK} h-8 px-3`}>{execSaving ? "Saving…" : "Save"}</button>
                              </div>
                            </div>
                          )}
                          {progressLocked && (
                            executed ? (
                              <div className="space-y-0.5 text-xs text-muted-foreground">
                                <p>By <span className="text-foreground font-medium">{detail.ExecutedBy}</span></p>
                                {detail.RegistrationNo && <p className="tabular-nums">Reg no. <span className="text-foreground">{detail.RegistrationNo}</span> · {fmtDate(detail.RegistrationDate)}</p>}
                                {detail.BookNo && <p className="tabular-nums">Book / part: {detail.BookNo} / {detail.PartNo}</p>}
                              </div>
                            ) : <p className="text-xs text-muted-foreground">Not executed.</p>
                          )}
                        </div>
                      </Panel>
                    );
                  })()}
                </div>
              )}

              {activeTab === "Query Payment" && (
                <QueryPaymentTab key={detail.Id} detail={detail} canCreate={qpCanCreate && !bookingCancelled} canEdit={qpCanEdit && !bookingCancelled}
                  canConfirm={qpCanEdit && !bookingCancelled && legalOrInbox} onChanged={invalidate} />
              )}

              {activeTab === "Registry" && (
                <RegistryTab key={detail.Id} detail={detail} qpConfirmed={detailContext?.queryPaymentStatus === "Confirmed"}
                  canCreate={regCanCreate && !bookingCancelled} canEdit={regCanEdit && !bookingCancelled}
                  canCompleteOrCancel={regCanEdit && !bookingCancelled && legalOrInbox} canEditDeed={canWork}
                  previewingId={previewLoading} onPreview={handlePreview}
                  onSaveIndex2={handleSaveIndex2} savingIndex2={stepSaving} onChanged={invalidate} />
              )}

              {activeTab === "Documents" && (() => {
                const allDocs = deedDetail?.documents || [];
                const required = allDocs.filter((d: any) => d.IsMandatory);
                const supporting = allDocs.filter((d: any) => !d.IsMandatory);
                const verifiedCount = required.filter((d: any) => d.Status === "Verified").length;
                const canDocs = canWork && !progressLocked;
                const row = (doc: any) => (
                  <DocRow key={doc.Id} doc={doc} previewing={previewLoading === doc.Id}
                    onPreview={() => handlePreview(deedFileUrl(doc), doc)}
                    onDownload={() => downloadFile(deedFileUrl(doc), doc.FileName || doc.DocumentType || "document").catch((e) => toast.error(translateError(e.message)))}
                    attach={canDocs ? { onFile: (f) => handleAttachDoc(doc.Id, f), disabled: !canActAsLegal, title: !canActAsLegal ? legalLockReason : undefined } : undefined}
                    review={canDocs ? { onVerify: () => handleReviewDoc(doc.Id, true), onReject: () => handleReviewDoc(doc.Id, false) } : undefined} />
                );
                return (
                  <div className="space-y-4">
                    {/* Required documents gate senior approval; supporting ones are reference only. */}
                    <Panel title="Required for senior approval"
                      right={required.length > 0 ? <span className={`font-heading text-[0.6875rem] font-semibold tabular-nums ${verifiedCount === required.length ? "text-foreground" : "text-muted-foreground"}`}>{verifiedCount}/{required.length} verified</span> : undefined}>
                      {required.length === 0 ? (
                        <div className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
                          <p className="text-xs"><span className="font-semibold">No mandatory document requested yet.</span> Approval is blocked until one is requested and verified.</p>
                          {canDocs && (
                            <button onClick={() => handleRequestDoc("DeedDraft", "Sale Deed Draft (Physical Legal Document)")} disabled={requestingDoc} className={`${KEY_INK} h-8 px-3 shrink-0`}>
                              {requestingDoc ? "Requesting…" : "Request deed draft"}
                            </button>
                          )}
                        </div>
                      ) : required.map(row)}
                    </Panel>

                    <Panel title="Supporting documents">
                      {supporting.length > 0 ? supporting.map(row) : <p className="px-4 py-3 text-xs text-muted-foreground italic">None added.</p>}
                      {canDocs && (
                        <div className="p-4" style={{ borderTop: supporting.length ? undefined : RULE_SOFT }}>
                          <p className={`${LBL} mb-0.5`}>Add a supporting document</p>
                          <p className="text-xs text-muted-foreground mb-2">Reference material only — anything senior approval checks goes through "Request deed draft" above.</p>
                          <div className="flex items-end gap-2 flex-wrap">
                            <div className="flex-1 min-w-[9rem] space-y-1">
                              <label className={`block ${LBL}`}>Type</label>
                              <select value={newDocType} onChange={(e) => setNewDocType(e.target.value)} className={INP}>
                                <option value="ExecutedDeed">Executed deed copy</option>
                                <option value="Other">Other</option>
                              </select>
                            </div>
                            <div className="flex-1 min-w-[9rem] space-y-1">
                              <label className={`block ${LBL}`}>Label (optional)</label>
                              <input className={INP} value={newDocLabel} onChange={(e) => setNewDocLabel(e.target.value)} placeholder="e.g. Approved copy" />
                            </div>
                            <input type="file" className="hidden" ref={fileInputRef} onChange={(e) => e.target.files?.[0] && handleUploadDoc(e.target.files[0], newDocType, newDocLabel)} />
                            <button onClick={() => fileInputRef.current?.click()} disabled={uploadingDoc || !canActAsLegal}
                              title={!canActAsLegal ? legalLockReason : undefined} className={`${KEY_INK} h-9 px-3`}>
                              <Upload size={12} /> {uploadingDoc ? "Uploading…" : "Upload"}
                            </button>
                          </div>
                        </div>
                      )}
                    </Panel>
                  </div>
                );
              })()}

              {activeTab === "History" && (
                <div className="space-y-4">
                  <Panel title="Approval history" icon={<History size={13} />}>
                    {deedDetail?.approvalLog?.length ? deedDetail.approvalLog.map((log: any) => (
                      <div key={log.Id} className="px-4 py-2.5 text-sm" style={{ borderBottom: RULE_SOFT }}>
                        <div className="flex items-baseline justify-between gap-2 flex-wrap">
                          <span className={`font-medium ${/Reject|Recheck/.test(log.Action) ? "text-destructive" : ""}`}>{LOG_ACTION_LABEL[log.Action] || log.Action}</span>
                          <span className="text-xs text-muted-foreground tabular-nums">{fmtDate(log.CreatedAt)}</span>
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">By {log.ActorName || "System"} ({log.ActorType})</div>
                        {log.Remarks && <div className="text-xs px-2 py-1.5 mt-1.5" style={{ border: RULE_SOFT }}>{log.Remarks}</div>}
                      </div>
                    )) : <p className="px-4 py-6 text-center text-xs text-muted-foreground">No approval actions recorded yet.</p>}
                  </Panel>
                  {registryHistory.length > 0 && (
                    <Panel title="Registry (Sub-Registrar office)">
                      {registryHistory.map((log: any) => (
                        <div key={log.Id} className="px-4 py-2.5 text-sm" style={{ borderBottom: RULE_SOFT }}>
                          <div className="flex items-baseline justify-between gap-2 flex-wrap">
                            <span className="font-medium">{log.Action}</span>
                            <span className="text-xs text-muted-foreground tabular-nums">{fmtDate(log.CreatedAt)}</span>
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5">By {log.ActorName || "System"} ({log.ActorType})</div>
                          {log.Remarks && <div className="text-xs px-2 py-1.5 mt-1.5" style={{ border: RULE_SOFT }}>{log.Remarks}</div>}
                        </div>
                      ))}
                    </Panel>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
      </div>

        <Dialog open={!!previewDoc} onOpenChange={(o) => { if (!o) closePreview(); }}>
          <DialogContent className="max-w-3xl p-0 gap-0 overflow-hidden rounded-none" style={{ border: RULE }}>
            <DialogHeader className="px-4 py-2.5" style={{ borderBottom: RULE }}>
              <DialogTitle className="font-heading text-sm truncate">{previewDoc?.name}</DialogTitle>
            </DialogHeader>
            <div className="bg-muted/30 flex items-center justify-center" style={{ height: "75vh" }}>
              {previewDoc?.mime === "application/pdf" ? (
                <iframe src={previewDoc.url} title={previewDoc.name} className="w-full h-full border-0" />
              ) : previewDoc ? (
                <img src={previewDoc.url} alt={previewDoc.name} className="max-w-full max-h-full object-contain" />
              ) : null}
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) { setDialogOpen(false); setForm({ ...EMPTY_FORM }); } }}>
          <DialogContent className="max-w-lg rounded-none p-5 gap-4" style={{ border: RULE }}>
            <DialogHeader>
              <DialogTitle className="font-heading">New sale deed</DialogTitle>
              <DialogDescription className="text-xs">Needs the agreement registered and the loan cleared.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 max-h-[65vh] overflow-y-auto pr-1">
              <div className="space-y-1">
                <label className={`block ${LBL}`}>Booking *</label>
                <SearchableNativeSelect value={form.BookingId} onChange={(e) => setForm((f) => ({ ...f, BookingId: e.target.value, DeedValue: "" }))} className={INP}>
                  <option value="">Select booking</option>
                  {(eligible as any[]).map((b: any) => (
                    <option key={b.Id} value={String(b.Id)}>{`${b.BookingNo} · ${b.ApplicantName} · ${b.UnitNo}`}</option>
                  ))}
                </SearchableNativeSelect>
                {!(eligible as any[]).length && <p className="text-xs text-muted-foreground">No eligible bookings — the agreement must be registered first.</p>}
              </div>

              {form.BookingId && (
                <div className="px-4 py-3 space-y-1.5" style={{ border: RULE_SOFT }}>
                  {contextLoading ? <div className="text-xs text-muted-foreground">Checking eligibility…</div>
                  : !context ? <div className="text-xs text-muted-foreground">Couldn't load booking details.</div>
                  : (
                    <>
                      <p className="text-sm font-semibold"><ApplicantNames name={context.booking?.ApplicantName} bookingId={context.booking?.Id} applicationId={context.booking?.ApplicationId} /></p>
                      <p className="text-xs text-muted-foreground tabular-nums">{context.booking?.BookingNo} · {context.booking?.UnitNo} · {fmtRupees(context.booking?.GrandTotal)}</p>
                      <div className={`flex items-center gap-1.5 text-xs pt-1 ${agreementRegistered ? "" : "text-destructive"}`}>
                        {agreementRegistered ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                        Agreement {context.agreement ? `${context.agreement.AgreementNo} — ${context.agreement.Status}` : "not created yet"}
                      </div>
                      {context.requiresHandoverBeforeDeed && (
                        <div className={`flex items-center gap-1.5 text-xs ${handoverCleared ? "" : "text-destructive"}`}>
                          {handoverCleared ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                          Handover (under-construction project) — {context.handoverStatus || "not started"}
                          {!handoverCleared && (
                            <button onClick={() => navigate(`/crm/handover?bookingId=${form.BookingId}`)} className="flex items-center gap-1 underline underline-offset-2 ml-1">
                              Go to handover <ExternalLink size={10} />
                            </button>
                          )}
                        </div>
                      )}
                      {isLoanFinanced && (
                        <div className={`flex items-center gap-1.5 text-xs ${loanCleared ? "" : "text-destructive"}`}>
                          {loanCleared ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                          Loan processing — {loanCleared ? "cleared" : context.loanBlockReason}
                          {!loanCleared && (
                            <button onClick={() => navigate(`/crm/loan-details?bookingId=${form.BookingId}`)} className="flex items-center gap-1 underline underline-offset-2 ml-1">
                              Go to loan tracking <ExternalLink size={10} />
                            </button>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {([
                  ["Deed value", "DeedValue", "number"],
                  ["Stamp duty", "StampDuty", "number"],
                  ["Registration fee", "RegistrationFee", "number"],
                  ["AFS stamp duty credit", "StampDutyCredit", "number"],
                  ["Deed date", "DeedDate", "date"],
                  ["Registration deadline (RERA)", "RegistrationDeadline", "date"],
                ] as [string, keyof typeof EMPTY_FORM, string][]).map(([lbl, key, type]) => (
                  <div key={key} className="space-y-1">
                    <label className={`block ${LBL}`}>{lbl}</label>
                    {type === "date"
                      ? <DateInput className={INP} value={form[key]} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))} />
                      : <input type="number" className={`${INP} tabular-nums`} value={form[key]} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))} />}
                  </div>
                ))}
              </div>
              <div className="space-y-1">
                <label className={`block ${LBL}`}>Sub-Registrar office</label>
                <input className={INP} value={form.SubRegistrarOffice} onChange={(e) => setForm((f) => ({ ...f, SubRegistrarOffice: e.target.value }))} />
              </div>
              {context?.agreement?.AfsStampDuty != null && (
                <p className="text-[0.6875rem] text-muted-foreground tabular-nums">
                  AFS stamp duty {fmtRupees(context.agreement.AfsStampDuty)} pre-filled as credit — check it against the Sub-Registrar receipt before saving.
                </p>
              )}
            </div>
            <DialogFooter className="gap-2">
              <button onClick={() => { setDialogOpen(false); setForm({ ...EMPTY_FORM }); }} className={`${KEY_LINE} h-9 px-4`}>Cancel</button>
              <button onClick={handleCreate} disabled={saving || !canCreate} className={`${KEY_INK} h-9 px-4`}>{saving ? "Creating…" : "Create"}</button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

      {proxyApproveDialog && (
        <ProxyActionDialog
          title="Record Customer Approval — Sales Deed"
          description="You are recording that the customer has reviewed and approved the sales deed without using the portal."
          confirmLabel="Record Approval"
          saving={proxySaving}
          onClose={() => setProxyApproveDialog(false)}
          onConfirm={(m, r) => handleProxy("proxy-customer-approve", m, r)}
        />
      )}
      {proxyRecheckDialog && (
        <ProxyActionDialog
          title="Record Customer Recheck Request — Sales Deed"
          description="You are recording that the customer flagged an issue or requested changes to the sales deed without using the portal."
          confirmLabel="Record Recheck Request"
          saving={proxySaving}
          onClose={() => setProxyRecheckDialog(false)}
          onConfirm={(m, r) => handleProxy("proxy-customer-recheck", m, r)}
        />
      )}
      </SheetShell>
    </>
  );
};

export default CrmSalesDeed;
