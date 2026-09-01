import { CrmStatus } from "@/constants/crmStatuses";
import React, { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { CrmShell } from "@/components/crm/CrmShell";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { translateError } from "@/lib/translateError";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatINR } from "@/utils/formatCurrency";
import {
  Plus, Send, CheckCircle2, Paperclip, AlertTriangle, ReceiptIndianRupee,
  ChevronLeft, ChevronRight, Check, Upload, X, FileText, Image as ImageIcon, RotateCcw, UserCircle2,
} from "lucide-react";
import { ProxyActionDialog, type ProxyMethod } from "@/components/crm/ProxyActionDialog";
import {
  Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";

const API = "/api/crm/query-payment";

const STATUS_CFG: Record<string, { text: string; bar: string }> = {
  Pending:   { text: "text-amber-700",    bar: "bg-amber-500" },
  InfoSent:  { text: "text-blue-700",     bar: "bg-blue-500" },
  Confirmed: { text: "text-emerald-700",  bar: "bg-emerald-500" },
};

function StatusBadge({ status }: { status: string }) {
  const c = STATUS_CFG[status] ?? STATUS_CFG.Pending;
  return (
    <span className={cn("inline-flex items-center gap-1.5 pl-1.5 pr-2 py-0.5 rounded-sm border border-border bg-card font-mono text-[10px] font-semibold uppercase tracking-wider", c.text)}>
      <span className={cn("w-[3px] h-3 rounded-[1px]", c.bar)} />
      {status}
    </span>
  );
}

// The real-world sequence is two distinct steps, not one long form: staff
// first send the customer the amount + paperwork, then � once the customer
// has actually paid the government � come back and confirm it. Presenting
// both as one scrollable stack made it easy to miss which step you were on;
// a tab strip + Next/Previous keeps each step a focused card.
const STEPS = [
  { id: 1, label: "Send Paperwork" },
  { id: 2, label: "Confirm Payment" },
];

function StepTabs({ step, onChange, confirmed }: { step: number; onChange: (s: number) => void; confirmed: boolean }) {
  return (
    <div className="flex items-center gap-1 px-6 pt-3">
      {STEPS.map((s) => {
        const active = step === s.id;
        const done = confirmed || (s.id === 1 && step > 1);
        return (
          <button
            key={s.id}
            onClick={() => onChange(s.id)}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 text-xs font-medium py-2 rounded-t-lg border-b-2 transition-colors",
              active ? "border-primary text-primary bg-primary/5" : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/40",
            )}
          >
            <span className={cn(
              "w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-semibold shrink-0",
              done ? "bg-emerald-500 text-white" : active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
            )}>
              {done ? <Check size={10} /> : s.id}
            </span>
            {s.label}
          </button>
        );
      })}
    </div>
  );
}

interface StagedFile {
  name: string;
  size: number;
  type: string;
  base64: string;   // raw base64 payload (no "data:...;base64," prefix) � what actually gets sent to and stored on the server
  dataUri: string;  // full data URI � used only for the local <img> preview
}

// Files are read as base64 up front � this doubles as both the live preview
// (an <img src="data:..."> needs no server round-trip) and the exact
// payload the server stores: it decodes this same base64 back into bytes
// for the existing VARBINARY(MAX) column, so what you see staged here is
// byte-for-byte what ends up in the DB.
function fileToStaged(file: File): Promise<StagedFile> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const dataUri = reader.result as string;
      const base64 = dataUri.slice(dataUri.indexOf(",") + 1);
      resolve({ name: file.name, size: file.size, type: file.type, base64, dataUri });
    };
    reader.readAsDataURL(file);
  });
}

// Base64 inflates payload ~33%, and the whole request shares one 10mb JSON
// body cap on the server across every staged file plus JSON structure � so
// this needs real headroom, not just "under 10mb" per file. Kept in sync
// with the server-side cap in crmQueryPayment.js.
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_COMBINED_BYTES = 6 * 1024 * 1024;

async function fetchAll(): Promise<any[]> {
  const r = await fetchWithAuth(API);
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error || "Failed to load Query Payments");
  return r.json();
}
async function fetchEligible(): Promise<any[]> {
  const r = await fetchWithAuth(`${API}/eligible-bookings`);
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error || "Failed to load eligible bookings");
  return r.json();
}
async function fetchDetail(id: number | null): Promise<any> {
  if (!id) return null;
  const r = await fetchWithAuth(`${API}/${id}`);
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error || "Failed to load Query Payment");
  return r.json();
}

const CrmQueryPayment: React.FC = () => {
  const qc = useQueryClient();
  const [sp] = useSearchParams();
  const deepLinkBookingId = sp.get("bookingId");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [bookingId, setBookingId] = useState("");
  const [saving, setSaving] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [step, setStep] = useState(1);
  const [confirmAmount, setConfirmAmount] = useState("");
  const [confirmRemarks, setConfirmRemarks] = useState("");
  // Staged, not-yet-sent files for the "Send Info & Paperwork" step � a file
  // picker used to fire the actual send-to-customer the instant a file was
  // chosen, with no review and no way back. Now selecting files only stages
  // them here; nothing goes to the customer until the explicit "Send to
  // Customer" action is confirmed below.
  const [pendingInfoFiles, setPendingInfoFiles] = useState<StagedFile[]>([]);
  const [confirmSendOpen, setConfirmSendOpen] = useState(false);
  const [sendingInfo, setSendingInfo] = useState(false);
  const [proofFile, setProofFile] = useState<StagedFile | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [proxyProofDialog, setProxyProofDialog] = useState(false);
  const [proxyProofFile, setProxyProofFile] = useState<File | null>(null);
  const [proxySaving, setProxySaving] = useState(false);
  const proxyProofInputRef = useRef<HTMLInputElement>(null);
  const infoInputRef = useRef<HTMLInputElement>(null);
  const proofInputRef = useRef<HTMLInputElement>(null);

  const { data: rows = [], isLoading, dataUpdatedAt: listUpdatedAt, isFetching: listFetching, refetch: refetchList } = useQuery({ queryKey: ["crm-query-payment"], queryFn: fetchAll, staleTime: 30_000 });
  const { data: startableBookings = [] } = useQuery({ queryKey: ["crm-query-payment-eligible"], queryFn: fetchEligible, staleTime: 60_000 });
  const { data: detail, refetch: refetchDetail } = useQuery({
    queryKey: ["crm-query-payment-detail", selectedId],
    queryFn: () => fetchDetail(selectedId),
    enabled: !!selectedId,
  });

  // Land on whichever step matches where this tracker actually is � Pending
  // starts at Send Paperwork, InfoSent jumps straight to Confirm Payment
  // (paperwork's already out). Only runs once per opened tracker so staff
  // can still freely move between tabs afterward.
  useEffect(() => {
    if (detail) setStep(detail.Status === CrmStatus.PENDING ? 1 : 2);
    setPendingInfoFiles([]);
    setProofFile(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail?.Id]);

  // Deep-link from Legal Milestones: open the tracker if this booking
  // already has one, otherwise pre-fill the Start dialog with it.
  useEffect(() => {
    if (!deepLinkBookingId || !rows.length) return;
    const existing = (rows as any[]).find((r: any) => String(r.BookingId) === deepLinkBookingId);
    if (existing) setSelectedId(existing.Id);
    else if (startableBookings.some((b: any) => String(b.Id) === deepLinkBookingId)) {
      setBookingId(deepLinkBookingId);
      setDialogOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkBookingId, rows.length, startableBookings.length]);

  const handleStart = async () => {
    if (!bookingId) { toast.error("Booking is required"); return; }
    setSaving(true);
    try {
      const res = await fetchWithAuth(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ BookingId: parseInt(bookingId) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`${data.QPNo} started`);
      setDialogOpen(false);
      setBookingId("");
      qc.invalidateQueries({ queryKey: ["crm-query-payment"] });
      qc.invalidateQueries({ queryKey: ["crm-query-payment-eligible"] });
      qc.invalidateQueries({ queryKey: ["crm-booking-lifecycle"] });
      qc.invalidateQueries({ queryKey: ["crm-legal-milestones"] });
      qc.invalidateQueries({ queryKey: ["crm-dashboard"] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  };

  const stageInfoFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const arr = Array.from(files);
    const oversized = arr.find((f) => f.size > MAX_FILE_BYTES);
    if (oversized) {
      toast.error(`${oversized.name} is too large (max ${(MAX_FILE_BYTES / 1024 / 1024).toFixed(0)}MB per file)`);
      if (infoInputRef.current) infoInputRef.current.value = "";
      return;
    }
    const combined = pendingInfoFiles.reduce((sum, f) => sum + f.size, 0) + arr.reduce((sum, f) => sum + f.size, 0);
    if (combined > MAX_COMBINED_BYTES) {
      toast.error(`Total attached files can't exceed ${(MAX_COMBINED_BYTES / 1024 / 1024).toFixed(0)}MB � send these in a separate batch`);
      if (infoInputRef.current) infoInputRef.current.value = "";
      return;
    }
    try {
      const staged = await Promise.all(arr.map(fileToStaged));
      setPendingInfoFiles((prev) => [...prev, ...staged]);
    } catch {
      toast.error("Failed to read one or more files");
    } finally {
      if (infoInputRef.current) infoInputRef.current.value = "";
    }
  };

  const removeStagedFile = (idx: number) => {
    setPendingInfoFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const stageProofFile = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      toast.error(`${file.name} is too large (max ${(MAX_FILE_BYTES / 1024 / 1024).toFixed(0)}MB)`);
      if (proofInputRef.current) proofInputRef.current.value = "";
      return;
    }
    try {
      setProofFile(await fileToStaged(file));
    } catch {
      toast.error("Failed to read the file");
    }
  };

  // The actual send � only reachable after staff has reviewed the staged
  // files and explicitly confirmed via the AlertDialog gate below. Files
  // travel as base64 JSON, not multipart � the server decodes the same
  // base64 back into bytes for storage, so this is the exact payload that
  // ends up in the DB.
  const handleSendInfo = async () => {
    if (!selectedId || !pendingInfoFiles.length) return;
    setSendingInfo(true);
    try {
      const res = await fetchWithAuth(`${API}/${selectedId}/info`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          files: pendingInfoFiles.map((f) => ({ fileName: f.name, mimeType: f.type, base64: f.base64 })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Sent to customer");
      setPendingInfoFiles([]);
      setConfirmSendOpen(false);
      refetchDetail();
      qc.invalidateQueries({ queryKey: ["crm-query-payment"] });
      qc.invalidateQueries({ queryKey: ["crm-booking-lifecycle"] });
      qc.invalidateQueries({ queryKey: ["crm-legal-milestones"] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSendingInfo(false);
    }
  };

  const handleProxyProof = async (method: ProxyMethod, remarks: string) => {
    if (!selectedId || !proxyProofFile) return;
    setProxySaving(true);
    try {
      const formData = new FormData();
      formData.append("file", proxyProofFile);
      formData.append("ProxyMethod", method);
      formData.append("ProxyRemarks", remarks);
      const res = await fetchWithAuth(`${API}/${selectedId}/proxy-proof`, { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Payment proof uploaded on customer's behalf");
      setProxyProofDialog(false);
      setProxyProofFile(null);
      refetchDetail();
      qc.invalidateQueries({ queryKey: ["crm-query-payment"] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setProxySaving(false);
    }
  };

  const handleConfirm = async () => {
    if (!selectedId) return;
    setConfirming(true);
    try {
      const res = await fetchWithAuth(`${API}/${selectedId}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ConfirmedAmount: confirmAmount || undefined,
          Remarks: confirmRemarks || undefined,
          proof: proofFile ? { fileName: proofFile.name, mimeType: proofFile.type, base64: proofFile.base64 } : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Confirmed � customer has paid the government");
      setConfirmAmount("");
      setConfirmRemarks("");
      setProofFile(null);
      refetchDetail();
      qc.invalidateQueries({ queryKey: ["crm-query-payment"] });
      qc.invalidateQueries({ queryKey: ["crm-booking-lifecycle"] });
      qc.invalidateQueries({ queryKey: ["crm-legal-milestones"] });
      qc.invalidateQueries({ queryKey: ["crm-dashboard"] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setConfirming(false);
    }
  };

  const columns: ColumnDef<any, unknown>[] = [
    { accessorKey: "QPNo", header: "QP No", size: 110,
      cell: (i) => <span className="font-mono text-xs font-semibold text-primary">{i.getValue() as string}</span> },
    { accessorKey: "ApplicantName", header: "Customer", size: 160,
      cell: (i) => (
        <div>
          <div className="font-medium">{i.row.original.ApplicantName}</div>
          <div className="text-xs text-muted-foreground">{i.row.original.BookingNo} � {i.row.original.UnitNo}</div>
        </div>
      ) },
    { accessorKey: "DeedNo", header: "Deed", size: 100, cell: (i) => <span className="text-xs">{i.getValue() as string || "�"}</span> },
    { id: "amount", header: "Net Payable", size: 130,
      cell: (i) => <span className="text-xs font-mono">{formatINR(i.row.original.RequiredAmount)}</span> },
    { accessorKey: "Status", header: "Status", size: 110,
      cell: (i) => <StatusBadge status={i.row.original.Status} /> },
    { id: "actions", header: "", size: 90, enableSorting: false,
      cell: (i) => (
        <button onClick={() => setSelectedId(i.row.original.Id)} className="text-xs text-primary hover:underline">Open</button>
      ) },
  ];

  const goNext = () => setStep((s) => Math.min(2, s + 1));
  const goPrev = () => setStep((s) => Math.max(1, s - 1));

  return (
    <CrmShell
      title="Sale Deed Registration Fees"
      subtitle="Stamp duty & registration fee the buyer pays before the Sale Deed is registered at the Sub-Registrar Office (Visit 2 for under-construction; the only visit for Ready-to-Move)"
      action={
        <div className="flex items-center gap-3">
          {listUpdatedAt > 0 && (
            <button onClick={() => refetchList()} disabled={listFetching}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50">
              <RotateCcw size={12} className={listFetching ? "animate-spin" : ""} />
              {listFetching ? "Refreshing�" : "Refresh"}
            </button>
          )}
          <button onClick={() => setDialogOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90">
            <Plus size={14} /> Start Query Payment
          </button>
        </div>
      }
    >
      <DataTable
        data={rows as any[]}
        columns={columns}
        loading={isLoading}
        emptyMessage="No Query Payment trackers yet"
        className="rounded-xl border border-border overflow-hidden bg-card"
      />

      {/* Start dialog */}
      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) { setDialogOpen(false); setBookingId(""); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="font-heading">Start Query Payment</DialogTitle></DialogHeader>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Booking *</label>
            <select value={bookingId} onChange={(e) => setBookingId(e.target.value)}
              className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
              <option value="">Select booking</option>
              {startableBookings.map((b: any) => (
                <option key={b.Id} value={String(b.Id)}>{b.BookingNo} � {b.ApplicantName}</option>
              ))}
            </select>
            <p className="text-[11px] text-muted-foreground mt-1">Requires a Director-Approved Sale Deed for this booking.</p>
            {!startableBookings.length && (
              <p className="text-[11px] text-amber-600 mt-1">No bookings are eligible yet — the Sale Deed must be Director Approved first.</p>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <button onClick={() => { setDialogOpen(false); setBookingId(""); }} className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
            <button onClick={handleStart} disabled={saving || !bookingId}
              className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40">
              {saving ? "Starting..." : "Start"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Detail dialog � a two-step card wizard (Send Paperwork -> Confirm
          Payment) instead of one long scrolling form, matching how staff
          actually work this tracker one step at a time. */}
      <Dialog open={!!selectedId} onOpenChange={(o) => !o && setSelectedId(null)}>
        <DialogContent className="max-w-lg p-0 gap-0 overflow-hidden">
          {detail && (
            <>
              <DialogHeader className="px-6 py-4 border-b border-border">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <ReceiptIndianRupee size={15} className="text-primary" />
                  </div>
                  <div className="min-w-0">
                    <DialogTitle className="text-sm font-semibold font-heading font-mono">{detail.QPNo}</DialogTitle>
                    <DialogDescription className="text-[11px] mt-0.5">Query Payment details</DialogDescription>
                  </div>
                  <div className="ml-auto">
                    <StatusBadge status={detail.Status} />
                  </div>
                </div>
              </DialogHeader>

              <div className="px-6 pt-3">
                <div className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-3">
                  <p className="text-sm font-semibold text-foreground">{detail.ApplicantName}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{detail.BookingNo} � {detail.UnitNo} � Deed {detail.DeedNo || "�"}</p>
                  <p className="text-xs mt-1.5">
                    Stamp Duty {formatINR(detail.StampDuty)} + Reg. Fee {formatINR(detail.RegistrationFee)}
                    {detail.StampDutyCredit ? <> − AFS Credit {formatINR(detail.StampDutyCredit)}</> : null}
                    {" "}= <span className="font-semibold font-mono">{formatINR(detail.RequiredAmount)}</span> net payable
                  </p>
                </div>
                {detail.Status !== "Confirmed" && (!detail.StampDuty && !detail.RegistrationFee) && (
                  <div className="flex items-center gap-1.5 text-xs text-amber-600 mt-2">
                    <AlertTriangle size={12} /> Sales Deed has no Stamp Duty / Registration Fee amount on file yet.
                  </div>
                )}
              </div>

              {detail.Status === "Confirmed" ? (
                <div className="px-6 py-5">
                  <div className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3">
                    <CheckCircle2 size={16} />
                    <div>
                      <div className="font-medium">Government payment confirmed</div>
                      <div className="text-xs text-emerald-700/80 mt-0.5">
                        {detail.ConfirmedAt ? String(detail.ConfirmedAt).slice(0, 10) : ""}
                        {detail.ConfirmedAmount ? ` � ${formatINR(detail.ConfirmedAmount)}` : ""}
                      </div>
                    </div>
                  </div>
                  {detail.attachments?.length > 0 && (
                    <div className="mt-4">
                      <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground font-heading mb-2">Attachments</p>
                      <AttachmentList attachments={detail.attachments} />
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <StepTabs step={step} onChange={setStep} confirmed={false} />
                  <div className="px-6 py-5 max-h-[50vh] overflow-y-auto">
                    {step === 1 ? (
                      <div className="space-y-3">
                        <p className="text-xs text-muted-foreground">Send the customer the required amount and every paperwork item they need to complete the government payment.</p>
                        {detail.attachments?.length > 0 && (
                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground font-heading mb-2">Already Sent</p>
                            <AttachmentList attachments={detail.attachments} />
                          </div>
                        )}

                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground font-heading mb-2">
                            {pendingInfoFiles.length ? `Staged for sending (${pendingInfoFiles.length})` : "Attach Files"}
                          </p>
                          {pendingInfoFiles.length > 0 && (
                            <ul className="space-y-1.5 mb-2">
                              {pendingInfoFiles.map((f, idx) => (
                                <li key={`${f.name}-${idx}`} className="flex items-center gap-2 text-xs bg-muted/30 border border-border rounded-lg px-2.5 py-1.5">
                                  {f.type.startsWith("image/") ? (
                                    <img src={f.dataUri} alt={f.name} className="w-8 h-8 object-cover rounded shrink-0 border border-border" />
                                  ) : (
                                    <div className="w-8 h-8 rounded bg-muted flex items-center justify-center shrink-0">
                                      <FileText size={13} className="text-muted-foreground" />
                                    </div>
                                  )}
                                  <span className="truncate flex-1">{f.name}</span>
                                  <span className="text-muted-foreground shrink-0">{(f.size / 1024).toFixed(0)} KB</span>
                                  <button onClick={() => removeStagedFile(idx)} className="text-muted-foreground hover:text-rose-600 shrink-0" title="Remove">
                                    <X size={12} />
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}
                          <input type="file" multiple ref={infoInputRef} className="hidden" onChange={(e) => stageInfoFiles(e.target.files)} />
                          <button onClick={() => infoInputRef.current?.click()}
                            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium border border-dashed border-border rounded-lg hover:bg-muted transition-colors text-muted-foreground">
                            <Upload size={12} /> Choose Files...
                          </button>
                        </div>

                        <button
                          onClick={() => setConfirmSendOpen(true)}
                          disabled={!pendingInfoFiles.length}
                          className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-40 disabled:pointer-events-none transition-colors">
                          <Send size={12} /> {detail.Status === CrmStatus.PENDING ? "Send Info & Paperwork to Customer" : "Send Additional Documents"}
                        </button>
                        {!pendingInfoFiles.length && (
                          <p className="text-[11px] text-muted-foreground text-center">Attach at least one file before sending.</p>
                        )}
                                          {detail.Status === "InfoSent" && (
                          <div className="space-y-2">
                            <div className="flex items-center gap-1.5 text-xs text-blue-700">
                              <CheckCircle2 size={12} /> Sent &mdash; waiting on the customer to pay the government.
                            </div>
                            <div className="border-t border-border/60 pt-2">
                              <p className="text-[11px] text-muted-foreground mb-1.5 flex items-center gap-1"><UserCircle2 size={11} /> Customer not on portal?</p>
                              <div className="flex items-center gap-2 flex-wrap">
                                <input type="file" ref={proxyProofInputRef} className="hidden"
                                  onChange={(e) => setProxyProofFile(e.target.files?.[0] || null)} />
                                <button onClick={() => proxyProofInputRef.current?.click()}
                                  className="text-xs px-2.5 py-1.5 border border-border rounded-md font-medium hover:bg-muted flex items-center gap-1">
                                  <Upload size={11} /> {proxyProofFile ? proxyProofFile.name : "Select proof file..."}
                                </button>
                                <button onClick={() => proxyProofFile && setProxyProofDialog(true)}
                                  disabled={!proxyProofFile}
                                  className="text-xs px-3 py-1.5 bg-amber-50 border border-amber-300 text-amber-800 rounded-lg font-semibold hover:bg-amber-100 disabled:opacity-40 flex items-center gap-1.5">
                                  <UserCircle2 size={12} /> Upload on Their Behalf
                                </button>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <p className="text-xs text-muted-foreground">Once the customer has actually paid the government, confirm it here.</p>
                        <div className="space-y-1.5">
                          <label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground font-heading">Amount Actually Paid</label>
                          <Input type="number" className="h-10 font-mono" placeholder="Optional" value={confirmAmount} onChange={(e) => setConfirmAmount(e.target.value)} />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground font-heading">Remarks</label>
                          <Textarea rows={2} placeholder="Optional" value={confirmRemarks} onChange={(e) => setConfirmRemarks(e.target.value)} className="resize-none" />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground font-heading">Proof of Payment</label>
                          {proofFile ? (
                            <div className="flex items-center gap-2 text-xs bg-muted/30 border border-border rounded-lg px-2.5 py-1.5">
                              {proofFile.type.startsWith("image/") ? (
                                <img src={proofFile.dataUri} alt={proofFile.name} className="w-8 h-8 object-cover rounded shrink-0 border border-border" />
                              ) : (
                                <div className="w-8 h-8 rounded bg-muted flex items-center justify-center shrink-0">
                                  <FileText size={13} className="text-muted-foreground" />
                                </div>
                              )}
                              <span className="truncate flex-1">{proofFile.name}</span>
                              <button onClick={() => { setProofFile(null); if (proofInputRef.current) proofInputRef.current.value = ""; }} className="text-muted-foreground hover:text-rose-600 shrink-0" title="Remove">
                                <X size={12} />
                              </button>
                            </div>
                          ) : (
                            <>
                              <input type="file" ref={proofInputRef} className="hidden" onChange={(e) => stageProofFile(e.target.files)} />
                              <button onClick={() => proofInputRef.current?.click()}
                                className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium border border-dashed border-border rounded-lg hover:bg-muted transition-colors text-muted-foreground">
                                <ImageIcon size={12} /> Attach Proof (optional)
                              </button>
                            </>
                          )}
                        </div>
                        <button onClick={handleConfirm} disabled={confirming}
                          className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-40 transition-colors">
                          <CheckCircle2 size={12} /> {confirming ? "Confirming..." : "Confirm Customer Paid the Government"}
                        </button>
                      </div>
                    )}
                  </div>
                </>
              )}

              <DialogFooter className="px-6 py-3.5 border-t border-border bg-muted/20 flex items-center justify-between sm:justify-between">
                {detail.Status !== "Confirmed" ? (
                  <>
                    <button onClick={goPrev} disabled={step === 1}
                      className="flex items-center gap-1 px-3 py-2 text-xs font-medium rounded-lg text-muted-foreground hover:bg-muted disabled:opacity-30 disabled:pointer-events-none transition-colors">
                      <ChevronLeft size={13} /> Previous
                    </button>
                    <div className="flex items-center gap-2">
                      <button onClick={() => setSelectedId(null)} className="px-3 py-2 text-xs font-medium rounded-lg text-muted-foreground hover:bg-muted transition-colors">Close</button>
                      <button onClick={goNext} disabled={step === 2}
                        className="flex items-center gap-1 px-3 py-2 text-xs font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-30 disabled:pointer-events-none transition-colors">
                        Next <ChevronRight size={13} />
                      </button>
                    </div>
                  </>
                ) : (
                  <button onClick={() => setSelectedId(null)} className="ml-auto px-4 py-2 text-sm font-medium rounded-lg text-muted-foreground hover:bg-muted transition-colors">Close</button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* The real gate: sending is a customer-facing, semi-irreversible
          action (it flips Status to InfoSent and notifies the customer),
          so it needs an explicit confirmation step � not a bare file picker
          that fires the instant something is chosen. */}
      <AlertDialog open={confirmSendOpen} onOpenChange={(o) => !sendingInfo && setConfirmSendOpen(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send to customer?</AlertDialogTitle>
            <AlertDialogDescription>
              This sends {pendingInfoFiles.length} file{pendingInfoFiles.length === 1 ? "" : "s"} to {detail?.ApplicantName} and marks this step as sent. This can't be undone from here.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {pendingInfoFiles.length > 0 && (
            <ul className="space-y-1.5 text-xs text-muted-foreground max-h-32 overflow-y-auto">
              {pendingInfoFiles.map((f, idx) => (
                <li key={`${f.name}-${idx}`} className="flex items-center gap-1.5">
                  {f.type.startsWith("image/") ? (
                    <img src={f.dataUri} alt={f.name} className="w-5 h-5 object-cover rounded shrink-0 border border-border" />
                  ) : (
                    <FileText size={11} className="shrink-0" />
                  )}
                  <span className="truncate">{f.name}</span>
                </li>
              ))}
            </ul>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={sendingInfo}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleSendInfo} disabled={sendingInfo}>
              {sendingInfo ? "Sending..." : "Send"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {proxyProofDialog && (
        <ProxyActionDialog
          title="Upload Payment Proof on Customer's Behalf"
          description="You are uploading the government payment receipt the customer provided without using the portal."
          confirmLabel="Submit Proof"
          saving={proxySaving}
          onClose={() => setProxyProofDialog(false)}
          onConfirm={handleProxyProof}
        />
      )}
    </CrmShell>
  );
};

function AttachmentList({ attachments }: { attachments: any[] }) {
  return (
    <ul className="space-y-1.5">
      {attachments.map((a: any) => (
        <li key={a.AttachmentId} className="flex items-center gap-2 text-xs">
          <Paperclip size={11} className="text-muted-foreground shrink-0" />
          <a href={`${API}/attachment/${a.AttachmentId}`} target="_blank" rel="noreferrer" className="text-primary hover:underline truncate">{a.FileName}</a>
          <span className="text-muted-foreground shrink-0">� {a.DocType}</span>
        </li>
      ))}
    </ul>
  );
}

export default CrmQueryPayment;
