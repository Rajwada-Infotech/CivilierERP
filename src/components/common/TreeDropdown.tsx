import React, { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  ChevronRight,
  ChevronDown,
  FolderOpen,
  Folder,
  Layers,
} from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TreeNode {
  _id: string;
  name: string;
  code: string;
  children: TreeNode[];
}

interface FlatOption {
  value: string;
  label: string;
}

interface AccountGroup {
  _id: string;
  name: string;
  code: string;
  parentId: string | null;
}

interface TreeDropdownProps {
  /** "tree" for hierarchical parent-group selector, "flat" for simple picklist */
  variant: "tree" | "flat";
  /** Currently selected value (id or empty string) */
  value: string;
  /** Called when user selects an item */
  onChange: (id: string) => void;
  /** Placeholder text when nothing is selected */
  placeholder?: string;
  /** Visual error state — red border */
  error?: boolean;
  // ── Flat-mode props ──
  /** Options for flat variant */
  options?: FlatOption[];
  /** Optional icon shown inside the trigger button (flat variant only) */
  icon?: React.ReactNode;
  // ── Tree-mode props ──
  /** Tree nodes for the hierarchical variant */
  items?: TreeNode[];
  /** IDs that should appear disabled (self + descendants during edit) */
  invalidParents?: Set<string>;
  /** All flat groups (needed to look up selected group name/code/children) */
  allGroups?: AccountGroup[];
  /** Open the panel above the trigger instead of below */
  dropUp?: boolean;
}

// ─── Tree Node (internal recursive component) ─────────────────────────────────

function TreeNodeRow({
  node,
  depth,
  openNodes,
  onToggleNode,
  selectedId,
  onSelect,
  invalidParents,
}: {
  node: TreeNode;
  depth: number;
  openNodes: Set<string>;
  onToggleNode: (id: string) => void;
  selectedId: string;
  onSelect: (id: string) => void;
  invalidParents: Set<string>;
}) {
  const hasChildren = node.children.length > 0;
  const isOpen = openNodes.has(node._id);
  const isSelected = selectedId === node._id;
  const isDisabled = invalidParents.has(node._id);

  return (
    <>
      <div
        className={`flex items-center select-none transition-colors rounded-md ${
          isDisabled
            ? "opacity-40 cursor-not-allowed"
            : isSelected
              ? "bg-primary/10 text-primary"
              : "hover:bg-muted/60 text-foreground"
        }`}
        style={{ paddingLeft: `${depth * 16}px` }}
      >
        {/* Chevron button — expands/collapses children only */}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); if (hasChildren) onToggleNode(node._id); }}
          className={`w-8 h-8 flex items-center justify-center shrink-0 rounded transition-colors hover:bg-muted/80 ${
            hasChildren ? "text-muted-foreground cursor-pointer" : "opacity-0 pointer-events-none"
          }`}
        >
          {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>

        {/* Label area — clicking here SELECTS this node */}
        <div
          className={`flex items-center gap-2 flex-1 py-1.5 pr-2 min-w-0 ${isDisabled ? "cursor-not-allowed" : "cursor-pointer"}`}
          onClick={() => { if (!isDisabled) { onSelect(node._id); if (hasChildren && !isOpen) onToggleNode(node._id); } }}
        >
          {hasChildren ? (
            <FolderOpen size={13} className="text-amber-500 shrink-0" />
          ) : depth === 0 ? (
            <Layers size={13} className="text-primary/60 shrink-0" />
          ) : (
            <Folder size={13} className="text-muted-foreground/50 shrink-0" />
          )}

          <span
            className={`text-sm flex-1 truncate ${
              depth === 0 ? "font-semibold" : "font-medium"
            }`}
          >
            {node.name}
          </span>
          <span className="font-mono text-[10px] text-muted-foreground shrink-0 ml-1">
            {node.code}
          </span>
        </div>
      </div>

      {/* Children — rendered only when open */}
      {hasChildren && isOpen && (
        <div>
          {node.children.map((child) => (
            <TreeNodeRow
              key={child._id}
              node={child}
              depth={depth + 1}
              openNodes={openNodes}
              onToggleNode={onToggleNode}
              selectedId={selectedId}
              onSelect={onSelect}
              invalidParents={invalidParents}
            />
          ))}
        </div>
      )}
    </>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

const TreeDropdown: React.FC<TreeDropdownProps> = ({
  variant,
  value,
  onChange,
  placeholder = "— Top-level group (no parent)",
  error,
  // flat
  options = [],
  icon,
  // tree
  items = [],
  invalidParents = new Set<string>(),
  allGroups = [],
  dropUp = false,
}) => {
  const [open, setOpen] = useState(false);
  const [openNodes, setOpenNodes] = useState<Set<string>>(new Set());
  const [panelStyle, setPanelStyle] = useState<React.CSSProperties>({});
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const { theme } = useTheme();
  const isDark = theme !== "light";

  const recalcPosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    // Flat lists are short and fixed-size — estimate their real height
    // (placeholder row + one row per option) instead of assuming the same
    // 360px a deep/expandable tree might need. Using the tree's worst-case
    // height for a 5-item flat list was flipping it to open upward (and
    // clipping against the viewport top) even when there was plenty of
    // room below the trigger.
    const panelHeight =
      variant === "flat" ? Math.min(360, 42 + options.length * 36 + 8) : 360;
    const above = spaceBelow < panelHeight && spaceAbove > spaceBelow;
    const maxH = above
      ? Math.min(panelHeight, spaceAbove - 8)
      : Math.min(panelHeight, spaceBelow - 8);
    setPanelStyle({
      position: "fixed",
      top: above ? rect.top - maxH - 4 : rect.bottom + 4,
      left: rect.left,
      width: Math.max(rect.width, 260),
      // Both maxHeight AND height: without an explicit height, the panel
      // shrinks to its content and maxHeight never actually binds, which is
      // harmless — except the "content" here is the inner scroll region's
      // own max-h-72, an independent, usually-smaller cap. That mismatch
      // left a dead gap between the last visible row and the panel's
      // rounded bottom edge. Pinning height too — paired with the inner
      // region switching to flex-1 (below) instead of max-h-72 — makes the
      // inner region fill exactly this box, so it either scrolls flush to
      // the edge or (short lists) simply doesn't need to.
      height: maxH,
      maxHeight: maxH,
      zIndex: 9999,
    });
  }, [variant, options.length]);

  useEffect(() => {
    if (open) recalcPosition();
  }, [open, recalcPosition]);

  // Close on outside click or scroll
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const inTrigger = containerRef.current?.contains(e.target as Node);
      const inPanel = panelRef.current?.contains(e.target as Node);
      if (!inTrigger && !inPanel) setOpen(false);
    };
    const scrollHandler = (e: Event) => {
      // composedPath includes every ancestor of the scroll target — reliable even for portals
      if (panelRef.current && e.composedPath().includes(panelRef.current)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    window.addEventListener("scroll", scrollHandler, { passive: true, capture: true });
    window.addEventListener("resize", recalcPosition);
    return () => {
      document.removeEventListener("mousedown", handler);
      window.removeEventListener("scroll", scrollHandler, true);
      window.removeEventListener("resize", recalcPosition);
    };
  }, [open, recalcPosition]);

  const toggleNode = (id: string) =>
    setOpenNodes((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  // ── Tree variant helpers ──
  const selectedGroup =
    variant === "tree"
      ? allGroups.find((g) => g._id === value) ?? null
      : null;

  const hasChildren =
    variant === "tree" && selectedGroup
      ? allGroups.some((g) => g.parentId === selectedGroup._id)
      : false;

  // ── Flat variant selection display ──
  const flatSelected =
    variant === "flat" ? options.find((o) => o.value === value) : null;

  return (
    <div className="relative" ref={containerRef}>
      {/* ── Trigger button ── */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-sm rounded-lg border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition text-left ${
          error ? "border-red-400" : "border-border"
        }`}
      >
        {/* Tree variant: icon based on selection type */}
        {variant === "tree" &&
          (selectedGroup ? (
            hasChildren ? (
              <FolderOpen size={14} className="text-amber-500 shrink-0" />
            ) : (
              <Folder size={14} className="text-muted-foreground/60 shrink-0" />
            )
          ) : (
            <Layers size={14} className="text-primary/50 shrink-0" />
          ))}

        {/* Flat variant: custom icon */}
        {variant === "flat" && icon && (
          <span className="shrink-0 text-muted-foreground">{icon}</span>
        )}

        {/* Label */}
        {variant === "tree" && selectedGroup ? (
          <span className="flex-1 truncate font-medium text-foreground">
            {selectedGroup.name}
            <span className="font-mono font-normal text-muted-foreground ml-1.5 text-xs">
              ({selectedGroup.code})
            </span>
          </span>
        ) : variant === "tree" ? (
          <span className="flex-1 truncate text-muted-foreground/70">
            {placeholder}
          </span>
        ) : (
          <span
            className={`flex-1 truncate ${
              flatSelected
                ? "text-foreground font-medium"
                : "text-muted-foreground/70"
            }`}
          >
            {flatSelected ? flatSelected.label : placeholder}
          </span>
        )}

        <ChevronDown
          size={14}
          className={`text-muted-foreground shrink-0 transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {/* ── Dropdown panel (portal — escapes overflow:hidden parents; renders
          on document.body outside any module-scoped ancestor, so it uses
          explicit colors rather than bg-card/border-border — the same
          reasoning as the ModuleStrip tooltip fix — to avoid the theme
          tokens resolving unreliably and falling back to the browser's
          native (unstyled, thick-scrollbar) list rendering). ── */}
      {open && createPortal(
        <div
          ref={panelRef}
          style={{
            ...panelStyle,
            background: isDark ? "rgba(30,32,48,0.98)" : "rgba(255,255,255,0.98)",
            border: isDark ? "1px solid rgba(255,255,255,0.12)" : "1px solid rgba(15,17,26,0.10)",
            boxShadow: isDark
              ? "0 12px 32px rgba(0,0,0,0.5)"
              : "0 12px 32px rgba(15,17,26,0.16)",
          }}
          className="rounded-lg overflow-hidden flex flex-col"
        >
          {variant === "tree" ? (
            /* ── Tree panel ── */
            <>
              {/* Top-level option */}
              <div
                className={`shrink-0 flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors text-sm font-medium ${
                  !value
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted/60"
                }`}
                onClick={() => {
                  onChange("");
                  setOpen(false);
                }}
              >
                <Layers size={13} className="shrink-0" />
                <span>{placeholder}</span>
              </div>
              <div className="shrink-0 border-t border-border/60" />

              {/* Tree nodes — flex-1 (not a fixed max-h) so this fills
                  exactly the height the outer panel already computed,
                  instead of an independent, usually-smaller hardcoded cap
                  that left dead space below the last row. */}
              <div className="flex-1 min-h-0 overflow-y-auto py-1 px-1 thin-scroll">
                {items.map((node) => (
                  <TreeNodeRow
                    key={node._id}
                    node={node}
                    depth={0}
                    openNodes={openNodes}
                    onToggleNode={toggleNode}
                    selectedId={value}
                    onSelect={(id) => {
                      onChange(id);
                      setOpen(false);
                    }}
                    invalidParents={invalidParents}
                  />
                ))}
              </div>
            </>
          ) : (
            /* ── Flat panel — sole child, so flex-1 makes it consume the
                whole outer box exactly (see tree-panel comment above). ── */
            <div className="flex-1 min-h-0 overflow-y-auto py-1 thin-scroll">
              {/* Placeholder / clear option */}
              <div
                className={`px-3 py-2 text-sm cursor-pointer transition-colors ${
                  !value
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:bg-muted/60"
                }`}
                onClick={() => {
                  onChange("");
                  setOpen(false);
                }}
              >
                {placeholder}
              </div>
              <div className="border-t border-border/40 mb-1" />

              {/* Options */}
              {options.map((o) => (
                <div
                  key={o.value}
                  className={`px-3 py-2 text-sm cursor-pointer transition-colors ${
                    value === o.value
                      ? "bg-primary/10 text-primary font-medium"
                      : "text-foreground hover:bg-muted/60"
                  }`}
                  onClick={() => {
                    onChange(o.value);
                    setOpen(false);
                  }}
                >
                  {o.label}
                </div>
              ))}
            </div>
          )}
        </div>,
        document.body
      )}
    </div>
  );
};

export default TreeDropdown;