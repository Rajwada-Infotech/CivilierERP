import React, { useState, useMemo, useRef, useEffect } from "react";
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
}: {
  node: AccountGroupTreeNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  selected: string;
  onSelect: (id: string) => void;
  invalidParents: Set<string>;
}) {
  const isInvalid = invalidParents.has(node._id);
  const isExpanded = expanded.has(node._id);
  const hasChildren = node.children.length > 0;
  const isSelected = selected === node._id;

  return (
    <>
      <div
        className={`flex items-center gap-0 select-none group/node ${isInvalid ? "opacity-30 pointer-events-none" : "cursor-pointer"}`}
        style={{ paddingLeft: depth * 12 + 4 }}
        onClick={() => {
          if (isInvalid) return;
          if (hasChildren) onToggle(node._id);
          onSelect(node._id);
        }}
      >
        <span className="w-5 h-6 flex items-center justify-center shrink-0 text-muted-foreground/50">
          {hasChildren ? (
            isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />
          ) : null}
        </span>
        <span className="w-4 h-6 flex items-center shrink-0">
          {hasChildren
            ? <FolderOpen size={13} className={isExpanded ? "text-amber-400" : "text-amber-500/70"} />
            : depth === 0
              ? <Layers size={12} className="text-primary/50" />
              : <Folder size={12} className="text-muted-foreground/40" />
          }
        </span>
        <div
          className={`flex-1 flex items-center justify-between px-1.5 py-1 mx-0.5 rounded text-xs transition-colors ${
            isSelected
              ? "bg-primary/15 text-primary font-semibold"
              : "text-foreground/80 hover:bg-muted/60 group-hover/node:text-foreground"
          }`}
        >
          <span className="truncate">{node.name}</span>
          <span className="font-mono text-[9px] text-muted-foreground/50 ml-2 shrink-0">{node.code}</span>
        </div>
      </div>

      {isExpanded && hasChildren && (
        <div className="relative" style={{ marginLeft: depth * 12 + 13 }}>
          <div className="absolute left-0 top-0 bottom-0 w-px bg-border/40" />
          <div>
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
        className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg border bg-background hover:border-primary/40 text-sm transition-colors text-left focus:outline-none focus:ring-2 focus:ring-primary/20 ${
          error ? "border-red-400" : "border-border"
        }`}
      >
        <span className={`flex items-center gap-2 min-w-0 ${selectedName ? "text-foreground" : "text-muted-foreground/50"}`}>
          {selectedName ? (
            <><FolderOpen size={13} className="text-amber-500 shrink-0" /><span className="truncate">{selectedName}</span></>
          ) : (
            <><Layers size={13} className="text-muted-foreground/40 shrink-0" />{placeholder}</>
          )}
        </span>
        <ChevronsUpDown size={13} className={`text-muted-foreground/40 shrink-0 transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
      </button>

      {open && createPortal(
        <div
          ref={panelRef}
          style={panelStyle}
          className={`flex flex-col rounded-xl border border-border bg-card shadow-2xl overflow-hidden transition-all duration-150 origin-top ${
            closing ? "opacity-0 scale-y-95" : "opacity-100 scale-y-100 animate-in fade-in-0 zoom-in-95"
          }`}
        >
          <div className="px-3 py-2.5 border-b border-border/60 shrink-0">
            <div className="relative">
              <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/50 pointer-events-none" />
              <input
                ref={searchRef}
                value={pickerSearch}
                onChange={(e) => setPickerSearch(e.target.value)}
                placeholder="Search by name or code…"
                className="w-full text-xs pl-7 pr-7 py-1.5 rounded-md bg-muted/40 border border-border/60 text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/30"
              />
              {pickerSearch && (
                <button onClick={() => setPickerSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/40 hover:text-muted-foreground">
                  <X size={10} />
                </button>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto py-1 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
            <div
              className={`flex items-center gap-2 px-3 py-1.5 mx-1 rounded text-xs cursor-pointer transition-colors mb-0.5 ${
                value === "" ? "bg-primary/15 text-primary font-semibold" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              }`}
              onClick={() => handleSelect("")}
            >
              <Layers size={10} className="shrink-0" />
              <span>{placeholder}</span>
            </div>
            <div className="h-px bg-border/40 mx-3 mb-1" />

            {searchResults ? (
              searchResults.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-8">No groups match "{pickerSearch}"</p>
              ) : (
                searchResults.map((g) => (
                  <div
                    key={g._id}
                    className={`flex items-center gap-2 px-3 py-1.5 mx-1 rounded text-xs cursor-pointer transition-colors ${
                      value === g._id ? "bg-primary/15 text-primary font-semibold" : "hover:bg-muted/60"
                    }`}
                    onClick={() => handleSelect(g._id)}
                  >
                    <CornerDownRight size={9} className="text-muted-foreground/40 shrink-0" />
                    <span className="flex-1 truncate">{g.name}</span>
                    <span className="font-mono text-[9px] text-muted-foreground/50 shrink-0">{g.code}</span>
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
                />
              ))
            )}
          </div>
        </div>
      , document.body)}
    </>
  );
}
