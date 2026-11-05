// Every allocated activity (current attempt), newest first. Paged 25 at a time with the status / overdue
// chips and the search box applied ON THE SERVER, so the phone only downloads what it shows — the full
// list can run to thousands of rows.
import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, TextInput, View } from "react-native";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { Search, X } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { STATUS_LABEL } from "@/components/StatusPill";
import { ActivityRow as Row } from "@/components/ActivityRow";
import { getActivityAssignments } from "@/api/cwdApi";
import { usePageRights } from "@/hooks/usePageRights";
import type { MainStackParamList } from "@/navigation/MainStack";

const ACCENT = "#0891b2";
const FILTERS = ["ALL", "OVERDUE", "DUE_SOON", "IN_PROGRESS", "HOLD", "REWORK", "COMPLETED", "ALLOCATED", "APPROVED"] as const;
const FILTER_LABEL: Record<string, string> = { ALL: "All", OVERDUE: "Overdue", DUE_SOON: "Due soon" };
const PAGE = 25;

export default function ActivitiesScreen() {
  const rights = usePageRights("civilworkdpr-activity-reporting");
  const [search, setSearch] = useState("");
  const navigation = useNavigation<{ navigate: (name: string, params?: object) => void }>();
  const route = useRoute<RouteProp<MainStackParamList, "Activities">>();
  const initial = route.params?.filter as (typeof FILTERS)[number] | undefined;
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>(initial && FILTERS.includes(initial) ? initial : "ALL");
  const [refreshing, setRefreshing] = useState(false);

  // Typing shouldn't fire a request per keystroke.
  const [term, setTerm] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setTerm(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  const q = useInfiniteQuery({
    queryKey: ["cwd-activities", filter, term],
    queryFn: ({ pageParam }) => getActivityAssignments({ filter, search: term, page: pageParam, limit: PAGE }),
    initialPageParam: 1,
    // A full page means there may be more.
    getNextPageParam: (last, all) => (last.length === PAGE ? all.length + 1 : undefined),
    staleTime: 60_000,
    enabled: rights.canView,
  });
  const rows = q.data?.pages.flat() ?? [];

  if (!rights.canView) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, alignItems: "center", justifyContent: "center", padding: 32 }}>
        <Text style={{ color: colors.foreground, fontFamily: fonts.heading.semibold, fontSize: 14 }}>No access</Text>
        <Text style={{ color: colors.mutedForeground, fontFamily: fonts.body.regular, fontSize: 12, marginTop: 4, textAlign: "center" }}>
          You don't have permission to view Work Reporting.
        </Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={{ padding: 16, paddingBottom: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, borderRadius: 12, paddingHorizontal: 12 }}>
          <Search size={14} color={colors.mutedForeground} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search activity, location or engineer…"
            placeholderTextColor={`${colors.mutedForeground}99`}
            style={{ flex: 1, color: colors.foreground, fontFamily: fonts.body.regular, fontSize: 13, paddingVertical: 10 }}
          />
          {!!search && (
            <Pressable onPress={() => setSearch("")}>
              <X size={14} color={colors.mutedForeground} />
            </Pressable>
          )}
        </View>
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={FILTERS as unknown as string[]}
          keyExtractor={(f) => f}
          style={{ marginTop: 10 }}
          contentContainerStyle={{ gap: 8 }}
          renderItem={({ item }) => {
            const on = filter === item;
            return (
              <Pressable
                onPress={() => setFilter(item as (typeof FILTERS)[number])}
                style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: on ? ACCENT : colors.border, backgroundColor: on ? `${ACCENT}22` : "transparent" }}
              >
                <Text style={{ fontSize: 11, fontFamily: fonts.heading.semibold, color: on ? ACCENT : colors.mutedForeground }}>
                  {FILTER_LABEL[item] ?? STATUS_LABEL[item]}
                </Text>
              </Pressable>
            );
          }}
        />
      </View>

      {q.isLoading ? (
        <View style={{ paddingVertical: 60, alignItems: "center" }}>
          <ActivityIndicator color={colors.mutedForeground} />
        </View>
      ) : q.error ? (
        <Text style={{ color: colors.destructive, fontSize: 12, fontFamily: fonts.body.regular, padding: 16 }}>{(q.error as Error).message}</Text>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(a) => String(a.assignmentId)}
          onEndReachedThreshold={0.6}
          onEndReached={() => { if (q.hasNextPage && !q.isFetchingNextPage) q.fetchNextPage(); }}
          initialNumToRender={8}
          windowSize={7}
          removeClippedSubviews
          renderItem={({ item }) => <Row a={item} onPress={() => navigation.navigate("ActivityDetail", { rungId: item.rungId })} />}
          contentContainerStyle={{ padding: 16, paddingTop: 8, paddingBottom: 96 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={async () => {
                setRefreshing(true);
                await q.refetch();
                setRefreshing(false);
              }}
              tintColor={ACCENT}
            />
          }
          ListFooterComponent={q.isFetchingNextPage ? <ActivityIndicator color={colors.mutedForeground} style={{ paddingVertical: 16 }} /> : null}
          ListEmptyComponent={
            <Text style={{ textAlign: "center", color: colors.mutedForeground, fontSize: 12, fontFamily: fonts.body.regular, paddingVertical: 40 }}>
              No activities match.
            </Text>
          }
        />
      )}
    </View>
  );
}
