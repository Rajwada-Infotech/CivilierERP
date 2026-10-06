// Dependency Management — every dependency chain, arranged project by project. Open a project to page through
// its chains (search by chain / block / unit / room), open a chain to see its activities in order with their
// status, and tap an activity to allocate it. Only the project you open is fetched, 30 chains at a time.
import { useEffect, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigation } from "@react-navigation/native";
import { ChevronRight, FolderTree, GitBranch, Search, X } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { StatusPill, displayStatus } from "@/components/StatusPill";
import { usePageRights } from "@/hooks/usePageRights";
import { getChainActivities, getDependencyChains, getScopeProjects, type DependencyChain } from "@/api/cwdApi";

const ACCENT = "#0891b2";
const PAGE = 30;

function ChainRungs({ chainId }: { chainId: number }) {
  const navigation = useNavigation<{ navigate: (name: string, params?: object) => void }>();
  const q = useQuery({ queryKey: ["cwd-chain", chainId], queryFn: () => getChainActivities(chainId), staleTime: 60_000 });
  if (q.isLoading) return <ActivityIndicator color={colors.mutedForeground} style={{ paddingVertical: 10 }} />;
  if (q.error) return <Text style={{ color: colors.destructive, fontSize: 11.5, fontFamily: fonts.body.regular, padding: 8 }}>{(q.error as Error).message}</Text>;
  const rungs = [...(q.data ?? [])].sort((a, b) => (a.sequenceNo ?? 0) - (b.sequenceNo ?? 0));
  if (!rungs.length) return <Text style={{ color: colors.mutedForeground, fontSize: 11.5, fontFamily: fonts.body.regular, padding: 8 }}>No activities in this chain.</Text>;
  return (
    <View style={{ gap: 6, paddingTop: 6 }}>
      {rungs.map((a) => (
        <TouchableOpacity key={a.assignmentId} activeOpacity={0.7} onPress={() => navigation.navigate("AllocationForm", { rungId: a.rungId })} style={{ borderRadius: 10, backgroundColor: colors.muted, padding: 10, gap: 5 }}>
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
            <Text style={{ flex: 1, fontSize: 12.5, fontFamily: fonts.body.medium, color: colors.foreground }}>{a.sequenceNo}. {a.activityName}</Text>
            <StatusPill status={displayStatus(a.status, a.resumedAt)} />
          </View>
          <Text numberOfLines={1} style={{ fontSize: 10.5, color: colors.mutedForeground, fontFamily: fonts.body.regular }}>
            {a.engineerNames || "Not assigned yet"}{a.progressPercent ? ` · ${a.progressPercent}%` : ""}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function ChainCard({ chain }: { chain: DependencyChain }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={{ borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 10 }}>
      <TouchableOpacity activeOpacity={0.6} onPress={() => setOpen((o) => !o)} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <ChevronRight size={14} color={colors.mutedForeground} style={{ transform: [{ rotate: open ? "90deg" : "0deg" }] }} />
        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} style={{ fontSize: 12.5, fontFamily: fonts.heading.semibold, color: colors.foreground }}>{chain.alias}</Text>
          <Text numberOfLines={1} style={{ fontSize: 10.5, color: colors.mutedForeground, fontFamily: fonts.body.regular, marginTop: 1 }}>{chain.scopePath}</Text>
        </View>
        <View style={{ alignItems: "flex-end", gap: 3 }}>
          <View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, backgroundColor: chain.workType === "INTERNAL" ? "#f9731622" : "#0ea5e922" }}>
            <Text style={{ fontSize: 9, fontFamily: fonts.heading.bold, color: chain.workType === "INTERNAL" ? "#f97316" : "#0ea5e9" }}>{chain.workType}</Text>
          </View>
          <Text style={{ fontSize: 10, color: colors.mutedForeground, fontFamily: fonts.body.medium }}>{chain.activityCount} step{chain.activityCount === 1 ? "" : "s"}</Text>
        </View>
      </TouchableOpacity>
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
  if (q.isLoading) return <ActivityIndicator color={colors.mutedForeground} style={{ paddingVertical: 14 }} />;
  if (q.error) return <Text style={{ color: colors.destructive, fontSize: 11.5, fontFamily: fonts.body.regular, padding: 8 }}>{(q.error as Error).message}</Text>;
  if (!chains.length) return <Text style={{ color: colors.mutedForeground, fontSize: 11.5, fontFamily: fonts.body.regular, padding: 8 }}>{term ? "No chains match." : "No chains in this project."}</Text>;
  return (
    <View style={{ gap: 8, paddingTop: 4 }}>
      {chains.map((c) => <ChainCard key={c.id} chain={c} />)}
      {q.hasNextPage && (
        <TouchableOpacity onPress={() => q.fetchNextPage()} disabled={q.isFetchingNextPage} style={{ alignItems: "center", paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: ACCENT }}>
          {q.isFetchingNextPage ? <ActivityIndicator size="small" color={ACCENT} /> : <Text style={{ fontSize: 12, fontFamily: fonts.heading.semibold, color: ACCENT }}>Load more chains</Text>}
        </TouchableOpacity>
      )}
    </View>
  );
}

export default function DependencyManagementScreen() {
  const rights = usePageRights("civilworkdpr-work-done");
  const qc = useQueryClient();
  const [open, setOpen] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => { const t = setTimeout(() => setTerm(search.trim()), 400); return () => clearTimeout(t); }, [search]);

  const projectsQ = useQuery({ queryKey: ["cwd-scope-projects"], queryFn: getScopeProjects, enabled: rights.canView, staleTime: 300_000 });
  const projects = projectsQ.data ?? [];
  // A single project opens by itself.
  useEffect(() => { if (projects.length === 1 && open == null) setOpen(projects[0].id); }, [projects, open]);

  if (!rights.canView) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, alignItems: "center", justifyContent: "center", padding: 32 }}>
        <Text style={{ color: colors.foreground, fontFamily: fonts.heading.semibold, fontSize: 14 }}>No access</Text>
        <Text style={{ color: colors.mutedForeground, fontFamily: fonts.body.regular, fontSize: 12, marginTop: 4, textAlign: "center" }}>You don't have permission to view Dependency Management.</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 96 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={ACCENT} onRefresh={async () => { setRefreshing(true); await Promise.all([projectsQ.refetch(), qc.invalidateQueries({ queryKey: ["cwd-chains"] }), qc.invalidateQueries({ queryKey: ["cwd-chain"] })]); setRefreshing(false); }} />}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, borderRadius: 12, paddingHorizontal: 12 }}>
          <Search size={14} color={colors.mutedForeground} />
          <TextInput value={search} onChangeText={setSearch} placeholder="Search chain, block, unit or room…" placeholderTextColor={`${colors.mutedForeground}99`} style={{ flex: 1, color: colors.foreground, fontFamily: fonts.body.regular, fontSize: 13, paddingVertical: 10 }} />
          {!!search && <TouchableOpacity onPress={() => setSearch("")}><X size={14} color={colors.mutedForeground} /></TouchableOpacity>}
        </View>

        <View style={{ marginTop: 14, gap: 10 }}>
          {projectsQ.isLoading ? (
            <ActivityIndicator color={colors.mutedForeground} style={{ paddingVertical: 40 }} />
          ) : projectsQ.error ? (
            <Text style={{ color: colors.destructive, fontSize: 12, fontFamily: fonts.body.regular }}>{(projectsQ.error as Error).message}</Text>
          ) : projects.length === 0 ? (
            <Text style={{ textAlign: "center", color: colors.mutedForeground, fontSize: 12, fontFamily: fonts.body.regular, paddingVertical: 40 }}>No projects with dependency chains.</Text>
          ) : (
            projects.map((p) => {
              const expanded = open === p.id;
              return (
                <View key={p.id} style={{ backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: expanded ? `${ACCENT}66` : colors.border, overflow: "hidden" }}>
                  <TouchableOpacity activeOpacity={0.6} onPress={() => setOpen(expanded ? null : p.id)} style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 12 }}>
                    <ChevronRight size={14} color={colors.mutedForeground} style={{ transform: [{ rotate: expanded ? "90deg" : "0deg" }] }} />
                    <FolderTree size={15} color="#8b5cf6" />
                    <Text numberOfLines={1} style={{ flex: 1, fontSize: 13.5, fontFamily: fonts.heading.semibold, color: colors.foreground }}>{p.name ?? `Project ${p.id}`}</Text>
                    <GitBranch size={13} color={colors.mutedForeground} />
                  </TouchableOpacity>
                  {expanded && <View style={{ paddingHorizontal: 12, paddingBottom: 12 }}><ProjectChains projectId={p.id} term={term} /></View>}
                </View>
              );
            })
          )}
        </View>
      </ScrollView>
    </View>
  );
}
