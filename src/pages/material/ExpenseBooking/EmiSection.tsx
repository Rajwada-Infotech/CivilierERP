import React, { useEffect } from "react";
import { Input } from "@/components/ui/input";
import { CalendarDays, CreditCard, ToggleLeft, ToggleRight } from "lucide-react";
import { Field } from "./FormPrimitives";
import { fmt, generateEmiSchedule } from "./helpers";
import type { EmiConfig } from "./types";

interface Props {
  emi: EmiConfig;
  netAmount: number;
  onChange: (emi: EmiConfig) => void;
}

export function EmiSection({ emi, netAmount, onChange }: Props) {
  // Regenerate schedule whenever key EMI params change
  useEffect(() => {
    if (!emi.enabled || !emi.installmentCount || !emi.startDate) return;
    const schedule = generateEmiSchedule(
      netAmount,
      emi.installmentCount,
      emi.startDate,
    );
    const perInstallment =
      emi.installmentCount > 0
        ? Math.round((netAmount / emi.installmentCount) * 100) / 100
        : 0;
    onChange({ ...emi, emiAmount: perInstallment, schedule });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emi.enabled, emi.installmentCount, emi.startDate, netAmount]);

  const toggle = (enabled: boolean) => {
    onChange({ ...emi, enabled, schedule: enabled ? emi.schedule : [] });
  };

  return (
    <div className="rounded-xl border border-border overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-4 py-3.5 bg-muted/40">
        <div className="flex items-center gap-2.5">
          <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-primary/10 shrink-0">
            <CreditCard size={14} className="text-primary" />
          </div>
          <div>
            <p className="text-sm font-heading font-semibold text-foreground">
              EMI / Installment Payment
            </p>
            <p className="text-[11px] text-muted-foreground">
              {emi.enabled
                ? `${emi.installmentCount} installments of Rs.${fmt(emi.emiAmount)} each`
                : "One-time payment"}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => toggle(!emi.enabled)}
          className="flex items-center gap-1.5 text-xs font-medium transition-colors"
        >
          {emi.enabled ? (
            <>
              <ToggleRight size={18} className="text-primary" />
              <span className="text-primary">EMI On</span>
            </>
          ) : (
            <>
              <ToggleLeft size={18} className="text-muted-foreground" />
              <span className="text-muted-foreground">EMI Off</span>
            </>
          )}
        </button>
      </div>

      {/* Body */}
      {emi.enabled && (
        <div className="border-t border-border bg-card p-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Field label="Installment Count" required>
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
            <Field label="EMI Amount (per installment)">
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">
                  Rs.
                </span>
                <Input
                  type="number"
                  min={0}
                  value={emi.emiAmount || ""}
                  readOnly
                  className="pl-9 bg-muted/30"
                  placeholder="Auto-calculated"
                />
              </div>
            </Field>
            <Field label="EMI Start Date" required>
              <Input
                type="date"
                value={emi.startDate}
                onChange={(e) => onChange({ ...emi, startDate: e.target.value })}
              />
            </Field>
          </div>

          {/* Payment Schedule Table */}
          {emi.schedule.length > 0 && (
            <div>
              <p className="text-[11px] font-heading uppercase tracking-wider text-muted-foreground mb-2">
                Payment Schedule
              </p>
              <div className="rounded-lg border border-border overflow-hidden text-xs">
                <table className="w-full">
                  <thead>
                    <tr className="bg-muted/40 border-b border-border">
                      <th className="px-3 py-2 text-left font-heading text-muted-foreground">
                        #
                      </th>
                      <th className="px-3 py-2 text-left font-heading text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <CalendarDays size={11} />
                          Due Date
                        </span>
                      </th>
                      <th className="px-3 py-2 text-right font-heading text-muted-foreground">
                        Amount
                      </th>
                      <th className="px-3 py-2 text-left font-heading text-muted-foreground">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {emi.schedule.map((row) => (
                      <tr
                        key={row.installmentNo}
                        className="bg-background hover:bg-muted/20 transition-colors"
                      >
                        <td className="px-3 py-2 font-mono text-muted-foreground">
                          {row.installmentNo}
                        </td>
                        <td className="px-3 py-2 font-mono">{row.dueDate}</td>
                        <td className="px-3 py-2 font-mono text-right font-semibold">
                          Rs.{fmt(row.amount)}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={
                              "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-heading border " +
                              (row.status === "Paid"
                                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                : "bg-amber-50 text-amber-700 border-amber-200")
                            }
                          >
                            {row.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1.5">
                Total across {emi.schedule.length} installments:{" "}
                <span className="font-mono font-semibold text-foreground">
                  Rs.
                  {fmt(emi.schedule.reduce((s, r) => s + r.amount, 0))}
                </span>
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
