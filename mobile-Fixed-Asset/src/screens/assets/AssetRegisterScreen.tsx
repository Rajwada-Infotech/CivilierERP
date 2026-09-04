// Searchable, filterable list of Fixed Asset records (/api/fixed-assets).
// Tap a row to open AssetDetail; FAB opens the create form.
import { useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Search, ChevronRight, X } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { formatINR } from "@/utils/formatCurrency";
import { bookValueOf } from "@/utils/depreciation";
import { navigate } from "@/navigation/navigationRef";
import { getFixedAssets, type FixedAssetListItem } from "@/api/fixedAssetApi";
import { usePageRights } from "@/hooks/usePageRights";
import { Fab } from "@/components/Fab";
import { StatusPill } from "@/components/StatusPill";

const ACCENT = "#eab308";
const STATUS_FILTERS = ["All", "Active", "Pending", "Sold", "Scrapped", "Under Maintenance"] as const;

export default function AssetRegisterScreen() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("All");
  const [refreshing, setRefreshing] = useState(false);
  const rights = usePageRights("fixed-asset-record");

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["fa-assets"],
    queryFn: () => getFixedAssets(),
  });

  const live = useMemo(() => (data ?? []).filter((a) => a.Status !== "Deleted"), [data]);

  const kpis = useMemo(() => {
    const totalBook = live.reduce((s, a) => s + bookValueOf(Number(a.PurchaseCost || 0), a.DepreciationRate, a.PurchaseDate), 0);
    return {
      count: live.length,
      active: live.filter((a) => a.AssetStatus === "Active").length,
      pending: live.filter((a) => a.AssetStatus === "Pending").length,
      totalBook,
    };
  }, [live]);

  const rows = useMemo(() => {
    let list = live;
    if (status !== "All") list = list.filter((a) => a.AssetStatus === status);
    const s = search.trim().toLowerCase();
    if (s) {
      list = list.filter((a) =>
        [a.AssetName, a.AssetCode, a.FAItemCode, a.AssetCategory, a.SerialNumber, a.CompanyName, a.Custodian]
          .some((v) => (v || "").toLowerCase().includes(s)),
      );
    }
    return list;
  }, [live, search, status]);

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const renderItem = ({ item }: { item: FixedAssetListItem }) => (
    <Pressable
      onPress={() => navigate("AssetDetail", { id: item.AssetId })}
      className="flex-row items-center gap-3"
      style={{ backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 12, marginBottom: 8 }}
    >
      <View className="flex-1 min-w-0">
        <View className="flex-row items-center gap-2">
          <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 13, fontFamily: fonts.heading.semibold, flexShrink: 1 }}>
            {item.AssetName}
          </Text>
          <StatusPill label={item.AssetStatus} />
        </View>
        <Text numberOfLines={1} style={{ color: colors.mutedForeground, fontSize: 11, fontFamily: fonts.body.regular, marginTop: 2 }}>
          {item.AssetCode || "—"} · {item.AssetCategory}
          {item.FAItemCode ? ` · ${item.FAItemCode}` : ""}
        </Text>
        <Text style={{ color: "#5c6270", fontSize: 10, fontFamily: fonts.body.regular, marginTop: 2 }}>
          {formatINR(item.PurchaseCost)}{item.CompanyName ? ` · ${item.CompanyName}` : ""}
        </Text>
      </View>
      <ChevronRight size={15} color="#5c6270" />
    </Pressable>
  );

  return (
    <View className="flex-1" style={{ backgroundColor: colors.background }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
        <View className="flex-row flex-wrap gap-2" style={{ marginBottom: 10 }}>
          <Kpi label="Assets" value={String(kpis.count)} />
          <Kpi label="Active" value={String(kpis.active)} />
          <Kpi label="Pending" value={String(kpis.pending)} />
          <Kpi label="Book Value" value={formatINR(kpis.totalBook)} />
        </View>

        <View
          className="flex-row items-center gap-2"
          style={{ backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, height: 42 }}
        >
          <Search size={15} color="#5c6270" />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search name, code, category…"
            placeholderTextColor="#5c6270"
            style={{ flex: 1, color: colors.foreground, fontSize: 13, fontFamily: fonts.body.regular }}
          />
          {search.length > 0 && (
            <Pressable onPress={() => setSearch("")} hitSlop={8}>
              <X size={14} color="#5c6270" />
            </Pressable>
          )}
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 10 }} contentContainerStyle={{ gap: 8 }}>
          {STATUS_FILTERS.map((f) => {
            const active = f === status;
            return (
              <Pressable
                key={f}
                onPress={() => setStatus(f)}
                style={{
                  paddingHorizontal: 13, paddingVertical: 6, borderRadius: 999,
                  backgroundColor: active ? "rgba(234,179,8,0.14)" : colors.card,
                  borderWidth: 1, borderColor: active ? "rgba(234,179,8,0.35)" : colors.border,
                }}
              >
                <Text style={{ fontSize: 11.5, fontFamily: fonts.body.medium, color: active ? "#fde68a" : colors.mutedForeground }}>{f}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {isLoading ? (
        <View style={{ paddingVertical: 60, alignItems: "center" }}>
          <ActivityIndicator color={colors.mutedForeground} />
        </View>
      ) : error ? (
        <Text style={{ color: colors.destructive, fontSize: 12, fontFamily: fonts.body.regular, padding: 16 }}>
          {(error as Error).message}
        </Text>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(a) => String(a.AssetId)}
          renderItem={renderItem}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 120 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={ACCENT} />}
          ListEmptyComponent={
            <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: fonts.body.regular, textAlign: "center", paddingVertical: 40 }}>
              {search || status !== "All" ? "No assets match your filters." : "No fixed asset records."}
            </Text>
          }
        />
      )}

      {rights.canCreate && <Fab label="New Asset" onPress={() => navigate("AssetForm")} />}
    </View>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexGrow: 1, minWidth: "22%", backgroundColor: colors.card, borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingVertical: 8, paddingHorizontal: 10 }}>
      <Text style={{ color: colors.foreground, fontSize: 13, fontFamily: fonts.heading.bold }} numberOfLines={1}>{value}</Text>
      <Text style={{ color: colors.mutedForeground, fontSize: 9, fontFamily: fonts.body.regular, marginTop: 1 }}>{label}</Text>
    </View>
  );
}
