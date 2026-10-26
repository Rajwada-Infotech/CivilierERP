import React, { useEffect, useRef, useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { translateError } from "@/lib/translateError";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Plus, CheckCircle2, Upload, AlertTriangle, History, Link2, Landmark, RefreshCw, ScrollText } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/contexts/AuthContext";
import { usePageRights } from "@/hooks/usePageRights";
import { CrmCompanyProjectBlockFilter, type CrmCompanyProjectBlockValue } from "@/components/crm/CrmCompanyProjectBlockFilter";
import { CrmPaginationBar } from "@/components/crm/CrmPaginationBar";
import { DateInput } from "@/components/ui/date-input";
import { SearchableNativeSelect } from "@/components/SearchableNativeSelect";
import { ApplicantNames } from "@/components/crm/ApplicantNames";
import { useSearchAsYouType } from "@/hooks/useSearchAsYouType";
import { SheetShell, SheetMark } from "@/components/sheet/Sheet";
import { fmtRupees } from "@/components/crm/FinancialStatusBar";
import { INP, KEY_INK, KEY_LINE, LBL, RULE, RULE_SOFT, TEXTAREA } from "./customers/config";
import { downloadFile, fetchFileBlob, fmtDate, localDay, roleKey } from "./salesDeed/config";
import { DocRow, Panel } from "./salesDeed/parts";

const API = "/api/crm/mutation";
const STATUS_LABEL: Record<string, string> = { Applied: "Applied", QueryRaised: "Query raised", Approved: "Approved" };
const mutTone = (s: string): "done" | "waiting" | "stopped" => s === "Approved" ? "done" : s === "QueryRaised" ? "stopped" : "waiting";

const isSynced = (doc: any): boolean => !!doc.Remarks?.startsWith("Synced automatically");

type DetailTab = "Overview" | "Documents" | "History";

const PAGE_SIZE = 20;
interface MutationListFilters { search: string; status: string; companyId: string; projectId: string; blockId: string }
async function fetchMutationList(filters: MutationListFilters, page: number): Promise<{ rows: any[]; total: number; statusCounts: Record<string, number> }> {
  const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (filters.search) params.set("search", filters.search);
  if (filters.status) params.set("status", filters.status);
  if (filters.companyId) params.set("companyId", filters.companyId);
  if (filters.projectId) params.set("projectId", filters.projectId);
  if (filters.blockId) params.set("blockId", filters.blockId);
  const r = await fetchWithAuth(`${API}?${params}`);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error || "Failed to load Mutation records");
  return { rows: data.rows || [], total: data.total || 0, statusCounts: data.statusCounts || {} };
}
async function fetchEligible(): Promise<any[]> {
  const r = await fetchWithAuth(`${API}/eligible-bookings`);
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error || "Failed to load eligible bookings");
  return r.json();
}

const CRM_MUTATION_APPROVER_ROLES = ["admin", "super_admin", "marketing_head", "legal_head"];
const emptyStart = () => ({ ApplicationNo: "", ApplicationDate: localDay(), Authority: "", OldKhataNo: "", MutationFee: "" });

const CrmMutation: React.FC = () => {
  const qc = useQueryClient();
  const rights = usePageRights("crm-mutation");
  const { currentUser, canDoAction } = useAuth();
  const canApproveMutation = rights.canEdit && (
    CRM_MUTATION_APPROVER_ROLES.includes(roleKey(currentUser?.role)) || canDoAction("approval-inbox" as any, "edit"));
  const [sp, setSp] = useSearchParams();
  const deepLinkBookingId = sp.get("bookingId");
  const mutationIdParam = sp.get("mutationId");

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
  const [bookingId, setBookingId] = useState("");
  const [startForm, setStartForm] = useState(emptyStart);
  const [saving, setSaving] = useState(false);

  const [detailId, setDetailId] = useState<number | null>(mutationIdParam && /^\d+$/.test(mutationIdParam) ? Number(mutationIdParam) : null);
  const [activeTab, setActiveTab] = useState<DetailTab>("Overview");
  const [deepLinkDone, setDeepLinkDone] = useState(false);

  const [queryOpen, setQueryOpen] = useState(false);
  const [queryRemarks, setQueryRemarks] = useState("");
  const [approveOpen, setApproveOpen] = useState(false);
  const [approveForm, setApproveForm] = useState({ ApprovedNo: "", ApprovedDate: localDay(), NewKhataNo: "" });
  const [busy, setBusy] = useState(false);

  const [newDocType, setNewDocType] = useState("Other");
  const [newDocLabel, setNewDocLabel] = useState("");
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const [requestingDoc, setRequestingDoc] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [previewDoc, setPreviewDoc] = useState<{ url: string; mime: string; name: string } | null>(null);
  const [previewLoading, setPreviewLoading] = useState<number | null>(null);

  const listFilters: MutationListFilters = useMemo(
    () => ({ search, status: statusFilter, companyId: cpb.companyId, projectId: cpb.projectId, blockId: cpb.blockId }),
    [search, statusFilter, cpb]
  );
  const { data: listResult, isLoading, isError, error, isFetching, refetch } = useQuery({
    queryKey: ["crm-mutation", listFilters, page],
    queryFn: () => fetchMutationList(listFilters, page),
    staleTime: 30_000,
  });
  const rows = listResult?.rows ?? [];
  const total = listResult?.total ?? 0;
  const counts = listResult?.statusCounts ?? {};
  const allCount = Object.values(counts).reduce((s, n) => s + n, 0);
  const { data: startableBookings = [] } = useQuery({ queryKey: ["crm-mutation-eligible"], queryFn: fetchEligible, staleTime: 60_000, enabled: rights.canCreate });

  const { data: detailData, isError: detailIsError, error: detailError } = useQuery({
    queryKey: ["crm-mutation-detail", detailId],
    queryFn: async () => {
      const r = await fetchWithAuth(`${API}/${detailId}`);
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data?.error || `Could not load the mutation (${r.status}).`);
      return data;
    },
    enabled: detailId != null,
    staleTime: 15_000,
    retry: false,
  });

  const detail = detailData?.mutation ?? (detailId != null ? (rows as any[]).find((r: any) => r.Id === detailId) : null);
  const documents: any[] = detailData?.documents || [];
  const history: any[] = detailData?.history || [];

  // ?bookingId opens the booking's mutation (found on the server: the page used to look in the 20 rows on screen),
  // or the Start dialog when it has none and is eligible.
  useEffect(() => {
    if (deepLinkDone || !deepLinkBookingId || mutationIdParam) return;
    let stop = false;
    (async () => {
      const r = await fetchWithAuth(`${API}/booking/${deepLinkBookingId}`).catch(() => null);
      const row = r?.ok ? await r.json().catch(() => null) : null;
      if (stop) return;
      if (row?.Id) { setDeepLinkDone(true); selectDetail(row.Id); return; }
      if (rights.canCreate && startableBookings.some((b: any) => String(b.Id) === deepLinkBookingId)) {
        setDeepLinkDone(true);
        setBookingId(deepLinkBookingId);
        setDialogOpen(true);
      }
    })();
    return () => { stop = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkBookingId, mutationIdParam, deepLinkDone, startableBookings.length, rights.canCreate]);

  const invalidateDetail = () => qc.invalidateQueries({ queryKey: ["crm-mutation-detail", detailId] });
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["crm-mutation"] });
    qc.invalidateQueries({ queryKey: ["crm-mutation-eligible"] });
    qc.invalidateQueries({ queryKey: ["crm-booking-lifecycle"] });
    qc.invalidateQueries({ queryKey: ["crm-legal-milestones"] });
    if (detailId) invalidateDetail();
  };

  const selectDetail = (id: number) => {
    setDetailId(id);
    setActiveTab("Overview");
    setSp((p) => { p.set("mutationId", String(id)); return p; }, { replace: true });
  };

  const send = async (url: string, method: string, body?: any) => {
    const res = await fetchWithAuth(url, body instanceof FormData ? { method, body } : {
      method, headers: { "Content-Type": "application/json" }, body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  };

  const handleStart = async () => {
    if (!bookingId) { toast.error("Booking is required"); return; }
    setSaving(true);
    try {
      const data = await send(API, "POST", { BookingId: parseInt(bookingId), ...startForm });
      toast.success(`${data.MutationNo} started`);
      setDialogOpen(false);
      setBookingId("");
      setStartForm(emptyStart());
      invalidate();
      selectDetail(data.id);
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setSaving(false); }
  };
  const handleQuery = async () => {
    if (detailId == null || !queryRemarks.trim()) { toast.error("Remarks are required"); return; }
    setBusy(true);
    try {
      await send(`${API}/${detailId}/query`, "PUT", { Remarks: queryRemarks.trim() });
      toast.success("Query recorded — documents reset for correction");
      setQueryOpen(false); setQueryRemarks("");
      invalidate();
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setBusy(false); }
  };
  const handleResubmit = async () => {
    if (detailId == null) return;
    setBusy(true);
    try { await send(`${API}/${detailId}/resubmit`, "PUT"); toast.success("Resubmitted to the authority"); invalidate(); }
    catch (e: any) { toast.error(translateError(e.message)); }
    finally { setBusy(false); }
  };
  const handleApprove = async () => {
    if (detailId == null) return;
    if (!approveForm.NewKhataNo.trim()) { toast.error("New Khata No. is required"); return; }
    setBusy(true);
    try {
      await send(`${API}/${detailId}/approve`, "PUT", approveForm);
      toast.success("Mutation approved — municipal records updated");
      setApproveOpen(false);
      invalidate();
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setBusy(false); }
  };
  const handleUploadDoc = async (file: File, documentType: string, label?: string) => {
    if (detailId == null) return;
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
  const handleRequestDoc = async (documentType: string, label?: string) => {
    if (detailId == null) return;
    setRequestingDoc(true);
    try {
      await send(`${API}/${detailId}/documents/request`, "POST", { DocumentType: documentType, Label: label, IsMandatory: true });
      toast.success("Document requested");
      invalidateDetail();
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setRequestingDoc(false); }
  };
  const handleReviewDoc = async (docId: number, verify: boolean) => {
    if (detailId == null) return;
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
  const fileUrl = (doc: any) => `${API}/documents/file/${doc.Id}`;
  const handlePreviewDoc = async (doc: any) => {
    setPreviewLoading(doc.Id);
    try {
      const blob = await fetchFileBlob(fileUrl(doc));
      setPreviewDoc({ url: URL.createObjectURL(blob), mime: doc.MimeType, name: doc.FileName || doc.DocumentType });
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setPreviewLoading(null); }
  };
  const closePreview = () => { if (previewDoc) URL.revokeObjectURL(previewDoc.url); setPreviewDoc(null); };

  const required = documents.filter((d) => d.IsMandatory);
  const supporting = documents.filter((d) => !d.IsMandatory);
  const verifiedCount = required.filter((d) => d.Status === "Verified").length;
  const docsReady = required.length > 0 && verifiedCount === required.length;
  const locked = detail?.Status === "Approved";
  const canDocs = rights.canEdit && !locked;

  const docRow = (doc: any) => (
    <DocRow key={doc.Id} doc={doc} previewing={previewLoading === doc.Id}
      nextStep={isSynced(doc) ? "Pulled from the Registry's own verified copy — nothing to do here." : undefined}
      onPreview={() => handlePreviewDoc(doc)}
      onDownload={() => downloadFile(fileUrl(doc), doc.FileName || doc.DocumentType || "document").catch((e) => toast.error(translateError(e.message)))}
      attach={canDocs ? { onFile: (f) => handleUploadDoc(f, doc.DocumentType, doc.Label) } : undefined}
      review={canDocs ? { onVerify: () => handleReviewDoc(doc.Id, true), onReject: () => handleReviewDoc(doc.Id, false) } : undefined}
      extraTag={isSynced(doc)
        ? <span className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em] px-1.5 py-0.5 border border-foreground/30 border-dashed inline-flex items-center gap-1"><Link2 size={9} /> Synced from registry</span>
        : undefined} />
  );

  const figures = [
    { label: "Mutations", value: allCount, note: "Khata transfers tracked", go: () => updateFilter(setStatusFilter)("") },
    { label: "Applied", value: counts.Applied ?? 0, note: "With the authority", go: () => updateFilter(setStatusFilter)("Applied") },
    { label: "Query raised", value: counts.QueryRaised ?? 0, note: "To correct and resubmit", go: () => updateFilter(setStatusFilter)("QueryRaised") },
    { label: "Approved", value: counts.Approved ?? 0, note: "New khata issued", go: () => updateFilter(setStatusFilter)("Approved") },
  ];
  const note = (edge: string) => ({ border: RULE_SOFT, borderLeft: `3px solid ${edge}` });

  return (
    <>
      <Breadcrumbs items={["Dashboard", "CRM", "Property Mutation"]} />
      <SheetShell
        eyebrow="CivilierERP · CRM · Sale deed"
        title="Property Mutation"
        subtitle="Khata transfer: the application to put the new owner's name on the municipal land records — only once the sale deed is registered."
        action={
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button onClick={() => refetch()} disabled={isFetching} className={`${KEY_LINE} h-9 w-9`} title="Refresh"><RefreshCw size={13} className={isFetching ? "animate-spin" : ""} /></button>
            {/* The server starts a mutation under the create right; the button was offered to everyone. */}
            {rights.canCreate && <button onClick={() => setDialogOpen(true)} className={`${KEY_INK} h-9 px-4`}><Plus size={13} /> Start mutation</button>}
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
                placeholder="Search customer or booking…"
                className="h-9 w-full border border-foreground/40 focus:border-foreground bg-card px-3 text-xs text-foreground outline-none" />
              <select value={statusFilter} onChange={(e) => updateFilter(setStatusFilter)(e.target.value)} className={`${INP} text-xs`}>
                <option value="">All statuses ({allCount})</option>
                {Object.keys(STATUS_LABEL).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]} ({counts[s] ?? 0})</option>)}
              </select>
              <CrmCompanyProjectBlockFilter stacked value={cpb} onChange={updateFilter(setCpb)} />
            </div>
            <div className="flex-1 overflow-y-auto thin-scroll max-h-[45vh] md:max-h-none">
              {isError ? (
                <p className="p-4 text-center text-sm text-destructive">{(error as Error)?.message}</p>
              ) : isLoading ? (
                <p className="p-4 text-center text-muted-foreground text-sm">Loading…</p>
              ) : rows.length === 0 ? (
                <p className="p-4 text-center text-muted-foreground text-sm">{search || statusFilter || cpb.projectId ? "No mutation matches." : "No mutation trackers yet."}</p>
              ) : (rows as any[]).map((r: any) => {
                const on = detailId === r.Id;
                return (
                  <button key={r.Id} onClick={() => selectDetail(r.Id)}
                    className={`w-full text-left px-3 py-2.5 transition-colors ${on ? "bg-foreground text-card" : "hover:bg-primary/5"}`}
                    style={{ borderBottom: RULE_SOFT }}>
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm font-semibold leading-tight truncate"><ApplicantNames name={r.ApplicantName} bookingId={r.BookingId} applicationId={r.ApplicationId} /></span>
                      <span className={on ? "[&_*]:!text-card" : ""}><SheetMark text={STATUS_LABEL[r.Status] || r.Status} tone={mutTone(r.Status)} /></span>
                    </div>
                    <div className={`mt-1 text-[0.6875rem] tabular-nums truncate ${on ? "opacity-80" : "text-muted-foreground"}`}>
                      {[r.MutationNo, r.BookingNo, r.UnitNo].filter(Boolean).join(" · ")}
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
              <div className="h-full flex items-center justify-center text-sm text-muted-foreground">Select a mutation to view details</div>
            ) : detailIsError && !detail ? (
              <div className="h-full flex items-center justify-center text-sm text-destructive">{(detailError as Error)?.message}</div>
            ) : !detail ? (
              <div className="h-full flex items-center justify-center text-sm text-muted-foreground">Loading…</div>
            ) : (
              <>
                <div className="bg-card px-4 py-3 flex items-center justify-between gap-3 flex-wrap" style={{ border: RULE }}>
                  <div className="min-w-0">
                    <span className={`block ${LBL}`}>Mutation</span>
                    <h2 className="font-heading font-bold text-lg text-foreground leading-tight truncate flex items-center gap-2">
                      <Landmark size={16} /> <ApplicantNames name={detail.ApplicantName} bookingId={detail.BookingId} applicationId={detail.ApplicationId} />
                    </h2>
                    <p className="text-[0.6875rem] text-muted-foreground mt-0.5 tabular-nums">
                      {[detail.MutationNo, detail.BookingNo, detail.UnitNo, detail.DeedNo && `Deed ${detail.DeedNo}`].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <SheetMark text={STATUS_LABEL[detail.Status] || detail.Status} tone={mutTone(detail.Status)} />
                </div>

                <div className="flex items-stretch overflow-x-auto thin-scroll bg-card" style={{ border: RULE }}>
                  {(["Overview", "Documents", "History"] as DetailTab[]).map((t) => (
                    <button key={t} onClick={() => setActiveTab(t)}
                      className={`px-4 h-10 font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] whitespace-nowrap shrink-0 transition-colors ${
                        activeTab === t ? "bg-foreground text-card" : "text-muted-foreground hover:text-foreground hover:bg-primary/5"
                      }`} style={{ borderRight: RULE_SOFT }}>
                      {t}
                    </button>
                  ))}
                </div>

                {activeTab === "Overview" && (
                  <div className="space-y-4">
                    {detail.Status === "Applied" && (
                      <div className="bg-card px-4 py-3 flex items-center justify-between gap-3 flex-wrap" style={note("hsl(var(--foreground))")}>
                        <div>
                          <p className="text-sm font-semibold flex items-center gap-1.5"><Landmark size={14} /> Application pending with the authority</p>
                          <p className="text-xs text-muted-foreground mt-0.5 tabular-nums">
                            {required.length > 0 ? `${verifiedCount}/${required.length} mandatory documents verified.` : "No mandatory document requested yet."}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {rights.canEdit && <button onClick={() => setQueryOpen(true)} className={`${KEY_LINE} h-8 px-3 !text-destructive !border-destructive`}>Raise query</button>}
                          {canApproveMutation ? (
                            <button onClick={() => { setApproveForm({ ApprovedNo: "", ApprovedDate: localDay(), NewKhataNo: "" }); setApproveOpen(true); }} disabled={!docsReady}
                              title={!docsReady ? "Verify the mandatory documents first" : undefined} className={`${KEY_INK} h-8 px-3`}>
                              Approve
                            </button>
                          ) : rights.canEdit ? (
                            <span className="text-[0.6875rem] text-muted-foreground">Approving needs the Legal head / an admin</span>
                          ) : null}
                        </div>
                      </div>
                    )}
                    {detail.Status === "QueryRaised" && (
                      <div className="bg-card px-4 py-3 space-y-2" style={note("hsl(var(--destructive))")}>
                        <p className="text-sm font-semibold text-destructive flex items-center gap-1.5"><AlertTriangle size={14} /> Query raised by the authority</p>
                        {detail.QueryRemarks && <p className="text-xs px-2 py-1.5" style={{ border: RULE_SOFT }}>"{detail.QueryRemarks}"</p>}
                        <p className="text-xs text-muted-foreground tabular-nums">
                          {required.length > 0 ? `${verifiedCount}/${required.length} mandatory documents verified.` : "No mandatory document requested yet."}
                        </p>
                        {rights.canEdit && (
                          <button onClick={handleResubmit} disabled={!docsReady || busy}
                            title={!docsReady ? "Fix and verify the flagged documents first" : undefined} className={`${KEY_INK} h-8 px-3`}>
                            Resubmit to authority
                          </button>
                        )}
                      </div>
                    )}
                    {detail.Status === "Approved" && (
                      <div className="bg-card px-4 py-3" style={note("hsl(var(--foreground))")}>
                        <p className="text-sm font-semibold flex items-center gap-1.5 tabular-nums"><CheckCircle2 size={14} /> Mutation approved {fmtDate(detail.ApprovedDate)}</p>
                        <p className="text-xs text-muted-foreground mt-0.5 tabular-nums">New khata no. {detail.NewKhataNo} · mutation no. {detail.ApprovedNo || "—"}</p>
                      </div>
                    )}

                    <Panel title="Application">
                      <div className="grid grid-cols-1 sm:grid-cols-2">
                        {([
                          ["Booking", detail.BookingNo],
                          ["Unit", detail.UnitNo],
                          ["Applicant", <ApplicantNames key="a" name={detail.ApplicantName} bookingId={detail.BookingId} applicationId={detail.ApplicationId} />],
                          ["Sale deed", `${detail.DeedNo || "—"}${detail.RegistrationNo ? ` (reg. ${detail.RegistrationNo})` : ""}`],
                          ["Application no.", detail.ApplicationNo || "—"],
                          ["Applied on", fmtDate(detail.ApplicationDate)],
                          ["Authority", detail.Authority || "—"],
                          ["Old khata no.", detail.OldKhataNo || "—"],
                          ["Mutation fee", detail.MutationFee != null ? fmtRupees(detail.MutationFee) : "—"],
                          ...(detail.Status === "Approved" ? [["New khata no.", detail.NewKhataNo], ["Mutation no.", detail.ApprovedNo || "—"]] : []),
                        ] as [string, React.ReactNode][]).map(([l, v], i, arr) => (
                          <div key={l} className={`px-4 py-2.5 ${i === arr.length - 1 && arr.length % 2 === 1 ? "sm:col-span-2" : ""}`} style={{ borderBottom: RULE_SOFT, borderRight: i % 2 === 0 ? RULE_SOFT : undefined }}>
                            <p className={LBL}>{l}</p>
                            <p className="text-sm font-medium tabular-nums mt-0.5">{v}</p>
                          </div>
                        ))}
                      </div>
                    </Panel>
                  </div>
                )}

                {activeTab === "Documents" && (
                  <div className="space-y-4">
                    <Panel title="Required documents"
                      right={required.length > 0 ? <span className={`font-heading text-[0.6875rem] font-semibold tabular-nums ${verifiedCount === required.length ? "text-foreground" : "text-muted-foreground"}`}>{verifiedCount}/{required.length} verified</span> : undefined}>
                      {required.length === 0 ? (
                        <div className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
                          <p className="text-xs"><span className="font-semibold">No mandatory document requested yet.</span> Approval is blocked until one is requested and verified.</p>
                          {canDocs && (
                            <button onClick={() => handleRequestDoc("MutationApplicationForm", "Mutation Application Form")} disabled={requestingDoc} className={`${KEY_INK} h-8 px-3 shrink-0`}>
                              {requestingDoc ? "Requesting…" : "Request application form"}
                            </button>
                          )}
                        </div>
                      ) : required.map(docRow)}
                    </Panel>

                    <Panel title="Supporting documents">
                      {supporting.length > 0 ? supporting.map(docRow) : <p className="px-4 py-3 text-xs text-muted-foreground italic">None added.</p>}
                      {canDocs && (
                        <div className="p-4" style={{ borderTop: supporting.length ? undefined : RULE_SOFT }}>
                          <p className={`${LBL} mb-0.5`}>Add a supporting document</p>
                          <p className="text-xs text-muted-foreground mb-2">Reference material only — anything approval checks goes through the request above.</p>
                          <div className="flex items-end gap-2 flex-wrap">
                            <div className="flex-1 min-w-[9rem] space-y-1">
                              <label className={`block ${LBL}`}>Type</label>
                              <select value={newDocType} onChange={(e) => setNewDocType(e.target.value)} className={INP}>
                                <option value="IdentityProof">Identity proof</option>
                                <option value="Other">Other</option>
                              </select>
                            </div>
                            <div className="flex-1 min-w-[9rem] space-y-1">
                              <label className={`block ${LBL}`}>Label (optional)</label>
                              <input className={INP} value={newDocLabel} onChange={(e) => setNewDocLabel(e.target.value)} placeholder="e.g. Aadhaar copy" />
                            </div>
                            <input type="file" className="hidden" ref={fileInputRef} onChange={(e) => e.target.files?.[0] && handleUploadDoc(e.target.files[0], newDocType, newDocLabel)} />
                            <button onClick={() => fileInputRef.current?.click()} disabled={uploadingDoc} className={`${KEY_INK} h-9 px-3`}>
                              <Upload size={12} /> {uploadingDoc ? "Uploading…" : "Upload"}
                            </button>
                          </div>
                        </div>
                      )}
                    </Panel>
                  </div>
                )}

                {activeTab === "History" && (
                  <Panel title="History" icon={<History size={13} />}>
                    {history.length > 0 ? history.map((log: any) => (
                      <div key={log.Id} className="px-4 py-2.5 text-sm" style={{ borderBottom: RULE_SOFT }}>
                        <div className="flex items-baseline justify-between gap-2 flex-wrap">
                          <span className="font-medium flex items-center gap-1"><ScrollText size={12} /> {log.Action}</span>
                          <span className="text-xs text-muted-foreground tabular-nums">{fmtDate(log.CreatedAt)}</span>
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">By {log.ActorName || "System"} ({log.ActorType})</div>
                        {log.Remarks && <div className="text-xs px-2 py-1.5 mt-1.5" style={{ border: RULE_SOFT }}>{log.Remarks}</div>}
                      </div>
                    )) : <p className="px-4 py-6 text-center text-xs text-muted-foreground">No history recorded yet.</p>}
                  </Panel>
                )}
              </>
            )}
          </div>
        </div>
      </div>

        {/* Start mutation */}
        <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) { setDialogOpen(false); setBookingId(""); } }}>
          <DialogContent className="max-w-md rounded-none p-5 gap-4" style={{ border: RULE }}>
            <DialogHeader><DialogTitle className="font-heading">Start mutation</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1">
                <label className={`block ${LBL}`}>Booking *</label>
                <SearchableNativeSelect value={bookingId} onChange={(e) => setBookingId(e.target.value)} className={INP}>
                  <option value="">Select booking</option>
                  {startableBookings.map((b: any) => (
                    <option key={b.Id} value={String(b.Id)}>{`${b.BookingNo} — ${b.ApplicantName}`}</option>
                  ))}
                </SearchableNativeSelect>
                <p className="text-[0.6875rem] text-muted-foreground">{startableBookings.length ? "Needs the sale deed registry completed." : "No booking is eligible yet — the sale deed registry must be completed first."}</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className={`block ${LBL}`}>Application no.</label>
                  <input className={INP} value={startForm.ApplicationNo} onChange={(e) => setStartForm((f) => ({ ...f, ApplicationNo: e.target.value }))} placeholder="Optional" />
                </div>
                <div className="space-y-1">
                  <label className={`block ${LBL}`}>Application date</label>
                  <DateInput value={startForm.ApplicationDate} max={localDay()} onChange={(e) => setStartForm((f) => ({ ...f, ApplicationDate: e.target.value }))} className={INP} />
                </div>
              </div>
              <div className="space-y-1">
                <label className={`block ${LBL}`}>Authority</label>
                <input className={INP} value={startForm.Authority} onChange={(e) => setStartForm((f) => ({ ...f, Authority: e.target.value }))} placeholder="e.g. GHMC, MCGM, BDA" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className={`block ${LBL}`}>Old khata no.</label>
                  <input className={INP} value={startForm.OldKhataNo} onChange={(e) => setStartForm((f) => ({ ...f, OldKhataNo: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <label className={`block ${LBL}`}>Mutation fee</label>
                  <input type="number" className={`${INP} tabular-nums`} value={startForm.MutationFee} onChange={(e) => setStartForm((f) => ({ ...f, MutationFee: e.target.value }))} />
                </div>
              </div>
            </div>
            <DialogFooter className="gap-2">
              <button onClick={() => { setDialogOpen(false); setBookingId(""); }} className={`${KEY_LINE} h-9 px-4`}>Cancel</button>
              <button onClick={handleStart} disabled={saving || !bookingId} className={`${KEY_INK} h-9 px-4`}>{saving ? "Starting…" : "Start"}</button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Raise query */}
        <Dialog open={queryOpen} onOpenChange={(o) => !o && setQueryOpen(false)}>
          <DialogContent className="max-w-sm rounded-none p-5 gap-4" style={{ border: RULE }}>
            <DialogHeader><DialogTitle className="font-heading">Raise query</DialogTitle></DialogHeader>
            <div className="space-y-1">
              <label className={`block ${LBL}`}>What did the authority flag? *</label>
              <textarea value={queryRemarks} onChange={(e) => setQueryRemarks(e.target.value)} className={`${TEXTAREA} min-h-[80px]`} />
              <p className="text-[0.6875rem] text-muted-foreground">The mandatory documents are reset, so staff must correct and reattach them before resubmitting.</p>
            </div>
            <DialogFooter className="gap-2">
              <button onClick={() => setQueryOpen(false)} className={`${KEY_LINE} h-9 px-4`}>Cancel</button>
              <button onClick={handleQuery} disabled={busy || !queryRemarks.trim()} className={`${KEY_INK} h-9 px-4`}>{busy ? "Saving…" : "Record query"}</button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Approve */}
        <Dialog open={approveOpen} onOpenChange={(o) => !o && setApproveOpen(false)}>
          <DialogContent className="max-w-sm rounded-none p-5 gap-4" style={{ border: RULE }}>
            <DialogHeader><DialogTitle className="font-heading">Approve mutation</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1">
                <label className={`block ${LBL}`}>New khata no. *</label>
                <input className={`${INP} tabular-nums`} value={approveForm.NewKhataNo} onChange={(e) => setApproveForm((f) => ({ ...f, NewKhataNo: e.target.value }))} placeholder="e.g. 456/2026" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className={`block ${LBL}`}>Mutation no.</label>
                  <input className={`${INP} tabular-nums`} value={approveForm.ApprovedNo} onChange={(e) => setApproveForm((f) => ({ ...f, ApprovedNo: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <label className={`block ${LBL}`}>Approved date</label>
                  <DateInput value={approveForm.ApprovedDate} max={localDay()} onChange={(e) => setApproveForm((f) => ({ ...f, ApprovedDate: e.target.value }))} className={INP} />
                </div>
              </div>
            </div>
            <DialogFooter className="gap-2">
              <button onClick={() => setApproveOpen(false)} className={`${KEY_LINE} h-9 px-4`}>Cancel</button>
              <button onClick={handleApprove} disabled={busy || !approveForm.NewKhataNo.trim()} className={`${KEY_INK} h-9 px-4`}>{busy ? "Saving…" : "Confirm approval"}</button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Preview */}
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
      </SheetShell>
    </>
  );
};

export default CrmMutation;
