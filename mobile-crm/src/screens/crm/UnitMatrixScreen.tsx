// CRM Unit Matrix — project + block picker, then a floor-grouped tile grid showing every unit's
// availability status (Available / On Hold / Booked / Blocked) live from the server.
// Mirrors web CrmUnitMatrix.tsx in layout logic; tiles navigate to BookingDetailScreen.
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

// ── Status colours (same palette as the web matrix's TileStatus) ──────────────
const STATUS_COLOR: Record<string, { bg: string; ink: string }> = {
  Available: { bg: "#166534", ink: "#dcfce7" },
  "On Hold":  { bg: "#92400e", ink: "#fef3c7" },
  OnHold:     { bg: "#92400e", ink: "#fef3c7" },
  Booked:     { bg: "#1e40af", ink: "#dbeafe" },
  Blocked:    { bg: "#374151", ink: "#d1d5db" },
};
const tileColor = (status: string) => STATUS_COLOR[status] ?? STATUS_COLOR.Available;

type UnitRow = {
  Id: number; UnitName: string; FloorNo: number | null; BlockId: number | null; BlockName: string | null;
  Status: string; BookingId: number | null; BookingNo: string | null; ApplicantName: string | null;
  TotalValue: number | null; GrandTotal: number | null; AreaSqFt: number | null; UnitType: string | null;
  IsActive: boolean; LockBookingNo: string | null; LockHoldId: number | null;
};

function deriveStatus(r: UnitRow): string {
  if (!r.IsActive) return "Blocked";
  if (r.Status) return r.Status; // server already derived it
  if (r.BookingId || r.LockBookingNo) return "Booked";
  if (r.LockHoldId) return "On Hold";
  return "Available";
}

const fetchProjects = async () => {
  const res = await fetchWithAuth("/api/unit-matrix/projects");
  if (!res.ok) throw new Error(String(res.status));
  return res.json() as Promise<{ Id: number; Name: string }[]>;
};
const fetchBlocks = async (projectId: number) => {
  const res = await fetchWithAuth(`/api/unit-matrix/blocks?projectId=${projectId}`);
  if (!res.ok) throw new Error(String(res.status));
  return res.json() as Promise<{ Id: number; Name: string }[]>;
};
const fetchUnits = async (projectId: number, blockId: number | null) => {
  const url = blockId ? `/api/unit-matrix?projectId=${projectId}&blockId=${blockId}` : `/api/unit-matrix?projectId=${projectId}`;
  const res = await fetchWithAuth(url);
  if (!res.ok) throw new Error(String(res.status));
  return res.json() as Promise<UnitRow[]>;
};

export default function UnitMatrixScreen() {
  const nav = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const b = useBrand();
  const [projectId, setProjectId] = useState<number | null>(null);
  const [projectName, setProjectName] = useState("");
  const [blockId, setBlockId] = useState<number | null>(null);
  const [blockName, setBlockName] = useState("All blocks");
  const [projectOpen, setProjectOpen] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);

  const projectsQ = useQuery({ queryKey: ["unit-matrix-projects"], queryFn: fetchProjects });
  const blocksQ = useQuery({ queryKey: ["unit-matrix-blocks", projectId], queryFn: () => fetchBlocks(projectId!), enabled: !!projectId });
  const unitsQ = useQuery({ queryKey: ["unit-matrix-units", projectId, blockId], queryFn: () => fetchUnits(projectId!, blockId), enabled: !!projectId });

  // Reset block when project changes.
  useEffect(() => { setBlockId(null); setBlockName("All blocks"); }, [projectId]);

  // Auto-select if only one project.
  useEffect(() => {
    if (projectsQ.data?.length === 1 && !projectId) {
      setProjectId(projectsQ.data[0].Id);
      setProjectName(projectsQ.data[0].Name);
    }
  }, [projectsQ.data]);

  // Group units by floor, then sort floors descending (top floor first, as the web does).
  const floors = useMemo(() => {
    if (!unitsQ.data) return [];
    const map = new Map<string, UnitRow[]>();
    for (const u of unitsQ.data) {
      const key = u.FloorNo != null ? `Floor ${u.FloorNo}` : "Ground";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(u);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => {
        const na = parseInt(a.replace(/\D/g, "")) || 0;
        const nb = parseInt(b.replace(/\D/g, "")) || 0;
        return nb - na; // descending — top floor first
      });
  }, [unitsQ.data]);

  const counts = useMemo(() => {
    if (!unitsQ.data) return null;
    const c: Record<string, number> = { Available: 0, "On Hold": 0, Booked: 0, Blocked: 0 };
    for (const u of unitsQ.data) { const s = deriveStatus(u); if (s in c) c[s]++; else c.Available++; }
    return c;
  }, [unitsQ.data]);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: b.surface }} contentContainerStyle={{ padding: 14, paddingBottom: 100 }}>
      {/* Pickers */}
      <View style={{ gap: 10, marginBottom: 14 }}>
        <Picker label="Project" value={projectName} placeholder="Pick a project" onPress={() => setProjectOpen(true)} loading={projectsQ.isLoading} />
        {projectId ? (
          <Picker label="Block" value={blockName} placeholder="All blocks" onPress={() => setBlockOpen(true)} loading={blocksQ.isLoading} />
        ) : null}
      </View>

      {/* Summary counts */}
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

      {/* No project selected */}
      {!projectId ? (
        <Text style={{ color: b.textSecondary, fontSize: 14, fontFamily: fonts.body.regular, textAlign: "center", marginTop: 40 }}>
          Pick a project to view the unit matrix.
        </Text>
      ) : unitsQ.isLoading ? (
        <ActivityIndicator color={b.accent} style={{ marginTop: 40 }} />
      ) : unitsQ.isError ? (
        <Text style={{ color: b.danger, fontSize: 13, fontFamily: fonts.body.regular, textAlign: "center", marginTop: 40 }}>
          Could not load units.
        </Text>
      ) : floors.length === 0 ? (
        <Text style={{ color: b.textSecondary, fontSize: 14, fontFamily: fonts.body.regular, textAlign: "center", marginTop: 40 }}>
          No units found.
        </Text>
      ) : (
        <View style={{ gap: 20 }}>
          {floors.map(([floor, units]) => (
            <View key={floor}>
              <Text style={{ color: b.textSecondary, fontSize: 11.5, fontFamily: fonts.heading.semibold, letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 8 }}>
                {floor}
              </Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                {units.map((u) => <UnitTile key={u.Id} unit={u} onPress={() => { if (u.BookingId) nav.navigate("CrmBooking", { bookingId: u.BookingId, title: u.BookingNo || u.UnitName }); }} />)}
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Pickers as modals */}
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

function UnitTile({ unit, onPress }: { unit: UnitRow; onPress: () => void }) {
  const status = deriveStatus(unit);
  const c = tileColor(status);
  const tappable = !!unit.BookingId || !!unit.LockHoldId;
  return (
    <Pressable
      onPress={tappable ? onPress : undefined}
      style={({ pressed }) => ({
        width: 76, minHeight: 56, borderRadius: 10, padding: 6,
        backgroundColor: c.bg, opacity: pressed ? 0.75 : 1,
        alignItems: "center", justifyContent: "center",
      })}
    >
      <Text numberOfLines={2} style={{ color: c.ink, fontSize: 12, fontFamily: fonts.heading.semibold, textAlign: "center" }}>
        {unit.UnitName}
      </Text>
      {unit.AreaSqFt ? (
        <Text style={{ color: c.ink, fontSize: 10, fontFamily: fonts.body.regular, opacity: 0.8, marginTop: 2 }}>
          {unit.AreaSqFt} sqft
        </Text>
      ) : null}
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
