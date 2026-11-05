// Quality Check queue: every activity dragged to 100% that hasn't passed inspection yet (one that already
// passed is waiting on approval and leaves this list). Paged and searched on the server.
import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, RefreshControl, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useNavigation } from "@react-navigation/native";
import { Search, ShieldCheck, X } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { ActivityRow } from "@/components/ActivityRow";
import { usePageRights } from "@/hooks/usePageRights";
import { getActivityAssignments } from "@/api/cwdApi";

const ACCENT = "#0891b2";
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

  if (!rights.canView) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, alignItems: "center", justifyContent: "center", padding: 32 }}>
        <Text style={{ color: colors.foreground, fontFamily: fonts.heading.semibold, fontSize: 14 }}>No access</Text>
        <Text style={{ color: colors.mutedForeground, fontFamily: fonts.body.regular, fontSize: 12, marginTop: 4, textAlign: "center" }}>You don't have permission to view Quality Check.</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={{ padding: 16, paddingBottom: 8, gap: 10 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <ShieldCheck size={15} color={ACCENT} />
          <Text style={{ fontSize: 12, fontFamily: fonts.body.regular, color: colors.mutedForeground, flex: 1 }}>Completed activities ready for inspection</Text>
          {!q.isLoading && <Text style={{ fontSize: 11, fontFamily: fonts.heading.semibold, color: ACCENT }}>{rows.length}{q.hasNextPage ? "+" : ""}</Text>}
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, borderRadius: 12, paddingHorizontal: 12 }}>
          <Search size={14} color={colors.mutedForeground} />
          <TextInput value={search} onChangeText={setSearch} placeholder="Search activity, location or engineer…" placeholderTextColor={`${colors.mutedForeground}99`} style={{ flex: 1, color: colors.foreground, fontFamily: fonts.body.regular, fontSize: 13, paddingVertical: 10 }} />
          {!!search && <TouchableOpacity onPress={() => setSearch("")}><X size={14} color={colors.mutedForeground} /></TouchableOpacity>}
        </View>
      </View>

      {q.isLoading ? (
        <View style={{ paddingVertical: 60, alignItems: "center" }}><ActivityIndicator color={colors.mutedForeground} /></View>
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
          renderItem={({ item }) => (
            <View>
              <ActivityRow a={item} onPress={() => navigation.navigate("QcInspect", { rungId: item.rungId })} />
            </View>
          )}
          contentContainerStyle={{ padding: 16, paddingTop: 8, paddingBottom: 96 }}
          refreshControl={<RefreshControl refreshing={refreshing} tintColor={ACCENT} onRefresh={async () => { setRefreshing(true); await q.refetch(); setRefreshing(false); }} />}
          ListFooterComponent={q.isFetchingNextPage ? <ActivityIndicator color={colors.mutedForeground} style={{ paddingVertical: 16 }} /> : null}
          ListEmptyComponent={
            <Text style={{ textAlign: "center", color: colors.mutedForeground, fontSize: 12, fontFamily: fonts.body.regular, paddingVertical: 40 }}>
              {term ? "No activities match your search." : "Nothing is waiting for Quality Check."}
            </Text>
          }
        />
      )}
    </View>
  );
}
