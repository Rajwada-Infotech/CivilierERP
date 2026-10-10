// Work Allocation — the Project > Block > Floor > Unit > Room tree; open a room to see its dependency chains and
// each chain's activities in order. Tap an activity to allocate it (engineers, QC, approvers, dates, labour and
// material). A Completed activity that hasn't passed Quality Check has an Inspect button for QC users.
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigation } from "@react-navigation/native";
import { Search, ShieldCheck, X } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { StatusPill, displayStatus } from "@/components/StatusPill";
import { ScopeTree } from "@/components/ScopeTree";
import { ShowMore, useIncremental } from "@/components/ShowMore";
import { usePageRights } from "@/hooks/usePageRights";
import { PriorityBadge } from "@/components/PriorityBadge";
import { AutoNameLookup } from "@/components/AutoNameLookup";
import { getRoomActivities, getScopeProjects, getScopeSummary, type ActivityAssignment, type ScopeRoom } from "@/api/cwdApi";

const ACCENT = "#0891b2";

function QcBadge({ qc }: { qc?: "APPROVED" | "REWORK" | null }) {
  if (!qc) return null;
  const ok = qc === "APPROVED";
  return (
    <View style={{ paddingHorizontal: 6, paddingVertical: 1.5, borderRadius: 999, backgroundColor: ok ? "#10b98122" : "#d946ef22" }}>
      <Text style={{ fontSize: 9, fontFamily: fonts.heading.bold, color: ok ? "#10b981" : "#d946ef" }}>{ok ? "QC PASSED" : "QC REWORK"}</Text>
    </View>
  );
}

function RoomChains({ room, canInspect }: { room: ScopeRoom; canInspect: boolean }) {
  const navigation = useNavigation<{ navigate: (name: string, params?: object) => void }>();
  const q = useQuery({
    queryKey: ["cwd-room", room.projectId, room.roomId, "ALL"],
    queryFn: () => getRoomActivities({ roomId: room.roomId, projectId: room.projectId }),
    staleTime: 60_000,
  });
  const chains = useMemo(() => {
    const m = new Map<number, { alias: string; workType: string; rungs: ActivityAssignment[] }>();
    for (const a of q.data ?? []) {
      const id = a.dependencyMasterId ?? 0;
      if (!m.has(id)) m.set(id, { alias: a.alias || "Chain", workType: String(a.workType || ""), rungs: [] });
      m.get(id)!.rungs.push(a);
    }
    for (const c of m.values()) c.rungs.sort((x, y) => (x.sequenceNo ?? 0) - (y.sequenceNo ?? 0));
    return [...m.entries()];
  }, [q.data]);

  if (q.isLoading) return <ActivityIndicator color={colors.mutedForeground} style={{ paddingVertical: 12 }} />;
  if (q.error) return <Text style={{ color: colors.destructive, fontSize: 11.5, fontFamily: fonts.body.regular, padding: 8 }}>{(q.error as Error).message}</Text>;
  if (!chains.length) return <Text style={{ color: colors.mutedForeground, fontSize: 11.5, fontFamily: fonts.body.regular, padding: 8 }}>No chains in this room.</Text>;

  return (
    <View style={{ gap: 10, paddingTop: 4 }}>
      {chains.map(([id, c]) => <ChainCard key={id} c={c} canInspect={canInspect} />)}
    </View>
  );
}

type ChainGroup = { alias: string; workType?: string | null; rungs: ActivityAssignment[] };

// One chain's activities — paged, so a room with hundreds of activities opens instantly.
function ChainCard({ c, canInspect }: { c: ChainGroup; canInspect: boolean }) {
  const navigation = useNavigation<{ navigate: (name: string, params?: object) => void }>();
  const page = useIncremental(c.rungs.length);
  return (
        <View style={{ borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 10, gap: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text numberOfLines={1} style={{ flex: 1, fontSize: 12.5, fontFamily: fonts.heading.semibold, color: colors.foreground }}>{c.alias}</Text>
        {!!c.workType && (
          <View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, backgroundColor: c.workType === "INTERNAL" ? "#f9731622" : "#0ea5e922" }}>
            <Text style={{ fontSize: 9, fontFamily: fonts.heading.bold, color: c.workType === "INTERNAL" ? "#f97316" : "#0ea5e9" }}>{c.workType}</Text>
          </View>
        )}
      </View>
      {c.rungs.slice(0, page.count).map((a) => {
        const shown = displayStatus(a.status, a.resumedAt);
        const inspect = canInspect && a.status === "COMPLETED" && a.qcStatus !== "APPROVED";
        return (
          <TouchableOpacity
            key={a.assignmentId}
            activeOpacity={0.7}
            onPress={() => navigation.navigate("AllocationForm", { rungId: a.rungId })}
            style={{ borderRadius: 10, backgroundColor: colors.muted, padding: 10, gap: 6 }}
          >
            <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
              <Text style={{ flex: 1, fontSize: 12.5, fontFamily: fonts.body.medium, color: colors.foreground }}>{a.sequenceNo}. {a.activityName}</Text>
              <StatusPill status={shown} />
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
              <PriorityBadge priority={a.priority} />
              <QcBadge qc={a.qcStatus} />
              {(a.attemptNo ?? 1) > 1 && <Text style={{ fontSize: 9.5, color: "#d946ef", fontFamily: fonts.heading.semibold }}>Attempt {a.attemptNo}</Text>}
              <Text numberOfLines={1} style={{ flex: 1, fontSize: 10.5, color: colors.mutedForeground, fontFamily: fonts.body.regular }}>{a.engineerNames || "Not assigned yet"}</Text>
            </View>
            {inspect && (
              <TouchableOpacity
                onPress={() => navigation.navigate("QcInspect", { rungId: a.rungId })}
                style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 8, borderRadius: 10, backgroundColor: ACCENT }}
              >
                <ShieldCheck size={13} color="#04181d" />
                <Text style={{ fontSize: 11.5, fontFamily: fonts.heading.bold, color: "#04181d" }}>Inspect</Text>
              </TouchableOpacity>
            )}
          </TouchableOpacity>
        );
      })}
      <ShowMore remaining={page.remaining} step={page.step} onPress={page.more} />
    </View>
  );
}

export default function WorkAllocationScreen() {
  const rights = usePageRights("civilworkdpr-work-done");
  const qcRights = usePageRights("civilworkdpr-quality-check");
  const qc = useQueryClient();
  const navigation = useNavigation<{ navigate: (name: string, params?: object) => void }>();
  const [projectId, setProjectId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => { const s = search.trim(); setTerm(s.length >= 2 ? s : ""); }, 400);
    return () => clearTimeout(t);
  }, [search]);

  const projectsQ = useQuery({ queryKey: ["cwd-scope-projects"], queryFn: getScopeProjects, enabled: rights.canView, staleTime: 300_000 });
  const summaryQ = useQuery({
    queryKey: ["cwd-scope-summary", "ALL", term, projectId],
    queryFn: () => getScopeSummary({ search: term || undefined, projectId: projectId ?? undefined }),
    enabled: rights.canView,
    placeholderData: (prev) => prev,
    staleTime: 60_000,
  });
  const rooms = summaryQ.data?.rooms ?? [];
  const projects = projectsQ.data ?? [];

  if (!rights.canView) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, alignItems: "center", justifyContent: "center", padding: 32 }}>
        <Text style={{ color: colors.foreground, fontFamily: fonts.heading.semibold, fontSize: 14 }}>No access</Text>
        <Text style={{ color: colors.mutedForeground, fontFamily: fonts.body.regular, fontSize: 12, marginTop: 4, textAlign: "center" }}>You don't have permission to view Work Allocation.</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 10, paddingTop: 14, paddingBottom: 96 }}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={ACCENT} onRefresh={async () => { setRefreshing(true); await Promise.all([summaryQ.refetch(), qc.invalidateQueries({ queryKey: ["cwd-room"] })]); setRefreshing(false); }} />}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, borderRadius: 12, paddingHorizontal: 12 }}>
          <Search size={14} color={colors.mutedForeground} />
          <TextInput value={search} onChangeText={setSearch} placeholder="Search by Auto Name, activity, location or chain…" placeholderTextColor={`${colors.mutedForeground}99`} style={{ flex: 1, color: colors.foreground, fontFamily: fonts.body.regular, fontSize: 13, paddingVertical: 10 }} />
          {!!search && <TouchableOpacity onPress={() => setSearch("")}><X size={14} color={colors.mutedForeground} /></TouchableOpacity>}
        </View>

        <View style={{ marginTop: 10 }}>
          <AutoNameLookup onOpen={(rungId) => navigation.navigate("AllocationForm", { rungId })} />
        </View>

        {projects.length > 1 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 10 }} contentContainerStyle={{ gap: 8 }}>
            {[{ id: null as number | null, name: "All projects" }, ...projects.map((p) => ({ id: p.id as number | null, name: p.name ?? `Project ${p.id}` }))].map((p) => {
              const on = projectId === p.id;
              return (
                <TouchableOpacity key={String(p.id)} onPress={() => setProjectId(p.id)} style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: on ? ACCENT : colors.border, backgroundColor: on ? `${ACCENT}22` : "transparent" }}>
                  <Text style={{ fontSize: 11, fontFamily: fonts.heading.semibold, color: on ? ACCENT : colors.mutedForeground }}>{p.name}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}

        <View style={{ marginTop: 14 }}>
          {summaryQ.isLoading ? (
            <ActivityIndicator color={colors.mutedForeground} style={{ paddingVertical: 40 }} />
          ) : summaryQ.error ? (
            <Text style={{ color: colors.destructive, fontSize: 12, fontFamily: fonts.body.regular }}>{(summaryQ.error as Error).message}</Text>
          ) : rooms.length === 0 ? (
            <Text style={{ textAlign: "center", color: colors.mutedForeground, fontSize: 12, fontFamily: fonts.body.regular, paddingVertical: 40 }}>No activities match.</Text>
          ) : (
            <ScopeTree rooms={rooms} forceOpen={!!term && rooms.length <= 12} renderRoom={(room) => <RoomChains room={room} canInspect={qcRights.canEdit} />} />
          )}
        </View>
      </ScrollView>
    </View>
  );
}
