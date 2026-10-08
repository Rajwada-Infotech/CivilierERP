// Work Transfer — move activities from one engineer to another. Pick who to take work from, tick the
// activities (one, some, or everything shown), pick who takes over, and transfer. Only work still with the
// engineer (Allocated / In Progress / Hold / Rework) is listed; the server refuses the whole batch if any
// item has moved on, so a bulk transfer never half-applies.
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRightLeft, Check, Search, X } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { toast } from "@/components/Toast";
import { StatusPill } from "@/components/StatusPill";
import { PickerField, TextField } from "@/components/form";
import { usePageRights } from "@/hooks/usePageRights";
import { getEngineers, getTransferCandidateIds, getTransferCandidates, transferWork, type TransferCandidate } from "@/api/cwdApi";
import { ACCENT, Btn } from "../activities/tabs/ui";

const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "—");

export default function WorkTransferScreen() {
  const rights = usePageRights("civilworkdpr-work-transfer");
  const qc = useQueryClient();
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [remarks, setRemarks] = useState("");
  const [projectId, setProjectId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const peopleQ = useQuery({ queryKey: ["cwd-engineers"], queryFn: getEngineers, enabled: rights.canView, staleTime: 300_000 });
  // Search runs on the server after a short pause; the list loads 40 at a time.
  const [term, setTerm] = useState("");
  useEffect(() => { const t = setTimeout(() => setTerm(search.trim()), 350); return () => clearTimeout(t); }, [search]);
  const PAGE = 40;
  const candQ = useInfiniteQuery({
    queryKey: ["cwd-transfer-candidates", fromId, projectId, term],
    queryFn: ({ pageParam }) => getTransferCandidates({ engineerId: Number(fromId), page: pageParam, limit: PAGE, projectId, search: term || undefined }),
    initialPageParam: 1,
    getNextPageParam: (last, all) => (all.length * PAGE < last.total ? all.length + 1 : undefined),
    enabled: rights.canView && !!fromId,
    placeholderData: (prev) => prev,
    staleTime: 30_000,
  });
  useEffect(() => { setSelected(new Set()); setProjectId(null); }, [fromId]);

  const people = (peopleQ.data ?? []).map((p) => ({ key: String(p.id), label: p.name }));
  const visible = useMemo(() => candQ.data?.pages.flatMap((p) => p.rows) ?? [], [candQ.data]);
  const totalMatching = candQ.data?.pages[0]?.total ?? 0;
  const projects = useMemo(() => (candQ.data?.pages[0]?.projects ?? []).map((p) => ({ id: p.id, name: p.name || `Project ${p.id}`, count: p.count })), [candQ.data]);
  const totalAll = projects.reduce((a, p) => a + p.count, 0);

  const [selectingAll, setSelectingAll] = useState(false);
  const allSelected = totalMatching > 0 && selected.size >= totalMatching;
  // "Select all" covers everything matching the filter, not only the rows loaded so far.
  const toggleAll = async () => {
    if (allSelected) { setSelected(new Set()); return; }
    setSelectingAll(true);
    try { setSelected(new Set(await getTransferCandidateIds({ engineerId: Number(fromId), projectId, search: term || undefined }))); }
    catch (e) { Alert.alert("Couldn't select all", (e as Error).message); }
    finally { setSelectingAll(false); }
  };
  const toggle = (id: number) => setSelected((p) => { const n = new Set(p); if (!n.delete(id)) n.add(id); return n; });

  const fromName = people.find((p) => p.key === fromId)?.label;
  const toName = people.find((p) => p.key === toId)?.label;

  const mutation = useMutation({
    mutationFn: () => transferWork({ fromEngineerId: Number(fromId), toEngineerId: Number(toId), assignmentIds: [...selected], remarks: remarks.trim() || undefined }),
    onSuccess: (r) => {
      toast.success(`${r.transferred} ${r.transferred === 1 ? "activity" : "activities"} transferred to ${toName}`);
      setSelected(new Set());
      setRemarks("");
      for (const k of ["cwd-transfer-candidates", "cwd-room", "cwd-scope-summary", "cwd-activities", "cwd-chain", "cwd-dashboard"]) qc.invalidateQueries({ queryKey: [k] });
    },
    onError: (e: Error) => Alert.alert("Couldn't transfer", e.message),
  });

  const canSubmit = rights.canEdit && !!fromId && !!toId && fromId !== toId && selected.size > 0 && !mutation.isPending;
  const submit = () => {
    const n = selected.size;
    Alert.alert("Transfer work?", `Move ${n} ${n === 1 ? "activity" : "activities"} from ${fromName} to ${toName}?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Transfer", onPress: () => mutation.mutate() },
    ]);
  };

  if (!rights.canView) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, alignItems: "center", justifyContent: "center", padding: 32 }}>
        <Text style={{ color: colors.foreground, fontFamily: fonts.heading.semibold, fontSize: 14 }}>No access</Text>
        <Text style={{ color: colors.mutedForeground, fontFamily: fonts.body.regular, fontSize: 12, marginTop: 4, textAlign: "center" }}>You don't have permission to view Work Transfer.</Text>
      </View>
    );
  }

  const header = (
    <View style={{ gap: 4, marginBottom: 8 }}>
      <PickerField label="Transfer from" value={fromId} options={people} onSelect={setFromId} placeholder="Select engineer…" loading={peopleQ.isLoading} />
      <View style={{ height: 10 }} />
      <PickerField label="Transfer to" value={toId} options={people.filter((p) => p.key !== fromId)} onSelect={setToId} placeholder="Select engineer…" loading={peopleQ.isLoading} />
      <View style={{ height: 10 }} />
      <TextField label="Remarks (optional)" value={remarks} onChangeText={setRemarks} placeholder="e.g. on leave, moved to another site" />

      {!!fromId && (
        <>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, borderRadius: 12, paddingHorizontal: 12 }}>
            <Search size={14} color={colors.mutedForeground} />
            <TextInput value={search} onChangeText={setSearch} placeholder="Search activity or location…" placeholderTextColor={`${colors.mutedForeground}99`} style={{ flex: 1, color: colors.foreground, fontFamily: fonts.body.regular, fontSize: 13, paddingVertical: 10 }} />
            {!!search && <TouchableOpacity onPress={() => setSearch("")}><X size={14} color={colors.mutedForeground} /></TouchableOpacity>}
          </View>
          {projects.length > 1 && (
            <FlatList
              horizontal
              showsHorizontalScrollIndicator={false}
              data={[{ id: null as number | null, name: "All projects" }, ...projects.map((p) => ({ id: p.id as number | null, name: `${p.name} (${p.count})` }))]}
              keyExtractor={(p) => String(p.id)}
              style={{ marginTop: 8 }}
              contentContainerStyle={{ gap: 8 }}
              renderItem={({ item }) => {
                const on = projectId === item.id;
                return (
                  <TouchableOpacity onPress={() => setProjectId(item.id)} style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: on ? ACCENT : colors.border, backgroundColor: on ? `${ACCENT}22` : "transparent" }}>
                    <Text style={{ fontSize: 11, fontFamily: fonts.heading.semibold, color: on ? ACCENT : colors.mutedForeground }}>{item.name}</Text>
                  </TouchableOpacity>
                );
              }}
            />
          )}
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 10 }}>
            <Text style={{ fontSize: 12, fontFamily: fonts.heading.semibold, color: colors.foreground }}>{fromName}'s activities · {selected.size} of {totalAll} selected</Text>
            {visible.length > 0 && rights.canEdit && (
              <TouchableOpacity disabled={selectingAll} onPress={toggleAll}><Text style={{ fontSize: 11.5, fontFamily: fonts.heading.semibold, color: ACCENT, opacity: selectingAll ? 0.5 : 1 }}>{allSelected ? "Clear selection" : `Select all ${totalMatching}`}</Text></TouchableOpacity>
            )}
          </View>
        </>
      )}
    </View>
  );

  const renderItem = ({ item: c, index }: { item: TransferCandidate; index: number }) => {
    const on = selected.has(c.assignmentId);
    // Rows arrive sorted project by project; a header marks where each project starts.
    const newProject = index === 0 || visible[index - 1]?.projectId !== c.projectId;
    return (
      <View>
      {newProject && (
        <Text style={{ fontSize: 11, fontFamily: fonts.heading.semibold, color: colors.mutedForeground, textTransform: "uppercase", letterSpacing: 0.6, marginTop: index === 0 ? 0 : 10, marginBottom: 6 }}>{c.projectName || "No project"}</Text>
      )}
      <TouchableOpacity
        activeOpacity={0.7}
        disabled={!rights.canEdit}
        onPress={() => toggle(c.assignmentId)}
        style={{ flexDirection: "row", gap: 10, backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: on ? ACCENT : colors.border, padding: 12, marginBottom: 8 }}
      >
        <View style={{ width: 22, height: 22, borderRadius: 6, borderWidth: 2, alignItems: "center", justifyContent: "center", borderColor: on ? ACCENT : colors.border, backgroundColor: on ? ACCENT : "transparent", marginTop: 1 }}>
          {on && <Check size={13} color="#fff" strokeWidth={3} />}
        </View>
        <View style={{ flex: 1, gap: 3 }}>
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
            <Text style={{ flex: 1, fontSize: 13, fontFamily: fonts.heading.semibold, color: colors.foreground }}>{c.activityName}</Text>
            <StatusPill status={c.status} />
          </View>
          <Text numberOfLines={2} style={{ fontSize: 10.5, color: colors.mutedForeground, fontFamily: fonts.body.regular }}>{c.scopePath}</Text>
          <Text style={{ fontSize: 10.5, color: colors.mutedForeground, fontFamily: fonts.body.medium }}>{Math.round(c.progressPercent ?? 0)}% · ends {fmtDate(c.endDate)}{c.engineerNames ? ` · ${c.engineerNames}` : ""}</Text>
        </View>
      </TouchableOpacity>
      </View>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <FlatList
        data={fromId ? visible : []}
        keyExtractor={(c) => String(c.assignmentId)}
        renderItem={renderItem}
        ListHeaderComponent={header}
        keyboardShouldPersistTaps="handled"
        onEndReachedThreshold={0.6}
        onEndReached={() => { if (candQ.hasNextPage && !candQ.isFetchingNextPage) candQ.fetchNextPage(); }}
        ListFooterComponent={candQ.isFetchingNextPage ? <ActivityIndicator color={colors.mutedForeground} style={{ paddingVertical: 14 }} /> : null}
        initialNumToRender={10}
        windowSize={7}
        contentContainerStyle={{ padding: 16, paddingBottom: 120 }}
        ListEmptyComponent={
          !fromId ? <Text style={{ textAlign: "center", color: colors.mutedForeground, fontSize: 12, fontFamily: fonts.body.regular, paddingVertical: 30 }}>Pick the engineer to transfer work from.</Text>
          : candQ.isLoading ? <ActivityIndicator color={colors.mutedForeground} style={{ paddingVertical: 30 }} />
          : candQ.error ? <Text style={{ color: colors.destructive, fontSize: 12, fontFamily: fonts.body.regular, paddingVertical: 20 }}>{(candQ.error as Error).message}</Text>
          : <Text style={{ textAlign: "center", color: colors.mutedForeground, fontSize: 12, fontFamily: fonts.body.regular, paddingVertical: 30 }}>{totalAll === 0 ? "This engineer has no transferable activities." : "No activities match your filters."}</Text>
        }
      />
      {rights.canEdit && (
        <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: 14, backgroundColor: colors.background, borderTopWidth: 1, borderTopColor: colors.border }}>
          <Btn
            label={selected.size > 0 && toName ? `Transfer ${selected.size} to ${toName}` : "Select activities and a receiving engineer"}
            icon={<ArrowRightLeft size={14} color="#04181d" />}
            disabled={!canSubmit}
            busy={mutation.isPending}
            onPress={submit}
          />
        </View>
      )}
    </View>
  );
}
