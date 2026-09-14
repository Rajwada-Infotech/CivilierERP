// Generic read-only list for the Follow-Up Setup masters (Department / Tag /
// Cancel Template). Name + an Active/Inactive pill per row, pull to refresh.
// Create/edit stays on the web app until those forms get ported.
import { useState } from "react";
import { View, Text, FlatList, RefreshControl, ActivityIndicator, Pressable } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, Inbox } from "lucide-react-native";
import type { MasterRow } from "@/api/followupApi";
import { colors, moduleAccents } from "@/theme/colors";
import { fonts } from "@/theme/fonts";

const ACCENT = moduleAccents.followup;

export function MasterList({
  queryKey,
  queryFn,
  emptyLabel = "Nothing here yet",
}: {
  queryKey: string;
  queryFn: () => Promise<MasterRow[]>;
  emptyLabel?: string;
}) {
  const [refreshing, setRefreshing] = useState(false);
  const { data, isLoading, isError, refetch } = useQuery<MasterRow[]>({
    queryKey: [queryKey],
    queryFn,
    staleTime: 5 * 60 * 1000,
    retry: 2,
  });

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center" style={{ backgroundColor: colors.background }}>
        <ActivityIndicator color={ACCENT} />
      </View>
    );
  }

  if (isError) {
    return (
      <View className="flex-1 items-center justify-center gap-2 px-8" style={{ backgroundColor: colors.background }}>
        <AlertCircle size={22} color={colors.destructive} />
        <Text style={{ color: colors.destructive, fontSize: 13, fontFamily: fonts.body.medium }}>Could not load.</Text>
        <Pressable onPress={() => refetch()} className="mt-2 px-4 py-2 rounded-lg" style={{ borderWidth: 1, borderColor: colors.border }}>
          <Text style={{ color: colors.foreground, fontSize: 12, fontFamily: fonts.body.medium }}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: 16, paddingBottom: 40, flexGrow: 1 }}
      data={data ?? []}
      keyExtractor={(r) => String(r.Id)}
      ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
      renderItem={({ item }) => {
        const active = !!item.IsActive;
        return (
          <View
            className="flex-row items-center justify-between rounded-2xl px-4 py-3.5"
            style={{ backgroundColor: `${colors.card}cc`, borderWidth: 1, borderColor: `${colors.border}99` }}
          >
            <Text numberOfLines={2} style={{ color: colors.foreground, fontSize: 13.5, fontFamily: fonts.body.medium, flex: 1, marginRight: 10 }}>
              {item.Name}
            </Text>
            <View className="px-2 py-0.5 rounded-full" style={{ backgroundColor: active ? `${ACCENT}22` : `${colors.mutedForeground}22` }}>
              <Text style={{ color: active ? ACCENT : colors.mutedForeground, fontSize: 9.5, fontFamily: fonts.heading.semibold, textTransform: "uppercase", letterSpacing: 0.5 }}>
                {active ? "Active" : "Inactive"}
              </Text>
            </View>
          </View>
        );
      }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={ACCENT} />}
      ListEmptyComponent={
        <View className="flex-1 items-center justify-center gap-2 py-24">
          <Inbox size={26} color={`${colors.mutedForeground}66`} />
          <Text style={{ color: `${colors.mutedForeground}99`, fontSize: 13, fontFamily: fonts.body.regular }}>{emptyLabel}</Text>
        </View>
      }
    />
  );
}
