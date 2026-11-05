// Work Reporting — the web page's layout: status tiles with live counts, then the Project > Block > Floor >
// Unit > Room tree. The tree and tile counts come from two cheap server aggregates; a room's activities are
// only fetched when that room is opened, so the phone never downloads the whole list.
import { useEffect, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigation } from "@react-navigation/native";
import { Search, X } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { STATUS_COLOR, STATUS_LABEL } from "@/components/StatusPill";
import { ActivityRow } from "@/components/ActivityRow";
import { ScopeTree } from "@/components/ScopeTree";
import { ShowMore, useIncremental } from "@/components/ShowMore";
import { usePageRights } from "@/hooks/usePageRights";
import { AutoNameLookup } from "@/components/AutoNameLookup";
import { getRoomActivities, getScopeProjects, getScopeSummary, type ScopeRoom } from "@/api/cwdApi";

const ACCENT = "#0891b2";
const TILES = ["ALL", "PENDING", "ALLOCATED", "IN_PROGRESS", "HOLD", "REWORK", "COMPLETED", "APPROVED", "CANCELLED"] as const;
function RoomActivities({ room, status }: { room: ScopeRoom; status: string }) {
  const navigation = useNavigation<{ navigate: (name: string, params?: object) => void }>();
  const q = useQuery({
    queryKey: ["cwd-room", room.projectId, room.roomId, status],
    queryFn: () => getRoomActivities({ roomId: room.roomId, projectId: room.projectId, status }),
    staleTime: 60_000,
  });
  const page = useIncremental(q.data?.length ?? 0);
  if (q.isLoading) return <ActivityIndicator color={colors.mutedForeground} style={{ paddingVertical: 12 }} />;
  if (q.error) return <Text style={{ color: colors.destructive, fontSize: 11.5, fontFamily: fonts.body.regular, padding: 8 }}>{(q.error as Error).message}</Text>;
  const rows = q.data ?? [];
  if (!rows.length) return <Text style={{ color: colors.mutedForeground, fontSize: 11.5, fontFamily: fonts.body.regular, padding: 8 }}>No activities.</Text>;
  return (
    <View style={{ paddingTop: 4 }}>
      {rows.slice(0, page.count).map((a) => <ActivityRow key={a.assignmentId} a={a} onPress={() => navigation.navigate("ActivityDetail", { rungId: a.rungId })} />)}
      <ShowMore remaining={page.remaining} step={page.step} onPress={page.more} />
    </View>
  );
}

export default function ReportingScreen() {
  const rights = usePageRights("civilworkdpr-activity-reporting");
  const qc = useQueryClient();
  const navigation = useNavigation<{ navigate: (name: string, params?: object) => void }>();
  const [status, setStatus] = useState<string>("ALL");
  const [projectId, setProjectId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  // A single letter matches nearly everything, so the server is only asked from 2 characters on.
  useEffect(() => {
    const t = setTimeout(() => { const s = search.trim(); setTerm(s.length >= 2 ? s : ""); }, 400);
    return () => clearTimeout(t);
  }, [search]);

  const projectsQ = useQuery({ queryKey: ["cwd-scope-projects"], queryFn: getScopeProjects, enabled: rights.canView, staleTime: 300_000 });
  const summaryQ = useQuery({
    queryKey: ["cwd-scope-summary", status, term, projectId],
    queryFn: () => getScopeSummary({ status, search: term || undefined, projectId: projectId ?? undefined }),
    enabled: rights.canView,
    placeholderData: (prev) => prev,
    staleTime: 60_000,
  });

  const rooms = summaryQ.data?.rooms ?? [];
  // A search that narrows to a handful of rooms opens everything so the hit isn't hidden under a closed node.
  const forceOpen = !!term && rooms.length <= 12;

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

  const counts = summaryQ.data?.statusCounts ?? {};
  const allCount = status === "ALL" ? summaryQ.data?.total ?? 0 : undefined;
  const projects = projectsQ.data ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 10, paddingTop: 14, paddingBottom: 96 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={ACCENT}
            onRefresh={async () => {
              setRefreshing(true);
              await Promise.all([summaryQ.refetch(), qc.invalidateQueries({ queryKey: ["cwd-room"] })]);
              setRefreshing(false);
            }}
          />
        }
      >
        <AutoNameLookup onOpen={(rungId) => navigation.navigate("ActivityDetail", { rungId })} />

        {/* Search */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, borderRadius: 12, paddingHorizontal: 12 }}>
          <Search size={14} color={colors.mutedForeground} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search by Auto Name, activity, location or chain…"
            placeholderTextColor={`${colors.mutedForeground}99`}
            style={{ flex: 1, color: colors.foreground, fontFamily: fonts.body.regular, fontSize: 13, paddingVertical: 10 }}
          />
          {!!search && (
            <TouchableOpacity onPress={() => setSearch("")}>
              <X size={14} color={colors.mutedForeground} />
            </TouchableOpacity>
          )}
        </View>

        {/* Status tiles */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 12 }} contentContainerStyle={{ gap: 8 }}>
          {TILES.map((s) => {
            const on = status === s;
            const color = s === "ALL" ? ACCENT : STATUS_COLOR[s];
            const n = s === "ALL" ? (allCount ?? Object.values(counts).reduce((a, b) => a + (b ?? 0), 0)) : counts[s as keyof typeof counts] ?? 0;
            return (
              <TouchableOpacity
                key={s}
                activeOpacity={0.7}
                onPress={() => setStatus(s)}
                style={{ minWidth: 86, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 12, borderWidth: 1, borderColor: on ? color : colors.border, backgroundColor: on ? `${color}22` : colors.card }}
              >
                <Text style={{ fontSize: 17, fontFamily: fonts.heading.bold, color: on ? color : colors.foreground, fontVariant: ["tabular-nums"] }}>{n}</Text>
                <Text style={{ fontSize: 10.5, fontFamily: fonts.heading.semibold, color: on ? color : colors.mutedForeground, marginTop: 1 }}>{s === "ALL" ? "All" : STATUS_LABEL[s]}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Project filter (only when there is a choice) */}
        {projects.length > 1 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 10 }} contentContainerStyle={{ gap: 8 }}>
            {[{ id: null as number | null, name: "All projects" }, ...projects.map((p) => ({ id: p.id as number | null, name: p.name ?? `Project ${p.id}` }))].map((p) => {
              const on = projectId === p.id;
              return (
                <TouchableOpacity
                  key={String(p.id)}
                  onPress={() => setProjectId(p.id)}
                  style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: on ? ACCENT : colors.border, backgroundColor: on ? `${ACCENT}22` : "transparent" }}
                >
                  <Text style={{ fontSize: 11, fontFamily: fonts.heading.semibold, color: on ? ACCENT : colors.mutedForeground }}>{p.name}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}

        {/* Tree */}
        <View style={{ marginTop: 14 }}>
          {summaryQ.isLoading ? (
            <ActivityIndicator color={colors.mutedForeground} style={{ paddingVertical: 40 }} />
          ) : summaryQ.error ? (
            <Text style={{ color: colors.destructive, fontSize: 12, fontFamily: fonts.body.regular }}>{(summaryQ.error as Error).message}</Text>
          ) : rooms.length === 0 ? (
            <Text style={{ textAlign: "center", color: colors.mutedForeground, fontSize: 12, fontFamily: fonts.body.regular, paddingVertical: 40 }}>No activities match.</Text>
          ) : (
            <ScopeTree rooms={rooms} forceOpen={forceOpen} renderRoom={(room) => <RoomActivities room={room} status={status} />} />
          )}
        </View>
      </ScrollView>
    </View>
  );
}
