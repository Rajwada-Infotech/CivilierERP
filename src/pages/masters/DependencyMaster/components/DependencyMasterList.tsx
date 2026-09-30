import { useMemo, useState } from "react";
import { ChevronRight, FolderTree, Building, Layers, Home, DoorOpen, ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import type { DependencyMasterListRow } from "@/api/dependencyMasterApi";
import { useDependencyMasterList } from "../hooks/useDependencyMasterList";
import { DependencyMasterListItem } from "./DependencyMasterListItem";

interface Props {
  rows: DependencyMasterListRow[];
  canEdit: boolean;
  canDelete: boolean;
  onEdit: (row: DependencyMasterListRow) => void;
  onDelete: (row: DependencyMasterListRow) => void;
  /** Open every level (e.g. while a search is active, so matches are visible). */
  forceExpand?: boolean;
}

interface TreeNode {
  key: string;
  label: string;
  children: TreeNode[];
  rows: DependencyMasterListRow[]; // only on the room level
  count: number; // chains underneath
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

// Project > Block > Floor > Unit > Room, each level a node; the chains sit
// under their room. Keys carry the full path so identical names under
// different parents never collide.
function buildTree(rows: DependencyMasterListRow[]): TreeNode[] {
  const root = new Map<string, TreeNode>();
  const child = (map: Map<string, TreeNode>, key: string, label: string) => {
    let n = map.get(key);
    if (!n) { n = { key, label, children: [], rows: [], count: 0 }; map.set(key, n); }
    return n;
  };
  const kids = new Map<string, Map<string, TreeNode>>();
  const kidMap = (n: TreeNode) => kids.get(n.key) || kids.set(n.key, new Map()).get(n.key)!;

  for (const r of rows) {
    const p = child(root, `p${r.projectId}`, r.projectName || `Project ${r.projectId}`);
    const b = child(kidMap(p), `${p.key}/b${r.towerId}`, r.towerName ? `Block ${r.towerName}` : "No block");
    const f = child(kidMap(b), `${b.key}/f${r.floor}`, floorLabel(r.floor));
    const u = child(kidMap(f), `${f.key}/u${r.flatId}`, r.flatName || `Unit ${r.flatId}`);
    const rm = child(kidMap(u), `${u.key}/r${r.roomId}`, r.roomName || `Room ${r.roomId}`);
    rm.rows.push(r);
    for (const n of [p, b, f, u, rm]) n.count++;
  }

  const finish = (map: Map<string, TreeNode>, depth: number): TreeNode[] => {
    const nodes = [...map.values()];
    for (const n of nodes) {
      n.children = finish(kidMap(n), depth + 1);
      n.rows.sort((a, b) => collator.compare(a.alias, b.alias));
    }
    return nodes.sort((a, b) =>
      depth === 2
        ? floorRank(a.key.split("/f").pop()!) - floorRank(b.key.split("/f").pop()!)
        : collator.compare(a.label, b.label),
    );
  };
  return finish(root, 0);
}

function allKeys(nodes: TreeNode[], out: string[] = []) {
  for (const n of nodes) { out.push(n.key); allKeys(n.children, out); }
  return out;
}

export function DependencyMasterList({ rows, canEdit, canDelete, onEdit, onDelete, forceExpand = false }: Props) {
  const list = useDependencyMasterList();
  const tree = useMemo(() => buildTree(rows), [rows]);
  // Projects start open so the page never looks empty; deeper levels start closed.
  const [open, setOpen] = useState<Set<string>>(() => new Set(tree.map((n) => n.key)));

  const isOpen = (key: string) => forceExpand || open.has(key);
  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });

  const renderNode = (node: TreeNode, depth: number) => {
    const Level = LEVELS[depth];
    const expanded = isOpen(node.key);
    return (
      <div key={node.key} className={depth === 0 ? "rounded-xl border border-border/60 bg-card" : ""}>
        <button
          type="button"
          onClick={() => toggle(node.key)}
          className="w-full flex items-center gap-2 py-2 pr-3 text-left hover:bg-muted/40 rounded-lg transition-colors"
          style={{ paddingLeft: 12 + depth * 20 }}
        >
          <ChevronRight
            size={14}
            className={`text-muted-foreground/60 shrink-0 transition-transform duration-200 ${expanded ? "rotate-90" : ""}`}
          />
          <Level.icon size={14} className={`${Level.color} shrink-0`} />
          <span className={`truncate ${depth === 0 ? "text-sm font-heading font-semibold" : "text-sm"} text-foreground`}>
            {node.label}
          </span>
          <span className="ml-auto text-[10px] font-mono text-muted-foreground shrink-0">
            {node.count} {node.count === 1 ? "chain" : "chains"}
          </span>
        </button>

        {expanded && (
          <div className={depth === 0 ? "pb-2" : ""}>
            {node.children.map((c) => renderNode(c, depth + 1))}
            {node.rows.length > 0 && (
              <div className="space-y-1.5 py-1 pr-2" style={{ paddingLeft: 12 + (depth + 1) * 20 }}>
                {node.rows.map((row) => (
                  <DependencyMasterListItem
                    key={row.id}
                    row={row}
                    isExpanded={list.expandedId === row.id}
                    isLoading={list.loadingId === row.id}
                    cached={list.getCached(row.id)}
                    onToggle={() => list.toggle(row.id)}
                    canEdit={canEdit}
                    canDelete={canDelete}
                    onEdit={() => onEdit(row)}
                    onDelete={() => onDelete(row)}
                  />
                ))}
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
