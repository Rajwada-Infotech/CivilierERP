import React, { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import {
  CalendarDays,
  CreditCard,
  ToggleLeft,
  ToggleRight,
  Hash,
  CheckCircle2,
  Clock3,
  Banknote,
  AlertCircle,
  Loader2,
  AlertTriangle,
  X,
} from "lucide-react";
import { Field } from "./FormPrimitives";
import { fmt, generateEmiSchedule } from "./helpers";
import type { EmiConfig, EmiScheduleRow } from "./types";

interface Props {
  emi: EmiConfig;
  netAmount: number;
  baseDocNo?: string;
  onChange: (emi: EmiConfig) => void;
  liveSchedule?: EmiScheduleRow[] | null;
  loadingEmi?: boolean;
  /** Called when user confirms disabling EMI in edit mode */
  onDisableEmi?: () => Promise<void>;
}

// ─── Disable-EMI Confirmation Dialog ─────────────────────────────────────────

interface DisableDialogProps {
  paidCount: number;
  unpaidCount: number;
  remainingAmount: number;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}

function DisableDialog({
  paidCount,
  unpaidCount,
  remainingAmount,
  onConfirm,
  onClose,
}: DisableDialogProps) {
  const [disabling, setDisabling] = useState(false);

  const handle = async () => {
    setDisabling(true);
    try {
      await onConfirm();
      onClose();
    } finally {
      setDisabling(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-2xl shadow-2xl p-6 w-full max-w-sm mx-4">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-rose-500/10 border border-rose-500/20 shrink-0">
              <AlertTriangle size={18} className="text-rose-500" />
            </div>
            <div>
              <p className="text-sm font-heading font-semibold text-foreground">
                Disable EMI?
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                This cannot be undone easily
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors mt-0.5"
          >
            <X size={16} />
          </button>
        </div>

        <div className="rounded-xl border border-border bg-muted/30 p-4 mb-5 space-y-2 text-sm">
          {paidCount > 0 && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Already paid</span>
              <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                {paidCount} installment{paidCount !== 1 ? "s" : ""}
              </span>
            </div>
          )}
          {unpaidCount > 0 && (
            <>
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  Unpaid installments
                </span>
                <span className="font-semibold text-rose-500">
                  {unpaidCount} will be removed
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Remaining amount</span>
                <span className="font-mono font-semibold text-foreground">
                  ₹{fmt(remainingAmount)}
                </span>
              </div>
            </>
          )}
          {unpaidCount === 0 && (
            <p className="text-xs text-muted-foreground">
              All installments have been paid. EMI can be safely disabled.
            </p>
          )}
        </div>

        {unpaidCount > 0 && (
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400 text-xs mb-4">
            <AlertCircle size={13} className="shrink-0 mt-0.5" />
            Unpaid installment refs will be removed from the Payment page
            dropdown.
          </div>
        )}

        <div className="flex gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={disabling}
            className="flex-1 px-4 py-2 rounded-xl border border-border text-sm font-medium hover:bg-muted/50 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handle}
            disabled={disabling}
            className="flex-1 px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {disabling ? (
              <>
                <Loader2 size={14} className="animate-spin" /> Disabling&hellip;
              </>
            ) : (
              "Disable EMI"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── EmiSection ───────────────────────────────────────────────────────────────

export function EmiSection({
  emi,
  netAmount,
  baseDocNo = "",
  onChange,
  liveSchedule,
  loadingEmi = false,
  onDisableEmi,
}: Props) {
  const [showDisableDialog, setShowDisableDialog] = useState(false);

  // Regenerate schedule in create mode only
  useEffect(() => {
    if (liveSchedule != null) return;
    if (!emi.enabled || !emi.installmentCount || !emi.startDate) return;
    const schedule = generateEmiSchedule(
      netAmount,
      emi.installmentCount,
      emi.startDate,
      baseDocNo,
    );
    const perInstallment =
      emi.installmentCount > 0
        ? Math.round((netAmount / emi.installmentCount) * 100) / 100
        : 0;
    onChange({ ...emi, emiAmount: perInstallment, schedule });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emi.enabled, emi.installmentCount, emi.startDate, netAmount, baseDocNo]);

  const toggle = (enabled: boolean) => {
    if (!enabled && liveSchedule != null) {
      // Edit mode: show confirmation before disabling
      setShowDisableDialog(true);
      return;
    }
    onChange({ ...emi, enabled, schedule: enabled ? emi.schedule : [] });
  };

  const displaySchedule: EmiScheduleRow[] =
    liveSchedule != null ? liveSchedule : (emi.schedule ?? []);

  const totalScheduled = displaySchedule.reduce((s, r) => s + r.amount, 0);
  const paidCount = displaySchedule.filter((r) => r.status === "Paid").length;
  const unpaidCount = displaySchedule.filter((r) => r.status !== "Paid").length;
  const paidAmount = displaySchedule
    .filter((r) => r.status === "Paid")
    .reduce((s, r) => s + r.amount, 0);
  const remainingAmount = totalScheduled - paidAmount;
  const nextDue = displaySchedule.find((r) => r.status === "Pending");
  const isEditMode = liveSchedule != null;
  const allPaid = displaySchedule.length > 0 && unpaidCount === 0;

  return (
    <>
      {showDisableDialog && (
        <DisableDialog
          paidCount={paidCount}
          unpaidCount={unpaidCount}
          remainingAmount={remainingAmount}
          onConfirm={async () => {
            if (onDisableEmi) await onDisableEmi();
            onChange({ ...emi, enabled: false, schedule: [] });
          }}
          onClose={() => setShowDisableDialog(false)}
        />
      )}

      <div className="rounded-2xl border border-border overflow-hidden shadow-sm">
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 bg-gradient-to-r from-muted/60 to-muted/20">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-violet-500/10 border border-violet-500/20 shrink-0">
              <CreditCard
                size={16}
                className="text-violet-600 dark:text-violet-400"
              />
            </div>
            <div>
              <p className="text-sm font-heading font-semibold text-foreground">
                EMI / Installment Payment
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {emi.enabled
                  ? emi.installmentCount > 0
                    ? `${emi.installmentCount} installments · ₹${fmt(emi.emiAmount)}/mo`
                    : "Configure installments below"
                  : "Split payment into monthly installments"}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => toggle(!emi.enabled)}
            className="flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-lg border transition-all"
            style={
              emi.enabled
                ? {
                    background: "rgba(139,92,246,0.1)",
                    borderColor: "rgba(139,92,246,0.3)",
                    color: "rgb(139,92,246)",
                  }
                : {}
            }
          >
            {emi.enabled ? (
              <>
                <ToggleRight size={16} /> EMI Active
              </>
            ) : (
              <>
                <ToggleLeft size={16} className="text-muted-foreground" />
                <span className="text-muted-foreground">EMI Off</span>
              </>
            )}
          </button>
        </div>

        {/* ── Body ───────────────────────────────────────────────────────── */}
        {emi.enabled && (
          <div className="bg-card border-t border-border">
            {/* Stats bar */}
            {displaySchedule.length > 0 && (
              <div className="grid grid-cols-4 divide-x divide-border border-b border-border">
                <div className="px-4 py-3 flex flex-col gap-0.5">
                  <span className="text-[10px] uppercase tracking-widest font-heading text-muted-foreground">
                    Total
                  </span>
                  <span className="text-sm font-bold font-mono text-foreground">
                    ₹{fmt(totalScheduled)}
                  </span>
                </div>
                <div className="px-4 py-3 flex flex-col gap-0.5">
                  <span className="text-[10px] uppercase tracking-widest font-heading text-muted-foreground">
                    Paid
                  </span>
                  <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
                    {paidCount}/{displaySchedule.length}
                    {paidAmount > 0 && (
                      <span className="font-mono text-[11px] ml-1">
                        (₹{fmt(paidAmount)})
                      </span>
                    )}
                  </span>
                </div>
                <div className="px-4 py-3 flex flex-col gap-0.5">
                  <span className="text-[10px] uppercase tracking-widest font-heading text-muted-foreground">
                    Remaining
                  </span>
                  <span
                    className={`text-sm font-bold font-mono ${allPaid ? "text-emerald-600 dark:text-emerald-400" : "text-rose-500 dark:text-rose-400"}`}
                  >
                    {allPaid ? "Fully Paid" : `₹${fmt(remainingAmount)}`}
                  </span>
                </div>
                <div className="px-4 py-3 flex flex-col gap-0.5">
                  <span className="text-[10px] uppercase tracking-widest font-heading text-muted-foreground">
                    Next Due
                  </span>
                  <span className="text-sm font-bold text-amber-600 dark:text-amber-400">
                    {nextDue ? nextDue.dueDate : "—"}
                  </span>
                </div>
              </div>
            )}

            <div className="p-5 space-y-5">
              {/* Input grid — create mode */}
              {!isEditMode && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <Field label="Number of Installments" required>
                    <Input
                      type="number"
                      min={1}
                      max={120}
                      value={emi.installmentCount || ""}
                      onChange={(e) =>
                        onChange({
                          ...emi,
                          installmentCount: parseInt(e.target.value) || 0,
                        })
                      }
                      placeholder="e.g. 12"
                    />
                  </Field>
                  <Field label="Per Installment">
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs font-semibold">
                        ₹
                      </span>
                      <Input
                        type="number"
                        value={emi.emiAmount || ""}
                        readOnly
                        className="pl-7 bg-muted/30 font-mono cursor-not-allowed"
                        placeholder="Auto-calculated"
                      />
                    </div>
                  </Field>
                  <Field label="First Due Date" required>
                    <Input
                      type="date"
                      value={emi.startDate}
                      onChange={(e) =>
                        onChange({ ...emi, startDate: e.target.value })
                      }
                    />
                  </Field>
                </div>
              )}

              {/* Read-only pills — edit mode */}
              {isEditMode && (
                <div className="flex flex-wrap gap-3 text-xs">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-muted/60 border border-border text-muted-foreground">
                    <Hash size={11} />
                    <span className="font-semibold text-foreground">
                      {emi.installmentCount}
                    </span>
                    &nbsp;installments
                  </span>
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-muted/60 border border-border text-muted-foreground">
                    <Banknote size={11} />₹
                    <span className="font-mono font-semibold text-foreground">
                      {fmt(emi.emiAmount)}
                    </span>
                    /mo
                  </span>
                  {emi.startDate && (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-muted/60 border border-border text-muted-foreground">
                      <CalendarDays size={11} />
                      First due:&nbsp;
                      <span className="font-mono font-semibold text-foreground">
                        {emi.startDate}
                      </span>
                    </span>
                  )}
                </div>
              )}

              {/* No amount warning */}
              {netAmount === 0 && !isEditMode && (
                <div className="flex items-center gap-2.5 px-4 py-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400">
                  <AlertCircle size={14} className="shrink-0" />
                  <p className="text-xs">
                    Enter a basic amount above to generate the installment
                    schedule.
                  </p>
                </div>
              )}

              {/* Payment page hint */}
              {isEditMode && displaySchedule.length > 0 && (
                <div className="flex items-start gap-2.5 px-4 py-3 rounded-xl bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800 text-violet-700 dark:text-violet-400 text-xs">
                  <Hash size={12} className="shrink-0 mt-0.5" />
                  Each installment reference below appears as a separate option
                  in the Payment page. Select the installment ref there to
                  record payment against it.
                </div>
              )}

              {/* Schedule table */}
              {loadingEmi ? (
                <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground text-sm">
                  <Loader2 size={16} className="animate-spin" />
                  Loading installment schedule&hellip;
                </div>
              ) : displaySchedule.length > 0 ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] font-heading uppercase tracking-wider text-muted-foreground">
                      Installment Schedule
                    </p>
                    {baseDocNo && (
                      <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                        <Hash size={9} />
                        Refs linked to{" "}
                        <span className="font-mono font-semibold text-primary">
                          {baseDocNo}
                        </span>
                      </span>
                    )}
                  </div>

                  <div className="rounded-xl border border-border overflow-hidden">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-muted/50 border-b border-border">
                          <th className="px-3 py-2.5 text-left font-heading text-[10px] uppercase tracking-wider text-muted-foreground w-8">
                            #
                          </th>
                          <th className="px-3 py-2.5 text-left font-heading text-[10px] uppercase tracking-wider text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <Hash size={9} />
                              Reference
                            </span>
                          </th>
                          <th className="px-3 py-2.5 text-left font-heading text-[10px] uppercase tracking-wider text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <CalendarDays size={9} />
                              Due Date
                            </span>
                          </th>
                          <th className="px-3 py-2.5 text-right font-heading text-[10px] uppercase tracking-wider text-muted-foreground">
                            <span className="flex items-center gap-1 justify-end">
                              <Banknote size={9} />
                              Amount
                            </span>
                          </th>
                          <th className="px-3 py-2.5 text-left font-heading text-[10px] uppercase tracking-wider text-muted-foreground hidden sm:table-cell">
                            Status
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/50">
                        {displaySchedule.map((row) => {
                          const isPaid = row.status === "Paid";
                          const isNext =
                            !isPaid && row.installmentNo === paidCount + 1;
                          return (
                            <tr
                              key={row.installmentNo}
                              className={`transition-colors ${
                                isPaid
                                  ? "bg-emerald-50/40 dark:bg-emerald-900/10"
                                  : isNext
                                    ? "bg-amber-50/40 dark:bg-amber-900/10"
                                    : "bg-background hover:bg-muted/20"
                              }`}
                            >
                              <td className="px-3 py-2.5 font-mono text-muted-foreground font-semibold">
                                {row.installmentNo}
                              </td>
                              <td className="px-3 py-2.5">
                                <span className="font-mono text-[11px] bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-400 border border-violet-200 dark:border-violet-800 px-2 py-0.5 rounded-md">
                                  {row.refNumber ||
                                    `EMI-${String(row.installmentNo).padStart(2, "0")}`}
                                </span>
                              </td>
                              <td className="px-3 py-2.5 font-mono text-foreground">
                                {row.dueDate}
                              </td>
                              <td className="px-3 py-2.5 font-mono text-right font-semibold text-foreground">
                                ₹{fmt(row.amount)}
                              </td>
                              <td className="px-3 py-2.5 hidden sm:table-cell">
                                {isPaid ? (
                                  <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-heading font-semibold bg-emerald-100 text-emerald-700 border border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-700">
                                    <CheckCircle2 size={9} />
                                    Paid
                                  </span>
                                ) : isNext ? (
                                  <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-heading font-semibold bg-amber-100 text-amber-700 border border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-700">
                                    <Clock3 size={9} />
                                    Next Due
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-heading bg-muted text-muted-foreground border border-border">
                                    <Clock3 size={9} />
                                    Pending
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>

                    <div className="bg-muted/40 border-t border-border px-4 py-2.5 flex items-center justify-between">
                      <span className="text-[11px] text-muted-foreground font-heading">
                        {displaySchedule.length} installments · {paidCount} paid
                        {remainingAmount > 0 && !allPaid && (
                          <span className="ml-2 text-rose-500">
                            · ₹{fmt(remainingAmount)} remaining
                          </span>
                        )}
                      </span>
                      <span className="font-mono text-sm font-bold text-foreground">
                        ₹{fmt(totalScheduled)}
                      </span>
                    </div>
                  </div>
                </div>
              ) : isEditMode ? (
                <div className="flex items-center gap-2.5 px-4 py-3 rounded-xl bg-muted/30 border border-border text-muted-foreground text-xs">
                  <AlertCircle size={13} className="shrink-0" />
                  No installment rows found in the database for this booking.
                </div>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
