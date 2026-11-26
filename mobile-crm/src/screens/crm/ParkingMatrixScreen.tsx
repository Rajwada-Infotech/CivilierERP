// CRM Parking Matrix — project + block pickers, stats bar, block+type-grouped tile grid.
// Mirrors web CrmParkingMatrix.tsx. Tap a Sold/OnHold tile → info sheet.
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

// ── Status palette ──────────────────────────────────────────────────────────────
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

const STAT_ACCENT: Record<string, string> = {
  Available: "#10b981", OnHold: "#f59e0b", Booked: "#3b82f6", Blocked: "#4b5563",
};

type SlotRow = {
  Id: number; SlotNo: string; ParkingType: string | null;
  BlockId: number | null; BlockName: string | null;
  Status: string;
  AllotmentId: number | null; BookingId: number | null; BookingNo: string | null;
  AllotmentDate: string | null; TotalAmount: number | null; AllotmentPaymentStatus: string | null;
  Quantity: number | null;
  ApplicationId: number | null; ApplicationNo: string | null;
  ApplicantName: string | null; Mobile: string | null; AssignedToName: string | null;
  HoldId: number | null; HoldUntil: string | null;
  HoldApplicantName: string | null; HoldMobile: string | null; HoldAssignedToName: string | null;
  IsActive: boolean; LockAllotmentId: number | null; LockBookingNo: string | null; LockHoldId: number | null;
};

function deriveStatus(r: SlotRow): string {
  if (r.Status) return r.Status;
  if (!r.IsActive) return "Blocked";
  if (r.LockBookingNo || r.LockAllotmentId) return "Booked";
  if (r.LockHoldId) return "On Hold";
  return "Available";
}

const fmtMoney = (v: number | null | undefined) =>
  v == null ? "—" : `₹ ${Number(v).toLocaleString("en-IN")}`;

const initials = (name: string | null | undefined) => {
  if (!name) return "—";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

const fetchProjects = async () => {
  const r = await fetchWithAuth("/api/parking-matrix/projects");
  if (!r.ok) throw new Error(String(r.status));
  return r.json() as Promise<{ Id: number; Name: string }[]>;
};
const fetchBlocks = async (pid: number) => {
  const r = await fetchWithAuth(`/api/parking-matrix/blocks?projectId=${pid}`);
  if (!r.ok) throw new Error(String(r.status));
  return r.json() as Promise<{ Id: number; Name: string }[]>;
};
const fetchSlots = async (pid: number, bid: number | null) => {
  const url = bid ? `/api/parking-matrix?projectId=${pid}&blockId=${bid}` : `/api/parking-matrix?projectId=${pid}`;
  const r = await fetchWithAuth(url);
  if (!r.ok) throw new Error(String(r.status));
  return r.json() as Promise<SlotRow[]>;
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

function SlotInfoSheet({ slot, onClose, onOpenRecord }: {
  slot: SlotRow; onClose: () => void; onOpenRecord: () => void;
}) {
  const b = useBrand();
  const insets = useSafeAreaInsets();
  const status = deriveStatus(slot);
  const ts = tileStyle(status);
  const isHold = status === "OnHold" || status === "On Hold";
  const hasUnpaidSale = isHold && slot.AllotmentId != null;
  const statLabel = isHold ? (hasUnpaidSale ? "Sold, charge pending" : "On Hold") : "Sold";
  const person = isHold ? (slot.HoldApplicantName || slot.ApplicantName) : slot.ApplicantName;
  const mobile = isHold ? (slot.HoldMobile || slot.Mobile) : slot.Mobile;
  const salesperson = isHold ? (slot.HoldAssignedToName || slot.AssignedToName) : slot.AssignedToName;
  const holdUntil = slot.HoldUntil ? String(slot.HoldUntil).slice(0, 10) : null;
  const canOpen = slot.BookingId != null || slot.ApplicationId != null;

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
          <View style={{ alignItems: "center", paddingTop: 12, paddingBottom: 4 }}>
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: b.border }} />
          </View>

          {/* Gradient header */}
          <LinearGradient
            colors={[ts.grad[0] + "ee", ts.grad[1] + "ff"]}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
            style={{ marginHorizontal: 20, marginBottom: 16, borderRadius: 14, padding: 16, flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" }}
          >
            <View>
              <Text style={{ fontSize: 10, fontFamily: fonts.heading.semibold, color: ts.dimInk, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 4 }}>
                Parking slot
              </Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <Text style={{ fontSize: 24, fontFamily: fonts.heading.semibold, color: ts.ink }}>{slot.SlotNo}</Text>
                <View style={{ backgroundColor: "rgba(255,255,255,0.15)", paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 }}>
                  <Text style={{ color: ts.ink, fontSize: 10.5, fontFamily: fonts.heading.semibold }}>{statLabel}</Text>
                </View>
              </View>
              <Text style={{ fontSize: 11.5, color: ts.dimInk, fontFamily: fonts.body.regular, marginTop: 4 }}>
                {[slot.ParkingType, slot.BlockName, slot.Quantity ? `Qty ${slot.Quantity}` : null].filter(Boolean).join(" · ")}
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
            <Text style={{ fontSize: 10, fontFamily: fonts.heading.semibold, color: b.textSecondary, letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 6 }}>Customer</Text>
            <InfoRow label="Applicant" value={person} />
            <InfoRow label="Mobile" value={mobile} />
            <InfoRow label="Salesperson" value={salesperson} />

            {slot.AllotmentId != null && (
              <>
                <Text style={{ fontSize: 10, fontFamily: fonts.heading.semibold, color: b.textSecondary, letterSpacing: 0.6, textTransform: "uppercase", marginTop: 16, marginBottom: 6 }}>Sale</Text>
                <InfoRow label="Booking" value={slot.BookingNo || "Standalone parking sale"} />
                <InfoRow label="Payment" value={slot.AllotmentPaymentStatus} />
                <InfoRow label="Sold on" value={slot.AllotmentDate ? String(slot.AllotmentDate).slice(0, 10) : null} />
                <InfoRow label="Charge" value={fmtMoney(slot.TotalAmount)} />
              </>
            )}

            {isHold && holdUntil && (
              <View style={{ marginTop: 14, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: b.border }}>
                <Text style={{ fontSize: 12, color: b.textSecondary, fontFamily: fonts.body.regular }}>
                  Held until {holdUntil}{hasUnpaidSale ? " · parking charge not yet paid." : " · for the customer while they decide."}
                </Text>
              </View>
            )}

            {canOpen && (
              <Pressable
                onPress={onOpenRecord}
                style={({ pressed }) => ({
                  marginTop: 20, height: 46, borderRadius: 12, alignItems: "center", justifyContent: "center",
                  backgroundColor: pressed ? b.accent + "cc" : b.accent,
                })}
              >
                <Text style={{ color: "#fff", fontSize: 14, fontFamily: fonts.heading.semibold }}>
                  {slot.BookingId != null ? "Open booking" : "Open application"}
                </Text>
              </Pressable>
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ── Main screen ────────────────────────────────────────────────────────────────
export default function ParkingMatrixScreen() {
  const nav = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const b = useBrand();
  const [projectId, setProjectId] = useState<number | null>(null);
  const [projectName, setProjectName] = useState("");
  const [blockId, setBlockId] = useState<number | null>(null);
  const [blockName, setBlockName] = useState("All blocks");
  const [projectOpen, setProjectOpen] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);
  const [infoSlot, setInfoSlot] = useState<SlotRow | null>(null);

  const projectsQ = useQuery({ queryKey: ["parking-matrix-projects"], queryFn: fetchProjects });
  const blocksQ = useQuery({ queryKey: ["parking-matrix-blocks", projectId], queryFn: () => fetchBlocks(projectId!), enabled: !!projectId });
  const slotsQ = useQuery({ queryKey: ["parking-matrix-slots", projectId, blockId], queryFn: () => fetchSlots(projectId!, blockId), enabled: !!projectId });

  useEffect(() => { setBlockId(null); setBlockName("All blocks"); }, [projectId]);
  useEffect(() => {
    if (projectsQ.data?.length === 1 && !projectId) {
      setProjectId(projectsQ.data[0].Id); setProjectName(projectsQ.data[0].Name);
    }
  }, [projectsQ.data]);

  const grouped = useMemo(() => {
    if (!slotsQ.data) return [];
    const byBlock = new Map<string, Map<string, SlotRow[]>>();
    for (const s of slotsQ.data) {
      const bk = s.BlockName || "No block";
      const tk = s.ParkingType || "Parking";
      if (!byBlock.has(bk)) byBlock.set(bk, new Map());
      const inner = byBlock.get(bk)!;
      if (!inner.has(tk)) inner.set(tk, []);
      inner.get(tk)!.push(s);
    }
    return Array.from(byBlock.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([bName, typeMap]) => {
      const types = Array.from(typeMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([t, list]) => [t, [...list].sort((x, y) => x.SlotNo.localeCompare(y.SlotNo))] as const);
      const all = types.flatMap(([, l]) => l);
      return { blockName: bName, types, total: all.length, free: all.filter((s) => deriveStatus(s) === "Available").length };
    });
  }, [slotsQ.data]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { Available: 0, OnHold: 0, Booked: 0, Blocked: 0 };
    (slotsQ.data ?? []).forEach((s) => {
      const st = deriveStatus(s);
      if (st === "Available") c.Available++;
      else if (st === "OnHold" || st === "On Hold") c.OnHold++;
      else if (st === "Booked") c.Booked++;
      else c.Blocked++;
    });
    return c;
  }, [slotsQ.data]);

  const total = slotsQ.data?.length ?? 0;
  const forSale = total - counts.Blocked;
  const soldPct = forSale > 0 ? Math.round((counts.Booked / forSale) * 100) : 0;
  const unpaidSales = (slotsQ.data ?? []).filter((s) => deriveStatus(s) === "OnHold" && s.AllotmentId != null).length;

  const tileLine = (s: SlotRow) => {
    const st = deriveStatus(s);
    if (st === "Booked") return s.ApplicantName || s.BookingNo || "—";
    if (st === "OnHold" || st === "On Hold") return s.HoldApplicantName || s.ApplicantName || "—";
    if (st === "Blocked") return "Not for sale";
    return "Free";
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
        <EmptyState text="Pick a project to view the parking matrix." b={b} />
      ) : slotsQ.isLoading ? (
        <ActivityIndicator color={b.accent} style={{ marginTop: 60 }} />
      ) : slotsQ.isError ? (
        <EmptyState text="Could not load parking slots." danger b={b} />
      ) : !slotsQ.data?.length ? (
        <EmptyState text="No parking slots in this selection." b={b} />
      ) : (
        <>
          {/* ── Stats ─────────────────────────────────────── */}
          <View style={{ flexDirection: "row", gap: 8, marginHorizontal: 14, marginBottom: 18 }}>
            <StatCard label="Free" value={counts.Available} note={`of ${total}`} accent={STAT_ACCENT.Available} b={b} />
            <StatCard label="On hold" value={counts.OnHold} note={unpaidSales ? `${unpaidSales} unpaid` : "Held"} accent={STAT_ACCENT.OnHold} b={b} />
            <StatCard label="Sold" value={counts.Booked} note={`${soldPct}%`} accent={STAT_ACCENT.Booked} b={b} />
            <StatCard label="Blocked" value={counts.Blocked} note="N/A" accent={STAT_ACCENT.Blocked} b={b} />
          </View>

          {/* ── Legend ──────────────────────────────────────*/}
          <Legend soldLabel="Sold" b={b} />

          {/* ── Block sections ──────────────────────────── */}
          <View style={{ gap: 24, paddingHorizontal: 14 }}>
            {grouped.map(({ blockName, types, total: bt, free }) => (
              <View key={blockName}>
                <BlockHeader title={blockName} note={`${bt} total · ${free} free`} b={b} />
                <View style={{ gap: 16, marginTop: 14 }}>
                  {types.map(([type, slots]) => (
                    <View key={type}>
                      <Text style={{ fontSize: 10, fontFamily: fonts.heading.semibold, color: b.textSecondary, letterSpacing: 0.7, textTransform: "uppercase", marginBottom: 8 }}>
                        {type}
                      </Text>
                      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 7 }}>
                        {slots.map((s) => (
                          <SlotTile
                            key={s.Id}
                            name={s.SlotNo}
                            line={tileLine(s)}
                            status={deriveStatus(s)}
                            onPress={() => {
                              const st = deriveStatus(s);
                              if (st === "Booked" || st === "OnHold" || st === "On Hold") setInfoSlot(s);
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

      {infoSlot && (
        <SlotInfoSheet slot={infoSlot} onClose={() => setInfoSlot(null)}
          onOpenRecord={() => {
            if (!infoSlot) return;
            setInfoSlot(null);
            if (infoSlot.BookingId) nav.navigate("CrmBooking", { bookingId: infoSlot.BookingId, title: infoSlot.BookingNo || infoSlot.SlotNo });
          }} />
      )}
    </ScrollView>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function SlotTile({ name, line, status, onPress }: {
  name: string; line: string; status: string; onPress: () => void;
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
          minWidth: 68, minHeight: 60, borderRadius: 12, padding: 8,
          borderWidth: 1, borderColor: ts.accent + "55",
          alignItems: "center", justifyContent: "center",
        }}
      >
        <Text numberOfLines={1} style={{ color: ts.ink, fontSize: 12.5, fontFamily: fonts.heading.semibold, textAlign: "center" }}>
          {name}
        </Text>
        <Text numberOfLines={2} style={{ color: ts.dimInk, fontSize: 9.5, fontFamily: fonts.body.regular, textAlign: "center", lineHeight: 13, marginTop: 3 }}>
          {line}
        </Text>
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

function Legend({ soldLabel = "Booked", b }: { soldLabel?: string; b: ReturnType<typeof useBrand> }) {
  const items = [
    { label: "Free", accent: TILE_STYLE.Available.accent },
    { label: "On Hold", accent: TILE_STYLE.OnHold.accent },
    { label: soldLabel, accent: TILE_STYLE.Booked.accent },
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
