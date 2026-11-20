// Work Transfer — move activities from one engineer to another. Pick who to take work from, tick the
// activities (one, some, or everything shown), pick who takes over, and transfer. Only work still with the
// engineer (Allocated / In Progress / Hold / Rework) is listed; the server refuses the whole batch if any
// item has moved on, so a bulk transfer never half-applies.
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Text, View } from "react-native";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRightLeft, Check } from "lucide-react-native";
import { sheet as S } from "@/theme/colors";
import { Body, Label, LinkLabel, Notice, Press, SearchBox, Skel } from "@/components/sheet/Sheet";
import { ChipRow, NoAccessPage, PageHead } from "@/components/sheet/Page";
import { fonts } from "@/theme/fonts";
import { toast } from "@/components/Toast";
import { StatusPill } from "@/components/StatusPill";
import { PickerField, TextField } from "@/components/form";
import { usePageRights } from "@/hooks/usePageRights";
import { getEngineers, getTransferCandidateIds, getTransferCandidates, transferWork, type TransferCandidate } from "@/api/cwdApi";
import { Btn } from "../activities/tabs/ui";

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

  if (!rights.canView) return <NoAccessPage title="Work Transfer" what="Work Transfer" />;

  const header = (
    <View>
      <PageHead title="Work Transfer" subtitle="Move activities from one engineer to another: pick who from, tick the work, pick who takes over.">
        <PickerField label="Transfer from" value={fromId} options={people} onSelect={setFromId} placeholder="Select engineer…" loading={peopleQ.isLoading} />
        <PickerField label="Transfer to" value={toId} options={people.filter((p) => p.key !== fromId)} onSelect={setToId} placeholder="Select engineer…" loading={peopleQ.isLoading} />
        <TextField label="Remarks (optional)" value={remarks} onChangeText={setRemarks} placeholder="e.g. on leave, moved to another site" />
        {!!fromId && (
          <>
            <SearchBox value={search} onChange={setSearch} placeholder="Search activity or location" />
            {projects.length > 1 && (
              <ChipRow
                options={[{ value: "all", label: "All projects" }, ...projects.map((p) => ({ value: String(p.id), label: p.name, count: p.count }))]}
                value={projectId == null ? "all" : String(projectId)}
                onChange={(v) => setProjectId(v === "all" ? null : Number(v))}
              />
            )}
          </>
        )}
      </PageHead>
      {!!fromId && (
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, paddingHorizontal: 16, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: S.ink }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Label color={S.ink}>{`${fromName}'s activities`}</Label>
            <Body size={12} color={S.graphite} style={{ marginTop: 3 }}>{selected.size} of {totalAll} selected</Body>
          </View>
          {visible.length > 0 && rights.canEdit && (
            <LinkLabel onPress={selectingAll ? undefined : () => void toggleAll()}>{allSelected ? "Clear selection" : `Select all ${totalMatching}`}</LinkLabel>
          )}
        </View>
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
          <View style={{ paddingHorizontal: 16, paddingTop: index === 0 ? 12 : 16, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: S.rule }}>
            <Label color={S.ink}>{c.projectName || "No project"}</Label>
          </View>
        )}
        <Press
          disabled={!rights.canEdit}
          onPress={() => toggle(c.assignmentId)}
          style={(pressed) => ({ flexDirection: "row", gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: S.ruleSoft, backgroundColor: on ? S.blueWash : pressed ? S.blueWash : S.paper })}
        >
          <View style={{ width: 22, height: 22, borderWidth: 1.5, alignItems: "center", justifyContent: "center", borderColor: S.ink, backgroundColor: on ? S.ink : "transparent", marginTop: 1 }}>
            {on && <Check size={13} color={S.paper} strokeWidth={3} />}
          </View>
          <View style={{ flex: 1, gap: 3 }}>
            <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
              <Text style={{ flex: 1, fontSize: 13.5, fontFamily: fonts.body.semibold, color: S.ink }}>{c.activityName}</Text>
              <StatusPill status={c.status} />
            </View>
            <Text numberOfLines={2} style={{ fontSize: 11.5, color: S.graphite, fontFamily: fonts.body.regular }}>{c.scopePath}</Text>
            <Text style={{ fontSize: 11.5, color: S.ink2, fontFamily: fonts.body.medium }}>{Math.round(c.progressPercent ?? 0)}% · ends {fmtDate(c.endDate)}{c.engineerNames ? ` · ${c.engineerNames}` : ""}</Text>
          </View>
        </Press>
      </View>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: S.paper }}>
      <FlatList
        data={fromId ? visible : []}
        keyExtractor={(c) => String(c.assignmentId)}
        renderItem={renderItem}
        ListHeaderComponent={header}
        keyboardShouldPersistTaps="handled"
        onEndReachedThreshold={0.6}
        onEndReached={() => { if (candQ.hasNextPage && !candQ.isFetchingNextPage) candQ.fetchNextPage(); }}
        ListFooterComponent={candQ.isFetchingNextPage ? <ActivityIndicator color={S.graphite} style={{ paddingVertical: 14 }} /> : undefined}
        initialNumToRender={10}
        windowSize={7}
        contentContainerStyle={{ paddingBottom: 140 }}
        ListEmptyComponent={
          !fromId ? <Body size={13} color={S.graphite} style={{ textAlign: "center", paddingVertical: 30 }}>Pick the engineer to transfer work from.</Body>
          : candQ.isLoading ? <View style={{ padding: 16 }}><Skel h={64} /><Skel h={64} /></View>
          : candQ.error ? <View style={{ padding: 16 }}><Notice>{(candQ.error as Error).message}</Notice></View>
          : <Body size={13} color={S.graphite} style={{ textAlign: "center", paddingVertical: 30 }}>{totalAll === 0 ? "This engineer has no transferable activities." : "No activities match your filters."}</Body>
        }
      />
      {rights.canEdit && (
        <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: 12, paddingRight: 120, backgroundColor: S.paper, borderTopWidth: 1.5, borderTopColor: S.ink }}>
          <Btn
            label={selected.size > 0 && toName ? `Transfer ${selected.size} to ${toName}` : "Select activities and a receiving engineer"}
            icon={<ArrowRightLeft size={14} color={S.paper} />}
            disabled={!canSubmit}
            busy={mutation.isPending}
            onPress={submit}
          />
        </View>
      )}
    </View>
  );
}
