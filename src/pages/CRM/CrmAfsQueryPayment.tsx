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
  DialogClose,
} from "@/components/ui/dialog";
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
  const [dialogFeesLocked, setDialogFeesLocked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [step, setStep] = useState(1);
  const [confirmAmount, setConfirmAmount] = useState("");
  const [confirmRemarks, setConfirmRemarks] = useState("");
  const [pendingInfoFiles, setPendingInfoFiles] = useState<StagedFile[]>([]);
  const [awaitingSendConfirm, setAwaitingSendConfirm] = useState(false);
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
  const startableBookings = (bookings as any[]).filter(
    (b: any) => !trackedBookingIds.has(b.Id) && (b.AgreementStatus === "Executed" || b.AgreementStatus === "Registered")
  );

  // The booking the user navigated to from Legal Journey (may or may not have a record)
  const deepLinkedBooking = deepLinkBookingId
    ? (bookings as any[]).find((b: any) => String(b.Id) === deepLinkBookingId)
    : null;
  const deepLinkedRow = deepLinkBookingId
    ? (rows as any[]).find((r: any) => String(r.BookingId) === deepLinkBookingId)
    : null;

  useEffect(() => {
    if (detail) setStep(detail.Status === CrmStatus.PENDING ? 1 : 2);
    setPendingInfoFiles([]);
    setProofFile(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail?.Id]);

  useEffect(() => {
    if (!deepLinkBookingId || !(rows as any[]).length || !(bookings as any[]).length) return;
    const existing = (rows as any[]).find((r: any) => String(r.BookingId) === deepLinkBookingId);
    if (existing) {
      setSelectedId(existing.Id);
    } else {
      const bk = (bookings as any[]).find((b: any) => String(b.Id) === deepLinkBookingId);
      if (bk && (bk.AgreementStatus === "Executed" || bk.AgreementStatus === "Registered")) {
        setNewForm((f) => ({ ...f, BookingId: deepLinkBookingId }));
        setDialogOpen(true);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkBookingId, (rows as any[]).length, (bookings as any[]).length]);

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
      setAwaitingSendConfirm(false);
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

  // ── Inline workflow panel (shown when deep-linked to a booking with an existing record) ──
  const InlineDetail = () => {
    if (!detail) return <div className="p-8 text-center text-sm text-muted-foreground">Loading…</div>;
    return (
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-border bg-muted/20 flex items-center gap-3 flex-wrap">
          <div className="w-9 h-9 shrink-0 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
            <ReceiptIndianRupee size={16} className="text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-sm font-bold">{detail.AfsQPNo}</span>
              <StatusBadge status={detail.Status} />
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">{detail.ApplicantName} · {detail.BookingNo} · {detail.UnitNo}</p>
          </div>
        </div>

        {/* Amount summary */}
        <div className="px-5 py-3 border-b border-border bg-muted/10">
          {detail.RequiredAmount > 0 ? (
            <div className="flex items-center gap-6 flex-wrap">
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Stamp Duty</p>
                <p className="text-sm font-mono font-semibold">{formatINR(detail.StampDuty)}</p>
              </div>
              <span className="text-muted-foreground">+</span>
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Registration Fee</p>
                <p className="text-sm font-mono font-semibold">{formatINR(detail.RegistrationFee)}</p>
              </div>
              <span className="text-muted-foreground">=</span>
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Total Payable</p>
                <p className="text-base font-mono font-bold text-primary">{formatINR(detail.RequiredAmount)}</p>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-amber-600 text-xs">
              <AlertTriangle size={13} /> Stamp Duty and Registration Fee not set yet — fill them in before sending to the customer.
            </div>
          )}
          {detail.AfsRegistrationNo && (
            <p className="text-[11px] text-green-700 dark:text-green-400 mt-2">
              ✓ AFS Registered: {detail.AfsRegistrationNo} · {detail.AfsRegistrationDate ? String(detail.AfsRegistrationDate).slice(0, 10) : "—"}
            </p>
          )}
        </div>

        {detail.Status === "Confirmed" ? (
          <div className="px-5 py-5 space-y-4">
            <div className="flex items-center gap-3 bg-green-500/[0.06] border border-green-200 dark:border-green-900/50 rounded-xl px-4 py-3">
              <CheckCircle2 size={18} className="text-green-600 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-green-700 dark:text-green-300">Government payment confirmed</p>
                <p className="text-xs text-green-600/80 dark:text-green-400/80 mt-0.5">
                  {detail.ConfirmedAt ? String(detail.ConfirmedAt).slice(0, 10) : ""}
                  {detail.ConfirmedAmount ? ` · ${formatINR(detail.ConfirmedAmount)} received` : ""}
                </p>
              </div>
            </div>
            {detail.attachments?.length > 0 && (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">Proof &amp; Documents</p>
                <AttachmentList attachments={detail.attachments} apiBase={API} />
              </div>
            )}
          </div>
        ) : (
          <div className="divide-y divide-border">
            {/* Step 1: Send paperwork */}
            <div className={`px-5 py-4 space-y-3 ${step === 1 ? "" : "opacity-60 pointer-events-none"}`}>
              <div className="flex items-center gap-2">
                <span className={`w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center shrink-0 ${step > 1 ? "bg-green-500 text-white" : "bg-primary text-primary-foreground"}`}>
                  {step > 1 ? <Check size={10} /> : "1"}
                </span>
                <p className="text-sm font-semibold">Send Fee Breakdown to Customer</p>
              </div>
              <p className="text-xs text-muted-foreground pl-7">Attach any paperwork and send the stamp duty amount so the buyer knows what to bring to the Sub-Registrar's Office.</p>
              {detail.attachments?.filter((a: any) => a.DocType === "info").length > 0 && (
                <div className="pl-7">
                  <p className="text-[11px] text-muted-foreground font-medium mb-1.5">Already sent</p>
                  <AttachmentList attachments={detail.attachments.filter((a: any) => a.DocType === "info")} apiBase={API} />
                </div>
              )}
              <div className="pl-7 space-y-2">
                {pendingInfoFiles.length > 0 && (
                  <ul className="space-y-1.5">
                    {pendingInfoFiles.map((f, idx) => (
                      <li key={`${f.name}-${idx}`} className="flex items-center gap-2 text-xs bg-muted/30 border border-border rounded-lg px-2.5 py-1.5">
                        {f.type.startsWith("image/") ? (
                          <img src={f.dataUri} alt={f.name} className="w-7 h-7 object-cover rounded shrink-0 border border-border" />
                        ) : (
                          <div className="w-7 h-7 rounded bg-muted flex items-center justify-center shrink-0"><FileText size={12} /></div>
                        )}
                        <span className="truncate flex-1">{f.name}</span>
                        <span className="text-muted-foreground shrink-0 text-[10px]">{(f.size / 1024).toFixed(0)} KB</span>
                        <button onClick={() => removeStagedFile(idx)} className="text-muted-foreground hover:text-rose-600 shrink-0"><X size={11} /></button>
                      </li>
                    ))}
                  </ul>
                )}
                <input type="file" multiple ref={infoInputRef} className="hidden" onChange={(e) => stageInfoFiles(e.target.files)} />
                <div className="flex items-center gap-2">
                  <button onClick={() => infoInputRef.current?.click()}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-dashed border-border rounded-lg hover:bg-muted transition-colors text-muted-foreground">
                    <Upload size={11} /> Attach files
                  </button>
                  {awaitingSendConfirm ? (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">Send {pendingInfoFiles.length} file{pendingInfoFiles.length !== 1 ? "s" : ""}?</span>
                      <button onClick={() => setAwaitingSendConfirm(false)} disabled={sendingInfo} className="px-2.5 py-1 text-xs rounded-lg border border-border hover:bg-muted transition-colors">Cancel</button>
                      <button onClick={handleSendInfo} disabled={sendingInfo} className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-40 transition-colors">
                        <Send size={10} /> {sendingInfo ? "Sending…" : "Confirm Send"}
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => setAwaitingSendConfirm(true)} disabled={!pendingInfoFiles.length}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-40 transition-colors">
                      <Send size={11} /> {detail.Status === CrmStatus.PENDING ? "Send to Customer" : "Send More"}
                    </button>
                  )}
                </div>
                {detail.Status === "InfoSent" && (
                  <div className="flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400">
                    <CheckCircle2 size={11} /> Sent — waiting for customer to pay at the Sub-Registrar.
                    <button onClick={() => setStep(2)} className="ml-auto text-xs text-primary font-medium hover:underline">Go to Step 2 →</button>
                  </div>
                )}
              </div>
            </div>

            {/* Step 2: Confirm payment */}
            <div className={`px-5 py-4 space-y-3 ${step === 2 ? "" : "opacity-60"}`}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className={`w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center shrink-0 ${step === 2 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>2</span>
                  <p className="text-sm font-semibold">Confirm Customer Paid the Government</p>
                </div>
                {step !== 2 && (
                  <button onClick={() => setStep(2)} className="text-xs text-primary font-medium hover:underline shrink-0">Open →</button>
                )}
              </div>
              {step === 2 && (
                <div className="pl-7 space-y-3">
                  <p className="text-xs text-muted-foreground">Once the customer has paid stamp duty and registration fees at the Sub-Registrar's Office, record the confirmation here.</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[11px] text-muted-foreground block mb-1">Amount Actually Paid (₹)</label>
                      <Input type="number" className="h-9 font-mono text-sm" placeholder="Optional" value={confirmAmount} onChange={(e) => setConfirmAmount(e.target.value)} />
                    </div>
                    <div>
                      <label className="text-[11px] text-muted-foreground block mb-1">Remarks</label>
                      <Input className="h-9 text-sm" placeholder="Optional" value={confirmRemarks} onChange={(e) => setConfirmRemarks(e.target.value)} />
                    </div>
                  </div>
                  <div>
                    <label className="text-[11px] text-muted-foreground block mb-1">Proof of Payment (optional)</label>
                    {proofFile ? (
                      <div className="flex items-center gap-2 text-xs bg-muted/30 border border-border rounded-lg px-2.5 py-1.5">
                        {proofFile.type.startsWith("image/") ? (
                          <img src={proofFile.dataUri} alt={proofFile.name} className="w-7 h-7 object-cover rounded shrink-0 border border-border" />
                        ) : (
                          <div className="w-7 h-7 rounded bg-muted flex items-center justify-center shrink-0"><FileText size={12} /></div>
                        )}
                        <span className="truncate flex-1">{proofFile.name}</span>
                        <button onClick={() => { setProofFile(null); if (proofInputRef.current) proofInputRef.current.value = ""; }} className="text-muted-foreground hover:text-rose-600 shrink-0"><X size={11} /></button>
                      </div>
                    ) : (
                      <>
                        <input type="file" ref={proofInputRef} className="hidden" onChange={(e) => stageProofFile(e.target.files)} />
                        <button onClick={() => proofInputRef.current?.click()}
                          className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium border border-dashed border-border rounded-lg hover:bg-muted transition-colors text-muted-foreground">
                          <Upload size={11} /> Attach receipt / proof
                        </button>
                      </>
                    )}
                  </div>
                  <button onClick={handleConfirm} disabled={confirming}
                    className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 text-sm font-semibold bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-40 transition-colors">
                    <CheckCircle2 size={14} /> {confirming ? "Confirming…" : "Mark as Paid — Government Fees Confirmed"}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <CrmShell
      title="Agreement Registration Fees"
      subtitle="Stamp duty & registration fee the buyer must pay before the Agreement for Sale is registered at the Sub-Registrar's Office (Visit 1)"
      action={
        <div className="flex items-center gap-3">
          {listUpdatedAt > 0 && !deepLinkBookingId && (
            <button onClick={() => refetchList()} disabled={listFetching}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50">
              <RotateCcw size={12} className={listFetching ? "animate-spin" : ""} />
              {listFetching ? "Refreshing…" : "Refresh"}
            </button>
          )}
          {canCreate && !deepLinkBookingId && (
            <button onClick={() => setDialogOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90">
              <Plus size={14} /> Start Registration Fees
            </button>
          )}
        </div>
      }
    >
      <Breadcrumbs items={[{ label: "CRM" }, { label: "Legal" }, { label: "Agreement Registration Fees" }]} />

      {/* ── BOOKING-FOCUSED MODE (came from Legal Journey) ── */}
      {deepLinkBookingId ? (
        <div className="space-y-3">
          {/* Booking identity card */}
          {deepLinkedBooking && (
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="px-5 py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold">{deepLinkedBooking.ApplicantName}</p>
                  <p className="text-xs text-muted-foreground">{deepLinkedBooking.BookingNo} · {deepLinkedBooking.UnitNo} · Agreement {deepLinkedBooking.AgreementStatus}</p>
                </div>
                <span className={`shrink-0 text-[11px] px-2.5 py-1 rounded-lg border font-semibold ${
                  deepLinkedBooking.AgreementStatus === "Registered" ? "bg-green-100 border-green-300 text-green-700 dark:bg-green-900/30 dark:border-green-700 dark:text-green-300"
                  : deepLinkedBooking.AgreementStatus === "Executed" ? "bg-blue-100 border-blue-300 text-blue-700 dark:bg-blue-900/30 dark:border-blue-700 dark:text-blue-300"
                  : "bg-muted/40 border-border text-muted-foreground"
                }`}>Agreement {deepLinkedBooking.AgreementStatus}</span>
              </div>
            </div>
          )}

          {/* Case A: already registered — no tracker needed */}
          {deepLinkedBooking?.AgreementStatus === "Registered" && !deepLinkedRow && (
            <div className="rounded-xl border border-green-200 dark:border-green-900/50 bg-green-500/[0.05] overflow-hidden">
              <div className="px-5 py-5 flex items-start gap-4">
                <div className="w-10 h-10 shrink-0 rounded-full bg-green-100 dark:bg-green-900/40 border-2 border-green-400 dark:border-green-600 flex items-center justify-center">
                  <CheckCircle2 size={18} className="text-green-600 dark:text-green-400" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-green-700 dark:text-green-300">Agreement for Sale is Registered</p>
                  <p className="text-xs text-green-600/80 dark:text-green-400/70 mt-1 max-w-lg">
                    This agreement was registered at the Sub-Registrar's Office. The stamp duty and registration fees were settled directly — no in-system fee tracker was created. All registration details are on the Agreement page.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Case B: existing record — show inline workflow */}
          {deepLinkedRow && selectedId && <InlineDetail />}

          {/* Case C: Executed but no record yet — inline start form */}
          {deepLinkedBooking && !deepLinkedRow && deepLinkedBooking.AgreementStatus !== "Registered" && canCreate && (
            <div className="rounded-xl border border-primary/30 bg-primary/[0.03] overflow-hidden">
              <div className="px-5 py-4 border-b border-primary/20 bg-primary/[0.04]">
                <p className="text-sm font-semibold">Start Registration Fee Process</p>
                <p className="text-xs text-muted-foreground mt-0.5">Enter the stamp duty and registration fee amounts. The buyer will be notified and can confirm payment through their portal.</p>
              </div>
              <div className="px-5 py-4 space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-foreground block mb-1.5">Stamp Duty (₹) <span className="font-normal text-muted-foreground">(optional)</span></label>
                    <Input type="number" className="h-9 font-mono text-sm" placeholder="e.g. 50000"
                      value={newForm.StampDuty} onChange={(e) => setNewForm((f) => ({ ...f, StampDuty: e.target.value }))} />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-foreground block mb-1.5">Registration Fee (₹) <span className="font-normal text-muted-foreground">(optional)</span></label>
                    <Input type="number" className="h-9 font-mono text-sm" placeholder="e.g. 30000"
                      value={newForm.RegistrationFee} onChange={(e) => setNewForm((f) => ({ ...f, RegistrationFee: e.target.value }))} />
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground">Amounts can be left blank now and filled in later before sending to the customer.</p>
                <button onClick={handleStart} disabled={saving}
                  className="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-40 transition-colors">
                  <CheckCircle2 size={14} /> {saving ? "Starting…" : "Start — Create Registration Fee Tracker"}
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        /* ── LIST MODE (admin overview, no bookingId param) ── */
        <>
          <DataTable
            data={rows as any[]}
            columns={columns}
            loading={isLoading}
            emptyMessage="No registration fee trackers started yet. Click 'Start Registration Fees' to begin for a booking whose Agreement for Sale has been executed."
            className="rounded-xl border border-border overflow-hidden bg-card"
          />

          {/* Start dialog (list-mode only) */}
          <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) { setDialogOpen(false); setDialogFeesLocked(false); setNewForm({ BookingId: "", StampDuty: "", RegistrationFee: "" }); } }}>
            <DialogContent className="max-w-md p-0 gap-0 overflow-hidden">
              <DialogHeader className="px-5 py-4 border-b border-border bg-muted/20">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 shrink-0 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                    <ReceiptIndianRupee size={16} className="text-primary" />
                  </div>
                  <div>
                    <DialogTitle className="font-heading text-base">Start Registration Fee Tracker</DialogTitle>
                    <p className="text-[11px] text-muted-foreground mt-0.5">Select a booking whose Agreement for Sale is Executed, then enter the government-calculated stamp duty and registration fees.</p>
                  </div>
                </div>
              </DialogHeader>
              <div className="px-5 py-4 space-y-4">
                <div>
                  <label className="text-xs font-semibold text-foreground block mb-1.5">Booking <span className="text-red-500">*</span></label>
                  <select value={newForm.BookingId} onChange={(e) => {
                    const bid = e.target.value;
                    const bk = (bookings as any[]).find((b: any) => String(b.Id) === bid);
                    const stamp = bk?.AfsStampDuty != null ? String(bk.AfsStampDuty) : "";
                    const fee   = bk?.AfsRegistrationFee != null ? String(bk.AfsRegistrationFee) : "";
                    setNewForm((f) => ({ ...f, BookingId: bid, StampDuty: stamp, RegistrationFee: fee }));
                    setDialogFeesLocked(stamp !== "" || fee !== "");
                  }}
                    className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-background focus:outline-none focus:ring-1 focus:ring-primary">
                    <option value="">Select booking…</option>
                    {startableBookings.map((b: any) => (
                      <option key={b.Id} value={String(b.Id)}>{b.BookingNo} · {b.ApplicantName} ({b.AgreementStatus})</option>
                    ))}
                  </select>
                  {startableBookings.length === 0 && (
                    <p className="text-[11px] text-amber-600 mt-1">No eligible bookings — Agreement for Sale must be Executed first. Go to <span className="font-semibold">Documents → Agreements</span>.</p>
                  )}
                </div>

                {/* Fee fields — pre-filled from Agreement record when booking selected */}
                <div className={`rounded-lg border p-3 space-y-2 ${dialogFeesLocked ? "border-green-200 bg-green-500/[0.04] dark:border-green-900/50" : "border-border"}`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-semibold text-foreground">Government Fees</p>
                      {dialogFeesLocked && (
                        <p className="text-[11px] text-green-700 dark:text-green-400 mt-0.5">Pre-filled from Agreement record — verify and edit if needed</p>
                      )}
                    </div>
                    {dialogFeesLocked ? (
                      <button type="button" onClick={() => setDialogFeesLocked(false)}
                        className="shrink-0 text-[11px] px-2 py-1 rounded-lg border border-border text-muted-foreground hover:bg-muted font-medium">Edit</button>
                    ) : (newForm.StampDuty !== "" || newForm.RegistrationFee !== "") ? (
                      <button type="button" onClick={() => setDialogFeesLocked(true)}
                        className="shrink-0 text-[11px] px-2 py-1 rounded-lg border border-green-300 text-green-700 hover:bg-green-50 font-medium dark:border-green-700 dark:text-green-400">Lock</button>
                    ) : null}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[11px] text-muted-foreground block mb-1">Stamp Duty (₹)</label>
                      <Input type="number" className={`h-9 font-mono text-sm ${dialogFeesLocked ? "bg-muted/30" : ""}`} placeholder="Optional"
                        value={newForm.StampDuty} readOnly={dialogFeesLocked}
                        onChange={(e) => setNewForm((f) => ({ ...f, StampDuty: e.target.value }))} />
                    </div>
                    <div>
                      <label className="text-[11px] text-muted-foreground block mb-1">Registration Fee (₹)</label>
                      <Input type="number" className={`h-9 font-mono text-sm ${dialogFeesLocked ? "bg-muted/30" : ""}`} placeholder="Optional"
                        value={newForm.RegistrationFee} readOnly={dialogFeesLocked}
                        onChange={(e) => setNewForm((f) => ({ ...f, RegistrationFee: e.target.value }))} />
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex justify-end gap-2 px-5 py-3 border-t border-border bg-muted/10">
                <button onClick={() => { setDialogOpen(false); setDialogFeesLocked(false); setNewForm({ BookingId: "", StampDuty: "", RegistrationFee: "" }); }}
                  className="px-4 py-2 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted font-medium">Cancel</button>
                <button onClick={handleStart} disabled={saving || !newForm.BookingId}
                  className="px-5 py-2 text-sm bg-primary text-primary-foreground rounded-lg font-semibold hover:bg-primary/90 disabled:opacity-40 flex items-center gap-1.5">
                  {saving ? "Starting…" : <><CheckCircle2 size={14} /> Start Tracker</>}
                </button>
              </div>
            </DialogContent>
          </Dialog>

          {/* Detail dialog (list-mode: row click → dialog) */}
          <Dialog open={!!selectedId && !deepLinkBookingId} onOpenChange={(o) => { if (!o) { setSelectedId(null); setAwaitingSendConfirm(false); setPendingInfoFiles([]); } }}>
            <DialogContent className="max-w-lg p-0 gap-0 overflow-hidden rounded-xl">
              {/* DialogTitle/Description must always be present for a11y */}
              <DialogTitle className="sr-only">{detail ? `${detail.AfsQPNo} — AFS Query Payment` : "AFS Query Payment"}</DialogTitle>
              <DialogDescription className="sr-only">{detail ? `${detail.ApplicantName} · ${detail.BookingNo}` : "Loading record…"}</DialogDescription>

              {!detail ? (
                <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">Loading…</div>
              ) : (
                <>
                  {/* Header */}
                  <div className="px-5 pt-5 pb-4 border-b border-border">
                    <div className="flex items-start gap-3">
                      <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                        <ReceiptIndianRupee size={16} className="text-primary" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold font-mono text-foreground">{detail.AfsQPNo}</span>
                          <StatusBadge status={detail.Status} />
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{detail.ApplicantName} · {detail.BookingNo}</p>
                      </div>
                      <DialogClose asChild>
                        <button className="shrink-0 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                          <X size={14} />
                        </button>
                      </DialogClose>
                    </div>

                    {/* Fee summary strip */}
                    {detail.RequiredAmount > 0 ? (
                      <div className="mt-3 flex items-center gap-2 flex-wrap text-[11px] text-muted-foreground">
                        <span className="px-2 py-0.5 rounded bg-muted font-mono">Stamp {formatINR(detail.StampDuty)}</span>
                        <span className="text-muted-foreground/50">+</span>
                        <span className="px-2 py-0.5 rounded bg-muted font-mono">Reg. Fee {formatINR(detail.RegistrationFee)}</span>
                        <span className="text-muted-foreground/50">=</span>
                        <span className="px-2 py-0.5 rounded bg-primary/10 text-primary font-semibold font-mono">{formatINR(detail.RequiredAmount)}</span>
                      </div>
                    ) : (
                      <div className="mt-3 flex items-center gap-1.5 text-[11px] text-amber-600 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
                        <AlertTriangle size={11} /> Amounts not set — fill before sending to customer.
                      </div>
                    )}
                  </div>

                  {/* Body */}
                  {detail.Status === "Confirmed" ? (
                    <div className="px-5 py-5 space-y-4">
                      <div className="flex items-center gap-3 text-sm text-green-700 bg-green-50 border border-green-200 rounded-xl px-4 py-3 dark:bg-green-900/20 dark:border-green-800/60 dark:text-green-400">
                        <CheckCircle2 size={18} className="shrink-0" />
                        <div>
                          <div className="font-semibold text-[13px]">Government payment confirmed</div>
                          <div className="text-[11px] opacity-80 mt-0.5">
                            {detail.ConfirmedAt ? String(detail.ConfirmedAt).slice(0, 10) : ""}
                            {detail.ConfirmedAmount ? ` · ${formatINR(detail.ConfirmedAmount)}` : ""}
                          </div>
                        </div>
                      </div>
                      {detail.attachments?.length > 0 && (
                        <div>
                          <p className="text-[11px] font-medium text-muted-foreground mb-2 uppercase tracking-wide">Attachments</p>
                          <AttachmentList attachments={detail.attachments} apiBase={API} />
                        </div>
                      )}
                    </div>
                  ) : (
                    <>
                      <StepTabs step={step} onChange={setStep} confirmed={false} />
                      <div className="px-5 py-4 max-h-[45vh] overflow-y-auto thin-scroll space-y-3">
                        {step === 1 ? (
                          <>
                            {detail.attachments?.filter((a: any) => a.DocType === "info").length > 0 && (
                              <div>
                                <p className="text-[11px] font-medium text-muted-foreground mb-2">Previously sent</p>
                                <AttachmentList attachments={detail.attachments.filter((a: any) => a.DocType === "info")} apiBase={API} />
                              </div>
                            )}
                            {pendingInfoFiles.length > 0 && (
                              <div>
                                <p className="text-[11px] font-medium text-muted-foreground mb-2">Ready to send ({pendingInfoFiles.length})</p>
                                <ul className="space-y-1.5">
                                  {pendingInfoFiles.map((f, idx) => (
                                    <li key={`${f.name}-${idx}`} className="flex items-center gap-2 text-xs bg-primary/5 border border-primary/20 rounded-lg px-2.5 py-1.5">
                                      {f.type.startsWith("image/") ? (
                                        <img src={f.dataUri} alt={f.name} className="w-7 h-7 object-cover rounded shrink-0 border border-border" />
                                      ) : (
                                        <div className="w-7 h-7 rounded bg-muted flex items-center justify-center shrink-0"><FileText size={12} /></div>
                                      )}
                                      <span className="truncate flex-1 font-medium">{f.name}</span>
                                      <button onClick={() => removeStagedFile(idx)} className="text-muted-foreground hover:text-rose-500 shrink-0 p-0.5 rounded hover:bg-rose-50 dark:hover:bg-rose-900/20">
                                        <X size={11} />
                                      </button>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            <input type="file" multiple ref={infoInputRef} className="hidden" onChange={(e) => stageInfoFiles(e.target.files)} />
                            <button onClick={() => infoInputRef.current?.click()} className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium border border-dashed border-border rounded-lg hover:bg-muted text-muted-foreground transition-colors">
                              <Upload size={12} /> Choose Files
                            </button>
                            {awaitingSendConfirm ? (
                              <div className="flex items-center gap-2">
                                <span className="flex-1 text-xs text-muted-foreground">Send {pendingInfoFiles.length} file{pendingInfoFiles.length !== 1 ? "s" : ""} to customer?</span>
                                <button onClick={() => setAwaitingSendConfirm(false)} disabled={sendingInfo} className="px-2.5 py-1.5 text-xs rounded-lg border border-border hover:bg-muted transition-colors shrink-0">Cancel</button>
                                <button onClick={handleSendInfo} disabled={sendingInfo} className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-40 transition-colors shrink-0">
                                  <Send size={11} /> {sendingInfo ? "Sending…" : "Confirm"}
                                </button>
                              </div>
                            ) : (
                              <button onClick={() => setAwaitingSendConfirm(true)} disabled={!pendingInfoFiles.length} className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-40 transition-colors">
                                <Send size={12} /> Send to Customer
                              </button>
                            )}
                          </>
                        ) : (
                          <div className="space-y-3">
                            <p className="text-xs text-muted-foreground">Once the customer has paid at the Sub-Registrar, confirm receipt here to advance the record.</p>
                            <div>
                              <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Amount paid (optional)</label>
                              <Input type="number" className="h-9 font-mono" placeholder="e.g. 16500" value={confirmAmount} onChange={(e) => setConfirmAmount(e.target.value)} />
                            </div>
                            <input type="file" ref={proofInputRef} className="hidden" onChange={(e) => stageProofFile(e.target.files)} />
                            {proofFile ? (
                              <div className="flex items-center gap-2 text-xs bg-muted/40 border border-border rounded-lg px-2.5 py-1.5">
                                <FileText size={12} className="text-muted-foreground shrink-0" />
                                <span className="truncate flex-1">{proofFile.name}</span>
                                <button onClick={() => { setProofFile(null); if (proofInputRef.current) proofInputRef.current.value = ""; }} className="text-muted-foreground hover:text-rose-500 shrink-0"><X size={11} /></button>
                              </div>
                            ) : (
                              <button onClick={() => proofInputRef.current?.click()} className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs border border-dashed border-border rounded-lg hover:bg-muted text-muted-foreground transition-colors">
                                <Upload size={12} /> Attach proof (optional)
                              </button>
                            )}
                            <button onClick={handleConfirm} disabled={confirming} className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-40 transition-colors">
                              <CheckCircle2 size={12} /> {confirming ? "Confirming…" : "Confirm Payment Received"}
                            </button>
                          </div>
                        )}
                      </div>
                    </>
                  )}

                  {/* Footer */}
                  <div className="px-5 py-3 border-t border-border bg-muted/20 flex items-center justify-between">
                    <button onClick={goPrev} disabled={step === 1 || detail.Status === "Confirmed"} className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg text-muted-foreground hover:bg-muted disabled:opacity-30 disabled:pointer-events-none transition-colors">
                      <ChevronLeft size={13} /> Previous
                    </button>
                    <div className="flex items-center gap-2">
                      <button onClick={() => setSelectedId(null)} className="px-3 py-1.5 text-xs font-medium rounded-lg text-muted-foreground hover:bg-muted transition-colors">Close</button>
                      <button onClick={goNext} disabled={step === 2 || detail.Status === "Confirmed"} className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-30 disabled:pointer-events-none transition-colors">
                        Next <ChevronRight size={13} />
                      </button>
                    </div>
                  </div>
                </>
              )}
            </DialogContent>
          </Dialog>
        </>
      )}

    </CrmShell>
  );
};

function AttachmentList({ attachments, apiBase }: { attachments: any[]; apiBase: string }) {
  const isImage = (mime: string) => mime?.startsWith("image/");
  const fmtSize = (bytes: number) =>
    bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;

  return (
    <ul className="space-y-2">
      {attachments.map((a) => {
        const url = `${apiBase}/attachment/${a.AttachmentId}`;
        return (
          <li key={a.AttachmentId} className="flex items-center gap-2.5 rounded-lg border border-border bg-muted/20 px-3 py-2 hover:bg-muted/40 transition-colors group">
            {/* Thumbnail or icon */}
            {isImage(a.MimeType) ? (
              <div className="w-9 h-9 rounded-md shrink-0 overflow-hidden border border-border bg-muted">
                <img src={url} alt={a.FileName} className="w-full h-full object-cover" />
              </div>
            ) : (
              <div className="w-9 h-9 rounded-md shrink-0 bg-primary/10 border border-primary/20 flex items-center justify-center">
                <FileText size={15} className="text-primary" />
              </div>
            )}

            {/* Name + meta */}
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-foreground truncate">{a.FileName}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {a.FileSize ? fmtSize(a.FileSize) : ""}
                {a.UploadedAt ? ` · ${String(a.UploadedAt).slice(0, 10)}` : ""}
              </p>
            </div>

            {/* Open link */}
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 flex items-center gap-1 text-[11px] font-medium text-primary opacity-0 group-hover:opacity-100 transition-opacity hover:underline"
            >
              Open <ChevronRight size={11} />
            </a>
          </li>
        );
      })}
    </ul>
  );
}

export default CrmAfsQueryPayment;
