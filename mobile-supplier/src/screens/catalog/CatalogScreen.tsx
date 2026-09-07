// RN port of src/pages/supplier/SupplierCatalog.tsx (web) — full parity
// now, not just browsing: inline Rate/Supply Lead Time/Quality editing
// per item, dirty-tracking, search, coverage stat tiles, and save (only
// dirty + actually-priced rows get sent, same as web's saveMutation).
// Table -> cards: a 5-column dense table doesn't fit a phone, so each row
// becomes its own card with the three fields stacked, same visual
// language (dirty = amber wash, priced = emerald wash) the web table rows
// use via background tint.
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  TextInput,
  View,
} from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ListChecks, PackageSearch, CheckCircle2, Circle, Search, Save } from "lucide-react-native";
import * as spApi from "@/api/supplierPortalApi";
import { fonts } from "@/theme/fonts";

interface RowState {
  ItemId: string;
  ItemName: string;
  UOMCode: string | null;
  Rate: string;
  SupplyLeadTime: string;
  Quality: string;
}

export default function CatalogScreen() {
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [dirty, setDirty] = useState<Set<string>>(new Set());

  const catalogQ = useQuery({
    queryKey: ["supplier-catalog"],
    queryFn: spApi.getSupplierCatalog,
    // The full catalog rarely changes between visits — refetching on every
    // tab switch was making the screen feel slow for no reason. Pull-to-
    // refresh and the post-save invalidate still force a fresh fetch.
    staleTime: 5 * 60 * 1000,
  });
  const catalog = catalogQ.data ?? [];

  useEffect(() => {
    const next: Record<string, RowState> = {};
    for (const it of catalog) {
      next[it.ItemId] = {
        ItemId: it.ItemId,
        ItemName: it.ItemName,
        UOMCode: it.UOMCode,
        Rate: it.Rate != null ? String(it.Rate) : "",
        SupplyLeadTime: it.SupplyLeadTime ?? "",
        Quality: it.Quality ?? "",
      };
    }
    setRows(next);
    setDirty(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog]);

  // Stable identity across renders (not recreated per keystroke) — each row
  // is a memoized component, so this callback being stable is what stops
  // every OTHER row from re-rendering when one field changes.
  const setRow = useCallback(<K extends keyof RowState>(id: string, key: K, value: RowState[K]) => {
    setRows((p) => ({ ...p, [id]: { ...p[id], [key]: value } }));
    setDirty((p) => new Set(p).add(id));
  }, []);

  const filteredRows = useMemo(() => {
    const list = Object.values(rows);
    if (!search) return list;
    const s = search.toLowerCase();
    return list.filter((r) => r.ItemName?.toLowerCase().includes(s));
  }, [rows, search]);

  const pricedCount = Object.values(rows).filter((r) => Number(r.Rate) > 0).length;
  const totalCount = Object.values(rows).length;
  const unpricedCount = totalCount - pricedCount;
  const pricedPct = totalCount > 0 ? Math.round((pricedCount / totalCount) * 100) : 0;

  const saveMutation = useMutation({
    mutationFn: () => {
      const items = Array.from(dirty)
        .map((id) => rows[id])
        .filter((r) => r && r.Rate && Number(r.Rate) > 0)
        .map((r) => ({
          ItemId: r.ItemId,
          ItemName: r.ItemName,
          UOMCode: r.UOMCode ?? undefined,
          Rate: Number(r.Rate) || 0,
          SupplyLeadTime: r.SupplyLeadTime || undefined,
          Quality: r.Quality || undefined,
        }));
      if (!items.length) throw new Error("Enter a rate for at least one item before saving");
      return spApi.updateSupplierCatalog(items);
    },
    onSuccess: () => {
      Alert.alert("Saved", "Catalog updated.");
      queryClient.invalidateQueries({ queryKey: ["supplier-catalog"] });
      setDirty(new Set());
    },
    onError: (err: any) => Alert.alert("Save failed", err?.message ?? "Failed to save catalog"),
  });

  const onRefresh = async () => {
    setRefreshing(true);
    await catalogQ.refetch();
    setRefreshing(false);
  };

  const renderItem = useCallback(
    ({ item: r }: { item: RowState }) => (
      <CatalogRow r={r} isDirty={dirty.has(r.ItemId)} setRow={setRow} />
    ),
    [dirty, setRow],
  );

  const ListHeader = (
    <>
      {/* ── Hero ─────────────────────────────────────────────────────── */}
        <View style={{ borderRadius: 14, borderWidth: 1, borderColor: "rgba(16,185,129,0.22)", backgroundColor: "rgba(16,185,129,0.06)", padding: 16, marginBottom: 14 }}>
          <View className="flex-row items-center gap-2">
            <View style={{ width: 34, height: 34, borderRadius: 9, backgroundColor: "rgba(16,185,129,0.14)", alignItems: "center", justifyContent: "center" }}>
              <ListChecks size={16} color="#6ee7b7" />
            </View>
            <View className="flex-1 min-w-0">
              <Text style={{ fontSize: 16, fontFamily: fonts.heading.bold, color: "#e7e9ef" }}>Price Catalog</Text>
              <Text style={{ fontSize: 11, fontFamily: fonts.body.regular, color: "#818898", marginTop: 1 }}>
                Rates, lead time &amp; quality per item
                {dirty.size > 0 && (
                  <Text style={{ color: "#fbbf24", fontFamily: fonts.body.semibold }}> · {dirty.size} unsaved</Text>
                )}
              </Text>
            </View>
          </View>
          <View className="flex-row items-center gap-2" style={{ marginTop: 12 }}>
            <View style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
              <View style={{ height: "100%", width: `${pricedPct}%`, backgroundColor: "#10b981", borderRadius: 3 }} />
            </View>
            <Text style={{ fontSize: 11, fontFamily: fonts.heading.bold, color: "#6ee7b7" }}>{pricedPct}%</Text>
          </View>
        </View>

        {/* ── Stat tiles ───────────────────────────────────────────────── */}
        <View className="flex-row gap-3 mb-4">
          <StatTile icon={PackageSearch} value={totalCount} label="Total items" color="#e7e9ef" iconBg="#21212c" iconColor="#818898" />
          <StatTile icon={CheckCircle2} value={pricedCount} label="Priced" color="#6ee7b7" iconBg="rgba(16,185,129,0.10)" iconColor="#6ee7b7" tint="rgba(16,185,129,0.06)" tintBorder="rgba(16,185,129,0.20)" />
          <StatTile
            icon={Circle}
            value={unpricedCount}
            label="Not priced"
            color={unpricedCount > 0 ? "#fbbf24" : "#e7e9ef"}
            iconBg={unpricedCount > 0 ? "rgba(245,158,11,0.10)" : "#21212c"}
            iconColor={unpricedCount > 0 ? "#f59e0b" : "#818898"}
            tint={unpricedCount > 0 ? "rgba(245,158,11,0.05)" : undefined}
            tintBorder={unpricedCount > 0 ? "rgba(245,158,11,0.20)" : undefined}
          />
        </View>

        {/* ── Search ───────────────────────────────────────────────────── */}
        <View className="flex-row items-center" style={{ borderRadius: 10, borderWidth: 1, borderColor: "#272735", backgroundColor: "#15151e", paddingHorizontal: 10, marginBottom: 14 }}>
          <Search size={13} color="#818898" />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search item…"
            placeholderTextColor="rgba(148,163,184,0.4)"
            style={{ flex: 1, color: "#e7e9ef", paddingVertical: 9, paddingHorizontal: 8, fontSize: 12 }}
          />
        </View>

      {catalogQ.isLoading && (
        <View className="flex-row items-center justify-center gap-2" style={{ height: 96 }}>
          <ActivityIndicator color="#818898" />
          <Text style={{ color: "#818898", fontSize: 13, fontFamily: fonts.body.regular }}>Loading catalog…</Text>
        </View>
      )}
    </>
  );

  const ListFooter =
    !catalogQ.isLoading && filteredRows.length > 0 ? (
      <Text style={{ fontSize: 11, fontFamily: fonts.body.regular, color: "#818898", marginTop: 12, textAlign: "center" }}>
        <Text style={{ color: "#6ee7b7", fontFamily: fonts.heading.semibold }}>{pricedCount}</Text> of {totalCount} items priced
      </Text>
    ) : null;

  const ListEmpty =
    !catalogQ.isLoading ? (
      <View
        className="items-center justify-center gap-3"
        style={{ paddingVertical: 48, borderRadius: 12, borderWidth: 1, borderStyle: "dashed", borderColor: "#272735" }}
      >
        <PackageSearch size={26} color="rgba(129,136,152,0.4)" />
        <Text style={{ fontSize: 13, fontFamily: fonts.heading.semibold, color: "#e7e9ef" }}>
          {search ? "No items match your search" : "No items in your catalog yet"}
        </Text>
      </View>
    ) : null;

  return (
    <View className="flex-1" style={{ backgroundColor: "#0c0c12" }}>
      <FlatList
        data={filteredRows}
        keyExtractor={(r) => r.ItemId}
        renderItem={renderItem}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        ListHeaderComponent={ListHeader}
        ListEmptyComponent={ListEmpty}
        ListFooterComponent={ListFooter}
        contentContainerStyle={{ padding: 16, paddingBottom: dirty.size > 0 ? 150 : 110 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#6ee7b7" />}
        // Virtualization is the actual fix for "the catalog feels slow" —
        // this used to be a plain ScrollView.map() of every row (each with
        // 3 live TextInputs), so the whole screen laid out and mounted at
        // once regardless of list length. windowSize keeps enough rows
        // pre-rendered above/below the viewport that scrolling still feels
        // instant.
        windowSize={7}
        maxToRenderPerBatch={12}
        initialNumToRender={12}
        removeClippedSubviews
      />

      {dirty.size > 0 && (
        <View pointerEvents="box-none" style={{ position: "absolute", left: 0, right: 0, bottom: 100, alignItems: "center" }}>
          <Pressable
            disabled={saveMutation.isPending}
            onPress={() => saveMutation.mutate()}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              paddingVertical: 12,
              paddingHorizontal: 20,
              borderRadius: 999,
              backgroundColor: "#059669",
              shadowColor: "#000",
              shadowOpacity: 0.4,
              shadowRadius: 16,
              shadowOffset: { width: 0, height: 6 },
              elevation: 10,
              opacity: saveMutation.isPending ? 0.6 : 1,
            }}
          >
            <Save size={14} color="#fff" />
            <Text style={{ color: "#fff", fontSize: 13, fontFamily: fonts.body.semibold }}>
              {saveMutation.isPending ? "Saving…" : `Save (${dirty.size})`}
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const inputStyle = {
  flex: 1,
  borderRadius: 8,
  borderWidth: 1,
  borderColor: "#272735",
  backgroundColor: "#0c0c12",
  color: "#e7e9ef",
  paddingHorizontal: 10,
  paddingVertical: 7,
  fontSize: 12,
  textAlign: "right" as const,
};

const CatalogRow = memo(
  function CatalogRow({
    r,
    isDirty,
    setRow,
  }: {
    r: RowState;
    isDirty: boolean;
    setRow: <K extends keyof RowState>(id: string, key: K, value: RowState[K]) => void;
  }) {
    const priced = Number(r.Rate) > 0;
    const borderColor = isDirty ? "rgba(245,158,11,0.35)" : priced ? "rgba(16,185,129,0.22)" : "#272735";
    const bg = isDirty ? "rgba(245,158,11,0.05)" : priced ? "rgba(16,185,129,0.04)" : "#15151e";
    return (
      <View style={{ borderRadius: 12, borderWidth: 1, borderColor, backgroundColor: bg, padding: 14 }}>
        <View className="flex-row items-center gap-2 mb-2">
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: priced ? "#10b981" : "#3a3a48" }} />
          <Text style={{ flex: 1, fontSize: 13, fontFamily: fonts.heading.semibold, color: "#e7e9ef" }}>{r.ItemName}</Text>
          {r.UOMCode && <Text style={{ fontSize: 10, fontFamily: fonts.body.regular, color: "#818898" }}>{r.UOMCode}</Text>}
        </View>
        <View style={{ gap: 8 }}>
          <FieldRow label="Rate (₹)">
            <TextInput
              value={r.Rate}
              onChangeText={(t) => setRow(r.ItemId, "Rate", t.replace(/[^0-9.]/g, ""))}
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor="rgba(148,163,184,0.4)"
              style={inputStyle}
            />
          </FieldRow>
          <FieldRow label="Lead time">
            <TextInput
              value={r.SupplyLeadTime}
              onChangeText={(t) => setRow(r.ItemId, "SupplyLeadTime", t)}
              placeholder="e.g. 3 days"
              placeholderTextColor="rgba(148,163,184,0.4)"
              style={inputStyle}
            />
          </FieldRow>
          <FieldRow label="Quality">
            <TextInput
              value={r.Quality}
              onChangeText={(t) => setRow(r.ItemId, "Quality", t)}
              placeholder="e.g. Grade A"
              placeholderTextColor="rgba(148,163,184,0.4)"
              style={inputStyle}
            />
          </FieldRow>
        </View>
      </View>
    );
  },
  (prev, next) => prev.r === next.r && prev.isDirty === next.isDirty,
);

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View className="flex-row items-center justify-between gap-3">
      <Text style={{ fontSize: 11, fontFamily: fonts.body.medium, color: "#818898" }}>{label}</Text>
      {children}
    </View>
  );
}

function StatTile({ icon: Icon, value, label, color, iconBg, iconColor, tint, tintBorder }: {
  icon: React.ComponentType<{ size?: number; color?: string }>;
  value: number; label: string; color: string; iconBg: string; iconColor: string;
  tint?: string; tintBorder?: string;
}) {
  return (
    <View
      className="flex-1"
      style={{
        borderRadius: 12,
        borderWidth: 1,
        borderColor: tintBorder ?? "#272735",
        backgroundColor: tint ?? "#15151e",
        paddingVertical: 12,
        paddingHorizontal: 10,
      }}
    >
      <View style={{ width: 26, height: 26, borderRadius: 8, backgroundColor: iconBg, alignItems: "center", justifyContent: "center", marginBottom: 6 }}>
        <Icon size={13} color={iconColor} />
      </View>
      <Text style={{ fontSize: 17, fontFamily: fonts.heading.bold, color }}>{value}</Text>
      <Text style={{ fontSize: 9, fontFamily: fonts.body.medium, color: "#818898", marginTop: 1 }}>{label}</Text>
    </View>
  );
}
