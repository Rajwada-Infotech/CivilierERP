import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, BookOpen, CalendarClock, CalendarDays, Hash, Info, Loader2, Wallet, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { BankRecord } from "@/api/bankMasterApi";
import { fetchChequeLots, fetchChequeNumbers } from "@/pages/finance/payment/api";
import type { ChequeLot } from "@/pages/finance/payment/types";
import {
  DIGITAL_REF_LABEL,
  SETTLEMENT_MODES,
  emptySettlement,
  isChequeMode,
  isDigitalMode,
  needsBank,
  type SettlementMode,
  type SettlementValue,
} from "./settlement";

const today = () => new Date().toISOString().slice(0, 10);

const bankLabel = (b: BankRecord) => {
  const acct = b.BAccountNumber ? ` — ${b.BAccountNumber}` : "";
  return `${b.BName || `Bank #${b.BId}`}${acct}`;
};

const fieldCls =
  "w-full h-9 px-3 rounded-lg text-sm bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60";

/**
 * "Payment mode" strip for a Journal Voucher: pick how the settlement moved
 * (Cash / Cheque / PDC / NEFT / UPI / RTGS / IMPS / Card). Cheque modes then
 * pick the bank account → its cheque lot → a free leaf, drawn from the same
 * cheque books Payment and Fund Transfer use.
 */
export function SettlementModeSection({
  value,
  onChange,
  banks,
  companySelected,
}: {
  value: SettlementValue;
  onChange: (next: SettlementValue) => void;
  /** Bank accounts belonging to the voucher's company. */
  banks: BankRecord[];
  companySelected: boolean;
}) {
  const cheque = isChequeMode(value.mode);
  const digital = isDigitalMode(value.mode);
  const postDated = value.mode === "Post-Dated Cheque";

  const [lots, setLots] = useState<ChequeLot[]>([]);
  const [loadingLots, setLoadingLots] = useState(false);
  const [numbers, setNumbers] = useState<{ number: string; used: boolean; bounced: boolean }[]>([]);
  const [loadingNumbers, setLoadingNumbers] = useState(false);

  const set = (patch: Partial<SettlementValue>) => onChange({ ...value, ...patch });

  // The cheque book belongs to the chosen bank account.
  useEffect(() => {
    if (!cheque || !value.bankId) {
      setLots([]);
      return;
    }
    let cancelled = false;
    setLoadingLots(true);
    fetchChequeLots(parseInt(value.bankId, 10))
      .then((l) => {
        if (cancelled) return;
        const list = Array.isArray(l) ? l : [];
        setLots(list);
        // Auto-pick when there's exactly one lot and nothing chosen yet.
        if (list.length === 1 && !value.chequeLotId) onChange({ ...value, chequeLotId: list[0].CId, chequeNo: "" });
      })
      .catch(() => !cancelled && setLots([]))
      .finally(() => !cancelled && setLoadingLots(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cheque, value.bankId]);

  useEffect(() => {
    if (!cheque || !value.chequeLotId) {
      setNumbers([]);
      return;
    }
    let cancelled = false;
    setLoadingNumbers(true);
    fetchChequeNumbers(value.chequeLotId)
      .then((n) => !cancelled && setNumbers(Array.isArray(n) ? n : []))
      .catch(() => !cancelled && setNumbers([]))
      .finally(() => !cancelled && setLoadingNumbers(false));
    return () => {
      cancelled = true;
    };
  }, [cheque, value.chequeLotId]);

  // A voucher being edited already holds its own leaf, which the server reports
  // as "used" — keep it selectable so opening an edit doesn't blank it.
  const available = useMemo(() => {
    const free = numbers.filter((c) => !c.used && !c.bounced).map((c) => c.number);
    if (value.chequeNo && !free.includes(value.chequeNo)) free.unshift(value.chequeNo);
    return free;
  }, [numbers, value.chequeNo]);

  const pickMode = (m: SettlementMode) => {
    if (value.mode === m) return onChange(emptySettlement());
    // Keep the bank across bank-based modes; drop cheque/ref detail that no longer applies.
    onChange({
      ...emptySettlement(),
      mode: m,
      bankId: needsBank(m) ? value.bankId : "",
      chequeLotId: isChequeMode(m) ? value.chequeLotId : null,
      chequeNo: isChequeMode(m) ? value.chequeNo : "",
      chequeDate: isChequeMode(m) ? value.chequeDate : "",
      digitalRefNumber: isDigitalMode(m) ? value.digitalRefNumber : "",
    });
  };

  const expiry = (() => {
    if (!postDated || !value.chequeDate) return null;
    const d = new Date(value.chequeDate);
    const until = new Date(d);
    until.setMonth(until.getMonth() + 3);
    const fmt = (x: Date) => x.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
    return { from: fmt(d), until: fmt(until), expired: until < new Date() };
  })();

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-muted-foreground font-heading">
          <Wallet size={11} /> Payment Mode
        </p>
        {value.mode && (
          <button
            type="button"
            onClick={() => onChange(emptySettlement())}
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
          >
            <X size={11} /> Clear
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Payment mode">
        {SETTLEMENT_MODES.map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={value.mode === m}
            onClick={() => pickMode(m)}
            className={cn(
              "px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-all",
              value.mode === m
                ? "border-primary bg-primary/10 text-primary shadow-sm"
                : "border-border text-muted-foreground hover:bg-muted/40",
            )}
          >
            {m}
          </button>
        ))}
      </div>

      {needsBank(value.mode) && (
        <div className="rounded-xl border border-border bg-muted/10 p-3 space-y-3">
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-muted-foreground">
              Bank Account{cheque ? " *" : ""}
            </label>
            {!companySelected ? (
              <p className="text-xs text-muted-foreground">Select the company first to see its bank accounts.</p>
            ) : banks.length === 0 ? (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-600">
                <AlertTriangle size={12} /> No bank accounts are linked to this company.
              </div>
            ) : (
              <select
                aria-label="Bank account"
                value={value.bankId}
                onChange={(e) => set({ bankId: e.target.value, chequeLotId: null, chequeNo: "" })}
                className={fieldCls}
              >
                <option value="">— Select bank account —</option>
                {banks.map((b) => (
                  <option key={b.BId} value={String(b.BId)}>
                    {bankLabel(b)}
                  </option>
                ))}
              </select>
            )}
          </div>

          {cheque && value.bankId && (
            <>
              {loadingLots ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 size={13} className="animate-spin" /> Loading cheque lots…
                </div>
              ) : lots.length === 0 ? (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-600">
                  <AlertTriangle size={12} /> No active cheque lots found for this bank.
                </div>
              ) : (
                <div className="space-y-1.5">
                  <label className="text-[11px] font-medium text-muted-foreground flex items-center gap-1">
                    <BookOpen size={11} /> Cheque Lot *
                  </label>
                  <select
                    aria-label="Cheque lot"
                    value={value.chequeLotId ? String(value.chequeLotId) : ""}
                    onChange={(e) => set({ chequeLotId: e.target.value ? Number(e.target.value) : null, chequeNo: "" })}
                    className={cn(fieldCls, "font-mono")}
                  >
                    <option value="">— Select lot —</option>
                    {lots.map((l) => (
                      <option key={l.CId} value={String(l.CId)}>
                        {l.ChequeLotNumber}
                        {l.RemainingCheques != null ? `  (${l.RemainingCheques} remaining)` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {value.chequeLotId && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-medium text-muted-foreground flex items-center gap-1">
                      <Hash size={11} /> Cheque Number *
                    </label>
                    <select
                      aria-label="Cheque number"
                      value={value.chequeNo}
                      onChange={(e) => set({ chequeNo: e.target.value })}
                      disabled={loadingNumbers}
                      className={cn(fieldCls, "font-mono")}
                    >
                      <option value="">— Select cheque number —</option>
                      {available.map((n) => (
                        <option key={n} value={n}>
                          # {n}
                        </option>
                      ))}
                    </select>
                    {available.length === 0 && !loadingNumbers && (
                      <p className="text-[11px] text-amber-600 flex items-center gap-1">
                        <AlertTriangle size={10} /> No available cheques left in this lot.
                      </p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-medium text-muted-foreground flex items-center gap-1">
                      <CalendarDays size={11} /> {postDated ? "Post-Dated Cheque Date *" : "Cheque Date *"}
                    </label>
                    <input
                      type="date"
                      aria-label="Cheque date"
                      value={value.chequeDate}
                      min={postDated ? today() : undefined}
                      max={postDated ? undefined : today()}
                      onChange={(e) => set({ chequeDate: e.target.value })}
                      className={fieldCls}
                    />
                  </div>
                </div>
              )}

              {postDated && expiry && (
                <div
                  className={cn(
                    "flex items-start gap-2 px-3 py-2 rounded-lg border text-xs",
                    expiry.expired
                      ? "bg-red-500/5 border-red-500/30 text-red-600 dark:text-red-400"
                      : "bg-indigo-500/5 border-indigo-500/20 text-indigo-600 dark:text-indigo-400",
                  )}
                >
                  {expiry.expired ? <AlertTriangle size={13} className="shrink-0 mt-0.5" /> : <CalendarClock size={13} className="shrink-0 mt-0.5" />}
                  <span>
                    {expiry.expired
                      ? `Cheque dated ${expiry.from} expired on ${expiry.until}. Please obtain a new cheque.`
                      : `PDC scheduled for ${expiry.from} — valid until ${expiry.until}.`}
                  </span>
                </div>
              )}
              {postDated && !value.chequeDate && (
                <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-violet-500/5 border border-violet-500/20 text-xs text-violet-600 dark:text-violet-400">
                  <Info size={13} className="shrink-0 mt-0.5" />
                  <span>Post-dated cheques are generally valid for 3 months from the cheque date.</span>
                </div>
              )}
            </>
          )}

          {digital && (
            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-muted-foreground">
                {DIGITAL_REF_LABEL[value.mode] ?? "Reference Number"}
              </label>
              <Input
                className="h-9"
                value={value.digitalRefNumber}
                onChange={(e) => set({ digitalRefNumber: e.target.value })}
                placeholder={`Enter ${(DIGITAL_REF_LABEL[value.mode] ?? "reference number").toLowerCase()}…`}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
