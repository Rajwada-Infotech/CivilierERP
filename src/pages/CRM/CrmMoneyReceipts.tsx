import { CrmStatus } from "@/constants/crmStatuses";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { CrmShell, CrmGlassCard } from "@/components/crm/CrmShell";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import {
  Receipt, FileText, Download, CheckCircle2, Clock, AlertTriangle,
  Search, RotateCcw, X, Check, Ban, ChevronRight,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CrmCompanyProjectBlockFilter, type CrmCompanyProjectBlockValue } from "@/components/crm/CrmCompanyProjectBlockFilter";
import { CrmPaginationBar } from "@/components/crm/CrmPaginationBar";

// v5 (booking-wise cards): one card per Booking, not per receipt — a
// booking with 3 receipts used to render as 3 separate cards; now it's one
// card summarizing all of them, clicked open to a detail popup listing each
// receipt with its own actions. Grouping happens client-side over whatever
// page of receipts is currently loaded (BookingId is already on every
// receipt row) — no backend change needed. Approve/Bounce (backend routes
// that existed but had no UI trigger before v4) live inside that popup.

const API = "/api/crm/money-receipts";
const PAGE_SIZE = 20;

// ── Types ───────────────────────────────────────────────────────────────────

interface ReceiptRow {
  Id: number;
  ReceiptNo: string;
  BookingId: number;
  ReceivedPaymentId: number;
  Amount: number;
  BaseAmount: number | null;
  GSTAmount: number | null;
  PaymentMode: string;
  ChequeNo: string | null;
  ChequeDate: string | null;
  TransactionRef: string | null;
  ReceivedDate: string;
  Status: typeof CrmStatus.PENDING | typeof CrmStatus.APPROVED | "Bounced";
  BouncedReason: string | null;
  RPDocNo: string | null;
  BookingNo: string;
  ProjectName: string | null;
  UnitNo: string;
  ApplicantName: string;
  Mobile: string | null;
  CreatedAt: string;
}

interface BookingGroup {
  bookingId: number;
  bookingNo: string;
  applicantName: string;
  mobile: string | null;
  projectName: string | null;
  unitNo: string;
  totalAmount: number;
  receipts: ReceiptRow[];
}

interface ReceiptListFilters {
  search: string;
  companyId: string;
  projectId: string;
  blockId: string;
  status: string;
  fromDate: string;
  toDate: string;
}

const EMPTY_FILTERS: ReceiptListFilters = { search: "", companyId: "", projectId: "", blockId: "", status: "", fromDate: "", toDate: "" };

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "All statuses" },
  { value: CrmStatus.PENDING, label: "Pending Approval" },
  { value: CrmStatus.APPROVED, label: "Approved" },
  { value: "Bounced", label: "Bounced" },
];

// Drives both the clickable stat bar and its underlying count queries.
// Counts are per-receipt (an approver's real workload), the cards below are
// per-booking — the two are deliberately different units.
const STAT_DEFS: { value: string; label: string; icon: React.ElementType; accent: string }[] = [
  { value: "", label: "All Receipts", icon: Receipt, accent: "#6366f1" },
  { value: CrmStatus.PENDING, label: "Pending Approval", icon: Clock, accent: "#f59e0b" },
  { value: CrmStatus.APPROVED, label: "Approved", icon: CheckCircle2, accent: "#10b981" },
  { value: "Bounced", label: "Bounced", icon: AlertTriangle, accent: "#ef4444" },
];

const STATUS_ACCENT: Record<string, string> = {
  [CrmStatus.APPROVED]: "#10b981",
  [CrmStatus.PENDING]: "#f59e0b",
  Bounced: "#ef4444",
};

// ── Formatting helpers ───────────────────────────────────────────────────────

function fmtMoney(v?: number | null) {
  if (v == null) return "—";
  return `₹${Number(v).toLocaleString("en-IN")}`;
}
function fmtDate(v?: string | null) {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v).slice(0, 10) : d.toLocaleDateString("en-IN");
}

// ── Data fetching ───────────────────────────────────────────────────────────

async function fetchReceipts(bookingId?: string): Promise<ReceiptRow[]> {
  const q = new URLSearchParams();
  if (bookingId) q.set("bookingId", bookingId);
  const res = await fetchWithAuth(`${API}?${q}`);
  if (!res.ok) throw new Error("Failed to load money receipts");
  return res.json();
}

async function fetchReceiptsList(filters: ReceiptListFilters, page: number): Promise<{ rows: ReceiptRow[]; total: number }> {
  const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (filters.search) params.set("search", filters.search);
  if (filters.companyId) params.set("companyId", filters.companyId);
  if (filters.projectId) params.set("projectId", filters.projectId);
  if (filters.blockId) params.set("blockId", filters.blockId);
  if (filters.status) params.set("status", filters.status);
  if (filters.fromDate) params.set("fromDate", filters.fromDate);
  if (filters.toDate) params.set("toDate", filters.toDate);
  const res = await fetchWithAuth(`${API}?${params}`);
  if (!res.ok) throw new Error("Failed to load money receipts");
  const data = await res.json();
  return { rows: data.rows || [], total: data.total || 0 };
}

// ── Small presentational pieces ─────────────────────────────────────────────

function StatusPill({ status }: { status: ReceiptRow["Status"] }) {
  if (status === CrmStatus.APPROVED)
    return <span className="inline-flex items-center gap-1 px-1.5 py-px rounded text-[10px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-800 shrink-0"><CheckCircle2 className="w-2.5 h-2.5" /> Approved</span>;
  if (status === "Bounced")
    return <span className="inline-flex items-center gap-1 px-1.5 py-px rounded text-[10px] font-medium bg-red-50 text-red-700 border border-red-200 dark:bg-red-950/30 dark:text-red-400 dark:border-red-800 shrink-0"><AlertTriangle className="w-2.5 h-2.5" /> Bounced</span>;
  return <span className="inline-flex items-center gap-1 px-1.5 py-px rounded text-[10px] font-medium bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800 shrink-0"><Clock className="w-2.5 h-2.5" /> Pending</span>;
}

// A booking's overall badge — worst-first: any Bounced receipt outranks any
// Pending, which outranks all-Approved. Keeps the booking-level card simple
// (one badge) while still surfacing what needs attention.
function bookingSeverity(receipts: ReceiptRow[]): { accent: string; label: string } {
  if (receipts.some((r) => r.Status === "Bounced")) return { accent: STATUS_ACCENT.Bounced, label: "Needs Attention" };
  if (receipts.some((r) => r.Status === CrmStatus.PENDING)) return { accent: STATUS_ACCENT[CrmStatus.PENDING], label: "Pending Approval" };
  return { accent: STATUS_ACCENT[CrmStatus.APPROVED], label: "All Approved" };
}

function ReceiptPdfDialog({ receipt, onClose }: { receipt: ReceiptRow; onClose: () => void }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    fetchWithAuth(`${API}/${receipt.Id}/pdf`)
      .then((r) => (r.ok ? r.blob() : null))
      .then((blob) => {
        if (cancelled || !blob) return;
        objectUrl = URL.createObjectURL(blob);
        setBlobUrl(objectUrl);
      })
      .catch(() => setBlobUrl(null));
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [receipt.Id]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent accent="crm" className="max-w-2xl">
        <DialogHeader>
          <div className="flex items-center justify-between gap-3 pr-6">
            <DialogTitle className="flex items-center gap-2"><FileText size={16} className="text-primary" /> {receipt.ReceiptNo}</DialogTitle>
            {blobUrl && (
              <a href={blobUrl} download={`${receipt.ReceiptNo}.pdf`}
                className="shrink-0 px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 flex items-center gap-1.5">
                <Download size={14} /> Download PDF
              </a>
            )}
          </div>
        </DialogHeader>
        <div className="flex items-center justify-center min-h-[300px] bg-muted/20 rounded-lg overflow-hidden border border-border">
          {!blobUrl ? <span className="text-sm text-muted-foreground">Loading preview…</span>
            : <iframe src={blobUrl} title={receipt.ReceiptNo} className="w-full h-[60vh] border-0" />}
        </div>
        <div className="text-xs text-muted-foreground pt-1">
          {receipt.BookingNo} · {fmtMoney(receipt.Amount)} · <StatusPill status={receipt.Status} />
        </div>
        {receipt.Status === "Bounced" && receipt.BouncedReason && (
          <p className="text-[11px] text-red-600 dark:text-red-400">Bounce reason: {receipt.BouncedReason}</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

function BounceDialog({ receipt, onClose, onConfirm, submitting }: {
  receipt: ReceiptRow; onClose: () => void; onConfirm: (reason: string) => void; submitting: boolean;
}) {
  const [reason, setReason] = useState("");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-700 dark:text-red-400">
            <Ban size={16} /> Mark {receipt.ReceiptNo} as Bounced
          </DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground -mt-2">{fmtMoney(receipt.Amount)} · {receipt.PaymentMode}</p>
        <textarea
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason for bouncing this receipt (required)…"
          className="w-full min-h-[90px] text-xs border border-border rounded-lg p-2.5 bg-background focus:outline-none focus:ring-1 focus:ring-red-400"
        />
        <div className="flex items-center justify-end gap-2 pt-1">
          <button onClick={onClose} className="px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-muted">Cancel</button>
          <button
            onClick={() => reason.trim() && onConfirm(reason.trim())}
            disabled={!reason.trim() || submitting}
            className="px-3 py-1.5 text-xs rounded-lg bg-red-600 text-white font-medium hover:bg-red-700 disabled:opacity-50 flex items-center gap-1.5">
            <Ban size={12} /> {submitting ? "Bouncing…" : "Confirm Bounce"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Booking-wise card (the list view) ───────────────────────────────────────

function BookingCard({ group, onClick }: { group: BookingGroup; onClick: () => void }) {
  const severity = bookingSeverity(group.receipts);
  return (
    <button
      onClick={onClick}
      className="relative w-full text-left rounded-lg border border-border bg-card/70 hover:bg-card hover:shadow-sm transition-all p-3 pl-3.5 overflow-hidden"
    >
      <div className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ background: severity.accent }} />

      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-mono text-xs font-semibold text-primary truncate">{group.bookingNo}</div>
          <div className="text-xs font-medium truncate mt-0.5">{group.applicantName}</div>
          {group.projectName && <div className="text-[10px] text-muted-foreground truncate">{group.projectName} · Unit {group.unitNo}</div>}
        </div>
        <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
      </div>

      <div className="flex items-end justify-between gap-2 mt-2.5">
        <div>
          <div className="text-base font-bold leading-none">{fmtMoney(group.totalAmount)}</div>
          <div className="text-[10px] text-muted-foreground mt-1">{group.receipts.length} receipt{group.receipts.length === 1 ? "" : "s"}</div>
        </div>
        <span
          className="text-[10px] font-medium px-1.5 py-0.5 rounded"
          style={{ background: `${severity.accent}18`, color: severity.accent, border: `1px solid ${severity.accent}40` }}
        >
          {severity.label}
        </span>
      </div>
    </button>
  );
}

function BookingCardSkeleton() {
  return (
    <div className="rounded-lg border border-border bg-card/50 p-3 space-y-2.5">
      <div className="h-3.5 w-24 bg-muted rounded animate-pulse" />
      <div className="h-3 w-32 bg-muted rounded animate-pulse" />
      <div className="h-5 w-20 bg-muted rounded animate-pulse mt-2" />
    </div>
  );
}

// One receipt row inside the booking detail popup — flatter than a card
// since it's already inside one, just enough to act on.
function ReceiptDetailRow({ r, canEdit, busy, onPreview, onResubmit, onApprove, onBounce }: {
  r: ReceiptRow; canEdit: boolean; busy: boolean;
  onPreview: () => void; onResubmit: () => void; onApprove: () => void; onBounce: () => void;
}) {
  const showResubmit = r.Status === "Bounced" && !r.ReceivedPaymentId;
  const showApproverActions = canEdit && r.Status === CrmStatus.PENDING;

  return (
    <div className="py-3 first:pt-0 last:pb-0 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs font-semibold text-primary">{r.ReceiptNo}</span>
        <StatusPill status={r.Status} />
      </div>

      <div className="flex items-end justify-between gap-2">
        <div>
          <div className="text-sm font-bold leading-none">{fmtMoney(r.Amount)}</div>
          {r.BaseAmount != null && r.GSTAmount != null && (
            <div className="text-[10px] text-muted-foreground font-mono mt-0.5">Base {fmtMoney(r.BaseAmount)} + GST {fmtMoney(r.GSTAmount)}</div>
          )}
        </div>
        <div className="text-right text-[10px] text-muted-foreground">
          <div>{r.PaymentMode}{r.ChequeNo ? ` · ${r.ChequeNo}` : r.TransactionRef ? ` · ${r.TransactionRef}` : ""}</div>
          <div>{fmtDate(r.ReceivedDate)}</div>
        </div>
      </div>

      {r.Status === "Bounced" && r.BouncedReason && (
        <p className="text-[10px] text-red-600 dark:text-red-400">Reason: {r.BouncedReason}</p>
      )}
      {r.Status === CrmStatus.APPROVED && r.RPDocNo && (
        <p className="text-[10px] text-muted-foreground">Finance Doc: <span className="font-mono">{r.RPDocNo}</span></p>
      )}

      <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
        <button onClick={onPreview}
          className="flex items-center gap-1 px-1.5 py-1 text-[11px] border border-border rounded hover:bg-muted">
          <FileText className="w-3 h-3" /> PDF
        </button>
        {showResubmit && (
          <button onClick={onResubmit} disabled={busy}
            className="flex items-center gap-1 px-1.5 py-1 text-[11px] border border-amber-300 text-amber-700 rounded hover:bg-amber-50 disabled:opacity-50 dark:border-amber-700 dark:text-amber-400 dark:hover:bg-amber-950/30">
            <RotateCcw className="w-3 h-3" /> Resubmit
          </button>
        )}
        {showApproverActions && (
          <>
            <button onClick={onApprove} disabled={busy}
              className="flex items-center gap-1 px-1.5 py-1 text-[11px] border border-emerald-300 text-emerald-700 rounded hover:bg-emerald-50 disabled:opacity-50 dark:border-emerald-700 dark:text-emerald-400 dark:hover:bg-emerald-950/30">
              <Check className="w-3 h-3" /> {busy ? "…" : "Approve"}
            </button>
            <button onClick={onBounce} disabled={busy}
              className="flex items-center gap-1 px-1.5 py-1 text-[11px] border border-red-300 text-red-700 rounded hover:bg-red-50 disabled:opacity-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-950/30">
              <Ban className="w-3 h-3" /> Bounce
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// The popup: booking header + every receipt for that booking, divided.
function BookingDetailDialog({ group, canEdit, busyId, onClose, onPreview, onResubmit, onApprove, onBounce }: {
  group: BookingGroup; canEdit: boolean; busyId: number | null; onClose: () => void;
  onPreview: (r: ReceiptRow) => void; onResubmit: (r: ReceiptRow) => void;
  onApprove: (r: ReceiptRow) => void; onBounce: (r: ReceiptRow) => void;
}) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Receipt size={16} className="text-primary" /> {group.bookingNo}
          </DialogTitle>
        </DialogHeader>
        <div className="text-xs text-muted-foreground -mt-2 space-y-0.5">
          <div>{group.applicantName}{group.mobile ? ` · ${group.mobile}` : ""}</div>
          {group.projectName && <div>{group.projectName} · Unit {group.unitNo}</div>}
          <div className="font-semibold text-foreground pt-1">Total: {fmtMoney(group.totalAmount)} across {group.receipts.length} receipt{group.receipts.length === 1 ? "" : "s"}</div>
        </div>

        <div className="divide-y divide-border max-h-[55vh] overflow-y-auto -mx-1 px-1">
          {group.receipts.map((r) => (
            <ReceiptDetailRow
              key={r.Id}
              r={r}
              canEdit={canEdit}
              busy={busyId === r.Id}
              onPreview={() => onPreview(r)}
              onResubmit={() => onResubmit(r)}
              onApprove={() => onApprove(r)}
              onBounce={() => onBounce(r)}
            />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

const CrmMoneyReceipts: React.FC = () => {
  const [searchParams] = useSearchParams();
  const bookingIdParam = searchParams.get("bookingId") || undefined;

  const [searchInput, setSearchInput] = useState("");
  const [filters, setFilters] = useState<ReceiptListFilters>(EMPTY_FILTERS);
  const [cpb, setCpb] = useState<CrmCompanyProjectBlockValue>({ companyId: "", projectId: "", blockId: "" });
  const [page, setPage] = useState(1);
  const [selectedBookingId, setSelectedBookingId] = useState<number | null>(null);
  const [previewReceipt, setPreviewReceipt] = useState<ReceiptRow | null>(null);
  const [bounceReceipt, setBounceReceipt] = useState<ReceiptRow | null>(null);
  const [sweeping, setSweeping] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const qc = useQueryClient();
  const { canEdit } = usePageRights("crm-money-receipts");

  const patchFilters = useCallback((patch: Partial<ReceiptListFilters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1);
  }, []);
  const patchCpb = useCallback((v: CrmCompanyProjectBlockValue) => { setCpb(v); setPage(1); }, []);

  const listFilters: ReceiptListFilters = useMemo(
    () => ({ ...filters, companyId: cpb.companyId, projectId: cpb.projectId, blockId: cpb.blockId }),
    [filters, cpb]
  );
  const hasActiveFilters = Boolean(
    listFilters.search || listFilters.companyId || listFilters.projectId || listFilters.blockId
    || listFilters.status || listFilters.fromDate || listFilters.toDate
  );
  const clearFilters = useCallback(() => {
    setSearchInput("");
    setFilters(EMPTY_FILTERS);
    setCpb({ companyId: "", projectId: "", blockId: "" });
    setPage(1);
  }, []);

  const invalidateAll = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["crm-money-receipts"] });
    qc.invalidateQueries({ queryKey: ["crm-money-receipts-stat"] });
  }, [qc]);

  // bookingId-scoped mode (deep-linked from a Booking's detail view) keeps
  // the original unpaginated, unfiltered fetch exactly as before.
  const { data: listResult, isLoading, dataUpdatedAt, isFetching, refetch } = useQuery({
    queryKey: ["crm-money-receipts", bookingIdParam, listFilters, page],
    queryFn: () => (bookingIdParam
      ? fetchReceipts(bookingIdParam).then((rows) => ({ rows, total: 0 }))
      : fetchReceiptsList(listFilters, page)),
    staleTime: 30_000,
  });
  const rows = listResult?.rows ?? [];
  const total = listResult?.total ?? 0;

  // Group the currently loaded receipts into one card per booking — the
  // grouping is purely a display concern, so it's done client-side over
  // whatever page of receipts is already fetched.
  const groupedBookings: BookingGroup[] = useMemo(() => {
    const order: number[] = [];
    const map = new Map<number, BookingGroup>();
    for (const r of rows) {
      let g = map.get(r.BookingId);
      if (!g) {
        g = {
          bookingId: r.BookingId, bookingNo: r.BookingNo, applicantName: r.ApplicantName,
          mobile: r.Mobile, projectName: r.ProjectName, unitNo: r.UnitNo, totalAmount: 0, receipts: [],
        };
        map.set(r.BookingId, g);
        order.push(r.BookingId);
      }
      g.receipts.push(r);
      g.totalAmount += Number(r.Amount) || 0;
    }
    return order.map((id) => map.get(id)!);
  }, [rows]);

  const selectedBooking = selectedBookingId != null ? groupedBookings.find((g) => g.bookingId === selectedBookingId) || null : null;

  // Stat bar: one lightweight count query per status (same filters, no
  // status override) — counts receipts (an approver's real workload), not
  // bookings.
  const statFilters = useMemo(() => ({ ...listFilters, status: "" }), [listFilters]);
  const statQueries = useQueries({
    queries: STAT_DEFS.map((s) => ({
      queryKey: ["crm-money-receipts-stat", s.value, statFilters],
      queryFn: () => fetchReceiptsList({ ...statFilters, status: s.value }, 1),
      staleTime: 30_000,
      enabled: !bookingIdParam,
    })),
  });

  const handleResubmit = useCallback(async (row: ReceiptRow) => {
    setBusyId(row.Id);
    try {
      const res = await fetchWithAuth(`${API}/${row.Id}/resubmit`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Resubmit failed" }));
        toast.error(err.error || "Resubmit failed");
        return;
      }
      toast.success(`${row.ReceiptNo} resubmitted for approval`);
      invalidateAll();
    } catch {
      toast.error("Network error — could not resubmit receipt");
    } finally {
      setBusyId(null);
    }
  }, [invalidateAll]);

  const handleApprove = useCallback(async (row: ReceiptRow) => {
    setBusyId(row.Id);
    try {
      const res = await fetchWithAuth(`${API}/${row.Id}/approve`, { method: "PUT" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(data.error || "Approve failed"); return; }
      toast.success(`${row.ReceiptNo} approved and sent to Finance`);
      invalidateAll();
    } catch {
      toast.error("Network error — could not approve receipt");
    } finally {
      setBusyId(null);
    }
  }, [invalidateAll]);

  const handleBounceConfirm = useCallback(async (reason: string) => {
    if (!bounceReceipt) return;
    setBusyId(bounceReceipt.Id);
    try {
      const res = await fetchWithAuth(`${API}/${bounceReceipt.Id}/bounce`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(data.error || "Bounce failed"); return; }
      toast.success(`${bounceReceipt.ReceiptNo} marked as bounced`);
      setBounceReceipt(null);
      invalidateAll();
    } catch {
      toast.error("Network error — could not bounce receipt");
    } finally {
      setBusyId(null);
    }
  }, [bounceReceipt, invalidateAll]);

  const sweepPendingMrs = useCallback(async () => {
    setSweeping(true);
    try {
      const res = await fetchWithAuth(`${API}/sweep-pending`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || "Sweep failed"); return; }
      if (data.processed === 0 && data.failed === 0) {
        toast.info("No stuck receipts found — all confirmed bookings are up to date.");
      } else {
        toast.success(`Swept ${data.processed} receipt(s) into Finance queue.${data.failed ? ` ${data.failed} failed — check console.` : ""}`);
        refetch();
      }
    } catch { toast.error("Sweep failed"); } finally { setSweeping(false); }
  }, [refetch]);

  return (
    <>
      <Breadcrumbs items={["Dashboard", "CRM", "Money Receipts"]} />
      <CrmShell
        title="CRM — Money Receipts"
        subtitle="Created once Data Review is complete and the Booking has been submitted for approval — one receipt per Booking Amount"
        icon={Receipt}
        action={
          <div className="flex items-center gap-2">
            {canEdit && (
              <button onClick={sweepPendingMrs} disabled={sweeping}
                className="text-xs px-3 py-1.5 rounded-lg border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 disabled:opacity-50 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
                {sweeping ? "Sweeping…" : "Sweep Stuck Receipts"}
              </button>
            )}
            <RefreshButton dataUpdatedAt={dataUpdatedAt} isFetching={isFetching} onRefresh={refetch} />
          </div>
        }
      >
        {/* ── Stat bar (also doubles as quick status filters) ────────────── */}
        {!bookingIdParam && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {STAT_DEFS.map((s, i) => {
              const isActive = listFilters.status === s.value;
              const q = statQueries[i];
              return (
                <div key={s.label} style={isActive ? { boxShadow: `0 0 0 2px ${s.accent}` } : undefined} className="rounded-xl">
                  <CrmGlassCard
                    label={s.label}
                    value={q.isLoading ? "…" : (q.data?.total ?? 0).toLocaleString("en-IN")}
                    icon={s.icon}
                    accentColor={s.accent}
                    onClick={() => patchFilters({ status: isActive ? "" : s.value })}
                  />
                </div>
              );
            })}
          </div>
        )}

        {/* ── Filter toolbar ──────────────────────────────────────────────
            Two rows: entity scope (company/project/block) on top since
            that's usually set once per session, query controls (search,
            status, date range) below since those change per-search. */}
        <div className="space-y-2 pb-1">
          {!bookingIdParam && (
            <div className="flex items-center gap-3 flex-wrap">
              <CrmCompanyProjectBlockFilter value={cpb} onChange={patchCpb} />
            </div>
          )}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-56">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") patchFilters({ search: searchInput }); }}
                placeholder="Search receipt no, booking, applicant... (Enter to search)"
                className="w-full pl-7 pr-3 py-1.5 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary" />
            </div>

            <select value={filters.status} onChange={(e) => patchFilters({ status: e.target.value })}
              className="px-2.5 py-1.5 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary">
              {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>

            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <input type="date" value={filters.fromDate} onChange={(e) => patchFilters({ fromDate: e.target.value })}
                aria-label="Received from date"
                className="px-2 py-1.5 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary" />
              <span>to</span>
              <input type="date" value={filters.toDate} onChange={(e) => patchFilters({ toDate: e.target.value })}
                aria-label="Received to date"
                className="px-2 py-1.5 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary" />
            </div>

            {hasActiveFilters && (
              <button onClick={clearFilters}
                className="flex items-center gap-1 px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground">
                <X className="w-3 h-3" /> Clear filters
              </button>
            )}

            {!bookingIdParam && !isLoading && (
              <span className="ml-auto text-[11px] text-muted-foreground">{total.toLocaleString("en-IN")} receipt{total === 1 ? "" : "s"}</span>
            )}
          </div>
        </div>

        {/* ── Booking cards ───────────────────────────────────────────────── */}
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2.5">
            {Array.from({ length: 6 }).map((_, i) => <BookingCardSkeleton key={i} />)}
          </div>
        ) : groupedBookings.length === 0 ? (
          <div className="rounded-xl border border-border bg-card/50 px-4 py-12 text-center text-sm text-muted-foreground">
            {hasActiveFilters
              ? "No money receipts match these filters — try widening the date range or clearing a filter."
              : "No money receipts yet — one becomes available once a Booking's Data Review checklist is complete and it's been submitted for approval."}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2.5">
            {groupedBookings.map((g) => (
              <BookingCard key={g.bookingId} group={g} onClick={() => setSelectedBookingId(g.bookingId)} />
            ))}
          </div>
        )}

        {!bookingIdParam && <CrmPaginationBar page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />}

        {selectedBooking && (
          <BookingDetailDialog
            group={selectedBooking}
            canEdit={canEdit}
            busyId={busyId}
            onClose={() => setSelectedBookingId(null)}
            onPreview={setPreviewReceipt}
            onResubmit={handleResubmit}
            onApprove={handleApprove}
            onBounce={setBounceReceipt}
          />
        )}
        {previewReceipt && <ReceiptPdfDialog receipt={previewReceipt} onClose={() => setPreviewReceipt(null)} />}
        {bounceReceipt && (
          <BounceDialog
            receipt={bounceReceipt}
            submitting={busyId === bounceReceipt.Id}
            onClose={() => setBounceReceipt(null)}
            onConfirm={handleBounceConfirm}
          />
        )}
      </CrmShell>
    </>
  );
};

export default CrmMoneyReceipts;