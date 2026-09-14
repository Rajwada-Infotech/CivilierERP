// RN port of src/pages/admin/FinYearRights.tsx (web) — same stats row,
// search, year cards (status/lock badges, progress bar for the active
// year), create/edit form, lock toggle, delete confirm.
import { useEffect, useMemo, useState } from "react";
import { View, Text, FlatList, Pressable, TextInput, ActivityIndicator, RefreshControl, Alert, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Search, X, Plus, CalendarRange, CheckCircle2, CalendarDays, ShieldCheck, Lock, Unlock, Edit3, Trash2 } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { useAuth } from "@/auth/AuthContext";
import { getAllFinYears, toggleFinYearLock, deleteFinYear, type FinYear } from "@/api/finYearRightsApi";
import { FinYearFormModal } from "./FinYearFormModal";

function fmtDate(d: string) {
  if (!d) return "—";
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? d : dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function periodProgress(startDate: string, endDate: string): number {
  const now = Date.now();
  const start = new Date(startDate).getTime();
  const end = new Date(endDate).getTime();
  if (!start || !end || end <= start) return 0;
  return Math.min(100, Math.max(0, ((now - start) / (end - start)) * 100));
}

function StatTile({ icon: Icon, label, value, accent }: { icon: React.ComponentType<{ size?: number; color?: string }>; label: string; value: number; accent: string }) {
  return (
    <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 8, padding: 11, borderRadius: 14, backgroundColor: `${colors.card}80`, borderWidth: 1, borderColor: `${colors.border}99`, minWidth: "47%" }}>
      <View style={{ width: 30, height: 30, borderRadius: 9, backgroundColor: `${accent}1f`, alignItems: "center", justifyContent: "center" }}>
        <Icon size={13} color={accent} />
      </View>
      <View>
        <Text style={{ color: colors.foreground, fontSize: 15, fontFamily: fonts.heading.bold, lineHeight: 18 }}>{value}</Text>
        <Text style={{ color: colors.mutedForeground, fontSize: 9.5, marginTop: 1 }}>{label}</Text>
      </View>
    </View>
  );
}

function YearCard({
  fy, lockPending, onEdit, onToggleLock, onDelete, canEdit, canDelete,
}: { fy: FinYear; lockPending: boolean; onEdit: () => void; onToggleLock: () => void; onDelete: () => void; canEdit: boolean; canDelete: boolean }) {
  const isActive = fy.status === "Active";
  const progress = isActive ? periodProgress(fy.startDate, fy.endDate) : 0;
  const accent = isActive ? "#3b82f6" : "#64748b";

  return (
    <View style={{ borderRadius: 18, overflow: "hidden", marginBottom: 10, backgroundColor: `${colors.card}80`, borderWidth: 1, borderColor: `${colors.border}99` }}>
      <View style={{ height: 3, backgroundColor: accent }} />
      <View style={{ padding: 14 }}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 10 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}>
            <View style={{ width: 38, height: 38, borderRadius: 11, backgroundColor: `${accent}1f`, alignItems: "center", justifyContent: "center" }}>
              <CalendarRange size={15} color={accent} />
            </View>
            <View>
              <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 14, fontFamily: fonts.heading.bold }}>{fy.year}</Text>
              <Text style={{ color: colors.mutedForeground, fontSize: 10, marginTop: 1 }}>Financial Year</Text>
            </View>
          </View>
          <View style={{ alignItems: "flex-end", gap: 4 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, backgroundColor: isActive ? "#10b9811a" : `${colors.mutedForeground}1a` }}>
              <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: isActive ? "#10b981" : colors.mutedForeground }} />
              <Text style={{ color: isActive ? "#10b981" : colors.mutedForeground, fontSize: 9.5, fontFamily: fonts.heading.semibold }}>{fy.status}</Text>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, backgroundColor: fy.locked ? "#f59e0b1a" : colors.muted }}>
              {fy.locked ? <Lock size={8} color="#f59e0b" /> : <Unlock size={8} color={colors.mutedForeground} />}
              <Text style={{ color: fy.locked ? "#f59e0b" : colors.mutedForeground, fontSize: 9.5, fontFamily: fonts.heading.semibold }}>{fy.locked ? "Locked" : "Open"}</Text>
            </View>
          </View>
        </View>

        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, padding: 10, borderRadius: 12, backgroundColor: `${colors.muted}66`, marginBottom: 10 }}>
          <CalendarDays size={11} color="#3b82f6b3" />
          <Text style={{ color: colors.foreground, fontSize: 11, fontFamily: fonts.body.medium }}>{fmtDate(fy.startDate)}</Text>
          <Text style={{ color: `${colors.mutedForeground}66` }}>→</Text>
          <Text style={{ color: colors.foreground, fontSize: 11, fontFamily: fonts.body.medium }}>{fmtDate(fy.endDate)}</Text>
        </View>

        {isActive && (
          <View style={{ marginBottom: 10 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}>
              <Text style={{ color: colors.mutedForeground, fontSize: 9.5 }}>Year progress</Text>
              <Text style={{ color: colors.foreground, fontSize: 9.5, fontFamily: fonts.heading.semibold }}>{Math.round(progress)}%</Text>
            </View>
            <View style={{ height: 5, borderRadius: 3, backgroundColor: colors.muted, overflow: "hidden" }}>
              <View style={{ height: "100%", width: `${progress}%`, borderRadius: 3, backgroundColor: "#3b82f6" }} />
            </View>
          </View>
        )}

        {(canEdit || canDelete) && (
          <View style={{ flexDirection: "row", gap: 8, paddingTop: 10, borderTopWidth: 1, borderTopColor: `${colors.border}66` }}>
            {canEdit && (
              <Pressable onPress={onEdit} style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: colors.border }}>
                <Edit3 size={11} color={colors.mutedForeground} />
                <Text style={{ color: colors.mutedForeground, fontSize: 10.5, fontFamily: fonts.heading.medium }}>Edit</Text>
              </Pressable>
            )}
            {canEdit && (
              <Pressable
                onPress={onToggleLock}
                disabled={lockPending}
                style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: fy.locked ? "#10b98166" : "#f59e0b66", opacity: lockPending ? 0.5 : 1 }}
              >
                {lockPending ? <ActivityIndicator size="small" color={colors.mutedForeground} /> : fy.locked ? <Unlock size={11} color="#10b981" /> : <Lock size={11} color="#f59e0b" />}
                <Text style={{ color: fy.locked ? "#10b981" : "#f59e0b", fontSize: 10.5, fontFamily: fonts.heading.medium }}>{fy.locked ? "Unlock" : "Lock"}</Text>
              </Pressable>
            )}
            {canDelete && (
              <Pressable onPress={onDelete} style={{ paddingHorizontal: 12, alignItems: "center", justifyContent: "center", borderRadius: 10, borderWidth: 1, borderColor: colors.border }}>
                <Trash2 size={12} color={colors.mutedForeground} />
              </Pressable>
            )}
          </View>
        )}
      </View>
    </View>
  );
}

export default function FinYearRightsScreen() {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { canDoAction } = useAuth();
  const canCreate = canDoAction("fin-year-rights", "create");
  const canEdit = canDoAction("fin-year-rights", "edit");
  const canDelete = canDoAction("fin-year-rights", "delete");
  const [finYears, setFinYears] = useState<FinYear[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<FinYear | null>(null);
  const [pendingLockId, setPendingLockId] = useState<string | null>(null);

  const load = async (isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    try {
      setFinYears(await getAllFinYears());
    } catch (e: any) {
      Alert.alert("Error", e.message || "Failed to load financial years");
    } finally {
      isRefresh ? setRefreshing(false) : setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return finYears;
    const q = search.toLowerCase();
    return finYears.filter((fy) => fy.year.toLowerCase().includes(q) || fy.startDate.includes(search) || fy.endDate.includes(search));
  }, [finYears, search]);

  const activeCount = finYears.filter((f) => f.status === "Active").length;
  const closedCount = finYears.length - activeCount;
  const lockedCount = finYears.filter((f) => f.locked).length;

  const openNew = () => { setEditing(null); setFormOpen(true); };
  const openEdit = (fy: FinYear) => { setEditing(fy); setFormOpen(true); };

  const handleToggleLock = async (fy: FinYear) => {
    setPendingLockId(fy.id);
    try {
      await toggleFinYearLock(fy.id, !fy.locked);
      load(true);
    } catch (e: any) {
      Alert.alert("Error", e.message || "Failed to change lock");
    } finally {
      setPendingLockId(null);
    }
  };

  const confirmDelete = (fy: FinYear) => {
    Alert.alert("Delete Financial Year?", `"${fy.year}" will be permanently removed. This can't be undone.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteFinYear(fy.id);
            load(true);
          } catch (e: any) {
            Alert.alert("Delete failed", e.message || "Something went wrong.");
          }
        },
      },
    ]);
  };

  const ListHeader = (
    <View style={{ width: width - 32, marginBottom: 14 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 3 }}>
        <Text style={{ color: colors.foreground, fontSize: 15, fontFamily: fonts.heading.bold }}>Financial Year Rights</Text>
      </View>
      <Text style={{ color: colors.mutedForeground, fontSize: 11.5, marginBottom: 14 }}>
        Manage financial years, date ranges, and lock status.
      </Text>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
        <StatTile icon={CalendarRange} label="Total Years" value={finYears.length} accent="#3b82f6" />
        <StatTile icon={CheckCircle2} label="Active" value={activeCount} accent="#10b981" />
        <StatTile icon={X} label="Closed" value={closedCount} accent="#64748b" />
        <StatTile icon={ShieldCheck} label="Locked" value={lockedCount} accent="#f59e0b" />
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border }}>
        <Search size={13} color={colors.mutedForeground} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search financial years…"
          placeholderTextColor={`${colors.mutedForeground}99`}
          style={{ flex: 1, color: colors.foreground, fontFamily: fonts.body.regular, fontSize: 12.5, paddingVertical: 10 }}
        />
        {!!search && (
          <Pressable onPress={() => setSearch("")} hitSlop={6}>
            <X size={13} color={colors.mutedForeground} />
          </Pressable>
        )}
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={colors.mutedForeground} />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(fy) => fy.id}
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 16, paddingTop: 12 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.primary} />}
          ListHeaderComponent={ListHeader}
          renderItem={({ item }) => (
            <YearCard
              fy={item}
              lockPending={pendingLockId === item.id}
              onEdit={() => openEdit(item)}
              onToggleLock={() => handleToggleLock(item)}
              onDelete={() => confirmDelete(item)}
              canEdit={canEdit}
              canDelete={canDelete}
            />
          )}
          ListEmptyComponent={
            <View style={{ alignItems: "center", paddingVertical: 40 }}>
              <CalendarDays size={26} color={`${colors.mutedForeground}4d`} />
              <Text style={{ color: `${colors.mutedForeground}99`, fontSize: 13, fontFamily: fonts.body.medium, marginTop: 12 }}>
                {search ? "No years match your search." : "No financial years configured."}
              </Text>
            </View>
          }
        />
      )}

      {/* Offset above NavSheet.tsx's own Menu FAB, which occupies this same
          corner (right:20, bottom: insets.bottom+20) on every screen. */}
      {canCreate && (
        <Pressable
          onPress={openNew}
          style={{ position: "absolute", right: 20, bottom: insets.bottom + 90, width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center", backgroundColor: colors.primary, elevation: 6, shadowColor: colors.primary, shadowOpacity: 0.4, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } }}
        >
          <Plus size={22} color="#fff" />
        </Pressable>
      )}

      <FinYearFormModal visible={formOpen} editing={editing} onClose={() => setFormOpen(false)} onSaved={() => load(true)} />
    </View>
  );
}
