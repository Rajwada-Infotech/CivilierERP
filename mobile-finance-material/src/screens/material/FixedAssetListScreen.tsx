// RN port of src/pages/material/FixedAssetRecord.tsx (web) register view.
// Web adds a "Book Value by Category" bar chart above the KPI strip —
// dropped here in favor of the plain KPI numbers, consistent with how
// L1Chart replaced a desktop grid with cards rather than porting a chart
// widget. Company/Project list filters are dead state on web itself (no
// UI control ever changes them) — not ported, same as the dead-code note
// in fixedAssetApi.ts.
import { useMemo, useState } from "react";
import { View, Text, FlatList, Pressable, ActivityIndicator, RefreshControl, TextInput, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Cpu, Search, X, Plus, Eye, Pencil, Trash2, ShieldOff, AlertCircle } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { formatINR } from "@/utils/formatCurrency";
import { usePageRights } from "@/hooks/usePageRights";
import { getFixedAssets, deleteFixedAsset, calcDepreciation, STATUS_COLOR, ASSET_STATUS_OPTIONS, type FixedAssetListItem } from "@/api/fixedAssetApi";
import { FixedAssetFormModal } from "./fixedAsset/FixedAssetFormModal";
import { FixedAssetDetailModal } from "./fixedAsset/FixedAssetDetailModal";

const STATUS_TABS = ["All", ...ASSET_STATUS_OPTIONS];

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? d : dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function KpiCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={{ flex: 1, minWidth: "47%", borderWidth: 1, borderColor: colors.border, backgroundColor: `${colors.card}80` }} className="rounded-xl px-3 py-2.5">
      <Text style={{ color: colors.mutedForeground, fontSize: 9, fontFamily: fonts.heading.medium, textTransform: "uppercase" }}>{label}</Text>
      <Text style={{ color: color ?? colors.foreground, fontSize: 15, fontFamily: fonts.heading.bold, marginTop: 2 }}>{value}</Text>
    </View>
  );
}

function AssetCard({
  asset, onView, onEdit, onDelete, canEdit, canDelete,
}: { asset: FixedAssetListItem; onView: () => void; onEdit: () => void; onDelete: () => void; canEdit: boolean; canDelete: boolean }) {
  const dc = calcDepreciation(asset.PurchaseCost, asset.DepreciationRate, asset.PurchaseDate);
  const statusColor = STATUS_COLOR[asset.AssetStatus] ?? "#64748b";
  const pctRemaining = dc && asset.PurchaseCost > 0 ? Math.max(0, Math.min(100, (dc.bookValue / asset.PurchaseCost) * 100)) : null;
  return (
    <Pressable onPress={onView} className="rounded-2xl p-3.5 mb-2.5" style={{ backgroundColor: `${colors.card}80`, borderWidth: 1, borderColor: `${colors.border}99` }}>
      <View className="flex-row items-start justify-between gap-2 mb-2">
        <View style={{ flex: 1, marginRight: 8 }}>
          <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 12.5, fontFamily: fonts.heading.bold }}>{asset.AssetName}</Text>
          <Text style={{ color: colors.mutedForeground, fontSize: 10, marginTop: 2 }}>{asset.AssetCode || "—"} · {asset.AssetCategory}</Text>
        </View>
        <View className="px-1.5 py-0.5 rounded" style={{ backgroundColor: `${statusColor}1a`, borderWidth: 1, borderColor: `${statusColor}40` }}>
          <Text style={{ color: statusColor, fontSize: 8.5, fontFamily: fonts.heading.bold }}>{asset.AssetStatus.toUpperCase()}</Text>
        </View>
      </View>

      <Text style={{ color: colors.mutedForeground, fontSize: 10.5, marginBottom: 8 }}>
        {[asset.CompanyName, asset.ProjectName].filter(Boolean).join(" · ") || "—"} · {fmtDate(asset.PurchaseDate)}
      </Text>

      <View className="flex-row items-center justify-between mb-2">
        <View>
          <Text style={{ color: colors.mutedForeground, fontSize: 9, textTransform: "uppercase" }}>Purchase Cost</Text>
          <Text style={{ color: colors.foreground, fontSize: 12, fontFamily: fonts.heading.medium, marginTop: 1 }}>{formatINR(asset.PurchaseCost)}</Text>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Text style={{ color: colors.mutedForeground, fontSize: 9, textTransform: "uppercase" }}>Book Value</Text>
          <Text style={{ color: "#059669", fontSize: 13, fontFamily: fonts.heading.bold, marginTop: 1 }}>{dc ? formatINR(dc.bookValue) : "—"}</Text>
        </View>
      </View>
      {pctRemaining != null && (
        <View style={{ height: 4, borderRadius: 2, backgroundColor: `${colors.border}80`, overflow: "hidden", marginBottom: 8 }}>
          <View style={{ height: 4, width: `${pctRemaining}%`, backgroundColor: "#059669" }} />
        </View>
      )}

      <View className="flex-row items-center justify-end gap-1 pt-2" style={{ borderTopWidth: 1, borderTopColor: `${colors.border}80` }}>
        <Pressable onPress={onView} className="p-2 rounded-lg"><Eye size={15} color={colors.mutedForeground} /></Pressable>
        {canEdit && <Pressable onPress={onEdit} className="p-2 rounded-lg"><Pencil size={15} color={colors.mutedForeground} /></Pressable>}
        {canDelete && <Pressable onPress={onDelete} className="p-2 rounded-lg"><Trash2 size={15} color={colors.destructive} /></Pressable>}
      </View>
    </Pressable>
  );
}

export default function FixedAssetListScreen() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const rights = usePageRights("fixed-asset-record");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [refreshing, setRefreshing] = useState(false);
  const [viewingId, setViewingId] = useState<number | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const { data: assets = [], isLoading, isError, refetch } = useQuery({
    queryKey: ["fixed-assets-mobile"],
    queryFn: () => getFixedAssets(),
    enabled: rights.canView,
  });

  const activeAssets = useMemo(() => assets.filter((a) => a.Status !== "Deleted"), [assets]);

  const filtered = useMemo(() => {
    let rows = activeAssets;
    if (statusFilter !== "All") rows = rows.filter((a) => a.AssetStatus === statusFilter);
    const q = search.trim().toLowerCase();
    if (q) rows = rows.filter((a) => [a.AssetName, a.AssetCode, a.SerialNumber, a.AssetCategory].some((v) => (v ?? "").toLowerCase().includes(q)));
    return rows;
  }, [activeAssets, statusFilter, search]);

  const kpis = useMemo(() => {
    const totalBookValue = activeAssets.reduce((s, a) => s + (calcDepreciation(a.PurchaseCost, a.DepreciationRate, a.PurchaseDate)?.bookValue ?? 0), 0);
    const active = activeAssets.filter((a) => a.AssetStatus === "Active").length;
    const sold = activeAssets.filter((a) => a.AssetStatus === "Sold").length;
    return { totalBookValue, total: activeAssets.length, active, sold };
  }, [activeAssets]);

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const handleDelete = (asset: FixedAssetListItem) => {
    Alert.alert("Delete Asset?", `${asset.AssetName} will be removed.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete", style: "destructive", onPress: async () => {
          try {
            await deleteFixedAsset(asset.AssetId);
            queryClient.invalidateQueries({ queryKey: ["fixed-assets-mobile"], exact: false });
          } catch (err: any) {
            Alert.alert("Failed to delete", err.message ?? "Something went wrong.");
          }
        },
      },
    ]);
  };

  if (!rights.canView) {
    return (
      <View className="flex-1 items-center justify-center px-8" style={{ backgroundColor: colors.background }}>
        <ShieldOff size={28} color={colors.mutedForeground} />
        <Text style={{ color: colors.foreground, fontSize: 14, fontFamily: fonts.heading.semibold, marginTop: 12 }}>No access</Text>
        <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: fonts.body.regular, marginTop: 4, textAlign: "center" }}>
          You don't have permission to view Fixed Asset Records.
        </Text>
      </View>
    );
  }

  const ListHeader = (
    <View>
      <View className="flex-row items-center gap-2.5 mb-3">
        <View className="w-9 h-9 rounded-xl items-center justify-center" style={{ backgroundColor: "#0891b226", borderWidth: 1, borderColor: "#0891b24d" }}>
          <Cpu size={16} color="#0891b2" />
        </View>
        <Text style={{ color: colors.foreground, fontFamily: fonts.heading.bold, fontSize: 18, flex: 1 }}>Fixed Assets</Text>
        {rights.canCreate && (
          <Pressable onPress={() => { setEditingId(null); setFormOpen(true); }} className="flex-row items-center gap-1.5 px-3 py-2 rounded-xl" style={{ backgroundColor: "#0891b2" }}>
            <Plus size={14} color="#fff" />
            <Text style={{ color: "#fff", fontSize: 12, fontFamily: fonts.heading.semibold }}>New</Text>
          </Pressable>
        )}
      </View>

      <View className="flex-row flex-wrap gap-2 mb-3">
        <KpiCard label="Total Book Value" value={formatINR(kpis.totalBookValue)} color="#0891b2" />
        <KpiCard label="Total Assets" value={String(kpis.total)} />
        <KpiCard label="Active" value={String(kpis.active)} color="#059669" />
        <KpiCard label="Sold" value={String(kpis.sold)} color="#3b82f6" />
      </View>

      <View className="flex-row items-center gap-2 px-3 rounded-xl mb-3" style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: `${colors.card}80` }}>
        <Search size={14} color={colors.mutedForeground} />
        <TextInput
          value={search} onChangeText={setSearch}
          placeholder="Search name, code, serial…"
          placeholderTextColor={`${colors.mutedForeground}99`}
          style={{ flex: 1, color: colors.foreground, fontFamily: fonts.body.regular, fontSize: 13, paddingVertical: 10 }}
        />
        {!!search && <Pressable onPress={() => setSearch("")}><X size={14} color={colors.mutedForeground} /></Pressable>}
      </View>

      <View className="flex-row flex-wrap gap-1.5 mb-3">
        {STATUS_TABS.map((s) => {
          const active = statusFilter === s;
          return (
            <Pressable
              key={s} onPress={() => setStatusFilter(s)}
              className="px-3 py-1.5 rounded-full"
              style={{ borderWidth: 1, borderColor: active ? colors.primary : colors.border, backgroundColor: active ? `${colors.primary}1a` : "transparent" }}
            >
              <Text style={{ color: active ? colors.primary : colors.mutedForeground, fontSize: 11, fontFamily: fonts.heading.medium }}>{s}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {isLoading ? (
        <View className="flex-1 items-center justify-center"><ActivityIndicator color={colors.mutedForeground} /></View>
      ) : isError ? (
        <View className="flex-1 items-center justify-center px-8">
          <AlertCircle size={20} color={colors.destructive} />
          <Text style={{ color: colors.destructive, fontSize: 12, fontFamily: fonts.body.medium, marginTop: 8, textAlign: "center" }}>
            Failed to load Fixed Assets. Please try again.
          </Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(a) => String(a.AssetId)}
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          ListHeaderComponent={ListHeader}
          renderItem={({ item }) => (
            <AssetCard
              asset={item} onView={() => setViewingId(item.AssetId)}
              onEdit={() => { setEditingId(item.AssetId); setFormOpen(true); }}
              onDelete={() => handleDelete(item)}
              canEdit={rights.canEdit} canDelete={rights.canDelete}
            />
          )}
          ListEmptyComponent={
            <View className="items-center py-16">
              <AlertCircle size={20} color={`${colors.mutedForeground}80`} />
              <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: fonts.body.regular, marginTop: 8 }}>No assets yet.</Text>
            </View>
          }
        />
      )}

      <FixedAssetFormModal visible={formOpen} editingId={editingId} onClose={() => { setFormOpen(false); setEditingId(null); }} />
      <FixedAssetDetailModal recordId={viewingId} onClose={() => setViewingId(null)} />
    </View>
  );
}
