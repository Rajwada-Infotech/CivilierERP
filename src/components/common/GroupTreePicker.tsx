import React, { useState, useMemo, useRef, useEffect } from "react";
import { useInSheet } from "@/components/sheet/useInSheet";
import { createPortal } from "react-dom";
import {
  ChevronDown,
  ChevronRight,
  FolderOpen,
  Folder,
  Layers,
  Search,
  X,
  ChevronsUpDown,
  CornerDownRight,
} from "lucide-react";

export interface AccountGroupItem {
  _id: string;
  name: string;
  code: string;
  parentId: string | null;
}

export interface AccountGroupTreeNode extends AccountGroupItem {
  children: AccountGroupTreeNode[];
}

export function buildAccountGroupTree(items: AccountGroupItem[]): AccountGroupTreeNode[] {
  const map: Record<string, AccountGroupTreeNode> = {};
  items.forEach((i) => (map[i._id] = { ...i, children: [] }));
  const roots: AccountGroupTreeNode[] = [];
  items.forEach((i) => {
    if (i.parentId && map[i.parentId]) map[i.parentId].children.push(map[i._id]);
    else roots.push(map[i._id]);
  });
  return roots;
}

function TreePickerNode({
  node,
  depth,
  expanded,
  onToggle,
  selected,
  onSelect,
  invalidParents,
  sheet,
}: {
  node: AccountGroupTreeNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  selected: string;
  onSelect: (id: string) => void;
  invalidParents: Set<string>;
  sheet: boolean;
}) {
  const isInvalid = invalidParents.has(node._id);
  const isExpanded = expanded.has(node._id);
  const hasChildren = node.children.length > 0;
  const isSelected = selected === node._id;

  return (
    <>
      <div
        className={`flex items-center gap-0 select-none group/node ${isInvalid ? "opacity-30 pointer-events-none" : ""}`}
        style={{ paddingLeft: depth * 12 + 4 }}
      >
        {/* Expand/collapse only — separate from selection so opening a
            folder never also picks it and closes the dropdown. */}
        <span
          className={`w-6 h-8 flex items-center justify-center shrink-0 cursor-pointer ${sheet ? "text-foreground" : "text-muted-foreground/50"}`}
          onClick={(e) => {
            e.stopPropagation();
            if (isInvalid || !hasChildren) return;
            onToggle(node._id);
          }}
        >
          {hasChildren ? (
            isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />
          ) : null}
        </span>
        {!sheet && <span className="w-4 h-8 flex items-center shrink-0">
          {hasChildren
            ? <FolderOpen size={13} className={isExpanded ? "text-amber-400" : "text-amber-500/70"} />
            : depth === 0
              ? <Layers size={12} className="text-primary/50" />
              : <Folder size={12} className="text-muted-foreground/40" />
          }
        </span>}
        <div
          className={`flex-1 flex items-center justify-between px-2 py-2 mx-0.5 my-0.5 text-xs transition-colors cursor-pointer ${sheet ? "" : "rounded"} ${
            isSelected
              ? sheet ? "bg-foreground text-card font-semibold" : "bg-primary/15 text-primary font-semibold"
              : sheet
                ? `text-foreground hover:bg-primary/10 ${depth === 0 ? "font-heading font-semibold uppercase tracking-[0.08em] text-[0.6875rem]" : ""}`
                : "text-foreground/80 hover:bg-muted/60 group-hover/node:text-foreground"
          }`}
          onClick={() => {
            if (isInvalid) return;
            onSelect(node._id);
          }}
        >
          <span className="truncate">{node.name}</span>
          <span className={`${sheet ? "font-heading tabular-nums opacity-70 normal-case tracking-normal" : "font-mono text-muted-foreground/50"} text-[0.5625rem] ml-2 shrink-0`}>{node.code}</span>
        </div>
      </div>

      {isExpanded && hasChildren && (
        <div className="relative" style={{ marginLeft: depth * 12 + 13 }}>
          <div className="absolute left-0 top-0 bottom-0 w-px bg-border/40" />
          <div className="py-0.5">
            {node.children.map((child) => (
              <TreePickerNode
                key={child._id}
                node={child}
                depth={depth + 1}
                expanded={expanded}
                onToggle={onToggle}
                selected={selected}
                onSelect={onSelect}
                invalidParents={invalidParents}
                sheet={sheet}
              />
            ))}
          </div>
        </div>
      )}
    </>
  );
}

interface GroupTreePickerProps {
  value: string;
  onChange: (id: string) => void;
  tree: AccountGroupTreeNode[];
  allGroups: AccountGroupItem[];
  invalidParents?: Set<string>;
  placeholder?: string;
  error?: boolean;
}

export function GroupTreePicker({
  value,
  onChange,
  tree,
  allGroups,
  invalidParents = new Set(),
  placeholder = "— Top-level group (no parent)",
  error,
}: GroupTreePickerProps) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [pickerExpanded, setPickerExpanded] = useState<Set<string>>(new Set());
  const [pickerSearch, setPickerSearch] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [panelStyle, setPanelStyle] = useState<React.CSSProperties>({});
  // On a drawing-sheet page the picker is squared and inked to match; elsewhere it is drawn as before.
  const sheet = useInSheet(triggerRef);

  const close = () => {
    setClosing(true);
    setTimeout(() => { setOpen(false); setClosing(false); }, 160);
  };

  const reposition = () => {
    if (!triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom - 8;
    const spaceAbove = r.top - 8;
    const height = Math.min(520, Math.max(spaceBelow, spaceAbove));
    const openAbove = spaceBelow < 200 && spaceAbove > spaceBelow;
    setPanelStyle({
      position: "fixed",
      left: r.left,
      width: Math.max(r.width, 360),
      ...(openAbove
        ? { bottom: window.innerHeight - r.top + 4, maxHeight: height }
        : { top: r.bottom + 4, maxHeight: height }),
      zIndex: 9999,
    });
  };

  useEffect(() => {
    if (open) {
      reposition();
      setPickerExpanded(new Set(allGroups.filter((g) => !g.parentId).map((g) => g._id)));
      setTimeout(() => searchRef.current?.focus(), 80);
    } else {
      setPickerSearch("");
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!triggerRef.current?.contains(e.target as Node) && !panelRef.current?.contains(e.target as Node)) close();
    };
    const onScroll = (e: Event) => {
      if (panelRef.current?.contains(e.target as Node)) return;
      close();
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  const togglePickerExpand = (id: string) =>
    setPickerExpanded((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const searchResults = useMemo(() => {
    const q = pickerSearch.trim().toLowerCase();
    if (!q) return null;
    return allGroups.filter(
      (g) => !invalidParents.has(g._id) &&
        (g.name.toLowerCase().includes(q) || g.code.toLowerCase().includes(q)),
    );
  }, [pickerSearch, allGroups, invalidParents]);

  const selectedName = useMemo(
    () => (value ? allGroups.find((g) => g._id === value)?.name ?? null : null),
    [value, allGroups],
  );

  const handleSelect = (id: string) => { onChange(id); close(); };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        className={
          sheet
            ? `w-full flex items-center justify-between gap-2 px-3 py-2.5 border bg-card text-sm text-left focus:outline-none ${
                error ? "border-destructive" : open ? "border-foreground" : "border-foreground/40 hover:border-foreground focus:border-foreground"
              }`
            : `w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg border bg-background hover:border-primary/40 text-sm transition-colors text-left focus:outline-none focus:ring-2 focus:ring-primary/20 ${
                error ? "border-red-400" : "border-border"
              }`
        }
      >
        <span className={`flex items-center gap-2 min-w-0 ${selectedName ? "text-foreground" : "text-muted-foreground/50"}`}>
          {selectedName ? (
            <>{!sheet && <FolderOpen size={13} className="text-amber-500 shrink-0" />}<span className={`truncate ${sheet ? "font-medium" : ""}`}>{selectedName}</span></>
          ) : (
            <>{!sheet && <Layers size={13} className="text-muted-foreground/40 shrink-0" />}{placeholder}</>
          )}
        </span>
        <ChevronsUpDown size={13} className={`${sheet ? "text-muted-foreground" : "text-muted-foreground/40"} shrink-0 transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
      </button>

      {open && createPortal(
        <div
          ref={panelRef}
          style={sheet ? { ...panelStyle, boxShadow: "5px 5px 0 hsl(var(--foreground) / 0.12)" } : panelStyle}
          className={`relative flex flex-col bg-card overflow-hidden transition-all duration-150 origin-top ${sheet ? "border border-foreground" : "rounded-xl border border-border shadow-2xl"} ${
            closing ? "opacity-0 scale-y-95" : "opacity-100 scale-y-100 animate-in fade-in-0 zoom-in-95"
          }`}
        >
          <div className={`shrink-0 ${sheet ? "px-3 py-3 border-b border-foreground" : "px-4 py-3.5 border-b border-border/60"}`}>
            <div className="relative">
              <Search size={11} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/50 pointer-events-none" />
              <input
                ref={searchRef}
                value={pickerSearch}
                onChange={(e) => setPickerSearch(e.target.value)}
                placeholder="Search by name or code…"
                className={sheet
                  ? "w-full text-xs pl-8 pr-8 py-2.5 bg-card border border-foreground/40 focus:border-foreground text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
                  : "w-full text-xs pl-8 pr-8 py-2.5 rounded-md bg-muted/40 border border-border/60 text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/30"}
              />
              {pickerSearch && (
                <button onClick={() => setPickerSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/40 hover:text-muted-foreground">
                  <X size={10} />
                </button>
              )}
            </div>
          </div>

          {/* bottom fade hint */}
          <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-card to-transparent z-10" />

          <div className="flex-1 overflow-y-auto scroll-smooth py-2.5 [scrollbar-width:thin] [scrollbar-color:theme(colors.border)_transparent] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-border/0 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-border/60 [&::-webkit-scrollbar-thumb]:transition-colors [&::-webkit-scrollbar-thumb]:duration-300">
            <div
              className={`flex items-center gap-2 px-3 py-2 mx-1.5 text-xs cursor-pointer transition-colors mb-1 ${sheet ? "" : "rounded"} ${
                value === ""
                  ? sheet ? "bg-foreground text-card font-semibold" : "bg-primary/15 text-primary font-semibold"
                  : sheet ? "text-muted-foreground hover:bg-primary/10 hover:text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              }`}
              onClick={() => handleSelect("")}
            >
              {!sheet && <Layers size={10} className="shrink-0" />}
              <span>{placeholder}</span>
            </div>
            <div className="h-px bg-border/40 mx-3 mb-1.5" />

            {searchResults ? (
              searchResults.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-8">No groups match "{pickerSearch}"</p>
              ) : (
                searchResults.map((g) => (
                  <div
                    key={g._id}
                    className={`flex items-center gap-2 px-3 py-2 mx-1.5 text-xs cursor-pointer transition-colors ${sheet ? "" : "rounded"} ${
                      value === g._id
                        ? sheet ? "bg-foreground text-card font-semibold" : "bg-primary/15 text-primary font-semibold"
                        : sheet ? "text-foreground hover:bg-primary/10" : "hover:bg-muted/60"
                    }`}
                    onClick={() => handleSelect(g._id)}
                  >
                    {!sheet && <CornerDownRight size={9} className="text-muted-foreground/40 shrink-0" />}
                    <span className="flex-1 truncate">{g.name}</span>
                    <span className={`${sheet ? "font-heading tabular-nums opacity-70" : "font-mono text-muted-foreground/50"} text-[0.5625rem] shrink-0`}>{g.code}</span>
                  </div>
                ))
              )
            ) : (
              tree.map((node) => (
                <TreePickerNode
                  key={node._id}
                  node={node}
                  depth={0}
                  expanded={pickerExpanded}
                  onToggle={togglePickerExpand}
                  selected={value}
                  onSelect={handleSelect}
                  invalidParents={invalidParents}
                  sheet={sheet}
                />
              ))
            )}
          </div>
        </div>
      , document.body)}
    </>
  );
}
