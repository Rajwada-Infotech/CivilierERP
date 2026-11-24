// CRM Parking Matrix — project + block picker, then a tile grid of every parking slot with
// availability status (Available / On Hold / Booked / Blocked). Mirrors the web CrmParkingMatrix.
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react-native";
import { fetchWithAuth } from "@/services/fetchWithAuth";
import { sheet as S } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { useBrand } from "@/theme/ThemeContext";
import type { MainStackParamList } from "@/navigation/MainStack";
import { OptionSheet } from "@/components/sheet/FormParts";

const STATUS_COLOR: Record<string, { bg: string; ink: string }> = {
  Available: { bg: "#166534", ink: "#dcfce7" },
  "On Hold":  { bg: "#92400e", ink: "#fef3c7" },
  OnHold:     { bg: "#92400e", ink: "#fef3c7" },
  Booked:     { bg: "#1e40af", ink: "#dbeafe" },
  Blocked:    { bg: "#374151", ink: "#d1d5db" },
};
const tileColor = (status: string) => STATUS_COLOR[status] ?? STATUS_COLOR.Available;

type SlotRow = {
  Id: number; SlotNo: string; ParkingType: string | null; BlockId: number | null; BlockName: string | null;
  ProjectId: number; ProjectName: string; IsActive: boolean;
  LockAllotmentId: number | null; LockBookingNo: string | null; LockHoldId: number | null;
  BookingId: number | null;
};

function deriveStatus(r: SlotRow): string {
  if (!r.IsActive) return "Blocked";
  if (r.LockBookingNo || r.LockAllotmentId) return "Booked";
  if (r.LockHoldId) return "On Hold";
  return "Available";
}

const fetchProjects = async () => {
  const res = await fetchWithAuth("/api/parking-matrix/projects");
  if (!res.ok) throw new Error(String(res.status));
  return res.json() as Promise<{ Id: number; Name: string }[]>;
};
const fetchBlocks = async (projectId: number) => {
  const res = await fetchWithAuth(`/api/parking-matrix/blocks?projectId=${projectId}`);
  if (!res.ok) throw new Error(String(res.status));
  return res.json() as Promise<{ Id: number; Name: string }[]>;
};
const fetchSlots = async (projectId: number, blockId: number | null) => {
  const url = blockId ? `/api/parking-matrix?projectId=${projectId}&blockId=${blockId}` : `/api/parking-matrix?projectId=${projectId}`;
  const res = await fetchWithAuth(url);
  if (!res.ok) throw new Error(String(res.status));
  return res.json() as Promise<SlotRow[]>;
};

export default function ParkingMatrixScreen() {
  const nav = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const b = useBrand();
  const [projectId, setProjectId] = useState<number | null>(null);
  const [projectName, setProjectName] = useState("");
  const [blockId, setBlockId] = useState<number | null>(null);
  const [blockName, setBlockName] = useState("All blocks");
  const [projectOpen, setProjectOpen] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);

  const projectsQ = useQuery({ queryKey: ["parking-matrix-projects"], queryFn: fetchProjects });
  const blocksQ = useQuery({ queryKey: ["parking-matrix-blocks", projectId], queryFn: () => fetchBlocks(projectId!), enabled: !!projectId });
  const slotsQ = useQuery({ queryKey: ["parking-matrix-slots", projectId, blockId], queryFn: () => fetchSlots(projectId!, blockId), enabled: !!projectId });

  useEffect(() => { setBlockId(null); setBlockName("All blocks"); }, [projectId]);
  useEffect(() => {
    if (projectsQ.data?.length === 1 && !projectId) {
      setProjectId(projectsQ.data[0].Id);
      setProjectName(projectsQ.data[0].Name);
    }
  }, [projectsQ.data]);

  // Group by block name, then by parking type within block.
  const groups = useMemo(() => {
    if (!slotsQ.data) return [];
    const map = new Map<string, Map<string, SlotRow[]>>();
    for (const s of slotsQ.data) {
      const block = s.BlockName || "Main";
      const type = s.ParkingType || "Parking";
      if (!map.has(block)) map.set(block, new Map());
      const inner = map.get(block)!;
      if (!inner.has(type)) inner.set(type, []);
      inner.get(type)!.push(s);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [slotsQ.data]);

  const counts = useMemo(() => {
    if (!slotsQ.data) return null;
    const c: Record<string, number> = { Available: 0, "On Hold": 0, Booked: 0, Blocked: 0 };
    for (const s of slotsQ.data) { const st = deriveStatus(s); if (st in c) c[st]++; else c.Available++; }
    return c;
  }, [slotsQ.data]);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: b.surface }} contentContainerStyle={{ padding: 14, paddingBottom: 100 }}>
      <View style={{ gap: 10, marginBottom: 14 }}>
        <Picker label="Project" value={projectName} placeholder="Pick a project" onPress={() => setProjectOpen(true)} loading={projectsQ.isLoading} />
        {projectId ? (
          <Picker label="Block" value={blockName} placeholder="All blocks" onPress={() => setBlockOpen(true)} loading={blocksQ.isLoading} />
        ) : null}
      </View>

      {counts ? (
        <View style={{ flexDirection: "row", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
          {Object.entries(counts).filter(([, v]) => v > 0).map(([st, n]) => {
            const c = tileColor(st);
            return (
              <View key={st} style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10, backgroundColor: c.bg }}>
                <Text style={{ color: c.ink, fontSize: 12.5, fontFamily: fonts.heading.semibold }}>{n}</Text>
                <Text style={{ color: c.ink, fontSize: 11.5, fontFamily: fonts.body.regular }}>{st}</Text>
              </View>
            );
          })}
        </View>
      ) : null}

      {!projectId ? (
        <Text style={{ color: b.textSecondary, fontSize: 14, fontFamily: fonts.body.regular, textAlign: "center", marginTop: 40 }}>
          Pick a project to view the parking matrix.
        </Text>
      ) : slotsQ.isLoading ? (
        <ActivityIndicator color={b.accent} style={{ marginTop: 40 }} />
      ) : slotsQ.isError ? (
        <Text style={{ color: b.danger, fontSize: 13, fontFamily: fonts.body.regular, textAlign: "center", marginTop: 40 }}>
          Could not load parking slots.
        </Text>
      ) : groups.length === 0 ? (
        <Text style={{ color: b.textSecondary, fontSize: 14, fontFamily: fonts.body.regular, textAlign: "center", marginTop: 40 }}>
          No parking slots found.
        </Text>
      ) : (
        <View style={{ gap: 24 }}>
          {groups.map(([block, typeMap]) => (
            <View key={block}>
              <Text style={{ color: b.textSecondary, fontSize: 11.5, fontFamily: fonts.heading.semibold, letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 10 }}>
                {block}
              </Text>
              <View style={{ gap: 14 }}>
                {Array.from(typeMap.entries()).map(([type, slots]) => (
                  <View key={type}>
                    <Text style={{ color: b.textSecondary, fontSize: 11, fontFamily: fonts.body.regular, marginBottom: 6 }}>{type}</Text>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                      {slots.map((s) => (
                        <SlotTile
                          key={s.Id}
                          slot={s}
                          onPress={() => { if (s.BookingId) nav.navigate("CrmBooking", { bookingId: s.BookingId, title: s.LockBookingNo || s.SlotNo }); }}
                        />
                      ))}
                    </View>
                  </View>
                ))}
              </View>
            </View>
          ))}
        </View>
      )}

      <OptionSheet
        visible={projectOpen}
        title="Project"
        options={(projectsQ.data ?? []).map((p) => ({ id: p.Id, label: p.Name }))}
        onSelect={(id) => { const p = projectsQ.data?.find((x) => x.Id === Number(id)); if (p) { setProjectId(p.Id); setProjectName(p.Name); } setProjectOpen(false); }}
        onClose={() => setProjectOpen(false)}
      />
      <OptionSheet
        visible={blockOpen}
        title="Block"
        options={[{ id: 0, label: "All blocks" }, ...(blocksQ.data ?? []).map((b) => ({ id: b.Id, label: b.Name }))]}
        onSelect={(id) => {
          if (Number(id) === 0) { setBlockId(null); setBlockName("All blocks"); }
          else { const bl = blocksQ.data?.find((x) => x.Id === Number(id)); if (bl) { setBlockId(bl.Id); setBlockName(bl.Name); } }
          setBlockOpen(false);
        }}
        onClose={() => setBlockOpen(false)}
      />
    </ScrollView>
  );
}

function SlotTile({ slot, onPress }: { slot: SlotRow; onPress: () => void }) {
  const status = deriveStatus(slot);
  const c = tileColor(status);
  const tappable = !!slot.LockAllotmentId || !!slot.LockHoldId;
  return (
    <Pressable
      onPress={tappable ? onPress : undefined}
      style={({ pressed }) => ({
        minWidth: 60, minHeight: 50, borderRadius: 10, padding: 6,
        backgroundColor: c.bg, opacity: pressed ? 0.75 : 1,
        alignItems: "center", justifyContent: "center",
      })}
    >
      <Text numberOfLines={2} style={{ color: c.ink, fontSize: 12, fontFamily: fonts.heading.semibold, textAlign: "center" }}>
        {slot.SlotNo}
      </Text>
    </Pressable>
  );
}

function Picker({ label, value, placeholder, onPress, loading }: { label: string; value: string; placeholder: string; onPress: () => void; loading?: boolean }) {
  const b = useBrand();
  return (
    <View>
      <Text style={{ fontSize: 11, fontFamily: fonts.heading.semibold, color: b.textSecondary, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 5 }}>{label}</Text>
      <Pressable
        onPress={onPress}
        style={({ pressed }) => ({
          flexDirection: "row", alignItems: "center", justifyContent: "space-between",
          paddingHorizontal: 14, paddingVertical: 12, borderRadius: 14, borderWidth: 1,
          borderColor: b.border, backgroundColor: pressed ? S.blueWash : b.surfaceCard,
        })}
      >
        <Text style={{ color: value ? b.textPrimary : b.textSecondary, fontSize: 14, fontFamily: fonts.body.regular, flex: 1 }}>
          {value || placeholder}
        </Text>
        {loading ? <ActivityIndicator size="small" color={b.textSecondary} /> : <ChevronDown size={14} color={b.textSecondary} />}
      </Pressable>
    </View>
  );
}
