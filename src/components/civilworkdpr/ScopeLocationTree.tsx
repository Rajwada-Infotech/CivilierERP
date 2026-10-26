// Shared Project > Block > Floor > Unit > Room collapsible tree — the same
// grouping/UI Dependency Master's own list uses (see
// src/pages/masters/DependencyMaster/components/DependencyMasterList.tsx,
// which this was extracted from), reused here so Work Allocation and
// Reporting present the exact same location hierarchy instead of each
// page having its own flat, single-level "group by chain" list.
import { storeyDisplay, storeyRank as sharedStoreyRank } from "@/lib/floorLabel";
import React, { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { ChevronRight, FolderTree, Building, Layers, Home, DoorOpen, ChevronsDownUp, ChevronsUpDown } from "lucide-react";

export interface ScopeLocatable {
  projectId: number;
  projectName?: string | null;
  towerId: number;
  towerName?: string | null;
  floor: string;
  flatId: number;
  flatName?: string | null;
  roomId: number | null;
  roomName?: string | null;
  /** A villa room's own floor inside the villa (G, 1, 2 …); null for flats. */
  storey?: string | null;
}

interface TreeNode<T> {
  key: string;
  label: string;
  children: TreeNode<T>[];
  items: T[]; // only at room level
  count: number; // items underneath
  level: number; // index into LEVELS (which icon / colour)
}

const LEVELS = [
  { icon: FolderTree, color: "text-foreground" },
  { icon: Building, color: "text-muted-foreground" },
  { icon: Layers, color: "text-muted-foreground" },
  { icon: Home, color: "text-muted-foreground" },
  { icon: DoorOpen, color: "text-foreground" },
] as const;

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const floorRank = (f: string) => (f === "G" ? -1 : Number.isFinite(Number(f)) ? Number(f) : Number.MAX_SAFE_INTEGER);
// A villa's own floors, inside the unit (the reverse of a tower).
// A villa room's own floor: shared naming/order (src/lib/floorLabel.ts).
const storeyRank = sharedStoreyRank;
const storeyLabel = storeyDisplay;
// A villa in a plotted block has no floor; its chains carry the plot label instead.
const floorLabel = (f: string) => (!f ? "No floor" : f === "G" ? "Ground Floor" : Number.isFinite(Number(f)) ? `Floor ${f}` : f);

function buildTree<T extends ScopeLocatable>(rows: T[], getCount: (item: T) => number): TreeNode<T>[] {
  const root = new Map<string, TreeNode<T>>();
  const child = (map: Map<string, TreeNode<T>>, key: string, label: string, level: number) => {
    let n = map.get(key);
    if (!n) { n = { key, label, children: [], items: [], count: 0, level }; map.set(key, n); }
    return n;
  };
  const kids = new Map<string, Map<string, TreeNode<T>>>();
  const kidMap = (n: TreeNode<T>) => kids.get(n.key) || kids.set(n.key, new Map()).get(n.key)!;

  for (const r of rows) {
    const p = child(root, `p${r.projectId}`, r.projectName || `Project ${r.projectId}`, 0);
    const b = child(kidMap(p), `${p.key}/b${r.towerId}`, r.towerName ? `Block ${r.towerName}` : "No block", 1);
    const f = child(kidMap(b), `${b.key}/f${r.floor}`, floorLabel(r.floor), 2);
    const u = child(kidMap(f), `${f.key}/u${r.flatId}`, r.flatName || `Unit ${r.flatId}`, 3);
    // A villa room sits on one of the villa's own floors: Ground / 1 / 2 …
    const s = r.storey ? child(kidMap(u), `${u.key}/s${r.storey}`, storeyLabel(r.storey), 2) : null;
    const rm = child(kidMap(s || u), `${(s || u).key}/r${r.roomId}`, r.roomName || `Room ${r.roomId}`, 4);
    rm.items.push(r);
    const c = getCount(r);
    for (const n of [p, b, f, u, s, rm]) if (n) n.count += c;
  }

  const finish = (map: Map<string, TreeNode<T>>, depth: number): TreeNode<T>[] => {
    const nodes = [...map.values()];
    for (const n of nodes) n.children = finish(kidMap(n), depth + 1);
    const isStorey = (n: TreeNode<T>) => /\/s[^/]*$/.test(n.key);
    return nodes.sort((a, b) =>
      depth === 2
        ? floorRank(a.key.split("/f").pop()!) - floorRank(b.key.split("/f").pop()!)
        : isStorey(a) && isStorey(b)
          ? storeyRank(a.key.split("/s").pop()!) - storeyRank(b.key.split("/s").pop()!)
          : collator.compare(a.label, b.label),
    );
  };
  return finish(root, 0);
}

function allKeys<T>(nodes: TreeNode<T>[], out: string[] = [], skipRooms = false) {
  for (const n of nodes) {
    if (!(skipRooms && n.items.length)) out.push(n.key);
    allKeys(n.children, out, skipRooms);
  }
  return out;
}

// Above this many rooms, Expand all opens every level down to the rooms but leaves the rooms themselves closed: with
// every room's contents open the list outgrows the tallest page a browser can scroll (about 33 million pixels).
const OPEN_ROOMS_LIMIT = 2000;
function countRooms<T>(nodes: TreeNode<T>[]): number {
  let n = 0;
  for (const x of nodes) n += (x.items.length ? 1 : 0) + countRooms(x.children);
  return n;
}

interface Props<T extends ScopeLocatable> {
  rows: T[];
  /** Renders whatever belongs under one room node — a chain card, an
   *  activity table, etc. Receives every item that room grouped together. */
  renderLeaf: (items: T[]) => ReactNode;
  /** Singular/plural label for the per-node item count badge, e.g. "chain". */
  countLabel: string;
  countLabelPlural?: string;
  /** Open every level regardless of manual expand/collapse state — for a
   *  caller that's already filtered `rows` down to search matches, so a hit
   *  nested under a collapsed node isn't hidden from view. */
  forceExpand?: boolean;
  /** How much one row of `rows` counts for at every level above it —
   *  defaults to 1 per row (the original behaviour, every existing caller
   *  unaffected). Pass this when `rows` is already a server-side
   *  aggregate (one row per room with an activityCount, say) rather than
   *  one row per actual item, so the tree's badges show the real total
   *  instead of the number of summary rows. */
  getCount?: (item: T) => number;
}

// One line of the tree as the page draws it: a node's header, or the contents under an open room.
type FlatRow<T> =
  | { kind: "node"; node: TreeNode<T>; depth: number; groupEnd: boolean }
  | { kind: "leaf"; node: TreeNode<T>; depth: number; groupEnd: boolean };

export function ScopeLocationTree<T extends ScopeLocatable>({
  rows, renderLeaf, countLabel, countLabelPlural = `${countLabel}s`, forceExpand = false, getCount = () => 1,
}: Props<T>) {
  const tree = useMemo(() => buildTree(rows, getCount), [rows, getCount]);
  // Projects start open so the page never looks empty; deeper levels start closed.
  const [open, setOpen] = useState<Set<string>>(() => new Set(tree.map((n) => n.key)));
  const roomCount = useMemo(() => countRooms(tree), [tree]);
  const [roomsLeftClosed, setRoomsLeftClosed] = useState(false);

  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // The open tree as one flat list of lines. At production size (hundreds of thousands of activities) Expand all
  // used to put every header and every room's contents on the page at once, and the browser gave up. Only the lines
  // on screen are drawn now (the virtualizer below), so Expand all costs the same whatever the size, and a room's
  // contents (on Reporting, its own request to the server) load only when that room is scrolled to.
  const flat = useMemo(() => {
    const out: FlatRow<T>[] = [];
    const walk = (nodes: TreeNode<T>[], depth: number) => {
      for (const n of nodes) {
        out.push({ kind: "node", node: n, depth, groupEnd: false });
        if (forceExpand || open.has(n.key)) {
          walk(n.children, depth + 1);
          if (n.items.length) out.push({ kind: "leaf", node: n, depth: depth + 1, groupEnd: false });
        }
      }
    };
    walk(tree, 0);
    // The last line before the next project closes that project's box.
    for (let i = 0; i < out.length; i++) out[i].groupEnd = i === out.length - 1 || out[i + 1].depth === 0;
    return out;
  }, [tree, open, forceExpand]);

  // The list scrolls with the page; it needs to know where on the page it starts.
  const listRef = useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const update = () => setScrollMargin(el.getBoundingClientRect().top + window.scrollY);
    update();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(update);
    ro.observe(document.body);
    return () => ro.disconnect();
  }, []);

  const virtualizer = useWindowVirtualizer({
    count: flat.length,
    estimateSize: (i) => (flat[i]?.kind === "leaf" ? 160 : 38),
    overscan: 10,
    scrollMargin,
    getItemKey: (i) => `${flat[i].kind}:${flat[i].node.key}`,
  });

  // Indent step is intentionally small and capped — a wide leaf (Reporting's activity table in particular) must
  // never widen the whole page on a phone; min-w-0 on every level stops a wide descendant demanding its full width.
  // Every level indents, so a villa's floors sit under the villa and its rooms under their floor (6 deep). The step
  // scales with the screen — 16px on a desktop, ~7px on a 375px phone.
  const indentFor = (depth: number) => `calc(12px + ${Math.min(depth, 6)} * clamp(6px, 2vw, 16px))`;

  // Each project reads as one ruled box: its header opens the box, its lines carry the sides, the last one closes it.
  const boxStyle = (row: FlatRow<T>): React.CSSProperties => ({
    borderLeft: "1px solid hsl(var(--foreground) / 0.4)",
    borderRight: "1px solid hsl(var(--foreground) / 0.4)",
    borderTop: row.kind === "node" && row.depth === 0 ? "1px solid hsl(var(--foreground) / 0.4)" : undefined,
    borderBottom: row.groupEnd ? "1px solid hsl(var(--foreground) / 0.4)" : undefined,
    marginBottom: row.groupEnd ? 8 : 0,
    paddingBottom: row.groupEnd && !(row.kind === "node" && row.depth === 0) ? 8 : 0,
  });

  const renderRow = (row: FlatRow<T>) => {
    if (row.kind === "leaf") {
      return (
        <div className="min-w-0 py-1 pr-2 bg-card" style={{ paddingLeft: indentFor(row.depth), ...boxStyle(row) }}>
          {renderLeaf(row.node.items)}
        </div>
      );
    }
    const { node, depth } = row;
    const Level = LEVELS[node.level] ?? LEVELS[LEVELS.length - 1];
    const expanded = forceExpand || open.has(node.key);
    return (
      <div className="min-w-0 bg-card" style={boxStyle(row)}>
        <button
          type="button"
          onClick={() => toggle(node.key)}
          aria-expanded={expanded}
          className="w-full min-w-0 flex items-center gap-2 py-2 pr-3 text-left hover:bg-primary/10 transition-colors"
          style={{ paddingLeft: indentFor(depth) }}
        >
          <ChevronRight size={14} className={`text-foreground shrink-0 transition-transform duration-200 ${expanded ? "rotate-90" : ""}`} />
          <Level.icon size={14} className={`${Level.color} shrink-0`} />
          <span className={`min-w-0 truncate ${depth === 0 ? "font-heading text-[0.6875rem] font-bold uppercase tracking-[0.1em]" : "text-sm"} text-foreground`}>
            {node.label}
          </span>
          <span className="ml-auto font-heading text-[0.625rem] tabular-nums text-muted-foreground shrink-0">
            {node.count} {node.count === 1 ? countLabel : countLabelPlural}
          </span>
        </button>
      </div>
    );
  };

  const items = virtualizer.getVirtualItems();
  return (
    <div className="space-y-2">
      <div className="flex justify-end gap-1.5">
        <button
          type="button"
          onClick={() => {
            const tooMany = roomCount > OPEN_ROOMS_LIMIT;
            setRoomsLeftClosed(tooMany);
            setOpen(new Set(allKeys(tree, [], tooMany)));
          }}
          className="font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed px-2.5 py-1.5 border border-foreground/40 text-foreground hover:border-foreground hover:bg-primary/10"
        >
          <ChevronsUpDown size={12} /> Expand all
        </button>
        <button
          type="button"
          onClick={() => {
            setRoomsLeftClosed(false);
            setOpen(new Set());
          }}
          className="font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed px-2.5 py-1.5 border border-foreground/40 text-foreground hover:border-foreground hover:bg-primary/10"
        >
          <ChevronsDownUp size={12} /> Collapse all
        </button>
      </div>
      {roomsLeftClosed && (
        <p className="text-right text-[0.6875rem] text-muted-foreground">
          {roomCount.toLocaleString("en-IN")} rooms: everything is open down to the rooms; open a room to see what is in it.
        </p>
      )}
      <div ref={listRef} className="relative min-w-0" style={{ height: virtualizer.getTotalSize() }}>
        {items.map((item) => (
          <div
            key={item.key}
            data-index={item.index}
            ref={virtualizer.measureElement}
            className="absolute left-0 top-0 w-full min-w-0"
            style={{ transform: `translateY(${item.start - virtualizer.options.scrollMargin}px)` }}
          >
            {renderRow(flat[item.index])}
          </div>
        ))}
      </div>
    </div>
  );
}
