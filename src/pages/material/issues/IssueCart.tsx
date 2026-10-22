import { Search, Plus, RefreshCw, X, Hash, AlertTriangle, BarChart3, ShoppingCart, Package, CheckCircle2, Warehouse, ChevronDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SearchableSelect } from "@/components/SearchableSelect";
import { selectCls, GodownBadge } from "./config";
import type { IssuesState } from "./useIssues";

// The items being issued, checked against the godown's stock.
export function IssueCart({ m }: { m: IssuesState }) {
  const { limit, header, cart, itemOptions, loadingItems, uoms, loadingUoms, uomMap, selectedGodown, updateCartItem, pickItem, addCartRow, removeCartRow, getStockForRow, totalCartQty, hasStockError } = m;
  return (
    <>
      {/* ── Items cart card ── */}
      <Card className="border-border shadow-sm">
        <CardHeader className="pb-3 border-b border-border bg-muted/20 flex flex-row items-center justify-between">
          <div className="flex items-center gap-2.5">
            <ShoppingCart size={15} className="text-emerald-600 dark:text-emerald-400" />
            <CardTitle className="text-base font-semibold">Items</CardTitle>
            <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-semibold">
              {cart.length}
            </span>
            {/* Godown pill — reminds user which godown stock is from */}
            {selectedGodown && (
              <GodownBadge
                name={selectedGodown.name}
                code={selectedGodown.code}
                isMain={selectedGodown.isMain}
              />
            )}
            {hasStockError && (
              <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-destructive/10 text-destructive text-xs font-semibold">
                <AlertTriangle size={10} /> Stock exceeded
              </span>
            )}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addCartRow}
            disabled={!header.godownId}
            className="gap-1.5 h-8 text-xs"
            title={!header.godownId ? "Select a godown first" : undefined}
          >
            <Plus size={13} /> Add Item
          </Button>
        </CardHeader>

        <CardContent className="p-4 space-y-3">
          {/* Prompt if no godown selected */}
          {!header.godownId && (
            <div className="flex flex-col items-center justify-center py-10 gap-3 text-center">
              <Warehouse size={32} className="text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">
                Select a source godown above to load available items
              </p>
            </div>
          )}

          {header.godownId && loadingItems && (
            <div className="flex items-center justify-center h-24 gap-2 text-muted-foreground text-sm">
              <RefreshCw size={14} className="animate-spin" />
              Loading stock from {selectedGodown?.name ?? "godown"}…
            </div>
          )}

          {header.godownId &&
            !loadingItems &&
            cart.map((ci, idx) => {
              const availStock = getStockForRow(ci._key, ci.ItemId);
              const reqQty = Number(ci.Quantity) || 0;
              const isOver = reqQty > 0 && reqQty > availStock;
              const uomObj = uomMap[ci.UOMCode];
              const stockPct =
                availStock > 0
                  ? Math.min((reqQty / availStock) * 100, 100)
                  : 0;

              return (
                <div
                  key={ci._key}
                  className={`rounded-lg border transition-colors ${
                    isOver
                      ? "border-destructive/50 bg-destructive/5"
                      : "border-border bg-muted/10 hover:bg-muted/20"
                  }`}
                >
                  {/* Row top: index + item select + remove */}
                  <div className="flex items-center gap-3 px-3 pt-3 pb-2">
                    <span className="w-5 h-5 rounded-full bg-muted flex items-center justify-center text-[0.625rem] font-bold text-muted-foreground shrink-0">
                      {idx + 1}
                    </span>

                    <div className="flex-1 min-w-0">
                      <SearchableSelect
                        value={ci.ItemId}
                        onChange={(v) => pickItem(ci._key, v)}
                        placeholder={loadingItems ? "Loading…" : "Select item"}
                        searchPlaceholder="Search items…"
                        className={isOver ? "border-destructive" : ""}
                        options={(itemOptions as any[]).map((item) => ({
                          value: String(item.M_Id),
                          label: `${item.M_Name} — Stock: ${Number(item.AvailableStock).toFixed(2)}${item.M_Group ? ` · ${item.M_Group}` : ""}`,
                        }))}
                      />
                    </div>

                    <button
                      type="button"
                      onClick={() => removeCartRow(ci._key)}
                      disabled={cart.length === 1}
                      title="Remove"
                      className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-30"
                    >
                      <X size={14} />
                    </button>
                  </div>

                  {/* Row bottom: UOM + Qty */}
                  <div className="grid grid-cols-2 gap-3 px-3 pb-3">
                    <div className="space-y-1">
                      <label className="text-[0.625rem] font-semibold uppercase tracking-widest text-muted-foreground">
                        Unit (UOM) *
                      </label>
                      <div className="relative">
                        <select
                          value={ci.UOMCode}
                          onChange={(e) =>
                            updateCartItem(ci._key, "UOMCode", e.target.value)
                          }
                          className={selectCls}
                        >
                          <option value="">
                            {loadingUoms ? "Loading…" : "Select UOM"}
                          </option>
                          {(uoms as any[]).map((u) => (
                            <option key={u.UOMCode} value={u.UOMCode}>
                              {u.UOMName}
                              {u.Symbol ? ` (${u.Symbol})` : ""}
                            </option>
                          ))}
                        </select>
                        <ChevronDown
                          size={13}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                        />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[0.625rem] font-semibold uppercase tracking-widest text-muted-foreground">
                        Quantity *
                      </label>
                      <div className="relative">
                        <Hash
                          size={12}
                          className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                        />
                        <Input
                          type="number"
                          min={0}
                          step="0.01"
                          value={ci.Quantity}
                          onChange={(e) =>
                            updateCartItem(
                              ci._key,
                              "Quantity",
                              e.target.value,
                            )
                          }
                          className={`pl-8 h-9 font-mono text-sm ${
                            isOver
                              ? "border-destructive text-destructive focus-visible:ring-destructive"
                              : ""
                          }`}
                          placeholder="0.00"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Stock bar + remarks — only when item selected */}
                  {ci.ItemId && (
                    <div className="border-t border-border/60 mx-3 pt-2.5 pb-3 space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground flex items-center gap-1">
                          <BarChart3 size={10} />
                          Available in{" "}
                          <span className="font-medium text-foreground mx-0.5">
                            {selectedGodown?.name}
                          </span>
                          :{" "}
                          {loadingItems ? (
                            <span className="flex items-center gap-1 text-muted-foreground/70 italic">
                              <RefreshCw size={10} className="animate-spin" />
                              Loading…
                            </span>
                          ) : (
                            <span className="font-semibold text-foreground ml-0.5">
                              {availStock.toFixed(2)}{" "}
                              {uomObj?.Symbol || ci.UOMCode}
                            </span>
                          )}
                        </span>
                        {isOver ? (
                          <span className="flex items-center gap-1 font-semibold text-destructive">
                            <AlertTriangle size={10} /> Exceeds stock
                          </span>
                        ) : reqQty > 0 ? (
                          <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                            Remaining: {(availStock - reqQty).toFixed(2)}{" "}
                            {uomObj?.Symbol || ci.UOMCode}
                          </span>
                        ) : null}
                      </div>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${
                            isOver
                              ? "bg-destructive"
                              : stockPct > 80
                                ? "bg-amber-500"
                                : "bg-emerald-500"
                          }`}
                          style={{ width: `${isOver ? 100 : stockPct}%` }}
                        />
                      </div>
                      <Input
                        value={ci.Remarks}
                        onChange={(e) =>
                          updateCartItem(ci._key, "Remarks", e.target.value)
                        }
                        placeholder="Line remarks (optional)"
                        className="h-8 text-xs"
                      />
                    </div>
                  )}
                </div>
              );
            })}

          {/* Footer summary */}
          {header.godownId &&
            !loadingItems &&
            cart.some((ci) => ci.ItemId && ci.Quantity) && (
              <div className="flex items-center justify-between rounded-lg border border-border bg-muted/20 px-4 py-2.5 text-sm">
                <div className="flex items-center gap-3 text-muted-foreground">
                  <Package size={13} />
                  <span>
                    <span className="font-semibold text-foreground">
                      {cart.filter((ci) => ci.ItemId).length}
                    </span>{" "}
                    item
                    {cart.filter((ci) => ci.ItemId).length !== 1
                      ? "s"
                      : ""} ·{" "}
                    <span className="font-semibold text-foreground font-mono">
                      {totalCartQty.toFixed(2)}
                    </span>{" "}
                    units total
                  </span>
                </div>
                {hasStockError ? (
                  <span className="flex items-center gap-1.5 text-destructive font-medium">
                    <AlertTriangle size={13} /> Stock limit exceeded
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-medium">
                    <CheckCircle2 size={13} /> Within stock limits
                  </span>
                )}
              </div>
            )}
        </CardContent>
      </Card>
    </>
  );
}
