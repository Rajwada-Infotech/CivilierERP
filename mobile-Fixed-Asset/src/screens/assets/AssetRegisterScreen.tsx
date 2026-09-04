// Searchable list of Fixed Asset records (/api/fixed-assets). Tap a row to
// open AssetDetail.
import { useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, TextInput, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Search, ChevronRight, X } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { formatINR } from "@/utils/formatCurrency";
import { navigate } from "@/navigation/navigationRef";
import { getFixedAssets, type FixedAssetListItem } from "@/api/fixedAssetApi";

const ACCENT = "#eab308";

const STATUS_COLOR: Record<string, string> = {
  Active: "#10b981",
  Pending: "#f59e0b",
  Sold: "#3b82f6",
  Scrapped: "#ef4444",
  "Under Maintenance": "#8b5cf6",
};

export default function AssetRegisterScreen() {
  const [search, setSearch] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["fa-assets"],
    queryFn: () => getFixedAssets(),
  });

  const rows = useMemo(() => {
    const list = data ?? [];
    const s = search.trim().toLowerCase();
    if (!s) return list;
    return list.filter((a) =>
      [a.AssetName, a.AssetCode, a.FAItemCode, a.AssetCategory, a.SerialNumber, a.CompanyName, a.Custodian]
        .some((v) => (v || "").toLowerCase().includes(s)),
    );
  }, [data, search]);

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
          <View style={{ backgroundColor: `${STATUS_COLOR[item.AssetStatus] || "#818898"}1f`, paddingHorizontal: 6, paddingVertical: 1.5, borderRadius: 999 }}>
            <Text style={{ fontSize: 9, fontFamily: fonts.heading.bold, color: STATUS_COLOR[item.AssetStatus] || "#818898" }}>
              {item.AssetStatus}
            </Text>
          </View>
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
      <View style={{ padding: 16, paddingBottom: 8 }}>
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
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 96 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={ACCENT} />}
          ListEmptyComponent={
            <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: fonts.body.regular, textAlign: "center", paddingVertical: 40 }}>
              {search ? "No assets match your search." : "No fixed asset records."}
            </Text>
          }
        />
      )}
    </View>
  );
}
