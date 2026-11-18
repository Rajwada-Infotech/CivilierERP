// Work Reporting — the web page's layout: status tiles with live counts, then the Project > Block > Floor >
// Unit > Room tree. The tree and tile counts come from two cheap server aggregates; a room's activities are
// only fetched when that room is opened, so the phone never downloads the whole list.
import { useEffect, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigation } from "@react-navigation/native";
import { sheet as S } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { STATUS_LABEL } from "@/components/StatusPill";
import { Body, Label, Notice, Press, SearchBox, SheetShell, Skel } from "@/components/sheet/Sheet";
import { ChipRow, NoAccessPage } from "@/components/sheet/Page";
import { ActivityRow } from "@/components/ActivityRow";
import { ScopeTree } from "@/components/ScopeTree";
import { ShowMore, useIncremental } from "@/components/ShowMore";
import { usePageRights } from "@/hooks/usePageRights";
import { AutoNameLookup } from "@/components/AutoNameLookup";
import { getRoomActivities, getScopeProjects, getScopeSummary, type ScopeRoom } from "@/api/cwdApi";

const TILES = ["ALL", "PENDING", "ALLOCATED", "IN_PROGRESS", "HOLD", "REWORK", "COMPLETED", "APPROVED", "CANCELLED"] as const;
function RoomActivities({ room, status }: { room: ScopeRoom; status: string }) {
  const navigation = useNavigation<{ navigate: (name: string, params?: object) => void }>();
  const q = useQuery({
    queryKey: ["cwd-room", room.projectId, room.roomId, status],
    queryFn: () => getRoomActivities({ roomId: room.roomId, projectId: room.projectId, status }),
    staleTime: 60_000,
  });
  const page = useIncremental(q.data?.length ?? 0);
  if (q.isLoading) return <ActivityIndicator color={S.graphite} style={{ paddingVertical: 12 }} />;
  if (q.error) return <View style={{ padding: 8 }}><Notice>{(q.error as Error).message}</Notice></View>;
  const rows = q.data ?? [];
  if (!rows.length) return <Body size={12} color={S.graphite} style={{ padding: 8 }}>No activities.</Body>;
  return (
    <View style={{ borderTopWidth: 1, borderTopColor: S.rule }}>
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

  if (!rights.canView) return <NoAccessPage title="Work Reporting" what="Work Reporting" />;

  const counts = summaryQ.data?.statusCounts ?? {};
  const allCount = status === "ALL" ? summaryQ.data?.total ?? 0 : undefined;
  const projects = projectsQ.data ?? [];

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: S.paper }}
      contentContainerStyle={{ paddingBottom: 96 }}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          tintColor={S.ink}
          onRefresh={async () => {
            setRefreshing(true);
            await Promise.all([summaryQ.refetch(), qc.invalidateQueries({ queryKey: ["cwd-room"] })]);
            setRefreshing(false);
          }}
        />
      }
    >
      <SheetShell eyebrow="Civil Work DPR" title="Work Reporting" subtitle="Find an activity by its Auto Name, or open a room to report on its work.">
        <AutoNameLookup onOpen={(rungId) => navigation.navigate("ActivityDetail", { rungId })} />

        <SearchBox value={search} onChange={setSearch} placeholder="Search Auto Name, activity, location or chain" />

        {/* Status: a count per status, the chosen one filled ink. */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 0 }}>
          {TILES.map((s, i) => {
            const on = status === s;
            const n = s === "ALL" ? (allCount ?? Object.values(counts).reduce((a, b) => a + (b ?? 0), 0)) : counts[s as keyof typeof counts] ?? 0;
            return (
              <Press
                key={s}
                onPress={() => setStatus(s)}
                style={(pressed) => ({ minWidth: 92, paddingHorizontal: 12, paddingVertical: 10, gap: 4, borderWidth: 1, borderLeftWidth: i ? 0 : 1, borderColor: S.ink, backgroundColor: on ? S.ink : pressed ? S.blueWash : "transparent" })}
              >
                <Label color={on ? S.paper : S.graphite}>{s === "ALL" ? "All" : STATUS_LABEL[s]}</Label>
                <Text style={{ fontSize: 20, fontFamily: fonts.heading.semibold, letterSpacing: -0.4, color: on ? S.paper : n ? S.ink : S.graphite, fontVariant: ["tabular-nums"] }}>{n}</Text>
              </Press>
            );
          })}
        </ScrollView>

        {projects.length > 1 && (
          <ChipRow
            options={[{ value: "all", label: "All projects" }, ...projects.map((p) => ({ value: String(p.id), label: p.name ?? `Project ${p.id}` }))]}
            value={projectId == null ? "all" : String(projectId)}
            onChange={(v) => setProjectId(v === "all" ? null : Number(v))}
          />
        )}

        <View>
          {summaryQ.isLoading ? (
            <><Skel h={44} /><Skel h={44} /><Skel h={44} /></>
          ) : summaryQ.error ? (
            <Notice>{(summaryQ.error as Error).message}</Notice>
          ) : rooms.length === 0 ? (
            <Body size={13} color={S.graphite} style={{ textAlign: "center", paddingVertical: 30 }}>No activities match.</Body>
          ) : (
            <ScopeTree rooms={rooms} forceOpen={forceOpen} renderRoom={(room) => <RoomActivities room={room} status={status} />} />
          )}
        </View>
      </SheetShell>
    </ScrollView>
  );
}
