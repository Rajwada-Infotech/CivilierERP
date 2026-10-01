// Shared Project > Block > Floor > Unit > Room collapsible tree — the same
// grouping/UI Dependency Master's own list uses (see
// src/pages/masters/DependencyMaster/components/DependencyMasterList.tsx,
// which this was extracted from), reused here so Work Allocation and
// Reporting present the exact same location hierarchy instead of each
// page having its own flat, single-level "group by chain" list.
import { useMemo, useState, type ReactNode } from "react";
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
}

interface TreeNode<T> {
  key: string;
  label: string;
  children: TreeNode<T>[];
  items: T[]; // only at room level
  count: number; // items underneath
}

const LEVELS = [
  { icon: FolderTree, color: "text-violet-500" },
  { icon: Building, color: "text-sky-500" },
  { icon: Layers, color: "text-amber-500" },
  { icon: Home, color: "text-emerald-500" },
  { icon: DoorOpen, color: "text-orange-500" },
] as const;

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const floorRank = (f: string) => (f === "G" ? -1 : Number.isFinite(Number(f)) ? Number(f) : Number.MAX_SAFE_INTEGER);
const floorLabel = (f: string) => (!f ? "No floor" : f === "G" ? "Ground Floor" : `Floor ${f}`);

function buildTree<T extends ScopeLocatable>(rows: T[], getCount: (item: T) => number): TreeNode<T>[] {
  const root = new Map<string, TreeNode<T>>();
  const child = (map: Map<string, TreeNode<T>>, key: string, label: string) => {
    let n = map.get(key);
    if (!n) { n = { key, label, children: [], items: [], count: 0 }; map.set(key, n); }
    return n;
  };
  const kids = new Map<string, Map<string, TreeNode<T>>>();
  const kidMap = (n: TreeNode<T>) => kids.get(n.key) || kids.set(n.key, new Map()).get(n.key)!;

  for (const r of rows) {
    const p = child(root, `p${r.projectId}`, r.projectName || `Project ${r.projectId}`);
    const b = child(kidMap(p), `${p.key}/b${r.towerId}`, r.towerName ? `Block ${r.towerName}` : "No block");
    const f = child(kidMap(b), `${b.key}/f${r.floor}`, floorLabel(r.floor));
    const u = child(kidMap(f), `${f.key}/u${r.flatId}`, r.flatName || `Unit ${r.flatId}`);
    const rm = child(kidMap(u), `${u.key}/r${r.roomId}`, r.roomName || `Room ${r.roomId}`);
    rm.items.push(r);
    const c = getCount(r);
    for (const n of [p, b, f, u, rm]) n.count += c;
  }

  const finish = (map: Map<string, TreeNode<T>>, depth: number): TreeNode<T>[] => {
    const nodes = [...map.values()];
    for (const n of nodes) n.children = finish(kidMap(n), depth + 1);
    return nodes.sort((a, b) =>
      depth === 2
        ? floorRank(a.key.split("/f").pop()!) - floorRank(b.key.split("/f").pop()!)
        : collator.compare(a.label, b.label),
    );
  };
  return finish(root, 0);
}

function allKeys<T>(nodes: TreeNode<T>[], out: string[] = []) {
  for (const n of nodes) { out.push(n.key); allKeys(n.children, out); }
  return out;
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

export function ScopeLocationTree<T extends ScopeLocatable>({
  rows, renderLeaf, countLabel, countLabelPlural = `${countLabel}s`, forceExpand = false, getCount = () => 1,
}: Props<T>) {
  const tree = useMemo(() => buildTree(rows, getCount), [rows, getCount]);
  // Projects start open so the page never looks empty; deeper levels start closed.
  const [open, setOpen] = useState<Set<string>>(() => new Set(tree.map((n) => n.key)));

  const isOpen = (key: string) => forceExpand || open.has(key);
  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });

  // Indent step is intentionally small and capped — at the old 20px/level
  // (up to 100px by Room depth) plus a page shell with no horizontal
  // overflow guard, a wide leaf (Reporting's activity table in particular)
  // forced the WHOLE PAGE to widen and scroll sideways on a narrow phone
  // screen, not just the leaf content within its own box. min-w-0 on every
  // level of this flex chain is what actually stops that — Tailwind's
  // default flex-item min-width is `auto` (grow-to-fit-content), so
  // without it a wide descendant keeps demanding its full natural width
  // all the way up the tree regardless of any indentation.
  const INDENT = 14;
  // Capped at 3 levels' worth — Project>Block>Floor>Unit>Room is 5 deep, and
  // indenting every level the full amount (12 + 5*14 = 82px) ate almost a
  // quarter of a 375px phone screen before the actual activity content even
  // started, which is what made everything below it look so cramped. Depths
  // past the cap reuse the same indent; the icon/label/border-and-background
  // per level still shows the hierarchy without needing more horizontal
  // space for it.
  const indentFor = (depth: number) => 12 + Math.min(depth, 3) * INDENT;
  const renderNode = (node: TreeNode<T>, depth: number) => {
    const Level = LEVELS[depth];
    const expanded = isOpen(node.key);
    return (
      <div key={node.key} className={`min-w-0 ${depth === 0 ? "rounded-xl border border-border/60 bg-card" : ""}`}>
        <button
          type="button"
          onClick={() => toggle(node.key)}
          className="w-full min-w-0 flex items-center gap-2 py-2 pr-3 text-left hover:bg-muted/40 rounded-lg transition-colors"
          style={{ paddingLeft: indentFor(depth) }}
        >
          <ChevronRight
            size={14}
            className={`text-muted-foreground/60 shrink-0 transition-transform duration-200 ${expanded ? "rotate-90" : ""}`}
          />
          <Level.icon size={14} className={`${Level.color} shrink-0`} />
          <span className={`min-w-0 truncate ${depth === 0 ? "text-sm font-heading font-semibold" : "text-sm"} text-foreground`}>
            {node.label}
          </span>
          <span className="ml-auto text-[0.625rem] font-mono text-muted-foreground shrink-0">
            {node.count} {node.count === 1 ? countLabel : countLabelPlural}
          </span>
        </button>

        {expanded && (
          <div className={`min-w-0 ${depth === 0 ? "pb-2" : ""}`}>
            {node.children.map((c) => renderNode(c, depth + 1))}
            {node.items.length > 0 && (
              <div className="min-w-0 py-1 pr-2" style={{ paddingLeft: indentFor(depth + 1) }}>
                {renderLeaf(node.items)}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-2">
      <div className="flex justify-end gap-1.5">
        <button
          type="button"
          onClick={() => setOpen(new Set(allKeys(tree)))}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-border text-xs text-muted-foreground hover:bg-muted transition-colors"
        >
          <ChevronsUpDown size={12} /> Expand all
        </button>
        <button
          type="button"
          onClick={() => setOpen(new Set())}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-border text-xs text-muted-foreground hover:bg-muted transition-colors"
        >
          <ChevronsDownUp size={12} /> Collapse all
        </button>
      </div>
      {tree.map((n) => renderNode(n, 0))}
    </div>
  );
}
