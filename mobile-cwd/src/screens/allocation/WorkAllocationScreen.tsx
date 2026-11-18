// Work Allocation — the Project > Block > Floor > Unit > Room tree; open a room to see its dependency chains and
// each chain's activities in order. Tap an activity to allocate it (engineers, QC, approvers, dates, labour and
// material). A Completed activity that hasn't passed Quality Check has an Inspect button for QC users.
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigation } from "@react-navigation/native";
import { ShieldCheck } from "lucide-react-native";
import { sheet as S } from "@/theme/colors";
import { Body, Key, Label, Notice, Press, SearchBox, SheetMark, SheetShell, Skel } from "@/components/sheet/Sheet";
import { ChipRow, NoAccessPage } from "@/components/sheet/Page";
import { fonts } from "@/theme/fonts";
import { StatusPill, displayStatus } from "@/components/StatusPill";
import { ScopeTree } from "@/components/ScopeTree";
import { ShowMore, useIncremental } from "@/components/ShowMore";
import { usePageRights } from "@/hooks/usePageRights";
import { PriorityBadge } from "@/components/PriorityBadge";
import { AutoNameLookup } from "@/components/AutoNameLookup";
import { getRoomActivities, getScopeProjects, getScopeSummary, type ActivityAssignment, type ScopeRoom } from "@/api/cwdApi";


function QcBadge({ qc }: { qc?: "APPROVED" | "REWORK" | null }) {
  if (!qc) return null;
  const ok = qc === "APPROVED";
  return <SheetMark text={ok ? "QC passed" : "QC rework"} tone={ok ? "done" : "stopped"} />;
}

function RoomChains({ room, canInspect }: { room: ScopeRoom; canInspect: boolean }) {
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

  if (q.isLoading) return <ActivityIndicator color={S.graphite} style={{ paddingVertical: 12 }} />;
  if (q.error) return <View style={{ padding: 8 }}><Notice>{(q.error as Error).message}</Notice></View>;
  if (!chains.length) return <Body size={12} color={S.graphite} style={{ padding: 10 }}>No chains in this room.</Body>;

  return (
    <View style={{ gap: 10, padding: 10, borderTopWidth: 1, borderTopColor: S.rule }}>
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
    <View style={{ borderWidth: 1, borderColor: S.ink }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 10, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: S.ink }}>
        <Label color={S.ink} style={{ flex: 1 }}>{c.alias}</Label>
        {!!c.workType && <Label color={c.workType === "INTERNAL" ? S.ink2 : S.blue}>{c.workType}</Label>}
      </View>
      {c.rungs.slice(0, page.count).map((a) => {
        const shown = displayStatus(a.status, a.resumedAt);
        const inspect = canInspect && a.status === "COMPLETED" && a.qcStatus !== "APPROVED";
        return (
          <Press
            key={a.assignmentId}
            onPress={() => navigation.navigate("AllocationForm", { rungId: a.rungId })}
            style={(pressed) => ({ paddingHorizontal: 10, paddingVertical: 11, gap: 6, borderBottomWidth: 1, borderBottomColor: S.ruleSoft, backgroundColor: pressed ? S.blueWash : "transparent" })}
          >
            <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
              <Text style={{ flex: 1, fontSize: 13, fontFamily: fonts.body.semibold, color: S.ink }}>{a.sequenceNo}. {a.activityName}</Text>
              <StatusPill status={shown} />
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
              <PriorityBadge priority={a.priority} />
              {!!a.tagName && <Label color={S.blue}>#{a.tagName}</Label>}
              <QcBadge qc={a.qcStatus} />
              {(a.attemptNo ?? 1) > 1 && <Label color={S.red}>Attempt {a.attemptNo}</Label>}
              <Text numberOfLines={1} style={{ flex: 1, fontSize: 11.5, color: S.graphite, fontFamily: fonts.body.regular }}>{a.engineerNames || "Not assigned yet"}</Text>
            </View>
            {inspect && (
              <Key tone="ink" label="Inspect" icon={<ShieldCheck size={13} color={S.paper} />} onPress={() => navigation.navigate("QcInspect", { rungId: a.rungId })} style={{ minHeight: 38, marginTop: 2 }} />
            )}
          </Press>
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

  if (!rights.canView) return <NoAccessPage title="Work Allocation" what="Work Allocation" />;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: S.paper }}
      contentContainerStyle={{ paddingBottom: 96 }}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} tintColor={S.ink} onRefresh={async () => { setRefreshing(true); await Promise.all([summaryQ.refetch(), qc.invalidateQueries({ queryKey: ["cwd-room"] })]); setRefreshing(false); }} />}
    >
      <SheetShell eyebrow="Civil Work DPR" title="Work Allocation" subtitle="Open a room to see its chains. Tap an activity to allocate engineers, dates, labour and material.">
        <SearchBox value={search} onChange={setSearch} placeholder="Search Auto Name, activity, location or chain" />
        <AutoNameLookup onOpen={(rungId) => navigation.navigate("AllocationForm", { rungId })} />
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
            <ScopeTree rooms={rooms} forceOpen={!!term && rooms.length <= 12} renderRoom={(room) => <RoomChains room={room} canInspect={qcRights.canEdit} />} />
          )}
        </View>
      </SheetShell>
    </ScrollView>
  );
}
