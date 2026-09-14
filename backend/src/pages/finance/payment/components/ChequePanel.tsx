import React, { useState, useEffect } from "react";
import { toast } from "sonner";
import {
  BookOpen,
  AlertTriangle,
  Hash,
  CalendarDays,
  ChevronDown,
  Info,
  CalendarClock,
} from "lucide-react";
import { Field } from "./FormFields";
import { fetchChequeLots, fetchChequeNumbers, deductChequeFromLot } from "../api";
import type { PaymentRecord, ChequeLot } from "../types";

interface ChequePanelProps {
  bankId: number | null;
  form: Omit<PaymentRecord, "id">;
  set: <K extends keyof Omit<PaymentRecord, "id">>(
    field: K,
    value: Omit<PaymentRecord, "id">[K],
  ) => void;
  isPostDated: boolean;
}

export function ChequePanel({ bankId, form, set, isPostDated }: ChequePanelProps) {
  const [lots, setLots] = useState<ChequeLot[]>([]);
  const [loadingLots, setLoadingLots] = useState(false);
  const [chequeNumbers, setChequeNumbers] = useState<
    { number: string; used: boolean; bounced: boolean }[]
  >([]);
  const [loadingCheques, setLoadingCheques] = useState(false);
  const [validating, setValidating] = useState(false);

  // Fetch lots whenever bankId changes; auto-select the first active lot
  useEffect(() => {
    setLoadingLots(true);
    fetchChequeLots(bankId)
      .then((fetched) => {
        setLots(fetched);
        // Auto-select first lot if none already selected
        if (fetched.length > 0 && !form.chequeLotId) {
          const first = fetched[0];
          set("chequeLotId", first.CId);
          set("chequeLotNumber", first.ChequeLotNumber);
          set("chequeAccountNumber", first.AccountNumber || "");
          set("chequeIfsc", first.IFSCCode || "");
          set("chequeNo", "");
        } else if (form.chequeLotId && !form.chequeAccountNumber) {
          // A lot (and cheque number) was carried in from elsewhere — e.g. a
          // loan's own sanction entry — without its account/IFSC. Backfill
          // those once this bank's lots load, without touching the cheque
          // number itself.
          const matched = fetched.find((l) => l.CId === form.chequeLotId);
          if (matched) {
            set("chequeAccountNumber", matched.AccountNumber || "");
            set("chequeIfsc", matched.IFSCCode || "");
          }
        }
      })
      .catch(() => setLots([]))
      .finally(() => setLoadingLots(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bankId]);

  // Fetch available cheque numbers whenever lot changes
  useEffect(() => {
    if (!form.chequeLotId) {
      setChequeNumbers([]);
      return;
    }
    setLoadingCheques(true);
    fetchChequeNumbers(form.chequeLotId)
      .then(setChequeNumbers)
      .catch(() => setChequeNumbers([]))
      .finally(() => setLoadingCheques(false));
  }, [form.chequeLotId]);

  const activeLot = lots.find((l) => l.CId === form.chequeLotId) ?? null;
  // A cheque already carried in from elsewhere (e.g. auto-filled from a
  // loan's own sanction entry, which recorded — and consumed — this exact
  // cheque number at sanction time) must still show up as the selected
  // option even though it's no longer "available" in this lot, otherwise
  // the <select> silently renders blank despite form.chequeNo being set.
  const availableCheques = chequeNumbers.filter(
    (c) => (!c.used && !c.bounced) || c.number === form.chequeNo,
  );

  const handleChequeSelect = async (chequeNo: string) => {
    set("chequeNo", chequeNo);
    if (!chequeNo || !form.chequeLotId) return;
    setValidating(true);
    try {
      await deductChequeFromLot(form.chequeLotId, chequeNo);
      // validation passed — chequeNo is set, no further action needed
    } catch (err: any) {
      toast.error(err.message);
      set("chequeNo", "");
    } finally {
      setValidating(false);
    }
  };

  // When the user picks a different lot from the dropdown, update all lot-derived fields
  const handleLotSelect = (lotIdStr: string) => {
    const lotId = Number(lotIdStr);
    const lot = lots.find((l) => l.CId === lotId);
    if (!lot) return;
    set("chequeLotId", lot.CId);
    set("chequeLotNumber", lot.ChequeLotNumber);
    set("chequeAccountNumber", lot.AccountNumber || "");
    set("chequeIfsc", lot.IFSCCode || "");
    set("chequeNo", ""); // reset cheque number when lot changes
  };

  return (
    <div className="space-y-4">
      {/* Lot selector — dropdown when multiple lots exist, static chip when only one */}
      {!bankId ? null : loadingLots ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <div className="w-3.5 h-3.5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          Loading cheque lots…
        </div>
      ) : lots.length === 0 ? (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-600">
          <AlertTriangle size={12} />
          No active cheque lots found for this bank.
        </div>
      ) : lots.length === 1 ? (
        <>
          {/* Single lot — show as a static info chip (original behaviour) */}
          <div className="space-y-1.5">
            <label className="text-xs font-heading font-medium text-muted-foreground uppercase tracking-wider">
              Lot Number
            </label>
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/40 border border-border/60">
              <BookOpen size={13} className="text-primary shrink-0" />
              <span className="font-mono text-sm font-semibold text-foreground">
                {activeLot?.ChequeLotNumber ?? "—"}
              </span>
              {activeLot?.RemainingCheques != null && (
                <span className="ml-auto text-[11px] text-muted-foreground bg-primary/10 text-primary px-2 py-0.5 rounded-full font-heading">
                  {activeLot.RemainingCheques} remaining
                </span>
              )}
            </div>
          </div>

          {/* Lot detail panel */}
          {activeLot && (
            <div className="rounded-xl bg-blue-500/5 border border-blue-500/20 px-4 py-3 grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-heading">
                  Cheque Range
                </p>
                <p className="font-mono text-xs font-semibold text-foreground mt-0.5">
                  {activeLot.ChequeStartNumber} – {activeLot.ChequeEndNumber}
                </p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-heading">
                  Account No.
                </p>
                <p className="font-mono text-xs text-foreground mt-0.5">
                  {activeLot.AccountNumber || "—"}
                </p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-heading">
                  IFSC
                </p>
                <p className="font-mono text-xs text-foreground mt-0.5">
                  {activeLot.IFSCCode || "—"}
                </p>
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          {/* Multiple lots — show a selectable dropdown */}
          <div className="space-y-1.5">
            <label className="text-xs font-heading font-medium text-muted-foreground uppercase tracking-wider">
              Lot Number
            </label>
            <div className="relative">
              <BookOpen
                size={13}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
              />
              <select
                value={form.chequeLotId ? String(form.chequeLotId) : ""}
                onChange={(e) => handleLotSelect(e.target.value)}
                className="w-full appearance-none pl-8 pr-9 py-2 rounded-lg text-sm bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary font-mono"
              >
                <option value="">— Select lot —</option>
                {lots.map((lot) => (
                  <option key={lot.CId} value={String(lot.CId)}>
                    {lot.ChequeLotNumber}
                    {lot.RemainingCheques != null
                      ? `  (${lot.RemainingCheques} remaining)`
                      : ""}
                    {lot.AccountNumber ? `  · ${lot.AccountNumber}` : ""}
                  </option>
                ))}
              </select>
              <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground">
                <ChevronDown size={14} />
              </div>
            </div>
            {lots.length > 1 && (
              <p className="text-[11px] text-muted-foreground">
                {lots.length} lots available for this bank — select one to load
                its cheques.
              </p>
            )}
          </div>

          {/* Lot detail panel — shown once a lot is selected */}
          {activeLot && (
            <div className="rounded-xl bg-blue-500/5 border border-blue-500/20 px-4 py-3 grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-heading">
                  Cheque Range
                </p>
                <p className="font-mono text-xs font-semibold text-foreground mt-0.5">
                  {activeLot.ChequeStartNumber} – {activeLot.ChequeEndNumber}
                </p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-heading">
                  Account No.
                </p>
                <p className="font-mono text-xs text-foreground mt-0.5">
                  {activeLot.AccountNumber || "—"}
                </p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-heading">
                  IFSC
                </p>
                <p className="font-mono text-xs text-foreground mt-0.5">
                  {activeLot.IFSCCode || "—"}
                </p>
              </div>
            </div>
          )}
        </>
      )}

      {/* Cheque number dropdown — only show after bank+lot loaded */}
      {bankId && form.chequeLotId && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field
              label="Cheque Number"
              required
              hint="Select an available cheque from this lot"
            >
              <div className="relative">
                <Hash
                  size={13}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                />
                <select
                  value={form.chequeNo}
                  onChange={(e) => handleChequeSelect(e.target.value)}
                  disabled={loadingCheques || validating || !form.chequeLotId}
                  className="w-full appearance-none pl-8 pr-9 py-2 rounded-lg text-sm bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-60 font-mono"
                >
                  <option value="">— Select cheque number —</option>
                  {availableCheques.map((c) => (
                    <option key={c.number} value={c.number}>
                      # {c.number}
                    </option>
                  ))}
                </select>
                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground">
                  {loadingCheques || validating ? (
                    <div className="w-3.5 h-3.5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <ChevronDown size={14} />
                  )}
                </div>
              </div>
              {availableCheques.length === 0 &&
                form.chequeLotId &&
                !loadingCheques && (
                  <p className="text-[11px] text-amber-600 flex items-center gap-1 mt-1">
                    <AlertTriangle size={10} /> No available cheques left in
                    this lot.
                  </p>
                )}
            </Field>

            <Field
              label={isPostDated ? "Post-Dated Cheque Date" : "Cheque Date"}
              required={isPostDated}
              hint={
                isPostDated
                  ? "Must be a future date"
                  : "Backdate to when the cheque was issued — cannot be a future date"
              }
            >
              <div className="relative">
                <CalendarDays
                  size={13}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                />
                <input
                  type="date"
                  value={form.chequeDate}
                  min={isPostDated ? new Date().toISOString().slice(0, 10) : undefined}
                  max={isPostDated ? undefined : new Date().toISOString().slice(0, 10)}
                  onChange={(e) => set("chequeDate", e.target.value)}
                  className="w-full pl-8 pr-3 py-2 rounded-lg text-sm bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:cursor-pointer"
                />
              </div>
            </Field>
          </div>

          {isPostDated && (() => {
            const fmtDate = (d: Date) =>
              d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

            if (!form.chequeDate) {
              return (
                <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-violet-500/5 border border-violet-500/20 text-xs text-violet-600 dark:text-violet-400">
                  <Info size={13} className="shrink-0 mt-0.5" />
                  <span>Post-dated cheques are generally valid for <strong>3 months</strong> from the cheque date. Select a date to see the validity window.</span>
                </div>
              );
            }

            const chequeD = new Date(form.chequeDate);
            const validUntil = new Date(chequeD);
            validUntil.setMonth(validUntil.getMonth() + 3);
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const isExpired = validUntil < today;

            if (isExpired) {
              return (
                <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-red-500/8 border border-red-500/30 text-xs text-red-600 dark:text-red-400">
                  <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                  <div className="space-y-0.5">
                    <p className="font-semibold">Cheque validity expired</p>
                    <p>This cheque (dated {fmtDate(chequeD)}) expired on <strong>{fmtDate(validUntil)}</strong> and can no longer be deposited. Please obtain a new cheque.</p>
                  </div>
                </div>
              );
            }

            return (
              <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-indigo-500/5 border border-indigo-500/20 text-xs text-indigo-600 dark:text-indigo-400">
                <CalendarClock size={13} className="shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <p className="font-semibold">PDC scheduled for {fmtDate(chequeD)}</p>
                  <p>Valid until <strong>{fmtDate(validUntil)}</strong> · Please ensure it is deposited before this date.</p>
                </div>
              </div>
            );
          })()}
        </>
      )}
    </div>
  );
}
