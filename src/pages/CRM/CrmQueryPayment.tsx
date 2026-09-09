import { CrmStatus } from "@/constants/crmStatuses";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { CrmShell } from "@/components/crm/CrmShell";
import { usePageRights } from "@/hooks/usePageRights";
import { useAuth } from "@/contexts/AuthContext";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { translateError } from "@/lib/translateError";
import { promptNextStep } from "@/lib/workflowNav";
import { cn } from "@/lib/utils";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { formatINR } from "@/utils/formatCurrency";
import {
  Plus, Send, CheckCircle2, AlertTriangle, ReceiptIndianRupee, Search,
  Check, Upload, X, FileText, Clock, ArrowUpRight, UserCircle2,
  ChevronRight, Pencil, Save, Building2, BadgeIndianRupee, Minus, Lock,
} from "lucide-react";
import { ProxyActionDialog, type ProxyMethod } from "@/components/crm/ProxyActionDialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogClose } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { CrmCompanyProjectBlockFilter, type CrmCompanyProjectBlockValue } from "@/components/crm/CrmCompanyProjectBlockFilter";

const API = "/api/crm/query-payment";

// ── helpers ───────────────────────────────────────────────────────────────────
function daysSince(d?: string | null) {
  if (!d) return null;
  const ms = Date.now() - new Date(d).getTime();
  return isNaN(ms) ? null : Math.max(0, Math.floor(ms / 86_400_000));
}
function fmtDate(v?: string | null) {
  if (!v) return "—";
  return new Date(String(v).replace(/Z$/, "")).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}
function fmtDateTime(v?: string | null) {
  if (!v) return "—";
  return new Date(String(v).replace(/Z$/, "")).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
function fmtSize(b: number) {
  return b >= 1_048_576 ? `${(b / 1_048_576).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`;
}

// ── Status badge ──────────────────────────────────────────────────────────────
const STATUS_CFG = {
  Pending:   { label: "Pending",   cls: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800/50",    dot: "bg-amber-500" },
  InfoSent:  { label: "Info Sent", cls: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800/50",          dot: "bg-blue-500" },
  Confirmed: { label: "Confirmed", cls: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-800/50", dot: "bg-emerald-500" },
} as const;

function StatusBadge({ status }: { status: string }) {
  const c = (STATUS_CFG as any)[status] ?? STATUS_CFG.Pending;
  return (
    <span className={cn("inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-[11px] font-semibold", c.cls)}>
      <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", c.dot)} />
      {c.label}
    </span>
  );
}

// ── Fee breakdown cards ───────────────────────────────────────────────────────
function FeeBreakdown({ d }: { d: any }) {
  const stamp  = Number(d.StampDuty || 0);
  const reg    = Number(d.RegistrationFee || 0);
  const credit = Number(d.StampDutyCredit || 0);
  const net    = Number(d.RequiredAmount || 0);

  if (!stamp && !reg) {
    return (
      <div className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 rounded-xl px-4 py-3">
        <AlertTriangle size={13} className="shrink-0" />
        Stamp Duty and Registration Fee not set on the Sale Deed yet — edit the Deed to add them before proceeding.
      </div>
    );
  }

  return (
    <div className="flex items-stretch gap-2 flex-wrap">
      {/* Stamp duty */}
      <div className="flex-1 min-w-[110px] rounded-xl border border-border bg-card px-3 py-2.5 space-y-0.5">
        <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold">Stamp Duty</p>
        <p className="text-base font-bold font-mono tabular-nums">{formatINR(stamp)}</p>
      </div>
      <div className="flex items-center self-center text-muted-foreground/50"><Plus size={14} /></div>
      {/* Reg fee */}
      <div className="flex-1 min-w-[110px] rounded-xl border border-border bg-card px-3 py-2.5 space-y-0.5">
        <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold">Reg. Fee</p>
        <p className="text-base font-bold font-mono tabular-nums">{formatINR(reg)}</p>
      </div>
      {credit > 0 && (
        <>
          <div className="flex items-center self-center text-muted-foreground/50"><Minus size={14} /></div>
          <div className="flex-1 min-w-[110px] rounded-xl border border-emerald-200 dark:border-emerald-800/50 bg-emerald-50 dark:bg-emerald-900/10 px-3 py-2.5 space-y-0.5">
            <p className="text-[10px] text-emerald-700 dark:text-emerald-400 uppercase tracking-wide font-semibold">AFS Credit</p>
            <p className="text-base font-bold font-mono tabular-nums text-emerald-700 dark:text-emerald-400">{formatINR(credit)}</p>
          </div>
        </>
      )}
      <div className="flex items-center self-center text-muted-foreground/50">=</div>
      {/* Net */}
      <div className="flex-1 min-w-[110px] rounded-xl border-2 border-primary/30 bg-primary/5 px-3 py-2.5 space-y-0.5">
        <p className="text-[10px] text-primary uppercase tracking-wide font-bold">Net Payable</p>
        <p className="text-base font-bold font-mono tabular-nums text-primary">{formatINR(net)}</p>
      </div>
    </div>
  );
}

// ── Timeline ──────────────────────────────────────────────────────────────────
function Timeline({ d }: { d: any }) {
  const stops = [
    { label: "Started",   at: d.CreatedAt,   done: true },
    { label: "Info Sent", at: d.InfoSentAt,  done: !!d.InfoSentAt },
    { label: "Confirmed", at: d.ConfirmedAt, done: !!d.ConfirmedAt },
  ];
  return (
    <div className="flex items-center gap-0">
      {stops.map((s, i) => (
        <React.Fragment key={s.label}>
          <div className="flex flex-col items-center gap-1">
            <div className={cn("w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold border-2 transition-colors",
              s.done ? "bg-emerald-500 border-emerald-500 text-white" : "bg-background border-border text-muted-foreground")}>
              {s.done ? <Check size={12} /> : i + 1}
            </div>
            <span className={cn("text-[10px] font-medium text-center whitespace-nowrap", s.done ? "text-foreground" : "text-muted-foreground")}>{s.label}</span>
            <span className="text-[9px] text-muted-foreground">{s.at ? String(s.at).slice(0, 10) : "—"}</span>
          </div>
          {i < stops.length - 1 && (
            <div className={cn("h-0.5 flex-1 mx-1 -mt-5 min-w-[20px]", stops[i + 1].done ? "bg-emerald-500" : "bg-border")} />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

// ── Attachment ────────────────────────────────────────────────────────────────
function AttachmentRow({ a }: { a: any }) {
  const [loading, setLoading] = useState(false);
  const open = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const res = await fetchWithAuth(`${API}/attachment/${a.AttachmentId}`);
      if (!res.ok) throw new Error("Failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const win = window.open(url, "_blank");
      if (!win) { const anchor = document.createElement("a"); anchor.href = url; anchor.download = a.FileName; anchor.click(); }
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch { toast.error("Could not open attachment"); } finally { setLoading(false); }
  };
  return (
    <button onClick={open} disabled={loading}
      className="w-full flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5 hover:bg-muted/50 hover:border-primary/30 transition-colors group text-left">
      <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
        <FileText size={14} className="text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium truncate">{a.FileName}</p>
        <p className="text-[10px] text-muted-foreground">
          {a.DocType && <span className="capitalize">{a.DocType}</span>}
          {a.FileSize ? ` · ${fmtSize(a.FileSize)}` : ""}
          {a.UploadedAt ? ` · ${fmtDate(a.UploadedAt)}` : ""}
        </p>
      </div>
      <ChevronRight size={13} className="text-muted-foreground/50 group-hover:text-primary transition-colors shrink-0" />
    </button>
  );
}

// ── File staging ──────────────────────────────────────────────────────────────
interface StagedFile { name: string; size: number; type: string; base64: string; dataUri: string; }
function fileToStaged(f: File): Promise<StagedFile> {
  return new Promise((res, rej) => {
    const r = new FileReader(); r.onerror = () => rej(r.error);
    r.onload = () => { const uri = r.result as string; res({ name: f.name, size: f.size, type: f.type, base64: uri.slice(uri.indexOf(",") + 1), dataUri: uri }); };
    r.readAsDataURL(f);
  });
}
const MAX_FILE = 4 * 1024 * 1024;
const MAX_TOTAL = 6 * 1024 * 1024;

function StagedItem({ f, onRemove }: { f: StagedFile; onRemove: () => void }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-2.5 py-1.5 text-xs">
      {f.type.startsWith("image/")
        ? <img src={f.dataUri} alt={f.name} className="w-6 h-6 object-cover rounded shrink-0 border border-border" />
        : <div className="w-6 h-6 rounded bg-muted flex items-center justify-center shrink-0"><FileText size={11} /></div>}
      <span className="truncate flex-1 font-medium">{f.name}</span>
      <span className="text-muted-foreground shrink-0 text-[10px]">{(f.size / 1024).toFixed(0)} KB</span>
      <button onClick={onRemove} className="text-muted-foreground hover:text-rose-500 shrink-0 p-0.5 rounded transition-colors"><X size={10} /></button>
    </div>
  );
}

// ── API ───────────────────────────────────────────────────────────────────────
interface QueryPaymentCpb { companyId: string; projectId: string; blockId: string }
// NOTE on scale: still fetched in full — statusCounts are computed
// client-side from the whole set (see below), same as CrmDemands.
// Company/Project/Block narrows the set server-side instead.
async function fetchAll(cpb?: QueryPaymentCpb): Promise<any[]> {
  const params = new URLSearchParams();
  if (cpb?.companyId) params.set("companyId", cpb.companyId);
  if (cpb?.projectId) params.set("projectId", cpb.projectId);
  if (cpb?.blockId) params.set("blockId", cpb.blockId);
  const qs = params.toString();
  const r = await fetchWithAuth(`${API}${qs ? `?${qs}` : ""}`);
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error || "Failed");
  return r.json();
}
async function fetchEligible(): Promise<any[]> {
  const r = await fetchWithAuth(`${API}/eligible-bookings`);
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error || "Failed");
  return r.json();
}
async function fetchDetail(id: number | null): Promise<any> {
  if (!id) return null;
  const r = await fetchWithAuth(`${API}/${id}`);
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error || "Failed");
  return r.json();
}

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────
const CrmQueryPayment: React.FC = () => {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const deepLinkBookingId = sp.get("bookingId");
  const { canCreate, canEdit } = usePageRights("crm-query-payment");
  const { currentUser, canDoAction } = useAuth();
  const canConfirmPayment =
    ["admin", "super_admin", "marketing_head", "legal_head"].includes(
      String(currentUser?.role || "").toLowerCase()
    ) || canDoAction("approval-inbox" as any, "edit");

  // ── state ──────────────────────────────────────────────────────────────────
  const [selectedId,       setSelectedId]       = useState<number | null>(null);
  const [filterStatus,     setFilterStatus]      = useState<string>("all");
  const [search,           setSearch]            = useState("");
  const [startDialog,      setStartDialog]       = useState(false);
  const [startBookingId,   setStartBookingId]    = useState("");
  const [starting,         setStarting]          = useState(false);

  // step workflow
  const [step,             setStep]              = useState(1);
  const [pendingFiles,     setPendingFiles]       = useState<StagedFile[]>([]);
  const [sendConfirm,      setSendConfirm]        = useState(false);
  const [sending,          setSending]            = useState(false);
  const [confirmAmt,       setConfirmAmt]         = useState("");
  const [confirmRem,       setConfirmRem]         = useState("");
  const [proofFile,        setProofFile]          = useState<StagedFile | null>(null);
  const [confirming,       setConfirming]         = useState(false);
  const [proxyFile,        setProxyFile]          = useState<File | null>(null);
  const [proxyDialog,      setProxyDialog]        = useState(false);
  const [proxySaving,      setProxySaving]        = useState(false);
  const [editingRemarks,   setEditingRemarks]     = useState(false);
  const [remarksText,      setRemarksText]        = useState("");
  const [remarksSaving,    setRemarksSaving]      = useState(false);

  const infoRef  = useRef<HTMLInputElement>(null);
  const proofRef = useRef<HTMLInputElement>(null);
  const proxyRef = useRef<HTMLInputElement>(null);

  const [cpb, setCpb] = useState<CrmCompanyProjectBlockValue>({ companyId: "", projectId: "", blockId: "" });

  // ── queries ────────────────────────────────────────────────────────────────
  const { data: rows = [], isLoading, dataUpdatedAt, isFetching, refetch: refetchList } =
    useQuery({ queryKey: ["crm-query-payment", cpb], queryFn: () => fetchAll(cpb), staleTime: 30_000 });
  const { data: eligible = [] } =
    useQuery({ queryKey: ["crm-query-payment-eligible"], queryFn: fetchEligible, staleTime: 60_000 });
  const { data: detail, refetch: refetchDetail } = useQuery({
    queryKey: ["crm-query-payment-detail", selectedId],
    queryFn: () => fetchDetail(selectedId),
    enabled: !!selectedId,
  });

  // ── derived ────────────────────────────────────────────────────────────────
  const statusCounts = useMemo(() => {
    const c: Record<string, number> = { Pending: 0, InfoSent: 0, Confirmed: 0 };
    (rows as any[]).forEach((r: any) => { c[r.Status] = (c[r.Status] || 0) + 1; });
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    let out = rows as any[];
    if (filterStatus !== "all") out = out.filter((r: any) => r.Status === filterStatus);
    if (search.trim()) {
      const q = search.toLowerCase();
      out = out.filter((r: any) =>
        r.ApplicantName?.toLowerCase().includes(q) || r.BookingNo?.toLowerCase().includes(q) ||
        r.QPNo?.toLowerCase().includes(q) || r.DeedNo?.toLowerCase().includes(q));
    }
    return out;
  }, [rows, filterStatus, search]);

  // ── effects ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!deepLinkBookingId || !(rows as any[]).length) return;
    const ex = (rows as any[]).find((r: any) => String(r.BookingId) === deepLinkBookingId);
    if (ex) setSelectedId(ex.Id);
  }, [deepLinkBookingId, (rows as any[]).length]);

  useEffect(() => {
    if (!detail) return;
    setStep(detail.Status === CrmStatus.PENDING ? 1 : 2);
    setPendingFiles([]);
    setProofFile(null);
    setSendConfirm(false);
    setEditingRemarks(false);
  }, [detail?.Id]);

  // ── file staging ───────────────────────────────────────────────────────────
  const stageFiles = async (files: FileList | null, multi = true) => {
    if (!files?.length) return;
    const arr = Array.from(files);
    const big = arr.find(f => f.size > MAX_FILE);
    if (big) { toast.error(`${big.name} is too large (max 4 MB)`); return; }
    const total = pendingFiles.reduce((s, f) => s + f.size, 0) + arr.reduce((s, f) => s + f.size, 0);
    if (total > MAX_TOTAL) { toast.error("Total files can't exceed 6 MB"); return; }
    try {
      const staged = await Promise.all(arr.map(fileToStaged));
      if (multi) setPendingFiles(p => [...p, ...staged]);
      else setProofFile(staged[0]);
    } catch { toast.error("Failed to read file"); }
  };

  // ── handlers ───────────────────────────────────────────────────────────────
  const doStart = async (bid: number) => {
    setStarting(true);
    try {
      const res = await fetchWithAuth(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ BookingId: bid }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`${data.QPNo} started`);
      setStartDialog(false); setStartBookingId("");
      ["crm-query-payment", "crm-query-payment-eligible", "crm-booking-lifecycle", "crm-legal-milestones", "crm-dashboard"]
        .forEach(k => qc.invalidateQueries({ queryKey: [k] }));
      // auto-select the new record
      const list = await fetchAll();
      const newRow = list.find(r => r.Id === data.id) || list[0];
      if (newRow) setSelectedId(newRow.Id);
    } catch (e: any) { toast.error(translateError(e.message)); } finally { setStarting(false); }
  };

  const handleSendInfo = async () => {
    if (!selectedId || !pendingFiles.length) return;
    setSending(true);
    try {
      const res = await fetchWithAuth(`${API}/${selectedId}/info`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files: pendingFiles.map(f => ({ fileName: f.name, mimeType: f.type, base64: f.base64 })) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Payment details sent to customer");
      setPendingFiles([]); setSendConfirm(false);
      refetchDetail();
      ["crm-query-payment", "crm-booking-lifecycle"].forEach(k => qc.invalidateQueries({ queryKey: [k] }));
    } catch (e: any) { toast.error(translateError(e.message)); } finally { setSending(false); }
  };

  const handleConfirm = async () => {
    if (!selectedId) return;
    setConfirming(true);
    try {
      const res = await fetchWithAuth(`${API}/${selectedId}/confirm`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ConfirmedAmount: confirmAmt || undefined,
          Remarks: confirmRem || undefined,
          proof: proofFile ? { fileName: proofFile.name, mimeType: proofFile.type, base64: proofFile.base64 } : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setConfirmAmt(""); setConfirmRem(""); setProofFile(null);
      refetchDetail();
      ["crm-query-payment", "crm-booking-lifecycle", "crm-legal-milestones", "crm-dashboard"].forEach(k => qc.invalidateQueries({ queryKey: [k] }));
      const row = (rows as any[]).find(r => r.Id === selectedId);
      promptNextStep(navigate, "Sale Deed payment confirmed. Next: schedule the Registry visit.",
        row?.BookingId ? `/crm/registry?bookingId=${row.BookingId}` : "/crm/registry", "Go to Registry");
    } catch (e: any) { toast.error(translateError(e.message)); } finally { setConfirming(false); }
  };

  const handleSaveRemarks = async () => {
    if (!selectedId) return;
    setRemarksSaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${selectedId}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ Remarks: remarksText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Remarks saved");
      setEditingRemarks(false);
      refetchDetail();
      qc.invalidateQueries({ queryKey: ["crm-query-payment"] });
    } catch (e: any) { toast.error(translateError(e.message)); } finally { setRemarksSaving(false); }
  };

  const handleProxyProof = async (method: ProxyMethod, remarks: string) => {
    if (!selectedId || !proxyFile) return;
    setProxySaving(true);
    try {
      const fd = new FormData(); fd.append("file", proxyFile); fd.append("ProxyMethod", method); fd.append("ProxyRemarks", remarks);
      const res = await fetchWithAuth(`${API}/${selectedId}/proxy-proof`, { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Proof uploaded on customer's behalf");
      setProxyDialog(false); setProxyFile(null);
      if (proxyRef.current) proxyRef.current.value = "";
      refetchDetail(); qc.invalidateQueries({ queryKey: ["crm-query-payment"] });
    } catch (e: any) { toast.error(translateError(e.message)); } finally { setProxySaving(false); }
  };

  // ── QP card (list item) ────────────────────────────────────────────────────
  const QPCard = ({ r }: { r: any }) => {
    const active = selectedId === r.Id;
    const age = daysSince(r.Status === "Confirmed" ? null : r.CreatedAt);
    return (
      <button onClick={() => setSelectedId(r.Id)} className={cn(
        "w-full text-left px-4 py-3 rounded-xl border transition-all space-y-1.5",
        active
          ? "border-primary/40 bg-primary/5 shadow-sm"
          : "border-border bg-card hover:bg-muted/50 hover:border-border/80",
      )}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-bold font-mono text-primary">{r.QPNo}</p>
            <p className="text-sm font-semibold text-foreground truncate mt-0.5">{r.ApplicantName}</p>
            <p className="text-[11px] text-muted-foreground truncate">{r.BookingNo} · {r.UnitNo}</p>
          </div>
          <StatusBadge status={r.Status} />
        </div>
        <div className="flex items-center justify-between">
          <p className="text-xs font-mono font-semibold text-foreground">{r.RequiredAmount ? formatINR(r.RequiredAmount) : <span className="text-muted-foreground text-[10px]">Amount not set</span>}</p>
          {age != null && age >= 5 && r.Status !== "Confirmed" && (
            <span className="flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400 font-medium">
              <Clock size={9} /> {age}d open
            </span>
          )}
          {r.Status === "Confirmed" && (
            <span className="flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
              <CheckCircle2 size={9} /> {fmtDate(r.ConfirmedAt)}
            </span>
          )}
        </div>
      </button>
    );
  };

  // ── Detail panel ───────────────────────────────────────────────────────────
  const DetailPanel = () => {
    if (!selectedId) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center p-12">
          <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center">
            <ReceiptIndianRupee size={24} className="text-muted-foreground" />
          </div>
          <p className="text-sm font-medium text-foreground">Select a record</p>
          <p className="text-xs text-muted-foreground max-w-[200px]">Click any Query Payment on the left to view its workflow</p>
        </div>
      );
    }
    if (!detail) {
      return (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-muted-foreground">Loading…</p>
        </div>
      );
    }

    const infoAttachments  = (detail.attachments || []).filter((a: any) => a.DocType === "Info");
    const proofAttachments = (detail.attachments || []).filter((a: any) => a.DocType === "Proof");
    const confirmed = detail.Status === "Confirmed";
    const canEditRemarks = canEdit && detail.Status === CrmStatus.PENDING;

    return (
      <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
        {/* ── Header ── */}
        <div className="px-6 py-5 border-b border-border space-y-4 shrink-0">
          {/* Title row */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                <ReceiptIndianRupee size={18} className="text-primary" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold font-mono">{detail.QPNo}</h2>
                  <StatusBadge status={detail.Status} />
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{detail.ApplicantName} · {detail.BookingNo} · {detail.UnitNo}</p>
              </div>
            </div>
            <button onClick={() => navigate(`/crm/bookings?view=${detail.BookingId}`)}
              className="flex items-center gap-1.5 text-[11px] text-primary font-semibold px-2.5 py-1.5 rounded-lg border border-primary/30 hover:bg-primary/5 transition-colors shrink-0">
              <ArrowUpRight size={12} /> Booking
            </button>
          </div>

          {/* Sale Deed info */}
          {detail.DeedNo && (
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground bg-muted/40 rounded-lg px-3 py-2 border border-border">
              <Building2 size={12} className="shrink-0" />
              <span>Sale Deed <span className="font-mono font-semibold text-foreground">{detail.DeedNo}</span></span>
            </div>
          )}

          {/* Fee breakdown */}
          <FeeBreakdown d={detail} />

          {/* Timeline */}
          <div className="flex justify-center pt-1">
            <Timeline d={detail} />
          </div>

          {/* Remarks */}
          {editingRemarks ? (
            <div className="rounded-xl border border-primary/30 bg-primary/[0.03] p-3 space-y-2">
              <label className="text-[10px] font-semibold text-muted-foreground block">REMARKS</label>
              <Input autoFocus value={remarksText} onChange={e => setRemarksText(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") handleSaveRemarks(); if (e.key === "Escape") setEditingRemarks(false); }}
                className="h-8 text-xs" placeholder="Optional note…" />
              <div className="flex gap-2 justify-end">
                <button onClick={() => setEditingRemarks(false)} disabled={remarksSaving}
                  className="px-3 py-1 text-[11px] rounded-lg border border-border hover:bg-muted">Cancel</button>
                <button onClick={handleSaveRemarks} disabled={remarksSaving}
                  className="flex items-center gap-1 px-3 py-1 text-[11px] font-semibold text-primary-foreground rounded-lg bg-primary hover:bg-primary/90 disabled:opacity-40">
                  <Save size={10} /> {remarksSaving ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          ) : detail.Remarks ? (
            <div className="flex items-start gap-2 text-xs text-muted-foreground italic bg-muted/30 rounded-lg px-3 py-2">
              <span className="flex-1">&ldquo;{detail.Remarks}&rdquo;</span>
              {canEditRemarks && (
                <button onClick={() => { setRemarksText(detail.Remarks || ""); setEditingRemarks(true); }}
                  className="text-muted-foreground hover:text-foreground shrink-0 transition-colors"><Pencil size={11} /></button>
              )}
            </div>
          ) : canEditRemarks ? (
            <button onClick={() => { setRemarksText(""); setEditingRemarks(true); }}
              className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors">
              <Pencil size={10} /> Add remarks
            </button>
          ) : null}
        </div>

        {/* ── Body ── */}
        {confirmed ? (
          /* Confirmed state */
          <div className="px-6 py-5 space-y-5">
            {/* Confirmed banner */}
            <div className="rounded-xl border border-emerald-200 dark:border-emerald-800/50 bg-emerald-50 dark:bg-emerald-900/10 px-5 py-4 flex items-start gap-4">
              <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center shrink-0 mt-0.5">
                <CheckCircle2 size={20} className="text-emerald-600 dark:text-emerald-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-emerald-700 dark:text-emerald-300">Government payment confirmed</p>
                <p className="text-xs text-emerald-600/80 dark:text-emerald-400/70 mt-0.5">
                  {fmtDateTime(detail.ConfirmedAt)}
                  {detail.ConfirmedAmount ? ` · ${formatINR(detail.ConfirmedAmount)} paid` : ""}
                </p>
                {detail.Remarks && <p className="text-xs text-emerald-700/80 dark:text-emerald-300/70 mt-1.5 italic">&ldquo;{detail.Remarks}&rdquo;</p>}
              </div>
            </div>

            {/* Proof attachments */}
            {proofAttachments.length > 0 && (
              <div className="space-y-2">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Payment Proof</p>
                {proofAttachments.map((a: any) => <AttachmentRow key={a.AttachmentId} a={a} />)}
              </div>
            )}

            {/* Info attachments */}
            {infoAttachments.length > 0 && (
              <div className="space-y-2">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Documents Sent to Customer</p>
                {infoAttachments.map((a: any) => <AttachmentRow key={a.AttachmentId} a={a} />)}
              </div>
            )}

            {/* Additional docs upload */}
            {canEdit && (
              <div className="space-y-2">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Add More Documents</p>
                {pendingFiles.map((f, i) => <StagedItem key={i} f={f} onRemove={() => setPendingFiles(p => p.filter((_, j) => j !== i))} />)}
                <input type="file" multiple ref={infoRef} className="hidden" onChange={e => stageFiles(e.target.files)} />
                <div className="flex items-center gap-2">
                  <button onClick={() => infoRef.current?.click()}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium border border-dashed border-border rounded-xl hover:bg-muted transition-colors text-muted-foreground">
                    <Upload size={12} /> Choose files…
                  </button>
                  {pendingFiles.length > 0 && (
                    <button onClick={handleSendInfo} disabled={sending}
                      className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-primary-foreground rounded-xl bg-primary hover:bg-primary/90 disabled:opacity-40 transition-all">
                      <Upload size={11} /> {sending ? "Uploading…" : `Upload (${pendingFiles.length})`}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        ) : (
          /* Workflow steps */
          <div className="px-6 py-5 space-y-1">

            {/* Step 1 */}
            <div className={cn("rounded-2xl border transition-all overflow-hidden",
              step === 1 ? "border-primary/30 bg-primary/[0.02]" : "border-border bg-card opacity-60")}>
              <div className="px-5 py-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className={cn("w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 border-2 transition-colors",
                      step > 1 ? "bg-emerald-500 border-emerald-500 text-white" : step === 1 ? "bg-primary border-primary text-primary-foreground" : "bg-background border-border text-muted-foreground")}>
                      {step > 1 ? <Check size={12} /> : "1"}
                    </div>
                    <div>
                      <p className="text-sm font-bold">Send Fee Details to Customer</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">Share the stamp duty / reg. fee amount so the buyer knows what to bring</p>
                    </div>
                  </div>
                  {step !== 1 && (
                    <button onClick={() => setStep(1)} className="text-xs text-primary font-semibold hover:underline shrink-0">Edit</button>
                  )}
                </div>
              </div>

              {step === 1 && (
                <div className="px-5 pb-5 space-y-4 border-t border-primary/10 pt-4">
                  {/* Already sent */}
                  {infoAttachments.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Already Sent</p>
                      {infoAttachments.map((a: any) => <AttachmentRow key={a.AttachmentId} a={a} />)}
                    </div>
                  )}

                  {/* Stage files */}
                  {pendingFiles.map((f, i) => <StagedItem key={i} f={f} onRemove={() => setPendingFiles(p => p.filter((_, j) => j !== i))} />)}

                  <input type="file" multiple ref={infoRef} className="hidden" onChange={e => stageFiles(e.target.files)} />

                  {!sendConfirm ? (
                    <div className="flex items-center gap-2 flex-wrap">
                      <button onClick={() => infoRef.current?.click()}
                        className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium border border-dashed border-border rounded-xl hover:bg-muted transition-colors text-muted-foreground">
                        <Upload size={11} /> Attach files
                      </button>
                      {pendingFiles.length > 0 && (
                        <button onClick={() => setSendConfirm(true)}
                          className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-primary-foreground rounded-xl bg-primary hover:bg-primary/90 transition-all">
                          <Send size={11} /> Send to Customer ({pendingFiles.length})
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
                      <p className="text-xs text-muted-foreground">Send {pendingFiles.length} file{pendingFiles.length !== 1 ? "s" : ""} to customer?</p>
                      <div className="flex gap-2">
                        <button onClick={() => setSendConfirm(false)} disabled={sending}
                          className="px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-muted">Cancel</button>
                        <button onClick={handleSendInfo} disabled={sending}
                          className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-primary-foreground rounded-lg bg-primary hover:bg-primary/90 disabled:opacity-40">
                          <Send size={11} /> {sending ? "Sending…" : "Confirm Send"}
                        </button>
                      </div>
                    </div>
                  )}

                  {detail.Status === "InfoSent" && (
                    <div className="flex items-center gap-2 text-xs text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/50 rounded-xl px-4 py-3">
                      <CheckCircle2 size={13} className="shrink-0" />
                      <span className="flex-1">Sent — waiting for customer to pay at the Sub-Registrar</span>
                      <button onClick={() => setStep(2)} className="text-xs font-bold hover:underline shrink-0">Step 2 →</button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Step 2 */}
            <div className={cn("rounded-2xl border transition-all overflow-hidden mt-3",
              step === 2 ? "border-emerald-300/60 dark:border-emerald-800/50 bg-emerald-500/[0.02]" : "border-border bg-card opacity-60")}>
              <div className="px-5 py-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className={cn("w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 border-2 transition-colors",
                      step === 2 ? "bg-emerald-500 border-emerald-500 text-white" : "bg-background border-border text-muted-foreground")}>
                      2
                    </div>
                    <div>
                      <p className="text-sm font-bold">Confirm Customer Paid</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">Record that the buyer has paid at the Sub-Registrar's Office</p>
                    </div>
                  </div>
                  {step !== 2 && detail.Status === "InfoSent" && (
                    <button onClick={() => setStep(2)} className="text-xs text-emerald-600 dark:text-emerald-400 font-semibold hover:underline shrink-0">Open →</button>
                  )}
                </div>
              </div>

              {step === 2 && (
                <div className="px-5 pb-5 space-y-4 border-t border-emerald-200/60 dark:border-emerald-800/30 pt-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground block">Amount Paid (₹)</label>
                      <Input type="number" className="h-9 font-mono text-sm" placeholder={detail.RequiredAmount ? String(detail.RequiredAmount) : "Optional"}
                        value={confirmAmt} onChange={e => setConfirmAmt(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground block">Remarks</label>
                      <Input className="h-9 text-sm" placeholder="Optional"
                        value={confirmRem} onChange={e => setConfirmRem(e.target.value)} />
                    </div>
                  </div>

                  {/* Proof upload */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground block">Proof of Payment</label>
                    {proofFile ? (
                      <div className="flex items-center gap-2 text-xs bg-muted/30 border border-border rounded-xl px-3 py-2">
                        {proofFile.type.startsWith("image/")
                          ? <img src={proofFile.dataUri} alt={proofFile.name} className="w-7 h-7 object-cover rounded shrink-0 border border-border" />
                          : <div className="w-7 h-7 rounded-lg bg-muted flex items-center justify-center shrink-0"><FileText size={12} /></div>}
                        <span className="truncate flex-1">{proofFile.name}</span>
                        <button onClick={() => { setProofFile(null); if (proofRef.current) proofRef.current.value = ""; }}
                          className="text-muted-foreground hover:text-rose-600 shrink-0"><X size={11} /></button>
                      </div>
                    ) : (
                      <>
                        <input type="file" ref={proofRef} className="hidden" onChange={e => stageFiles(e.target.files, false)} />
                        <button onClick={() => proofRef.current?.click()}
                          className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-medium border border-dashed border-border rounded-xl hover:bg-muted transition-colors text-muted-foreground">
                          <Upload size={11} /> Attach receipt / challan
                        </button>
                      </>
                    )}
                  </div>

                  {/* Proxy upload */}
                  {detail.Status === "InfoSent" && (
                    <div className="rounded-xl border border-border bg-muted/20 px-4 py-3 space-y-2">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                        <UserCircle2 size={11} /> Customer not on portal?
                      </p>
                      <div className="flex items-center gap-2 flex-wrap">
                        <input type="file" ref={proxyRef} className="hidden" onChange={e => setProxyFile(e.target.files?.[0] || null)} />
                        <button onClick={() => proxyRef.current?.click()}
                          className="text-xs px-3 py-1.5 border border-border rounded-lg font-medium hover:bg-muted flex items-center gap-1.5 transition-colors">
                          <Upload size={11} /> {proxyFile ? proxyFile.name : "Select their proof…"}
                        </button>
                        <button onClick={() => proxyFile && setProxyDialog(true)} disabled={!proxyFile}
                          className="text-xs px-3 py-1.5 bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-800/60 text-amber-800 dark:text-amber-400 rounded-lg font-semibold hover:bg-amber-100 dark:hover:bg-amber-900/30 disabled:opacity-40 flex items-center gap-1.5 transition-colors">
                          <UserCircle2 size={11} /> Upload on Their Behalf
                        </button>
                      </div>
                    </div>
                  )}

                  {canConfirmPayment ? (
                    <button onClick={handleConfirm} disabled={confirming || !canEdit}
                      className="w-full flex items-center justify-center gap-2 px-4 py-3 text-sm font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl disabled:opacity-40 transition-colors shadow-sm">
                      <BadgeIndianRupee size={16} /> {confirming ? "Confirming…" : "Confirm — Government Fees Paid"}
                    </button>
                  ) : (
                    <div className="w-full flex items-center gap-2 px-4 py-3 text-sm rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400">
                      <Lock size={14} className="shrink-0" />
                      <span>Confirmation requires Legal Head or CRM Administrator</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      <Breadcrumbs items={[{ label: "Dashboard" }, { label: "CRM" }, { label: "Legal" }, { label: "Sale Deed Fees" }]} />
      <CrmShell
        title="Sale Deed Registration Fees"
        subtitle="Track stamp duty & registration fee payments before Sale Deed is registered at the Sub-Registrar"
        action={
          <div className="flex items-center gap-2">
            <RefreshButton dataUpdatedAt={dataUpdatedAt} isFetching={isFetching} onRefresh={refetchList} />
            {canCreate && (
              <button onClick={() => setStartDialog(true)}
                className="inline-flex items-center gap-1.5 font-semibold text-primary-foreground text-xs px-3 py-1.5 rounded-lg bg-primary hover:bg-primary/90 transition-all">
                <Plus size={13} /> New Query Payment
              </button>
            )}
          </div>
        }
      >
        {/* ── Master-detail layout ────────────────────────────────────────── */}
        <div className="flex gap-4 h-[calc(100vh-180px)] min-h-[500px]">

          {/* Left: list */}
          <div className="w-80 shrink-0 flex flex-col gap-3 min-h-0">
            {/* Search */}
            <div className="relative shrink-0">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…"
                className="w-full pl-8 pr-3 py-2 text-sm border border-border rounded-xl bg-background focus:outline-none focus:ring-1 focus:ring-primary/40" />
            </div>
            <CrmCompanyProjectBlockFilter value={cpb} onChange={setCpb} />

            {/* Status filter pills */}
            <div className="flex gap-1 flex-wrap shrink-0">
              {(["all", "Pending", "InfoSent", "Confirmed"] as const).map(s => {
                const label = s === "all" ? "All" : s === "InfoSent" ? "Info Sent" : s;
                const count = s === "all" ? (rows as any[]).length : statusCounts[s] || 0;
                return (
                  <button key={s} onClick={() => setFilterStatus(s)}
                    className={cn("flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors",
                      filterStatus === s ? "bg-primary text-primary-foreground border-primary" : "bg-background text-muted-foreground border-border hover:bg-muted")}>
                    {label}
                    <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-mono", filterStatus === s ? "bg-white/20" : "bg-muted")}>{count}</span>
                  </button>
                );
              })}
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto space-y-2 pr-0.5">
              {isLoading ? (
                <div className="text-center text-xs text-muted-foreground py-8">Loading…</div>
              ) : filtered.length === 0 ? (
                <div className="text-center text-xs text-muted-foreground py-8 space-y-1">
                  <ReceiptIndianRupee size={20} className="mx-auto text-muted-foreground/40" />
                  <p>No records{filterStatus !== "all" ? ` with status "${filterStatus}"` : ""}</p>
                </div>
              ) : (
                (filtered as any[]).map((r: any) => <QPCard key={r.Id} r={r} />)
              )}
            </div>
          </div>

          {/* Right: detail */}
          <div className="flex-1 rounded-2xl border border-border bg-card overflow-hidden flex flex-col min-h-0">
            <DetailPanel />
          </div>
        </div>

        {/* ── Start dialog ────────────────────────────────────────────────── */}
        <Dialog open={startDialog} onOpenChange={o => { if (!o) { setStartDialog(false); setStartBookingId(""); } }}>
          <DialogContent className="max-w-md p-0 gap-0 overflow-hidden">
            <DialogHeader className="px-5 py-4 border-b border-border bg-muted/20">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 shrink-0 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                  <ReceiptIndianRupee size={16} className="text-primary" />
                </div>
                <div>
                  <DialogTitle className="text-base font-bold">New Query Payment</DialogTitle>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Select a booking whose Sale Deed is Director Approved</p>
                </div>
              </div>
            </DialogHeader>
            <div className="px-5 py-4">
              <DialogDescription className="sr-only">Start a Query Payment tracker</DialogDescription>
              <label className="text-xs font-bold text-foreground block mb-1.5">Booking <span className="text-red-500">*</span></label>
              <select value={startBookingId} onChange={e => setStartBookingId(e.target.value)}
                className="w-full text-sm border border-border rounded-xl px-3 py-2 bg-background focus:outline-none focus:ring-1 focus:ring-primary/40">
                <option value="">Select booking…</option>
                {(eligible as any[]).map((b: any) => (
                  <option key={b.Id} value={String(b.Id)}>{b.BookingNo} · {b.ApplicantName}{b.DeedNo ? ` (${b.DeedNo})` : ""}</option>
                ))}
              </select>
              {!(eligible as any[]).length && (
                <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1.5 flex items-center gap-1.5">
                  <AlertTriangle size={11} /> No eligible bookings — Sale Deed must be Director Approved first
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2 px-5 py-3 border-t border-border bg-muted/10">
              <DialogClose asChild>
                <button className="px-4 py-2 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted font-medium">Cancel</button>
              </DialogClose>
              <button onClick={() => startBookingId && doStart(parseInt(startBookingId))} disabled={starting || !startBookingId}
                className="px-5 py-2 text-sm text-primary-foreground rounded-lg font-semibold bg-primary hover:bg-primary/90 disabled:opacity-40 flex items-center gap-1.5 transition-all">
                {starting ? "Starting…" : <><CheckCircle2 size={14} /> Start Tracker</>}
              </button>
            </div>
          </DialogContent>
        </Dialog>
      </CrmShell>

      {proxyDialog && (
        <ProxyActionDialog
          title="Upload Proof on Customer's Behalf"
          description="Staff uploading the government payment receipt the customer provided."
          confirmLabel="Submit Proof"
          saving={proxySaving}
          onClose={() => setProxyDialog(false)}
          onConfirm={handleProxyProof}
        />
      )}
    </>
  );
};

export default CrmQueryPayment;
