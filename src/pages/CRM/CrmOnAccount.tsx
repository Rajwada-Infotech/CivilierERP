import React, { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RefreshCw, ChevronDown, ChevronRight, ArrowRightLeft, ExternalLink, X } from "lucide-react";
import { CrmCompanyProjectBlockFilter, type CrmCompanyProjectBlockValue } from "@/components/crm/CrmCompanyProjectBlockFilter";
import { CrmPaginationBar } from "@/components/crm/CrmPaginationBar";
import { DateInput } from "@/components/ui/date-input";
import { ApplicantNames } from "@/components/crm/ApplicantNames";
import { useSearchAsYouType } from "@/hooks/useSearchAsYouType";
import { SheetShell, SheetMark } from "@/components/sheet/Sheet";
import { fmtRupees } from "@/components/crm/FinancialStatusBar";
import { INP, KEY_INK, KEY_LINE, LBL, RULE, RULE_SOFT } from "./customers/config";

const API = "/api/crm/payments";
const PAGE_SIZE = 50;

type DepositStatus = "Unapplied" | "PartiallyApplied" | "Applied";

interface Deposit {
  Id: number; ReceiptNo: string | null; BookingId: number; Amount: number; AppliedAmount: number; AvailableBalance: number;
  Status: DepositStatus; ReceivedDate: string; PaymentMode: string | null; TransactionRef: string | null; Notes: string | null;
  CreatedAt: string; DepositBankId: number | null; DepositBankName: string | null; SourceReceivedPaymentId: number | null;
  BookingNo: string; ProjectId: number | null; ProjectName: string | null; UnitNo: string | null; GrandTotal: number | null;
  ApplicantName: string; Mobile: string | null; CreatedByName: string | null;
}
interface Summary {
  TotalCount: number; TotalReceived: number; TotalAvailable: number; TotalApplied: number;
  UnappliedCount: number; PartialCount: number; AppliedCount: number; UnappliedBalance: number; PartialBalance: number;
}
interface Milestone {
  Id: number; MilestoneNo: number; MilestoneName: string; AmountDue: number; AmountPaid: number; Status: string; DueDate: string | null;
  VirtuallyCovered?: boolean;
}
interface BookingDetail {
  booking: { BookingNo: string; ApplicantName: string; ProjectName: string; UnitNo: string; GrandTotal: number; OnAccountTotalReceived?: number };
  milestones: Milestone[];
  summary: { totalDue: number; totalPaid: number; balance: number; overdue: number };
}
interface Filters { search: string; status: string; mode: string; dateFrom: string; dateTo: string }
const EMPTY: Filters = { search: "", status: "", mode: "", dateFrom: "", dateTo: "" };
const MODES = ["Cash", "Cheque", "NEFT", "RTGS", "UPI", "IMPS", "Online"];
const STATUS_TABS: { value: string; label: string }[] = [
  { value: "", label: "All" },
  { value: "Unapplied", label: "Unapplied" },
  { value: "PartiallyApplied", label: "Partly applied" },
  { value: "Applied", label: "Applied" },
];

const fmt = (v?: number | null) => (v == null ? "—" : fmtRupees(Number(v)));
const fd = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const DIALOG = "rounded-none p-5 gap-4";

function DepositMark({ s }: { s: DepositStatus }) {
  return <SheetMark text={s === "Applied" ? "Applied" : s === "PartiallyApplied" ? "Partly applied" : "Unapplied"}
    tone={s === "Applied" ? "done" : "waiting"} />;
}
function MilestoneMark({ m }: { m: Milestone }) {
  const overdue = m.DueDate && new Date(m.DueDate) < new Date() && m.Status !== "Paid" && m.Status !== "Waived";
  if (m.Status === "Paid") return <SheetMark text="Paid" tone="done" />;
  if (m.Status === "Waived") return <SheetMark text="Waived" tone="none" />;
  if (m.VirtuallyCovered) return <SheetMark text="Covered on account" tone="done" />;
  if (overdue) return <SheetMark text="Overdue" tone="stopped" />;
  return <SheetMark text="Pending" tone="waiting" />;
}

async function fetchBooking(bookingId: number): Promise<BookingDetail> {
  const r = await fetchWithAuth(`${API}/booking/${bookingId}`);
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new Error(data?.error || "Could not load the booking's milestones.");
  return data;
}

// ── Adjust dialog ─────────────────────────────────────────────────────────────

function AdjustDialog({ deposit, onClose, onDone }: { deposit: Deposit; onClose(): void; onDone(): void }) {
  const [selId, setSelId] = useState<number | null>(null);
  const [amt, setAmt] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: bk, isLoading, isError, error } = useQuery<BookingDetail>({
    queryKey: ["bk-milestones", deposit.BookingId],
    queryFn: () => fetchBooking(deposit.BookingId),
    staleTime: 30_000,
  });

  const outstanding = useMemo(() =>
    (bk?.milestones || []).filter((m) => m.Status !== "Paid" && m.Status !== "Waived" && Number(m.AmountDue) - Number(m.AmountPaid) > 0),
  [bk]);

  // A full-booking hold: nothing settles until the on-account money covers the whole booking (the server's
  // gate in applyOnAccountToMilestone), so manual apply is only offered once it does.
  const bookingGrandTotal = Number(bk?.booking?.GrandTotal) || 0;
  const bookingOnAccountReceived = Number(bk?.booking?.OnAccountTotalReceived) || 0;
  const notFullyPaid = bookingGrandTotal > 0 && bookingOnAccountReceived < bookingGrandTotal;
  const shortfall = Math.max(0, bookingGrandTotal - bookingOnAccountReceived);

  const sel = outstanding.find((m) => m.Id === selId);
  const maxAmt = sel ? Math.min(Number(deposit.AvailableBalance), Number(sel.AmountDue) - Number(sel.AmountPaid)) : Number(deposit.AvailableBalance);

  async function apply() {
    if (selId == null) { toast.error("Select a milestone first"); return; }
    const n = amt ? parseFloat(amt) : undefined;
    if (n !== undefined && (isNaN(n) || n <= 0)) { toast.error("Enter a valid amount"); return; }
    if (n && n > maxAmt) { toast.error(`At most ${fmt(maxAmt)}`); return; }
    setBusy(true);
    try {
      const res = await fetchWithAuth(`${API}/on-account/${deposit.Id}/apply`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ MilestoneId: selId, ...(n ? { Amount: n } : {}) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(data.error || "Apply failed"); return; }
      toast.success(`${fmt(data.applied)} applied · ${fmt(data.remaining)} left`);
      onDone();
    } catch { toast.error("Network error"); }
    finally { setBusy(false); }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={`max-w-xl ${DIALOG}`} style={{ border: RULE }}>
        <DialogHeader>
          <DialogTitle className="font-heading flex items-center gap-2"><ArrowRightLeft size={15} /> Adjust {deposit.ReceiptNo || `deposit #${deposit.Id}`}</DialogTitle>
          <DialogDescription className="text-xs">
            <ApplicantNames name={deposit.ApplicantName} bookingId={deposit.BookingId} /> · <span className="font-heading tabular-nums">{deposit.BookingNo}</span>
            {deposit.ProjectName ? ` · ${deposit.ProjectName}` : ""}{deposit.UnitNo ? ` · ${deposit.UnitNo}` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-3" style={{ border: RULE_SOFT }}>
          {[
            { label: "Deposited", val: deposit.Amount },
            { label: "Applied", val: deposit.AppliedAmount },
            { label: "Available", val: deposit.AvailableBalance },
          ].map(({ label, val }, i) => (
            <div key={label} className="px-3 py-2" style={{ borderLeft: i ? RULE_SOFT : undefined }}>
              <div className={LBL}>{label}</div>
              <div className="mt-1 font-heading text-sm font-bold tabular-nums">{fmt(val)}</div>
            </div>
          ))}
        </div>

        {notFullyPaid && (
          <div className="px-3 py-2.5 space-y-2" style={{ border: RULE_SOFT, borderLeft: "3px solid hsl(var(--foreground))" }}>
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="font-medium">Held on account — settles itself once the booking is fully funded</span>
              <span className="text-muted-foreground tabular-nums shrink-0">{fmt(bookingOnAccountReceived)} of {fmt(bookingGrandTotal)}</span>
            </div>
            <div className="h-1.5" style={{ border: RULE_SOFT }}><div className="h-full bg-foreground" style={{ width: `${Math.min(100, (bookingOnAccountReceived / bookingGrandTotal) * 100)}%` }} /></div>
            <p className="text-[0.6875rem] text-muted-foreground tabular-nums">{fmt(shortfall)} more on account settles every eligible milestone, in order. Manual apply is only a fallback.</p>
          </div>
        )}

        <div>
          <div className={`mb-1.5 ${LBL}`}>Milestone to apply against (manual fallback)</div>
          {isError ? (
            <p className="py-5 text-center text-sm text-destructive" style={{ border: RULE_SOFT }}>{(error as Error)?.message}</p>
          ) : isLoading ? (
            <p className="py-5 text-center text-sm text-muted-foreground" style={{ border: RULE_SOFT }}>Loading…</p>
          ) : outstanding.length === 0 ? (
            <p className="py-5 text-center text-sm text-muted-foreground" style={{ border: RULE_SOFT }}>No outstanding milestones on this booking.</p>
          ) : (
            <div className="max-h-52 overflow-y-auto thin-scroll" style={{ border: RULE_SOFT }}>
              {outstanding.map((m) => {
                const due = Number(m.AmountDue) - Number(m.AmountPaid);
                const on = selId === m.Id;
                return (
                  <button key={m.Id} onClick={() => { setSelId(m.Id); setAmt(String(Math.min(deposit.AvailableBalance, due))); }}
                    className={`w-full text-left px-3 py-2.5 flex items-center gap-3 transition-colors ${on ? "bg-primary/10" : "hover:bg-primary/5"}`}
                    style={{ borderBottom: RULE_SOFT, borderLeft: on ? "3px solid hsl(var(--foreground))" : "3px solid transparent" }}>
                    <span className="font-heading text-xs tabular-nums text-muted-foreground w-6">{m.MilestoneNo}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{m.MilestoneName}</div>
                      <div className="mt-0.5 text-[0.6875rem] text-muted-foreground tabular-nums">{m.DueDate ? `Due ${fd(m.DueDate)}` : "No due date"}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-heading text-sm font-semibold tabular-nums">{fmt(due)}</div>
                      <div className="text-[0.6875rem] text-muted-foreground tabular-nums">of {fmt(m.AmountDue)}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {selId !== null && !notFullyPaid && (
          <div>
            <label className={`block mb-1 ${LBL}`}>Amount to apply <span className="normal-case tracking-normal">(blank = {fmt(maxAmt)})</span></label>
            <input type="number" value={amt} onChange={(e) => setAmt(e.target.value)} min={0} max={maxAmt} step={0.01} className={`${INP} tabular-nums`} />
          </div>
        )}

        <DialogFooter className="gap-2">
          <button onClick={onClose} className={`${KEY_LINE} h-9 px-4`}>Cancel</button>
          {notFullyPaid ? (
            <span className={`${KEY_LINE} h-9 px-4 opacity-60 cursor-not-allowed`} title={`${fmt(shortfall)} more on account settles this by itself`}>Settles once fully funded</span>
          ) : (
            <button onClick={apply} disabled={selId == null || busy} className={`${KEY_INK} h-9 px-4`}
              title="The booking is fully funded and should settle by itself — this is a manual fallback">
              <ArrowRightLeft size={13} /> {busy ? "Applying…" : "Apply manually"}
            </button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── A deposit's booking schedule (expanded row) ───────────────────────────────

function MilestoneSchedule({ deposit }: { deposit: Deposit }) {
  const { data: bk, isLoading, isError, error } = useQuery<BookingDetail>({
    queryKey: ["bk-milestones", deposit.BookingId],
    queryFn: () => fetchBooking(deposit.BookingId),
    staleTime: 60_000,
  });
  const meta = [
    deposit.PaymentMode, deposit.TransactionRef && `Ref ${deposit.TransactionRef}`, deposit.DepositBankName,
    deposit.CreatedByName && `By ${deposit.CreatedByName}`,
  ].filter(Boolean).join(" · ");

  return (
    <div className="px-4 py-3 space-y-3">
      {(meta || deposit.Notes) && (
        <p className="text-[0.6875rem] text-muted-foreground tabular-nums">{meta}{deposit.Notes ? <span className="italic"> · “{deposit.Notes}”</span> : null}</p>
      )}
      {isError ? (
        <p className="text-xs text-destructive">{(error as Error)?.message}</p>
      ) : isLoading ? (
        <p className="text-xs text-muted-foreground">Loading schedule…</p>
      ) : (bk?.milestones?.length ?? 0) > 0 && (
        <div className="bg-card" style={{ border: RULE_SOFT }}>
          <div className={`px-3 py-2 ${LBL}`} style={{ borderBottom: RULE_SOFT }}>Payment schedule — {deposit.BookingNo}</div>
          <table className="w-full text-xs">
            <tbody>
              {bk!.milestones.map((m) => {
                const bal = Number(m.AmountDue) - Number(m.AmountPaid);
                return (
                  <tr key={m.Id} style={{ borderBottom: RULE_SOFT }}>
                    <td className="!px-3 !py-1.5 w-8 font-heading tabular-nums text-muted-foreground">{m.MilestoneNo}</td>
                    <td className="!px-3 !py-1.5">{m.MilestoneName}</td>
                    <td className="!px-3 !py-1.5 tabular-nums text-muted-foreground">{fd(m.DueDate)}</td>
                    <td className="!px-3 !py-1.5 text-right tabular-nums">{fmt(m.AmountPaid)} <span className="text-muted-foreground">of {fmt(m.AmountDue)}</span></td>
                    <td className="!px-3 !py-1.5 text-right font-heading tabular-nums">{bal > 0 ? fmt(bal) : "—"}</td>
                    <td className="!px-3 !py-1.5"><MilestoneMark m={m} /></td>
                  </tr>
                );
              })}
            </tbody>
            {bk!.summary && (
              <tfoot>
                <tr>
                  <td colSpan={3} className={`!px-3 !py-2 ${LBL}`}>Total</td>
                  <td className="!px-3 !py-2 text-right font-heading tabular-nums">{fmt(bk!.summary.totalPaid)} <span className="text-muted-foreground font-normal">of {fmt(bk!.summary.totalDue)}</span></td>
                  <td className="!px-3 !py-2 text-right font-heading font-semibold tabular-nums">{bk!.summary.balance > 0 ? fmt(bk!.summary.balance) : "—"}</td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function CrmOnAccount() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { canEdit } = usePageRights("crm-payments");

  const [searchInput, setSearchInput] = useState("");
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [cpb, setCpb] = useState<CrmCompanyProjectBlockValue>({ companyId: "", projectId: "", blockId: "" });
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [adjusting, setAdjusting] = useState<Deposit | null>(null);

  const patch = (p: Partial<Filters>) => { setFilters((f) => ({ ...f, ...p })); setPage(1); };
  // Searches as you type (after a short pause); Enter still searches at once.
  useSearchAsYouType(searchInput, (v) => patch({ search: v }));
  const hasFilters = Boolean(filters.search || filters.status || filters.mode || filters.dateFrom || filters.dateTo || cpb.companyId || cpb.projectId || cpb.blockId);
  const clearAll = () => { setSearchInput(""); setFilters(EMPTY); setCpb({ companyId: "", projectId: "", blockId: "" }); setPage(1); };
  const toggle = (id: number) => setExpanded((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const query = useMemo(() => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...filters, companyId: cpb.companyId, projectId: cpb.projectId, blockId: cpb.blockId })) if (v) q.set(k, v);
    return q;
  }, [filters, cpb]);

  const { data, isLoading, isError, error, isFetching, refetch } = useQuery({
    queryKey: ["crm-on-account", query.toString(), page],
    queryFn: async () => {
      const q = new URLSearchParams(query);
      q.set("page", String(page));
      q.set("pageSize", String(PAGE_SIZE));
      const r = await fetchWithAuth(`${API}/on-account?${q}`);
      const body = await r.json().catch(() => null);
      if (!r.ok) throw new Error(body?.error || "Failed to load deposits");
      return body as { deposits: Deposit[]; total: number };
    },
    placeholderData: (prev) => prev,
    staleTime: 30_000,
  });
  // Figures for the same filters (status aside), so they agree with the list beneath.
  const summaryQuery = useMemo(() => { const q = new URLSearchParams(query); q.delete("status"); return q.toString(); }, [query]);
  const { data: summary, refetch: refetchSummary } = useQuery({
    queryKey: ["crm-on-account-summary", summaryQuery],
    queryFn: async () => {
      const r = await fetchWithAuth(`${API}/on-account/summary?${summaryQuery}`);
      const body = await r.json().catch(() => null);
      if (!r.ok) throw new Error(body?.error || "Failed to load the totals");
      return body as Summary;
    },
    placeholderData: (prev) => prev,
    staleTime: 30_000,
  });

  const deposits = data?.deposits || [];
  const total = data?.total || 0;
  const pageCR = deposits.reduce((s, d) => s + Number(d.Amount), 0);
  const pageDR = deposits.reduce((s, d) => s + Number(d.AppliedAmount), 0);
  const pageBAL = deposits.reduce((s, d) => s + Number(d.AvailableBalance), 0);
  const util = summary && summary.TotalReceived > 0 ? Math.round((summary.TotalApplied / summary.TotalReceived) * 100) : 0;

  function onAdjustDone() {
    setAdjusting(null);
    for (const k of ["crm-on-account", "crm-on-account-summary", "bk-milestones", "crm-booking-on-account", "crm-booking-detail"]) {
      qc.invalidateQueries({ queryKey: [k], exact: false });
    }
  }

  const figures = [
    { label: "Received", value: fmt(summary?.TotalReceived), note: `${summary?.TotalCount ?? 0} deposits`, status: "" },
    { label: "Applied", value: fmt(summary?.TotalApplied), note: `${summary?.AppliedCount ?? 0} fully applied`, status: "Applied" },
    { label: "Available", value: fmt(summary?.TotalAvailable), note: `${(summary?.UnappliedCount ?? 0) + (summary?.PartialCount ?? 0)} open · ${fmt(summary?.UnappliedBalance ?? 0)} unapplied`, status: "Unapplied" },
    { label: "Utilisation", value: `${util}%`, note: `${fmt(summary?.PartialBalance ?? 0)} left on partly applied`, status: "PartiallyApplied" },
  ];
  const tabCount = (v: string) => (v === "" ? summary?.TotalCount : v === "Unapplied" ? summary?.UnappliedCount : v === "PartiallyApplied" ? summary?.PartialCount : summary?.AppliedCount) ?? 0;
  const tabClass = (on: boolean) => `inline-flex items-center gap-2 px-3 h-9 font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] shrink-0 transition-colors ${on ? "bg-foreground text-card" : "text-muted-foreground hover:text-foreground hover:bg-primary/5"}`;
  const th = `!px-3 !py-2.5 text-left ${LBL}`;
  const td = "!px-3 !py-2.5";
  const dateInp = "!h-9 !rounded-none !shadow-none border-foreground/40 bg-card !px-2.5 text-xs tabular-nums";

  return (
    <>
      <Breadcrumbs items={["Dashboard", "CRM", "On Account"]} />
      <SheetShell
        eyebrow="CivilierERP · CRM · Finance"
        title="On Account"
        subtitle="Customers' advance deposits: every rupee received, applied to milestones, and still available, across the bookings."
        action={
          <button onClick={() => { refetch(); refetchSummary(); }} disabled={isFetching} className={`${KEY_LINE} h-9 w-9`} title="Refresh">
            <RefreshCw size={13} className={isFetching ? "animate-spin" : ""} />
          </button>
        }
      >
        <div className="space-y-5">
          <div className="bg-card" style={{ border: RULE }}>
            <div className="statrow four" style={{ padding: "16px 16px 18px" }}>
              {figures.map((x) => (
                <div key={x.label}>
                  <button onClick={() => patch({ status: x.status })} className="label link">{x.label}</button>
                  <p className="figure" style={{ fontSize: "clamp(16px, 1.8vw, 24px)", marginTop: 9 }}>{summary ? x.value : "…"}</p>
                  <p style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }} className="tabular-nums">{x.note}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-card" style={{ border: RULE }}>
            <div className="px-5 py-4 space-y-3" style={{ borderBottom: RULE }}>
              <div className="inline-flex items-stretch flex-wrap" style={{ border: RULE }}>
                {STATUS_TABS.map((t) => (
                  <button key={t.value || "all"} onClick={() => patch({ status: t.value })} className={tabClass(filters.status === t.value)} style={{ borderRight: RULE_SOFT }}>
                    {t.label} <span className="tabular-nums">{tabCount(t.value)}</span>
                  </button>
                ))}
              </div>
              <div className="flex gap-2.5 flex-wrap items-center">
                <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") patch({ search: searchInput.trim() }); }}
                  placeholder="Search customer, booking, receipt, project, unit…"
                  className="h-9 flex-1 min-w-48 border border-foreground/40 focus:border-foreground bg-card px-3 text-xs text-foreground outline-none" />
                <select value={filters.mode} onChange={(e) => patch({ mode: e.target.value })} aria-label="Payment mode"
                  className="h-9 w-32 border border-foreground/40 focus:border-foreground bg-card px-2 text-xs text-foreground outline-none">
                  <option value="">All modes</option>
                  {MODES.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
                <CrmCompanyProjectBlockFilter value={cpb} onChange={(v) => { setCpb(v); setPage(1); }} />
                <div className="flex items-center gap-1.5">
                  <div className="w-36"><DateInput value={filters.dateFrom} onChange={(e) => patch({ dateFrom: e.target.value })} aria-label="Received from" placeholder="Received from" className={dateInp} /></div>
                  <span className="text-xs text-muted-foreground">–</span>
                  <div className="w-36"><DateInput value={filters.dateTo} onChange={(e) => patch({ dateTo: e.target.value })} aria-label="Received to" placeholder="Received to" className={dateInp} /></div>
                </div>
                {hasFilters && <button onClick={clearAll} className={`${KEY_LINE} h-9 px-3`}><X size={12} /> Clear</button>}
              </div>
            </div>

            <div className="overflow-x-auto thin-scroll">
              <table className="w-full text-sm min-w-[980px]">
                <thead>
                  <tr style={{ borderBottom: RULE }}>
                    <th className={`${th} w-8`} /><th className={th}>Received</th><th className={th}>Receipt · ref</th><th className={th}>Customer · booking</th>
                    <th className={th}>Mode</th><th className={`${th} !text-right`}>Deposited</th><th className={`${th} !text-right`}>Applied</th>
                    <th className={`${th} !text-right`}>Balance</th><th className={th}>State</th><th className={th} />
                  </tr>
                </thead>
                <tbody>
                  {isError ? (
                    <tr><td colSpan={10} className={`${td} text-center text-destructive`}>{(error as Error)?.message}</td></tr>
                  ) : isLoading && !data ? (
                    <tr><td colSpan={10} className={`${td} text-center text-muted-foreground`}>Loading deposits…</td></tr>
                  ) : deposits.length === 0 ? (
                    <tr><td colSpan={10} className={`${td} text-center text-muted-foreground`}>{hasFilters ? "No deposit matches these filters." : "No on-account deposits yet."}</td></tr>
                  ) : deposits.map((d) => {
                    const isExp = expanded.has(d.Id);
                    return (
                      <React.Fragment key={d.Id}>
                        <tr onClick={() => toggle(d.Id)} className={`align-top cursor-pointer hover:bg-primary/5 transition-colors ${d.Status === "Applied" ? "text-muted-foreground" : ""}`}
                          style={{ borderBottom: isExp ? undefined : RULE_SOFT }}>
                          <td className={`${td} text-muted-foreground`}>{isExp ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</td>
                          <td className={`${td} whitespace-nowrap tabular-nums text-xs`}>{fd(d.ReceivedDate)}</td>
                          <td className={td}>
                            <div className="font-heading text-xs font-semibold tabular-nums text-foreground">{d.ReceiptNo || <span className="italic font-normal text-muted-foreground">Pending</span>}</div>
                            {d.TransactionRef && <div className="mt-0.5 text-[0.6875rem] text-muted-foreground tabular-nums truncate max-w-[140px]">{d.TransactionRef}</div>}
                          </td>
                          <td className={`${td} max-w-[260px]`}>
                            <div className="text-xs font-medium text-foreground truncate"><ApplicantNames name={d.ApplicantName} bookingId={d.BookingId} /></div>
                            <div className="mt-0.5 text-[0.6875rem] text-muted-foreground truncate">
                              <span className="font-heading tabular-nums">{d.BookingNo}</span>{d.ProjectName ? ` · ${d.ProjectName}` : ""}{d.UnitNo ? ` · ${d.UnitNo}` : ""}
                            </div>
                          </td>
                          <td className={`${td} text-xs`}>{d.PaymentMode || "—"}</td>
                          <td className={`${td} text-right font-heading tabular-nums text-foreground`}>{fmt(d.Amount)}</td>
                          <td className={`${td} text-right font-heading tabular-nums`}>{d.AppliedAmount > 0 ? fmt(d.AppliedAmount) : "—"}</td>
                          <td className={`${td} text-right font-heading font-semibold tabular-nums text-foreground`}>{d.AvailableBalance > 0 ? fmt(d.AvailableBalance) : "—"}</td>
                          <td className={td}><DepositMark s={d.Status} /></td>
                          <td className={`${td} text-right`} onClick={(e) => e.stopPropagation()}>
                            <div className="inline-flex items-center gap-1.5">
                              {canEdit && d.Status !== "Applied" && <button onClick={() => setAdjusting(d)} className={`${KEY_LINE} h-8 px-3`}>Adjust</button>}
                              <button onClick={() => navigate(`/crm/booking/${d.BookingId}`)} title="Open booking" className={`${KEY_LINE} h-8 w-8`}><ExternalLink size={12} /></button>
                            </div>
                          </td>
                        </tr>
                        {isExp && (
                          <tr style={{ borderBottom: RULE_SOFT }}>
                            <td />
                            <td colSpan={9} className="!p-0"><MilestoneSchedule deposit={d} /></td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
                {deposits.length > 0 && (
                  <tfoot>
                    <tr style={{ borderTop: RULE }}>
                      <td colSpan={5} className={`${td} ${LBL}`}>This page · {deposits.length} deposit{deposits.length === 1 ? "" : "s"}</td>
                      <td className={`${td} text-right font-heading font-bold tabular-nums`}>{fmt(pageCR)}</td>
                      <td className={`${td} text-right font-heading font-bold tabular-nums`}>{pageDR > 0 ? fmt(pageDR) : "—"}</td>
                      <td className={`${td} text-right font-heading font-bold tabular-nums`}>{pageBAL > 0 ? fmt(pageBAL) : "—"}</td>
                      <td colSpan={2} />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
            <div style={{ borderTop: RULE_SOFT }}><CrmPaginationBar page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} /></div>
          </div>
        </div>
      </SheetShell>

      {adjusting && <AdjustDialog deposit={adjusting} onClose={() => setAdjusting(null)} onDone={onAdjustDone} />}
    </>
  );
}
