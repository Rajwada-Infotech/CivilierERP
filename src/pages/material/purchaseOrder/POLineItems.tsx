import { ItemPicker } from "../ItemPicker";
import { AlertTriangle, Plus, Boxes, X, ChevronDown, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { relevantUOMs, convertRate } from "@/lib/uomConversion";
import { alternatesForItem, getItemUomFactor, convertItemRate, convertItemQuantity } from "@/lib/itemUomAlternates";
import { fmt, cellInput, cellSelect } from "./config";
import type { POState } from "./usePurchaseOrder";

// The PO's line items and their totals.
export function POLineItems({ m }: { m: POState }) {
  const { lineItems, errors, itemUomAlternates, uoms, items, hasMixedItemTypes, availableSupplyDays, pickableItems, subtotal, totalCgst, totalSgst, totalIgst, totalTax, grandTotal, updateLine, addLine, removeLine, handleItemSelect, isReadOnly } = m;
  return (
    <>
      {/* ── Line Items Card ───────────────────────────────────────────────── */}
      <div className="border border-foreground/30 bg-card overflow-hidden min-w-0">
        <div className="flex items-center justify-between px-5 py-4 border-b border-foreground/30 bg-card">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-[0.12em] flex items-center gap-1.5">
            <Boxes
              size={11}
              className="text-foreground"
            />
            Item Cart
            <span className="ml-1 inline-flex items-center justify-center bg-card text-foreground text-[0.625rem] font-bold px-1.5 py-0.5 min-w-[18px]">
              {lineItems.length}
            </span>
          </h3>
          {!isReadOnly && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addLine}
              className="gap-1.5 h-8 text-xs"
            >
              <Plus size={13} /> Add Item
            </Button>
          )}
        </div>

        {errors.lineItems && (
          <p className="px-5 pb-2 text-xs text-destructive">
            Add at least one line item
          </p>
        )}

        {hasMixedItemTypes && (
          <div className="flex items-start gap-2 mx-5 mb-3 px-3 py-2.5 bg-card border border-foreground/40 text-xs text-foreground">
            <AlertTriangle size={13} className="shrink-0 mt-0.5" />
            <span>
              This cart mixes <strong>Goods</strong> and <strong>Service</strong> items — a PO can only be one or the other.
              Remove one type and raise a separate PO for it (Goods items need a GRN; Service items can be invoiced directly).
            </span>
          </div>
        )}

        {availableSupplyDays !== null && (
          <p className="mx-5 mb-3 text-[0.6875rem] text-foreground">
            Only items deliverable within {availableSupplyDays} day{availableSupplyDays === 1 ? "" : "s"} are listed in the item picker.
          </p>
        )}

        {/* Table header */}
        <div
          className={`overflow-x-auto ${errors.lineItems ? "border-t border-destructive" : ""}`}
        >
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-foreground/30 bg-card">
                <th className="px-3 py-2.5 text-left text-[0.6875rem] font-semibold text-muted-foreground uppercase tracking-wider w-8">
                  #
                </th>
                <th className="px-3 py-2.5 text-left text-[0.6875rem] font-semibold text-muted-foreground uppercase tracking-wider min-w-[180px]">
                  Item
                </th>
                <th className="px-3 py-2.5 text-left text-[0.6875rem] font-semibold text-muted-foreground uppercase tracking-wider min-w-[200px]">
                  Description
                </th>
                <th className="px-3 py-2.5 text-left text-[0.6875rem] font-semibold text-muted-foreground uppercase tracking-wider w-24">
                  Qty
                </th>
                <th className="px-3 py-2.5 text-left text-[0.6875rem] font-semibold text-muted-foreground uppercase tracking-wider w-32">
                  UOM
                </th>
                <th className="px-3 py-2.5 text-right text-[0.6875rem] font-semibold text-muted-foreground uppercase tracking-wider w-28">
                  Rate (₹)
                </th>
                <th className="px-3 py-2.5 text-center text-[0.6875rem] font-semibold text-muted-foreground uppercase tracking-wider w-32">
                  GST %
                </th>
                <th className="px-3 py-2.5 text-right text-[0.6875rem] font-semibold text-muted-foreground uppercase tracking-wider w-28">
                  Amount (₹)
                </th>
                {!isReadOnly && <th className="px-3 py-2.5 w-10" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-foreground/10">
              {lineItems.map((li, idx) => (
                <tr
                  key={li.id}
                  className="group hover:bg-primary/5 transition-colors align-top"
                >
                  {/* Row number */}
                  <td className="px-3 py-2 text-center text-xs text-muted-foreground font-heading">
                    {idx + 1}
                  </td>

                  {/* Item selector */}
                  <td className="px-3 py-2">
                    {isReadOnly ? (
                      <span className="text-sm font-medium text-foreground">
                        {li.itemName || "—"}
                      </span>
                    ) : (
                      <ItemPicker
                        items={pickableItems}
                        value={li.itemId}
                        onChange={(id) => handleItemSelect(idx, id)}
                      />
                    )}
                  </td>

                  {/* Description (auto-filled or editable) */}
                  <td className="px-3 py-2">
                    {isReadOnly ? (
                      <span className="text-xs text-muted-foreground">
                        {li.itemDescription || "—"}
                      </span>
                    ) : (
                      <input
                        value={li.itemDescription}
                        onChange={(e) =>
                          updateLine(idx, {
                            itemDescription: e.target.value,
                          })
                        }
                        placeholder="Description…"
                        className={cellInput}
                      />
                    )}
                  </td>

                  {/* Qty */}
                  <td className="px-3 py-2">
                    {isReadOnly ? (
                      <span className="text-sm font-medium">
                        {Number.isFinite(li.quantity)
                          ? li.quantity.toLocaleString("en-IN", {
                              maximumFractionDigits: 4,
                            })
                          : "0"}
                      </span>
                    ) : (
                      <div>
                        <input
                          type="number"
                          min={0}
                          max={li.mrPendingQty ?? undefined}
                          step="any"
                          value={li.quantity}
                          onChange={(e) =>
                            updateLine(idx, {
                              quantity: parseFloat(e.target.value) || 0,
                            })
                          }
                          title={
                            li.mrPendingQty != null
                              ? `Pending on MR: ${li.mrPendingQty}`
                              : undefined
                          }
                          className={`${cellInput} text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${li.mrPendingQty != null && li.quantity - li.mrPendingQty > 0.0001 ? "border-destructive" : ""}`}
                        />
                        {li.mrPendingQty != null && (
                          <p
                            className={`mt-1 pb-0.5 text-[0.625rem] leading-normal whitespace-nowrap overflow-hidden text-ellipsis ${li.quantity - li.mrPendingQty > 0.0001 ? "text-destructive" : "text-muted-foreground"}`}
                          >
                            {Math.max(0, li.mrPendingQty - li.quantity)} remaining MR
                          </p>
                        )}
                        {/* Live equivalents in this item's other tagged UOMs */}
                        {li.quantity > 0 &&
                          (() => {
                            const lineItem = items.find((i) => i.id === li.itemId);
                            if (!lineItem) return null;
                            const itemAlternates = alternatesForItem(
                              itemUomAlternates,
                              lineItem.id,
                            );
                            if (itemAlternates.length === 0) return null;
                            const currentCode =
                              uoms.find((u) => u.id === li.uomId)?.code ??
                              lineItem.uom;
                            const fromFactor = getItemUomFactor(
                              itemUomAlternates,
                              lineItem.id,
                              currentCode,
                              lineItem.uom,
                            );
                            if (fromFactor == null) return null;
                            const others: { label: string; qty: number }[] = [];
                            if (lineItem.uom && lineItem.uom !== currentCode) {
                              others.push({
                                label: lineItem.uom,
                                qty: convertItemQuantity(li.quantity, fromFactor, 1),
                              });
                            }
                            for (const a of itemAlternates) {
                              if (a.uomCode === currentCode) continue;
                              others.push({
                                label: a.symbol || a.uomName || a.uomCode,
                                qty: convertItemQuantity(
                                  li.quantity,
                                  fromFactor,
                                  a.conversionFactor,
                                ),
                              });
                            }
                            if (others.length === 0) return null;
                            return (
                              <p className="text-[0.625rem] text-muted-foreground text-right mt-1">
                                ≈{" "}
                                {others
                                  .map(
                                    (o) =>
                                      `${o.qty.toLocaleString("en-IN", { maximumFractionDigits: 3 })} ${o.label}`,
                                  )
                                  .join(" · ")}
                              </p>
                            );
                          })()}
                      </div>
                    )}
                  </td>

                  {/* UOM */}
                  <td className="px-3 py-2">
                    {isReadOnly ? (
                      <span className="text-sm text-muted-foreground">
                        {li.unit || "—"}
                      </span>
                    ) : li.uomLocked ? (
                      <span
                        className="flex items-center gap-1 text-sm text-muted-foreground"
                        title="UOM is locked to what was quoted — remove and re-add the item to change it"
                      >
                        <Lock size={11} className="shrink-0" />
                        {li.unit || "—"}
                      </span>
                    ) : (() => {
                      const currentUom = uoms.find(
                        (u) =>
                          u.id === li.uomId ||
                          u.name.toLowerCase() === li.unit.toLowerCase() ||
                          u.code.toLowerCase() === li.unit.toLowerCase(),
                      );
                      // Only offer UOMs relevant to the currently-selected
                      // one (same measurement category — e.g. Weight units
                      // for a Weight unit) so a liquid item can't be
                      // switched to "Running Meter". Units with no category
                      // (Bags, Box, Set, ...) fall back to the full list,
                      // same as before this feature existed.
                      const options = relevantUOMs(uoms, currentUom?.category);

                      // Item-tagged alternates (e.g. Cement in CFT) have no
                      // fixed physical category, so they're never in the
                      // category-based `options` above — merge them in.
                      const lineItem = items.find((i) => i.id === li.itemId);
                      const itemAlternates = lineItem
                        ? alternatesForItem(itemUomAlternates, lineItem.id)
                        : [];
                      const extraOptions = itemAlternates
                        .map((a) => uoms.find((u) => u.code === a.uomCode))
                        .filter(
                          (u): u is (typeof uoms)[number] =>
                            !!u && !options.some((o) => o.id === u.id) && u.id !== currentUom?.id,
                        );

                      return (
                      <div className="relative">
                        <select
                          value={currentUom?.id ?? ""}
                          onChange={(e) => {
                            const uom = uoms.find(
                              (u) => u.id === Number(e.target.value),
                            );
                            if (!uom) return;

                            // Item-specific conversion (e.g. Cement Bag <->
                            // CFT) takes priority over the category-based
                            // one — it's the more precise, item-authored
                            // figure when both are available.
                            const itemFromFactor = lineItem
                              ? getItemUomFactor(
                                  itemUomAlternates,
                                  lineItem.id,
                                  currentUom?.code ?? "",
                                  lineItem.uom,
                                )
                              : null;
                            const itemToFactor = lineItem
                              ? getItemUomFactor(
                                  itemUomAlternates,
                                  lineItem.id,
                                  uom.code,
                                  lineItem.uom,
                                )
                              : null;

                            let nextRate = li.rate;
                            if (itemFromFactor != null && itemToFactor != null) {
                              nextRate = convertItemRate(
                                li.rate,
                                itemFromFactor,
                                itemToFactor,
                              );
                            } else if (
                              currentUom?.category &&
                              uom.category === currentUom.category &&
                              currentUom.baseFactor &&
                              uom.baseFactor
                            ) {
                              // Same-category switch (e.g. tonne -> kg):
                              // re-price the rate so the line's total value
                              // doesn't silently change under the user —
                              // a supplier quote of ₹100/tonne becomes
                              // ₹0.1/kg, not ₹100/kg.
                              nextRate = convertRate(li.rate, currentUom.baseFactor, uom.baseFactor);
                            }
                            updateLine(idx, {
                              uomId: uom.id,
                              unit: uom.name,
                              rate: nextRate,
                            });
                          }}
                          className={cellSelect}
                        >
                          <option value="">— UOM —</option>
                          {options.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.name}
                            </option>
                          ))}
                          {extraOptions.length > 0 && (
                            <optgroup label="Tagged for this item">
                              {extraOptions.map((u) => (
                                <option key={u.id} value={u.id}>
                                  {u.name}
                                </option>
                              ))}
                            </optgroup>
                          )}
                        </select>
                        <ChevronDown
                          size={11}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                        />
                      </div>
                      );
                    })()}
                  </td>

                  {/* Rate */}
                  <td className="px-3 py-2">
                    {isReadOnly ? (
                      <span className="text-sm text-right block font-heading">
                        ₹
                        {Number.isFinite(li.rate)
                          ? li.rate.toLocaleString("en-IN", {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })
                          : "0.00"}
                      </span>
                    ) : (
                      <input
                        type="number"
                        min={0}
                        step="any"
                        value={li.rate}
                        onChange={(e) =>
                          updateLine(idx, {
                            rate: parseFloat(e.target.value) || 0,
                          })
                        }
                        className={`${cellInput} text-right font-heading`}
                      />
                    )}
                  </td>

                  {/* GST % */}
                  <td className="px-3 py-2 text-center">
                    {li.gstRate > 0 ? (
                      <div className="flex flex-col items-center gap-0.5">
                        <span className="inline-flex items-center px-2 py-0.5 bg-card text-foreground text-[0.6875rem] font-semibold">
                          {li.gstRate}%
                        </span>
                        {li.igstRate > 0 ? (
                          <span className="text-[0.625rem] text-muted-foreground font-medium">
                            IGST
                          </span>
                        ) : (
                          <>
                            <span className="text-[0.625rem] text-muted-foreground font-medium">
                              CGST {li.cgstRate}%
                            </span>
                            <span className="text-[0.625rem] text-muted-foreground font-medium">
                              SGST {li.sgstRate}%
                            </span>
                          </>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        —
                      </span>
                    )}
                  </td>

                  {/* Amount (base + GST) */}
                  <td className="px-3 py-2 text-right">
                    <span className="text-sm font-semibold font-heading text-foreground">
                      ₹
                      {(Number.isFinite(li.amount)
                        ? li.amount
                        : 0
                      ).toLocaleString("en-IN", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </span>
                    {li.taxAmount > 0 && (
                      <span className="block text-[0.625rem] text-muted-foreground font-normal">
                        +₹
                        {li.taxAmount.toLocaleString("en-IN", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}{" "}
                        GST
                      </span>
                    )}
                  </td>

                  {/* Remove */}
                  {!isReadOnly && (
                    <td className="px-3 py-2 text-center">
                      <button
                        onClick={() => removeLine(idx)}
                        disabled={lineItems.length === 1}
                        className="p-1 hover:bg-destructive/10 dark:hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition disabled:opacity-30"
                      >
                        <X size={14} />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Totals footer */}
        <div className="border-t border-foreground/30 bg-card px-5 py-5 space-y-4">
          {/* Amount summary */}
          <div className="flex justify-end">
            <div className="w-full max-w-xs space-y-2">
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>Subtotal (excl. GST)</span>
                <span className="font-heading">{fmt(subtotal)}</span>
              </div>
              {totalCgst > 0 && (
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>CGST</span>
                  <span className="font-heading">{fmt(totalCgst)}</span>
                </div>
              )}
              {totalSgst > 0 && (
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>SGST</span>
                  <span className="font-heading">{fmt(totalSgst)}</span>
                </div>
              )}
              {totalIgst > 0 && (
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>IGST</span>
                  <span className="font-heading">{fmt(totalIgst)}</span>
                </div>
              )}
              {/* Combined total tax row when both CGST/SGST and IGST exist */}
              {totalTax > 0 && totalCgst > 0 && totalIgst > 0 && (
                <div className="flex justify-between text-sm text-muted-foreground border-t border-dashed border-foreground/30 pt-1">
                  <span>Total GST</span>
                  <span className="font-heading">{fmt(totalTax)}</span>
                </div>
              )}
              <div className="flex justify-between text-base font-bold text-foreground border-t border-foreground/30 pt-2">
                <span>Grand Total</span>
                <span className="font-heading text-foreground">
                  {fmt(grandTotal)}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
