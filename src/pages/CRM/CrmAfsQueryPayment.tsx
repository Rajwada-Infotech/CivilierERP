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
  ChevronLeft, ChevronRight, Check, Upload, X, FileText, Image as ImageIcon, RotateCcw,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";

const API = "/api/crm/afs-query-payment";
const BKG_API = "/api/crm/bookings";

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
  base64: string;
  dataUri: string;
}

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

const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_COMBINED_BYTES = 6 * 1024 * 1024;

async function fetchAll(): Promise<any[]> {
  const r = await fetchWithAuth(API);
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error || "Failed to load AFS Query Payments");
  return r.json();
}
async function fetchBookings(): Promise<any[]> {
  const r = await fetchWithAuth(BKG_API);
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error || "Failed to load bookings");
  return r.json();
}
async function fetchDetail(id: number | null): Promise<any> {
  if (!id) return null;
  const r = await fetchWithAuth(`${API}/${id}`);
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error || "Failed to load AFS Query Payment");
  return r.json();
}

const CrmAfsQueryPayment: React.FC = () => {
  const qc = useQueryClient();
  const [sp] = useSearchParams();
  const deepLinkBookingId = sp.get("bookingId");
  const { canCreate, canEdit } = usePageRights("crm-afs-query-payment");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [newForm, setNewForm] = useState({ BookingId: "", StampDuty: "", RegistrationFee: "" });
  const [saving, setSaving] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [step, setStep] = useState(1);
  const [confirmAmount, setConfirmAmount] = useState("");
  const [confirmRemarks, setConfirmRemarks] = useState("");
  const [pendingInfoFiles, setPendingInfoFiles] = useState<StagedFile[]>([]);
  const [confirmSendOpen, setConfirmSendOpen] = useState(false);
  const [sendingInfo, setSendingInfo] = useState(false);
  const [proofFile, setProofFile] = useState<StagedFile | null>(null);
  const [confirming, setConfirming] = useState(false);
  const infoInputRef = useRef<HTMLInputElement>(null);
  const proofInputRef = useRef<HTMLInputElement>(null);

  const { data: rows = [], isLoading, dataUpdatedAt: listUpdatedAt, isFetching: listFetching, refetch: refetchList } = useQuery({ queryKey: ["crm-afs-query-payment"], queryFn: fetchAll, staleTime: 30_000 });
  const { data: bookings = [] } = useQuery({ queryKey: ["crm-bookings"], queryFn: fetchBookings, staleTime: 5 * 60_000 });
  const { data: detail, refetch: refetchDetail } = useQuery({
    queryKey: ["crm-afs-query-payment-detail", selectedId],
    queryFn: () => fetchDetail(selectedId),
    enabled: !!selectedId,
  });

  const trackedBookingIds = new Set((rows as any[]).map((r: any) => r.BookingId));
  const startableBookings = (bookings as any[]).filter((b: any) => !trackedBookingIds.has(b.Id));

  useEffect(() => {
    if (detail) setStep(detail.Status === CrmStatus.PENDING ? 1 : 2);
    setPendingInfoFiles([]);
    setProofFile(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail?.Id]);

  useEffect(() => {
    if (!deepLinkBookingId || !rows.length) return;
    const existing = (rows as any[]).find((r: any) => String(r.BookingId) === deepLinkBookingId);
    if (existing) setSelectedId(existing.Id);
    else if (startableBookings.some((b: any) => String(b.Id) === deepLinkBookingId)) {
      setNewForm((f) => ({ ...f, BookingId: deepLinkBookingId }));
      setDialogOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkBookingId, rows.length]);

  const handleStart = async () => {
    if (!newForm.BookingId) { toast.error("Booking is required"); return; }
    setSaving(true);
    try {
      const res = await fetchWithAuth(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          BookingId: parseInt(newForm.BookingId),
          StampDuty: newForm.StampDuty || undefined,
          RegistrationFee: newForm.RegistrationFee || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`${data.AfsQPNo} started`);
      setDialogOpen(false);
      setNewForm({ BookingId: "", StampDuty: "", RegistrationFee: "" });
      qc.invalidateQueries({ queryKey: ["crm-afs-query-payment"] });
      qc.invalidateQueries({ queryKey: ["crm-booking-lifecycle"] });
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
      toast.error(`Total attached files can't exceed ${(MAX_COMBINED_BYTES / 1024 / 1024).toFixed(0)}MB — send in a separate batch`);
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
      qc.invalidateQueries({ queryKey: ["crm-afs-query-payment"] });
      qc.invalidateQueries({ queryKey: ["crm-booking-lifecycle"] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSendingInfo(false);
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
      toast.success("Confirmed — customer has paid the government");
      setConfirmAmount("");
      setConfirmRemarks("");
      setProofFile(null);
      refetchDetail();
      qc.invalidateQueries({ queryKey: ["crm-afs-query-payment"] });
      qc.invalidateQueries({ queryKey: ["crm-booking-lifecycle"] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setConfirming(false);
    }
  };

  const columns: ColumnDef<any, unknown>[] = [
    { accessorKey: "AfsQPNo", header: "AQP No", size: 120,
      cell: (i) => <span className="font-mono text-xs font-semibold text-primary">{i.getValue() as string}</span> },
    { accessorKey: "ApplicantName", header: "Customer", size: 160,
      cell: (i) => (
        <div>
          <div className="font-medium">{i.row.original.ApplicantName}</div>
          <div className="text-xs text-muted-foreground">{i.row.original.BookingNo} · {i.row.original.UnitNo}</div>
        </div>
      ) },
    { accessorKey: "AgreementNo", header: "Agreement", size: 110,
      cell: (i) => <span className="text-xs font-mono">{(i.getValue() as string) || "—"}</span> },
    { id: "amount", header: "Amount", size: 120,
      cell: (i) => {
        const r = i.row.original;
        return r.RequiredAmount ? (
          <span className="text-xs font-mono">{formatINR(r.RequiredAmount)}</span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        );
      } },
    { accessorKey: "Status", header: "Status", size: 110,
      cell: (i) => <StatusBadge status={i.row.original.Status} /> },
    { id: "actions", header: "", size: 80, enableSorting: false,
      cell: (i) => (
        <button onClick={() => setSelectedId(i.row.original.Id)} className="text-xs text-primary hover:underline">Open</button>
      ) },
  ];

  const goNext = () => setStep((s) => Math.min(2, s + 1));
  const goPrev = () => setStep((s) => Math.max(1, s - 1));

  return (
    <CrmShell
      title="Agreement Registration Fees"
      subtitle="Stamp duty & registration fee the buyer must pay before the Agreement for Sale is registered at the Sub-Registrar's Office (Visit 1)"
      action={
        <div className="flex items-center gap-3">
          {listUpdatedAt > 0 && (
            <button onClick={() => refetchList()} disabled={listFetching}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50">
              <RotateCcw size={12} className={listFetching ? "animate-spin" : ""} />
              {listFetching ? "Refreshing…" : "Refresh"}
            </button>
          )}
          {canCreate && (
            <button onClick={() => setDialogOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90">
              <Plus size={14} /> Start AFS Query Payment
            </button>
          )}
        </div>
      }
    >
      <Breadcrumbs items={[{ label: "CRM" }, { label: "Legal" }, { label: "AFS Query Payment" }]} />

      <DataTable
        data={rows as any[]}
        columns={columns}
        loading={isLoading}
        emptyMessage="No AFS Query Payment trackers yet"
        className="rounded-xl border border-border overflow-hidden bg-card"
      />

      {/* Start dialog */}
      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) { setDialogOpen(false); setNewForm({ BookingId: "", StampDuty: "", RegistrationFee: "" }); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-heading">Start AFS Query Payment</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Booking *</label>
              <select value={newForm.BookingId} onChange={(e) => setNewForm((f) => ({ ...f, BookingId: e.target.value }))}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                <option value="">Select booking</option>
                {startableBookings.map((b: any) => (
                  <option key={b.Id} value={String(b.Id)}>{b.BookingNo} · {b.ApplicantName}</option>
                ))}
              </select>
              <p className="text-[11px] text-muted-foreground mt-1">Requires the Agreement for Sale to be Executed.</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Stamp Duty</label>
                <Input type="number" className="h-9 font-mono text-sm" placeholder="Optional" value={newForm.StampDuty} onChange={(e) => setNewForm((f) => ({ ...f, StampDuty: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Registration Fee</label>
                <Input type="number" className="h-9 font-mono text-sm" placeholder="Optional" value={newForm.RegistrationFee} onChange={(e) => setNewForm((f) => ({ ...f, RegistrationFee: e.target.value }))} />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">Amount can be filled in now or updated before paperwork is sent to the customer.</p>
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <button onClick={() => { setDialogOpen(false); setNewForm({ BookingId: "", StampDuty: "", RegistrationFee: "" }); }}
              className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
            <button onClick={handleStart} disabled={saving || !newForm.BookingId}
              className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40">
              {saving ? "Starting..." : "Start"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Detail dialog */}
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
                    <DialogTitle className="text-sm font-semibold font-heading font-mono">{detail.AfsQPNo}</DialogTitle>
                    <DialogDescription className="text-[11px] mt-0.5">AFS Query Payment — Sub-Registrar Visit 1</DialogDescription>
                  </div>
                  <div className="ml-auto">
                    <StatusBadge status={detail.Status} />
                  </div>
                </div>
              </DialogHeader>

              <div className="px-6 pt-3">
                <div className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-3">
                  <p className="text-sm font-semibold text-foreground">{detail.ApplicantName}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {detail.BookingNo} · {detail.UnitNo} · Agreement {detail.AgreementNo || "—"}
                  </p>
                  {detail.RequiredAmount > 0 ? (
                    <p className="text-xs mt-1.5">
                      Stamp Duty {formatINR(detail.StampDuty)} + Reg. Fee {formatINR(detail.RegistrationFee)}
                      {" "}= <span className="font-semibold font-mono">{formatINR(detail.RequiredAmount)}</span> payable
                    </p>
                  ) : (
                    <p className="text-xs mt-1.5 text-muted-foreground">Amount not set yet — enter Stamp Duty and Registration Fee.</p>
                  )}
                  {detail.AfsRegistrationNo && (
                    <p className="text-[11px] mt-1 text-emerald-700">
                      AFS Registered: {detail.AfsRegistrationNo} on {detail.AfsRegistrationDate ? String(detail.AfsRegistrationDate).slice(0, 10) : "—"}
                    </p>
                  )}
                </div>
                {detail.Status !== "Confirmed" && detail.RequiredAmount === 0 && (
                  <div className="flex items-center gap-1.5 text-xs text-amber-600 mt-2">
                    <AlertTriangle size={12} /> Stamp Duty and Registration Fee are not set — enter them before sending to customer.
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
                        {detail.ConfirmedAmount ? ` · ${formatINR(detail.ConfirmedAmount)}` : ""}
                      </div>
                    </div>
                  </div>
                  {detail.attachments?.length > 0 && (
                    <div className="mt-4">
                      <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground font-heading mb-2">Attachments</p>
                      <AttachmentList attachments={detail.attachments} apiBase={API} />
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <StepTabs step={step} onChange={setStep} confirmed={false} />
                  <div className="px-6 py-5 max-h-[50vh] overflow-y-auto">
                    {step === 1 ? (
                      <div className="space-y-3">
                        <p className="text-xs text-muted-foreground">
                          Send the customer the AFS stamp duty amount and any paperwork they need to bring to the Sub-Registrar.
                        </p>
                        {detail.attachments?.length > 0 && (
                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground font-heading mb-2">Already Sent</p>
                            <AttachmentList attachments={detail.attachments} apiBase={API} />
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
                          <div className="flex items-center gap-1.5 text-xs text-blue-700">
                            <CheckCircle2 size={12} /> Sent — waiting on the customer to pay at the Sub-Registrar.
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <p className="text-xs text-muted-foreground">Once the customer has paid the AFS stamp duty to the Sub-Registrar, confirm it here.</p>
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

      <AlertDialog open={confirmSendOpen} onOpenChange={(o) => !sendingInfo && setConfirmSendOpen(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send to customer?</AlertDialogTitle>
            <AlertDialogDescription>
              This sends {pendingInfoFiles.length} file{pendingInfoFiles.length === 1 ? "" : "s"} to {detail?.ApplicantName} and marks this step as sent. This cannot be undone from here.
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
    </CrmShell>
  );
};

function AttachmentList({ attachments, apiBase }: { attachments: any[]; apiBase: string }) {
  return (
    <ul className="space-y-1.5">
      {attachments.map((a) => (
        <li key={a.AttachmentId}>
          <a
            href={`${apiBase}/attachment/${a.AttachmentId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-xs text-primary hover:underline bg-muted/30 border border-border rounded-lg px-2.5 py-1.5"
          >
            {a.MimeType?.startsWith("image/") ? <ImageIcon size={12} /> : <FileText size={12} />}
            <span className="truncate flex-1">{a.FileName}</span>
            <span className="text-muted-foreground shrink-0 capitalize">{a.DocType}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

export default CrmAfsQueryPayment;
