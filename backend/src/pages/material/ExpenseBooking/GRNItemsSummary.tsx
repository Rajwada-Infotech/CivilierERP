import { Truck } from "lucide-react";
import { SectionHeader } from "./PickerPrimitives";
import { fmt, fmtQty } from "./helpers";
import type { GRNItemLine } from "./types";

interface GRNItemsSummaryProps {
  grnItemsLoading: boolean;
  grnItems: GRNItemLine[] | undefined;
  gstBreakdown: {
    items: GRNItemLine[];
    totals: {
      totalBase: number;
      totalCGST: number;
      totalSGST: number;
      totalGST: number;
      totalInclGST: number;
    };
  } | null;
}

export function GRNItemsSummary({
  grnItemsLoading,
  grnItems,
  gstBreakdown,
}: GRNItemsSummaryProps) {
  return (
                <div className="space-y-3">
                  <SectionHeader label="GRN Items Summary" />
                  {grnItemsLoading ? (
                    <div className="rounded-xl border border-teal-500/25 bg-teal-500/5 px-4 py-6 flex items-center justify-center gap-2 text-xs text-muted-foreground">
                      <div className="w-3.5 h-3.5 rounded-full border-2 border-teal-400 border-t-transparent animate-spin shrink-0" />
                      <span>Loading GRN items…</span>
                    </div>
                  ) : !grnItems ||
                    grnItems.length === 0 ? (
                    <div className="rounded-xl border border-teal-500/25 bg-teal-500/5 px-4 py-6 flex items-center justify-center gap-2 text-xs text-muted-foreground">
                      <Truck size={13} className="text-teal-400 shrink-0" />
                      <span>No items recorded against this GRN.</span>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {/* Per-item breakdown table */}
                      <div className="rounded-xl border border-teal-500/25 bg-teal-500/5 overflow-hidden">
                        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-teal-500/20 bg-teal-500/8">
                          <Truck size={12} className="text-teal-500 shrink-0" />
                          <span className="text-xs font-heading font-semibold text-teal-600 dark:text-teal-400">
                            Items received against this GRN
                          </span>
                          <span className="ml-auto text-[10px] text-muted-foreground">
                            {grnItems!.length}{" "}
                            {grnItems!.length === 1
                              ? "item"
                              : "items"}
                          </span>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs" style={{ minWidth: 720 }}>
                            <thead>
                              <tr className="bg-muted/20 border-b border-teal-500/15">
                                <th className="px-3 py-2.5 text-left font-heading uppercase tracking-wider text-muted-foreground text-[10px]">
                                  Item
                                </th>
                                <th className="px-3 py-2.5 text-left font-heading uppercase tracking-wider text-muted-foreground text-[10px] hidden sm:table-cell">
                                  HSN
                                </th>
                                <th className="px-3 py-2.5 text-right font-heading uppercase tracking-wider text-emerald-600 dark:text-emerald-400 text-[10px]">
                                  Rcvd Qty
                                </th>
                                <th className="px-3 py-2.5 text-left font-heading uppercase tracking-wider text-muted-foreground text-[10px] hidden sm:table-cell">
                                  UOM
                                </th>
                                <th className="px-3 py-2.5 text-right font-heading uppercase tracking-wider text-muted-foreground text-[10px] hidden sm:table-cell">
                                  Rate (₹)
                                </th>
                                <th className="px-3 py-2.5 text-right font-heading uppercase tracking-wider text-muted-foreground text-[10px]">
                                  Incl. GST (₹)
                                </th>
                                <th className="px-3 py-2.5 text-right font-heading uppercase tracking-wider text-emerald-600 dark:text-emerald-400 text-[10px]">
                                  Base (₹)
                                </th>
                                <th className="px-3 py-2.5 text-right font-heading uppercase tracking-wider text-violet-600 dark:text-violet-400 text-[10px] hidden md:table-cell">
                                  CGST
                                </th>
                                <th className="px-3 py-2.5 text-right font-heading uppercase tracking-wider text-violet-600 dark:text-violet-400 text-[10px] hidden md:table-cell">
                                  SGST
                                </th>
                                <th className="px-3 py-2.5 text-right font-heading uppercase tracking-wider text-orange-600 dark:text-orange-400 text-[10px]">
                                  GST (₹)
                                </th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-teal-500/10">
                              {(() => {
                                const bdItems = gstBreakdown?.items;
                                const rows =
                                  bdItems && bdItems.length > 0
                                    ? bdItems
                                    : grnItems!.map((it) => ({
                                        ...it,
                                        totalAmountInclGST:
                                          Number(it.totalAmount) > 0
                                            ? Number(it.totalAmount)
                                            : Number(it.rate || 0) *
                                              Number(
                                                it.receivedQty ||
                                                  it.quantity ||
                                                  0,
                                              ),
                                      }));
                                return rows.map((item, idx) => (
                                  <tr
                                    key={idx}
                                    className="hover:bg-teal-500/5 transition-colors"
                                  >
                                    <td className="px-3 py-2.5 font-medium text-foreground max-w-[160px] truncate">
                                      {item.itemName || `Item ${idx + 1}`}
                                    </td>
                                    <td className="px-3 py-2.5 text-muted-foreground font-mono text-[10px] hidden sm:table-cell">
                                      {item.hsnCode || "—"}
                                    </td>
                                    <td className="px-3 py-2.5 text-right font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                                      {fmtQty(Number(item.receivedQty) || 0)}
                                    </td>
                                    <td className="px-3 py-2.5 text-muted-foreground hidden sm:table-cell">
                                      {item.uom || "—"}
                                    </td>
                                    <td className="px-3 py-2.5 text-right font-mono text-muted-foreground hidden sm:table-cell">
                                      {Number(item.rate || 0) > 0
                                        ? `₹${fmt(Number(item.rate))}`
                                        : "—"}
                                    </td>
                                    <td className="px-3 py-2.5 text-right font-mono font-semibold text-foreground">
                                      {Number(item.totalAmountInclGST) > 0
                                        ? `₹${fmt(Number(item.totalAmountInclGST))}`
                                        : "—"}
                                    </td>
                                    <td className="px-3 py-2.5 text-right font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                                      {item.baseAmount != null
                                        ? `₹${fmt(item.baseAmount)}`
                                        : "—"}
                                    </td>
                                    <td className="px-3 py-2.5 text-right font-mono text-violet-600 dark:text-violet-400 hidden md:table-cell">
                                      {item.cgstRate != null &&
                                      item.cgstAmount != null ? (
                                        <span className="flex flex-col items-end gap-0.5">
                                          <span className="text-[10px] text-muted-foreground">
                                            {item.cgstRate}%
                                          </span>
                                          <span>₹{fmt(item.cgstAmount)}</span>
                                        </span>
                                      ) : (
                                        "—"
                                      )}
                                    </td>
                                    <td className="px-3 py-2.5 text-right font-mono text-violet-600 dark:text-violet-400 hidden md:table-cell">
                                      {item.sgstRate != null &&
                                      item.sgstAmount != null ? (
                                        <span className="flex flex-col items-end gap-0.5">
                                          <span className="text-[10px] text-muted-foreground">
                                            {item.sgstRate}%
                                          </span>
                                          <span>₹{fmt(item.sgstAmount)}</span>
                                        </span>
                                      ) : (
                                        "—"
                                      )}
                                    </td>
                                    <td className="px-3 py-2.5 text-right font-mono font-semibold text-orange-600 dark:text-orange-400">
                                      {item.gstAmount != null
                                        ? `₹${fmt(item.gstAmount)}`
                                        : "—"}
                                    </td>
                                  </tr>
                                ));
                              })()}
                            </tbody>
                            <tfoot className="border-t-2 border-teal-500/30 bg-muted/15">
                              <tr>
                                <td
                                  colSpan={5}
                                  className="px-3 py-2.5 text-[10px] font-heading uppercase tracking-wider text-muted-foreground"
                                >
                                  Totals
                                </td>
                                <td className="px-3 py-2.5 text-right font-mono text-xs font-bold text-foreground">
                                  ₹
                                  {fmt(
                                    gstBreakdown?.totals.totalInclGST ??
                                      grnItems!.reduce(
                                        (s, i) =>
                                          s +
                                          (Number(i.totalAmountInclGST) ||
                                            Number(i.totalAmount) ||
                                            0),
                                        0,
                                      ),
                                  )}
                                </td>
                                <td className="px-3 py-2.5 text-right font-mono text-xs font-bold text-emerald-600 dark:text-emerald-400">
                                  {gstBreakdown
                                    ? `₹${fmt(gstBreakdown.totals.totalBase)}`
                                    : "—"}
                                </td>
                                <td className="px-3 py-2.5 text-right font-mono text-xs font-bold text-violet-600 dark:text-violet-400">
                                  {gstBreakdown
                                    ? `₹${fmt(gstBreakdown.totals.totalCGST)}`
                                    : "—"}
                                </td>
                                <td className="px-3 py-2.5 text-right font-mono text-xs font-bold text-violet-600 dark:text-violet-400">
                                  {gstBreakdown
                                    ? `₹${fmt(gstBreakdown.totals.totalSGST)}`
                                    : "—"}
                                </td>
                                <td className="px-3 py-2.5 text-right font-mono text-xs font-bold text-orange-600 dark:text-orange-400">
                                  {gstBreakdown
                                    ? `₹${fmt(gstBreakdown.totals.totalGST)}`
                                    : "—"}
                                </td>
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      </div>

                      {/* GST Summary Cards + Equation */}
                      {gstBreakdown && gstBreakdown.totals.totalInclGST > 0 && (
                        <>
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                            {[
                              {
                                label: "Base Amount",
                                value: gstBreakdown.totals.totalBase,
                                cls: "border-emerald-500/30 bg-emerald-500/[0.05] text-emerald-700 dark:text-emerald-300",
                              },
                              {
                                label: "CGST",
                                value: gstBreakdown.totals.totalCGST,
                                cls: "border-violet-500/30 bg-violet-500/5 text-violet-700 dark:text-violet-300",
                              },
                              {
                                label: "SGST",
                                value: gstBreakdown.totals.totalSGST,
                                cls: "border-violet-500/30 bg-violet-500/5 text-violet-700 dark:text-violet-300",
                              },
                              {
                                label: "Total GST",
                                value: gstBreakdown.totals.totalGST,
                                cls: "border-orange-500/30 bg-orange-500/5 text-orange-700 dark:text-orange-300",
                              },
                            ].map(({ label, value, cls }) => (
                              <div
                                key={label}
                                className={`rounded-lg border px-3 py-2 ${cls}`}
                              >
                                <div className="text-[10px] font-heading uppercase tracking-wider opacity-70">
                                  {label}
                                </div>
                                <div className="text-sm font-mono font-bold mt-1">
                                  ₹{fmt(value)}
                                </div>
                              </div>
                            ))}
                          </div>

                          <div className="px-4 py-2.5 bg-muted/10 border-t border-emerald-500/10 flex flex-wrap items-center gap-1.5 text-[11px] font-mono mt-3">
                            <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                              ₹{fmt(gstBreakdown.totals.totalBase)}
                            </span>
                            <span className="text-muted-foreground">
                              (base)
                            </span>
                            <span className="text-muted-foreground">+</span>
                            <span className="text-violet-600 dark:text-violet-400 font-semibold">
                              ₹{fmt(gstBreakdown.totals.totalCGST)}
                            </span>
                            <span className="text-muted-foreground">
                              (CGST)
                            </span>
                            <span className="text-muted-foreground">+</span>
                            <span className="text-violet-600 dark:text-violet-400 font-semibold">
                              ₹{fmt(gstBreakdown.totals.totalSGST)}
                            </span>
                            <span className="text-muted-foreground">
                              (SGST)
                            </span>
                            <span className="text-muted-foreground">=</span>
                            <span className="text-foreground font-bold">
                              ₹{fmt(gstBreakdown.totals.totalInclGST)}
                            </span>
                            <span className="text-muted-foreground">
                              (incl. GST)
                            </span>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
  );
}
