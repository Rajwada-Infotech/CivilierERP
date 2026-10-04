import React from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Search } from "lucide-react";

export interface PickableItem {
  id: string;
  name: string;
  itemType?: string;
}

const TAB_LABELS: Record<"Goods" | "Service" | "FixedAsset", string> = {
  Goods: "Goods",
  Service: "Service",
  FixedAsset: "Fixed Asset",
};

export function ItemPicker({
  items,
  value,
  onChange,
  className = "",
}: {
  items: PickableItem[];
  value: string;
  onChange: (id: string) => void;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [tab, setTab] = React.useState<"Goods" | "Service" | "FixedAsset">("Goods");
  const [pos, setPos] = React.useState({
    top: 0,
    bottom: null as number | null,
    left: 0,
    width: 0,
    maxHeight: 420,
  });
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);

  // The trigger sits inside a table wrapped in overflow-x-auto, which clips
  // any absolutely-positioned child that spills past its bounds — so the
  // panel is portaled to <body> and positioned via the trigger's own rect
  // instead of relying on CSS `absolute` inside that scroll container.
  // Position is re-read every animation frame (not just on scroll/resize
  // events) so it stays glued to the trigger with zero lag, including on
  // nested-scroll-container scrolls that don't bubble a window "scroll".
  //
  // It also flips above the trigger when there isn't enough room below —
  // previously this always opened downward regardless of where the row
  // sat on screen, so a picker near the bottom of the viewport (or inside
  // a short modal) opened off-screen with no way to see or scroll to the
  // item list. When flipped, the panel is anchored by `bottom` (not a
  // computed `top`) so it grows upward from the trigger regardless of the
  // list's actual rendered height, and `maxHeight` is clamped to whichever
  // side (above/below) has more room so the item list stays scrollable
  // and never spills past the viewport edge.
  const MARGIN = 8;
  const MIN_PANEL_HEIGHT = 220;
  const PREFERRED_PANEL_HEIGHT = 420;

  const updatePosition = React.useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.max(rect.width, 420);
    let left = rect.left;
    if (left + width > window.innerWidth - MARGIN) left = window.innerWidth - width - MARGIN;
    if (left < MARGIN) left = MARGIN;

    const spaceBelow = window.innerHeight - rect.bottom - MARGIN;
    const spaceAbove = rect.top - MARGIN;
    const openUpward = spaceBelow < MIN_PANEL_HEIGHT && spaceAbove > spaceBelow;
    const available = openUpward ? spaceAbove : spaceBelow;
    const maxHeight = Math.max(MIN_PANEL_HEIGHT, Math.min(PREFERRED_PANEL_HEIGHT, available));

    setPos(
      openUpward
        ? { top: 0, bottom: window.innerHeight - rect.top + 4, left, width, maxHeight }
        : { top: rect.bottom + 4, bottom: null, left, width, maxHeight },
    );
  }, []);

  React.useEffect(() => {
    if (!open) return;
    let raf: number;
    const loop = () => {
      updatePosition();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    function handleClick(e: MouseEvent) {
      if (
        triggerRef.current?.contains(e.target as Node) ||
        panelRef.current?.contains(e.target as Node)
      )
        return;
      setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("mousedown", handleClick);
    };
  }, [open, updatePosition]);

  const byType = React.useMemo(() => {
    const groups: Record<"Goods" | "Service" | "FixedAsset", PickableItem[]> = {
      Goods: [],
      Service: [],
      FixedAsset: [],
    };
    for (const item of items) {
      const bucket = item.itemType === "Goods" ? "Goods" : item.itemType === "Service" ? "Service" : "FixedAsset";
      groups[bucket].push(item);
    }
    return groups;
  }, [items]);

  // Land on the first non-empty tab instead of a blank "Goods" panel.
  React.useEffect(() => {
    if (byType.Goods.length > 0) return;
    if (byType.Service.length > 0) {
      setTab("Service");
    } else if (byType.FixedAsset.length > 0) {
      setTab("FixedAsset");
    }
  }, [byType]);

  const selected = items.find((i) => i.id === value);

  const filtered = byType[tab].filter((i) =>
    !search || i.name.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className={`relative ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-sm bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary hover:border-primary/40 transition-colors"
      >
        <span className={`truncate ${selected ? "text-foreground" : "text-muted-foreground"}`}>
          {selected ? selected.name : "— Select Item —"}
        </span>
        <ChevronDown size={13} className={`shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open &&
        createPortal(
          <div
            ref={panelRef}
            style={{
              position: "fixed",
              ...(pos.bottom != null ? { bottom: pos.bottom } : { top: pos.top }),
              left: pos.left,
              width: pos.width,
              maxHeight: pos.maxHeight,
            }}
            className="z-[100] flex flex-col bg-card border border-border rounded-xl shadow-xl overflow-hidden"
          >
            <div className="flex border-b border-border shrink-0">
              {(["Goods", "Service", "FixedAsset"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => { setTab(t); setSearch(""); }}
                  className={`flex-1 py-2 text-xs font-semibold transition-colors ${
                    tab === t
                      ? "border-b-2 border-primary text-primary"
                      : "text-muted-foreground hover:text-foreground border-b-2 border-transparent"
                  }`}
                >
                  {TAB_LABELS[t]} ({byType[t].length})
                </button>
              ))}
            </div>

            <div className="p-2 border-b border-border shrink-0">
              <div className="relative">
                <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  autoFocus
                  type="text"
                  placeholder="Search item…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-7 pr-3 py-1.5 text-sm bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-border/50 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {filtered.length === 0 ? (
                <div className="px-4 py-6 text-center text-xs text-muted-foreground">No items found</div>
              ) : (
                filtered.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      onChange(item.id);
                      setOpen(false);
                      setSearch("");
                    }}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors ${
                      item.id === value ? "bg-primary/10 text-primary font-medium" : "text-foreground"
                    }`}
                  >
                    {item.name}
                  </button>
                ))
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
