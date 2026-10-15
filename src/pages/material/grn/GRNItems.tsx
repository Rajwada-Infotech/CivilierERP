import { Package, AlertCircle, Lock } from "lucide-react";
import { type UOM } from "@/api/grnApi";
import { fmt, fmtQty, inp, SectionCard, SectionTitle } from "./config";
import type { GRNState } from "./useGRN";

// The PO lines: ordered, already received, received now, quality and brand.
export function GRNItems({ m }: { m: GRNState }) {
  const { formData, errors, grnTotalWithGST, updateItemField, updateReceivedQty } = m;
  return (
    <>
      {/* ── Section 3: Items Table ── */}
      <SectionCard>
        <SectionTitle
          icon={Package}
          label="Received Items"
          sub={
            formData.poId
              ? `${formData.items.length} item${formData.items.length !== 1 ? "s" : ""} from PO`
              : "Select a PO above"
          }
        />

        {errors.items && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs">
            <AlertCircle size={12} />
            {errors.items}
          </div>
        )}

        {/* Mobile cards */}
        <div className="md:hidden space-y-3">
          {!formData.poId ? (
            <div className="border-2 border-dashed border-border rounded-xl py-10 text-center text-muted-foreground/40 text-sm italic">
              Select a Purchase Order above
            </div>
          ) : (
            formData.items.map((item, idx) => (
              <div
                key={idx}
                className="border border-border rounded-xl p-4 space-y-3 bg-muted/20"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-sm truncate">
                    {item.itemName || "—"}
                  </span>
                  <span className="shrink-0 text-[0.625rem] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                    {item.uom || "—"}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  {[
                    ["Ordered", String(item.orderedQty), ""],
                    [
                      "Pending Qty",
                      fmtQty(item.remainingQty),
                      item.remainingQty > 0
                        ? "text-amber-500"
                        : "text-green-500",
                    ],
                    [
                      "Total",
                      item.totalAmount > 0
                        ? `₹${fmt(item.totalAmount)}`
                        : "—",
                      "text-emerald-600 dark:text-emerald-400 font-bold",
                    ],
                  ].map(([l, v, c]) => (
                    <div key={l}>
                      <p className="text-[0.5625rem] uppercase tracking-widest text-muted-foreground mb-0.5">
                        {l}
                      </p>
                      <p className={`font-semibold ${c}`}>{v}</p>
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {(["receivedQty", "rate", "quantity"] as const).map(
                    (field) => (
                      <div key={field}>
                        <label className="block text-[0.5625rem] uppercase tracking-widest text-muted-foreground mb-1">
                          {field === "receivedQty"
                            ? "Received"
                            : field === "rate"
                              ? "Rate ₹"
                              : "Qty Bill"}
                          <span className="text-destructive ml-0.5">
                            *
                          </span>
                        </label>
                        {formData.grnSourceMode === "vehicleInOut" ? (
                          <div
                            className={`${inp} text-right text-xs flex items-center justify-end gap-1 bg-muted/30`}
                            title="Locked to the quantity recorded on the selected Vehicle In/Out"
                          >
                            <Lock size={10} className="text-muted-foreground shrink-0" />
                            {field === "receivedQty"
                              ? item.receivedQty
                              : field === "rate"
                                ? item.rate
                                : item.quantity}
                          </div>
                        ) : (
                          <input
                            type="number"
                            min={0}
                            step={
                              field !== "receivedQty" ? "0.01" : "0.001"
                            }
                            value={
                              field === "receivedQty"
                                ? item.receivedQty
                                : field === "rate"
                                  ? item.rate
                                  : item.quantity
                            }
                            onChange={(e) =>
                              updateItemField(
                                idx,
                                field,
                                Number(e.target.value),
                              )
                            }
                            className={`${inp} text-right text-xs`}
                          />
                        )}
                      </div>
                    ),
                  )}
                </div>
              </div>
            ))
          )}
          {formData.poId && grnTotalWithGST > 0 && (
            <div className="space-y-1.5">
              <div className="flex justify-between items-center px-4 py-3 rounded-xl bg-emerald-500/[0.05] border border-emerald-500/20">
                <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  GRN Total (this receipt)
                </span>
                <span className="font-bold text-emerald-600 dark:text-emerald-400">
                  ₹{fmt(grnTotalWithGST)}
                </span>
              </div>
              {formData.poTotalAmount > 0 &&
                (() => {
                  const diff =
                    formData.poTotalAmount -
                    formData.poReceivedAmount -
                    grnTotalWithGST;
                  return (
                    <div className="grid grid-cols-2 gap-1.5">
                      <div className="flex flex-col px-3 py-2.5 rounded-xl bg-muted/40 border border-border">
                        <span className="text-[0.5625rem] uppercase tracking-widest text-muted-foreground mb-0.5">
                          PO Value (incl. GST)
                        </span>
                        <span className="text-xs font-semibold text-foreground">
                          ₹{fmt(formData.poTotalAmount)}
                        </span>
                      </div>
                      {formData.poReceivedAmount > 0 && (
                        <div className="flex flex-col px-3 py-2.5 rounded-xl bg-muted/40 border border-border">
                          <span className="text-[0.5625rem] uppercase tracking-widest text-muted-foreground mb-0.5">
                            Already Received
                          </span>
                          <span className="text-xs font-semibold text-foreground">
                            ₹{fmt(formData.poReceivedAmount)}
                          </span>
                        </div>
                      )}
                      <div
                        className={`flex flex-col px-3 py-2.5 rounded-xl border ${diff > 0.005 ? "bg-[#ffe2021a] border-amber-500/30" : "bg-green-500/10 border-green-500/30"}`}
                      >
                        <span className="text-[0.5625rem] uppercase tracking-widest text-muted-foreground mb-0.5">
                          Balance on PO
                        </span>
                        <span
                          className={`text-xs font-semibold ${diff > 0.005 ? "text-amber-600 dark:text-amber-400" : "text-green-600 dark:text-green-400"}`}
                        >
                          {diff > 0.005
                            ? `₹${fmt(diff)}`
                            : "Fully received"}
                        </span>
                      </div>
                    </div>
                  );
                })()}
            </div>
          )}
        </div>

        {/* Desktop table */}
        <div className="hidden md:block border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm table-fixed">
            <colgroup>
              <col style={{ width: "20%" }} />
              <col style={{ width: "9%" }} />
              <col style={{ width: "10%" }} />
              <col style={{ width: "9%" }} />
              <col style={{ width: "8%" }} />
              <col style={{ width: "14%" }} />
              <col style={{ width: "14%" }} />
              <col style={{ width: "16%" }} />
            </colgroup>
            <thead>
              <tr className="bg-muted/50 border-b border-border">
                {[
                  { h: "Item", align: "text-left" },
                  { h: "Ordered", align: "text-right" },
                  { h: "Received *", align: "text-right" },
                  { h: "Pending Qty", align: "text-right" },
                  { h: "UOM", align: "text-left" },
                  { h: "Rate (₹) *", align: "text-right" },
                  { h: "Qty Bill *", align: "text-right" },
                  { h: "Total (₹)", align: "text-right" },
                ].map(({ h, align }) => (
                  <th
                    key={h}
                    className={`px-3 py-2.5 ${align} text-[0.625rem] font-semibold uppercase tracking-widest text-muted-foreground whitespace-nowrap`}
                  >
                    {h.replace(" *", "")}
                    {h.includes("*") && (
                      <span className="text-destructive ml-0.5">*</span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {!formData.poId ? (
                <tr>
                  <td
                    colSpan={8}
                    className="py-12 text-center text-muted-foreground/40 text-sm italic"
                  >
                    Select a Purchase Order above — items will autofill
                    from the PO
                  </td>
                </tr>
              ) : (
                formData.items.map((item, idx) => (
                  <tr
                    key={idx}
                    className="hover:bg-muted/20 transition-colors"
                  >
                    <td className="px-3 py-2.5">
                      <span className="text-xs font-medium text-foreground">
                        {item.itemName || "—"}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-right text-xs text-muted-foreground">
                      {item.orderedQty}
                    </td>
                    <td className="px-1.5 py-1.5">
                      {formData.grnSourceMode === "vehicleInOut" ? (
                        <span
                          className="flex items-center justify-end gap-1 text-xs font-medium text-foreground pr-2 py-1.5"
                          title="Locked to the quantity recorded on the selected Vehicle In/Out"
                        >
                          <Lock size={10} className="text-muted-foreground shrink-0" />
                          {item.receivedQty}
                        </span>
                      ) : (
                        <input
                          type="number"
                          min={0}
                          max={item.orderedQty || undefined}
                          step="0.001"
                          value={item.receivedQty}
                          onChange={(e) =>
                            updateReceivedQty(idx, Number(e.target.value))
                          }
                          className={`${inp} text-right text-xs py-1.5`}
                        />
                      )}
                    </td>
                    <td
                      className={`px-2 py-2 text-right text-xs font-semibold ${item.remainingQty > 0 ? "text-amber-500" : "text-green-500"}`}
                    >
                      {fmtQty(item.remainingQty)}
                    </td>
                    <td className="px-2 py-2 text-xs text-muted-foreground">
                      {item.uom || "—"}
                    </td>
                    <td className="px-1.5 py-1.5">
                      {formData.grnSourceMode === "vehicleInOut" ? (
                        <span
                          className="flex items-center justify-end gap-1 text-xs font-medium text-foreground pr-2 py-1.5"
                          title="Locked to the quantity recorded on the selected Vehicle In/Out"
                        >
                          <Lock size={10} className="text-muted-foreground shrink-0" />
                          {item.rate}
                        </span>
                      ) : (
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={item.rate}
                          onChange={(e) =>
                            updateItemField(
                              idx,
                              "rate",
                              Number(e.target.value),
                            )
                          }
                          className={`${inp} text-right text-xs py-1.5`}
                          placeholder="0.00"
                        />
                      )}
                    </td>
                    <td className="px-1.5 py-1.5">
                      {formData.grnSourceMode === "vehicleInOut" ? (
                        <span
                          className="flex items-center justify-end gap-1 text-xs font-medium text-foreground pr-2 py-1.5"
                          title="Locked to the quantity recorded on the selected Vehicle In/Out"
                        >
                          <Lock size={10} className="text-muted-foreground shrink-0" />
                          {item.quantity}
                        </span>
                      ) : (
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={item.quantity}
                          onChange={(e) =>
                            updateItemField(
                              idx,
                              "quantity",
                              Number(e.target.value),
                            )
                          }
                          className={`${inp} text-right text-xs py-1.5`}
                          placeholder="0"
                        />
                      )}
                    </td>
                    <td className="px-2 py-2 text-right text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                      {item.totalAmount > 0
                        ? `₹${fmt(item.totalAmount)}`
                        : "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {formData.poId && grnTotalWithGST > 0 && (
              <tfoot>
                <tr className="bg-emerald-500/[0.05] border-t-2 border-emerald-500/20">
                  <td
                    colSpan={7}
                    className="px-4 py-3 text-right text-[0.625rem] font-semibold uppercase tracking-widest text-muted-foreground"
                  >
                    GRN Total (this receipt)
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-emerald-600 dark:text-emerald-400 text-sm">
                    ₹{fmt(grnTotalWithGST)}
                  </td>
                </tr>
                {formData.poTotalAmount > 0 &&
                  (() => {
                    const diff =
                      formData.poTotalAmount -
                      formData.poReceivedAmount -
                      grnTotalWithGST;
                    return (
                      <>
                        <tr className="bg-muted/30 border-t border-border/50">
                          <td
                            colSpan={7}
                            className="px-4 py-2 text-right text-[0.625rem] font-semibold uppercase tracking-widest text-muted-foreground"
                          >
                            PO Value (incl. GST)
                          </td>
                          <td className="px-4 py-2 text-right text-xs font-semibold text-foreground">
                            ₹{fmt(formData.poTotalAmount)}
                          </td>
                        </tr>
                        {formData.poReceivedAmount > 0 && (
                          <tr className="bg-muted/20 border-t border-border/50">
                            <td
                              colSpan={7}
                              className="px-4 py-2 text-right text-[0.625rem] font-semibold uppercase tracking-widest text-muted-foreground"
                            >
                              Already Received
                            </td>
                            <td className="px-4 py-2 text-right text-xs font-semibold text-foreground">
                              −₹{fmt(formData.poReceivedAmount)}
                            </td>
                          </tr>
                        )}
                        <tr
                          className={
                            diff > 0.005
                              ? "bg-[#ffe2021a] border-t border-amber-500/20"
                              : "bg-green-500/10 border-t border-green-500/20"
                          }
                        >
                          <td
                            colSpan={7}
                            className="px-4 py-2 text-right text-[0.625rem] font-semibold uppercase tracking-widest text-muted-foreground"
                          >
                            Balance on PO
                          </td>
                          <td
                            className={`px-4 py-2 text-right text-xs font-bold ${diff > 0.005 ? "text-amber-600 dark:text-amber-400" : "text-green-600 dark:text-green-400"}`}
                          >
                            {diff > 0.005
                              ? `₹${fmt(diff)}`
                              : "Fully received"}
                          </td>
                        </tr>
                      </>
                    );
                  })()}
              </tfoot>
            )}
          </table>
        </div>
      </SectionCard>
    </>
  );
}
