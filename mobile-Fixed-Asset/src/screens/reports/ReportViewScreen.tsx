// Generic renderer for one Fixed Asset report. Row shape + data source come
// from reportConfig.ts; this screen only handles search, refresh and layout.
import { useMemo, useState } from "react";
import { ActivityIndicator, FlatList, RefreshControl, Text, TextInput, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import type { RouteProp } from "@react-navigation/native";
import { useRoute } from "@react-navigation/native";
import { Search } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { StatusPill } from "@/components/StatusPill";
import { useRefetchOnFocus } from "@/hooks/useRefetchOnFocus";
import type { MainStackParamList } from "@/navigation/MainStack";
import { REPORTS, type ReportRow } from "./reportConfig";

const ACCENT = "#eab308";

export default function ReportViewScreen() {
  const route = useRoute<RouteProp<MainStackParamList, "ReportView">>();
  const cfg = REPORTS[route.params.report];

  const [search, setSearch] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["fa-report", route.params.report],
    queryFn: cfg.load,
  });
  useRefetchOnFocus(refetch);

  const rows = useMemo(() => {
    const list = data ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (r) =>
        r.code.toLowerCase().includes(q) ||
        r.name.toLowerCase().includes(q) ||
        r.lines.some((l) => l.value.toLowerCase().includes(q)),
    );
  }, [data, search]);

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const renderItem = ({ item }: { item: ReportRow }) => (
    <View style={{ backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 12, marginBottom: 8 }}>
      <View className="flex-row items-start justify-between" style={{ gap: 8 }}>
        <View className="flex-1 min-w-0">
          <Text numberOfLines={1} style={{ color: "#fde047", fontSize: 12, fontFamily: fonts.heading.bold }}>{item.code}</Text>
          <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 12.5, fontFamily: fonts.body.medium, marginTop: 2 }}>{item.name}</Text>
        </View>
        {item.badge ? <StatusPill label={item.badge} /> : null}
      </View>

      <View style={{ marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: `${colors.border}80`, gap: 4 }}>
        {item.lines.map((l) => (
          <View key={l.label} className="flex-row items-center justify-between" style={{ gap: 12 }}>
            <Text style={{ color: colors.mutedForeground, fontSize: 10.5, fontFamily: fonts.body.regular }}>{l.label}</Text>
            <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 11, fontFamily: fonts.body.medium, flexShrink: 1, textAlign: "right" }}>{l.value}</Text>
          </View>
        ))}
      </View>

      {item.amount ? (
        <View className="flex-row items-center justify-between" style={{ marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: `${colors.border}80` }}>
          <Text style={{ color: colors.mutedForeground, fontSize: 10, fontFamily: fonts.heading.bold, letterSpacing: 1, textTransform: "uppercase" }}>Total</Text>
          <Text style={{ color: colors.foreground, fontSize: 14, fontFamily: fonts.heading.bold }}>{item.amount}</Text>
        </View>
      ) : null}
    </View>
  );

  return (
    <View className="flex-1" style={{ backgroundColor: colors.background }}>
      <View style={{ padding: 16, paddingBottom: 8 }}>
        <Text style={{ color: colors.foreground, fontSize: 13, fontFamily: fonts.heading.semibold, marginBottom: 10 }}>{cfg.title}</Text>
        <View className="flex-row items-center gap-2" style={{ backgroundColor: colors.card, borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 10 }}>
          <Search size={14} color={colors.mutedForeground} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search FA Item Code, name, value…"
            placeholderTextColor={colors.mutedForeground}
            style={{ flex: 1, color: colors.foreground, fontSize: 12, fontFamily: fonts.body.regular, paddingVertical: 9 }}
          />
        </View>
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
          keyExtractor={(r) => r.id}
          renderItem={renderItem}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 112 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={ACCENT} />}
          ListHeaderComponent={
            rows.length ? (
              <Text style={{ color: colors.mutedForeground, fontSize: 11, fontFamily: fonts.body.regular, marginBottom: 8 }}>
                {rows.length} {rows.length === 1 ? "row" : "rows"}
              </Text>
            ) : null
          }
          ListEmptyComponent={
            <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: fonts.body.regular, textAlign: "center", paddingVertical: 40 }}>
              No data for this report.
            </Text>
          }
        />
      )}
    </View>
  );
}
