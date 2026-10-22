import { useState, useMemo, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { Trash2, Search } from "lucide-react";
import { fmtNum, TItem, AvailableItem } from "./config";

// ─── Item Search Row ──────────────────────────────────────────────────────────
export function ItemSearchRow({
  item,
  idx,
  onUpdate,
  onRemove,
  availableItems,
  isLoadingStock,
}: {
  item: TItem;
  idx: number;
  onUpdate: (idx: number, patch: Partial<TItem>) => void;
  onRemove: (idx: number) => void;
  availableItems: AvailableItem[];
  isLoadingStock: boolean;
}) {
  const [search, setSearch] = useState(item.itemName || "");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // The list is portalled to <body> and positioned from the input's rect: the
  // items table sits in an overflow-x-auto wrapper that would otherwise clip it.
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; width: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    const place = () => {
      const r = containerRef.current?.getBoundingClientRect();
      if (r) setMenuPos({ top: r.bottom + 4, left: r.left, width: r.width });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  const filtered = useMemo(() => {
    if (!search.trim()) return availableItems;
    const q = search.toLowerCase();
    return availableItems
      .filter((a) => a.itemName.toLowerCase().includes(q))
      .slice(0, 12);
  }, [search, availableItems]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (
        containerRef.current &&
        !containerRef.current.contains(t) &&
        !menuRef.current?.contains(t)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const selectItem = (a: AvailableItem) => {
    onUpdate(idx, {
      itemId: a.itemId,
      itemName: a.itemName,
      uom: a.uom,
      availableQty: a.available,
      faTagIds: [],
    });
    setSearch(a.itemName);
    setOpen(false);
  };

  const qtyNum = parseFloat(item.qty) || 0;
  // With live stock known, running out (0 available) is a shortage too — the
  // old "> 0" guard treated "no stock at all" as "unknown" and let it through.
  const overLimit = !!item.stockShort || (qtyNum > item.availableQty && (item.availableQty > 0 || !!item.stockKnown));
  const overMrPending = item.mrPendingQty != null && qtyNum - item.mrPendingQty > 0.0001;

  return (
    <div
      className={`grid grid-cols-12 gap-2 items-start p-3 rounded-xl border transition-colors ${
        overLimit
          ? "border-red-400/40 bg-red-500/5"
          : "border-border bg-muted/20"
      }`}
    >
      {/* # */}
      <div className="col-span-1 flex items-center h-9 text-xs font-mono text-muted-foreground">
        {idx + 1}
      </div>

      {/* Item search */}
      <div className="col-span-5 relative" ref={containerRef}>
        <div className="relative">
          <Search
            size={12}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setOpen(true);
              if (!e.target.value) {
                onUpdate(idx, {
                  itemId: "",
                  itemName: "",
                  uom: "",
                  availableQty: 0,
                });
              }
            }}
            onFocus={() => setOpen(true)}
            placeholder={isLoadingStock ? "Loading items…" : "Search item…"}
            disabled={isLoadingStock}
            className="w-full pl-8 pr-3 py-2 rounded-lg border border-border bg-background text-xs text-foreground outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500/50 disabled:opacity-60"
          />
        </div>

        {open && menuPos && createPortal(
          <div
            ref={menuRef}
            style={{ position: "fixed", top: menuPos.top, left: menuPos.left, width: menuPos.width }}
            className="z-[100] rounded-lg border border-border bg-popover shadow-lg overflow-hidden"
          >
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-xs text-muted-foreground text-center">
                {search.trim()
                  ? `No items match "${search}"`
                  : "No items in stock"}
              </div>
            ) : (
              <div className="max-h-52 overflow-y-auto">
                {filtered.map((a) => (
                  <button
                    key={a.itemId}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      selectItem(a);
                    }}
                    className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-muted/60 text-left transition-colors border-b border-border/40 last:border-0"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-foreground truncate">
                        {a.itemName}
                      </p>
                      <p className="text-[0.625rem] text-muted-foreground mt-0.5">
                        {a.uom}
                      </p>
                    </div>
                    <span
                      className={`text-[0.625rem] font-semibold px-1.5 py-0.5 rounded-full shrink-0 ml-2 ${
                        a.available > 0
                          ? "bg-emerald-500/10 text-emerald-600"
                          : "bg-red-500/10 text-red-500"
                      }`}
                    >
                      {fmtNum(a.available)} {a.uom}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>,
          document.body,
        )}
      </div>

      {/* Available badge */}
      <div className="col-span-1 flex items-center h-9">
        {item.itemId && (
          <span
            className={`text-[0.625rem] px-1.5 py-0.5 rounded-full font-semibold whitespace-nowrap ${
              item.stockKnown && (item.availableQty <= 0 || item.stockShort)
                ? "text-red-600 bg-red-500/10"
                : "text-emerald-600 bg-emerald-500/10"
            }`}
          >
            {fmtNum(item.availableQty)}
          </span>
        )}
      </div>

      {/* Qty */}
      <div className="col-span-2">
        <input
          type="number"
          min="0.01"
          step="any"
          value={item.qty}
          onChange={(e) => onUpdate(idx, { qty: e.target.value })}
          placeholder={item.isFa ? "Pick codes ↓" : "Qty"}
          readOnly={!!item.isFa}
          title={item.isFa ? "Quantity follows the FA Item Codes selected below" : undefined}
          disabled={!item.itemId}
          className={`w-full px-2 py-2 rounded-lg border text-xs text-foreground bg-background outline-none disabled:opacity-50 ${
            overLimit || overMrPending ? "border-red-400" : "border-border"
          }`}
        />
        {overLimit && (
          <p className="text-[0.625rem] text-red-500 mt-0.5">
            {item.stockKnown && item.availableQty <= 0
              ? "Out of stock in source godown"
              : `Only ${fmtNum(item.availableQty)} in stock — short by ${fmtNum(Math.max(0, qtyNum - item.availableQty))}`}
          </p>
        )}
        {overMrPending && (
          <p className="text-[0.625rem] text-red-500 mt-0.5">
            Max: {fmtNum(item.mrPendingQty!)} (MR pending)
          </p>
        )}
      </div>

      {/* UOM */}
      <div className="col-span-2">
        <input
          value={item.uom}
          readOnly
          placeholder="UOM"
          className="w-full px-2 py-2 rounded-lg border border-border bg-muted text-xs text-muted-foreground outline-none"
        />
      </div>

      {/* Remove */}
      <div className="col-span-1 flex items-center justify-center h-9">
        <button
          onClick={() => onRemove(idx)}
          className="p-1.5 rounded-lg hover:bg-red-500/10 text-muted-foreground hover:text-red-500 transition-colors"
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
}
