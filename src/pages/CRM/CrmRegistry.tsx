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
  Plus, CalendarClock, CheckCircle2, Search, Upload, Download, Eye, Loader2,
  File as FileIcon, FileImage, FileText as FileTextIcon, XCircle, History, ScrollText, MapPin, Link2,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle } from "@/components/ui/dialog";

const API = "/api/crm/registry";

const STATUS_COLOR: Record<string, string> = {
  Pending:   "text-orange-600 bg-orange-50 border-orange-200",
  Scheduled: "text-blue-600 bg-blue-50 border-blue-200",
  Completed: "text-emerald-600 bg-emerald-50 border-emerald-200",
  Cancelled: "text-rose-600 bg-rose-50 border-rose-200",
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
  if (isSynced(doc)) return 'Pulled from the Sale Deed\'s own verified copy — nothing to do here.';
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
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error || "Failed to load Registry trackers");
  return r.json();
}
async function fetchEligible(): Promise<any[]> {
  const r = await fetchWithAuth(`${API}/eligible-bookings`);
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error || "Failed to load eligible bookings");
  return r.json();
}

const CrmRegistry: React.FC = () => {
  const qc = useQueryClient();
  const [sp, setSp] = useSearchParams();
  const deepLinkBookingId = sp.get("bookingId");
  const registryIdFilter = sp.get("registryId");

  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [bookingId, setBookingId] = useState("");
  const [saving, setSaving] = useState(false);

  const [detailId, setDetailId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<DetailTab>("Overview");
  const [deepLinkOpened, setDeepLinkOpened] = useState(false);

  const [scheduleOpen, setScheduleOpen] = useState<"first" | "reschedule" | null>(null);
  const [scheduledDate, setScheduledDate] = useState("");
  const [appointmentTime, setAppointmentTime] = useState("");
  const [appointmentOffice, setAppointmentOffice] = useState("");
  const [rescheduleReason, setRescheduleReason] = useState("");

  const [completeOpen, setCompleteOpen] = useState(false);
  const [completeForm, setCompleteForm] = useState({
    RegistrationNo: "", BookNo: "", PartNo: "", SubRegistrarOffice: "",
    RegistrationDate: new Date().toISOString().slice(0, 10),
    WitnessNames: "", BuyerAttended: false, SellerAttended: false,
  });

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  const [newDocType, setNewDocType] = useState("Other");
  const [newDocLabel, setNewDocLabel] = useState("");
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const [requestingDoc, setRequestingDoc] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [previewDoc, setPreviewDoc] = useState<{ url: string; mime: string; name: string } | null>(null);
  const [previewLoading, setPreviewLoading] = useState<number | null>(null);

  const { data: rows = [], isLoading, dataUpdatedAt, isFetching, refetch } = useQuery({ queryKey: ["crm-registry"], queryFn: fetchAll, staleTime: 30_000 });
  const { data: startableBookings = [] } = useQuery({ queryKey: ["crm-registry-eligible"], queryFn: fetchEligible, staleTime: 60_000 });

  const { data: detailData, refetch: refetchDetail } = useQuery({
    queryKey: ["crm-registry-detail", detailId],
    queryFn: async () => {
      if (!detailId) return null;
      const r = await fetchWithAuth(`${API}/${detailId}`);
      if (!r.ok) return null;
      return r.json();
    },
    enabled: !!detailId,
    staleTime: 15_000,
  });

  const detail = detailData?.registry ?? (detailId != null ? (rows as any[]).find((r: any) => r.Id === detailId) : null);
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
    if (!registryIdFilter || deepLinkOpened || !(rows as any[]).length) return;
    const match = (rows as any[]).find((r: any) => String(r.Id) === registryIdFilter);
    if (match) { setDeepLinkOpened(true); selectDetail(match.Id); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registryIdFilter, deepLinkOpened, rows]);

  const invalidateDetail = () => qc.invalidateQueries({ queryKey: ["crm-registry-detail", detailId] });
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["crm-registry"] });
    qc.invalidateQueries({ queryKey: ["crm-registry-eligible"] });
    qc.invalidateQueries({ queryKey: ["crm-booking-lifecycle"] });
    qc.invalidateQueries({ queryKey: ["crm-legal-milestones"] });
    qc.invalidateQueries({ queryKey: ["crm-dashboard"] });
    qc.invalidateQueries({ queryKey: ["crm-sales-deed"] });
    if (detailId) invalidateDetail();
  };

  const selectDetail = (id: number) => {
    setDetailId(id);
    setActiveTab("Overview");
    setSp((p) => { p.set("registryId", String(id)); return p; }, { replace: true });
  };

  const handleStart = async () => {
    if (!bookingId) { toast.error("Booking is required"); return; }
    setSaving(true);
    try {
      const res = await fetchWithAuth(API, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ BookingId: parseInt(bookingId) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`${data.RegNo} started`);
      setDialogOpen(false);
      setBookingId("");
      invalidate();
      selectDetail(data.id);
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setSaving(false); }
  };

  const handleSchedule = async () => {
    if (!detailId || !scheduledDate) { toast.error("Date is required"); return; }
    const isReschedule = scheduleOpen === "reschedule";
    if (!isReschedule && !appointmentOffice.trim()) { toast.error("Sub-Registrar Office is required"); return; }
    if (isReschedule && !rescheduleReason.trim()) { toast.error("A reason is required to reschedule"); return; }
    try {
      const res = await fetchWithAuth(`${API}/${detailId}/${isReschedule ? "reschedule" : "schedule"}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isReschedule
          ? { ScheduledDate: scheduledDate, AppointmentTime: appointmentTime, AppointmentOffice: appointmentOffice, Reason: rescheduleReason.trim() }
          : { ScheduledDate: scheduledDate, AppointmentTime: appointmentTime, AppointmentOffice: appointmentOffice.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(isReschedule ? "Appointment rescheduled" : "Appointment scheduled");
      setScheduleOpen(null); setScheduledDate(""); setAppointmentTime(""); setAppointmentOffice(""); setRescheduleReason("");
      invalidate();
    } catch (e: any) { toast.error(translateError(e.message)); }
  };

  const handleComplete = async () => {
    if (!detailId) return;
    if (!completeForm.RegistrationNo.trim()) { toast.error("Registration No. is required"); return; }
    if (!completeForm.WitnessNames.trim()) { toast.error("Witness names are required"); return; }
    if (!completeForm.BuyerAttended || !completeForm.SellerAttended) { toast.error("Both parties' attendance must be confirmed"); return; }
    try {
      const res = await fetchWithAuth(`${API}/${detailId}/complete`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(completeForm),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Registry completed — Sale Deed marked Registered");
      setCompleteOpen(false);
      setCompleteForm({ RegistrationNo: "", BookNo: "", PartNo: "", SubRegistrarOffice: "", RegistrationDate: new Date().toISOString().slice(0, 10), WitnessNames: "", BuyerAttended: false, SellerAttended: false });
      invalidate();
    } catch (e: any) { toast.error(translateError(e.message)); }
  };

  const handleCancel = async () => {
    if (!detailId || !cancelReason.trim()) { toast.error("A reason is required"); return; }
    try {
      const res = await fetchWithAuth(`${API}/${detailId}/cancel`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ Reason: cancelReason.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Registry cancelled");
      setCancelOpen(false); setCancelReason("");
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
    r.RegNo?.toLowerCase().includes(search.toLowerCase()) ||
    r.BookingNo?.toLowerCase().includes(search.toLowerCase()) ||
    r.UnitNo?.toLowerCase().includes(search.toLowerCase())
  );

  const required = documents.filter((d) => d.IsMandatory);
  const supporting = documents.filter((d) => !d.IsMandatory);
  const verifiedCount = required.filter((d) => d.Status === 'Verified').length;

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
                <Link2 size={9} /> Synced from Sale Deed
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
        {['Requested', 'Rejected'].includes(doc.Status) && !['Completed', 'Cancelled'].includes(detail?.Status) && (
          <>
            <input type="file" className="hidden" id={`doc-attach-${doc.Id}`} onChange={(e) => e.target.files?.[0] && handleUploadDoc(e.target.files[0], doc.DocumentType, doc.Label)} />
            <button onClick={() => document.getElementById(`doc-attach-${doc.Id}`)?.click()} className="text-xs bg-primary text-primary-foreground px-2.5 py-1 rounded font-medium hover:bg-primary/90">
              {doc.Status === 'Rejected' ? 'Re-attach File' : 'Attach File'}
            </button>
          </>
        )}
        {doc.HasFile && doc.Status === 'Uploaded' && !['Completed', 'Cancelled'].includes(detail?.Status) && (
          <>
            <button onClick={() => handleVerifyDoc(doc.Id)} className="text-xs bg-green-50 text-green-700 border border-green-200 px-2.5 py-1 rounded hover:bg-green-100 font-medium">Verify</button>
            <button onClick={() => handleRejectDoc(doc.Id)} className="text-xs bg-red-50 text-red-700 border border-red-200 px-2.5 py-1 rounded hover:bg-red-100 font-medium">Reject</button>
          </>
        )}
      </div>
    </div>
  );

  const locked = detail && ["Completed", "Cancelled"].includes(detail.Status);

  return (
    <>
      <Breadcrumbs items={["Dashboard", "CRM", "Sale Deed Registration"]} />
      <CrmShell
        title="Sale Deed Registration — Sub-Registrar Office"
        subtitle="Both parties appear at the Sub-Registrar Office to officially register the Sale Deed — legally transfers ownership to the buyer"
        action={
          <div className="flex items-center gap-3">
            <RefreshButton dataUpdatedAt={dataUpdatedAt} isFetching={isFetching} onRefresh={refetch} />
            <button onClick={() => setDialogOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90">
              <Plus size={14} /> Start Registry
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
                placeholder="Search registrations..."
                className="w-full pl-8 pr-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary" />
            </div>
            <div className="flex-1 overflow-y-auto thin-scroll space-y-1.5">
              {isLoading ? (
                <div className="p-4 text-center text-muted-foreground text-sm">Loading...</div>
              ) : filtered.length === 0 ? (
                <div className="p-4 text-center text-muted-foreground text-sm">No Registry trackers yet</div>
              ) : filtered.map((r: any) => {
                const railColor = r.Status === "Completed" ? "#10b981" : r.Status === "Scheduled" ? "#3b82f6" : r.Status === "Cancelled" ? "#f43f5e" : "var(--border)";
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
                        <div className="text-xs text-muted-foreground mt-0.5 truncate">{r.RegNo} · {r.BookingNo} · {r.UnitNo}</div>
                        {r.RescheduleCount > 0 && r.Status !== "Completed" && (
                          <div className="text-[10px] text-amber-600 mt-1">Rescheduled ×{r.RescheduleCount}</div>
                        )}
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
              <div className="h-full flex items-center justify-center text-sm text-muted-foreground">Select a registration to view details</div>
            ) : (
              <div className="p-5">
                <div className="flex items-start justify-between gap-3 mb-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-lg font-semibold">{detail.ApplicantName}</h3>
                      <span className={cn("text-xs px-2 py-0.5 rounded-full border font-medium", STATUS_COLOR[detail.Status] || "")}>{detail.Status}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{detail.RegNo} · {detail.BookingNo} · {detail.UnitNo} {detail.DeedNo && `· Deed ${detail.DeedNo}`}</p>
                  </div>
                  {!locked && (
                    <button onClick={() => setCancelOpen(true)} className="text-xs border border-rose-200 text-rose-600 px-2.5 py-1.5 rounded hover:bg-rose-50 font-medium">Cancel</button>
                  )}
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
                    {/* Status-driven action banner */}
                    {detail.Status === "Pending" && (
                      <div className="border border-orange-200 bg-orange-50 rounded-lg p-4 flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-orange-800 flex items-center gap-1.5"><CalendarClock size={14} /> No appointment scheduled yet</p>
                          <p className="text-xs text-orange-700 mt-0.5">Record the Sub-Registrar Office appointment date to move this forward.</p>
                        </div>
                        <button onClick={() => { setScheduleOpen("first"); setScheduledDate(""); }} className="shrink-0 text-xs bg-orange-600 text-white px-3 py-1.5 rounded hover:bg-orange-700 font-medium">Schedule</button>
                      </div>
                    )}
                    {detail.Status === "Scheduled" && (
                      <div className="border border-blue-200 bg-blue-50 rounded-lg p-4">
                        <div className="flex items-center justify-between gap-3 flex-wrap">
                          <div>
                            <p className="text-sm font-semibold text-blue-800 flex items-center gap-1.5">
                              <MapPin size={14} /> Appointment: {fmtDate(detail.ScheduledDate)}{detail.AppointmentTime && ` · ${detail.AppointmentTime}`}
                            </p>
                            {detail.AppointmentOffice && <p className="text-xs text-blue-700 mt-0.5">{detail.AppointmentOffice}</p>}
                            <p className="text-xs text-blue-700 mt-0.5">
                              {required.length > 0 ? `${verifiedCount}/${required.length} mandatory documents verified.` : "No mandatory document requested yet."}
                            </p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <button onClick={() => { setScheduleOpen("reschedule"); setScheduledDate(detail.ScheduledDate ? String(detail.ScheduledDate).slice(0, 10) : ""); setAppointmentTime(detail.AppointmentTime || ""); setAppointmentOffice(detail.AppointmentOffice || ""); setRescheduleReason(""); }}
                              className="text-xs border border-blue-300 text-blue-700 px-3 py-1.5 rounded hover:bg-blue-100 font-medium">Reschedule</button>
                            <button onClick={() => { setCompleteOpen(true); setCompleteForm((f) => ({ ...f, SubRegistrarOffice: detail.AppointmentOffice || detail.SubRegistrarOffice || "" })); }}
                              disabled={required.length > 0 && verifiedCount < required.length}
                              title={required.length > 0 && verifiedCount < required.length ? "Verify the mandatory documents first" : undefined}
                              className="text-xs bg-emerald-600 text-white px-3 py-1.5 rounded hover:bg-emerald-700 font-medium disabled:opacity-50 disabled:cursor-not-allowed">
                              Mark Completed
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                    {detail.Status === "Completed" && (
                      <div className="border border-emerald-200 bg-emerald-50 rounded-lg p-4">
                        <p className="text-sm font-semibold text-emerald-800 flex items-center gap-1.5"><CheckCircle2 size={14} /> Registered {fmtDate(detail.RegistrationDate)}</p>
                        <p className="text-xs text-emerald-700 mt-0.5">Reg No. {detail.RegistrationNo} · Book {detail.BookNo || "—"} / Part {detail.PartNo || "—"} · {detail.SubRegistrarOffice || "—"}</p>
                        {detail.WitnessNames && <p className="text-xs text-emerald-700 mt-1">Witnesses: {detail.WitnessNames}</p>}
                        <p className="text-xs text-emerald-700 mt-0.5">
                          Attendance: Buyer {detail.BuyerAttended ? "✓" : "✗"} · Seller/Builder rep {detail.SellerAttended ? "✓" : "✗"}
                        </p>
                      </div>
                    )}

                    {/* Government dues — what's actually being paid to register this deed,
                        surfaced from Query Payment/the linked deed so staff can confirm
                        it matches before the appointment instead of discovering a mismatch
                        at the Sub-Registrar counter. */}
                    {(detail.DeedStampDuty || detail.DeedRegistrationFee || detail.QPConfirmedAmount) && (
                      <div className="border border-border rounded-lg p-3 grid grid-cols-3 gap-3 text-sm bg-muted/20">
                        <div><p className="text-xs text-muted-foreground">Stamp Duty</p><p className="font-medium">{detail.DeedStampDuty != null ? `₹${Number(detail.DeedStampDuty).toLocaleString('en-IN')}` : "—"}</p></div>
                        <div><p className="text-xs text-muted-foreground">Registration Fee</p><p className="font-medium">{detail.DeedRegistrationFee != null ? `₹${Number(detail.DeedRegistrationFee).toLocaleString('en-IN')}` : "—"}</p></div>
                        <div>
                          <p className="text-xs text-muted-foreground">Query Payment</p>
                          <p className="font-medium">
                            {detail.QPConfirmedAmount != null ? `₹${Number(detail.QPConfirmedAmount).toLocaleString('en-IN')}` : "—"}
                            {detail.QPStatus && <span className={cn("ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full border", detail.QPStatus === "Confirmed" ? "text-emerald-600 bg-emerald-50 border-emerald-200" : "text-amber-600 bg-amber-50 border-amber-200")}>{detail.QPStatus}</span>}
                          </p>
                        </div>
                      </div>
                    )}
                    {detail.Status === "Cancelled" && (
                      <div className="border border-rose-200 bg-rose-50 rounded-lg p-4">
                        <p className="text-sm font-semibold text-rose-800 flex items-center gap-1.5"><XCircle size={14} /> Cancelled</p>
                        {detail.CancelledReason && <p className="text-xs text-rose-700 mt-0.5">{detail.CancelledReason}</p>}
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div><p className="text-xs text-muted-foreground">Booking</p><p className="font-medium">{detail.BookingNo}</p></div>
                      <div><p className="text-xs text-muted-foreground">Unit</p><p className="font-medium">{detail.UnitNo}</p></div>
                      <div><p className="text-xs text-muted-foreground">Applicant</p><p className="font-medium">{detail.ApplicantName}</p></div>
                      <div><p className="text-xs text-muted-foreground">Sale Deed</p><p className="font-medium">{detail.DeedNo || "—"}</p></div>
                      <div><p className="text-xs text-muted-foreground">Scheduled Date</p><p className="font-medium">{fmtDate(detail.ScheduledDate)}{detail.AppointmentTime && ` · ${detail.AppointmentTime}`}</p></div>
                      <div><p className="text-xs text-muted-foreground">Appointment Office</p><p className="font-medium">{detail.AppointmentOffice || "—"}</p></div>
                      <div><p className="text-xs text-muted-foreground">Rescheduled</p><p className="font-medium">{detail.RescheduleCount || 0} time(s)</p></div>
                      {detail.Status === "Completed" && (
                        <>
                          <div><p className="text-xs text-muted-foreground">Registration No.</p><p className="font-mono font-medium">{detail.RegistrationNo}</p></div>
                          <div><p className="text-xs text-muted-foreground">Book / Part</p><p className="font-medium">{detail.BookNo || "—"} / {detail.PartNo || "—"}</p></div>
                          <div><p className="text-xs text-muted-foreground">Sub-Registrar Office</p><p className="font-medium">{detail.SubRegistrarOffice || "—"}</p></div>
                          <div><p className="text-xs text-muted-foreground">Witnesses</p><p className="font-medium">{detail.WitnessNames || "—"}</p></div>
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
                          <p className="text-xs text-amber-800"><span className="font-semibold">No mandatory document requested yet.</span> Completion is blocked until one is requested and verified.</p>
                          {!locked && (
                            <button onClick={() => handleRequestDoc('RegistrationReceipt', 'Registration Receipt / Challan')} disabled={requestingDoc}
                              className="shrink-0 text-xs bg-amber-600 text-white px-3 py-1.5 rounded hover:bg-amber-700 disabled:opacity-50 font-medium">
                              {requestingDoc ? "Requesting..." : "Request Registration Receipt"}
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
                        <p className="text-xs text-muted-foreground mb-2">For reference material only — use "Request Registration Receipt" above for anything completion needs to check.</p>
                        <div className="flex items-end gap-2">
                          <div className="flex-1 space-y-1">
                            <label className="text-[10px] font-medium text-muted-foreground">Type</label>
                            <select value={newDocType} onChange={(e) => setNewDocType(e.target.value)} className="w-full h-8 text-xs border border-border rounded px-2 bg-background">
                              <option value="StampedDeedCopy">Stamped Deed Copy</option>
                              <option value="Other">Other</option>
                            </select>
                          </div>
                          <div className="flex-1 space-y-1">
                            <label className="text-[10px] font-medium text-muted-foreground">Label (Optional)</label>
                            <Input className="h-8 text-xs" value={newDocLabel} onChange={(e) => setNewDocLabel(e.target.value)} placeholder="e.g. Stamped copy" />
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

        {/* Start Registry */}
        <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) { setDialogOpen(false); setBookingId(""); } }}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle className="font-heading">Start Registry</DialogTitle></DialogHeader>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Booking *</label>
              <select value={bookingId} onChange={(e) => setBookingId(e.target.value)} className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                <option value="">Select booking</option>
                {startableBookings.map((b: any) => (
                  <option key={b.Id} value={String(b.Id)}>{b.BookingNo} — {b.ApplicantName}</option>
                ))}
              </select>
              <p className="text-[11px] text-muted-foreground mt-1">Requires Query Payment to be Confirmed for this booking first.</p>
              {!startableBookings.length && <p className="text-[11px] text-amber-600 mt-1">No bookings are eligible yet — Query Payment must be Confirmed first.</p>}
            </div>
            <div className="flex justify-end gap-2 pt-3 border-t border-border">
              <button onClick={() => { setDialogOpen(false); setBookingId(""); }} className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
              <button onClick={handleStart} disabled={saving || !bookingId} className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40">
                {saving ? "Starting..." : "Start"}
              </button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Schedule / Reschedule */}
        <Dialog open={!!scheduleOpen} onOpenChange={(o) => !o && setScheduleOpen(null)}>
          <DialogContent className="max-w-xs">
            <DialogHeader><DialogTitle className="font-heading">{scheduleOpen === "reschedule" ? "Reschedule Appointment" : "Schedule Registration"}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">{scheduleOpen === "reschedule" ? "New Date *" : "Appointment Date *"}</label>
                  <input type="date" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Time</label>
                  <Input value={appointmentTime} onChange={(e) => setAppointmentTime(e.target.value)} placeholder="e.g. 11:30 AM" />
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">{scheduleOpen === "reschedule" ? "Sub-Registrar Office" : "Sub-Registrar Office *"}</label>
                <Input value={appointmentOffice} onChange={(e) => setAppointmentOffice(e.target.value)} placeholder="e.g. Sonarpur SRO" />
              </div>
              {scheduleOpen === "reschedule" && (
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Reason *</label>
                  <textarea value={rescheduleReason} onChange={(e) => setRescheduleReason(e.target.value)} placeholder="Why is this being rescheduled?"
                    className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background min-h-[70px]" />
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 pt-3 border-t border-border">
              <button onClick={() => setScheduleOpen(null)} className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
              <button onClick={handleSchedule} className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90">Save</button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Complete */}
        <Dialog open={completeOpen} onOpenChange={(o) => !o && setCompleteOpen(false)}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle className="font-heading">Mark Registry Completed</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Registration No. *</label>
                <Input value={completeForm.RegistrationNo} onChange={(e) => setCompleteForm((f) => ({ ...f, RegistrationNo: e.target.value }))} placeholder="e.g. 1234/2026" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Book No.</label>
                  <Input value={completeForm.BookNo} onChange={(e) => setCompleteForm((f) => ({ ...f, BookNo: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Part No.</label>
                  <Input value={completeForm.PartNo} onChange={(e) => setCompleteForm((f) => ({ ...f, PartNo: e.target.value }))} />
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Sub-Registrar Office</label>
                <Input value={completeForm.SubRegistrarOffice} onChange={(e) => setCompleteForm((f) => ({ ...f, SubRegistrarOffice: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Registration Date</label>
                <input type="date" value={completeForm.RegistrationDate} onChange={(e) => setCompleteForm((f) => ({ ...f, RegistrationDate: e.target.value }))}
                  className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Witness Names *</label>
                <Input value={completeForm.WitnessNames} onChange={(e) => setCompleteForm((f) => ({ ...f, WitnessNames: e.target.value }))} placeholder="e.g. Ramesh Das, Sunita Roy" />
                <p className="text-[11px] text-muted-foreground mt-1">The Registration Act requires two identifying witnesses at the office.</p>
              </div>
              <div className="border border-border rounded-lg p-3 space-y-2">
                <p className="text-xs font-semibold text-foreground">Attendance Confirmation *</p>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={completeForm.BuyerAttended} onChange={(e) => setCompleteForm((f) => ({ ...f, BuyerAttended: e.target.checked }))} />
                  Buyer (or authorized POA holder) was present
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={completeForm.SellerAttended} onChange={(e) => setCompleteForm((f) => ({ ...f, SellerAttended: e.target.checked }))} />
                  Seller / builder representative was present
                </label>
              </div>
            </div>
            <DialogFooter className="pt-3 border-t border-border">
              <button onClick={() => setCompleteOpen(false)} className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
              <button onClick={handleComplete}
                disabled={!completeForm.RegistrationNo.trim() || !completeForm.WitnessNames.trim() || !completeForm.BuyerAttended || !completeForm.SellerAttended}
                className="px-4 py-1.5 text-sm bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed">
                Confirm Completed
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Cancel */}
        <Dialog open={cancelOpen} onOpenChange={(o) => !o && setCancelOpen(false)}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle className="font-heading">Cancel Registry</DialogTitle></DialogHeader>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Reason *</label>
              <textarea value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background min-h-[80px]" />
            </div>
            <div className="flex justify-end gap-2 pt-3 border-t border-border">
              <button onClick={() => setCancelOpen(false)} className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Back</button>
              <button onClick={handleCancel} className="px-4 py-1.5 text-sm bg-rose-600 text-white rounded-lg font-medium hover:bg-rose-700">Confirm Cancel</button>
            </div>
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

export default CrmRegistry;
