import { CrmStatus } from "@/constants/crmStatuses";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { usePageRights } from "@/hooks/usePageRights";
import { useAuth } from "@/contexts/AuthContext";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { FileText, Download, RotateCcw, X, Check, Ban, RefreshCw, ChevronRight } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CrmCompanyProjectBlockFilter, type CrmCompanyProjectBlockValue } from "@/components/crm/CrmCompanyProjectBlockFilter";
import { CrmPaginationBar } from "@/components/crm/CrmPaginationBar";
import { ApplicantNames } from "@/components/crm/ApplicantNames";
import { DateInput } from "@/components/ui/date-input";
import { useSearchAsYouType } from "@/hooks/useSearchAsYouType";
import { SheetShell, SheetMark } from "@/components/sheet/Sheet";
import { fmtRupees } from "@/components/crm/FinancialStatusBar";
import { MR_APPROVER_ROLES } from "@/pages/admin/approvalInbox/config";
import { KEY_INK, KEY_LINE, KEY_RED, LBL, RULE, RULE_SOFT, TEXTAREA } from "./customers/config";

// One row per booking (its receipts on the loaded page, grouped here — BookingId is on every receipt), opened
// to a dialog listing each receipt with its own actions. Approve / Bounce are Finance's: the server allows only
// the approver roles, so the buttons follow the same rule.

const API = "/api/crm/money-receipts";
const PAGE_SIZE = 20;

type ReceiptStatus = typeof CrmStatus.PENDING | typeof CrmStatus.APPROVED | "Bounced";
interface ReceiptRow {
  Id: number; ReceiptNo: string; BookingId: number; ReceivedPaymentId: number | null; Amount: number;
  BaseAmount: number | null; GSTAmount: number | null; PaymentMode: string; ChequeNo: string | null; ChequeDate: string | null;
  TransactionRef: string | null; ReceivedDate: string; Status: ReceiptStatus; BouncedReason: string | null; RPDocNo: string | null;
  BookingNo: string; ProjectName: string | null; UnitNo: string; ApplicantName: string; Mobile: string | null; CreatedAt: string;
}
interface BookingGroup {
  bookingId: number; bookingNo: string; applicantName: string; mobile: string | null; projectName: string | null; unitNo: string;
  totalAmount: number; receipts: ReceiptRow[];
}
interface ReceiptListFilters { search: string; companyId: string; projectId: string; blockId: string; status: string; fromDate: string; toDate: string }
type StatusCounts = Record<ReceiptStatus, { count: number; amount: number }>;

const EMPTY_FILTERS: ReceiptListFilters = { search: "", companyId: "", projectId: "", blockId: "", status: "", fromDate: "", toDate: "" };
const STATUS_TABS: { value: string; label: string }[] = [
  { value: "", label: "All" },
  { value: CrmStatus.PENDING, label: "Pending approval" },
  { value: CrmStatus.APPROVED, label: "Approved" },
  { value: "Bounced", label: "Bounced" },
];

const fmt = (v?: number | null) => (v == null ? "—" : fmtRupees(Number(v)));
function fmtDate(v?: string | null) {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v).slice(0, 10) : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

async function fetchReceipts(bookingId: string): Promise<ReceiptRow[]> {
  const res = await fetchWithAuth(`${API}?bookingId=${encodeURIComponent(bookingId)}`);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || "Failed to load money receipts");
  return Array.isArray(data) ? data : [];
}
async function fetchReceiptsList(filters: ReceiptListFilters, page: number): Promise<{ rows: ReceiptRow[]; total: number; statusCounts?: StatusCounts }> {
  const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  for (const k of Object.keys(filters) as (keyof ReceiptListFilters)[]) if (filters[k]) params.set(k, filters[k]);
  const res = await fetchWithAuth(`${API}?${params}`);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || "Failed to load money receipts");
  return { rows: data.rows || [], total: data.total || 0, statusCounts: data.statusCounts };
}

function ReceiptMark({ status }: { status: ReceiptStatus }) {
  return <SheetMark text={status === CrmStatus.APPROVED ? "Approved" : status === "Bounced" ? "Bounced" : "Pending"}
    tone={status === CrmStatus.APPROVED ? "done" : status === "Bounced" ? "stopped" : "waiting"} />;
}
// A booking's state, worst first: any bounced receipt, then any pending, else all approved.
function BookingMark({ receipts }: { receipts: ReceiptRow[] }) {
  if (receipts.some((r) => r.Status === "Bounced")) return <SheetMark text="Needs attention" tone="stopped" />;
  if (receipts.some((r) => r.Status === CrmStatus.PENDING)) return <SheetMark text="Pending approval" tone="waiting" />;
  return <SheetMark text="All approved" tone="done" />;
}

const DIALOG = "rounded-none p-5 gap-4";

function ReceiptPdfDialog({ receipt, onClose }: { receipt: ReceiptRow; onClose: () => void }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    fetchWithAuth(`${API}/${receipt.Id}/pdf`)
      .then((r) => (r.ok ? r.blob() : Promise.reject()))
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setBlobUrl(objectUrl);
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [receipt.Id]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={`max-w-2xl ${DIALOG}`} style={{ border: RULE }}>
        <DialogHeader>
          <div className="flex items-center justify-between gap-3 pr-6">
            <DialogTitle className="font-heading flex items-center gap-2 tabular-nums"><FileText size={15} /> {receipt.ReceiptNo}</DialogTitle>
            {blobUrl && (
              <a href={blobUrl} download={`${receipt.ReceiptNo}.pdf`} className={`${KEY_INK} h-8 px-3 shrink-0`}><Download size={12} /> Download PDF</a>
            )}
          </div>
          <DialogDescription className="text-xs flex items-center gap-2 flex-wrap">
            <span className="font-heading tabular-nums">{receipt.BookingNo}</span> · <span className="font-heading tabular-nums">{fmt(receipt.Amount)}</span> · <ReceiptMark status={receipt.Status} />
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-center min-h-[300px] overflow-hidden" style={{ border: RULE_SOFT }}>
          {failed ? <span className="text-sm text-destructive">Could not load the receipt PDF.</span>
            : !blobUrl ? <span className="text-sm text-muted-foreground">Loading preview…</span>
            : <iframe src={blobUrl} title={receipt.ReceiptNo} className="w-full h-[60vh] border-0" />}
        </div>
        {receipt.Status === "Bounced" && receipt.BouncedReason && (
          <p className="text-xs text-destructive">Bounce reason: {receipt.BouncedReason}</p>
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
      <DialogContent className={`max-w-md ${DIALOG}`} style={{ border: RULE }}>
        <DialogHeader>
          <DialogTitle className="font-heading flex items-center gap-2"><Ban size={15} /> Bounce {receipt.ReceiptNo}?</DialogTitle>
          <DialogDescription className="text-xs tabular-nums">{fmt(receipt.Amount)} · {receipt.PaymentMode}{receipt.ChequeNo ? ` · cheque ${receipt.ChequeNo}` : ""}</DialogDescription>
        </DialogHeader>
        <div>
          <label className={`block mb-1 ${LBL}`}>Reason *</label>
          <textarea autoFocus value={reason} onChange={(e) => setReason(e.target.value)} rows={3}
            placeholder="Why this receipt bounced…" className={TEXTAREA} />
        </div>
        <DialogFooter className="gap-2">
          <button onClick={onClose} className={`${KEY_LINE} h-9 px-4`}>Cancel</button>
          <button onClick={() => reason.trim() && onConfirm(reason.trim())} disabled={!reason.trim() || submitting} className={`${KEY_RED} h-9 px-4`}>
            <Ban size={13} /> {submitting ? "Bouncing…" : "Bounce receipt"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// One receipt inside the booking dialog.
function ReceiptDetailRow({ r, canEdit, canApprove, busy, onPreview, onResubmit, onApprove, onBounce }: {
  r: ReceiptRow; canEdit: boolean; canApprove: boolean; busy: boolean;
  onPreview: () => void; onResubmit: () => void; onApprove: () => void; onBounce: () => void;
}) {
  const showResubmit = canEdit && r.Status === "Bounced" && r.ReceivedPaymentId == null;
  const showApproverActions = canApprove && r.Status === CrmStatus.PENDING;
  return (
    <div className="px-4 py-3.5 space-y-2" style={{ borderBottom: RULE_SOFT, borderLeft: r.Status === "Bounced" ? "3px solid hsl(var(--destructive))" : undefined }}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-heading text-xs font-semibold tabular-nums">{r.ReceiptNo}</span>
        <ReceiptMark status={r.Status} />
      </div>
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="font-heading text-sm font-bold tabular-nums">{fmt(r.Amount)}</div>
          {r.BaseAmount != null && r.GSTAmount != null && (
            <div className="mt-1 text-[0.6875rem] text-muted-foreground tabular-nums">Base {fmt(r.BaseAmount)} + GST {fmt(r.GSTAmount)}</div>
          )}
        </div>
        <div className="text-right text-[0.6875rem] text-muted-foreground tabular-nums">
          <div>{r.PaymentMode}{r.ChequeNo ? ` · ${r.ChequeNo}` : r.TransactionRef ? ` · ${r.TransactionRef}` : ""}</div>
          <div className="mt-1">{fmtDate(r.ReceivedDate)}</div>
        </div>
      </div>
      {r.Status === "Bounced" && r.BouncedReason && <p className="text-[0.6875rem] text-destructive">Reason: {r.BouncedReason}</p>}
      {r.Status === CrmStatus.APPROVED && r.RPDocNo && (
        <p className="text-[0.6875rem] text-muted-foreground">Finance doc <span className="font-heading tabular-nums text-foreground">{r.RPDocNo}</span></p>
      )}
      <div className="flex items-center gap-2 flex-wrap pt-0.5">
        <button onClick={onPreview} className={`${KEY_LINE} h-8 px-3`}><FileText size={12} /> PDF</button>
        {showResubmit && <button onClick={onResubmit} disabled={busy} className={`${KEY_LINE} h-8 px-3`}><RotateCcw size={12} /> Resubmit</button>}
        {showApproverActions && (
          <>
            <button onClick={onApprove} disabled={busy} className={`${KEY_INK} h-8 px-3`}><Check size={12} /> {busy ? "Approving…" : "Approve"}</button>
            <button onClick={onBounce} disabled={busy} className={`${KEY_LINE} h-8 px-3 !text-destructive !border-destructive`}><Ban size={12} /> Bounce</button>
          </>
        )}
      </div>
    </div>
  );
}

function BookingDetailDialog({ group, canEdit, canApprove, busyId, onClose, onPreview, onResubmit, onApprove, onBounce }: {
  group: BookingGroup; canEdit: boolean; canApprove: boolean; busyId: number | null; onClose: () => void;
  onPreview: (r: ReceiptRow) => void; onResubmit: (r: ReceiptRow) => void; onApprove: (r: ReceiptRow) => void; onBounce: (r: ReceiptRow) => void;
}) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={`max-w-lg ${DIALOG}`} style={{ border: RULE }}>
        <DialogHeader>
          <DialogTitle className="font-heading tabular-nums">{group.bookingNo}</DialogTitle>
          <DialogDescription className="text-xs space-y-1">
            <span className="block text-foreground font-medium"><ApplicantNames name={group.applicantName} bookingId={group.bookingId} />{group.mobile ? <span className="tabular-nums text-muted-foreground font-normal"> · {group.mobile}</span> : null}</span>
            {group.projectName && <span className="block">{group.projectName} · Unit {group.unitNo}</span>}
          </DialogDescription>
        </DialogHeader>
        <div className="flex justify-between items-center px-3 py-2" style={{ border: RULE_SOFT }}>
          <span className={LBL}>{group.receipts.length} receipt{group.receipts.length === 1 ? "" : "s"}</span>
          <span className="font-heading text-sm font-bold tabular-nums">{fmt(group.totalAmount)}</span>
        </div>
        <div className="max-h-[55vh] overflow-y-auto thin-scroll" style={{ border: RULE_SOFT, borderBottom: 0 }}>
          {group.receipts.map((r) => (
            <ReceiptDetailRow key={r.Id} r={r} canEdit={canEdit} canApprove={canApprove} busy={busyId === r.Id}
              onPreview={() => onPreview(r)} onResubmit={() => onResubmit(r)} onApprove={() => onApprove(r)} onBounce={() => onBounce(r)} />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

const CrmMoneyReceipts: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
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
  const { currentUser } = useAuth();
  // Approve / Bounce / Sweep are Finance's — the server refuses everyone outside these roles.
  const canApprove = canEdit && MR_APPROVER_ROLES.includes(String(currentUser?.role || "").toLowerCase());

  const patchFilters = useCallback((patch: Partial<ReceiptListFilters>) => { setFilters((f) => ({ ...f, ...patch })); setPage(1); }, []);
  // Searches as you type (after a short pause); Enter still searches at once.
  useSearchAsYouType(searchInput, (v) => patchFilters({ search: v }));
  const patchCpb = useCallback((v: CrmCompanyProjectBlockValue) => { setCpb(v); setPage(1); }, []);

  const listFilters: ReceiptListFilters = useMemo(
    () => ({ ...filters, companyId: cpb.companyId, projectId: cpb.projectId, blockId: cpb.blockId }),
    [filters, cpb]
  );
  const hasActiveFilters = Boolean(listFilters.search || listFilters.companyId || listFilters.projectId || listFilters.blockId
    || listFilters.status || listFilters.fromDate || listFilters.toDate);
  const clearFilters = useCallback(() => {
    setSearchInput("");
    setFilters(EMPTY_FILTERS);
    setCpb({ companyId: "", projectId: "", blockId: "" });
    setPage(1);
  }, []);

  // A deep link from a booking (?bookingId) shows just that booking's receipts, unpaged.
  const { data: listResult, isLoading, isError, error, isFetching, refetch } = useQuery({
    queryKey: ["crm-money-receipts", bookingIdParam, listFilters, page],
    queryFn: () => (bookingIdParam
      ? fetchReceipts(bookingIdParam).then((rows) => ({ rows, total: rows.length, statusCounts: undefined }))
      : fetchReceiptsList(listFilters, page)),
    placeholderData: (prev) => prev,
    staleTime: 30_000,
  });
  const rows = listResult?.rows ?? [];
  const total = listResult?.total ?? 0;
  const counts = listResult?.statusCounts;

  const groupedBookings: BookingGroup[] = useMemo(() => {
    const map = new Map<number, BookingGroup>();
    for (const r of rows) {
      let g = map.get(r.BookingId);
      if (!g) {
        g = { bookingId: r.BookingId, bookingNo: r.BookingNo, applicantName: r.ApplicantName, mobile: r.Mobile,
          projectName: r.ProjectName, unitNo: r.UnitNo, totalAmount: 0, receipts: [] };
        map.set(r.BookingId, g);
      }
      g.receipts.push(r);
      g.totalAmount += Number(r.Amount) || 0;
    }
    return [...map.values()];
  }, [rows]);
  const selectedBooking = selectedBookingId != null ? groupedBookings.find((g) => g.bookingId === selectedBookingId) || null : null;

  const invalidateAll = useCallback(() => qc.invalidateQueries({ queryKey: ["crm-money-receipts"] }), [qc]);

  const runAction = useCallback(async (row: ReceiptRow, path: string, okMsg: string, body?: object) => {
    setBusyId(row.Id);
    try {
      const res = await fetchWithAuth(`${API}/${row.Id}/${path}`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(data.error || "That didn't go through"); return false; }
      toast.success(okMsg);
      invalidateAll();
      return true;
    } catch {
      toast.error("Network error — please try again");
      return false;
    } finally {
      setBusyId(null);
    }
  }, [invalidateAll]);

  const handleBounceConfirm = useCallback(async (reason: string) => {
    if (!bounceReceipt) return;
    if (await runAction(bounceReceipt, "bounce", `${bounceReceipt.ReceiptNo} marked as bounced`, { reason })) setBounceReceipt(null);
  }, [bounceReceipt, runAction]);

  const sweepPendingMrs = useCallback(async () => {
    setSweeping(true);
    try {
      const res = await fetchWithAuth(`${API}/sweep-pending`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(data.error || "Sweep failed"); return; }
      if (data.processed === 0 && data.failed === 0) toast.info("No stuck receipts — every confirmed booking is up to date.");
      else {
        toast.success(`Swept ${data.processed} receipt(s) into Finance's queue.${data.failed ? ` ${data.failed} failed.` : ""}`);
        invalidateAll();
      }
    } catch { toast.error("Sweep failed"); } finally { setSweeping(false); }
  }, [invalidateAll]);

  const allCount = counts ? counts[CrmStatus.PENDING].count + counts[CrmStatus.APPROVED].count + counts.Bounced.count : 0;
  const allAmount = counts ? counts[CrmStatus.PENDING].amount + counts[CrmStatus.APPROVED].amount + counts.Bounced.amount : 0;
  const figures = [
    { label: "All receipts", value: String(allCount), note: fmt(allAmount), status: "" },
    { label: "Pending approval", value: String(counts?.[CrmStatus.PENDING].count ?? 0), note: fmt(counts?.[CrmStatus.PENDING].amount ?? 0), status: CrmStatus.PENDING },
    { label: "Approved", value: String(counts?.[CrmStatus.APPROVED].count ?? 0), note: fmt(counts?.[CrmStatus.APPROVED].amount ?? 0), status: CrmStatus.APPROVED },
    { label: "Bounced", value: String(counts?.Bounced.count ?? 0), note: fmt(counts?.Bounced.amount ?? 0), status: "Bounced", red: (counts?.Bounced.count ?? 0) > 0 },
  ];
  const tabCount = (v: string) => (v === "" ? allCount : counts?.[v as ReceiptStatus]?.count ?? 0);
  const tabClass = (on: boolean) => `inline-flex items-center gap-2 px-3 h-9 font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] shrink-0 transition-colors ${on ? "bg-foreground text-card" : "text-muted-foreground hover:text-foreground hover:bg-primary/5"}`;
  const th = `!px-4 !py-2.5 text-left ${LBL}`;
  const td = "!px-4 !py-2.5";
  const dateInp = "!h-9 !rounded-none !shadow-none border-foreground/40 bg-card !px-2.5 text-xs tabular-nums";

  return (
    <>
      <Breadcrumbs items={["Dashboard", "CRM", "Money Receipts"]} />
      <SheetShell
        eyebrow="CivilierERP · CRM · Finance"
        title="Money Receipts"
        subtitle="The booking-amount receipt, issued once a booking's data review is done and it goes for approval; Finance approves or bounces it into its received payments."
        action={
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button onClick={() => refetch()} disabled={isFetching} className={`${KEY_LINE} h-9 w-9`} title="Refresh"><RefreshCw size={13} className={isFetching ? "animate-spin" : ""} /></button>
            {canApprove && (
              <button onClick={sweepPendingMrs} disabled={sweeping} className={`${KEY_LINE} h-9 px-4`}
                title="Send pending receipts of confirmed bookings to Finance">
                {sweeping ? "Sweeping…" : "Sweep stuck receipts"}
              </button>
            )}
          </div>
        }
      >
        <div className="space-y-5">
          {!bookingIdParam && (
            <div className="bg-card" style={{ border: RULE }}>
              <div className="statrow four" style={{ padding: "16px 16px 18px" }}>
                {figures.map((x) => (
                  <div key={x.label}>
                    <button onClick={() => patchFilters({ status: x.status })} className="label link">{x.label}</button>
                    <p className="figure" style={{ fontSize: "clamp(18px, 2vw, 26px)", marginTop: 9, color: x.red ? "var(--red)" : undefined }}>{isLoading && !listResult ? "…" : x.value}</p>
                    <p style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }} className="tabular-nums">{x.note}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="bg-card" style={{ border: RULE }}>
            <div className="px-5 py-4 space-y-3" style={{ borderBottom: RULE }}>
              {bookingIdParam ? (
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-sm">Receipts of booking <span className="font-heading font-semibold tabular-nums">{rows[0]?.BookingNo ?? `#${bookingIdParam}`}</span></span>
                  <button onClick={() => setSearchParams({})} className={`${KEY_LINE} h-8 px-3`}><X size={12} /> Show all receipts</button>
                </div>
              ) : (
                <>
                  <div className="inline-flex items-stretch flex-wrap" style={{ border: RULE }}>
                    {STATUS_TABS.map((t) => (
                      <button key={t.value || "all"} onClick={() => patchFilters({ status: t.value })} style={{ borderRight: RULE_SOFT }}
                        className={`${tabClass(filters.status === t.value)} ${t.value === "Bounced" && tabCount("Bounced") > 0 && filters.status !== "Bounced" ? "!text-destructive" : ""}`}>
                        {t.label} <span className="tabular-nums">{tabCount(t.value)}</span>
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-2.5 flex-wrap items-center">
                    <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") patchFilters({ search: searchInput.trim() }); }}
                      placeholder="Search receipt no, booking, applicant, mobile…"
                      className="h-9 flex-1 min-w-48 border border-foreground/40 focus:border-foreground bg-card px-3 text-xs text-foreground outline-none" />
                    <CrmCompanyProjectBlockFilter value={cpb} onChange={patchCpb} />
                    <div className="flex items-center gap-1.5">
                      <div className="w-36"><DateInput value={filters.fromDate} onChange={(e) => patchFilters({ fromDate: e.target.value })} aria-label="Received from" placeholder="Received from" className={dateInp} /></div>
                      <span className="text-xs text-muted-foreground">–</span>
                      <div className="w-36"><DateInput value={filters.toDate} onChange={(e) => patchFilters({ toDate: e.target.value })} aria-label="Received to" placeholder="Received to" className={dateInp} /></div>
                    </div>
                    {hasActiveFilters && <button onClick={clearFilters} className={`${KEY_LINE} h-9 px-3`} title="Clear filters"><X size={12} /> Clear</button>}
                  </div>
                </>
              )}
            </div>

            <div className="overflow-x-auto thin-scroll">
              <table className="w-full text-sm min-w-[820px]">
                <thead>
                  <tr style={{ borderBottom: RULE }}>
                    <th className={th}>Booking</th><th className={th}>Project · unit</th><th className={th}>Latest receipt</th>
                    <th className={`${th} !text-right`}>Amount</th><th className={th}>State</th><th className={th} />
                  </tr>
                </thead>
                <tbody>
                  {isError ? (
                    <tr><td colSpan={6} className={`${td} text-center text-destructive`}>{(error as Error)?.message}</td></tr>
                  ) : isLoading && !listResult ? (
                    <tr><td colSpan={6} className={`${td} text-center text-muted-foreground`}>Loading…</td></tr>
                  ) : groupedBookings.length === 0 ? (
                    <tr><td colSpan={6} className={`${td} text-center text-muted-foreground`}>
                      {hasActiveFilters
                        ? "No money receipt matches — widen the dates or clear a filter."
                        : "No money receipts yet — one is issued once a booking's data review is done and it's sent for approval."}
                    </td></tr>
                  ) : groupedBookings.map((g) => {
                    const bounced = g.receipts.some((r) => r.Status === "Bounced");
                    return (
                      <tr key={g.bookingId} onClick={() => setSelectedBookingId(g.bookingId)} className="align-top cursor-pointer hover:bg-primary/5 transition-colors"
                        style={{ borderBottom: RULE_SOFT, boxShadow: bounced ? "inset 3px 0 0 hsl(var(--destructive))" : undefined }}>
                        <td className={td}>
                          <div className="font-heading text-xs font-semibold tabular-nums">{g.bookingNo}</div>
                          <div className="mt-1 text-xs truncate max-w-[22rem]">
                            <ApplicantNames name={g.applicantName} bookingId={g.bookingId} />
                            {g.mobile && <span className="text-muted-foreground tabular-nums"> · {g.mobile}</span>}
                          </div>
                        </td>
                        <td className={`${td} text-xs`}>{g.projectName || "—"} <span className="text-muted-foreground">· {g.unitNo}</span></td>
                        <td className={td}>
                          {/* The latest receipt; the rest open with the row. */}
                          <div className="font-heading text-xs tabular-nums">{g.receipts[0].ReceiptNo}</div>
                          <div className="mt-1 text-[0.6875rem] text-muted-foreground tabular-nums">
                            {fmtDate(g.receipts[0].ReceivedDate)}{g.receipts.length > 1 ? ` · +${g.receipts.length - 1} more` : ""}
                          </div>
                        </td>
                        <td className={`${td} text-right font-heading font-semibold tabular-nums`}>{fmt(g.totalAmount)}</td>
                        <td className={td}><BookingMark receipts={g.receipts} /></td>
                        <td className={`${td} text-right`}><ChevronRight size={14} className="inline text-muted-foreground" /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {!bookingIdParam && <div style={{ borderTop: RULE_SOFT }}><CrmPaginationBar page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} /></div>}
          </div>
        </div>

        {selectedBooking && (
          <BookingDetailDialog
            group={selectedBooking}
            canEdit={canEdit}
            canApprove={canApprove}
            busyId={busyId}
            onClose={() => setSelectedBookingId(null)}
            onPreview={setPreviewReceipt}
            onResubmit={(r) => void runAction(r, "resubmit", `${r.ReceiptNo} resubmitted for approval`)}
            onApprove={(r) => void runAction(r, "approve", `${r.ReceiptNo} approved and sent to Finance`)}
            onBounce={setBounceReceipt}
          />
        )}
        {previewReceipt && <ReceiptPdfDialog receipt={previewReceipt} onClose={() => setPreviewReceipt(null)} />}
        {bounceReceipt && (
          <BounceDialog receipt={bounceReceipt} submitting={busyId === bounceReceipt.Id} onClose={() => setBounceReceipt(null)} onConfirm={handleBounceConfirm} />
        )}
      </SheetShell>
    </>
  );
};

export default CrmMoneyReceipts;
