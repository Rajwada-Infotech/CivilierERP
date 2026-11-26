// CRM Unit Matrix — project + block pickers, stats bar, floor-grouped tile grid.
// Mirrors web CrmUnitMatrix.tsx in structure. Tap a Booked/OnHold tile → info sheet.
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, X } from "lucide-react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { fetchWithAuth } from "@/services/fetchWithAuth";
import { sheet as S } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { useBrand } from "@/theme/ThemeContext";
import type { MainStackParamList } from "@/navigation/MainStack";
import { OptionSheet } from "@/components/sheet/FormParts";
import { useAuth } from "@/auth/AuthContext";

// ── Status palette — vivid enough to pop on dark surfaces ─────────────────────
type StatusKey = "Available" | "OnHold" | "On Hold" | "Booked" | "Blocked";
const TILE_STYLE: Record<string, {
  grad: [string, string]; ink: string; dimInk: string; accent: string;
}> = {
  Available: { grad: ["#064e3b", "#065f46"], ink: "#6ee7b7", dimInk: "#34d399", accent: "#10b981" },
  OnHold:    { grad: ["#78350f", "#a16207"], ink: "#fde68a", dimInk: "#fcd34d", accent: "#f59e0b" },
  "On Hold": { grad: ["#78350f", "#a16207"], ink: "#fde68a", dimInk: "#fcd34d", accent: "#f59e0b" },
  Booked:    { grad: ["#1e3a8a", "#1d4ed8"], ink: "#93c5fd", dimInk: "#60a5fa", accent: "#3b82f6" },
  Blocked:   { grad: ["#111827", "#1f2937"], ink: "#4b5563", dimInk: "#374151", accent: "#374151" },
};
const tileStyle = (s: string) => TILE_STYLE[s] ?? TILE_STYLE.Available;

// Stat card accent per status
const STAT_ACCENT: Record<string, string> = {
  Available: "#10b981", OnHold: "#f59e0b", Booked: "#3b82f6", Blocked: "#4b5563",
};

type UnitRow = {
  Id: number; UnitName: string; FloorNo: number | null;
  BlockId: number | null; BlockName: string | null;
  Status: string; AreaSqFt: number | null; UnitType: string | null;
  BookingId: number | null; BookingNo: string | null; BookingStatus: string | null;
  BookingDate: string | null; TotalValue: number | null; GrandTotal: number | null;
  BookingAmount: number | null;
  ApplicantName: string | null; Mobile: string | null; AssignedToName: string | null;
  HoldId: number | null; HoldUntil: string | null;
  HoldApplicantName: string | null; HoldMobile: string | null; HoldAssignedToName: string | null;
  IsActive: boolean; LockBookingNo: string | null; LockHoldId: number | null;
  IsPlot?: boolean; IsVilla?: boolean; VillaTypeCode?: string | null;
};

function deriveStatus(r: UnitRow): string {
  if (r.Status) return r.Status;
  if (!r.IsActive) return "Blocked";
  if (r.BookingId || r.LockBookingNo) return "Booked";
  if (r.LockHoldId) return "On Hold";
  return "Available";
}

const fmtMoney = (v: number | null | undefined) =>
  v == null ? "—" : `₹ ${Number(v).toLocaleString("en-IN")}`;

/** Two-letter initials from an applicant name. */
const initials = (name: string | null | undefined) => {
  if (!name) return "—";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

const fetchProjects = async () => {
  const r = await fetchWithAuth("/api/unit-matrix/projects");
  if (!r.ok) throw new Error(String(r.status));
  return r.json() as Promise<{ Id: number; Name: string }[]>;
};
const fetchBlocks = async (pid: number) => {
  const r = await fetchWithAuth(`/api/unit-matrix/blocks?projectId=${pid}`);
  if (!r.ok) throw new Error(String(r.status));
  return r.json() as Promise<{ Id: number; Name: string }[]>;
};
const fetchUnits = async (pid: number, bid: number | null) => {
  const url = bid ? `/api/unit-matrix?projectId=${pid}&blockId=${bid}` : `/api/unit-matrix?projectId=${pid}`;
  const r = await fetchWithAuth(url);
  if (!r.ok) throw new Error(String(r.status));
  return r.json() as Promise<UnitRow[]>;
};

// ── Info bottom sheet ──────────────────────────────────────────────────────────
function InfoRow({ label, value }: { label: string; value: string | null | undefined }) {
  const b = useBrand();
  if (!value) return null;
  return (
    <View style={{ flexDirection: "row", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: b.border }}>
      <Text style={{ width: 112, fontSize: 10.5, fontFamily: fonts.heading.semibold, color: b.textSecondary, letterSpacing: 0.4, textTransform: "uppercase" }}>{label}</Text>
      <Text style={{ flex: 1, fontSize: 13, fontFamily: fonts.body.regular, color: b.textPrimary }}>{value}</Text>
    </View>
  );
}

function UnitInfoSheet({ unit, onClose, onOpenBooking }: {
  unit: UnitRow; onClose: () => void; onOpenBooking: () => void;
}) {
  const b = useBrand();
  const insets = useSafeAreaInsets();
  const status = deriveStatus(unit);
  const ts = tileStyle(status);
  const isHold = status === "OnHold" || status === "On Hold";
  const person = isHold ? (unit.HoldApplicantName || unit.ApplicantName) : unit.ApplicantName;
  const mobile = isHold ? (unit.HoldMobile || unit.Mobile) : unit.Mobile;
  const salesperson = isHold ? (unit.HoldAssignedToName || unit.AssignedToName) : unit.AssignedToName;
  const holdUntil = unit.HoldUntil ? String(unit.HoldUntil).slice(0, 10) : null;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)" }} onPress={onClose}>
        <Pressable
          onPress={() => {}}
          style={{
            position: "absolute", left: 0, right: 0, bottom: 0,
            backgroundColor: b.surfaceCard, borderTopLeftRadius: 24, borderTopRightRadius: 24,
            borderTopWidth: 1, borderColor: b.border,
            paddingBottom: insets.bottom + 16, maxHeight: "82%",
          }}
        >
          {/* Drag handle */}
          <View style={{ alignItems: "center", paddingTop: 12, paddingBottom: 4 }}>
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: b.border }} />
          </View>

          {/* Coloured header strip */}
          <LinearGradient
            colors={[ts.grad[0], ts.grad[1]]}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
            style={{ marginHorizontal: 20, marginBottom: 16, borderRadius: 14, padding: 16, flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" }}
          >
            <View>
              <Text style={{ fontSize: 10, fontFamily: fonts.heading.semibold, color: ts.dimInk, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 4 }}>
                {unit.IsPlot ? "Plot" : unit.IsVilla ? "Villa" : "Unit"}
              </Text>
              <Text style={{ fontSize: 24, fontFamily: fonts.heading.semibold, color: ts.ink, lineHeight: 28 }}>{unit.UnitName}</Text>
              <Text style={{ fontSize: 11.5, color: ts.dimInk, fontFamily: fonts.body.regular, marginTop: 4 }}>
                {[unit.BlockName, unit.FloorNo != null ? `Floor ${unit.FloorNo}` : null, unit.AreaSqFt ? `${unit.AreaSqFt} sq ft` : null].filter(Boolean).join(" · ") || "—"}
              </Text>
            </View>
            <View style={{ alignItems: "flex-end", gap: 8 }}>
              <Pressable onPress={onClose} style={{ padding: 2 }}>
                <X size={16} color={ts.dimInk} />
              </Pressable>
              <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" }}>
                <Text style={{ fontSize: 13, fontFamily: fonts.heading.semibold, color: ts.ink }}>{initials(person)}</Text>
              </View>
            </View>
          </LinearGradient>

          <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 8 }} showsVerticalScrollIndicator={false}>
            {/* Customer facts */}
            <Text style={{ fontSize: 10, fontFamily: fonts.heading.semibold, color: b.textSecondary, letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 6 }}>Customer</Text>
            <InfoRow label="Applicant" value={person} />
            <InfoRow label="Mobile" value={mobile} />
            <InfoRow label="Salesperson" value={salesperson} />

            {/* Booking facts */}
            {!isHold && unit.BookingId != null && (
              <>
                <Text style={{ fontSize: 10, fontFamily: fonts.heading.semibold, color: b.textSecondary, letterSpacing: 0.6, textTransform: "uppercase", marginTop: 16, marginBottom: 6 }}>Booking</Text>
                <InfoRow label="Booking No" value={unit.BookingNo} />
                <InfoRow label="Status" value={unit.BookingStatus} />
                <InfoRow label="Booked on" value={unit.BookingDate ? String(unit.BookingDate).slice(0, 10) : null} />
                <InfoRow label="Booking amt" value={fmtMoney(unit.BookingAmount)} />
                <InfoRow label="Unit value" value={fmtMoney(unit.TotalValue)} />
                <InfoRow label="Grand total" value={fmtMoney(unit.GrandTotal ?? unit.TotalValue)} />
              </>
            )}

            {isHold && holdUntil && (
              <View style={{ marginTop: 14, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: b.border }}>
                <Text style={{ fontSize: 12, color: b.textSecondary, fontFamily: fonts.body.regular }}>
                  Held until {holdUntil}{unit.BookingId != null ? " · booking amount not yet paid." : " · for the application."}
                </Text>
              </View>
            )}

            {unit.BookingId != null && (
              <Pressable
                onPress={onOpenBooking}
                style={({ pressed }) => ({
                  marginTop: 20, height: 46, borderRadius: 12, alignItems: "center", justifyContent: "center",
                  backgroundColor: pressed ? b.accent + "cc" : b.accent,
                })}
              >
                <Text style={{ color: "#fff", fontSize: 14, fontFamily: fonts.heading.semibold }}>Open booking</Text>
              </Pressable>
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ── Main screen ────────────────────────────────────────────────────────────────
export default function UnitMatrixScreen() {
  const nav = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  // A free unit or plot starts a new application on it, for staff who may add applications.
  const canApply = useAuth().canDoAction("crm-applications", "create");
  const b = useBrand();
  const [projectId, setProjectId] = useState<number | null>(null);
  const [projectName, setProjectName] = useState("");
  const [blockId, setBlockId] = useState<number | null>(null);
  const [blockName, setBlockName] = useState("All blocks");
  const [projectOpen, setProjectOpen] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);
  const [infoUnit, setInfoUnit] = useState<UnitRow | null>(null);

  const projectsQ = useQuery({ queryKey: ["unit-matrix-projects"], queryFn: fetchProjects });
  const blocksQ = useQuery({ queryKey: ["unit-matrix-blocks", projectId], queryFn: () => fetchBlocks(projectId!), enabled: !!projectId });
  const unitsQ = useQuery({ queryKey: ["unit-matrix-units", projectId, blockId], queryFn: () => fetchUnits(projectId!, blockId), enabled: !!projectId });

  useEffect(() => { setBlockId(null); setBlockName("All blocks"); }, [projectId]);
  useEffect(() => {
    if (projectsQ.data?.length === 1 && !projectId) {
      setProjectId(projectsQ.data[0].Id); setProjectName(projectsQ.data[0].Name);
    }
  }, [projectsQ.data]);

  const grouped = useMemo(() => {
    if (!unitsQ.data) return [];
    const byBlock = new Map<string, Map<string, UnitRow[]>>();
    for (const u of unitsQ.data) {
      const bk = u.BlockName || "No block";
      const fk = u.IsPlot ? "Plots" : u.IsVilla ? "Villas" : u.FloorNo != null ? `Floor ${u.FloorNo}` : "No floor";
      if (!byBlock.has(bk)) byBlock.set(bk, new Map());
      const floors = byBlock.get(bk)!;
      if (!floors.has(fk)) floors.set(fk, []);
      floors.get(fk)!.push(u);
    }
    return Array.from(byBlock.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([bName, floorMap]) => {
      const floors = Array.from(floorMap.entries())
        .sort(([a], [b]) => { const na = parseInt(a.replace(/\D/g, "")) || 0; const nb = parseInt(b.replace(/\D/g, "")) || 0; return nb - na; })
        .map(([f, list]) => [f, [...list].sort((x, y) => x.UnitName.localeCompare(y.UnitName))] as const);
      const all = floors.flatMap(([, l]) => l);
      return { blockName: bName, floors, total: all.length, free: all.filter((u) => deriveStatus(u) === "Available").length };
    });
  }, [unitsQ.data]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { Available: 0, OnHold: 0, Booked: 0, Blocked: 0 };
    (unitsQ.data ?? []).forEach((u) => {
      const s = deriveStatus(u);
      if (s === "Available") c.Available++;
      else if (s === "OnHold" || s === "On Hold") c.OnHold++;
      else if (s === "Booked") c.Booked++;
      else c.Blocked++;
    });
    return c;
  }, [unitsQ.data]);

  const total = unitsQ.data?.length ?? 0;
  const forSale = total - counts.Blocked;
  const soldPct = forSale > 0 ? Math.round((counts.Booked / forSale) * 100) : 0;

  const tileLine = (u: UnitRow) => {
    const s = deriveStatus(u);
    if (s === "Booked") return u.ApplicantName || u.BookingNo || "—";
    if (s === "OnHold" || s === "On Hold") return u.HoldApplicantName || u.ApplicantName || "—";
    if (s === "Blocked") return "Not for sale";
    return u.AreaSqFt ? `${Number(u.AreaSqFt).toLocaleString("en-IN")} sq ft` : "Free";
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: b.surface }} contentContainerStyle={{ paddingBottom: 100 }}>

      {/* ── Filter bar ──────────────────────────────────── */}
      <View style={{ margin: 14, gap: 10 }}>
        <PickerCard label="Project" value={projectName}
          placeholder={projectsQ.isLoading ? "Loading…" : "Pick a project"}
          onPress={() => setProjectOpen(true)} loading={projectsQ.isLoading} b={b} />
        {projectId ? (
          <PickerCard label="Block" value={blockName} placeholder="All blocks"
            onPress={() => setBlockOpen(true)} loading={blocksQ.isLoading} b={b} />
        ) : null}
      </View>

      {!projectId ? (
        <EmptyState text="Pick a project to view the unit matrix." b={b} />
      ) : unitsQ.isLoading ? (
        <ActivityIndicator color={b.accent} style={{ marginTop: 60 }} />
      ) : unitsQ.isError ? (
        <EmptyState text="Could not load units." danger b={b} />
      ) : !unitsQ.data?.length ? (
        <EmptyState text="No units in this selection." b={b} />
      ) : (
        <>
          {/* ── Stats ─────────────────────────────────────── */}
          <View style={{ flexDirection: "row", gap: 8, marginHorizontal: 14, marginBottom: 18 }}>
            <StatCard label="Free" value={counts.Available} note={`of ${total}`} accent={STAT_ACCENT.Available} b={b} />
            <StatCard label="On hold" value={counts.OnHold} note="Held" accent={STAT_ACCENT.OnHold} b={b} />
            <StatCard label="Booked" value={counts.Booked} note={`${soldPct}%`} accent={STAT_ACCENT.Booked} b={b} />
            <StatCard label="Blocked" value={counts.Blocked} note="N/A" accent={STAT_ACCENT.Blocked} b={b} />
          </View>

          {/* ── Legend ──────────────────────────────────────*/}
          <Legend b={b} />

          {/* ── Block sections ──────────────────────────── */}
          <View style={{ gap: 24, paddingHorizontal: 14 }}>
            {grouped.map(({ blockName, floors, total: bt, free }) => (
              <View key={blockName}>
                <BlockHeader title={blockName} note={`${bt} total · ${free} free`} b={b} />
                <View style={{ gap: 16, marginTop: 14 }}>
                  {floors.map(([floor, units]) => (
                    <View key={floor}>
                      <Text style={{ fontSize: 10, fontFamily: fonts.heading.semibold, color: b.textSecondary, letterSpacing: 0.7, textTransform: "uppercase", marginBottom: 8 }}>
                        {floor}
                      </Text>
                      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 7 }}>
                        {units.map((u) => (
                          <UnitTile
                            key={`${u.IsPlot ? "p" : "u"}${u.Id}`}
                            name={u.UnitName}
                            line={tileLine(u)}
                            status={deriveStatus(u)}
                            tag={u.IsVilla ? (u.VillaTypeCode || "Villa") : null}
                            onPress={() => {
                              const s = deriveStatus(u);
                              if (s === "Booked" || s === "OnHold" || s === "On Hold") setInfoUnit(u);
                              else if (s === "Available" && canApply && projectId) {
                                nav.navigate("CrmApplicationForm", { pick: u.IsPlot ? { ProjectId: projectId, PlotId: u.Id } : { ProjectId: projectId, UnitId: u.Id } });
                              }
                            }}
                          />
                        ))}
                      </View>
                    </View>
                  ))}
                </View>
              </View>
            ))}
          </View>
        </>
      )}

      <OptionSheet visible={projectOpen} title="Project"
        options={(projectsQ.data ?? []).map((p) => ({ id: p.Id, label: p.Name }))}
        onSelect={(id) => { const p = projectsQ.data?.find((x) => x.Id === Number(id)); if (p) { setProjectId(p.Id); setProjectName(p.Name); } setProjectOpen(false); }}
        onClose={() => setProjectOpen(false)} />
      <OptionSheet visible={blockOpen} title="Block"
        options={[{ id: 0, label: "All blocks" }, ...(blocksQ.data ?? []).map((bl) => ({ id: bl.Id, label: bl.Name }))]}
        onSelect={(id) => {
          if (Number(id) === 0) { setBlockId(null); setBlockName("All blocks"); }
          else { const bl = blocksQ.data?.find((x) => x.Id === Number(id)); if (bl) { setBlockId(bl.Id); setBlockName(bl.Name); } }
          setBlockOpen(false);
        }}
        onClose={() => setBlockOpen(false)} />

      {infoUnit && (
        <UnitInfoSheet unit={infoUnit} onClose={() => setInfoUnit(null)}
          onOpenBooking={() => {
            if (infoUnit.BookingId) {
              setInfoUnit(null);
              nav.navigate("CrmBooking", { bookingId: infoUnit.BookingId, title: infoUnit.BookingNo || infoUnit.UnitName });
            }
          }} />
      )}
    </ScrollView>
  );
}

// ── Shared tile sub-components ─────────────────────────────────────────────────

function UnitTile({ name, line, status, tag, onPress }: {
  name: string; line: string; status: string; tag?: string | null; onPress: () => void;
}) {
  const ts = tileStyle(status);
  const tappable = status === "Booked" || status === "OnHold" || status === "On Hold";
  return (
    <Pressable
      onPress={tappable ? onPress : undefined}
      style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1 })}
    >
      <LinearGradient
        colors={[ts.grad[0] + "ee", ts.grad[1] + "ff"]}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={{
          width: 82, minHeight: 64, borderRadius: 12, padding: 8,
          borderWidth: 1, borderColor: ts.accent + "55",
          justifyContent: "space-between",
        }}
      >
        {/* Top: name + optional tag */}
        <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 2 }}>
          <Text numberOfLines={1} style={{ color: ts.ink, fontSize: 12.5, fontFamily: fonts.heading.semibold, flex: 1 }}>
            {name}
          </Text>
          {tag && (
            <View style={{ backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 4, paddingHorizontal: 3, paddingVertical: 1 }}>
              <Text style={{ color: ts.ink, fontSize: 7.5, fontFamily: fonts.heading.semibold, letterSpacing: 0.3 }}>{tag}</Text>
            </View>
          )}
        </View>
        {/* Bottom: sub-line */}
        <Text numberOfLines={2} style={{ color: ts.dimInk, fontSize: 9.5, fontFamily: fonts.body.regular, lineHeight: 13, marginTop: 4 }}>
          {line}
        </Text>
        {/* Accent dot */}
        <View style={{ position: "absolute", bottom: 7, right: 8, width: 5, height: 5, borderRadius: 3, backgroundColor: ts.accent + "aa" }} />
      </LinearGradient>
    </Pressable>
  );
}

function PickerCard({ label, value, placeholder, onPress, loading, b }: {
  label: string; value: string; placeholder: string; onPress: () => void; loading?: boolean; b: ReturnType<typeof useBrand>;
}) {
  return (
    <View>
      <Text style={{ fontSize: 10, fontFamily: fonts.heading.semibold, color: b.textSecondary, letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 6 }}>{label}</Text>
      <Pressable
        onPress={onPress}
        style={({ pressed }) => ({
          flexDirection: "row", alignItems: "center", justifyContent: "space-between",
          paddingHorizontal: 14, paddingVertical: 13, borderRadius: 12, borderWidth: 1,
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

function StatCard({ label, value, note, accent, b }: {
  label: string; value: number; note: string; accent: string; b: ReturnType<typeof useBrand>;
}) {
  return (
    <View style={{
      flex: 1, backgroundColor: b.surfaceCard, borderRadius: 12,
      borderWidth: 1, borderColor: b.border, overflow: "hidden",
    }}>
      {/* coloured top strip */}
      <View style={{ height: 3, backgroundColor: accent }} />
      <View style={{ padding: 10, alignItems: "center" }}>
        <Text style={{ fontSize: 24, fontFamily: fonts.heading.semibold, color: b.textPrimary, lineHeight: 30 }}>{value}</Text>
        <Text style={{ fontSize: 10, fontFamily: fonts.heading.semibold, color: b.textPrimary, letterSpacing: 0.3, marginTop: 1 }}>{label}</Text>
        <Text style={{ fontSize: 9, fontFamily: fonts.body.regular, color: b.textSecondary, marginTop: 2 }} numberOfLines={1}>{note}</Text>
      </View>
    </View>
  );
}

function BlockHeader({ title, note, b }: { title: string; note: string; b: ReturnType<typeof useBrand> }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: b.border }}>
      <Text style={{ fontSize: 15, fontFamily: fonts.heading.semibold, color: b.textPrimary }}>{title}</Text>
      <View style={{ backgroundColor: b.border, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 }}>
        <Text style={{ fontSize: 10.5, fontFamily: fonts.body.regular, color: b.textSecondary }}>{note}</Text>
      </View>
    </View>
  );
}

function Legend({ b }: { b: ReturnType<typeof useBrand> }) {
  const items = [
    { label: "Free", accent: TILE_STYLE.Available.accent },
    { label: "On Hold", accent: TILE_STYLE.OnHold.accent },
    { label: "Booked", accent: TILE_STYLE.Booked.accent },
    { label: "Blocked", accent: TILE_STYLE.Blocked.accent },
  ];
  return (
    <View style={{ flexDirection: "row", gap: 14, paddingHorizontal: 14, marginBottom: 16, flexWrap: "wrap" }}>
      {items.map((item) => (
        <View key={item.label} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: item.accent }} />
          <Text style={{ fontSize: 11, fontFamily: fonts.body.regular, color: b.textSecondary }}>{item.label}</Text>
        </View>
      ))}
    </View>
  );
}

function EmptyState({ text, danger, b }: { text: string; danger?: boolean; b: ReturnType<typeof useBrand> }) {
  return (
    <Text style={{ color: danger ? b.danger : b.textSecondary, fontSize: 14, fontFamily: fonts.body.regular, textAlign: "center", marginTop: 60, paddingHorizontal: 24 }}>
      {text}
    </Text>
  );
}
