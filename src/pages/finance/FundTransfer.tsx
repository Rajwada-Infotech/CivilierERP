import React from "react";
import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { FinanceShell } from "@/components/finance/FinanceShell";
import { preventEnterSubmit, wasPageReloaded } from "@/hooks/useDraftForm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  Plus, ArrowLeftRight, Building2, Landmark, Loader2, RefreshCw,
  CheckCircle2, Clock, FileText, AlertCircle, Search, X, ExternalLink,
  Calendar, ShieldCheck, Wallet, BookOpen, Hash, CalendarDays, ChevronDown,
  AlertTriangle, Info, CalendarClock,
} from "lucide-react";
import {
  getFundTransfers,
  getFundTransfer,
  createFundTransfer,
  type FundTransferSummary,
  type FundTransferDetail,
  type FundTransferType,
  type FundTransferMode,
} from "@/api/fundTransferApi";
import { getEnterpriseOptions } from "@/api/enterpriseApi";
import { getBanks, type BankRecord } from "@/api/bankMasterApi";
import { fetchChequeLots, fetchChequeNumbers } from "@/pages/finance/payment/api";
import type { ChequeLot } from "@/pages/finance/payment/types";
import { formatINR } from "@/utils/formatCurrency";
import { usePageRights } from "@/hooks/usePageRights";

const PAYMENT_MODES: FundTransferMode[] = ["Cash", "Cheque", "Post-Dated Cheque", "NEFT", "UPI", "RTGS", "IMPS", "Card"];
const CHEQUE_MODES: FundTransferMode[] = ["Cheque", "Post-Dated Cheque"];
const DIGITAL_MODES: FundTransferMode[] = ["NEFT", "UPI", "RTGS", "IMPS", "Card"];
const DIGITAL_REF_LABEL: Record<string, string> = {
  NEFT: "NEFT UTR Number",
  UPI: "UPI Transaction ID",
  RTGS: "RTGS UTR Number",
  IMPS: "IMPS Reference No.",
  Card: "Card Reference / Auth Code",
};

const STATUS_CFG: Record<string, { text: string; bar: string }> = {
  Draft:    { text: "text-muted-foreground", bar: "bg-border" },
  Pending:  { text: "text-amber-700",  bar: "bg-amber-500" },
  Approved: { text: "text-emerald-700", bar: "bg-emerald-500" },
  Rejected: { text: "text-rose-700",   bar: "bg-rose-500" },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CFG[status] ?? STATUS_CFG.Draft;
  return (
    <span className={cn("inline-flex items-center gap-1.5 pl-1.5 pr-2 py-0.5 rounded-sm border border-border bg-card font-mono text-[10px] font-semibold uppercase tracking-wider", cfg.text)}>
      <span className={cn("w-[3px] h-3 rounded-[1px]", cfg.bar)} />
      {status}
    </span>
  );
}

function TypeBadge({ type }: { type: FundTransferType }) {
  const isInter = type === "Inter";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 pl-1.5 pr-2 py-0.5 rounded-sm border font-mono text-[10px] font-semibold uppercase tracking-wider",
        isInter ? "border-violet-300 text-violet-700 bg-violet-50/50" : "border-border text-muted-foreground bg-card",
      )}
    >
      <span className={cn("w-[3px] h-3 rounded-[1px]", isInter ? "bg-violet-500" : "bg-border")} />
      {isInter ? "Inter · Loan" : "Intra"}
    </span>
  );
}

// Signature element: a literal source → amount → destination flow, instead of
// stacked "A (Co) → B (Co)" text. Reused in the desktop table, mobile cards,
// and as a live preview inside the New Transfer dialog. `compact` drops the
// amount chip and shrinks type, for the table's tighter row height.
function FlowConnector({
  sourceLabel,
  destLabel,
  sourceSub,
  destSub,
  amount,
  type,
  compact = false,
}: {
  sourceLabel: string;
  destLabel: string;
  sourceSub?: string | null;
  destSub?: string | null;
  amount?: string;
  type: FundTransferType;
  compact?: boolean;
}) {
  const rail = type === "Inter" ? "border-violet-400" : "border-border";
  const node = type === "Inter" ? "bg-violet-500" : "bg-foreground/40";
  return (
    <div className={cn("flex items-center gap-2 min-w-0 font-mono", amount && "mt-2")}>
      <div className="min-w-0 text-right shrink-0">
        <p className={cn("font-semibold text-foreground truncate", compact ? "text-[11px] max-w-[100px]" : "text-xs max-w-[140px]")}>{sourceLabel}</p>
        {sourceSub && !compact && <p className="text-[10px] text-muted-foreground truncate max-w-[140px]">{sourceSub}</p>}
      </div>

      <div className="relative flex-1 min-w-[36px] flex items-center">
        <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", node)} />
        <div className={cn("flex-1 border-t border-dashed", rail)} />
        {amount && (
          <span
            className={cn(
              "absolute left-1/2 -translate-x-1/2 -top-2 px-1 bg-card font-semibold tabular-nums whitespace-nowrap",
              compact ? "text-[10px]" : "text-[11px]",
              type === "Inter" ? "text-violet-700" : "text-foreground",
            )}
          >
            {amount}
          </span>
        )}
        <ArrowLeftRight size={compact ? 8 : 9} className={cn("shrink-0", type === "Inter" ? "text-violet-500" : "text-muted-foreground")} />
        <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", node)} />
      </div>

      <div className="min-w-0 shrink-0">
        <p className={cn("font-semibold truncate", type === "Inter" ? "text-violet-700" : "text-foreground", compact ? "text-[11px] max-w-[100px]" : "text-xs max-w-[140px]")}>{destLabel}</p>
        {destSub && !compact && <p className="text-[10px] text-muted-foreground truncate max-w-[140px]">{destSub}</p>}
      </div>
    </div>
  );
}

// An Inter-Company transfer creates a real dbo.LoanSanction record on
// approval (see postFundTransferApproval in generalLedger.js) — this links
// straight into the Loan Sanction module's own deep-link support
// ("/loan/sanction?view=<id>"), the same pattern the Reminder Bell uses,
// rather than duplicating any loan-balance/ledger UI here.
function LoanLink({ loanId, loanNo, status }: { loanId: number; loanNo: string | null; status: string | null }) {
  const navigate = useNavigate();
  return (
    <button
      onClick={(e) => { e.stopPropagation(); navigate(`/loan/sanction?view=${loanId}`); }}
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-violet-400/20 bg-violet-500/5 text-[10px] font-mono text-violet-600 hover:bg-violet-500/15 transition-colors"
      title="Open in Loan Sanction"
    >
      <Landmark size={9} /> {loanNo || `LN-${loanId}`}{status ? ` · ${status}` : ""} <ExternalLink size={9} />
    </button>
  );
}

// Read-only detail view — approval now happens exclusively through the
// Approval Inbox (see MODULE_CONFIG in src/pages/admin/ApprovalInbox.tsx),
// so this is purely informational: full party/bank breakdown, GL posting
// confirmation, and a link out to the linked loan if there is one.
function DetailRow({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 border-b border-border/60 last:border-0">
      <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground font-heading shrink-0">{label}</span>
      <span className={cn("text-sm text-foreground text-right", mono && "font-mono")}>{value}</span>
    </div>
  );
}

function TransferDetailDialog({
  ftId,
  onClose,
}: {
  ftId: number;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<FundTransferDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const rights = usePageRights("fund-transfer");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getFundTransfer(ftId)
      .then((d) => { if (!cancelled) setDetail(d); })
      .catch((err: any) => { if (!cancelled) toast.error(err?.message || "Failed to load transfer"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [ftId]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 py-4 border-b border-border">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <ArrowLeftRight size={15} className="text-primary" />
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-sm font-semibold font-heading font-mono">
                {detail?.DocNo || `FT-${ftId}`}
              </DialogTitle>
              <DialogDescription className="text-[11px] mt-0.5">Fund Transfer details</DialogDescription>
            </div>
            {detail && (
              <div className="ml-auto flex items-center gap-1.5">
                <TypeBadge type={detail.TransferType} />
                <StatusBadge status={detail.Status} />
              </div>
            )}
          </div>
        </DialogHeader>

        {loading || !detail ? (
          <div className="py-16 text-center">
            <Loader2 className="h-6 w-6 animate-spin inline text-muted-foreground" />
            <p className="text-sm text-muted-foreground mt-2">Loading…</p>
          </div>
        ) : (
          <div className="px-6 py-5 space-y-5 max-h-[70vh] overflow-y-auto">
            <div className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-3 overflow-x-auto">
              <FlowConnector
                sourceLabel={detail.SourceBankName || "—"}
                sourceSub={detail.SourceCompanyName}
                destLabel={detail.DestinationBankName || "—"}
                destSub={detail.DestinationCompanyName}
                amount={formatINR(detail.Amount || 0)}
                type={detail.TransferType}
              />
            </div>

            {detail.TransferType === "Inter" && detail.LinkedLoanId && (
              <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-lg border border-violet-400/20 bg-violet-500/5">
                <span className="text-xs text-muted-foreground">Booked as an inter-company loan</span>
                <LoanLink loanId={detail.LinkedLoanId} loanNo={detail.LinkedLoanNo} status={detail.LinkedLoanStatus} />
              </div>
            )}

            <div>
              <DetailRow label="Transfer Date" value={fmtDate(detail.TransferDate)} />
              <DetailRow label="Amount" value={<span className="font-mono font-semibold">{formatINR(detail.Amount || 0)}</span>} />
              <DetailRow label="Source Company" value={detail.SourceCompanyName || "—"} />
              <DetailRow label="Source Bank" value={detail.SourceBankName || "—"} />
              <DetailRow label="Destination Company" value={detail.DestinationCompanyName || "—"} />
              <DetailRow label="Destination Bank" value={detail.DestinationBankName || "—"} />
              <DetailRow label="Payment Mode" value={detail.Mode || "—"} />
              {(detail.Mode === "Cheque" || detail.Mode === "Post-Dated Cheque") && (
                <>
                  <DetailRow label="Cheque No" value={detail.ChequeNo || "—"} mono />
                  <DetailRow label="Cheque Lot" value={detail.ChequeLotNumber || "—"} mono />
                  <DetailRow label="Cheque Date" value={fmtDate(detail.ChequeDate)} />
                </>
              )}
              {detail.Mode && !["Cheque", "Post-Dated Cheque", "Cash"].includes(detail.Mode) && detail.DigitalRefNumber && (
                <DetailRow label="Reference No" value={detail.DigitalRefNumber} mono />
              )}
              {detail.Narration && <DetailRow label="Narration" value={detail.Narration} />}
              <DetailRow label="Created By" value={detail.CreatedBy || "—"} />
              <DetailRow label="Created At" value={fmtDate(detail.CreatedAt)} />
              <DetailRow
                label="GL Posting"
                value={
                  detail.Status === "Approved" ? (
                    <span className={cn("inline-flex items-center gap-1", detail.PostedToGL ? "text-emerald-700" : "text-rose-700")}>
                      <ShieldCheck size={13} /> {detail.PostedToGL ? "Posted" : "Not posted"}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">Pending approval</span>
                  )
                }
              />
            </div>
          </div>
        )}

        <DialogFooter className="px-6 py-3.5 border-t border-border bg-muted/20 flex items-center justify-between sm:justify-between">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:bg-muted transition-colors ml-auto"
          >
            Close
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Compact Mode chip for the register/detail views — shows the mode plus
// whichever settlement detail is most useful at a glance (cheque no. for
// Cheque/PDC, the reference number for digital modes).
function ModeChip({
  mode,
  chequeNo,
  digitalRefNumber,
}: {
  mode: string | null;
  chequeNo?: string | null;
  digitalRefNumber?: string | null;
}) {
  if (!mode) return <span className="text-muted-foreground text-xs">—</span>;
  const isCheque = mode === "Cheque" || mode === "Post-Dated Cheque";
  return (
    <span className="inline-flex items-center gap-1 text-xs">
      <span className="font-medium text-foreground">{mode}</span>
      {isCheque && chequeNo && (
        <span className="text-muted-foreground font-mono">· #{chequeNo}</span>
      )}
      {!isCheque && digitalRefNumber && (
        <span className="text-muted-foreground font-mono truncate max-w-[100px]" title={digitalRefNumber}>
          · {digitalRefNumber}
        </span>
      )}
    </span>
  );
}

function fmtDate(d?: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function bankLabel(b: BankRecord) {
  const acct = b.BAccountNumber ? ` — ${b.BAccountNumber}` : "";
  const company = b.BCompanyName ? ` (${b.BCompanyName})` : "";
  return `${b.BName || `Bank #${b.BId}`}${acct}${company}`;
}

export default function FundTransfer() {
  const rights = usePageRights("fund-transfer");
  const [transfers, setTransfers] = useState<FundTransferSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<FundTransferType | null>(null);

  const [companies, setCompanies] = useState<{ id: number; label: string }[]>([]);
  const [banks, setBanks] = useState<BankRecord[]>([]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [transferType, setTransferType] = useState<FundTransferType>("Intra");
  const [transferDate, setTransferDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [sourceCompanyId, setSourceCompanyId] = useState("");
  const [destCompanyId, setDestCompanyId] = useState("");
  const [sourceBankId, setSourceBankId] = useState("");
  const [destBankId, setDestBankId] = useState("");
  const [amount, setAmount] = useState("");
  const [narration, setNarration] = useState("");

  // Payment Mode — mirrors the Payment page's own Mode workflow (Cash /
  // Cheque / PDC / NEFT / UPI / RTGS / IMPS / Card), because the source
  // bank leaving the money is a real bank account and the mode of
  // settlement (which cheque leaf, which UTR) is exactly as relevant here
  // as it is on a Payment.
  const [mode, setMode] = useState<FundTransferMode | "">("");
  const [chequeLots, setChequeLots] = useState<ChequeLot[]>([]);
  const [loadingLots, setLoadingLots] = useState(false);
  const [chequeLotId, setChequeLotId] = useState<number | null>(null);
  const [chequeLotNumber, setChequeLotNumber] = useState("");
  const [chequeNumbers, setChequeNumbers] = useState<{ number: string; used: boolean; bounced: boolean }[]>([]);
  const [loadingCheques, setLoadingCheques] = useState(false);
  const [chequeNo, setChequeNo] = useState("");
  const [chequeDate, setChequeDate] = useState("");
  const [validatingCheque, setValidatingCheque] = useState(false);
  const [digitalRefNumber, setDigitalRefNumber] = useState("");

  const [selectedFTId, setSelectedFTId] = useState<number | null>(null);

  const isChequeMode = CHEQUE_MODES.includes(mode as FundTransferMode);
  const isDigitalMode = DIGITAL_MODES.includes(mode as FundTransferMode);
  const isPostDated = mode === "Post-Dated Cheque";

  // The cheque book being drawn from belongs to the SOURCE bank — that's
  // the account the money (and the physical cheque) actually leaves from.
  useEffect(() => {
    if (!isChequeMode || !sourceBankId) { setChequeLots([]); return; }
    setLoadingLots(true);
    fetchChequeLots(parseInt(sourceBankId, 10))
      .then((lots) => {
        setChequeLots(lots);
        if (lots.length > 0 && !chequeLotId) {
          setChequeLotId(lots[0].CId);
          setChequeLotNumber(lots[0].ChequeLotNumber);
          setChequeNo("");
        }
      })
      .catch(() => setChequeLots([]))
      .finally(() => setLoadingLots(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isChequeMode, sourceBankId]);

  useEffect(() => {
    if (!chequeLotId) { setChequeNumbers([]); return; }
    setLoadingCheques(true);
    fetchChequeNumbers(chequeLotId)
      .then(setChequeNumbers)
      .catch(() => setChequeNumbers([]))
      .finally(() => setLoadingCheques(false));
  }, [chequeLotId]);

  // Banks are tagged to a company by name (BankRecord.BCompanyName), not a
  // numeric FK — resolve the selected company's label and match against
  // that, same as Payment.tsx would need to but doesn't do today. Only
  // show banks actually belonging to whichever company is picked on that
  // side, instead of every active bank regardless of company.
  const sourceCompanyLabel = companies.find((c) => String(c.id) === sourceCompanyId)?.label;
  const destCompanyLabel = companies.find((c) => String(c.id) === destCompanyId)?.label;
  const sourceBanksForCompany = sourceCompanyId
    ? banks.filter((b) => b.BCompanyName === sourceCompanyLabel)
    : banks;
  const destBanksForCompany = (destCompanyId ? banks.filter((b) => b.BCompanyName === destCompanyLabel) : banks)
    .filter((b) => String(b.BId) !== sourceBankId);

  // Drop a bank selection that no longer belongs to its (now-changed) company.
  useEffect(() => {
    if (sourceBankId && !sourceBanksForCompany.some((b) => String(b.BId) === sourceBankId)) {
      setSourceBankId("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceCompanyId]);
  useEffect(() => {
    if (destBankId && !destBanksForCompany.some((b) => String(b.BId) === destBankId)) {
      setDestBankId("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destCompanyId]);

  const activeLot = chequeLots.find((l) => l.CId === chequeLotId) ?? null;
  const availableCheques = chequeNumbers.filter((c) => !c.used && !c.bounced);

  const handleLotSelect = (lotIdStr: string) => {
    const lotId = Number(lotIdStr);
    const lot = chequeLots.find((l) => l.CId === lotId);
    if (!lot) return;
    setChequeLotId(lot.CId);
    setChequeLotNumber(lot.ChequeLotNumber);
    setChequeNo("");
  };

  const handleChequeSelect = (num: string) => {
    setChequeNo(num);
    if (!num || !chequeLotId) return;
    setValidatingCheque(true);
    // Cheque leaf is deducted by the server on form submit, not on selection.
    // Calling deductChequeFromLot here would permanently mark the leaf as used
    // even if the user cancels or changes payment mode.
    setValidatingCheque(false);
  };

  const load = async () => {
    setLoading(true);
    try {
      const data = await getFundTransfers();
      setTransfers(data);
    } catch (err: any) {
      toast.error(err?.message || "Failed to load fund transfers");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    getEnterpriseOptions(undefined, "C")
      .then((rows) => setCompanies(rows.map((r) => ({ id: r.id, label: r.label }))))
      .catch(() => setCompanies([]));
    getBanks()
      .then((rows) => setBanks(rows.filter((b) => b.BStatus)))
      .catch(() => setBanks([]));
  }, []);

  // Intra-company: destination company is always the same as source — the
  // whole point is moving cash between two of the SAME company's banks.
  // Switching type resets whichever destination fields no longer apply,
  // rather than leaving a stale selection from a previous mode behind.
  useEffect(() => {
    if (transferType === "Intra") {
      setDestCompanyId(sourceCompanyId);
      setDestBankId("");
    } else {
      setDestCompanyId("");
      setDestBankId("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transferType]);

  useEffect(() => {
    if (transferType === "Intra") setDestCompanyId(sourceCompanyId);
  }, [sourceCompanyId, transferType]);

  const resetForm = () => {
    setTransferType("Intra");
    setTransferDate(new Date().toISOString().slice(0, 10));
    setSourceCompanyId("");
    setDestCompanyId("");
    setSourceBankId("");
    setDestBankId("");
    setAmount("");
    setNarration("");
    setMode("");
    setChequeLots([]);
    setChequeLotId(null);
    setChequeLotNumber("");
    setChequeNumbers([]);
    setChequeNo("");
    setChequeDate("");
    setDigitalRefNumber("");
  };

  // A refresh used to silently drop an in-progress transfer — state here
  // is spread across many individual useStates rather than one form
  // object, so it gets the same hand-rolled persistence JournalVoucher.tsx
  // uses instead of the shared useDraftForm hook. transferDate always has
  // today's date, so it's excluded from the "is anything actually filled
  // in" check the same way jvDate is there.
  const ftDraftKey = "draft-form:fund-transfer";
  const [ftDraftHydrated, setFtDraftHydrated] = useState(false);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(ftDraftKey);
      if (saved) {
        const d = JSON.parse(saved);
        if (d.transferType) setTransferType(d.transferType);
        if (d.transferDate) setTransferDate(d.transferDate);
        if (d.sourceCompanyId) setSourceCompanyId(d.sourceCompanyId);
        if (d.destCompanyId) setDestCompanyId(d.destCompanyId);
        if (d.sourceBankId) setSourceBankId(d.sourceBankId);
        if (d.destBankId) setDestBankId(d.destBankId);
        if (d.amount) setAmount(d.amount);
        if (d.narration) setNarration(d.narration);
        if (d.mode) setMode(d.mode);
        if (d.chequeLotNumber) setChequeLotNumber(d.chequeLotNumber);
        if (d.chequeNo) setChequeNo(d.chequeNo);
        if (d.chequeDate) setChequeDate(d.chequeDate);
        if (d.digitalRefNumber) setDigitalRefNumber(d.digitalRefNumber);
        const hasContent =
          !!d.sourceCompanyId || !!d.destCompanyId || !!d.amount || !!d.narration?.trim() || !!d.mode;
        // Only reopen the dialog on an actual browser reload — not a plain
        // in-app navigation, which would otherwise let an old leftover
        // draft hijack the sidebar link into always opening the dialog.
        if (hasContent && wasPageReloaded()) setDialogOpen(true);
      }
    } catch {
      // Corrupt/unparseable draft — proceed with a clean form.
    }
    setFtDraftHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!ftDraftHydrated) return;
    const isDirty =
      !!sourceCompanyId || !!destCompanyId || !!amount || !!narration.trim() || !!mode;
    try {
      if (isDirty) {
        localStorage.setItem(
          ftDraftKey,
          JSON.stringify({
            transferType, transferDate, sourceCompanyId, destCompanyId, sourceBankId, destBankId,
            amount, narration, mode, chequeLotNumber, chequeNo, chequeDate, digitalRefNumber,
          }),
        );
      } else {
        localStorage.removeItem(ftDraftKey);
      }
    } catch {
      // localStorage unavailable — the draft simply won't persist.
    }
  }, [
    ftDraftHydrated, transferType, transferDate, sourceCompanyId, destCompanyId, sourceBankId,
    destBankId, amount, narration, mode, chequeLotNumber, chequeNo, chequeDate, digitalRefNumber,
  ]);

  const handleModeChange = (m: FundTransferMode) => {
    setMode(m);
    if (!CHEQUE_MODES.includes(m)) {
      setChequeLotId(null);
      setChequeLotNumber("");
      setChequeNo("");
      setChequeDate("");
    }
    if (!DIGITAL_MODES.includes(m)) setDigitalRefNumber("");
  };

  const submit = async () => {
    if (!sourceCompanyId) { toast.error("Select the source company."); return; }
    if (!destCompanyId) { toast.error("Select the destination company."); return; }
    if (!sourceBankId || !destBankId) { toast.error("Select both the source and destination bank accounts."); return; }
    if (sourceBankId === destBankId) { toast.error("Source and destination bank accounts must differ."); return; }
    if (transferType === "Intra" && sourceCompanyId !== destCompanyId) {
      toast.error("Intra-company transfer requires the same company on both sides.");
      return;
    }
    if (transferType === "Inter" && sourceCompanyId === destCompanyId) {
      toast.error("Inter-company transfer requires two different companies — pick a destination company.");
      return;
    }
    if (!mode) { toast.error("Select a payment mode."); return; }
    if (isChequeMode && (!chequeLotId || !chequeNo)) {
      toast.error("Select a cheque lot and cheque number.");
      return;
    }
    if (isChequeMode && !chequeDate) { toast.error("Enter the cheque date."); return; }
    const amt = Number(amount);
    if (!(amt > 0)) { toast.error("Enter an amount greater than 0."); return; }

    setSaving(true);
    try {
      await createFundTransfer({
        TransferDate: transferDate,
        TransferType: transferType,
        SourceCompanyId: parseInt(sourceCompanyId, 10),
        DestinationCompanyId: parseInt(destCompanyId, 10),
        SourceBankId: parseInt(sourceBankId, 10),
        DestinationBankId: parseInt(destBankId, 10),
        Amount: amt,
        Narration: narration || undefined,
        Mode: mode as FundTransferMode,
        ...(isChequeMode ? {
          ChequeLotId: chequeLotId!,
          ChequeLotNumber: chequeLotNumber,
          ChequeNo: chequeNo,
          ChequeDate: chequeDate,
        } : {}),
        ...(isDigitalMode && digitalRefNumber ? { DigitalRefNumber: digitalRefNumber } : {}),
      });
      toast.success("Fund Transfer created and submitted for approval");
      setDialogOpen(false);
      resetForm();
      load();
    } catch (err: any) {
      toast.error(err?.message || "Failed to create Fund Transfer");
    } finally {
      setSaving(false);
    }
  };

  const stats = useMemo(() => ({
    total:    transfers.length,
    approved: transfers.filter((t) => t.Status === "Approved").length,
    pending:  transfers.filter((t) => t.Status === "Pending").length,
    inter:    transfers.filter((t) => t.TransferType === "Inter").length,
  }), [transfers]);

  const filtered = useMemo(() => {
    let rows = transfers;
    if (statusFilter) rows = rows.filter((t) => t.Status === statusFilter);
    if (typeFilter) rows = rows.filter((t) => t.TransferType === typeFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(
        (t) =>
          (t.DocNo || "").toLowerCase().includes(q) ||
          (t.Narration || "").toLowerCase().includes(q) ||
          (t.SourceCompanyName || "").toLowerCase().includes(q) ||
          (t.DestinationCompanyName || "").toLowerCase().includes(q) ||
          (t.Status || "").toLowerCase().includes(q),
      );
    }
    return rows;
  }, [transfers, search, statusFilter, typeFilter]);

  const toggleStatusFilter = (status: string) =>
    setStatusFilter((prev) => (prev === status ? null : status));
  const toggleTypeFilter = (type: FundTransferType) =>
    setTypeFilter((prev) => (prev === type ? null : type));

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Finance", "Fund Transfer"]} />
      <FinanceShell
        title="Fund Transfer"
        subtitle="Move cash between bank accounts — intra-company, or inter-company as a loan"
        icon={ArrowLeftRight}
        action={
          <div className="flex items-center gap-2">
            <button
              onClick={load}
              disabled={loading}
              className="w-8 h-8 flex items-center justify-center rounded-lg border border-border hover:bg-muted transition-colors text-muted-foreground disabled:opacity-50"
            >
              <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
            </button>
            {rights.canCreate && (
              <Button
                onClick={() => setDialogOpen(true)}
                className="gap-1.5 shrink-0 font-heading font-semibold text-white shadow-sm text-xs px-3 sm:px-4 py-1.5 h-auto rounded-lg gradient-accent transition-all"
              >
                <Plus size={13} />
                <span className="hidden sm:inline">New Fund Transfer</span>
              </Button>
            )}
          </div>
        }
      >
        {!loading && (
          <div className="grid grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-border rounded-lg border border-border bg-card mb-5">
            {[
              { label: "Total Transfers", value: stats.total,    color: "text-foreground", onClick: () => { setStatusFilter(null); setTypeFilter(null); }, active: !statusFilter && !typeFilter },
              { label: "Approved",        value: stats.approved, color: "text-foreground", onClick: () => toggleStatusFilter("Approved"), active: statusFilter === "Approved" },
              { label: "Pending",         value: stats.pending,  color: stats.pending > 0 ? "text-amber-700" : "text-foreground", onClick: () => toggleStatusFilter("Pending"), active: statusFilter === "Pending" },
              { label: "Inter-Company",   value: stats.inter,    color: stats.inter > 0 ? "text-violet-700" : "text-foreground", onClick: () => toggleTypeFilter("Inter"), active: typeFilter === "Inter" },
            ].map(({ label, value, color, onClick, active }) => (
              <button
                key={label}
                onClick={onClick}
                className={cn("px-4 py-3 text-left transition-colors hover:bg-muted/40", active && "bg-primary/5")}
              >
                <p className={cn("text-2xl font-bold leading-none tabular-nums font-mono", color)}>{value}</p>
                <p className={cn("text-[10px] font-semibold uppercase tracking-wider mt-1.5 font-heading", active ? "text-primary" : "text-muted-foreground")}>{label}</p>
              </button>
            ))}
          </div>
        )}

        <div className="relative mb-4">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by doc no, company, narration, or status…"
            className="w-full pl-8 pr-8 py-2 rounded-lg border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X size={12} />
            </button>
          )}
        </div>

        {(statusFilter || typeFilter) && (
          <div className="flex items-center gap-1.5 mb-4">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground font-heading">Filtered by:</span>
            {statusFilter && (
              <button onClick={() => setStatusFilter(null)} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-border bg-muted text-[11px] font-medium text-foreground hover:bg-muted/60">
                {statusFilter} <X size={10} />
              </button>
            )}
            {typeFilter && (
              <button onClick={() => setTypeFilter(null)} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-violet-400/30 bg-violet-500/10 text-[11px] font-medium text-violet-700 hover:bg-violet-500/20">
                {typeFilter === "Inter" ? "Inter-Company" : "Intra-Company"} <X size={10} />
              </button>
            )}
          </div>
        )}

        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <div className="md:hidden divide-y divide-border">
            {loading ? (
              <div className="py-16 text-center">
                <Loader2 className="h-6 w-6 animate-spin inline text-muted-foreground" />
                <p className="text-sm text-muted-foreground mt-2">Loading transfers…</p>
              </div>
            ) : filtered.length === 0 ? (
              <div className="py-20 text-center">
                <div className="flex flex-col items-center gap-3 text-muted-foreground">
                  <ArrowLeftRight size={36} className="opacity-20" />
                  <p className="text-sm font-medium">
                    {search ? "No transfers match your search" : "No fund transfers yet"}
                  </p>
                </div>
              </div>
            ) : (
              filtered.map((t) => (
                <div
                  key={t.FTId}
                  onClick={() => setSelectedFTId(t.FTId)}
                  className="px-4 py-3.5 hover:bg-muted/20 transition-colors cursor-pointer"
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs bg-muted px-2 py-1 rounded text-foreground">
                        {t.DocNo || `FT-${t.FTId}`}
                      </span>
                      <span className="text-[11px] text-muted-foreground tabular-nums">{fmtDate(t.TransferDate)}</span>
                    </div>
                    <span className="font-mono text-sm font-semibold text-foreground tabular-nums shrink-0">
                      {formatINR(t.Amount || 0)}
                    </span>
                  </div>
                  <div className="mb-2 overflow-x-auto">
                    <FlowConnector
                      sourceLabel={t.SourceBankName || "—"}
                      sourceSub={t.SourceCompanyName}
                      destLabel={t.DestinationBankName || "—"}
                      destSub={t.DestinationCompanyName}
                      type={t.TransferType}
                    />
                  </div>
                  {t.TransferType === "Inter" && t.LinkedLoanId && (
                    <div className="mb-2">
                      <LoanLink loanId={t.LinkedLoanId} loanNo={t.LinkedLoanNo} status={t.LinkedLoanStatus} />
                    </div>
                  )}
                  <div className="flex items-center gap-2 flex-wrap">
                    <TypeBadge type={t.TransferType} />
                    <StatusBadge status={t.Status} />
                    <ModeChip mode={t.Mode} chequeNo={t.ChequeNo} digitalRefNumber={t.DigitalRefNumber} />
                  </div>
                </div>
              ))
            )}
          </div>

          <table className="w-full text-sm hidden md:table">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-widest text-muted-foreground font-heading">Doc No</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-widest text-muted-foreground font-heading">Date</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-widest text-muted-foreground font-heading">Type</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-widest text-muted-foreground font-heading">From → To</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-widest text-muted-foreground font-heading">Mode</th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-widest text-muted-foreground font-heading">Amount</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-widest text-muted-foreground font-heading">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-16 text-center">
                    <Loader2 className="h-6 w-6 animate-spin inline text-muted-foreground" />
                    <p className="text-sm text-muted-foreground mt-2">Loading transfers…</p>
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-20 text-center">
                    <div className="flex flex-col items-center gap-3 text-muted-foreground">
                      <ArrowLeftRight size={36} className="opacity-20" />
                      <p className="text-sm font-medium">
                        {search ? "No transfers match your search" : "No fund transfers yet"}
                      </p>
                      {!search && rights.canCreate && (
                        <button
                          onClick={() => setDialogOpen(true)}
                          className="flex items-center gap-1.5 mt-1 px-4 py-2 rounded-lg gradient-accent text-white text-xs font-semibold"
                        >
                          <Plus size={12} /> Create First Transfer
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                filtered.map((t) => (
                  <tr
                    key={t.FTId}
                    onClick={() => setSelectedFTId(t.FTId)}
                    className="hover:bg-muted/30 transition-colors group cursor-pointer"
                  >
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs bg-muted px-2 py-1 rounded text-foreground">
                        {t.DocNo || `FT-${t.FTId}`}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">{fmtDate(t.TransferDate)}</td>
                    <td className="px-4 py-3"><TypeBadge type={t.TransferType} /></td>
                    <td className="px-4 py-3 text-sm">
                      <FlowConnector
                        sourceLabel={t.SourceBankName || "—"}
                        destLabel={t.DestinationBankName || "—"}
                        type={t.TransferType}
                        compact
                      />
                      {t.TransferType === "Inter" && t.LinkedLoanId && (
                        <div className="mt-1">
                          <LoanLink loanId={t.LinkedLoanId} loanNo={t.LinkedLoanNo} status={t.LinkedLoanStatus} />
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <ModeChip mode={t.Mode} chequeNo={t.ChequeNo} digitalRefNumber={t.DigitalRefNumber} />
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-foreground tabular-nums">
                      {formatINR(t.Amount || 0)}
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={t.Status} /></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          {!loading && filtered.length > 0 && (search || statusFilter || typeFilter) && (
            <div className="px-4 py-2.5 border-t border-border bg-muted/20">
              <p className="text-xs text-muted-foreground">
                Showing {filtered.length} of {transfers.length} transfers
              </p>
            </div>
          )}
        </div>
      </FinanceShell>

      {selectedFTId != null && (
        <TransferDetailDialog ftId={selectedFTId} onClose={() => setSelectedFTId(null)} />
      )}

      {/* ── New Fund Transfer Dialog ── */}
      <Dialog open={dialogOpen} onOpenChange={(o) => { setDialogOpen(o); if (!o) resetForm(); }}>
        <DialogContent className="max-w-4xl p-0 gap-0 flex flex-col max-h-[96dvh] overflow-hidden" onKeyDown={preventEnterSubmit}>
          <DialogHeader className="shrink-0 px-4 sm:px-7 py-3 sm:py-4 border-b border-border bg-gradient-to-br from-primary/5 via-transparent to-transparent">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 ring-1 ring-primary/20">
                <ArrowLeftRight size={18} className="text-primary" />
              </div>
              <div className="min-w-0">
                <DialogTitle className="text-base font-semibold font-heading">New Fund Transfer</DialogTitle>
                <DialogDescription className="text-xs mt-0.5">
                  Move cash between bank accounts. Inter-company transfers create a Loan Sanction record automatically.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="px-4 sm:px-7 py-3.5 sm:py-4 space-y-3.5 sm:space-y-4 flex-1 min-h-0 overflow-y-auto">
            {/* Type toggle */}
            <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
              <button
                type="button"
                onClick={() => setTransferType("Intra")}
                className={cn(
                  "relative flex items-center gap-2.5 sm:gap-3 px-3 sm:px-4 py-2.5 sm:py-3 rounded-xl border-2 text-left transition-all",
                  transferType === "Intra" ? "border-primary bg-primary/5 shadow-sm shadow-primary/10" : "border-border hover:bg-muted/40 hover:border-border/80",
                )}
              >
                <div className={cn("w-8 h-8 sm:w-9 sm:h-9 rounded-lg flex items-center justify-center shrink-0 transition-colors", transferType === "Intra" ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground")}>
                  <Building2 size={15} className="sm:hidden" />
                  <Building2 size={16} className="hidden sm:block" />
                </div>
                <div className="min-w-0">
                  <p className={cn("text-xs sm:text-sm font-semibold", transferType === "Intra" ? "text-primary" : "text-foreground")}>Intra-Company</p>
                  <p className="hidden sm:block text-[11px] text-muted-foreground">Between two banks of the same company</p>
                </div>
                {transferType === "Intra" && (
                  <CheckCircle2 size={14} className="absolute top-2 right-2 text-primary" />
                )}
              </button>
              <button
                type="button"
                onClick={() => setTransferType("Inter")}
                className={cn(
                  "relative flex items-center gap-2.5 sm:gap-3 px-3 sm:px-4 py-2.5 sm:py-3 rounded-xl border-2 text-left transition-all",
                  transferType === "Inter" ? "border-violet-500 bg-violet-500/5 shadow-sm shadow-violet-500/10" : "border-border hover:bg-muted/40 hover:border-border/80",
                )}
              >
                <div className={cn("w-8 h-8 sm:w-9 sm:h-9 rounded-lg flex items-center justify-center shrink-0 transition-colors", transferType === "Inter" ? "bg-violet-500/15 text-violet-600" : "bg-muted text-muted-foreground")}>
                  <Landmark size={15} className="sm:hidden" />
                  <Landmark size={16} className="hidden sm:block" />
                </div>
                <div className="min-w-0">
                  <p className={cn("text-xs sm:text-sm font-semibold", transferType === "Inter" ? "text-violet-700" : "text-foreground")}>Inter-Company</p>
                  <p className="hidden sm:block text-[11px] text-muted-foreground">Between two different companies</p>
                </div>
                {transferType === "Inter" && (
                  <CheckCircle2 size={14} className="absolute top-2 right-2 text-violet-600" />
                )}
              </button>
            </div>

            {/* Source / Destination panels */}
            <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-3 sm:gap-4 items-stretch">
              <div className="rounded-xl border border-border bg-muted/10 p-3 sm:p-3.5 space-y-2.5">
                <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-muted-foreground font-heading">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary/60" /> From
                </p>
                <div className="space-y-1.5">
                  <label className="text-[11px] font-medium text-muted-foreground">Company *</label>
                  <Select value={sourceCompanyId} onValueChange={setSourceCompanyId}>
                    <SelectTrigger className="h-9 text-sm bg-background">
                      <SelectValue placeholder="Select company…" />
                    </SelectTrigger>
                    <SelectContent>
                      {companies.map((c) => (
                        <SelectItem key={c.id} value={String(c.id)} className="text-sm">{c.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] font-medium text-muted-foreground">Bank Account *</label>
                  <Select value={sourceBankId} onValueChange={setSourceBankId} disabled={!sourceCompanyId}>
                    <SelectTrigger className="h-9 text-sm bg-background">
                      <SelectValue placeholder={sourceCompanyId ? "Select bank…" : "Select a company first"} />
                    </SelectTrigger>
                    <SelectContent>
                      {sourceBanksForCompany.length === 0 ? (
                        <div className="px-2 py-3 text-xs text-muted-foreground text-center">No banks linked to this company.</div>
                      ) : (
                        sourceBanksForCompany.map((b) => (
                          <SelectItem key={b.BId} value={String(b.BId)} className="text-sm">{bankLabel(b)}</SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Swap connector — a rotated chevron stack on mobile (stacked
                  panels read top-to-bottom), the full icon on desktop where
                  panels sit side by side. */}
              <div className="flex md:flex-col items-center justify-center py-0.5 md:py-0">
                <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-muted flex items-center justify-center shrink-0 ring-1 ring-border/60">
                  <ArrowLeftRight size={14} className="text-muted-foreground rotate-90 md:rotate-0" />
                </div>
              </div>

              <div className="rounded-xl border border-border bg-muted/10 p-3 sm:p-3.5 space-y-2.5">
                <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-muted-foreground font-heading">
                  <span className="w-1.5 h-1.5 rounded-full bg-violet-500/60" /> To
                </p>
                <div className="space-y-1.5">
                  <label className="text-[11px] font-medium text-muted-foreground">Company *</label>
                  <Select
                    value={destCompanyId}
                    onValueChange={setDestCompanyId}
                    disabled={transferType === "Intra"}
                  >
                    <SelectTrigger className="h-9 text-sm bg-background">
                      <SelectValue placeholder={transferType === "Intra" ? "Same as source" : "Select company…"} />
                    </SelectTrigger>
                    <SelectContent>
                      {companies
                        .filter((c) => transferType === "Inter" ? String(c.id) !== sourceCompanyId : true)
                        .map((c) => (
                          <SelectItem key={c.id} value={String(c.id)} className="text-sm">{c.label}</SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] font-medium text-muted-foreground">Bank Account *</label>
                  <Select value={destBankId} onValueChange={setDestBankId} disabled={!destCompanyId}>
                    <SelectTrigger className="h-9 text-sm bg-background">
                      <SelectValue placeholder={destCompanyId ? "Select bank…" : "Select a company first"} />
                    </SelectTrigger>
                    <SelectContent>
                      {destBanksForCompany.length === 0 ? (
                        <div className="px-2 py-3 text-xs text-muted-foreground text-center">No other banks linked to this company.</div>
                      ) : (
                        destBanksForCompany.map((b) => (
                          <SelectItem key={b.BId} value={String(b.BId)} className="text-sm">{bankLabel(b)}</SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {(sourceBankId || destBankId) && (
              <div className="rounded-lg border border-dashed border-border bg-muted/20 px-3.5 sm:px-4 py-2 overflow-x-auto">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground font-heading mb-1">Preview</p>
                <FlowConnector
                  sourceLabel={banks.find((b) => String(b.BId) === sourceBankId)?.BName || "Source bank"}
                  destLabel={banks.find((b) => String(b.BId) === destBankId)?.BName || "Destination bank"}
                  amount={amount && Number(amount) > 0 ? formatINR(Number(amount)) : undefined}
                  type={transferType}
                />
              </div>
            )}

            {/* Payment Mode — same workflow as the Payment page's own Mode
                selector: choosing Cheque/PDC pulls a leaf from the SOURCE
                bank's cheque book (shared with Payment — a leaf claimed
                here can't be claimed there and vice versa); choosing a
                digital mode just asks for the settlement reference. */}
            <div className="space-y-2">
              <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-muted-foreground font-heading">
                <Wallet size={11} /> Payment Mode *
              </p>
              <div className="flex flex-wrap gap-1.5">
                {PAYMENT_MODES.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => handleModeChange(m)}
                    className={cn(
                      "px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-all",
                      mode === m
                        ? "border-primary bg-primary/10 text-primary shadow-sm"
                        : "border-border text-muted-foreground hover:bg-muted/40 hover:border-border/80",
                    )}
                  >
                    {m}
                  </button>
                ))}
              </div>

              {isChequeMode && (
                <div className="rounded-xl border border-border bg-muted/10 p-3 sm:p-3.5 space-y-3 mt-1">
                  {!sourceBankId ? (
                    <p className="text-xs text-muted-foreground">Select the source bank account first.</p>
                  ) : loadingLots ? (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Loader2 size={13} className="animate-spin" /> Loading cheque lots…
                    </div>
                  ) : chequeLots.length === 0 ? (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-600">
                      <AlertTriangle size={12} /> No active cheque lots found for this bank.
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-medium text-muted-foreground">Cheque Lot</label>
                      <div className="relative">
                        <BookOpen size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                        <select
                          value={chequeLotId ? String(chequeLotId) : ""}
                          onChange={(e) => handleLotSelect(e.target.value)}
                          className="w-full appearance-none pl-8 pr-9 py-2 rounded-lg text-sm bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary font-mono"
                        >
                          <option value="">— Select lot —</option>
                          {chequeLots.map((lot) => (
                            <option key={lot.CId} value={String(lot.CId)}>
                              {lot.ChequeLotNumber}
                              {lot.RemainingCheques != null ? `  (${lot.RemainingCheques} remaining)` : ""}
                            </option>
                          ))}
                        </select>
                        <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                      </div>
                    </div>
                  )}

                  {chequeLotId && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                      <div className="space-y-1.5">
                        <label className="text-[11px] font-medium text-muted-foreground">Cheque Number *</label>
                        <div className="relative">
                          <Hash size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                          <select
                            value={chequeNo}
                            onChange={(e) => handleChequeSelect(e.target.value)}
                            disabled={loadingCheques || validatingCheque}
                            className="w-full appearance-none pl-8 pr-9 py-2 rounded-lg text-sm bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-60 font-mono"
                          >
                            <option value="">— Select cheque number —</option>
                            {availableCheques.map((c) => (
                              <option key={c.number} value={c.number}># {c.number}</option>
                            ))}
                          </select>
                          <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground">
                            {loadingCheques || validatingCheque ? (
                              <Loader2 size={13} className="animate-spin" />
                            ) : (
                              <ChevronDown size={14} />
                            )}
                          </div>
                        </div>
                        {availableCheques.length === 0 && !loadingCheques && (
                          <p className="text-[11px] text-amber-600 flex items-center gap-1 mt-1">
                            <AlertTriangle size={10} /> No available cheques left in this lot.
                          </p>
                        )}
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[11px] font-medium text-muted-foreground">
                          {isPostDated ? "Post-Dated Cheque Date *" : "Cheque Date *"}
                        </label>
                        <div className="relative">
                          <CalendarDays size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                          <input
                            type="date"
                            value={chequeDate}
                            min={isPostDated ? new Date().toISOString().slice(0, 10) : undefined}
                            max={isPostDated ? undefined : new Date().toISOString().slice(0, 10)}
                            onChange={(e) => setChequeDate(e.target.value)}
                            className="w-full pl-8 pr-3 py-2 rounded-lg text-sm bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition"
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {isPostDated && chequeDate && (() => {
                    const fmt = (d: Date) => d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
                    const chequeD = new Date(chequeDate);
                    const validUntil = new Date(chequeD);
                    validUntil.setMonth(validUntil.getMonth() + 3);
                    const isExpired = validUntil < new Date();
                    return isExpired ? (
                      <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-red-500/8 border border-red-500/30 text-xs text-red-600 dark:text-red-400">
                        <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                        <span>Cheque dated {fmt(chequeD)} expired on <strong>{fmt(validUntil)}</strong>. Please obtain a new cheque.</span>
                      </div>
                    ) : (
                      <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-indigo-500/5 border border-indigo-500/20 text-xs text-indigo-600 dark:text-indigo-400">
                        <CalendarClock size={13} className="shrink-0 mt-0.5" />
                        <span>PDC scheduled for {fmt(chequeD)} — valid until <strong>{fmt(validUntil)}</strong>.</span>
                      </div>
                    );
                  })()}
                  {isPostDated && !chequeDate && (
                    <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-violet-500/5 border border-violet-500/20 text-xs text-violet-600 dark:text-violet-400">
                      <Info size={13} className="shrink-0 mt-0.5" />
                      <span>Post-dated cheques are generally valid for <strong>3 months</strong> from the cheque date.</span>
                    </div>
                  )}
                </div>
              )}

              {isDigitalMode && (
                <div className="mt-1 space-y-1.5">
                  <label className="text-[11px] font-medium text-muted-foreground">{DIGITAL_REF_LABEL[mode] ?? "Reference Number"}</label>
                  <Input
                    className="h-9"
                    value={digitalRefNumber}
                    onChange={(e) => setDigitalRefNumber(e.target.value)}
                    placeholder={`Enter ${DIGITAL_REF_LABEL[mode]?.toLowerCase() ?? "reference number"}…`}
                  />
                </div>
              )}
            </div>

            {/* Amount, date, narration */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div className="space-y-1.5">
                <label className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground font-heading">
                  <Calendar size={11} /> Date *
                </label>
                <Input type="date" className="h-9" value={transferDate} onChange={(e) => setTransferDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground font-heading">Amount *</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground font-mono pointer-events-none">₹</span>
                  <Input type="number" min={0} step="0.01" className="h-9 font-mono pl-7" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground font-heading">Narration</label>
              <Input className="h-9" value={narration} onChange={(e) => setNarration(e.target.value)} placeholder="Reason for this transfer" />
            </div>

            {transferType === "Inter" && (
              <div className="flex items-start gap-2.5 pl-3.5 sm:pl-4 pr-3.5 sm:pr-4 py-2.5 rounded-lg border border-border bg-muted/20 text-xs text-muted-foreground border-l-[3px] border-l-violet-500">
                <Landmark size={14} className="shrink-0 mt-0.5 text-violet-600" />
                <span>
                  <span className="font-semibold text-foreground">Creates a Loan Sanction record on approval.</span> The
                  source company becomes the lender, the destination company the borrower — no interest, single
                  bullet repayment. Find and manage it afterward in the Loan Sanction module.
                </span>
              </div>
            )}
          </div>

          <DialogFooter className="shrink-0 px-4 sm:px-7 py-3 border-t border-border bg-muted/20">
            <button
              onClick={() => setDialogOpen(false)}
              className="w-full sm:w-auto px-4 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={saving}
              className="w-full sm:w-auto flex items-center justify-center gap-1.5 px-5 py-2 rounded-lg gradient-accent text-white text-sm font-semibold shadow-sm transition-all disabled:opacity-50"
            >
              {saving && <Loader2 size={13} className="animate-spin" />}
              Submit for Approval
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
