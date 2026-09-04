// FA Maintenance & Repair records (/api/fixed-asset-maintenance). Read-only
// list with the posting summary; creating / posting is done on web.
import { useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { formatINR } from "@/utils/formatCurrency";
import { getMaintenanceList, type MaintenanceItem } from "@/api/fixedAssetApi";

const ACCENT = "#eab308";
const FILTERS = ["All", "Draft", "Posted"] as const;

const STATUS_COLOR: Record<string, string> = { Draft: "#f59e0b", Posted: "#10b981", Cancelled: "#818898" };

export default function MaintenanceScreen() {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("All");
  const [refreshing, setRefreshing] = useState(false);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["fa-maint"],
    queryFn: () => getMaintenanceList(),
  });

  const rows = useMemo(() => {
    const list = data ?? [];
    return filter === "All" ? list : list.filter((m) => m.Status === filter);
  }, [data, filter]);

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const renderItem = ({ item }: { item: MaintenanceItem }) => (
    <View style={{ backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 12, marginBottom: 8 }}>
      <View className="flex-row items-center justify-between">
        <Text style={{ color: colors.foreground, fontSize: 12, fontFamily: fonts.heading.semibold }}>{item.DocNo}</Text>
        <View style={{ backgroundColor: `${STATUS_COLOR[item.Status] || "#818898"}1f`, paddingHorizontal: 6, paddingVertical: 1.5, borderRadius: 999 }}>
          <Text style={{ fontSize: 9, fontFamily: fonts.heading.bold, color: STATUS_COLOR[item.Status] || "#818898" }}>{item.Status}</Text>
        </View>
      </View>
      <Text numberOfLines={1} style={{ color: colors.mutedForeground, fontSize: 11, fontFamily: fonts.body.regular, marginTop: 3 }}>
        {item.ItemName || "—"} · {item.FAItemCode || "—"}
      </Text>
      <Text numberOfLines={1} style={{ color: "#5c6270", fontSize: 10, fontFamily: fonts.body.regular, marginTop: 2 }}>
        {item.VendorName || "—"} · {item.RepairExpenseType === "Direct" ? "Direct Repair" : "Indirect Repair"}
      </Text>
      <View className="flex-row items-center justify-between" style={{ marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: `${colors.border}80` }}>
        <Text style={{ color: colors.mutedForeground, fontSize: 10, fontFamily: fonts.body.regular }}>
          Taxable {formatINR(item.TaxableAmount ?? item.Amount, { decimals: 2 })}
          {item.GstRatePct ? `  ·  GST ${item.GstRatePct}% ${formatINR(item.GstAmount ?? 0, { decimals: 2 })}` : ""}
        </Text>
        <Text style={{ color: colors.foreground, fontSize: 13, fontFamily: fonts.heading.bold }}>
          {formatINR(item.TotalAmount ?? item.Amount, { decimals: 2 })}
        </Text>
      </View>
    </View>
  );

  return (
    <View className="flex-1" style={{ backgroundColor: colors.background }}>
      <View className="flex-row gap-2" style={{ padding: 16, paddingBottom: 8 }}>
        {FILTERS.map((f) => {
          const active = f === filter;
          return (
            <Pressable
              key={f}
              onPress={() => setFilter(f)}
              style={{
                paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999,
                backgroundColor: active ? "rgba(234,179,8,0.14)" : colors.card,
                borderWidth: 1, borderColor: active ? "rgba(234,179,8,0.35)" : colors.border,
              }}
            >
              <Text style={{ fontSize: 12, fontFamily: fonts.body.medium, color: active ? "#fde68a" : colors.mutedForeground }}>{f}</Text>
            </Pressable>
          );
        })}
      </View>

      {isLoading ? (
        <View style={{ paddingVertical: 60, alignItems: "center" }}>
          <ActivityIndicator color={colors.mutedForeground} />
        </View>
      ) : error ? (
        <Text style={{ color: colors.destructive, fontSize: 12, fontFamily: fonts.body.regular, padding: 16 }}>{(error as Error).message}</Text>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(m) => String(m.MaintenanceId)}
          renderItem={renderItem}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 96 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={ACCENT} />}
          ListEmptyComponent={
            <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: fonts.body.regular, textAlign: "center", paddingVertical: 40 }}>
              No maintenance records.
            </Text>
          }
        />
      )}
    </View>
  );
}
