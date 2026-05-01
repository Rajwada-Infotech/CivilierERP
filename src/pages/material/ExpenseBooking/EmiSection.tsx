import React, { useEffect } from "react";
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
} from "lucide-react";
import { Field } from "./FormPrimitives";
import { fmt, generateEmiSchedule } from "./helpers";
import type { EmiConfig } from "./types";
import { formatINR } from "@/utils/formatCurrency";

interface Props {
  emi: EmiConfig;
  netAmount: number;
  baseDocNo?: string;
  onChange: (emi: EmiConfig) => void;
}

export function EmiSection({
  emi,
  netAmount,
  baseDocNo = "",
  onChange,
}: Props) {
  // Regenerate schedule whenever key EMI params change
  useEffect(() => {
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
    onChange({ ...emi, enabled, schedule: enabled ? emi.schedule : [] });
  };

  const totalScheduled = emi.schedule.reduce((s, r) => s + r.amount, 0);
  const paidCount = emi.schedule.filter((r) => r.status === "Paid").length;
  const nextDue = emi.schedule.find((r) => r.status === "Pending");

  return (
    <div className="rounded-2xl border border-border overflow-hidden shadow-sm">
      {/* ── Header toggle ─────────────────────────────────────────────── */}
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
              <ToggleRight size={16} />
              EMI Active
            </>
          ) : (
            <>
              <ToggleLeft size={16} className="text-muted-foreground" />
              <span className="text-muted-foreground">EMI Off</span>
            </>
          )}
        </button>
      </div>

      {/* ── Config body ───────────────────────────────────────────────── */}
      {emi.enabled && (
        <div className="bg-card border-t border-border">
          {/* ── Stats summary (only when schedule exists) ─────────────── */}
          {emi.schedule.length > 0 && (
            <div className="grid grid-cols-3 divide-x divide-border border-b border-border">
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
                  Progress
                </span>
                <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
                  {paidCount}/{emi.schedule.length} paid
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

          {/* ── Input grid ───────────────────────────────────────────── */}
          <div className="p-5 space-y-5">
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

            {/* No amount warning */}
            {netAmount === 0 && (
              <div className="flex items-center gap-2.5 px-4 py-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400">
                <AlertCircle size={14} className="shrink-0" />
                <p className="text-xs">
                  Enter a basic amount above to generate the installment
                  schedule.
                </p>
              </div>
            )}

            {/* ── Schedule table ─────────────────────────────────────── */}
            {emi.schedule.length > 0 && (
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
                      {emi.schedule.map((row) => {
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

                  {/* Footer total */}
                  <div className="bg-muted/40 border-t border-border px-4 py-2.5 flex items-center justify-between">
                    <span className="text-[11px] text-muted-foreground font-heading">
                      {emi.schedule.length} installments · {paidCount} paid
                    </span>
                    <span className="font-mono text-sm font-bold text-foreground">
                      ₹{fmt(totalScheduled)}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
