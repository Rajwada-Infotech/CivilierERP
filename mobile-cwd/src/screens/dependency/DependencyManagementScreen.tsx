// Dependency Management — every dependency chain, arranged project by project. Open a project to page through
// its chains (search by chain / block / unit / room), open a chain to see its activities in order with their
// status, and tap an activity to allocate it. Only the project you open is fetched, 30 chains at a time.
import { useEffect, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from "react-native";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigation } from "@react-navigation/native";
import { ChevronRight, FolderTree } from "lucide-react-native";
import { sheet as S } from "@/theme/colors";
import { Body, Key, Label, Notice, Press, SearchBox, SheetShell, Skel } from "@/components/sheet/Sheet";
import { NoAccessPage } from "@/components/sheet/Page";
import { fonts } from "@/theme/fonts";
import { StatusPill, displayStatus } from "@/components/StatusPill";
import { usePageRights } from "@/hooks/usePageRights";
import { AutoNameLookup } from "@/components/AutoNameLookup";
import { getChainActivities, getDependencyChains, getScopeProjects, type DependencyChain } from "@/api/cwdApi";

const PAGE = 30;

function ChainRungs({ chainId }: { chainId: number }) {
  const navigation = useNavigation<{ navigate: (name: string, params?: object) => void }>();
  const q = useQuery({ queryKey: ["cwd-chain", chainId], queryFn: () => getChainActivities(chainId), staleTime: 60_000 });
  if (q.isLoading) return <ActivityIndicator color={S.graphite} style={{ paddingVertical: 10 }} />;
  if (q.error) return <View style={{ padding: 8 }}><Notice>{(q.error as Error).message}</Notice></View>;
  const rungs = [...(q.data ?? [])].sort((a, b) => (a.sequenceNo ?? 0) - (b.sequenceNo ?? 0));
  if (!rungs.length) return <Body size={12} color={S.graphite} style={{ padding: 10 }}>No activities in this chain.</Body>;
  return (
    <View style={{ borderTopWidth: 1, borderTopColor: S.ink }}>
      {rungs.map((a) => (
        <Press
          key={a.assignmentId}
          onPress={() => navigation.navigate("AllocationForm", { rungId: a.rungId })}
          style={(pressed) => ({ paddingHorizontal: 10, paddingVertical: 10, gap: 5, borderBottomWidth: 1, borderBottomColor: S.ruleSoft, backgroundColor: pressed ? S.blueWash : "transparent" })}
        >
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
            <Text style={{ flex: 1, fontSize: 13, fontFamily: fonts.body.semibold, color: S.ink }}>{a.sequenceNo}. {a.activityName}</Text>
            <StatusPill status={displayStatus(a.status, a.resumedAt)} />
          </View>
          <Text numberOfLines={1} style={{ fontSize: 11.5, color: S.graphite, fontFamily: fonts.body.regular }}>
            {a.engineerNames || "Not assigned yet"}{a.progressPercent ? ` · ${a.progressPercent}%` : ""}
          </Text>
        </Press>
      ))}
    </View>
  );
}

function ChainCard({ chain }: { chain: DependencyChain }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={{ borderWidth: 1, borderColor: open ? S.ink : S.rule }}>
      <Press onPress={() => setOpen((o) => !o)} style={(pressed) => ({ flexDirection: "row", alignItems: "center", gap: 8, padding: 10, backgroundColor: pressed ? S.blueWash : "transparent" })}>
        <ChevronRight size={14} color={S.graphite} style={{ transform: [{ rotate: open ? "90deg" : "0deg" }] }} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ fontSize: 13, fontFamily: fonts.body.semibold, color: S.ink }}>{chain.alias}</Text>
          <Text numberOfLines={1} style={{ fontSize: 11.5, color: S.graphite, fontFamily: fonts.body.regular, marginTop: 1 }}>{chain.scopePath}</Text>
        </View>
        <View style={{ alignItems: "flex-end", gap: 3 }}>
          <Label color={chain.workType === "INTERNAL" ? S.ink2 : S.blue}>{chain.workType}</Label>
          <Text style={{ fontSize: 11, color: S.graphite, fontFamily: fonts.heading.medium }}>{chain.activityCount} step{chain.activityCount === 1 ? "" : "s"}</Text>
        </View>
      </Press>
      {open && <ChainRungs chainId={chain.id} />}
    </View>
  );
}

function ProjectChains({ projectId, term }: { projectId: number; term: string }) {
  const q = useInfiniteQuery({
    queryKey: ["cwd-chains", projectId, term],
    queryFn: ({ pageParam }) => getDependencyChains({ projectId, search: term, page: pageParam, limit: PAGE }),
    initialPageParam: 1,
    getNextPageParam: (last, all) => (last.length === PAGE ? all.length + 1 : undefined),
    staleTime: 60_000,
  });
  const chains = q.data?.pages.flat() ?? [];
  if (q.isLoading) return <ActivityIndicator color={S.graphite} style={{ paddingVertical: 14 }} />;
  if (q.error) return <Notice>{(q.error as Error).message}</Notice>;
  if (!chains.length) return <Body size={12} color={S.graphite} style={{ padding: 4 }}>{term ? "No chains match." : "No chains in this project."}</Body>;
  return (
    <View style={{ gap: 8 }}>
      {chains.map((c) => <ChainCard key={c.id} chain={c} />)}
      {q.hasNextPage && (
        <Key label={q.isFetchingNextPage ? "Loading…" : "Load more chains"} disabled={q.isFetchingNextPage} onPress={() => void q.fetchNextPage()} />
      )}
    </View>
  );
}

export default function DependencyManagementScreen() {
  const rights = usePageRights("civilworkdpr-dependency");
  const qc = useQueryClient();
  const navigation = useNavigation<{ navigate: (name: string, params?: object) => void }>();
  const [open, setOpen] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => { const t = setTimeout(() => setTerm(search.trim()), 400); return () => clearTimeout(t); }, [search]);

  const projectsQ = useQuery({ queryKey: ["cwd-scope-projects"], queryFn: getScopeProjects, enabled: rights.canView, staleTime: 300_000 });
  const projects = projectsQ.data ?? [];
  // A single project opens by itself.
  useEffect(() => { if (projects.length === 1 && open == null) setOpen(projects[0].id); }, [projects, open]);

  if (!rights.canView) return <NoAccessPage title="Dependency Management" what="Dependency Management" />;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: S.paper }}
      contentContainerStyle={{ paddingBottom: 96 }}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} tintColor={S.ink} onRefresh={async () => { setRefreshing(true); await Promise.all([projectsQ.refetch(), qc.invalidateQueries({ queryKey: ["cwd-chains"] }), qc.invalidateQueries({ queryKey: ["cwd-chain"] })]); setRefreshing(false); }} />}
    >
      <SheetShell eyebrow="Civil Work DPR" title="Dependency Management" subtitle="Every dependency chain, project by project. Open a chain to see its steps; tap a step to allocate it.">
        <SearchBox value={search} onChange={setSearch} placeholder="Search chain, block, unit, room or Auto Name" />
        <AutoNameLookup onOpen={(rungId) => navigation.navigate("AllocationForm", { rungId })} />
        <View style={{ gap: 10 }}>
          {projectsQ.isLoading ? (
            <><Skel h={46} /><Skel h={46} /></>
          ) : projectsQ.error ? (
            <Notice>{(projectsQ.error as Error).message}</Notice>
          ) : projects.length === 0 ? (
            <Body size={13} color={S.graphite} style={{ textAlign: "center", paddingVertical: 30 }}>No projects with dependency chains.</Body>
          ) : (
            projects.map((p) => {
              const expanded = open === p.id;
              return (
                <View key={p.id} style={{ borderWidth: 1, borderColor: S.ink }}>
                  <Press
                    onPress={() => setOpen(expanded ? null : p.id)}
                    style={(pressed) => ({ flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderBottomWidth: expanded ? 1 : 0, borderBottomColor: S.ink, backgroundColor: expanded || pressed ? S.blueWash : "transparent" })}
                  >
                    <ChevronRight size={14} color={S.graphite} style={{ transform: [{ rotate: expanded ? "90deg" : "0deg" }] }} />
                    <FolderTree size={15} color={S.ink} />
                    <Text numberOfLines={1} style={{ flex: 1, fontSize: 13.5, fontFamily: fonts.heading.semibold, color: S.ink }}>{p.name ?? `Project ${p.id}`}</Text>
                  </Press>
                  {expanded && <View style={{ padding: 10 }}><ProjectChains projectId={p.id} term={term} /></View>}
                </View>
              );
            })
          )}
        </View>
      </SheetShell>
    </ScrollView>
  );
}
