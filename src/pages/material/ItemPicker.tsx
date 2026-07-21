import React from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Search } from "lucide-react";

export interface PickableItem {
  id: string;
  name: string;
  itemType?: string;
}

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
  const [tab, setTab] = React.useState<"Goods" | "Service" | "Other">("Goods");
  const [pos, setPos] = React.useState({ top: 0, left: 0, width: 0 });
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);

  // The trigger sits inside a table wrapped in overflow-x-auto, which clips
  // any absolutely-positioned child that spills past its bounds — so the
  // panel is portaled to <body> and positioned via the trigger's own rect
  // instead of relying on CSS `absolute` inside that scroll container.
  // Position is re-read every animation frame (not just on scroll/resize
  // events) so it stays glued to the trigger with zero lag, including on
  // nested-scroll-container scrolls that don't bubble a window "scroll".
  const updatePosition = React.useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.max(rect.width, 420);
    let left = rect.left;
    if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8;
    setPos({ top: rect.bottom + 4, left, width });
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
    const groups: Record<"Goods" | "Service" | "Other", PickableItem[]> = {
      Goods: [],
      Service: [],
      Other: [],
    };
    for (const item of items) {
      const bucket = item.itemType === "Goods" ? "Goods" : item.itemType === "Service" ? "Service" : "Other";
      groups[bucket].push(item);
    }
    return groups;
  }, [items]);

  // Land on the first non-empty tab instead of a blank "Goods" panel.
  React.useEffect(() => {
    if (byType.Goods.length > 0) return;
    if (byType.Service.length > 0) {
      setTab("Service");
    } else if (byType.Other.length > 0) {
      setTab("Other");
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
            style={{ position: "fixed", top: pos.top, left: pos.left, width: pos.width }}
            className="z-[100] bg-card border border-border rounded-xl shadow-xl overflow-hidden"
          >
            <div className="flex border-b border-border">
              {(["Goods", "Service", "Other"] as const).map((t) => (
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
                  {t} ({byType[t].length})
                </button>
              ))}
            </div>

            <div className="p-2 border-b border-border">
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

            <div className="max-h-96 overflow-y-auto divide-y divide-border/50 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
