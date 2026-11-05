import { Search, Plus, RefreshCw, X, Hash, AlertTriangle, BarChart3, Package, CheckCircle2, Warehouse, ChevronDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/SearchableSelect";
import { selectCls, GodownBadge, RULE, HEAD, KEY_LINE } from "./config";
import type { IssuesState } from "./useIssues";

// The items being issued, checked against the godown's stock.
export function IssueCart({ m }: { m: IssuesState }) {
  const { limit, header, cart, itemOptions, loadingItems, uoms, loadingUoms, uomMap, selectedGodown, updateCartItem, pickItem, addCartRow, removeCartRow, getStockForRow, totalCartQty, hasStockError } = m;
  return (
    <>
      {/* ── Items cart card ── */}
      <div className="bg-card" style={{ border: RULE }}>
        <div className="px-5 py-4 flex flex-row flex-wrap items-center justify-between gap-2" style={{ borderBottom: RULE }}>
          <div className="flex flex-wrap items-center gap-2.5">
            <h3 className={HEAD}>Items</h3>
            <span className="font-heading text-xs tabular-nums text-muted-foreground">
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
              <span className="inline-flex items-center gap-1 font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em] px-1.5 py-0.5 border border-destructive text-destructive">
                <AlertTriangle size={10} /> Stock exceeded
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={addCartRow}
            disabled={!header.godownId}
            className={`${KEY_LINE} h-8 px-3`}
            title={!header.godownId ? "Select a godown first" : undefined}
          >
            <Plus size={13} /> Add item
          </button>
        </div>

        <div className="p-4 space-y-3">
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
                  className={`border transition-colors ${
                    isOver
                      ? "border-destructive/50 bg-destructive/5"
                      : "border-foreground/30 bg-card hover:bg-primary/5"
                  }`}
                >
                  {/* Row top: index + item select + remove */}
                  <div className="flex items-center gap-3 px-3 pt-3 pb-2">
                    <span className="w-5 h-5 bg-card flex items-center justify-center text-[0.625rem] font-bold text-muted-foreground shrink-0">
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
                      className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-30"
                    >
                      <X size={14} />
                    </button>
                  </div>

                  {/* Row bottom: UOM + Qty */}
                  <div className="grid grid-cols-2 gap-3 px-3 pb-3">
                    <div className="space-y-1">
                      <label className="text-[0.625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
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
                      <label className="text-[0.625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
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
                          className={`pl-8 h-9 font-heading text-sm ${
                            isOver
                              ? "border-destructive text-destructive"
                              : ""
                          }`}
                          placeholder="0.00"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Stock bar + remarks — only when item selected */}
                  {ci.ItemId && (
                    <div className="border-t border-foreground/30 mx-3 pt-2.5 pb-3 space-y-2">
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
                          <span className="font-semibold text-foreground">
                            Remaining: {(availStock - reqQty).toFixed(2)}{" "}
                            {uomObj?.Symbol || ci.UOMCode}
                          </span>
                        ) : null}
                      </div>
                      <div className="h-1.5 bg-card overflow-hidden">
                        <div
                          className={`h-full transition-all ${
                            isOver
                              ? "bg-destructive"
                              : stockPct > 80
                                ? "bg-card"
                                : "bg-card"
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
              <div className="flex items-center justify-between border border-foreground/30 bg-card px-4 py-2.5 text-sm">
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
                    <span className="font-semibold text-foreground font-heading">
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
                  <span className="flex items-center gap-1.5 text-foreground font-medium">
                    <CheckCircle2 size={13} /> Within stock limits
                  </span>
                )}
              </div>
            )}
        </div>
      </div>
    </>
  );
}
