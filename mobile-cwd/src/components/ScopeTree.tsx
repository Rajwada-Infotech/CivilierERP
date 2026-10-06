// The Project > Block > Floor > Unit > Room tree shared by Work Reporting and Work Allocation. Built from the
// scope-summary rooms (one row per room, with its activity count); a room's own content comes from `renderRoom`
// and is only rendered — so only fetched — once that room is opened.
import { useEffect, useMemo, useState } from "react";
import { Text, TouchableOpacity, View } from "react-native";
import { Building, ChevronRight, DoorOpen, FolderTree, Home, Layers, type LucideIcon } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import type { ScopeRoom } from "@/api/cwdApi";

const LEVELS: { icon: LucideIcon; color: string }[] = [
  { icon: FolderTree, color: "#8b5cf6" },
  { icon: Building, color: "#0ea5e9" },
  { icon: Layers, color: "#f59e0b" },
  { icon: Home, color: "#10b981" },
  { icon: DoorOpen, color: "#f97316" },
];

interface Node {
  key: string;
  label: string;
  children: Node[];
  room?: ScopeRoom;
  count: number;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const floorRank = (f: string) => (f === "G" ? -1 : Number.isFinite(Number(f)) ? Number(f) : Number.MAX_SAFE_INTEGER);
// A villa in a plotted block has no floor; its chains carry the plot label instead.
const floorLabel = (f: string) => (!f ? "No floor" : f === "G" ? "Ground Floor" : Number.isFinite(Number(f)) ? `Floor ${f}` : `Plot ${f}`);

function buildTree(rooms: ScopeRoom[]): Node[] {
  const root = new Map<string, Node>();
  const kids = new Map<string, Map<string, Node>>();
  const kidMap = (n: Node) => kids.get(n.key) ?? kids.set(n.key, new Map()).get(n.key)!;
  const child = (map: Map<string, Node>, key: string, label: string) => {
    let n = map.get(key);
    if (!n) { n = { key, label, children: [], count: 0 }; map.set(key, n); }
    return n;
  };
  for (const r of rooms) {
    const p = child(root, `p${r.projectId}`, r.projectName || `Project ${r.projectId}`);
    const b = child(kidMap(p), `${p.key}/b${r.towerId}`, r.towerName ? `Block ${r.towerName}` : "No block");
    const f = child(kidMap(b), `${b.key}/f${r.floor}`, floorLabel(r.floor));
    const u = child(kidMap(f), `${f.key}/u${r.flatId}`, r.flatName || `Unit ${r.flatId}`);
    const rm = child(kidMap(u), `${u.key}/r${r.roomId}`, r.roomName || (r.roomId == null ? "No room" : `Room ${r.roomId}`));
    rm.room = r;
    for (const n of [p, b, f, u, rm]) n.count += r.activityCount;
  }
  const finish = (map: Map<string, Node>, depth: number): Node[] => {
    const nodes = [...map.values()];
    for (const n of nodes) n.children = finish(kidMap(n), depth + 1);
    return nodes.sort((a, b) => (depth === 2 ? floorRank(a.key.split("/f").pop()!) - floorRank(b.key.split("/f").pop()!) : collator.compare(a.label, b.label)));
  };
  return finish(root, 0);
}

export function ScopeTree({
  rooms, forceOpen = false, unit = "activity", renderRoom,
}: { rooms: ScopeRoom[]; forceOpen?: boolean; unit?: string; renderRoom: (room: ScopeRoom) => React.ReactNode }) {
  const tree = useMemo(() => buildTree(rooms), [rooms]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  // A single project starts opened so the page never looks empty.
  useEffect(() => {
    if (tree.length === 1) setOpen((p) => (p.has(tree[0].key) ? p : new Set(p).add(tree[0].key)));
  }, [tree]);
  const toggle = (key: string) => setOpen((p) => { const n = new Set(p); if (!n.delete(key)) n.add(key); return n; });

  const renderNode = (node: Node, depth: number): React.ReactNode => {
    const L = LEVELS[depth];
    const expanded = forceOpen || open.has(node.key);
    const pad = 10 + Math.min(depth, 3) * 12;
    return (
      <View key={node.key} style={depth === 0 ? { backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.border, marginBottom: 10, overflow: "hidden" } : undefined}>
        <TouchableOpacity activeOpacity={0.6} onPress={() => toggle(node.key)} style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10, paddingRight: 12, paddingLeft: pad }}>
          <ChevronRight size={14} color={colors.mutedForeground} style={{ transform: [{ rotate: expanded ? "90deg" : "0deg" }] }} />
          <L.icon size={14} color={L.color} />
          <Text numberOfLines={1} style={{ flex: 1, fontSize: depth === 0 ? 13 : 12.5, fontFamily: depth === 0 ? fonts.heading.semibold : fonts.body.medium, color: colors.foreground }}>
            {node.label}
          </Text>
          <Text style={{ fontSize: 10.5, fontFamily: fonts.body.medium, color: colors.mutedForeground }}>
            {node.count} {node.count === 1 ? unit : `${unit.replace(/y$/, "ie")}s`}
          </Text>
        </TouchableOpacity>
        {expanded && (
          <View>
            {node.children.map((c) => renderNode(c, depth + 1))}
            {node.room && <View style={{ paddingLeft: pad + 8, paddingRight: 10, paddingBottom: 6 }}>{renderRoom(node.room)}</View>}
          </View>
        )}
      </View>
    );
  };

  return <>{tree.map((n) => renderNode(n, 0))}</>;
}
