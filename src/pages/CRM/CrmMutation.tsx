import React, { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { CrmShell } from "@/components/crm/CrmShell";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { translateError } from "@/lib/translateError";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { RefreshButton } from "@/components/ui/RefreshButton";
import {
  Plus, CheckCircle2, Upload, Download, Eye, Loader2, AlertTriangle,
  File as FileIcon, FileImage, FileText as FileTextIcon, History, ScrollText, Link2, Landmark,
  ChevronRight,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/contexts/AuthContext";
import { CrmCompanyProjectBlockFilter } from "@/components/crm/CrmCompanyProjectBlockFilter";
import { DateInput } from "@/components/ui/date-input";
import { SearchableNativeSelect } from "@/components/SearchableNativeSelect";
import { ApplicantNames } from "@/components/crm/ApplicantNames";
import { CrmDataTable, type CrmColumn } from "@/components/crm/CrmDataTable";
import { CrmListToolbar, type CrmStatusTab } from "@/components/crm/CrmListToolbar";
import { CrmSideDrawer } from "@/components/crm/CrmSideDrawer";
import { useCrmListState, useSticky, listParams, type CrmListQuery } from "@/hooks/useCrmListState";

const API = "/api/crm/mutation";

const STATUS_CONFIG: Record<string, { label: string; badgeCls: string; accent: string }> = {
  Applied:     { label: "Applied",      badgeCls: "text-sky-600 bg-sky-50 border-sky-200",         accent: "border-l-sky-400" },
  QueryRaised: { label: "Query Raised", badgeCls: "text-orange-600 bg-orange-50 border-orange-200", accent: "border-l-orange-400" },
  Approved:    { label: "Approved",     badgeCls: "text-emerald-600 bg-emerald-50 border-emerald-200", accent: "border-l-emerald-500" },
};

const DOC_STATUS_COLOR: Record<string, string> = {
  Requested: 'text-sky-600 bg-sky-50 border-sky-200',
  Uploaded:  'text-blue-600 bg-blue-50 border-blue-200',
  Verified:  'text-emerald-600 bg-emerald-50 border-emerald-200',
  Rejected:  'text-red-600 bg-red-50 border-red-200',
};

function isSynced(doc: any): boolean {
  return !!doc.Remarks?.startsWith('Synced automatically');
}

function docNextStep(doc: any): string {
  if (isSynced(doc)) return "Pulled from the Registry's own verified copy — nothing to do here.";
  if (doc.Status === 'Verified') return 'Checked and accepted.';
  if (doc.Status === 'Rejected') return 'Rejected — attach a corrected file.';
  if (doc.Status === 'Uploaded') return 'Uploaded — awaiting staff review.';
  return doc.IsMandatory ? 'Required — attach a file to proceed.' : 'Requested — attach a file.';
}

function mimeIcon(mime: string | null | undefined) {
  if (!mime) return <FileIcon size={16} className="text-muted-foreground shrink-0" />;
  if (mime.startsWith("image/")) return <FileImage size={16} className="text-blue-500 shrink-0" />;
  if (mime === "application/pdf") return <FileTextIcon size={16} className="text-red-500 shrink-0" />;
  return <FileIcon size={16} className="text-muted-foreground shrink-0" />;
}

function fmtBytes(n: number | null | undefined) {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtDate(d?: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

type DetailTab = "Overview" | "Documents" | "History";

// ── Fetchers (server-side paging) ─────────────────────────────────────────────
interface ListPage { rows: any[]; total: number; counts: Record<string, number> }
async function fetchPage(q: CrmListQuery): Promise<ListPage> {
  const r = await fetchWithAuth(`${API}?${listParams(q)}`);
  if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || `HTTP ${r.status}`); }
  const d = await r.json();
  return { rows: d.rows ?? [], total: d.total ?? 0, counts: d.counts ?? {} };
}
async function fetchEligible(): Promise<any[]> {
  const r = await fetchWithAuth(`${API}/eligible-bookings`);
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error || "Failed to load eligible bookings");
  return r.json();
}

const CRM_MUTATION_APPROVER_ROLES = ["admin", "super_admin", "marketing_head", "legal_head"];

// ── Detail drawer body ───────────────────────────────────────────────────────
interface DetailBodyProps {
  detail: any;
  documents: any[];
  history: any[];
  activeTab: DetailTab;
  setActiveTab: (t: DetailTab) => void;
  canApproveMutation: boolean;
  locked: boolean;
  required: any[];
  supporting: any[];
  verifiedCount: number;
  docsReady: boolean;
  onQuery: () => void;
  onApprove: () => void;
  onResubmit: () => void;
  onUploadDoc: (file: File, documentType: string, label?: string) => void;
  onRequestDoc: (documentType: string, label?: string) => void;
  onVerifyDoc: (docId: number) => void;
  onRejectDoc: (docId: number) => void;
  onPreviewDoc: (doc: any) => void;
  onDownloadDoc: (doc: any) => void;
  previewLoading: number | null;
  uploadingDoc: boolean;
  requestingDoc: boolean;
}

function DetailBody(props: DetailBodyProps) {
  const {
    detail, documents, history, activeTab, setActiveTab, canApproveMutation, locked,
    required, supporting, verifiedCount, docsReady,
    onQuery, onApprove, onResubmit, onUploadDoc, onRequestDoc, onVerifyDoc, onRejectDoc,
    onPreviewDoc, onDownloadDoc, previewLoading, uploadingDoc, requestingDoc,
  } = props;

  const [newDocType, setNewDocType] = useState("Other");
  const [newDocLabel, setNewDocLabel] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const DocRow = ({ doc }: { doc: any }) => (
    <div className="border border-border rounded-lg p-3 text-sm bg-card">
      <div className="flex items-start gap-3">
        <div className="mt-0.5">{mimeIcon(doc.MimeType)}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
            <span className="font-medium">{doc.Label || doc.DocumentType}</span>
            <span className={cn("text-[0.625rem] px-2 py-0.5 rounded-full border font-medium", DOC_STATUS_COLOR[doc.Status] || "bg-muted border-border text-muted-foreground")}>{doc.Status}</span>
            {isSynced(doc) && (
              <span className="text-[0.625rem] px-2 py-0.5 rounded-full border font-medium text-indigo-600 bg-indigo-50 border-indigo-200 flex items-center gap-1">
                <Link2 size={9} /> Synced from Registry
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{docNextStep(doc)}</p>
          {doc.HasFile && <p className="text-xs text-muted-foreground/80 truncate mt-0.5">{doc.FileName} · {fmtBytes(doc.FileSize)}</p>}
          {doc.Status === 'Rejected' && doc.Remarks && (
            <p className="text-xs text-red-600 mt-1 bg-red-50 border border-red-200 rounded px-2 py-1">"{doc.Remarks}"</p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 mt-2 pl-7">
        {doc.HasFile && (doc.MimeType?.startsWith('image/') || doc.MimeType === 'application/pdf') && (
          <button onClick={() => onPreviewDoc(doc)} disabled={previewLoading === doc.Id} className="text-xs text-primary hover:underline flex items-center gap-1 disabled:opacity-50">
            {previewLoading === doc.Id ? <Loader2 size={12} className="animate-spin" /> : <Eye size={12} />} Preview
          </button>
        )}
        {doc.HasFile && (
          <button onClick={() => onDownloadDoc(doc)} className="text-xs text-primary hover:underline flex items-center gap-1">
            <Download size={12} /> Download
          </button>
        )}
        {['Requested', 'Rejected'].includes(doc.Status) && !locked && (
          <>
            <input type="file" className="hidden" id={`doc-attach-${doc.Id}`} onChange={(e) => e.target.files?.[0] && onUploadDoc(e.target.files[0], doc.DocumentType, doc.Label)} />
            <button onClick={() => document.getElementById(`doc-attach-${doc.Id}`)?.click()} className="text-xs btn-module text-white px-2.5 py-1 rounded font-medium ">
              {doc.Status === 'Rejected' ? 'Re-attach File' : 'Attach File'}
            </button>
          </>
        )}
        {doc.HasFile && doc.Status === 'Uploaded' && !locked && (
          <>
            <button onClick={() => onVerifyDoc(doc.Id)} className="text-xs bg-green-50 text-green-700 border border-green-200 px-2.5 py-1 rounded hover:bg-green-100 font-medium">Verify</button>
            <button onClick={() => onRejectDoc(doc.Id)} className="text-xs bg-red-50 text-red-700 border border-red-200 px-2.5 py-1 rounded hover:bg-red-100 font-medium">Reject</button>
          </>
        )}
      </div>
    </div>
  );

  return (
    <div>
      <div className="flex gap-1 border-b border-border mb-4 -mt-1">
        {(["Overview", "Documents", "History"] as DetailTab[]).map((t) => (
          <button key={t} onClick={() => setActiveTab(t)}
            className={cn("px-3 py-2 text-sm font-medium border-b-2 -mb-px", activeTab === t ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}>
            {t}
          </button>
        ))}
      </div>

      {activeTab === "Overview" && (
        <div className="space-y-4">
          {detail.Status === "Applied" && (
            <div className="border border-sky-200 bg-sky-50 rounded-lg p-4">
              <p className="text-sm font-semibold text-sky-800 flex items-center gap-1.5"><Landmark size={14} /> Application pending with the authority</p>
              <p className="text-xs text-sky-700 mt-0.5">
                {required.length > 0 ? `${verifiedCount}/${required.length} mandatory documents verified.` : "No mandatory document requested yet."}
              </p>
              <div className="flex items-center gap-2 mt-2">
                <button onClick={onQuery} className="text-xs border border-sky-300 text-sky-700 px-3 py-1.5 rounded hover:bg-sky-100 font-medium">Raise Query</button>
                {canApproveMutation ? (
                  <button onClick={onApprove} disabled={!docsReady}
                    title={!docsReady ? "Verify the mandatory documents first" : undefined}
                    className="text-xs bg-emerald-600 text-white px-3 py-1.5 rounded hover:bg-emerald-700 font-medium disabled:opacity-50 disabled:cursor-not-allowed">
                    Approve
                  </button>
                ) : (
                  <span className="text-xs text-sky-600 border border-sky-200 bg-sky-50 px-2.5 py-1.5 rounded">Requires Legal Head / Admin</span>
                )}
              </div>
            </div>
          )}
          {detail.Status === "QueryRaised" && (
            <div className="border border-orange-200 bg-orange-50 rounded-lg p-4">
              <p className="text-sm font-semibold text-orange-800 flex items-center gap-1.5"><AlertTriangle size={14} /> Query raised by the authority</p>
              {detail.QueryRemarks && <p className="text-xs text-orange-700 mt-1 bg-white/60 border border-orange-200 rounded px-2 py-1.5">"{detail.QueryRemarks}"</p>}
              <p className="text-xs text-orange-700 mt-2">
                {required.length > 0 ? `${verifiedCount}/${required.length} mandatory documents verified.` : "No mandatory document requested yet."}
              </p>
              <button onClick={onResubmit} disabled={!docsReady}
                title={!docsReady ? "Fix and verify the flagged documents first" : undefined}
                className="mt-2 text-xs btn-module text-white px-3 py-1.5 rounded hover:shadow-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed">
                Resubmit to Authority
              </button>
            </div>
          )}
          {detail.Status === "Approved" && (
            <div className="border border-emerald-200 bg-emerald-50 rounded-lg p-4">
              <p className="text-sm font-semibold text-emerald-800 flex items-center gap-1.5"><CheckCircle2 size={14} /> Mutation Approved {fmtDate(detail.ApprovedDate)}</p>
              <p className="text-xs text-emerald-700 mt-0.5">New Khata No. {detail.NewKhataNo} · Mutation No. {detail.ApprovedNo || "—"}</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4 text-sm">
            <div><p className="text-xs text-muted-foreground">Booking</p><p className="font-medium">{detail.BookingNo}</p></div>
            <div><p className="text-xs text-muted-foreground">Unit</p><p className="font-medium">{detail.UnitNo}</p></div>
            <div><p className="text-xs text-muted-foreground">Sale Deed</p><p className="font-medium">{detail.DeedNo || "—"} {detail.RegistrationNo && `(Reg. ${detail.RegistrationNo})`}</p></div>
            <div><p className="text-xs text-muted-foreground">Application No.</p><p className="font-mono font-medium">{detail.ApplicationNo || "—"}</p></div>
            <div><p className="text-xs text-muted-foreground">Applied On</p><p className="font-medium">{fmtDate(detail.ApplicationDate)}</p></div>
            <div><p className="text-xs text-muted-foreground">Authority</p><p className="font-medium">{detail.Authority || "—"}</p></div>
            <div><p className="text-xs text-muted-foreground">Old Khata No.</p><p className="font-medium">{detail.OldKhataNo || "—"}</p></div>
            <div><p className="text-xs text-muted-foreground">Mutation Fee</p><p className="font-medium">{detail.MutationFee != null ? `₹${Number(detail.MutationFee).toLocaleString('en-IN')}` : "—"}</p></div>
            {detail.Status === "Approved" && (
              <>
                <div><p className="text-xs text-muted-foreground">New Khata No.</p><p className="font-mono font-medium">{detail.NewKhataNo}</p></div>
                <div><p className="text-xs text-muted-foreground">Mutation No.</p><p className="font-mono font-medium">{detail.ApprovedNo || "—"}</p></div>
              </>
            )}
          </div>
        </div>
      )}

      {activeTab === "Documents" && (
        <div className="space-y-5">
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-semibold text-foreground uppercase tracking-wide">Required Documents</h4>
              {required.length > 0 && (
                <span className={cn("text-[0.6875rem] font-semibold", verifiedCount === required.length ? "text-emerald-600" : "text-sky-600")}>{verifiedCount}/{required.length} verified</span>
              )}
            </div>
            {required.length === 0 ? (
              <div className="border border-sky-200 bg-sky-50 rounded-lg p-3 flex items-center justify-between gap-3">
                <p className="text-xs text-sky-800"><span className="font-semibold">No mandatory document requested yet.</span> Approval is blocked until one is requested and verified.</p>
                {!locked && (
                  <button onClick={() => onRequestDoc('MutationApplicationForm', 'Mutation Application Form')} disabled={requestingDoc}
                    className="shrink-0 text-xs bg-sky-600 text-white px-3 py-1.5 rounded hover:bg-sky-700 disabled:opacity-50 font-medium">
                    {requestingDoc ? "Requesting…" : "Request Application Form"}
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-2">{required.map((d) => <DocRow key={d.Id} doc={d} />)}</div>
            )}
          </div>

          <div>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Supporting Documents</h4>
            {supporting.length > 0 ? (
              <div className="space-y-2">{supporting.map((d) => <DocRow key={d.Id} doc={d} />)}</div>
            ) : (
              <p className="text-xs text-muted-foreground italic">None added.</p>
            )}
          </div>

          {!locked && (
            <div className="border border-dashed border-border rounded-lg p-4 bg-muted/20">
              <p className="text-xs font-semibold mb-0.5 text-foreground">Add a Supporting Document</p>
              <p className="text-xs text-muted-foreground mb-2">For reference material only — use the request action above for anything approval needs to check.</p>
              <div className="flex items-end gap-2 flex-wrap">
                <div className="flex-1 min-w-[90px] space-y-1">
                  <label className="text-[0.625rem] font-medium text-muted-foreground">Type</label>
                  <select value={newDocType} onChange={(e) => setNewDocType(e.target.value)} className="w-full h-8 text-xs border border-border rounded px-2 bg-background">
                    <option value="IdentityProof">Identity Proof</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div className="flex-1 min-w-[110px] space-y-1">
                  <label className="text-[0.625rem] font-medium text-muted-foreground">Label (Optional)</label>
                  <Input className="h-8 text-xs" value={newDocLabel} onChange={(e) => setNewDocLabel(e.target.value)} placeholder="e.g. Aadhaar copy" />
                </div>
                <div className="shrink-0 space-y-1">
                  <label className="text-[0.625rem] font-medium text-transparent">.</label>
                  <input type="file" className="hidden" ref={fileInputRef} onChange={(e) => { if (e.target.files?.[0]) { onUploadDoc(e.target.files[0], newDocType, newDocLabel); setNewDocLabel(''); } }} />
                  <button onClick={() => fileInputRef.current?.click()} disabled={uploadingDoc}
                    className="h-8 px-3 text-xs btn-module text-white rounded flex items-center gap-1.5 font-medium disabled:opacity-50">
                    <Upload size={12} /> {uploadingDoc ? "Uploading..." : "Upload"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === "History" && (
        <div className="space-y-0">
          {history.length > 0 ? (
            <div className="relative border-l border-border ml-3 pl-4 space-y-4 py-2">
              {history.map((log: any) => (
                <div key={log.Id} className="relative">
                  <div className="absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full bg-border ring-4 ring-card" />
                  <div className="text-sm">
                    <div className="flex items-baseline gap-2">
                      <span className="font-medium flex items-center gap-1"><ScrollText size={12} /> {log.Action}</span>
                      <span className="text-xs text-muted-foreground">{fmtDate(log.CreatedAt)}</span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">By {log.ActorName || "System"} ({log.ActorType})</div>
                    {log.Remarks && <div className="text-xs bg-muted/30 border border-border rounded p-2 mt-1.5 text-foreground">{log.Remarks}</div>}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-xs text-muted-foreground flex flex-col items-center gap-1"><History size={20} className="opacity-40" />No history recorded yet.</div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
const CrmMutation: React.FC = () => {
  const qc = useQueryClient();
  const { currentUser, canDoAction } = useAuth();
  const canApproveMutation =
    CRM_MUTATION_APPROVER_ROLES.includes(String(currentUser?.role || "").toLowerCase()) ||
    canDoAction("approval-inbox" as any, "edit");
  const [sp, setSp] = useSearchParams();
  const deepLinkBookingId = sp.get("bookingId");
  const mutationIdFilter = sp.get("mutationId");

  const list = useCrmListState({ pageSize: 25, defaultSort: { key: "CreatedAt", dir: "desc" } });
  const { data, isLoading, isError, error, dataUpdatedAt, isFetching, refetch } =
    useQuery({ queryKey: ["crm-mutation", list.query], queryFn: () => fetchPage(list.query), staleTime: 30_000 });
  const pageData = useSticky(data);
  const rows = pageData?.rows ?? [];
  const total = pageData?.total ?? 0;
  const counts = pageData?.counts ?? {};
  const showOnboarding = !isLoading && !isError && (counts.All ?? 0) === 0 && !list.hasFilters;

  const [dialogOpen, setDialogOpen] = useState(false);
  const [bookingId, setBookingId] = useState("");
  const [startForm, setStartForm] = useState({ ApplicationNo: "", ApplicationDate: new Date().toISOString().slice(0, 10), Authority: "", OldKhataNo: "", MutationFee: "" });
  const [saving, setSaving] = useState(false);

  const [detailId, setDetailId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<DetailTab>("Overview");
  const [deepLinkOpened, setDeepLinkOpened] = useState(false);

  const [queryOpen, setQueryOpen] = useState(false);
  const [queryRemarks, setQueryRemarks] = useState("");

  const [approveOpen, setApproveOpen] = useState(false);
  const [approveForm, setApproveForm] = useState({ ApprovedNo: "", ApprovedDate: new Date().toISOString().slice(0, 10), NewKhataNo: "" });

  const [uploadingDoc, setUploadingDoc] = useState(false);
  const [requestingDoc, setRequestingDoc] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<{ url: string; mime: string; name: string } | null>(null);
  const [previewLoading, setPreviewLoading] = useState<number | null>(null);

  // Replaces window.prompt — shared Dialog for document rejection remarks
  const [rejectPrompt, setRejectPrompt] = useState<{
    open: boolean; title: string; value: string; onSubmit: (v: string) => void;
  }>({ open: false, title: "", value: "", onSubmit: () => {} });
  const requestRejectRemarks = (title: string, onSubmit: (v: string) => void) =>
    setRejectPrompt({ open: true, title, value: "", onSubmit });

  const { data: startableBookings = [] } = useQuery({ queryKey: ["crm-mutation-eligible"], queryFn: fetchEligible, staleTime: 60_000 });

  const { data: detailData } = useQuery({
    queryKey: ["crm-mutation-detail", detailId],
    queryFn: async () => {
      if (detailId == null) return null;
      const r = await fetchWithAuth(`${API}/${detailId}`);
      if (!r.ok) return null;
      return r.json();
    },
    enabled: detailId != null,
    staleTime: 15_000,
  });

  const detail = detailData?.mutation ?? (detailId != null ? (rows as any[]).find((r: any) => r.Id === detailId) : null);
  const documents: any[] = detailData?.documents || [];
  const history: any[] = detailData?.history || [];

  const trackedBookingIds = new Set((rows as any[]).map((r: any) => r.BookingId));

  useEffect(() => {
    if (!deepLinkBookingId || dialogOpen || trackedBookingIds.has(parseInt(deepLinkBookingId))) return;
    if (startableBookings.some((b: any) => String(b.Id) === deepLinkBookingId)) {
      setBookingId(deepLinkBookingId);
      setDialogOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkBookingId, rows.length, startableBookings.length]);

  useEffect(() => {
    if (!mutationIdFilter || deepLinkOpened) return;
    setDeepLinkOpened(true);
    selectDetail(parseInt(mutationIdFilter, 10));
    setSp((prev) => { prev.delete("mutationId"); return prev; }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mutationIdFilter, deepLinkOpened]);

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
  };

  const handleStart = async () => {
    if (!bookingId) { toast.error("Booking is required"); return; }
    setSaving(true);
    try {
      const res = await fetchWithAuth(API, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ BookingId: parseInt(bookingId), ...startForm }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`${data.MutationNo} started`);
      setDialogOpen(false);
      setBookingId("");
      setStartForm({ ApplicationNo: "", ApplicationDate: new Date().toISOString().slice(0, 10), Authority: "", OldKhataNo: "", MutationFee: "" });
      invalidate();
      selectDetail(data.id);
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setSaving(false); }
  };

  const handleQuery = async () => {
    if (detailId == null || !queryRemarks.trim()) { toast.error("Remarks are required"); return; }
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${detailId}/query`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ Remarks: queryRemarks.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Query recorded — documents reset for correction");
      setQueryOpen(false); setQueryRemarks("");
      invalidate();
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setSaving(false); }
  };

  const handleResubmit = async () => {
    if (detailId == null) return;
    try {
      const res = await fetchWithAuth(`${API}/${detailId}/resubmit`, { method: "PUT" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Resubmitted to the authority");
      invalidate();
    } catch (e: any) { toast.error(translateError(e.message)); }
  };

  const handleApprove = async () => {
    if (detailId == null) return;
    if (!approveForm.NewKhataNo.trim()) { toast.error("New Khata No. is required"); return; }
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${detailId}/approve`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(approveForm),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Mutation approved — municipal records updated");
      setApproveOpen(false);
      invalidate();
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setSaving(false); }
  };

  const handleUploadDoc = async (file: File, documentType: string, label?: string) => {
    if (detailId == null) return;
    setUploadingDoc(true);
    try {
      const formData = new FormData();
      formData.append('files', file);
      formData.append('DocumentType', documentType);
      if (label) formData.append('Label', label);
      const res = await fetchWithAuth(`${API}/${detailId}/documents/upload`, { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Document uploaded");
      invalidateDetail();
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setUploadingDoc(false); }
  };

  const handleRequestDoc = async (documentType: string, label?: string) => {
    if (detailId == null) return;
    setRequestingDoc(true);
    try {
      const res = await fetchWithAuth(`${API}/${detailId}/documents/request`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ DocumentType: documentType, Label: label, IsMandatory: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Document requested");
      invalidateDetail();
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setRequestingDoc(false); }
  };

  const handleVerifyDoc = async (docId: number) => {
    if (detailId == null) return;
    try {
      const res = await fetchWithAuth(`${API}/${detailId}/documents/${docId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ Status: 'Verified' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Document verified");
      invalidateDetail();
    } catch (e: any) { toast.error(translateError(e.message)); }
  };

  const handleRejectDoc = (docId: number) => {
    if (detailId == null) return;
    requestRejectRemarks("Describe what's wrong with this document (required):", async (remarks) => {
      if (!remarks?.trim()) return;
      try {
        const res = await fetchWithAuth(`${API}/${detailId}/documents/${docId}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ Status: 'Rejected', Remarks: remarks.trim() }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        toast.success("Document rejected");
        invalidateDetail();
      } catch (e: any) { toast.error(translateError(e.message)); }
    });
  };

  const handlePreviewDoc = async (doc: any) => {
    setPreviewLoading(doc.Id);
    try {
      const res = await fetchWithAuth(`${API}/documents/file/${doc.Id}`);
      if (!res.ok) throw new Error("Could not load file");
      const blob = await res.blob();
      setPreviewDoc({ url: URL.createObjectURL(blob), mime: doc.MimeType, name: doc.FileName || doc.DocumentType });
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setPreviewLoading(null); }
  };
  const closePreview = () => { if (previewDoc) URL.revokeObjectURL(previewDoc.url); setPreviewDoc(null); };
  const handleDownloadDoc = async (doc: any) => {
    try {
      const res = await fetchWithAuth(`${API}/documents/file/${doc.Id}`);
      if (!res.ok) throw new Error("Could not download file");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = doc.FileName || doc.DocumentType || 'document';
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) { toast.error(translateError(e.message)); }
  };

  const required = documents.filter((d) => d.IsMandatory);
  const supporting = documents.filter((d) => !d.IsMandatory);
  const verifiedCount = required.filter((d) => d.Status === 'Verified').length;
  const docsReady = required.length > 0 && verifiedCount === required.length;
  const locked = detail?.Status === "Approved";

  const tabs: CrmStatusTab[] = [
    { key: "All",         label: "All",          count: counts.All ?? 0 },
    { key: "Applied",     label: "Applied",      count: counts.Applied ?? 0,     dot: "bg-sky-500" },
    { key: "QueryRaised", label: "Query Raised", count: counts.QueryRaised ?? 0, dot: "bg-orange-400" },
    { key: "Approved",    label: "Approved",     count: counts.Approved ?? 0,    dot: "bg-emerald-500" },
  ];

  const columns: CrmColumn<any>[] = [
    { key: "mutation", header: "Mutation", sortKey: "MutationNo", cell: (r) => (
      <span className="font-mono text-xs font-semibold text-primary whitespace-nowrap">{r.MutationNo}</span>
    ) },
    { key: "applicant", header: "Applicant", sortKey: "ApplicantName", cell: (r) => (
      <span className="font-medium block truncate max-w-[220px]" title={r.ApplicantName}><ApplicantNames name={r.ApplicantName} bookingId={r.BookingId} applicationId={r.ApplicationId} /></span>
    ) },
    { key: "booking", header: "Booking", sortKey: "BookingNo", className: "hidden md:table-cell",
      cell: (r) => <span className="text-xs text-muted-foreground whitespace-nowrap">{r.BookingNo}</span> },
    { key: "unit", header: "Unit", className: "hidden md:table-cell",
      cell: (r) => <span className="text-xs whitespace-nowrap">{r.UnitNo}</span> },
    { key: "status", header: "Status", sortKey: "Status", cell: (r) => {
      const cfg = STATUS_CONFIG[r.Status] ?? STATUS_CONFIG.Applied;
      return <span className={cn("text-[0.6875rem] font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap", cfg.badgeCls)}>{cfg.label}</span>;
    } },
    { key: "authority", header: "Authority", className: "hidden lg:table-cell",
      cell: (r) => <span className="text-xs whitespace-nowrap">{r.Authority || "—"}</span> },
    { key: "applied", header: "Applied", sortKey: "ApplicationDate", className: "hidden lg:table-cell",
      cell: (r) => <span className="text-xs whitespace-nowrap">{fmtDate(r.ApplicationDate)}</span> },
    { key: "actions", header: <span className="sr-only">Actions</span>, align: "right", className: "w-px whitespace-nowrap", cell: () => (
      <ChevronRight size={15} className="text-muted-foreground" />
    ) },
  ];

  return (
    <>
      <Breadcrumbs items={["Dashboard", "CRM", "Property Mutation"]} />
      <CrmShell
        title="Property Mutation — Khata Transfer"
        subtitle="Application to update the municipal land records (Khata) with the new owner's name — can only be done after the Sale Deed is officially registered"
        action={
          <div className="flex items-center gap-3">
            <RefreshButton dataUpdatedAt={dataUpdatedAt} isFetching={isFetching} onRefresh={refetch} />
            <button onClick={() => setDialogOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 btn-module text-white text-sm font-medium rounded-lg ">
              <Plus size={14} /> Start Mutation
            </button>
          </div>
        }
      >
        {!showOnboarding && (
          <div className="space-y-3">
            <CrmListToolbar tabs={tabs} status={list.status} onStatus={list.setStatus}
              searchValue={list.searchInput} onSearch={list.setSearchInput}
              placeholder="Search mutation, applicant, booking, unit…">
              <CrmCompanyProjectBlockFilter value={list.cpb} onChange={list.setCpb} />
            </CrmListToolbar>

            <CrmDataTable
              columns={columns} rows={rows} rowKey={(r) => r.Id}
              loading={isLoading} fetching={isFetching}
              error={isError ? (error as Error)?.message : null} onRetry={() => refetch()}
              sort={list.sort} onSort={list.toggleSort}
              onRowClick={(r) => selectDetail(r.Id)} activeKey={detailId}
              rowAccent={(r) => (STATUS_CONFIG[r.Status] ?? STATUS_CONFIG.Applied).accent}
              empty={<>No mutation trackers match these filters. <button onClick={list.reset} className="text-primary hover:underline ml-1">Clear filters</button></>}
              page={list.page} pageSize={list.pageSize} total={total} onPage={list.setPage}
            />
          </div>
        )}

        {showOnboarding && (
          <div className="p-8 rounded-xl border-2 border-dashed border-border bg-muted/10 text-center space-y-3">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
              <Landmark size={26} className="text-primary" />
            </div>
            <div>
              <p className="font-semibold text-foreground">No mutation trackers yet</p>
              <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto leading-relaxed">
                Start one once a booking's Sale Deed Registry is Completed.
              </p>
            </div>
            <button onClick={() => setDialogOpen(true)}
              className="flex items-center gap-1.5 text-sm px-4 py-2 btn-module text-white rounded-lg font-semibold mx-auto">
              <Plus size={13} /> Start Mutation
            </button>
          </div>
        )}

        {/* Start Mutation */}
        <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) { setDialogOpen(false); setBookingId(""); } }}>
          <DialogContent accent="crm" className="max-w-sm">
            <DialogHeader><DialogTitle className="font-heading">Start Mutation</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Booking *</label>
                <SearchableNativeSelect value={bookingId} onChange={(e) => setBookingId(e.target.value)} className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                  <option value="">Select booking</option>
                  {startableBookings.map((b: any) => (
                    <option key={b.Id} value={String(b.Id)}>{b.BookingNo} — {b.ApplicantName}</option>
                  ))}
                </SearchableNativeSelect>
                <p className="text-[0.6875rem] text-muted-foreground mt-1">Requires Sale Deed Registry to be Completed.</p>
                {!startableBookings.length && <p className="text-[0.6875rem] text-sky-600 mt-1">No bookings are eligible yet — Sale Deed Registry must be Completed first.</p>}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Application No</label>
                  <Input value={startForm.ApplicationNo} onChange={(e) => setStartForm((f) => ({ ...f, ApplicationNo: e.target.value }))} placeholder="Optional" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Application Date</label>
                  <DateInput value={startForm.ApplicationDate} onChange={(e) => setStartForm((f) => ({ ...f, ApplicationDate: e.target.value }))}
                    className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Authority</label>
                <Input value={startForm.Authority} onChange={(e) => setStartForm((f) => ({ ...f, Authority: e.target.value }))} placeholder="e.g. GHMC, MCGM, BDA" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Old Khata No.</label>
                  <Input value={startForm.OldKhataNo} onChange={(e) => setStartForm((f) => ({ ...f, OldKhataNo: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Mutation Fee</label>
                  <Input type="number" min={0} value={startForm.MutationFee} onChange={(e) => setStartForm((f) => ({ ...f, MutationFee: e.target.value }))} />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-3 border-t border-border">
              <button onClick={() => { setDialogOpen(false); setBookingId(""); }} className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
              <button onClick={handleStart} disabled={saving || !bookingId} className="px-4 py-1.5 text-sm btn-module text-white rounded-lg font-medium hover:shadow-lg disabled:opacity-40">
                {saving ? "Starting..." : "Start"}
              </button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Raise Query */}
        <Dialog open={queryOpen} onOpenChange={(o) => !o && setQueryOpen(false)}>
          <DialogContent accent="crm" className="max-w-sm">
            <DialogHeader><DialogTitle className="font-heading">Raise Query</DialogTitle></DialogHeader>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">What did the authority flag? *</label>
              <textarea value={queryRemarks} onChange={(e) => setQueryRemarks(e.target.value)} className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background min-h-[80px]" />
              <p className="text-[0.6875rem] text-muted-foreground mt-1">Mandatory documents will be reset so staff must genuinely correct and reattach them before resubmitting.</p>
            </div>
            <div className="flex justify-end gap-2 pt-3 border-t border-border">
              <button onClick={() => setQueryOpen(false)} className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
              <button onClick={handleQuery} disabled={saving} className="px-4 py-1.5 text-sm btn-module text-white rounded-lg font-medium hover:shadow-lg disabled:opacity-40">{saving ? "Saving..." : "Confirm Query"}</button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Approve */}
        <Dialog open={approveOpen} onOpenChange={(o) => !o && setApproveOpen(false)}>
          <DialogContent accent="crm" className="max-w-sm">
            <DialogHeader><DialogTitle className="font-heading">Approve Mutation</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">New Khata No. *</label>
                <Input value={approveForm.NewKhataNo} onChange={(e) => setApproveForm((f) => ({ ...f, NewKhataNo: e.target.value }))} placeholder="e.g. 456/2026" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Mutation No.</label>
                  <Input value={approveForm.ApprovedNo} onChange={(e) => setApproveForm((f) => ({ ...f, ApprovedNo: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Approved Date</label>
                  <DateInput value={approveForm.ApprovedDate} onChange={(e) => setApproveForm((f) => ({ ...f, ApprovedDate: e.target.value }))}
                    className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
                </div>
              </div>
            </div>
            <DialogFooter className="pt-3 border-t border-border">
              <button onClick={() => setApproveOpen(false)} className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
              <button onClick={handleApprove} disabled={!approveForm.NewKhataNo.trim() || saving}
                className="px-4 py-1.5 text-sm bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed">
                {saving ? "Saving..." : "Confirm Approval"}
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Preview */}
        <Dialog open={!!previewDoc} onOpenChange={(o) => { if (!o) closePreview(); }}>
          <DialogContent accent="crm" className="max-w-3xl p-0 gap-0 overflow-hidden">
            <DialogHeader className="px-4 py-2.5 border-b border-border">
              <DialogTitle className="text-sm truncate">{previewDoc?.name}</DialogTitle>
            </DialogHeader>
            <div className="bg-muted/30 flex items-center justify-center" style={{ height: '75vh' }}>
              {previewDoc?.mime === 'application/pdf' ? (
                <iframe src={previewDoc.url} title={previewDoc.name} className="w-full h-full border-0" />
              ) : previewDoc ? (
                <img src={previewDoc.url} alt={previewDoc.name} className="max-w-full max-h-full object-contain" />
              ) : null}
            </div>
          </DialogContent>
        </Dialog>
      </CrmShell>

      {/* Detail drawer */}
      <CrmSideDrawer
        open={detailId != null}
        onClose={() => setDetailId(null)}
        title={detail ? <ApplicantNames name={detail.ApplicantName} bookingId={detail.BookingId} applicationId={detail.ApplicationId} /> : ""}
        subtitle={detail ? `${detail.MutationNo} · ${detail.BookingNo} · ${detail.UnitNo}` : undefined}
        badge={detail && (
          <span className={cn("text-[0.6875rem] px-2 py-0.5 rounded-full border font-semibold", (STATUS_CONFIG[detail.Status] ?? STATUS_CONFIG.Applied).badgeCls)}>
            {(STATUS_CONFIG[detail.Status] ?? STATUS_CONFIG.Applied).label}
          </span>
        )}
      >
        {detail && (
          <DetailBody
            detail={detail} documents={documents} history={history}
            activeTab={activeTab} setActiveTab={setActiveTab}
            canApproveMutation={canApproveMutation} locked={locked}
            required={required} supporting={supporting} verifiedCount={verifiedCount} docsReady={docsReady}
            onQuery={() => setQueryOpen(true)}
            onApprove={() => setApproveOpen(true)}
            onResubmit={handleResubmit}
            onUploadDoc={handleUploadDoc}
            onRequestDoc={handleRequestDoc}
            onVerifyDoc={handleVerifyDoc}
            onRejectDoc={handleRejectDoc}
            onPreviewDoc={handlePreviewDoc}
            onDownloadDoc={handleDownloadDoc}
            previewLoading={previewLoading}
            uploadingDoc={uploadingDoc}
            requestingDoc={requestingDoc}
          />
        )}
      </CrmSideDrawer>

      {/* Shared prompt Dialog — replaces window.prompt for document rejection remarks */}
      {rejectPrompt.open && (
        <Dialog open={rejectPrompt.open} onOpenChange={(o) => !o && setRejectPrompt((d) => ({ ...d, open: false }))}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Rejection Remarks</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground mb-2">{rejectPrompt.title}</p>
            <Input
              value={rejectPrompt.value}
              onChange={(e) => setRejectPrompt((d) => ({ ...d, value: e.target.value }))}
              placeholder="Describe the issue…"
            />
            <DialogFooter>
              <button
                onClick={() => setRejectPrompt((d) => ({ ...d, open: false }))}
                className="px-3 py-1.5 text-sm border rounded"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  rejectPrompt.onSubmit(rejectPrompt.value);
                  setRejectPrompt((d) => ({ ...d, open: false }));
                }}
                className="px-3 py-1.5 text-sm bg-red-600 text-white rounded hover:bg-red-700"
              >
                Reject
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
};

export default CrmMutation;
