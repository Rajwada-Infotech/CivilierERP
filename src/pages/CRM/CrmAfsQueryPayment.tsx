import { CrmStatus } from "@/constants/crmStatuses";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { CrmShell } from "@/components/crm/CrmShell";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { translateError } from "@/lib/translateError";
import { promptNextStep } from "@/lib/workflowNav";
import { cn } from "@/lib/utils";
import { useTheme } from "@/contexts/ThemeContext";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { Input } from "@/components/ui/input";
import { formatINR } from "@/utils/formatCurrency";
import {
  Plus, Send, CheckCircle2, AlertTriangle, ReceiptIndianRupee, Search,
  ChevronLeft, ChevronRight, Check, Upload, X, FileText, Clock,
  Pencil, Save, MoreHorizontal, Eye, Copy, ArrowUpRight, ShieldCheck,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogClose,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";

const API = "/api/crm/afs-query-payment";
const BKG_API = "/api/crm/bookings";

// ── Status presentation — same 3 states the backend enforces
// (Pending -> InfoSent -> Confirmed), just a richer pill than before,
// matching the statusColor convention used on CrmBooking.tsx.
const STATUS_CFG: Record<string, { label: string; cls: string; dot: string }> = {
  Pending:   { label: "Pending",    cls: "text-amber-600 bg-amber-50 border-amber-200 dark:bg-amber-900/20 dark:border-amber-800/60 dark:text-amber-400",    dot: "bg-amber-500" },
  InfoSent:  { label: "Info Sent",  cls: "text-blue-600 bg-blue-50 border-blue-200 dark:bg-blue-900/20 dark:border-blue-800/60 dark:text-blue-400",         dot: "bg-blue-500" },
  Confirmed: { label: "Confirmed",  cls: "text-emerald-600 bg-emerald-50 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-800/60 dark:text-emerald-400", dot: "bg-emerald-500" },
};

function StatusBadge({ status }: { status: string }) {
  const c = STATUS_CFG[status] ?? STATUS_CFG.Pending;
  return (
    <span className={cn("inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-xs font-semibold", c.cls)}>
      <span className={cn("w-1.5 h-1.5 rounded-full", c.dot)} />
      {c.label}
    </span>
  );
}

function daysSince(dateStr?: string | null): number | null {
  if (!dateStr) return null;
  const ms = Date.now() - new Date(dateStr).getTime();
  if (Number.isNaN(ms)) return null;
  return Math.max(0, Math.floor(ms / 86_400_000));
}

// ── Timeline strip: Started -> Info Sent -> Confirmed, with the actual
// dates once each stage happened. Purely presentational — reads the same
// CreatedAt/InfoSentAt/ConfirmedAt fields the old StepTabs already had
// access to, no new data required.
function Timeline({ detail }: { detail: any }) {
  const stops = [
    { key: "created", label: "Started", at: detail.CreatedAt, done: true },
    { key: "info", label: "Info Sent", at: detail.InfoSentAt, done: !!detail.InfoSentAt },
    { key: "confirmed", label: "Confirmed", at: detail.ConfirmedAt, done: !!detail.ConfirmedAt },
  ];
  return (
    <div className="flex items-center">
      {stops.map((s, idx) => (
        <React.Fragment key={s.key}>
          <div className="flex flex-col items-center gap-1 min-w-[64px]">
            <span className={cn(
              "w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0",
              s.done ? "bg-emerald-500 text-white" : "bg-muted text-muted-foreground border border-border",
            )}>
              {s.done ? <Check size={11} /> : idx + 1}
            </span>
            <span className={cn("text-[10px] font-medium text-center leading-tight", s.done ? "text-foreground" : "text-muted-foreground")}>{s.label}</span>
            <span className="text-[9px] text-muted-foreground">{s.at ? String(s.at).slice(0, 10) : "—"}</span>
          </div>
          {idx < stops.length - 1 && (
            <div className={cn("h-[2px] flex-1 -mt-4 min-w-[16px]", stops[idx + 1].done ? "bg-emerald-500" : "bg-border")} />
          )}
        </React.Fragment>
      ))}
    </div>
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
              active ? "border-amber-500 text-amber-600 dark:text-amber-400 bg-amber-500/5" : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/40",
            )}
          >
            <span className={cn(
              "w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-semibold shrink-0",
              done ? "bg-emerald-500 text-white" : active ? "bg-amber-500 text-white" : "bg-muted text-muted-foreground",
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
// Used only for the "Start" dialog's dropdown — mirrors the real POST / gate
// exactly (Approved + active booking, Agreement Executed/Registered, no
// tracker yet) instead of the generic bookings list filtered client-side
// against AgreementStatus, which could silently drift from that gate. The
// deep-link banner below still needs the full fetchBookings() list above —
// it has to show context for a booking that ISN'T eligible (already
// tracked, or Agreement not yet Executed), which this deliberately excludes.
async function fetchEligibleBookings(): Promise<any[]> {
  const r = await fetchWithAuth(`${API}/eligible-bookings`);
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error || "Failed to load eligible bookings");
  return r.json();
}
async function fetchDetail(id: number | null): Promise<any> {
  if (!id) return null;
  const r = await fetchWithAuth(`${API}/${id}`);
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error || "Failed to load AFS Query Payment");
  return r.json();
}

// Inline Stamp Duty / Registration Fee / Remarks editor.
// Wired to the existing PUT /:id endpoint — that route already accepts
// StampDuty, RegistrationFee and Remarks and already refuses the edit once
// Status has moved past 'Pending' (paperwork already sent to the customer).
// This component doesn't add a new capability on the backend, it just gives
// the UI a way to reach one that was already implemented but never wired up.
function AmountEditor({
  detail, canEdit, apiBase, onSaved,
}: { detail: any; canEdit: boolean; apiBase: string; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [stamp, setStamp] = useState("");
  const [regFee, setRegFee] = useState("");
  const [remarks, setRemarks] = useState("");
  const [saving, setSaving] = useState(false);

  const canEditNow = canEdit && detail.Status === CrmStatus.PENDING;

  const startEdit = () => {
    setStamp(detail.StampDuty != null ? String(detail.StampDuty) : "");
    setRegFee(detail.RegistrationFee != null ? String(detail.RegistrationFee) : "");
    setRemarks(detail.Remarks || "");
    setEditing(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${apiBase}/${detail.Id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          StampDuty: stamp !== "" ? stamp : undefined,
          RegistrationFee: regFee !== "" ? regFee : undefined,
          Remarks: remarks,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Amounts updated");
      setEditing(false);
      onSaved();
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <div className="mt-3 rounded-lg border border-amber-300/60 bg-amber-500/[0.04] dark:border-amber-800/60 p-3 space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] text-muted-foreground block mb-1">Stamp Duty (₹)</label>
            <Input type="number" className="h-8 font-mono text-xs focus-visible:ring-amber-500/40" placeholder="Optional" value={stamp} onChange={(e) => setStamp(e.target.value)} />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground block mb-1">Registration Fee (₹)</label>
            <Input type="number" className="h-8 font-mono text-xs focus-visible:ring-amber-500/40" placeholder="Optional" value={regFee} onChange={(e) => setRegFee(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground block mb-1">Remarks</label>
          <Input className="h-8 text-xs focus-visible:ring-amber-500/40" placeholder="Optional" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </div>
        <div className="flex items-center gap-2 justify-end pt-1">
          <button onClick={() => setEditing(false)} disabled={saving} className="px-2.5 py-1 text-[11px] rounded-lg border border-border hover:bg-muted transition-colors">Cancel</button>
          <button onClick={save} disabled={saving} className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-white rounded-lg bg-gradient-to-r from-amber-500 via-orange-400 to-amber-600 hover:shadow-md hover:shadow-amber-500/20 disabled:opacity-40 transition-all">
            <Save size={10} /> {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-3">
      {detail.RequiredAmount > 0 ? (
        <div className="flex items-center gap-2 flex-wrap text-[11px] text-muted-foreground">
          <span className="px-2 py-0.5 rounded bg-muted font-mono">Stamp {formatINR(detail.StampDuty)}</span>
          <span className="text-muted-foreground/50">+</span>
          <span className="px-2 py-0.5 rounded bg-muted font-mono">Reg. Fee {formatINR(detail.RegistrationFee)}</span>
          <span className="text-muted-foreground/50">=</span>
          <span className="px-2 py-0.5 rounded bg-amber-500/10 text-amber-700 dark:text-amber-400 font-semibold font-mono">{formatINR(detail.RequiredAmount)}</span>
          {canEditNow && (
            <button onClick={startEdit} className="ml-1 flex items-center gap-1 text-amber-600 dark:text-amber-400 hover:underline font-medium">
              <Pencil size={10} /> Edit
            </button>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-1.5 text-[11px] text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
          <AlertTriangle size={11} /> Amounts not set — fill before sending to customer.
          {canEditNow && (
            <button onClick={startEdit} className="ml-auto text-amber-600 dark:text-amber-400 font-semibold hover:underline shrink-0">Set amounts</button>
          )}
        </div>
      )}
      {detail.Remarks && (
        <p className="mt-2 text-[11px] text-muted-foreground italic">&ldquo;{detail.Remarks}&rdquo;</p>
      )}
    </div>
  );
}

function fmtSize(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

function AttachmentList({ attachments, apiBase }: { attachments: any[]; apiBase: string }) {
  const isImage = (mime: string) => mime?.startsWith("image/");
  return (
    <ul className="space-y-2">
      {attachments.map((a) => {
        const url = `${apiBase}/attachment/${a.AttachmentId}`;
        return (
          <li key={a.AttachmentId} className="flex items-center gap-2.5 rounded-lg border border-border bg-muted/20 px-3 py-2 hover:bg-amber-500/5 hover:border-amber-300/50 transition-colors group">
            {isImage(a.MimeType) ? (
              <div className="w-9 h-9 rounded-md shrink-0 overflow-hidden border border-border bg-muted">
                <img src={url} alt={a.FileName} className="w-full h-full object-cover" />
              </div>
            ) : (
              <div className="w-9 h-9 rounded-md shrink-0 bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
                <FileText size={15} className="text-amber-600 dark:text-amber-400" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-foreground truncate">{a.FileName}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {a.FileSize ? fmtSize(a.FileSize) : ""}
                {a.UploadedAt ? ` · ${String(a.UploadedAt).slice(0, 10)}` : ""}
              </p>
            </div>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 flex items-center gap-1 text-[11px] font-medium text-amber-600 dark:text-amber-400 opacity-0 group-hover:opacity-100 transition-opacity hover:underline"
            >
              Open <ChevronRight size={11} />
            </a>
          </li>
        );
      })}
    </ul>
  );
}

// Small KPI tile for the list-mode summary strip — purely derived from the
// same `rows` already fetched for the table, no extra request.
function StatCard({ label, value, sub, icon: Icon, tint }: { label: string; value: string | number; sub?: string; icon: any; tint: string }) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3 flex items-center gap-3">
      <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center shrink-0", tint)}>
        <Icon size={16} />
      </div>
      <div className="min-w-0">
        <p className="text-lg font-bold font-mono leading-none">{value}</p>
        <p className="text-[11px] text-muted-foreground mt-1 truncate">{label}{sub ? ` · ${sub}` : ""}</p>
      </div>
    </div>
  );
}

const CrmAfsQueryPayment: React.FC = () => {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const deepLinkBookingId = sp.get("bookingId");
  const { canCreate, canEdit } = usePageRights("crm-afs-query-payment");
  const { theme } = useTheme();
  const isDark = theme !== "light";

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
  const [filterStatus, setFilterStatus] = useState<"all" | "Pending" | "InfoSent" | "Confirmed">("all");
  const [search, setSearch] = useState("");
  const infoInputRef = useRef<HTMLInputElement>(null);
  const proofInputRef = useRef<HTMLInputElement>(null);

  const { data: rows = [], isLoading, dataUpdatedAt: listUpdatedAt, isFetching: listFetching, refetch: refetchList } = useQuery({ queryKey: ["crm-afs-query-payment"], queryFn: fetchAll, staleTime: 30_000 });
  const { data: bookings = [] } = useQuery({ queryKey: ["crm-bookings"], queryFn: fetchBookings, staleTime: 5 * 60_000 });
  const { data: eligibleBookings = [] } = useQuery({ queryKey: ["crm-afs-query-payment-eligible"], queryFn: fetchEligibleBookings, staleTime: 60_000 });
  const { data: detail, refetch: refetchDetail } = useQuery({
    queryKey: ["crm-afs-query-payment-detail", selectedId],
    queryFn: () => fetchDetail(selectedId),
    enabled: !!selectedId,
  });

  // /eligible-bookings already applies the real gate (Approved + active
  // booking, Agreement Executed/Registered, no tracker yet) — no client-side
  // filtering needed.
  const startableBookings = eligibleBookings as any[];

  // The booking the user navigated to from Legal Journey (may or may not have a record)
  const deepLinkedBooking = deepLinkBookingId
    ? (bookings as any[]).find((b: any) => String(b.Id) === deepLinkBookingId)
    : null;
  const deepLinkedRow = deepLinkBookingId
    ? (rows as any[]).find((r: any) => String(r.BookingId) === deepLinkBookingId)
    : null;

  // Status breakdown for the list-mode filter bar & KPI strip — computed
  // from the same data already fetched for the table, no extra request.
  const statusCounts = useMemo(() => {
    const c: Record<string, number> = { Pending: 0, InfoSent: 0, Confirmed: 0 };
    (rows as any[]).forEach((r: any) => { c[r.Status] = (c[r.Status] || 0) + 1; });
    return c;
  }, [rows]);
  const confirmedTotal = useMemo(
    () => (rows as any[]).filter((r: any) => r.Status === "Confirmed").reduce((sum: number, r: any) => sum + Number(r.ConfirmedAmount || r.RequiredAmount || 0), 0),
    [rows],
  );
  const filteredRows = useMemo(() => {
    let out = rows as any[];
    if (filterStatus !== "all") out = out.filter((r: any) => r.Status === filterStatus);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      out = out.filter((r: any) =>
        r.ApplicantName?.toLowerCase().includes(q)
        || r.BookingNo?.toLowerCase().includes(q)
        || r.UnitNo?.toLowerCase().includes(q)
        || r.AfsQPNo?.toLowerCase().includes(q)
        || r.AgreementNo?.toLowerCase().includes(q)
        || r.Mobile?.includes(q)
      );
    }
    return out;
  }, [rows, filterStatus, search]);

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
      setConfirmAmount("");
      setConfirmRemarks("");
      setProofFile(null);
      refetchDetail();
      qc.invalidateQueries({ queryKey: ["crm-afs-query-payment"] });
      qc.invalidateQueries({ queryKey: ["crm-booking-lifecycle"] });
      qc.invalidateQueries({ queryKey: ["crm-pre-possession-gateway"] });
      // Find the bookingId for the confirmed record so we can deep-link
      const confirmedRow = (rows as any[]).find((r: any) => r.Id === selectedId);
      promptNextStep(
        navigate,
        "AFS Query Payment confirmed. Next step: start the AFS Registry visit (both parties at Sub-Registrar Office).",
        confirmedRow?.BookingId ? `/crm/afs-registry?bookingId=${confirmedRow.BookingId}` : "/crm/afs-registry",
        "Go to AFS Registry",
      );
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setConfirming(false);
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard?.writeText(text).then(
      () => toast.success(`${label} copied`),
      () => toast.error("Couldn't copy — copy it manually"),
    );
  };

  const columns: ColumnDef<any, unknown>[] = [
    { accessorKey: "AfsQPNo", header: "AQP No", size: 120,
      cell: (i) => (
        <button onClick={() => setSelectedId(i.row.original.Id)} className="font-mono text-xs font-semibold text-amber-600 dark:text-amber-400 hover:underline">
          {i.getValue() as string}
        </button>
      ) },
    { accessorKey: "ApplicantName", header: "Customer", size: 170,
      cell: (i) => (
        <div onClick={() => setSelectedId(i.row.original.Id)} className="cursor-pointer">
          <div className="font-medium">{i.row.original.ApplicantName}</div>
          <div className="text-xs text-muted-foreground">{i.row.original.BookingNo} · {i.row.original.UnitNo}</div>
        </div>
      ) },
    { accessorKey: "AgreementNo", header: "Agreement", size: 110,
      cell: (i) => <span onClick={() => setSelectedId(i.row.original.Id)} className="cursor-pointer text-xs font-mono">{(i.getValue() as string) || "—"}</span> },
    { id: "amount", header: "Amount", size: 120,
      cell: (i) => {
        const r = i.row.original;
        return r.RequiredAmount ? (
          <span onClick={() => setSelectedId(r.Id)} className="cursor-pointer text-xs font-mono font-medium">{formatINR(r.RequiredAmount)}</span>
        ) : (
          <span onClick={() => setSelectedId(r.Id)} className="cursor-pointer text-xs text-muted-foreground">—</span>
        );
      } },
    { accessorKey: "Status", header: "Status", size: 120,
      cell: (i) => <div onClick={() => setSelectedId(i.row.original.Id)} className="cursor-pointer"><StatusBadge status={i.row.original.Status} /></div> },
    { id: "age", header: "Started", size: 110, enableSorting: false,
      cell: (i) => {
        const r = i.row.original;
        const d = daysSince(r.Status === "Confirmed" ? null : (r.Status === "Pending" ? r.CreatedAt : r.InfoSentAt));
        return (
          <div onClick={() => setSelectedId(r.Id)} className="cursor-pointer">
            <div className="text-xs text-muted-foreground">{r.CreatedAt ? String(r.CreatedAt).slice(0, 10) : "—"}</div>
            {d != null && d >= 7 && (
              <div className="flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400 mt-0.5">
                <Clock size={9} /> {d}d waiting
              </div>
            )}
          </div>
        );
      } },
    { id: "actions", header: "", size: 90, enableSorting: false,
      cell: (i) => {
        const r = i.row.original;
        return (
          <div className="flex items-center justify-end gap-1">
            <button onClick={() => setSelectedId(r.Id)} className="text-xs text-amber-600 dark:text-amber-400 hover:underline font-medium">Open</button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="p-1 rounded-md hover:bg-muted text-muted-foreground" title="More actions">
                  <MoreHorizontal size={15} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem onClick={() => setSelectedId(r.Id)} className="gap-2">
                  <Eye size={14} className="text-muted-foreground" /> View / Manage
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => copyToClipboard(r.AfsQPNo, "AQP No.")} className="gap-2">
                  <Copy size={14} className="text-muted-foreground" /> Copy AQP No.
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate(`/crm/bookings?view=${r.BookingId}`)} className="gap-2">
                  <ArrowUpRight size={14} className="text-amber-600 dark:text-amber-400" /> Go to Booking
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      } },
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
          <div className="w-9 h-9 shrink-0 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
            <ReceiptIndianRupee size={16} className="text-amber-600 dark:text-amber-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-sm font-bold">{detail.AfsQPNo}</span>
              <StatusBadge status={detail.Status} />
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">{detail.ApplicantName} · {detail.BookingNo} · {detail.UnitNo}</p>
          </div>
          <div className="w-full sm:w-auto sm:ml-auto"><Timeline detail={detail} /></div>
        </div>

        {/* Amount summary — editable while Pending */}
        <div className="px-5 py-3 border-b border-border bg-muted/10">
          <AmountEditor
            detail={detail}
            canEdit={canEdit}
            apiBase={API}
            onSaved={() => {
              refetchDetail();
              qc.invalidateQueries({ queryKey: ["crm-afs-query-payment"] });
            }}
          />
          {detail.AfsRegistrationNo && (
            <p className="text-[11px] text-emerald-700 dark:text-emerald-400 mt-2 flex items-center gap-1">
              <ShieldCheck size={12} /> AFS Registered: {detail.AfsRegistrationNo} · {detail.AfsRegistrationDate ? String(detail.AfsRegistrationDate).slice(0, 10) : "—"}
            </p>
          )}
        </div>

        {detail.Status === "Confirmed" ? (
          <div className="px-5 py-5 space-y-4">
            <div className="flex items-center gap-3 bg-emerald-500/[0.06] border border-emerald-200 dark:border-emerald-900/50 rounded-xl px-4 py-3">
              <CheckCircle2 size={18} className="text-emerald-600 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">Government payment confirmed</p>
                <p className="text-xs text-emerald-600/80 dark:text-emerald-400/80 mt-0.5">
                  {detail.ConfirmedAt ? String(detail.ConfirmedAt).slice(0, 10) : ""}
                  {detail.ConfirmedAmount ? ` · ${formatINR(detail.ConfirmedAmount)} received` : ""}
                </p>
                {detail.Remarks && (
                  <p className="text-xs text-emerald-700/90 dark:text-emerald-300/80 mt-1 italic">&ldquo;{detail.Remarks}&rdquo;</p>
                )}
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
                <span className={`w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center shrink-0 ${step > 1 ? "bg-emerald-500 text-white" : "bg-amber-500 text-white"}`}>
                  {step > 1 ? <Check size={10} /> : "1"}
                </span>
                <p className="text-sm font-semibold">Send Fee Breakdown to Customer</p>
              </div>
              <p className="text-xs text-muted-foreground pl-7">Attach any paperwork and send the stamp duty amount so the buyer knows what to bring to the Sub-Registrar's Office.</p>
              {detail.attachments?.filter((a: any) => a.DocType === "Info").length > 0 && (
                <div className="pl-7">
                  <p className="text-[11px] text-muted-foreground font-medium mb-1.5">Already sent</p>
                  <AttachmentList attachments={detail.attachments.filter((a: any) => a.DocType === "Info")} apiBase={API} />
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
                <div className="flex items-center gap-2 flex-wrap">
                  <button onClick={() => infoInputRef.current?.click()}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-dashed border-border rounded-lg hover:bg-muted transition-colors text-muted-foreground">
                    <Upload size={11} /> Attach files
                  </button>
                  {awaitingSendConfirm ? (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">Send {pendingInfoFiles.length} file{pendingInfoFiles.length !== 1 ? "s" : ""}?</span>
                      <button onClick={() => setAwaitingSendConfirm(false)} disabled={sendingInfo} className="px-2.5 py-1 text-xs rounded-lg border border-border hover:bg-muted transition-colors">Cancel</button>
                      <button onClick={handleSendInfo} disabled={sendingInfo} className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-white rounded-lg bg-gradient-to-r from-amber-500 via-orange-400 to-amber-600 hover:shadow-md hover:shadow-amber-500/20 disabled:opacity-40 transition-all">
                        <Send size={10} /> {sendingInfo ? "Sending…" : "Confirm Send"}
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => setAwaitingSendConfirm(true)} disabled={!pendingInfoFiles.length}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white rounded-lg bg-gradient-to-r from-amber-500 via-orange-400 to-amber-600 hover:shadow-md hover:shadow-amber-500/20 disabled:opacity-40 transition-all">
                      <Send size={11} /> {detail.Status === CrmStatus.PENDING ? "Send to Customer" : "Send More"}
                    </button>
                  )}
                </div>
                {detail.Status === "InfoSent" && (
                  <div className="flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400">
                    <CheckCircle2 size={11} /> Sent — waiting for customer to pay at the Sub-Registrar.
                    <button onClick={() => setStep(2)} className="ml-auto text-xs text-amber-600 dark:text-amber-400 font-medium hover:underline">Go to Step 2 →</button>
                  </div>
                )}
              </div>
            </div>

            {/* Step 2: Confirm payment */}
            <div className={`px-5 py-4 space-y-3 ${step === 2 ? "" : "opacity-60"}`}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className={`w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center shrink-0 ${step === 2 ? "bg-amber-500 text-white" : "bg-muted text-muted-foreground"}`}>2</span>
                  <p className="text-sm font-semibold">Confirm Customer Paid the Government</p>
                </div>
                {step !== 2 && (
                  <button onClick={() => setStep(2)} className="text-xs text-amber-600 dark:text-amber-400 font-medium hover:underline shrink-0">Open →</button>
                )}
              </div>
              {step === 2 && (
                <div className="pl-7 space-y-3">
                  <p className="text-xs text-muted-foreground">Once the customer has paid stamp duty and registration fees at the Sub-Registrar's Office, record the confirmation here.</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[11px] text-muted-foreground block mb-1">Amount Actually Paid (₹)</label>
                      <Input type="number" className="h-9 font-mono text-sm focus-visible:ring-amber-500/40" placeholder="Optional" value={confirmAmount} onChange={(e) => setConfirmAmount(e.target.value)} />
                    </div>
                    <div>
                      <label className="text-[11px] text-muted-foreground block mb-1">Remarks</label>
                      <Input className="h-9 text-sm focus-visible:ring-amber-500/40" placeholder="Optional" value={confirmRemarks} onChange={(e) => setConfirmRemarks(e.target.value)} />
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
                    className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 text-sm font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-40 transition-colors">
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

  const glassStyle: React.CSSProperties = {
    background: isDark ? "rgba(15,12,3,0.5)" : "rgba(255,255,255,0.72)",
    border: isDark ? "1px solid rgba(245,158,11,0.15)" : "1px solid rgba(245,158,11,0.18)",
    backdropFilter: "blur(16px) saturate(150%)",
    WebkitBackdropFilter: "blur(16px) saturate(150%)",
    boxShadow: isDark
      ? "0 4px 24px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.05)"
      : "0 4px 24px rgba(245,158,11,0.06), inset 0 1px 0 rgba(255,255,255,0.9)",
  };
  const borderColor = isDark ? "rgba(245,158,11,0.15)" : "rgba(245,158,11,0.12)";

  return (
    <>
      <Breadcrumbs items={[{ label: "Dashboard" }, { label: "CRM" }, { label: "Legal" }, { label: "Agreement Registration Fees" }]} />
      <CrmShell
        title="Agreement Registration Fees"
        subtitle="Stamp duty & registration fee the buyer must pay before the Agreement for Sale is registered at the Sub-Registrar's Office (Visit 1)"
        action={
          <div className="flex items-center gap-3">
            {!deepLinkBookingId && (
              <RefreshButton dataUpdatedAt={listUpdatedAt} isFetching={listFetching} onRefresh={refetchList} />
            )}
            {canCreate && !deepLinkBookingId && (
              <button onClick={() => setDialogOpen(true)}
                className="inline-flex items-center gap-1.5 shrink-0 font-heading font-semibold text-white shadow-sm text-xs px-3 sm:px-4 py-1.5 h-auto rounded-lg bg-gradient-to-r from-amber-500 via-orange-400 to-amber-600 hover:shadow-lg hover:shadow-amber-500/20 transition-all">
                <Plus size={14} /> Start Registration Fees
              </button>
            )}
          </div>
        }
      >
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
                    deepLinkedBooking.AgreementStatus === "Registered" ? "bg-emerald-100 border-emerald-300 text-emerald-700 dark:bg-emerald-900/30 dark:border-emerald-700 dark:text-emerald-300"
                    : deepLinkedBooking.AgreementStatus === "Executed" ? "bg-blue-100 border-blue-300 text-blue-700 dark:bg-blue-900/30 dark:border-blue-700 dark:text-blue-300"
                    : "bg-muted/40 border-border text-muted-foreground"
                  }`}>Agreement {deepLinkedBooking.AgreementStatus}</span>
                </div>
              </div>
            )}

            {/* Case A: already registered — no tracker needed */}
            {deepLinkedBooking?.AgreementStatus === "Registered" && !deepLinkedRow && (
              <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/50 bg-emerald-500/[0.05] overflow-hidden">
                <div className="px-5 py-5 flex items-start gap-4">
                  <div className="w-10 h-10 shrink-0 rounded-full bg-emerald-100 dark:bg-emerald-900/40 border-2 border-emerald-400 dark:border-emerald-600 flex items-center justify-center">
                    <CheckCircle2 size={18} className="text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">Agreement for Sale is Registered</p>
                    <p className="text-xs text-emerald-600/80 dark:text-emerald-400/70 mt-1 max-w-lg">
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
              <div className="rounded-xl border border-amber-300/60 dark:border-amber-800/60 bg-amber-500/[0.03] overflow-hidden">
                <div className="px-5 py-4 border-b border-amber-300/40 dark:border-amber-800/40 bg-amber-500/[0.04]">
                  <p className="text-sm font-semibold">Start Registration Fee Process</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Enter the stamp duty and registration fee amounts. The buyer will be notified and can confirm payment through their portal.</p>
                </div>
                <div className="px-5 py-4 space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-semibold text-foreground block mb-1.5">Stamp Duty (₹) <span className="font-normal text-muted-foreground">(optional)</span></label>
                      <Input type="number" className="h-9 font-mono text-sm focus-visible:ring-amber-500/40" placeholder="e.g. 50000"
                        value={newForm.StampDuty} onChange={(e) => setNewForm((f) => ({ ...f, StampDuty: e.target.value }))} />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-foreground block mb-1.5">Registration Fee (₹) <span className="font-normal text-muted-foreground">(optional)</span></label>
                      <Input type="number" className="h-9 font-mono text-sm focus-visible:ring-amber-500/40" placeholder="e.g. 30000"
                        value={newForm.RegistrationFee} onChange={(e) => setNewForm((f) => ({ ...f, RegistrationFee: e.target.value }))} />
                    </div>
                  </div>
                  <p className="text-[11px] text-muted-foreground">Amounts can be left blank now and filled in later before sending to the customer.</p>
                  <button onClick={handleStart} disabled={saving}
                    className="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white rounded-lg bg-gradient-to-r from-amber-500 via-orange-400 to-amber-600 hover:shadow-lg hover:shadow-amber-500/20 disabled:opacity-40 transition-all">
                    <CheckCircle2 size={14} /> {saving ? "Starting…" : "Start — Create Registration Fee Tracker"}
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          /* ── LIST MODE (admin overview, no bookingId param) ── */
          <>
            {/* KPI summary strip */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <StatCard label="Total Trackers" value={(rows as any[]).length} icon={ReceiptIndianRupee} tint="bg-muted text-foreground" />
              <StatCard label="Pending" value={statusCounts.Pending || 0} icon={Clock} tint="bg-amber-500/10 text-amber-600 dark:text-amber-400" />
              <StatCard label="Info Sent" value={statusCounts.InfoSent || 0} icon={Send} tint="bg-blue-500/10 text-blue-600 dark:text-blue-400" />
              <StatCard label="Confirmed" value={statusCounts.Confirmed || 0} sub={confirmedTotal > 0 ? formatINR(confirmedTotal) : undefined} icon={CheckCircle2} tint="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" />
            </div>

            {/* Search + status filter + table live in one continuous glass card,
                same convention as CrmBooking.tsx, instead of a loose toolbar
                row floating above a separately-bordered table. */}
            <div className="rounded-xl overflow-hidden" style={glassStyle}>
              <div className="flex gap-3 flex-wrap items-center px-3.5 py-3 border-b" style={{ borderColor }}>
                <div className="relative flex-1 min-w-48">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input value={search} onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search name, AQP no, booking, unit..."
                    className="w-full pl-8 pr-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-amber-500/40" />
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {(["all", "Pending", "InfoSent", "Confirmed"] as const).map((s) => {
                    const label = s === "all" ? "All" : s === "InfoSent" ? "Info Sent" : s;
                    const count = s === "all" ? (rows as any[]).length : statusCounts[s] || 0;
                    const active = filterStatus === s;
                    return (
                      <button
                        key={s}
                        onClick={() => setFilterStatus(s)}
                        className={cn(
                          "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors",
                          active ? "text-white border-transparent bg-gradient-to-r from-amber-500 via-orange-400 to-amber-600" : "bg-background border-border text-muted-foreground hover:bg-muted",
                        )}
                      >
                        {label}
                        <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-mono", active ? "bg-white/20" : "bg-muted")}>
                          {count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <DataTable
                data={filteredRows}
                columns={columns}
                searchable={false}
                loading={isLoading}
                emptyMessage={
                  filterStatus === "all" && !search
                    ? "No registration fee trackers started yet. Click 'Start Registration Fees' to begin for a booking whose Agreement for Sale has been executed."
                    : `No records match${filterStatus !== "all" ? ` status "${filterStatus}"` : ""}${search ? ` and search "${search}"` : ""}.`
                }
                className="border-0"
              />
            </div>

            {/* Start dialog (list-mode only) */}
            <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) { setDialogOpen(false); setDialogFeesLocked(false); setNewForm({ BookingId: "", StampDuty: "", RegistrationFee: "" }); } }}>
              <DialogContent className="max-w-md p-0 gap-0 overflow-hidden">
                <DialogHeader className="px-5 py-4 border-b border-border bg-muted/20">
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 shrink-0 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
                      <ReceiptIndianRupee size={16} className="text-amber-600 dark:text-amber-400" />
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
                      className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-background focus:outline-none focus:ring-1 focus:ring-amber-500/40">
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
                  <div className={`rounded-lg border p-3 space-y-2 ${dialogFeesLocked ? "border-emerald-200 bg-emerald-500/[0.04] dark:border-emerald-900/50" : "border-border"}`}>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs font-semibold text-foreground">Government Fees</p>
                        {dialogFeesLocked && (
                          <p className="text-[11px] text-emerald-700 dark:text-emerald-400 mt-0.5">Pre-filled from Agreement record — verify and edit if needed</p>
                        )}
                      </div>
                      {dialogFeesLocked ? (
                        <button type="button" onClick={() => setDialogFeesLocked(false)}
                          className="shrink-0 text-[11px] px-2 py-1 rounded-lg border border-border text-muted-foreground hover:bg-muted font-medium">Edit</button>
                      ) : (newForm.StampDuty !== "" || newForm.RegistrationFee !== "") ? (
                        <button type="button" onClick={() => setDialogFeesLocked(true)}
                          className="shrink-0 text-[11px] px-2 py-1 rounded-lg border border-emerald-300 text-emerald-700 hover:bg-emerald-50 font-medium dark:border-emerald-700 dark:text-emerald-400">Lock</button>
                      ) : null}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[11px] text-muted-foreground block mb-1">Stamp Duty (₹)</label>
                        <Input type="number" className={`h-9 font-mono text-sm focus-visible:ring-amber-500/40 ${dialogFeesLocked ? "bg-muted/30" : ""}`} placeholder="Optional"
                          value={newForm.StampDuty} readOnly={dialogFeesLocked}
                          onChange={(e) => setNewForm((f) => ({ ...f, StampDuty: e.target.value }))} />
                      </div>
                      <div>
                        <label className="text-[11px] text-muted-foreground block mb-1">Registration Fee (₹)</label>
                        <Input type="number" className={`h-9 font-mono text-sm focus-visible:ring-amber-500/40 ${dialogFeesLocked ? "bg-muted/30" : ""}`} placeholder="Optional"
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
                    className="px-5 py-2 text-sm text-white rounded-lg font-semibold bg-gradient-to-r from-amber-500 via-orange-400 to-amber-600 hover:shadow-lg hover:shadow-amber-500/20 disabled:opacity-40 flex items-center gap-1.5 transition-all">
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
                        <div className="w-9 h-9 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0 mt-0.5">
                          <ReceiptIndianRupee size={16} className="text-amber-600 dark:text-amber-400" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-semibold font-mono text-foreground">{detail.AfsQPNo}</span>
                            <StatusBadge status={detail.Status} />
                            <button onClick={() => copyToClipboard(detail.AfsQPNo, "AQP No.")} className="text-muted-foreground hover:text-foreground" title="Copy AQP No.">
                              <Copy size={11} />
                            </button>
                          </div>
                          <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{detail.ApplicantName} · {detail.BookingNo}</p>
                        </div>
                        <DialogClose asChild>
                          <button className="shrink-0 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                            <X size={14} />
                          </button>
                        </DialogClose>
                      </div>

                      <div className="mt-3"><Timeline detail={detail} /></div>

                      {/* Fee summary — editable while Pending */}
                      <AmountEditor
                        detail={detail}
                        canEdit={canEdit}
                        apiBase={API}
                        onSaved={() => {
                          refetchDetail();
                          qc.invalidateQueries({ queryKey: ["crm-afs-query-payment"] });
                        }}
                      />
                    </div>

                    {/* Body */}
                    {detail.Status === "Confirmed" ? (
                      <div className="px-5 py-5 space-y-4">
                        <div className="flex items-center gap-3 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 dark:bg-emerald-900/20 dark:border-emerald-800/60 dark:text-emerald-400">
                          <CheckCircle2 size={18} className="shrink-0" />
                          <div>
                            <div className="font-semibold text-[13px]">Government payment confirmed</div>
                            <div className="text-[11px] opacity-80 mt-0.5">
                              {detail.ConfirmedAt ? String(detail.ConfirmedAt).slice(0, 10) : ""}
                              {detail.ConfirmedAmount ? ` · ${formatINR(detail.ConfirmedAmount)}` : ""}
                            </div>
                            {detail.Remarks && (
                              <p className="text-[11px] opacity-80 mt-1 italic">&ldquo;{detail.Remarks}&rdquo;</p>
                            )}
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
                              {detail.attachments?.filter((a: any) => a.DocType === "Info").length > 0 && (
                                <div>
                                  <p className="text-[11px] font-medium text-muted-foreground mb-2">Previously sent</p>
                                  <AttachmentList attachments={detail.attachments.filter((a: any) => a.DocType === "Info")} apiBase={API} />
                                </div>
                              )}
                              {pendingInfoFiles.length > 0 && (
                                <div>
                                  <p className="text-[11px] font-medium text-muted-foreground mb-2">Ready to send ({pendingInfoFiles.length})</p>
                                  <ul className="space-y-1.5">
                                    {pendingInfoFiles.map((f, idx) => (
                                      <li key={`${f.name}-${idx}`} className="flex items-center gap-2 text-xs bg-amber-500/5 border border-amber-500/20 rounded-lg px-2.5 py-1.5">
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
                                  <button onClick={handleSendInfo} disabled={sendingInfo} className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-white rounded-lg bg-gradient-to-r from-amber-500 via-orange-400 to-amber-600 hover:shadow-md hover:shadow-amber-500/20 disabled:opacity-40 transition-all shrink-0">
                                    <Send size={11} /> {sendingInfo ? "Sending…" : "Confirm"}
                                  </button>
                                </div>
                              ) : (
                                <button onClick={() => setAwaitingSendConfirm(true)} disabled={!pendingInfoFiles.length} className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-white rounded-lg bg-gradient-to-r from-amber-500 via-orange-400 to-amber-600 hover:shadow-md hover:shadow-amber-500/20 disabled:opacity-40 transition-all">
                                  <Send size={12} /> Send to Customer
                                </button>
                              )}
                            </>
                          ) : (
                            <div className="space-y-3">
                              <p className="text-xs text-muted-foreground">Once the customer has paid at the Sub-Registrar, confirm receipt here to advance the record.</p>
                              <div>
                                <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Amount paid (optional)</label>
                                <Input type="number" className="h-9 font-mono focus-visible:ring-amber-500/40" placeholder="e.g. 16500" value={confirmAmount} onChange={(e) => setConfirmAmount(e.target.value)} />
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
                              <button onClick={handleConfirm} disabled={confirming} className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-40 transition-colors">
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
                        <button onClick={goNext} disabled={step === 2 || detail.Status === "Confirmed"} className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg text-white bg-gradient-to-r from-amber-500 via-orange-400 to-amber-600 hover:shadow-md hover:shadow-amber-500/20 disabled:opacity-30 disabled:pointer-events-none transition-all">
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
    </>
  );
};

export default CrmAfsQueryPayment;