// Menu → Visitor log (security admin): every visitor request of the last 30 days at the gates in your projects,
// searchable (name, flat, vehicle, phone, reason) and filterable by outcome. Tap one to see it with the photo.
import { useEffect, useState } from "react";
import { View, Text, FlatList, RefreshControl } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useInfiniteQuery } from "@tanstack/react-query";
import type { MainStackParamList } from "@/navigation/MainStack";
import { colors, sheet as S } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { Body, Input, Label, Notice, Press, SheetMark, Skel, type MarkTone } from "@/components/sheet/Sheet";
import { getVisitorLog, type LogRow } from "@/api/securityMoreApi";

const FILTERS = [
  { value: "", label: "All" },
  { value: "PENDING", label: "Waiting" },
  { value: "APPROVED", label: "Approved" },
  { value: "DENIED", label: "Denied" },
  { value: "NO_RESPONSE", label: "No response" },
];
const TONE: Record<LogRow["status"], MarkTone> = { PENDING: "waiting", APPROVED: "done", DENIED: "stopped", NO_RESPONSE: "draft" };
const flatOf = (b: string | null, f: string) => (b ? `${b}-${f}` : f);

export default function VisitorLogScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [status, setStatus] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  const { data, isLoading, error, fetchNextPage, hasNextPage, isFetchingNextPage, refetch, isRefetching } = useInfiniteQuery({
    queryKey: ["security-visitor-log-app", debounced, status],
    queryFn: ({ pageParam }) => getVisitorLog({ q: debounced || undefined, status: status || undefined, page: pageParam }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
  });
  const rows = data?.pages.flatMap((p) => p.rows) ?? [];
  const total = data?.pages[0]?.total ?? 0;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={{ padding: 16, gap: 10, borderBottomWidth: 1, borderBottomColor: S.ink }}>
        <Label>Visitor log · last 30 days · {total}</Label>
        <Input value={q} onChangeText={setQ} placeholder="Name, flat, vehicle, phone" autoCorrect={false} />
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {FILTERS.map((f) => (
            <Press key={f.value} onPress={() => setStatus(f.value)} style={(p) => ({ paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: S.ink, backgroundColor: status === f.value ? S.ink : p ? S.blueWash : "transparent" })}>
              <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 10, letterSpacing: 1, textTransform: "uppercase", color: status === f.value ? S.paper : S.ink }}>{f.label}</Text>
            </Press>
          ))}
        </View>
      </View>
      {error && (
        <View style={{ padding: 12 }}>
          <Notice>{(error as Error).message}</Notice>
        </View>
      )}
      <FlatList
        data={rows}
        keyExtractor={(r) => String(r.id)}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 96 }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} tintColor={S.ink} />}
        onEndReached={() => hasNextPage && !isFetchingNextPage && void fetchNextPage()}
        onEndReachedThreshold={0.4}
        ListEmptyComponent={isLoading ? <View style={{ paddingTop: 16 }}><Skel h={44} /></View> : <Body color={S.graphite} style={{ paddingTop: 16 }}>No visitor matches.</Body>}
        renderItem={({ item: r }) => (
          <Press onPress={() => navigation.navigate("VisitorStatus", { id: r.id })} style={(p) => ({ paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: S.ruleSoft, backgroundColor: p ? S.blueWash : "transparent" })}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
              <Text numberOfLines={1} style={{ flex: 1, fontFamily: fonts.body.semibold, fontSize: 13.5, color: S.ink }}>
                {r.visitorName || "Visitor"} <Text style={{ fontFamily: fonts.body.regular, color: S.ink2 }}>· {r.reason}</Text>
              </Text>
              <SheetMark text={FILTERS.find((f) => f.value === r.status)?.label ?? r.status} tone={TONE[r.status]} />
            </View>
            <Text numberOfLines={1} style={{ fontFamily: fonts.body.regular, fontSize: 11.5, color: S.graphite, marginTop: 3 }}>
              {[`Flat ${flatOf(r.block, r.flat)}`, r.gateName, r.vehicleNo, r.decidedBy, new Date(r.requestedAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })].filter(Boolean).join(" · ")}
            </Text>
          </Press>
        )}
      />
    </View>
  );
}
