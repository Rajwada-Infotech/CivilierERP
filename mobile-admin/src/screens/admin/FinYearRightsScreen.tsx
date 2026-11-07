// RN port of src/pages/admin/FinYearRights.tsx (web), on the drawing sheet as the web draws it: the title block with
// New year; the figures (years, active, closed, locked); the search; and one ruled card per year — "Financial year" and
// the year, an Active mark or its status, a Locked (filled ink) or Open tag, the date range between faint rules, the
// year's progress as an ink bar while it is active, and Edit / Lock / Delete keys. A closed year's card is dashed, as on
// the web. New and Edit open the FinYearForm page; the list reloads when you come back to it.
import { useCallback, useMemo, useState } from "react";
import { View, Text, Alert } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { CalendarDays, Edit3, Lock, Plus, Trash2, Unlock } from "lucide-react-native";
import { sheet as S } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { useAuth } from "@/auth/AuthContext";
import type { MainStackParamList } from "@/navigation/MainStack";
import { getAllFinYears, toggleFinYearLock, deleteFinYear, type FinYear } from "@/api/finYearRightsApi";
import { Body, IconKey, Key, Label, Notice, SearchBox, SheetMark, SheetShell, StatGrid } from "@/components/sheet/Sheet";
import { RegisterLoading, SheetPage } from "@/components/sheet/Register";

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

function YearCard({
  fy, lockPending, onEdit, onToggleLock, onDelete, canEdit, canDelete,
}: { fy: FinYear; lockPending: boolean; onEdit: () => void; onToggleLock: () => void; onDelete: () => void; canEdit: boolean; canDelete: boolean }) {
  const isActive = fy.status === "Active";
  const progress = isActive ? periodProgress(fy.startDate, fy.endDate) : 0;

  return (
    <View style={{ borderWidth: 1, borderStyle: isActive ? "solid" : "dashed", borderColor: isActive ? S.ink : S.line40 }}>
      <View style={{ padding: 12, gap: 10 }}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Label>Financial year</Label>
            <Text numberOfLines={1} style={{ fontFamily: fonts.heading.bold, fontSize: 20, color: S.ink, marginTop: 2 }}>{fy.year}</Text>
          </View>
          <View style={{ alignItems: "flex-end", gap: 6 }}>
            {isActive ? <SheetMark text="Active" tone="done" /> : <Label>{fy.status}</Label>}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1, borderColor: fy.locked ? S.ink : S.line40, backgroundColor: fy.locked ? S.ink : "transparent" }}>
              {fy.locked ? <Lock size={9} color={S.paper} /> : <Unlock size={9} color={S.graphite} />}
              <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 9, letterSpacing: 0.9, textTransform: "uppercase", color: fy.locked ? S.paper : S.graphite }}>{fy.locked ? "Locked" : "Open"}</Text>
            </View>
          </View>
        </View>

        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8, borderTopWidth: 1, borderBottomWidth: 1, borderColor: S.line15 }}>
          <CalendarDays size={12} color={S.graphite} />
          <Text style={{ fontFamily: fonts.body.medium, fontSize: 12, color: S.ink }}>{fmtDate(fy.startDate)}</Text>
          <Text style={{ color: S.graphite }}>→</Text>
          <Text style={{ fontFamily: fonts.body.medium, fontSize: 12, color: S.ink }}>{fmtDate(fy.endDate)}</Text>
        </View>

        {isActive && (
          <View style={{ gap: 6 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Label>Year progress</Label>
              <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 12, color: S.ink }}>{Math.round(progress)}%</Text>
            </View>
            <View style={{ height: 8, borderWidth: 1, borderColor: S.line40, overflow: "hidden" }}>
              <View style={{ height: "100%", width: `${progress}%`, backgroundColor: S.ink }} />
            </View>
          </View>
        )}
      </View>

      {(canEdit || canDelete) && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: S.line15 }}>
          {canEdit && <Key label="Edit" icon={<Edit3 size={12} color={S.ink} />} onPress={onEdit} style={{ flex: 1, minHeight: 36 }} />}
          {canEdit && (
            <Key
              label={lockPending ? "…" : fy.locked ? "Unlock" : "Lock"}
              icon={fy.locked ? <Unlock size={12} color={S.ink} /> : <Lock size={12} color={S.ink} />}
              onPress={onToggleLock}
              disabled={lockPending}
              style={{ flex: 1, minHeight: 36 }}
            />
          )}
          {canDelete && (
            <IconKey red onPress={onDelete} size={36}>
              <Trash2 size={13} color={S.red} />
            </IconKey>
          )}
        </View>
      )}
    </View>
  );
}

export default function FinYearRightsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const { canDoAction } = useAuth();
  const canCreate = canDoAction("fin-year-rights", "create");
  const canEdit = canDoAction("fin-year-rights", "edit");
  const canDelete = canDoAction("fin-year-rights", "delete");
  const [finYears, setFinYears] = useState<FinYear[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [pendingLockId, setPendingLockId] = useState<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    isRefresh ? setRefreshing(true) : null;
    try {
      setFinYears(await getAllFinYears());
      setFailed(false);
    } catch (e: any) {
      setFailed(true);
      Alert.alert("Could not load", e?.message || "The financial years could not be loaded.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Loads on open, and again on coming back from the form.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const filtered = useMemo(() => {
    if (!search.trim()) return finYears;
    const q = search.toLowerCase();
    return finYears.filter((fy) => fy.year.toLowerCase().includes(q) || fy.startDate.includes(search) || fy.endDate.includes(search));
  }, [finYears, search]);

  const activeCount = finYears.filter((f) => f.status === "Active").length;
  const closedCount = finYears.length - activeCount;
  const lockedCount = finYears.filter((f) => f.locked).length;

  const handleToggleLock = async (fy: FinYear) => {
    setPendingLockId(fy.id);
    try {
      await toggleFinYearLock(fy.id, !fy.locked);
      await load(true);
    } catch (e: any) {
      Alert.alert("Could not change the lock", e?.message || "Something went wrong.");
    } finally {
      setPendingLockId(null);
    }
  };

  const confirmDelete = (fy: FinYear) => {
    Alert.alert("Delete this financial year?", `"${fy.year}" will be removed for good. This can't be undone.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteFinYear(fy.id);
            load(true);
          } catch (e: any) {
            Alert.alert("Could not delete", e?.message || "Something went wrong.");
          }
        },
      },
    ]);
  };

  const fig = (n: number) => (loading ? "…" : String(n));

  return (
    <SheetPage refreshing={refreshing} onRefresh={() => load(true)}>
      <SheetShell
        eyebrow="CivilierERP · Admin · Rights"
        title="Financial years"
        subtitle="The financial years entries are booked in, their date ranges, and whether each is locked against new entries."
        action={canCreate ? <Key tone="ink" label="New year" icon={<Plus size={13} color={S.paper} />} onPress={() => navigation.navigate("FinYearForm")} style={{ alignSelf: "flex-start" }} /> : undefined}
      >
        <StatGrid
          cols={2}
          items={[
            { label: "Years · set up", value: fig(finYears.length) },
            { label: "Active · open for work", value: fig(activeCount) },
            { label: "Closed · finished", value: fig(closedCount) },
            { label: "Locked · no new entries", value: fig(lockedCount) },
          ]}
        />

        <SearchBox value={search} onChange={setSearch} placeholder="Search financial years…" />

        {loading ? (
          <RegisterLoading />
        ) : failed && finYears.length === 0 ? (
          <Notice>The financial years could not be loaded. Pull down to try again.</Notice>
        ) : filtered.length === 0 ? (
          <View style={{ alignItems: "center", gap: 6, paddingVertical: 28, borderWidth: 1, borderStyle: "dashed", borderColor: S.line40 }}>
            <Text style={{ fontFamily: fonts.heading.bold, fontSize: 15, color: S.ink }}>{search ? "No years match your search" : "No financial years configured"}</Text>
            {!!search && <Key label="Clear search" onPress={() => setSearch("")} />}
            {!search && canCreate && <Body size={12} color={S.graphite}>Use New year to add the first one.</Body>}
          </View>
        ) : (
          <View style={{ gap: 10 }}>
            {filtered.map((fy) => (
              <YearCard
                key={fy.id}
                fy={fy}
                lockPending={pendingLockId === fy.id}
                onEdit={() => navigation.navigate("FinYearForm", { fy })}
                onToggleLock={() => handleToggleLock(fy)}
                onDelete={() => confirmDelete(fy)}
                canEdit={canEdit}
                canDelete={canDelete}
              />
            ))}
          </View>
        )}
      </SheetShell>
    </SheetPage>
  );
}
