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
  Plus, CheckCircle2, Search, Upload, Download, Eye, Loader2, AlertTriangle,
  File as FileIcon, FileImage, FileText as FileTextIcon, History, ScrollText, Link2, Landmark,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle } from "@/components/ui/dialog";

const API = "/api/crm/mutation";

const STATUS_COLOR: Record<string, string> = {
  Applied:     "text-amber-600 bg-amber-50 border-amber-200",
  QueryRaised: "text-orange-600 bg-orange-50 border-orange-200",
  Approved:    "text-emerald-600 bg-emerald-50 border-emerald-200",
};

const DOC_STATUS_COLOR: Record<string, string> = {
  Requested: 'text-amber-600 bg-amber-50 border-amber-200',
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

async function fetchAll(): Promise<any[]> {
  const r = await fetchWithAuth(API);
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error || "Failed to load Mutation records");
  return r.json();
}
async function fetchEligible(): Promise<any[]> {
  const r = await fetchWithAuth(`${API}/eligible-bookings`);
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error || "Failed to load eligible bookings");
  return r.json();
}

const CrmMutation: React.FC = () => {
  const qc = useQueryClient();
  const [sp, setSp] = useSearchParams();
  const deepLinkBookingId = sp.get("bookingId");
  const mutationIdFilter = sp.get("mutationId");

  const [search, setSearch] = useState("");
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

  const [newDocType, setNewDocType] = useState("Other");
  const [newDocLabel, setNewDocLabel] = useState("");
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const [requestingDoc, setRequestingDoc] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [previewDoc, setPreviewDoc] = useState<{ url: string; mime: string; name: string } | null>(null);
  const [previewLoading, setPreviewLoading] = useState<number | null>(null);

  const { data: rows = [], isLoading, dataUpdatedAt, isFetching, refetch } = useQuery({ queryKey: ["crm-mutation"], queryFn: fetchAll, staleTime: 30_000 });
  const { data: startableBookings = [] } = useQuery({ queryKey: ["crm-mutation-eligible"], queryFn: fetchEligible, staleTime: 60_000 });

  const { data: detailData } = useQuery({
    queryKey: ["crm-mutation-detail", detailId],
    queryFn: async () => {
      if (!detailId) return null;
      const r = await fetchWithAuth(`${API}/${detailId}`);
      if (!r.ok) return null;
      return r.json();
    },
    enabled: !!detailId,
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
    if (!mutationIdFilter || deepLinkOpened || !(rows as any[]).length) return;
    const match = (rows as any[]).find((r: any) => String(r.Id) === mutationIdFilter);
    if (match) { setDeepLinkOpened(true); selectDetail(match.Id); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mutationIdFilter, deepLinkOpened, rows]);

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
    if (!detailId || !queryRemarks.trim()) { toast.error("Remarks are required"); return; }
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
  };

  const handleResubmit = async () => {
    if (!detailId) return;
    try {
      const res = await fetchWithAuth(`${API}/${detailId}/resubmit`, { method: "PUT" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Resubmitted to the authority");
      invalidate();
    } catch (e: any) { toast.error(translateError(e.message)); }
  };

  const handleApprove = async () => {
    if (!detailId) return;
    if (!approveForm.NewKhataNo.trim()) { toast.error("New Khata No. is required"); return; }
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
  };

  const handleUploadDoc = async (file: File, documentType: string, label?: string) => {
    if (!detailId) return;
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
      setNewDocLabel('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setUploadingDoc(false); }
  };

  const handleRequestDoc = async (documentType: string, label?: string) => {
    if (!detailId) return;
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
    if (!detailId) return;
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

  const handleRejectDoc = async (docId: number) => {
    if (!detailId) return;
    const remarks = window.prompt("Describe what's wrong with this document (required):");
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

  const filtered = (rows as any[]).filter((r) =>
    !search ||
    r.ApplicantName?.toLowerCase().includes(search.toLowerCase()) ||
    r.MutationNo?.toLowerCase().includes(search.toLowerCase()) ||
    r.BookingNo?.toLowerCase().includes(search.toLowerCase()) ||
    r.UnitNo?.toLowerCase().includes(search.toLowerCase())
  );

  const required = documents.filter((d) => d.IsMandatory);
  const supporting = documents.filter((d) => !d.IsMandatory);
  const verifiedCount = required.filter((d) => d.Status === 'Verified').length;
  const docsReady = required.length > 0 && verifiedCount === required.length;
  const locked = detail?.Status === "Approved";

  const DocRow = ({ doc }: { doc: any }) => (
    <div className="border border-border rounded-lg p-3 text-sm bg-card">
      <div className="flex items-start gap-3">
        <div className="mt-0.5">{mimeIcon(doc.MimeType)}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
            <span className="font-medium">{doc.Label || doc.DocumentType}</span>
            <span className={cn("text-[10px] px-2 py-0.5 rounded-full border font-medium", DOC_STATUS_COLOR[doc.Status] || "bg-muted border-border text-muted-foreground")}>{doc.Status}</span>
            {isSynced(doc) && (
              <span className="text-[10px] px-2 py-0.5 rounded-full border font-medium text-indigo-600 bg-indigo-50 border-indigo-200 flex items-center gap-1">
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
          <button onClick={() => handlePreviewDoc(doc)} disabled={previewLoading === doc.Id} className="text-xs text-primary hover:underline flex items-center gap-1 disabled:opacity-50">
            {previewLoading === doc.Id ? <Loader2 size={12} className="animate-spin" /> : <Eye size={12} />} Preview
          </button>
        )}
        {doc.HasFile && (
          <button onClick={() => handleDownloadDoc(doc)} className="text-xs text-primary hover:underline flex items-center gap-1">
            <Download size={12} /> Download
          </button>
        )}
        {['Requested', 'Rejected'].includes(doc.Status) && !locked && (
          <>
            <input type="file" className="hidden" id={`doc-attach-${doc.Id}`} onChange={(e) => e.target.files?.[0] && handleUploadDoc(e.target.files[0], doc.DocumentType, doc.Label)} />
            <button onClick={() => document.getElementById(`doc-attach-${doc.Id}`)?.click()} className="text-xs bg-primary text-primary-foreground px-2.5 py-1 rounded font-medium hover:bg-primary/90">
              {doc.Status === 'Rejected' ? 'Re-attach File' : 'Attach File'}
            </button>
          </>
        )}
        {doc.HasFile && doc.Status === 'Uploaded' && !locked && (
          <>
            <button onClick={() => handleVerifyDoc(doc.Id)} className="text-xs bg-green-50 text-green-700 border border-green-200 px-2.5 py-1 rounded hover:bg-green-100 font-medium">Verify</button>
            <button onClick={() => handleRejectDoc(doc.Id)} className="text-xs bg-red-50 text-red-700 border border-red-200 px-2.5 py-1 rounded hover:bg-red-100 font-medium">Reject</button>
          </>
        )}
      </div>
    </div>
  );

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
              className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90">
              <Plus size={14} /> Start Mutation
            </button>
          </div>
        }
      >
        <div className="flex gap-4 h-[calc(100vh-220px)]">
          {/* List (Left Pane) */}
          <div className="w-80 shrink-0 flex flex-col gap-2">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Search mutations..."
                className="w-full pl-8 pr-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary" />
            </div>
            <div className="flex-1 overflow-y-auto thin-scroll space-y-1.5">
              {isLoading ? (
                <div className="p-4 text-center text-muted-foreground text-sm">Loading...</div>
              ) : filtered.length === 0 ? (
                <div className="p-4 text-center text-muted-foreground text-sm">No mutation trackers yet</div>
              ) : filtered.map((r: any) => {
                const railColor = r.Status === "Approved" ? "#10b981" : r.Status === "QueryRaised" ? "#f97316" : "var(--border)";
                return (
                  <button key={r.Id} onClick={() => selectDetail(r.Id)}
                    className={cn("w-full text-left rounded-lg border overflow-hidden transition-colors", detailId === r.Id ? "border-primary bg-primary/5" : "border-border hover:bg-muted/20")}>
                    <div className="flex">
                      <div className="w-1 shrink-0" style={{ background: railColor }} />
                      <div className="flex-1 p-3 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-sm truncate">{r.ApplicantName}</span>
                          <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full border font-medium shrink-0", STATUS_COLOR[r.Status] || "")}>{r.Status}</span>
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5 truncate">{r.MutationNo} · {r.BookingNo} · {r.UnitNo}</div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Detail (Right Pane) */}
          <div className="flex-1 min-w-0 border border-border rounded-xl bg-card overflow-y-auto thin-scroll">
            {!detail ? (
              <div className="h-full flex items-center justify-center text-sm text-muted-foreground">Select a mutation to view details</div>
            ) : (
              <div className="p-5">
                <div className="flex items-start justify-between gap-3 mb-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-lg font-semibold">{detail.ApplicantName}</h3>
                      <span className={cn("text-xs px-2 py-0.5 rounded-full border font-medium", STATUS_COLOR[detail.Status] || "")}>{detail.Status}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{detail.MutationNo} · {detail.BookingNo} · {detail.UnitNo} {detail.DeedNo && `· Deed ${detail.DeedNo}`}</p>
                  </div>
                </div>

                <div className="flex gap-1 border-b border-border mb-4">
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
                      <div className="border border-amber-200 bg-amber-50 rounded-lg p-4">
                        <div className="flex items-center justify-between gap-3 flex-wrap">
                          <div>
                            <p className="text-sm font-semibold text-amber-800 flex items-center gap-1.5"><Landmark size={14} /> Application pending with the authority</p>
                            <p className="text-xs text-amber-700 mt-0.5">
                              {required.length > 0 ? `${verifiedCount}/${required.length} mandatory documents verified.` : "No mandatory document requested yet."}
                            </p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <button onClick={() => setQueryOpen(true)} className="text-xs border border-orange-300 text-orange-700 px-3 py-1.5 rounded hover:bg-orange-100 font-medium">Raise Query</button>
                            <button onClick={() => setApproveOpen(true)} disabled={!docsReady}
                              title={!docsReady ? "Verify the mandatory documents first" : undefined}
                              className="text-xs bg-emerald-600 text-white px-3 py-1.5 rounded hover:bg-emerald-700 font-medium disabled:opacity-50 disabled:cursor-not-allowed">
                              Approve
                            </button>
                          </div>
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
                        <button onClick={handleResubmit} disabled={!docsReady}
                          title={!docsReady ? "Fix and verify the flagged documents first" : undefined}
                          className="mt-2 text-xs bg-orange-600 text-white px-3 py-1.5 rounded hover:bg-orange-700 font-medium disabled:opacity-50 disabled:cursor-not-allowed">
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
                      <div><p className="text-xs text-muted-foreground">Applicant</p><p className="font-medium">{detail.ApplicantName}</p></div>
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
                          <span className={cn("text-[11px] font-semibold", verifiedCount === required.length ? "text-emerald-600" : "text-amber-600")}>{verifiedCount}/{required.length} verified</span>
                        )}
                      </div>
                      {required.length === 0 ? (
                        <div className="border border-amber-200 bg-amber-50 rounded-lg p-3 flex items-center justify-between gap-3">
                          <p className="text-xs text-amber-800"><span className="font-semibold">No mandatory document requested yet.</span> Approval is blocked until one is requested and verified.</p>
                          {!locked && (
                            <button onClick={() => handleRequestDoc('MutationApplicationForm', 'Mutation Application Form')} disabled={requestingDoc}
                              className="shrink-0 text-xs bg-amber-600 text-white px-3 py-1.5 rounded hover:bg-amber-700 disabled:opacity-50 font-medium">
                              {requestingDoc ? "Requesting..." : "Request Application Form"}
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
                        <div className="flex items-end gap-2">
                          <div className="flex-1 space-y-1">
                            <label className="text-[10px] font-medium text-muted-foreground">Type</label>
                            <select value={newDocType} onChange={(e) => setNewDocType(e.target.value)} className="w-full h-8 text-xs border border-border rounded px-2 bg-background">
                              <option value="IdentityProof">Identity Proof</option>
                              <option value="Other">Other</option>
                            </select>
                          </div>
                          <div className="flex-1 space-y-1">
                            <label className="text-[10px] font-medium text-muted-foreground">Label (Optional)</label>
                            <Input className="h-8 text-xs" value={newDocLabel} onChange={(e) => setNewDocLabel(e.target.value)} placeholder="e.g. Aadhaar copy" />
                          </div>
                          <div className="shrink-0 space-y-1">
                            <label className="text-[10px] font-medium text-transparent">.</label>
                            <input type="file" className="hidden" ref={fileInputRef} onChange={(e) => e.target.files?.[0] && handleUploadDoc(e.target.files[0], newDocType, newDocLabel)} />
                            <button onClick={() => fileInputRef.current?.click()} disabled={uploadingDoc}
                              className="h-8 px-3 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90 flex items-center gap-1.5 font-medium disabled:opacity-50">
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
            )}
          </div>
        </div>

        {/* Start Mutation */}
        <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) { setDialogOpen(false); setBookingId(""); } }}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle className="font-heading">Start Mutation</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Booking *</label>
                <select value={bookingId} onChange={(e) => setBookingId(e.target.value)} className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                  <option value="">Select booking</option>
                  {startableBookings.map((b: any) => (
                    <option key={b.Id} value={String(b.Id)}>{b.BookingNo} — {b.ApplicantName}</option>
                  ))}
                </select>
                <p className="text-[11px] text-muted-foreground mt-1">Requires Sale Deed Registry to be Completed.</p>
                {!startableBookings.length && <p className="text-[11px] text-amber-600 mt-1">No bookings are eligible yet — Sale Deed Registry must be Completed first.</p>}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Application No</label>
                  <Input value={startForm.ApplicationNo} onChange={(e) => setStartForm((f) => ({ ...f, ApplicationNo: e.target.value }))} placeholder="Optional" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Application Date</label>
                  <input type="date" value={startForm.ApplicationDate} onChange={(e) => setStartForm((f) => ({ ...f, ApplicationDate: e.target.value }))}
                    className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Authority</label>
                <Input value={startForm.Authority} onChange={(e) => setStartForm((f) => ({ ...f, Authority: e.target.value }))} placeholder="e.g. GHMC, MCGM, BDA" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Old Khata No.</label>
                  <Input value={startForm.OldKhataNo} onChange={(e) => setStartForm((f) => ({ ...f, OldKhataNo: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Mutation Fee</label>
                  <Input type="number" value={startForm.MutationFee} onChange={(e) => setStartForm((f) => ({ ...f, MutationFee: e.target.value }))} />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-3 border-t border-border">
              <button onClick={() => { setDialogOpen(false); setBookingId(""); }} className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
              <button onClick={handleStart} disabled={saving || !bookingId} className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40">
                {saving ? "Starting..." : "Start"}
              </button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Raise Query */}
        <Dialog open={queryOpen} onOpenChange={(o) => !o && setQueryOpen(false)}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle className="font-heading">Raise Query</DialogTitle></DialogHeader>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">What did the authority flag? *</label>
              <textarea value={queryRemarks} onChange={(e) => setQueryRemarks(e.target.value)} className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background min-h-[80px]" />
              <p className="text-[11px] text-muted-foreground mt-1">Mandatory documents will be reset so staff must genuinely correct and reattach them before resubmitting.</p>
            </div>
            <div className="flex justify-end gap-2 pt-3 border-t border-border">
              <button onClick={() => setQueryOpen(false)} className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
              <button onClick={handleQuery} className="px-4 py-1.5 text-sm bg-orange-600 text-white rounded-lg font-medium hover:bg-orange-700">Confirm Query</button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Approve */}
        <Dialog open={approveOpen} onOpenChange={(o) => !o && setApproveOpen(false)}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle className="font-heading">Approve Mutation</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">New Khata No. *</label>
                <Input value={approveForm.NewKhataNo} onChange={(e) => setApproveForm((f) => ({ ...f, NewKhataNo: e.target.value }))} placeholder="e.g. 456/2026" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Mutation No.</label>
                  <Input value={approveForm.ApprovedNo} onChange={(e) => setApproveForm((f) => ({ ...f, ApprovedNo: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Approved Date</label>
                  <input type="date" value={approveForm.ApprovedDate} onChange={(e) => setApproveForm((f) => ({ ...f, ApprovedDate: e.target.value }))}
                    className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
                </div>
              </div>
            </div>
            <DialogFooter className="pt-3 border-t border-border">
              <button onClick={() => setApproveOpen(false)} className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
              <button onClick={handleApprove} disabled={!approveForm.NewKhataNo.trim()}
                className="px-4 py-1.5 text-sm bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed">
                Confirm Approval
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Preview */}
        <Dialog open={!!previewDoc} onOpenChange={(o) => { if (!o) closePreview(); }}>
          <DialogContent className="max-w-3xl p-0 gap-0 overflow-hidden">
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
    </>
  );
};

export default CrmMutation;
