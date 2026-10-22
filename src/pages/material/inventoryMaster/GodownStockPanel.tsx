import { useQuery } from "@tanstack/react-query";
import { Warehouse, X, AlertCircle, Archive, PackageOpen, TrendingUp, TrendingDown, Boxes } from "lucide-react";
import { type Godown } from "@/api/godownsApi";
import { getInventoryMaster, type InventoryMasterRow } from "@/api/inventoryMasterApi";

// ─── Godown Stock Panel (inline, below the card) ─────────────────────────────
export function GodownStockPanel({
  godown,
  onClose,
}: {
  godown: Godown;
  onClose: () => void;
}) {
  const today = new Date().toISOString().split("T")[0];

  const { data, isLoading, isError } = useQuery({
    queryKey: ["godown-stock", godown.GodownID],
    queryFn: () => getInventoryMaster(today, godown.GodownID),
    staleTime: 60_000,
  });

  const allItems: InventoryMasterRow[] = data?.data ?? [];
  const items = allItems
    .filter((r) => r.ClosingStock > 0)
    .sort((a, b) => b.ClosingStock - a.ClosingStock);
  const zeroItems = allItems.filter((r) => r.ClosingStock <= 0);
  const totalIn = allItems.reduce((s, r) => s + (r.StockIn ?? 0), 0);
  const totalOut = allItems.reduce((s, r) => s + (r.StockOut ?? 0), 0);

  return (
    <div className="col-span-full rounded-2xl border border-emerald-500/30 bg-card shadow-lg overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-border flex items-center justify-between bg-emerald-500/5">
        <div className="flex items-center gap-2.5">
          <Warehouse size={15} className="text-emerald-600" />
          <span className="text-sm font-heading font-bold text-foreground">
            {godown.GodownName}
          </span>
          {godown.GodownCode && (
            <span className="text-[0.625rem] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
              {godown.GodownCode}
            </span>
          )}
          <span className="text-[0.6875rem] text-muted-foreground">
            — current stock
          </span>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-muted transition-colors"
        >
          <X size={14} className="text-muted-foreground" />
        </button>
      </div>

      {/* Summary strip */}
      {!isLoading && !isError && (
        <div className="px-5 py-2.5 border-b border-border flex gap-5 bg-muted/5">
          <div className="flex items-center gap-1.5">
            <Boxes size={12} className="text-emerald-500" />
            <span className="text-xs font-bold text-foreground">
              {items.length}
            </span>
            <span className="text-[0.6875rem] text-muted-foreground">in stock</span>
          </div>
          <div className="flex items-center gap-1.5">
            <TrendingUp size={12} className="text-emerald-500" />
            <span className="text-xs font-bold text-foreground">
              {totalIn.toLocaleString()}
            </span>
            <span className="text-[0.6875rem] text-muted-foreground">in</span>
          </div>
          <div className="flex items-center gap-1.5">
            <TrendingDown size={12} className="text-orange-500" />
            <span className="text-xs font-bold text-foreground">
              {totalOut.toLocaleString()}
            </span>
            <span className="text-[0.6875rem] text-muted-foreground">out</span>
          </div>
        </div>
      )}

      {/* Body */}
      {isLoading && (
        <div className="p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-3 px-4 py-3 rounded-xl border border-border animate-pulse"
            >
              <div className="w-7 h-7 rounded-lg bg-muted shrink-0" />
              <div className="flex-1 space-y-1.5">
                <div className="h-2.5 bg-muted rounded w-2/3" />
                <div className="h-2 bg-muted rounded w-1/4" />
              </div>
              <div className="h-5 w-12 bg-muted rounded" />
            </div>
          ))}
        </div>
      )}

      {isError && (
        <div className="m-5 flex items-center gap-2 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-600 text-xs">
          <AlertCircle size={13} /> Failed to load stock data.
        </div>
      )}

      {!isLoading && !isError && items.length === 0 && (
        <div className="flex items-center gap-3 py-8 justify-center text-center">
          <PackageOpen size={18} className="text-muted-foreground/40" />
          <p className="text-xs text-muted-foreground">
            No stock in this godown yet.
          </p>
        </div>
      )}

      {!isLoading && !isError && items.length > 0 && (
        <div className="p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {items.map((item) => {
            const utilPct =
              item.StockIn > 0
                ? Math.min(
                    100,
                    Math.round((item.ClosingStock / item.StockIn) * 100),
                  )
                : 0;
            return (
              <div
                key={item.ItemID}
                className="flex items-center gap-3 px-4 py-3 rounded-xl border border-border bg-background hover:border-emerald-500/30 transition-all"
              >
                <div className="w-7 h-7 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0">
                  <Archive size={12} className="text-emerald-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-foreground truncate">
                    {item.ItemName || item.ItemID}
                  </p>
                  {item.ItemGroupName && (
                    <p className="text-[0.625rem] text-muted-foreground truncate">
                      {item.ItemGroupName}
                    </p>
                  )}
                  <div className="mt-1 h-1 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-emerald-500/60"
                      style={{ width: `${utilPct}%` }}
                    />
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs font-bold font-mono text-emerald-600">
                    {item.ClosingStock.toLocaleString()}
                  </p>
                  <p className="text-[0.625rem] text-muted-foreground">
                    {item.UOMSymbol || item.UOMCode || ""}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!isLoading && zeroItems.length > 0 && (
        <p className="text-[0.625rem] text-muted-foreground text-center pb-4">
          + {zeroItems.length} item{zeroItems.length > 1 ? "s" : ""} with zero
          stock not shown
        </p>
      )}
    </div>
  );
}
