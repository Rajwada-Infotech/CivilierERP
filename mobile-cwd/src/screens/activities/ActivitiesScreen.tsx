// Every allocated activity (current attempt), newest first. Paged 25 at a time with the status / overdue
// chips and the search box applied ON THE SERVER, so the phone only downloads what it shows — the full
// list can run to thousands of rows.
import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, RefreshControl, View } from "react-native";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { sheet as S } from "@/theme/colors";
import { Body, Label, Notice, SearchBox, Skel } from "@/components/sheet/Sheet";
import { ChipRow, NoAccessPage, PageHead } from "@/components/sheet/Page";
import { STATUS_LABEL } from "@/components/StatusPill";
import { ActivityRow as Row } from "@/components/ActivityRow";
import { getActivityAssignments } from "@/api/cwdApi";
import { usePageRights } from "@/hooks/usePageRights";
import type { MainStackParamList } from "@/navigation/MainStack";

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

  if (!rights.canView) return <NoAccessPage title="Activities" what="Work Reporting" />;

  const total = rows.length;
  return (
    <View style={{ flex: 1, backgroundColor: S.paper }}>
      <PageHead title="Activities" subtitle="Every allocated activity, newest first. Tap one to report on it.">
        <SearchBox value={search} onChange={setSearch} placeholder="Search activity, location or engineer" />
        <ChipRow
          options={FILTERS.map((f) => ({ value: f, label: FILTER_LABEL[f] ?? STATUS_LABEL[f] }))}
          value={filter}
          onChange={setFilter}
        />
      </PageHead>

      {q.isLoading ? (
        <View style={{ padding: 16 }}><Skel h={80} /><Skel h={80} /><Skel h={80} /></View>
      ) : q.error ? (
        <View style={{ padding: 16 }}><Notice>{(q.error as Error).message}</Notice></View>
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
          contentContainerStyle={{ paddingBottom: 96 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={async () => {
                setRefreshing(true);
                await q.refetch();
                setRefreshing(false);
              }}
              tintColor={S.ink}
            />
          }
          ListHeaderComponent={total ? <Label style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: S.rule }}>{`${total}${q.hasNextPage ? "+" : ""} shown`}</Label> : undefined}
          ListFooterComponent={q.isFetchingNextPage ? <ActivityIndicator color={S.graphite} style={{ paddingVertical: 16 }} /> : undefined}
          ListEmptyComponent={<Body size={13} color={S.graphite} style={{ textAlign: "center", paddingVertical: 40 }}>No activities match.</Body>}
        />
      )}
    </View>
  );
}
