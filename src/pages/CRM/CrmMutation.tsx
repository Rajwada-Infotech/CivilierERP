import { useSheetAsk } from "@/components/sheet/SheetAsk";
import React, { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { translateError } from "@/lib/translateError";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { cn } from "@/lib/utils";
import {
  Plus, CheckCircle2, Upload, AlertTriangle, History, Link2, Landmark, RefreshCw, ScrollText, ArrowLeft, Download, Copy,
  RotateCcw, FileText, Home, FolderCheck, Info, Send,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { usePageRights } from "@/hooks/usePageRights";
import { useUrlParam } from "@/hooks/useUrlParam";
import { useCrmListState, useSticky, listParams, type CrmListQuery, type CrmSort } from "@/hooks/useCrmListState";
import { CrmCompanyProjectBlockFilter } from "@/components/crm/CrmCompanyProjectBlockFilter";
import {
  CrmAppPage, CrmGrid, GridBulkBar, GridColumnChooser, GridDateFilter, GridFields, GridHighlights, GridMetric, GridPath, GridRelated,
  GridSavedViews, GridSearch, GridStatusPill, GridTabs, exportGrid, gridListMeta, gridVisibleCols, resolveGridDateRange, useGridPrefs,
  GRID_ANY_DATE, GRID_BTN, GRID_BTN_BRAND, GRID_CARD, GRID_INPUT, GRID_LABEL, GRID_PAGE_SIZES,
  type GridCol, type GridDateRange, type GridPathState,
} from "@/components/crm/CrmDataTable";
import { DateInput } from "@/components/ui/date-input";
import { SearchableNativeSelect } from "@/components/SearchableNativeSelect";
import { ApplicantNames } from "@/components/crm/ApplicantNames";
import { fmtRupees } from "@/components/crm/FinancialStatusBar";
import { downloadFile, fetchFileBlob, fmtDate, localDay } from "./salesDeed/config";
import { DocRow } from "./salesDeed/parts";
import { useCanApprove } from "@/hooks/useCanApprove";

const API = "/api/crm/mutation";
const PREFS_KEY = "crm-mutation-grid";
const VIEWS_KEY = "crm-mutation-saved-views";
const ALL = "All";
const DEFAULT_SORT: CrmSort = { key: "CreatedAt", dir: "desc" };
const STATUS_LABEL: Record<string, string> = { Applied: "With the authority", QueryRaised: "Query raised", Approved: "Approved" };
const statusText = (s: string) => STATUS_LABEL[s] || s;
const DETAIL_TABS = ["Overview", "Documents", "History"] as const;
type DetailTab = typeof DETAIL_TABS[number];

const isSynced = (doc: any): boolean => !!doc.Remarks?.startsWith("Synced automatically");
const fmt = (n: number | null | undefined) => (n != null ? fmtRupees(Number(n)) : "—");
const DAY_MS = 86_400_000;
/** Days the application has been with the authority (still open), or took (approved). */
const daysOpen = (m: any): number | null => {
  if (!m.ApplicationDate) return null;
  const end = m.Status === "Approved" && m.ApprovedDate ? new Date(m.ApprovedDate) : new Date();
  return Math.max(0, Math.floor((end.getTime() - new Date(m.ApplicationDate).getTime()) / DAY_MS));
};

/** This page's own filter beyond the common list ones: when it was applied. */
interface ExtraFilters { applied: GridDateRange }
const NO_EXTRA: ExtraFilters = { applied: GRID_ANY_DATE };
function queryString(q: CrmListQuery, x: ExtraFilters): URLSearchParams {
  const p = listParams(q, ALL);
  const { from, to } = resolveGridDateRange(x.applied);
  if (from) p.set("dateFrom", from);
  if (to) p.set("dateTo", to);
  return p;
}
interface MutationList { rows: any[]; total: number; statusCounts: Record<string, number>; summary: { feeTotal: number } }
async function fetchMutationList(q: CrmListQuery, x: ExtraFilters): Promise<MutationList> {
  const r = await fetchWithAuth(`${API}?${queryString(q, x)}`);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error || `Could not load the mutations (${r.status}).`);
  return { rows: data.rows || [], total: data.total || 0, statusCounts: data.statusCounts || {}, summary: data.summary || { feeTotal: 0 } };
}
async function fetchAllMutations(q: CrmListQuery, x: ExtraFilters): Promise<any[]> {
  const p = queryString(q, x);
  p.delete("page"); p.delete("pageSize");
  const r = await fetchWithAuth(`${API}?${p}`);
  const data = await r.json().catch(() => []);
  if (!r.ok) throw new Error((data as any)?.error || `Could not export the mutations (${r.status}).`);
  return data;
}
async function fetchEligible(): Promise<any[]> {
  const r = await fetchWithAuth(`${API}/eligible-bookings`);
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error || "Failed to load eligible bookings");
  return r.json();
}

const emptyStart = () => ({ ApplicationNo: "", ApplicationDate: localDay(), Authority: "", OldKhataNo: "", MutationFee: "" });

/** The documents as a bar: verified of the mandatory ones. */
function DocsProgress({ verified, required }: { verified: number; required: number }) {
  if (!required) return <span className="text-muted-foreground">None asked</span>;
  const done = verified >= required;
  return (
    <span className="inline-flex items-center gap-2" title={`${verified} of ${required} mandatory documents verified`}>
      <span className="w-14 h-1.5 rounded-full bg-muted overflow-hidden">
        <span className={cn("block h-full rounded-full", done ? "bg-emerald-600" : "bg-primary")} style={{ width: `${Math.round((verified / required) * 100)}%` }} />
      </span>
      <span className={cn("tabular-nums text-xs", done ? "text-emerald-700 dark:text-emerald-300 font-semibold" : "")}>{verified}/{required}</span>
    </span>
  );
}

const MUTATION_COLS: GridCol<any>[] = [
  { id: "no", label: "Mutation", sortKey: "MutationNo", locked: true, cell: (m) => <span className="font-semibold text-primary hover:underline tabular-nums">{m.MutationNo}</span>, csv: (m) => m.MutationNo },
  {
    id: "customer", label: "Customer", sortKey: "ApplicantName",
    cell: (m) => <span className="truncate block max-w-[16rem]" onClick={(e) => e.stopPropagation()}><ApplicantNames name={m.ApplicantName} bookingId={m.BookingId} applicationId={m.ApplicationId} /></span>,
    csv: (m) => m.ApplicantName,
  },
  { id: "booking", label: "Booking", sortKey: "BookingNo", cell: (m) => <span className="tabular-nums">{m.BookingNo}</span>, csv: (m) => m.BookingNo },
  {
    id: "unit", label: "Project · unit", sortKey: "ProjectName",
    cell: (m) => <span className="truncate block max-w-[14rem]">{[m.ProjectName, m.UnitNo].filter(Boolean).join(" · ") || "—"}</span>,
    csv: (m) => [m.ProjectName, m.UnitNo].filter(Boolean).join(" · "),
  },
  { id: "authority", label: "Authority", sortKey: "Authority", cell: (m) => m.Authority || "—", csv: (m) => m.Authority },
  { id: "applied", label: "Applied on", sortKey: "ApplicationDate", cell: (m) => <span className="tabular-nums">{fmtDate(m.ApplicationDate)}</span>, csv: (m) => fmtDate(m.ApplicationDate) },
  {
    id: "days", label: "Days", align: "right",
    cell: (m) => { const d = daysOpen(m); return <span className="tabular-nums" title={m.Status === "Approved" ? "Days the authority took" : "Days with the authority so far"}>{d ?? "—"}</span>; },
    csv: (m) => daysOpen(m),
  },
  { id: "docs", label: "Documents", cell: (m) => <DocsProgress verified={m.DocsVerified ?? 0} required={m.DocsRequired ?? 0} />, csv: (m) => `${m.DocsVerified ?? 0}/${m.DocsRequired ?? 0}` },
  { id: "status", label: "Status", sortKey: "Status", cell: (m) => <GridStatusPill status={m.Status} label={statusText(m.Status)} />, csv: (m) => statusText(m.Status) },
  { id: "oldKhata", label: "Old khata", hiddenByDefault: true, cell: (m) => <span className="tabular-nums">{m.OldKhataNo || "—"}</span>, csv: (m) => m.OldKhataNo },
  { id: "newKhata", label: "New khata", cell: (m) => <span className="tabular-nums">{m.NewKhataNo || "—"}</span>, csv: (m) => m.NewKhataNo },
  { id: "approvedNo", label: "Authority's mutation no.", hiddenByDefault: true, cell: (m) => <span className="tabular-nums">{m.ApprovedNo || "—"}</span>, csv: (m) => m.ApprovedNo },
  { id: "approvedOn", label: "Approved on", sortKey: "ApprovedDate", hiddenByDefault: true, cell: (m) => <span className="tabular-nums">{fmtDate(m.ApprovedDate)}</span>, csv: (m) => fmtDate(m.ApprovedDate) },
  { id: "deed", label: "Sale deed", hiddenByDefault: true, cell: (m) => <span className="tabular-nums">{m.DeedNo || "—"}</span>, csv: (m) => m.DeedNo },
  { id: "fee", label: "Fee", sortKey: "MutationFee", align: "right", cell: (m) => <span className="tabular-nums">{fmt(m.MutationFee)}</span>, csv: (m) => m.MutationFee },
];

/** The mutation's stages, read from what is recorded. */
function mutationPath(m: any, docsReady: boolean, required: number, verified: number): { label: string; state: GridPathState; note?: string }[] {
  const approved = m.Status === "Approved";
  const query = m.Status === "QueryRaised";
  return [
    { label: "Sale deed registered", state: "done", note: m.DeedNo ? `Deed ${m.DeedNo}${m.RegistrationNo ? `, registration ${m.RegistrationNo}` : ""}` : undefined },
    { label: "Applied to authority", state: "done", note: `Applied ${fmtDate(m.ApplicationDate)}${m.Authority ? ` to ${m.Authority}` : ""}` },
    {
      label: query ? "Query raised" : "Documents verified", state: query ? "failed" : docsReady || approved ? "done" : "current",
      note: query ? (m.QueryRemarks ? `The authority asked: "${m.QueryRemarks}"` : "The authority raised a query.")
        : required ? `${verified} of ${required} mandatory documents verified.` : "No mandatory document requested yet.",
    },
    { label: "New khata issued", state: approved ? "done" : docsReady && !query ? "current" : "todo", note: approved ? `New khata ${m.NewKhataNo}` : "Approve once the authority issues the new khata." },
  ];
}

const CrmMutation: React.FC = () => {
  const ask = useSheetAsk();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const rights = usePageRights("crm-mutation");
  // Approval Setup ("CRM Mutation Approve") names who approves; a super admin always can. The server says.
  const canApproveMutation = useCanApprove("crm-mutation-approve") && rights.canEdit;
  const [sp] = useSearchParams();
  const deepLinkBookingId = sp.get("bookingId");
  // The open mutation and its tab live in the address, so a refresh or a shared link keeps them.
  const [idParam, setIdParam] = useUrlParam("mutationId");
  const detailId = /^\d+$/.test(idParam) ? Number(idParam) : null;
  const [activeTab, setActiveTab] = useUrlParam<DetailTab>("tab", "Overview", DETAIL_TABS);

  const [pageSize, setPageSize] = useState<number>(GRID_PAGE_SIZES[0]);
  const s = useCrmListState({ pageSize, defaultSort: DEFAULT_SORT, defaultStatus: ALL });
  const [extra, setExtraRaw] = useState<ExtraFilters>(NO_EXTRA);
  const setExtra = (x: Partial<ExtraFilters>) => { setExtraRaw((cur) => ({ ...cur, ...x })); s.setPage(1); };
  const filtered = s.hasFilters || extra.applied.preset !== "any";
  const clearFilters = () => { s.reset(); setExtraRaw(NO_EXTRA); };
  const [selected, setSelected] = useState<Map<string | number, any>>(new Map());
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [bookingId, setBookingId] = useState("");
  const [startForm, setStartForm] = useState(emptyStart);
  const [saving, setSaving] = useState(false);
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

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["crm-mutation", s.query, extra],
    queryFn: () => fetchMutationList(s.query, extra),
    staleTime: 30_000,
  });
  const result = useSticky(data);
  const rows = result?.rows ?? [];
  const total = result?.total ?? 0;
  const counts = result?.statusCounts ?? {};
  const allCount = Object.values(counts).reduce((n, x) => n + x, 0);
  const { data: startableBookings = [] } = useQuery({ queryKey: ["crm-mutation-eligible"], queryFn: fetchEligible, staleTime: 60_000, enabled: rights.canCreate });
  const [prefs, setPrefs] = useGridPrefs(PREFS_KEY, MUTATION_COLS);

  const { data: detailData, isError: detailIsError, error: detailError } = useQuery({
    queryKey: ["crm-mutation-detail", detailId],
    queryFn: async () => {
      const r = await fetchWithAuth(`${API}/${detailId}`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error || `Could not load the mutation (${r.status}).`);
      return d;
    },
    enabled: detailId != null,
    staleTime: 15_000,
    retry: false,
  });
  const detail = detailData?.mutation ?? (detailId != null ? rows.find((r: any) => r.Id === detailId) : null);
  const documents: any[] = detailData?.documents || [];
  const history: any[] = detailData?.history || [];

  const selectDetail = (id: number) => { setIdParam(String(id)); setActiveTab("Overview"); };
  const backToList = () => { setIdParam(""); setActiveTab("Overview"); };

  // ?bookingId opens the booking's mutation (found on the server), or the Start dialog when it has none and is eligible.
  useEffect(() => {
    if (deepLinkDone || !deepLinkBookingId || detailId != null) return;
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
  }, [deepLinkBookingId, detailId, deepLinkDone, startableBookings.length, rights.canCreate]);

  const invalidateDetail = () => qc.invalidateQueries({ queryKey: ["crm-mutation-detail", detailId] });
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["crm-mutation"] });
    qc.invalidateQueries({ queryKey: ["crm-mutation-eligible"] });
    qc.invalidateQueries({ queryKey: ["crm-booking-lifecycle"] });
    qc.invalidateQueries({ queryKey: ["crm-legal-milestones"] });
    if (detailId) invalidateDetail();
  };

  const send = async (url: string, method: string, body?: any) => {
    const res = await fetchWithAuth(url, body instanceof FormData ? { method, body } : {
      method, headers: { "Content-Type": "application/json" }, body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || `Request failed (${res.status})`);
    return d;
  };

  const handleStart = async () => {
    if (!bookingId) { toast.error("Booking is required"); return; }
    setSaving(true);
    try {
      const d = await send(API, "POST", { BookingId: parseInt(bookingId), ...startForm });
      toast.success(`${d.MutationNo} started`);
      setDialogOpen(false);
      setBookingId("");
      setStartForm(emptyStart());
      invalidate();
      selectDetail(d.id);
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
      invalidate();
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
      invalidate();
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setRequestingDoc(false); }
  };
  const handleReviewDoc = async (docId: number, verify: boolean) => {
    if (detailId == null) return;
    let remarks: string | undefined;
    if (!verify) {
      remarks = (await ask.prompt("Describe what's wrong with this document. The uploader sees this.", { title: "Reject document", okLabel: "Reject", danger: true })) ?? undefined;
      if (!remarks) return;
    }
    try {
      await send(`${API}/${detailId}/documents/${docId}`, "PUT", verify ? { Status: "Verified" } : { Status: "Rejected", Remarks: remarks });
      toast.success(verify ? "Document verified" : "Document rejected");
      invalidate();
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

  const runExport = async () => {
    setExporting(true); setExportError(null);
    try { exportGrid(await fetchAllMutations(s.query, extra), gridVisibleCols(MUTATION_COLS, prefs), `mutations-${s.status.toLowerCase()}`); }
    catch (e) { setExportError((e as Error).message); } finally { setExporting(false); }
  };
  const exportSelected = () => exportGrid([...selected.values()], gridVisibleCols(MUTATION_COLS, prefs), `mutations-selected-${selected.size}`);
  const copySelected = async () => {
    try { await navigator.clipboard.writeText([...selected.values()].map((m) => m.MutationNo).join("\n")); toast.success(`Copied ${selected.size} mutation number${selected.size === 1 ? "" : "s"}`); }
    catch { toast.error("Could not copy. Your browser blocked the clipboard."); }
  };

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
        ? <span className="inline-flex items-center gap-1 h-5 px-2 rounded-full border border-dashed border-border text-[0.6875rem] text-muted-foreground"><Link2 size={10} /> Synced from registry</span>
        : undefined} />
  );

  const tabs = [ALL, "Applied", "QueryRaised", "Approved"].map((k) => ({ key: k, label: k === ALL ? "All" : statusText(k), count: result ? (k === ALL ? allCount : counts[k] ?? 0) : null }));

  // What the open mutation is waiting on, and the one action that moves it on.
  const guidance = !detail ? null : detail.Status === "Approved" ? {
    tone: "done" as const, title: `Approved ${fmtDate(detail.ApprovedDate)}`, text: `New khata ${detail.NewKhataNo}${detail.ApprovedNo ? ` · authority's mutation no. ${detail.ApprovedNo}` : ""}. The municipal records now carry the buyer's name.`,
  } : detail.Status === "QueryRaised" ? {
    tone: "stopped" as const, title: "The authority raised a query", text: `${detail.QueryRemarks ? `"${detail.QueryRemarks}". ` : ""}Correct and re-verify the flagged documents (${verifiedCount}/${required.length} verified), then resubmit.`,
  } : !required.length ? {
    tone: "waiting" as const, title: "Ask for the application form", text: "No mandatory document has been requested yet, so the mutation can't be approved. Request the application form on the Documents tab.",
  } : !docsReady ? {
    tone: "waiting" as const, title: "Verify the documents", text: `${verifiedCount} of ${required.length} mandatory documents verified. Attach and verify the rest on the Documents tab.`,
  } : {
    tone: "moving" as const, title: "Waiting for the authority", text: "Every mandatory document is verified. When the authority issues the new khata, approve the mutation; if they raise a query, record it.",
  };
  const guidanceTone = { done: "border-emerald-500/30 bg-emerald-500/5", stopped: "border-rose-500/30 bg-rose-500/5", waiting: "border-amber-500/30 bg-amber-500/5", moving: "border-primary/30 bg-primary/5" };
  const GuidanceIcon = !guidance ? Info : guidance.tone === "done" ? CheckCircle2 : guidance.tone === "stopped" ? AlertTriangle : Info;

  const actions = detail && (
    <>
      {detail.Status === "Applied" && rights.canEdit && (
        <button type="button" onClick={() => setQueryOpen(true)} className={cn(GRID_BTN, "text-destructive hover:bg-destructive/5")}><AlertTriangle size={13} /> Raise query</button>
      )}
      {detail.Status === "QueryRaised" && rights.canEdit && (
        <button type="button" onClick={handleResubmit} disabled={!docsReady || busy} title={!docsReady ? "Fix and verify the flagged documents first" : undefined} className={GRID_BTN_BRAND}>
          <Send size={13} /> Resubmit to authority
        </button>
      )}
      {detail.Status === "Applied" && (canApproveMutation ? (
        <button type="button" onClick={() => { setApproveForm({ ApprovedNo: "", ApprovedDate: localDay(), NewKhataNo: "" }); setApproveOpen(true); }}
          disabled={!docsReady} title={!docsReady ? "Verify the mandatory documents first" : undefined} className={GRID_BTN_BRAND}>
          <CheckCircle2 size={13} /> Approve
        </button>
      ) : rights.canEdit ? <span className="text-xs text-muted-foreground">Approving needs the Legal head or an admin</span> : null)}
      <button type="button" className={GRID_BTN} onClick={() => navigate(`/crm/bookings?view=${detail.BookingId}`)}><Home size={13} /> Open booking</button>
    </>
  );

  return (
    <>
      <Breadcrumbs items={detailId != null ? ["Dashboard", "CRM", "Property Mutation", "Record"] : ["Dashboard", "CRM", "Property Mutation"]} />
      {ask.node}
      <CrmAppPage icon={Landmark} section="CRM · Legal & Possession" title="Property Mutation"
        subtitle={detailId != null ? undefined : "Khata transfer: the application that puts the buyer's name on the municipal land records, once the sale deed is registered."}
        actions={<>
          {detailId != null && <button type="button" onClick={backToList} className={GRID_BTN}><ArrowLeft size={13} /> All mutations</button>}
          {/* The server starts a mutation under the create right. */}
          {rights.canCreate && <button type="button" onClick={() => setDialogOpen(true)} className={GRID_BTN_BRAND}><Plus size={13} /> Start mutation</button>}
        </>}>

        {/* The list stays mounted while a record is open, so its tab, search, filters, sort and page survive the round trip. */}
        <div hidden={detailId != null} className={cn(GRID_CARD, "overflow-hidden")}>
          <div className="px-4 pt-3 pb-2">
            <h2 className="text-base font-bold leading-tight">{s.status === ALL ? "All mutations" : statusText(s.status)}</h2>
            <p className="text-xs text-muted-foreground mt-0.5">{gridListMeta(total, MUTATION_COLS, s.sort, filtered)}</p>
          </div>
          <GridTabs label="Status" tabs={tabs} active={s.status} onChange={s.setStatus} />
          <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-border border-b border-border">
            <GridMetric label="Mutations" value={total.toLocaleString("en-IN")} />
            <GridMetric label="With the authority" value={(counts.Applied ?? 0).toLocaleString("en-IN")} />
            <GridMetric label="Query raised" value={<span className={(counts.QueryRaised ?? 0) > 0 ? "text-destructive" : ""}>{(counts.QueryRaised ?? 0).toLocaleString("en-IN")}</span>} />
            <GridMetric label="Mutation fees" value={fmt(result?.summary.feeTotal ?? 0)} strong />
          </div>

          {selected.size > 0 && (
            <GridBulkBar count={selected.size} onClear={() => setSelected(new Map())}>
              <button type="button" className={GRID_BTN} onClick={exportSelected}><Download size={13} /> Export selected</button>
              <button type="button" className={GRID_BTN} onClick={copySelected}><Copy size={13} /> Copy numbers</button>
            </GridBulkBar>
          )}

          <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-border bg-muted/30">
            <GridSearch value={s.searchInput} onChange={s.setSearchInput} placeholder="Search customer, booking, unit, mutation no." />
            <CrmCompanyProjectBlockFilter value={s.cpb} onChange={s.setCpb} />
            <GridDateFilter label="Applied" value={extra.applied} onChange={(v) => setExtra({ applied: v })} />
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
                  setExtraRaw({ applied: x.applied?.preset ? x.applied : GRID_ANY_DATE });
                }} />
              <GridColumnChooser cols={MUTATION_COLS} prefs={prefs} onChange={setPrefs} />
              <button type="button" className={GRID_BTN} onClick={runExport} disabled={exporting || total === 0} title="Export to Excel">
                <Download size={13} /> <span className="hidden md:inline">{exporting ? "Exporting…" : "Export"}</span>
              </button>
            </div>
          </div>

          <CrmGrid cols={MUTATION_COLS} prefs={prefs} onPrefs={setPrefs} rows={rows} rowKey={(m) => m.Id}
            loading={isLoading} fetching={isFetching} error={error ? (error as Error).message : null} onRetry={() => refetch()}
            sort={s.sort} onSort={s.toggleSort} onRowClick={(m) => selectDetail(m.Id)} activeKey={detailId}
            selected={selected} onSelect={setSelected}
            empty={filtered ? "No mutation matches these filters." : "No mutation yet. Start one once a booking's sale deed is registered."}
            page={s.page} pageSize={pageSize} total={total} onPage={s.setPage} onPageSize={(n) => { setPageSize(n); s.setPage(1); }} />
        </div>

        {detailId != null && (
          detailIsError && !detail ? (
            <div className={cn(GRID_CARD, "py-16 text-center text-sm text-destructive")}>{(detailError as Error)?.message}</div>
          ) : !detail ? (
            <div className={cn(GRID_CARD, "py-16 text-center text-sm text-muted-foreground")}>Loading…</div>
          ) : (
            <div className="space-y-4">
              <GridHighlights icon={Landmark} object={`Mutation · ${detail.MutationNo}`}
                title={<ApplicantNames name={detail.ApplicantName} bookingId={detail.BookingId} applicationId={detail.ApplicationId} />}
                status={<GridStatusPill status={detail.Status} label={statusText(detail.Status)} />}
                sub={[detail.BookingNo, [detail.ProjectName, detail.UnitNo].filter(Boolean).join(" · ")].filter(Boolean).join(" · ")}
                actions={actions}
                fields={[
                  { label: "Authority", value: detail.Authority || "—" },
                  { label: "Applied on", value: fmtDate(detail.ApplicationDate) },
                  { label: detail.Status === "Approved" ? "Days taken" : "Days with authority", value: daysOpen(detail) ?? "—" },
                  { label: "Documents", value: <DocsProgress verified={verifiedCount} required={required.length} /> },
                  { label: "Khata", value: `${detail.OldKhataNo || "—"} → ${detail.NewKhataNo || "pending"}` },
                  { label: "Mutation fee", value: fmt(detail.MutationFee) },
                ]} />

              <GridPath steps={mutationPath(detail, docsReady, required.length, verifiedCount)} />

              {guidance && (
                <div className={cn("rounded-lg border px-4 py-3 flex items-start gap-3", guidanceTone[guidance.tone])}>
                  <GuidanceIcon size={18} className={cn("shrink-0 mt-0.5", guidance.tone === "stopped" ? "text-destructive" : guidance.tone === "done" ? "text-emerald-600" : "text-primary")} />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{guidance.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{guidance.text}</p>
                  </div>
                  {!locked && required.length > 0 && !docsReady && activeTab !== "Documents" && (
                    <button type="button" className={cn(GRID_BTN, "ml-auto shrink-0")} onClick={() => setActiveTab("Documents")}>Go to documents</button>
                  )}
                  {!locked && !required.length && canDocs && (
                    <button type="button" className={cn(GRID_BTN_BRAND, "ml-auto shrink-0")} disabled={requestingDoc}
                      onClick={() => handleRequestDoc("MutationApplicationForm", "Mutation Application Form")}>
                      {requestingDoc ? "Requesting…" : "Request application form"}
                    </button>
                  )}
                </div>
              )}

              <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem] items-start">
                <section className={cn(GRID_CARD, "overflow-hidden min-w-0")}>
                  <GridTabs label="Mutation record" active={activeTab} onChange={setActiveTab} tabs={[
                    { key: "Overview", label: "Overview" },
                    { key: "Documents", label: "Documents", count: documents.length },
                    { key: "History", label: "History", count: history.length },
                  ]} />

                  {activeTab === "Overview" && (
                    <>
                      <h3 className="px-4 pt-3 text-xs font-semibold text-muted-foreground">Application</h3>
                      <GridFields fields={[
                        { label: "Application no.", value: <span className="tabular-nums">{detail.ApplicationNo || "—"}</span> },
                        { label: "Applied on", value: <span className="tabular-nums">{fmtDate(detail.ApplicationDate)}</span> },
                        { label: "Authority", value: detail.Authority || "—" },
                        { label: "Mutation fee", value: <span className="tabular-nums">{fmt(detail.MutationFee)}</span> },
                        { label: "Old khata no.", value: <span className="tabular-nums">{detail.OldKhataNo || "—"}</span> },
                        { label: "New khata no.", value: <span className="tabular-nums">{detail.NewKhataNo || "Issued on approval"}</span> },
                        ...(detail.Status === "Approved" ? [
                          { label: "Authority's mutation no.", value: <span className="tabular-nums">{detail.ApprovedNo || "—"}</span> },
                          { label: "Approved on", value: <span className="tabular-nums">{fmtDate(detail.ApprovedDate)}</span> },
                        ] : []),
                        ...(detail.QueryRemarks ? [{ label: "Last query from the authority", value: <span className="whitespace-pre-line">{detail.QueryRemarks}</span>, wide: true }] : []),
                      ]} />
                      <h3 className="px-4 pt-3 text-xs font-semibold text-muted-foreground">Property and sale deed</h3>
                      <GridFields fields={[
                        { label: "Buyer", value: <ApplicantNames name={detail.ApplicantName} bookingId={detail.BookingId} applicationId={detail.ApplicationId} /> },
                        { label: "Mobile", value: <span className="tabular-nums">{detail.Mobile || "—"}</span> },
                        { label: "Booking", value: <span className="tabular-nums">{detail.BookingNo}</span> },
                        { label: "Project · unit", value: [detail.ProjectName, detail.UnitNo].filter(Boolean).join(" · ") || "—" },
                        { label: "Sale deed", value: <span className="tabular-nums">{detail.DeedNo || "—"}{detail.RegistrationNo ? ` · reg. ${detail.RegistrationNo}` : ""}</span> },
                        { label: "Sub-registrar office", value: detail.SubRegistrarOffice || "—" },
                      ]} />
                    </>
                  )}

                  {activeTab === "Documents" && (
                    <>
                      <div className="px-4 h-10 flex items-center justify-between border-b border-border">
                        <h3 className="text-[0.8125rem] font-bold">Required documents</h3>
                        <DocsProgress verified={verifiedCount} required={required.length} />
                      </div>
                      {required.length === 0 ? (
                        <div className="px-4 py-4 flex items-center justify-between gap-3 flex-wrap">
                          <p className="text-xs text-muted-foreground">No mandatory document requested yet. Approval waits until one is requested and verified.</p>
                          {canDocs && (
                            <button type="button" onClick={() => handleRequestDoc("MutationApplicationForm", "Mutation Application Form")} disabled={requestingDoc} className={GRID_BTN_BRAND}>
                              {requestingDoc ? "Requesting…" : "Request application form"}
                            </button>
                          )}
                        </div>
                      ) : required.map(docRow)}

                      <div className="px-4 h-10 flex items-center border-y border-border mt-2">
                        <h3 className="text-[0.8125rem] font-bold">Supporting documents</h3>
                      </div>
                      {supporting.length > 0 ? supporting.map(docRow) : <p className="px-4 py-3 text-xs text-muted-foreground">None added.</p>}
                      {canDocs && (
                        <div className="p-4 border-t border-border bg-muted/20">
                          <p className="text-xs font-semibold">Add a supporting document</p>
                          <p className="text-xs text-muted-foreground mb-2">Reference only. Anything approval checks goes through the required list above.</p>
                          <div className="flex items-end gap-2 flex-wrap">
                            <label className="flex-1 min-w-[9rem] space-y-1">
                              <span className={cn("block", GRID_LABEL)}>Type</span>
                              <select value={newDocType} onChange={(e) => setNewDocType(e.target.value)} className={GRID_INPUT}>
                                <option value="IdentityProof">Identity proof</option>
                                <option value="Other">Other</option>
                              </select>
                            </label>
                            <label className="flex-1 min-w-[9rem] space-y-1">
                              <span className={cn("block", GRID_LABEL)}>Label (optional)</span>
                              <input className={GRID_INPUT} value={newDocLabel} onChange={(e) => setNewDocLabel(e.target.value)} placeholder="e.g. Aadhaar copy" />
                            </label>
                            <input type="file" className="hidden" ref={fileInputRef} onChange={(e) => e.target.files?.[0] && handleUploadDoc(e.target.files[0], newDocType, newDocLabel)} />
                            <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploadingDoc} className={GRID_BTN_BRAND}>
                              <Upload size={13} /> {uploadingDoc ? "Uploading…" : "Upload"}
                            </button>
                          </div>
                        </div>
                      )}
                    </>
                  )}

                  {activeTab === "History" && (
                    history.length > 0 ? (
                      <ol className="px-4 py-4 relative ml-3 border-l border-border space-y-4">
                        {history.map((log: any) => (
                          <li key={log.Id} className="relative pl-5">
                            <span className="absolute -left-[9px] top-0.5 w-[18px] h-[18px] rounded-full border border-border bg-card flex items-center justify-center text-muted-foreground"><ScrollText size={10} /></span>
                            <div className="flex items-baseline justify-between gap-2 flex-wrap">
                              <span className="text-[0.8125rem] font-semibold">{log.Action}</span>
                              <span className="text-xs text-muted-foreground tabular-nums">{log.CreatedAt ? new Date(log.CreatedAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—"}</span>
                            </div>
                            <div className="text-xs text-muted-foreground mt-0.5">By {log.ActorName || "System"}{log.ActorType ? ` · ${log.ActorType}` : ""}</div>
                            {log.Remarks && <p className="mt-1 text-xs rounded-md bg-muted/60 px-2 py-1.5 whitespace-pre-line">{log.Remarks}</p>}
                          </li>
                        ))}
                      </ol>
                    ) : <p className="px-4 py-8 text-center text-xs text-muted-foreground">No history recorded yet.</p>
                  )}
                </section>

                <aside className="space-y-4 min-w-0 xl:sticky xl:top-4">
                  <GridRelated icon={FolderCheck} title="Documents" count={required.length}
                    action={activeTab !== "Documents" ? <button type="button" className={cn(GRID_BTN, "h-7")} onClick={() => setActiveTab("Documents")}>Open</button> : undefined}>
                    {required.length === 0 ? <p className="px-4 py-4 text-xs text-muted-foreground">None requested yet.</p> : (
                      <ul>
                        {required.map((d) => (
                          <li key={d.Id} className="px-4 py-2 flex items-center justify-between gap-2 border-b border-border/70 last:border-0">
                            <span className="text-xs truncate">{d.Label || d.DocumentType}</span>
                            <GridStatusPill status={d.Status} />
                          </li>
                        ))}
                      </ul>
                    )}
                  </GridRelated>
                  <GridRelated icon={History} title="Latest activity" count={history.length}
                    action={history.length > 3 && activeTab !== "History" ? <button type="button" className={cn(GRID_BTN, "h-7")} onClick={() => setActiveTab("History")}>View all</button> : undefined}>
                    {history.length === 0 ? <p className="px-4 py-4 text-xs text-muted-foreground">Nothing yet.</p> : (
                      <ul>
                        {history.slice(0, 3).map((log: any) => (
                          <li key={log.Id} className="px-4 py-2 border-b border-border/70 last:border-0">
                            <div className="text-xs font-semibold">{log.Action}</div>
                            <div className="text-[0.6875rem] text-muted-foreground">{log.ActorName || "System"} · {fmtDate(log.CreatedAt)}</div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </GridRelated>
                  <GridRelated icon={FileText} title="Sale deed">
                    <GridFields fields={[
                      { label: "Deed no.", value: <span className="tabular-nums">{detail.DeedNo || "—"}</span> },
                      { label: "Registration", value: <span className="tabular-nums">{detail.RegNo || detail.RegistrationNo || "—"}</span> },
                    ]} />
                  </GridRelated>
                </aside>
              </div>
            </div>
          )
        )}
      </CrmAppPage>

      {/* Start mutation */}
      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) { setDialogOpen(false); setBookingId(""); } }}>
        <DialogContent className="max-w-md p-5 gap-4">
          <DialogHeader><DialogTitle>Start mutation</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <label className="block space-y-1">
              <span className={cn("block font-medium", GRID_LABEL)}>Booking <span className="text-destructive">*</span></span>
              <SearchableNativeSelect value={bookingId} onChange={(e) => setBookingId(e.target.value)} className={cn(GRID_INPUT, "text-sm")}>
                <option value="">Select booking</option>
                {startableBookings.map((b: any) => (
                  <option key={b.Id} value={String(b.Id)}>{`${b.BookingNo} — ${b.ApplicantName}`}</option>
                ))}
              </SearchableNativeSelect>
              <span className="block text-[0.6875rem] text-muted-foreground">{startableBookings.length ? "Only bookings whose sale deed registry is complete are listed." : "No booking is eligible yet: the sale deed registry must be completed first."}</span>
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block space-y-1">
                <span className={cn("block font-medium", GRID_LABEL)}>Application no.</span>
                <input className={cn(GRID_INPUT, "text-sm")} value={startForm.ApplicationNo} onChange={(e) => setStartForm((f) => ({ ...f, ApplicationNo: e.target.value }))} placeholder="Optional" />
              </label>
              <label className="block space-y-1">
                <span className={cn("block font-medium", GRID_LABEL)}>Application date</span>
                <DateInput value={startForm.ApplicationDate} max={localDay()} onChange={(e) => setStartForm((f) => ({ ...f, ApplicationDate: e.target.value }))} className={cn(GRID_INPUT, "text-sm")} />
              </label>
            </div>
            <label className="block space-y-1">
              <span className={cn("block font-medium", GRID_LABEL)}>Authority</span>
              <input className={cn(GRID_INPUT, "text-sm")} value={startForm.Authority} onChange={(e) => setStartForm((f) => ({ ...f, Authority: e.target.value }))} placeholder="e.g. GHMC, MCGM, BDA" />
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block space-y-1">
                <span className={cn("block font-medium", GRID_LABEL)}>Old khata no.</span>
                <input className={cn(GRID_INPUT, "text-sm")} value={startForm.OldKhataNo} onChange={(e) => setStartForm((f) => ({ ...f, OldKhataNo: e.target.value }))} />
              </label>
              <label className="block space-y-1">
                <span className={cn("block font-medium", GRID_LABEL)}>Mutation fee</span>
                <input type="number" className={cn(GRID_INPUT, "text-sm tabular-nums")} value={startForm.MutationFee} onChange={(e) => setStartForm((f) => ({ ...f, MutationFee: e.target.value }))} />
              </label>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <button type="button" onClick={() => { setDialogOpen(false); setBookingId(""); }} className={GRID_BTN}>Cancel</button>
            <button type="button" onClick={handleStart} disabled={saving || !bookingId} className={GRID_BTN_BRAND}>{saving ? "Starting…" : "Start mutation"}</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Raise query */}
      <Dialog open={queryOpen} onOpenChange={(o) => !o && setQueryOpen(false)}>
        <DialogContent className="max-w-sm p-5 gap-4">
          <DialogHeader><DialogTitle>Raise query</DialogTitle></DialogHeader>
          <label className="block space-y-1">
            <span className={cn("block font-medium", GRID_LABEL)}>What did the authority flag? <span className="text-destructive">*</span></span>
            <textarea value={queryRemarks} onChange={(e) => setQueryRemarks(e.target.value)} rows={4} className={cn(GRID_INPUT, "h-auto py-2 text-sm resize-none")} />
            <span className="block text-[0.6875rem] text-muted-foreground">The mandatory documents are reset, so staff correct and reattach them before resubmitting.</span>
          </label>
          <DialogFooter className="gap-2">
            <button type="button" onClick={() => setQueryOpen(false)} className={GRID_BTN}>Cancel</button>
            <button type="button" onClick={handleQuery} disabled={busy || !queryRemarks.trim()} className={cn(GRID_BTN_BRAND, "bg-destructive border-destructive hover:bg-destructive/90")}>{busy ? "Saving…" : "Record query"}</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Approve */}
      <Dialog open={approveOpen} onOpenChange={(o) => !o && setApproveOpen(false)}>
        <DialogContent className="max-w-sm p-5 gap-4">
          <DialogHeader><DialogTitle>Approve mutation</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <label className="block space-y-1">
              <span className={cn("block font-medium", GRID_LABEL)}>New khata no. <span className="text-destructive">*</span></span>
              <input className={cn(GRID_INPUT, "text-sm tabular-nums")} value={approveForm.NewKhataNo} onChange={(e) => setApproveForm((f) => ({ ...f, NewKhataNo: e.target.value }))} placeholder="e.g. 456/2026" />
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block space-y-1">
                <span className={cn("block font-medium", GRID_LABEL)}>Authority's mutation no.</span>
                <input className={cn(GRID_INPUT, "text-sm tabular-nums")} value={approveForm.ApprovedNo} onChange={(e) => setApproveForm((f) => ({ ...f, ApprovedNo: e.target.value }))} />
              </label>
              <label className="block space-y-1">
                <span className={cn("block font-medium", GRID_LABEL)}>Approved date</span>
                <DateInput value={approveForm.ApprovedDate} max={localDay()} onChange={(e) => setApproveForm((f) => ({ ...f, ApprovedDate: e.target.value }))} className={cn(GRID_INPUT, "text-sm")} />
              </label>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <button type="button" onClick={() => setApproveOpen(false)} className={GRID_BTN}>Cancel</button>
            <button type="button" onClick={handleApprove} disabled={busy || !approveForm.NewKhataNo.trim()} className={GRID_BTN_BRAND}>{busy ? "Saving…" : "Confirm approval"}</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preview */}
      <Dialog open={!!previewDoc} onOpenChange={(o) => { if (!o) closePreview(); }}>
        <DialogContent className="max-w-3xl p-0 gap-0 overflow-hidden">
          <DialogHeader className="px-4 py-2.5 border-b border-border">
            <DialogTitle className="text-sm truncate">{previewDoc?.name}</DialogTitle>
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
    </>
  );
};

export default CrmMutation;
