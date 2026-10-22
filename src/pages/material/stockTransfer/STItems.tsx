import React from "react";
import { RefreshCw, Plus, Send, Search, Package } from "lucide-react";
import { fmtNum, fmtRate } from "./config";
import { FaCodePicker } from "./FaCodePicker";
import { ItemSearchRow } from "./ItemSearchRow";
import type { StockTransferState } from "./useStockTransfer";

// The lines being moved, checked against the source godown's stock, and the transfer key.
export function STItems({ m }: { m: StockTransferState }) {
  const { rights, transferMode, fromGodownId, items, remarks, setRemarks, applyGst, setApplyGst, fromStockData, isLoadingStock, availableItems, transferMut, interTransferMut, updateItem, removeItem, addItem, liveItems, shortLines, hasInsufficientStock, canTransfer, handleTransfer, handleReset, fromGodown, manualRates, setManualRates, hasUnpricedItems, interPreview, interPreviewLoading, interPreviewError } = m;
  return (
    <>
      {/* ── Items Table ───────────────────────────────────────────────────── */}
      {fromGodownId && (
        <div className="border border-foreground bg-card overflow-hidden">
          <div className="px-5 py-3 border-b border-foreground flex items-center justify-between">
            <div>
              <p className="text-sm font-heading font-semibold text-foreground">
                Items to Transfer
              </p>
              <p className="text-xs text-muted-foreground">
                Search for items available in the source godown
              </p>
            </div>
            <div className="flex items-center gap-3">
              {isLoadingStock ? (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <RefreshCw size={11} className="animate-spin" />
                  Loading stock…
                </span>
              ) : fromStockData ? (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Package size={11} className="text-foreground" />
                  {availableItems.length} items in stock
                </span>
              ) : null}
              {rights.canCreate && (
              <button
                onClick={addItem}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-foreground text-card text-xs font-medium transition-colors border border-foreground"
              >
                <Plus size={12} /> Add Item
              </button>
              )}
            </div>
          </div>

          <div className="p-4 space-y-2">
            {liveItems.some((it) => it.itemId) && (
              !fromGodownId ? (
                <div className="border border-foreground/40 bg-card px-3 py-2 text-xs text-foreground">
                  Pick the source godown to check stock for these items.
                </div>
              ) : isLoadingStock ? (
                <div className="border border-foreground bg-card px-3 py-2 text-xs text-muted-foreground flex items-center gap-1.5">
                  <RefreshCw size={11} className="animate-spin" /> Checking stock in the source godown…
                </div>
              ) : hasInsufficientStock ? (
                <div className="border border-destructive bg-destructive/10 px-3 py-2 text-xs text-destructive dark:text-destructive">
                  <p className="font-semibold">
                    Stock is not enough for {shortLines.length} item{shortLines.length !== 1 ? "s" : ""} — the transfer is blocked until it is fixed.
                  </p>
                  <ul className="mt-1 space-y-0.5">
                    {shortLines.map((it, i) => (
                      <li key={`${it.itemId}-${i}`}>
                        {it.itemName || it.itemId}: needs {fmtNum(parseFloat(it.qty) || 0)}, only {fmtNum(it.availableQty)} in stock
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1 opacity-80">Reduce the quantity, remove the item, or choose another source godown.</p>
                </div>
              ) : (
                <div className="border border-foreground/40 bg-card px-3 py-2 text-xs text-foreground">
                  Stock check passed — every item is available in the source godown.
                </div>
              )
            )}
            <div className="overflow-x-auto">
            <div className="min-w-[480px]">
            <div className="grid grid-cols-12 gap-2 px-1 mb-1">
              {["#", "Item", "Avail", "Qty", "UOM", ""].map((h, i) => (
                <span
                  key={i}
                  className={`text-[0.625rem] font-semibold text-muted-foreground uppercase tracking-wider ${
                    i === 0
                      ? "col-span-1"
                      : i === 1
                        ? "col-span-5"
                        : i === 2
                          ? "col-span-1"
                          : i === 3
                            ? "col-span-2"
                            : i === 4
                              ? "col-span-2"
                              : "col-span-1"
                  }`}
                >
                  {h}
                </span>
              ))}
            </div>

            {liveItems.map((it, idx) => (
              <React.Fragment key={idx}>
                <ItemSearchRow
                  item={it}
                  idx={idx}
                  onUpdate={updateItem}
                  onRemove={removeItem}
                  availableItems={availableItems}
                  isLoadingStock={isLoadingStock}
                />
                {it.isFa && (
                  <FaCodePicker
                    projectId={fromGodown?.ProjectID ?? undefined}
                    itemId={it.itemId}
                    selected={it.faTagIds ?? []}
                    takenElsewhere={
                      new Set(
                        liveItems.flatMap((o, oi) => (oi !== idx ? o.faTagIds ?? [] : [])),
                      )
                    }
                    onChange={(ids) => updateItem(idx, { faTagIds: ids, qty: ids.length ? String(ids.length) : "" })}
                  />
                )}
              </React.Fragment>
            ))}
            </div>{/* min-w */}
            </div>{/* overflow-x-auto */}
          </div>

          <div className="px-5 py-4 border-t border-foreground space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1.5">
                Transfer Remarks
              </label>
              <textarea
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                rows={2}
                placeholder="Reason for transfer, project reference, etc."
                className="w-full px-3 py-2 border border-foreground bg-card text-sm text-foreground placeholder:text-muted-foreground outline-none resize-none"
              />
            </div>
            {transferMode === "inter" && (
              <div className="border border-foreground bg-card px-3 py-3 text-xs space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold text-muted-foreground uppercase tracking-wider text-[0.625rem]">
                    Posting Preview
                  </p>
                  <label className="flex items-center gap-1.5 text-[0.625rem] font-medium text-muted-foreground shrink-0 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={applyGst}
                      onChange={(e) => setApplyGst(e.target.checked)}
                      className="border-foreground/30 accent-foreground"
                    />
                    Apply GST
                  </label>
                </div>
                {interPreviewLoading && !interPreview ? (
                  <p className="text-muted-foreground flex items-center gap-1.5">
                    <RefreshCw size={11} className="animate-spin" /> Pricing items…
                  </p>
                ) : interPreviewError ? (
                  <p className="text-destructive dark:text-destructive">
                    {(interPreviewError as Error).message}
                  </p>
                ) : interPreview && interPreview.items.length > 0 ? (
                  <>
                    {/* Per-item breakdown */}
                    <div className="space-y-2">
                      {interPreview.items.map((it) => {
                        const gstPct = it.gstPct ?? 0;
                        const gstAmt = it.gstAmount ?? 0;
                        const inclAmt = it.amountInclGst ?? it.amount;
                        if (it.needsManualRate) {
                          return (
                            <div key={it.itemId} className="bg-card border border-foreground/40 px-3 py-2 space-y-1.5">
                              <div className="flex items-center justify-between gap-3 text-[0.6875rem] font-medium">
                                <span className="text-foreground truncate">
                                  {it.itemName || it.itemId} — {it.qty} {it.unit}
                                </span>
                              </div>
                              <p className="text-[0.625rem] text-foreground">
                                No purchase history found under this company — enter a rate to price this item.
                              </p>
                              <div className="flex items-center gap-1.5">
                                <span className="text-[0.6875rem] text-muted-foreground">₹</span>
                                <input
                                  type="number"
                                  min="0.01"
                                  step="any"
                                  value={manualRates[it.itemId] ?? ""}
                                  onChange={(e) =>
                                    setManualRates((prev) => ({ ...prev, [it.itemId]: e.target.value }))
                                  }
                                  placeholder="Rate per unit"
                                  className="w-32 px-2 py-1 border border-foreground/40 bg-card text-xs text-foreground outline-none"
                                />
                                <span className="text-[0.625rem] text-muted-foreground">per {it.unit}</span>
                              </div>
                            </div>
                          );
                        }
                        return (
                          <div key={it.itemId} className="bg-card border border-foreground px-3 py-2 space-y-0.5">
                            <div className="flex items-center justify-between gap-3 text-[0.6875rem] font-medium">
                              <span className="text-foreground truncate">
                                {it.itemName || it.itemId} — {it.qty} {it.unit}
                              </span>
                              <span className="text-foreground shrink-0">
                                ₹{inclAmt.toLocaleString("en-IN")}
                              </span>
                            </div>
                            <div className="flex items-center justify-between text-[0.625rem] text-muted-foreground">
                              <span>Excl. GST: ₹{fmtRate(it.rate)}/unit × {it.qty} = ₹{it.amount.toLocaleString("en-IN")}</span>
                            </div>
                            {gstPct > 0 ? (
                              <div className="flex items-center justify-between text-[0.625rem] text-foreground">
                                <span>GST @ {gstPct}%</span>
                                <span>+ ₹{gstAmt.toLocaleString("en-IN")}</span>
                              </div>
                            ) : (
                              <div className="text-[0.625rem] text-muted-foreground/60">GST: N/A (0%)</div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* Totals summary */}
                    <div className="border-t border-foreground pt-2 space-y-1 text-[0.6875rem]">
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Subtotal (excl. GST)</span>
                        <span className="font-heading">₹{interPreview.totalAmount.toLocaleString("en-IN")}</span>
                      </div>
                      {(interPreview.totalGstAmount ?? 0) > 0 && (
                        <div className="flex items-center justify-between">
                          <span className="text-foreground">GST</span>
                          <span className="font-heading text-foreground">
                            + ₹{(interPreview.totalGstAmount!).toLocaleString("en-IN")}
                          </span>
                        </div>
                      )}
                      <div className="flex items-center justify-between font-semibold border-t border-foreground pt-1">
                        <span className="text-foreground">Total (incl. GST)</span>
                        <span className="text-foreground">
                          ₹{(interPreview.totalAmountInclGst ?? interPreview.totalAmount).toLocaleString("en-IN")}
                        </span>
                      </div>
                    </div>

                    {/* GL posting lines */}
                    <div className="border-t border-foreground pt-2 space-y-1 text-[0.625rem]">
                      <p className="text-muted-foreground/60 uppercase tracking-wider text-[0.5625rem] font-semibold">GL Posting</p>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">
                          {interPreview.senderCompanyName} — Inter-Company A/c debited
                        </span>
                        <span className="font-semibold">₹{(interPreview.totalAmountInclGst ?? interPreview.totalAmount).toLocaleString("en-IN")}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">
                          {interPreview.receiverCompanyName} — Inter-Company A/c credited
                        </span>
                        <span className="font-semibold">₹{(interPreview.totalAmountInclGst ?? interPreview.totalAmount).toLocaleString("en-IN")}</span>
                      </div>
                    </div>
                  </>
                ) : (
                  <p className="text-muted-foreground/60">
                    Select items to price them at {fromGodown?.EnterpriseName || "the source company"}'s most recent purchase rate.
                  </p>
                )}
              </div>
            )}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="hidden sm:block text-xs text-muted-foreground">
                Review items and godowns before executing.
              </p>
              <div className="flex gap-2 sm:ml-auto">
                <button
                  onClick={handleReset}
                  className="flex-1 sm:flex-none flex items-center justify-center px-4 py-2 border border-foreground/30 text-sm hover:bg-primary/5 transition-colors"
                >
                  Reset
                </button>
                {rights.canCreate && (
                <button
                  onClick={handleTransfer}
                  disabled={!canTransfer || hasUnpricedItems}
                  className="flex-1 sm:flex-none whitespace-nowrap flex items-center justify-center gap-2 px-6 py-2.5 bg-foreground text-card text-sm font-semibold disabled:opacity-50 transition-colors border border-foreground"
                >
                  {transferMut.isPending || interTransferMut.isPending ? (
                    <>
                      <RefreshCw size={14} className="animate-spin" />{" "}
                      Processing…
                    </>
                  ) : (
                    <>
                      <Send size={14} /> Execute Transfer
                    </>
                  )}
                </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
