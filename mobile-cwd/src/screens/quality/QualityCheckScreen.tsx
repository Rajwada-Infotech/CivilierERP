// Quality Check queue: every activity dragged to 100% that hasn't passed inspection yet (one that already
// passed is waiting on approval and leaves this list). Paged and searched on the server.
import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, RefreshControl, View } from "react-native";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useNavigation } from "@react-navigation/native";
import { sheet as S } from "@/theme/colors";
import { Body, Figure, Notice, SearchBox, Skel } from "@/components/sheet/Sheet";
import { NoAccessPage, PageHead } from "@/components/sheet/Page";
import { ActivityRow } from "@/components/ActivityRow";
import { usePageRights } from "@/hooks/usePageRights";
import { getActivityAssignments } from "@/api/cwdApi";

const PAGE = 25;

export default function QualityCheckScreen() {
  const rights = usePageRights("civilworkdpr-quality-check");
  const navigation = useNavigation<{ navigate: (name: string, params?: object) => void }>();
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => { const t = setTimeout(() => setTerm(search.trim()), 350); return () => clearTimeout(t); }, [search]);

  const q = useInfiniteQuery({
    queryKey: ["cwd-activities", "QC_PENDING", term],
    queryFn: ({ pageParam }) => getActivityAssignments({ filter: "QC_PENDING", search: term, page: pageParam, limit: PAGE }),
    initialPageParam: 1,
    getNextPageParam: (last, all) => (last.length === PAGE ? all.length + 1 : undefined),
    staleTime: 30_000,
    enabled: rights.canView,
  });
  const rows = q.data?.pages.flat() ?? [];

  if (!rights.canView) return <NoAccessPage title="Quality Check" what="Quality Check" />;

  return (
    <View style={{ flex: 1, backgroundColor: S.paper }}>
      <PageHead
        title="Quality Check"
        subtitle="Completed activities waiting for inspection. Tap one to inspect it."
        action={!q.isLoading ? <Figure size={22}>{`${rows.length}${q.hasNextPage ? "+" : ""}`}</Figure> : undefined}
      >
        <SearchBox value={search} onChange={setSearch} placeholder="Search activity, location or engineer" />
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
          renderItem={({ item }) => <ActivityRow a={item} onPress={() => navigation.navigate("QcInspect", { rungId: item.rungId })} />}
          contentContainerStyle={{ paddingBottom: 96 }}
          refreshControl={<RefreshControl refreshing={refreshing} tintColor={S.ink} onRefresh={async () => { setRefreshing(true); await q.refetch(); setRefreshing(false); }} />}
          ListFooterComponent={q.isFetchingNextPage ? <ActivityIndicator color={S.graphite} style={{ paddingVertical: 16 }} /> : undefined}
          ListEmptyComponent={
            <Body size={13} color={S.graphite} style={{ textAlign: "center", paddingVertical: 40 }}>
              {term ? "No activities match your search." : "Nothing is waiting for Quality Check."}
            </Body>
          }
        />
      )}
    </View>
  );
}
