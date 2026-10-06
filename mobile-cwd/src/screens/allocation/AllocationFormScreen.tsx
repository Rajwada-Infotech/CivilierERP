// Allocate one activity (a rung of a dependency chain): who works on it, who inspects it, who approves it, when,
// for how long, who supplies the labour and material, and how much of each material. Same fields and date rules
// as the web Work Allocation modal. Checkpoints are shown read-only — they come from Activity Master and are
// ticked in Reporting.
import { useEffect, useMemo, useState } from "react";
import { Alert, ScrollView, Text, TouchableOpacity, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { Check, Circle, Plus, ShieldCheck, Trash2, Users } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { toast } from "@/components/Toast";
import { StatusPill, displayStatus } from "@/components/StatusPill";
import { DateField, FormSection, MultiPickerField, NumberField, PickerField, RemarksField, TextField } from "@/components/form";
import { usePageRights } from "@/hooks/usePageRights";
import {
  getActivityAssignment, getEngineers, getProjectContractors, getRungDetail, saveAllocation, type ApprovalLevel, type SourceType,
} from "@/api/cwdApi";
import { applyDefaultDays, changeDays, changeEnd, changeStart, type AllocDates } from "@/utils/allocationDates";
import type { MainStackParamList } from "@/navigation/MainStack";
import { ACCENT, Btn, ErrorText, Loading, card } from "../activities/tabs/ui";

const DEVELOPER = "DEVELOPER";
const contractorKey = (id: number) => `CONTRACTOR:${id}`;
const parseGivenBy = (v: string): { source: SourceType | null; contractorId: number | null } => {
  if (!v) return { source: null, contractorId: null };
  if (v === DEVELOPER) return { source: "DEVELOPER", contractorId: null };
  const id = parseInt(v.replace("CONTRACTOR:", ""), 10);
  return { source: "CONTRACTOR", contractorId: Number.isFinite(id) ? id : null };
};
const givenByKey = (s: SourceType | null, id: number | null) => (s === "DEVELOPER" ? DEVELOPER : s === "CONTRACTOR" && id != null ? contractorKey(id) : "");

let levelSeq = 0;
const newLevel = (i: number): ApprovalLevel => ({ id: `level-${Date.now()}-${++levelSeq}`, label: `Level ${i + 1}`, userIds: [], mode: "all" });

export default function AllocationFormScreen() {
  const { rungId } = useRoute<RouteProp<MainStackParamList, "AllocationForm">>().params;
  const navigation = useNavigation<{ goBack: () => void; navigate: (name: string, params?: object) => void }>();
  const qc = useQueryClient();
  const allocRights = usePageRights("civilworkdpr-work-done");
  const reportRights = usePageRights("civilworkdpr-activity-reporting");
  const qcRights = usePageRights("civilworkdpr-quality-check");
  const canEdit = allocRights.canEdit || reportRights.canEdit;

  const rowQ = useQuery({ queryKey: ["cwd-row", rungId], queryFn: () => getActivityAssignment(rungId) });
  const detailQ = useQuery({ queryKey: ["cwd-detail", rungId], queryFn: () => getRungDetail(rungId) });
  const peopleQ = useQuery({ queryKey: ["cwd-engineers"], queryFn: getEngineers, staleTime: 300_000 });
  const row = rowQ.data ?? undefined;
  const projectId = row?.projectId ?? null;
  const contractorsQ = useQuery({ queryKey: ["cwd-contractors", projectId], queryFn: () => getProjectContractors(projectId!), enabled: projectId != null, staleTime: 300_000 });

  const [engineerIds, setEngineerIds] = useState<string[]>([]);
  const [qcUserIds, setQcUserIds] = useState<string[]>([]);
  const [levels, setLevels] = useState<ApprovalLevel[]>([]);
  const [dates, setDates] = useState<AllocDates>({ startDate: "", endDate: "", days: "", startAuto: false });
  const [labourBy, setLabourBy] = useState("");
  const [materialBy, setMaterialBy] = useState("");
  const [description, setDescription] = useState("");
  const [remarks, setRemarks] = useState("");
  const [qty, setQty] = useState<Record<string, string>>({});

  const detail = detailQ.data;
  const defaultDescription = useMemo(
    () => `Work for ${row?.projectName || "—"}, ${row?.scopePath || "—"} and ${row?.activityName || ""}`.trim(),
    [row],
  );

  // Load the saved allocation (or the defaults for a never-allocated rung) once both queries are in.
  useEffect(() => {
    if (!detail || !row) return;
    const a = detail.assignment;
    if (!a) {
      setDescription(defaultDescription);
      setDates(applyDefaultDays({ startDate: "", endDate: "", days: "", startAuto: false }, detail.daysOfCompletion));
      return;
    }
    setEngineerIds(a.engineerIds.map(String));
    setQcUserIds((a.qcUserIds || []).map(String));
    setLevels((a.approvalLevels as ApprovalLevel[]) || []);
    setDates(applyDefaultDays({ startDate: a.startDate?.slice(0, 10) ?? "", endDate: a.endDate?.slice(0, 10) ?? "", days: a.days != null ? String(a.days) : "", startAuto: false }, detail.daysOfCompletion));
    setLabourBy(givenByKey(a.labourSource as SourceType | null, a.labourContractorId ?? null));
    setMaterialBy(givenByKey(a.materialSource as SourceType | null, a.materialContractorId ?? null));
    setDescription(a.description || defaultDescription);
    setRemarks(a.remarks || "");
    const m: Record<string, string> = {};
    for (const x of a.materials) m[x.itemId] = String(x.quantity);
    setQty(m);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail, row?.rungId]);

  const people = (peopleQ.data ?? []).map((p) => ({ key: String(p.id), label: p.name }));
  const givenByOptions = [
    { key: DEVELOPER, label: `Developer — ${row?.projectName || "Project"}` },
    ...(contractorsQ.data ?? []).map((c) => ({ key: contractorKey(c.id), label: c.name })),
  ];

  const save = useMutation({
    mutationFn: () => {
      const a = detail?.assignment;
      const labour = parseGivenBy(labourBy);
      const material = parseGivenBy(materialBy);
      return saveAllocation(rungId, {
        engineerIds: engineerIds.map(Number),
        qcUserIds: qcUserIds.map(Number),
        approvalLevels: levels,
        startDate: dates.startDate || null,
        days: dates.days ? parseInt(dates.days, 10) : null,
        endDate: dates.endDate || null,
        labourSource: labour.source,
        materialSource: material.source,
        labourContractorId: labour.contractorId,
        materialContractorId: material.contractorId,
        description: description || null,
        remarks: remarks || null,
        materials: Object.entries(qty).map(([itemId, q]) => ({ itemId, quantity: parseFloat(q) })).filter((m) => Number.isFinite(m.quantity) && m.quantity > 0),
        checkpoints: a?.checkpoints ?? [],
      });
    },
    onSuccess: () => {
      toast.success("Allocation saved");
      for (const k of ["cwd-room", "cwd-scope-summary", "cwd-activities", "cwd-alerts", "cwd-dashboard"]) qc.invalidateQueries({ queryKey: [k] });
      qc.invalidateQueries({ queryKey: ["cwd-row", rungId] });
      qc.invalidateQueries({ queryKey: ["cwd-detail", rungId] });
      navigation.goBack();
    },
    onError: (e: Error) => Alert.alert("Couldn't save", e.message),
  });

  if (rowQ.isLoading || detailQ.isLoading) return <View style={{ flex: 1, backgroundColor: colors.background }}><Loading /></View>;
  if (detailQ.error || !detail) return <View style={{ flex: 1, backgroundColor: colors.background, padding: 24 }}><ErrorText error={detailQ.error} /></View>;

  const shown = row ? displayStatus(row.status, row.resumedAt) : "";
  const checkpoints = detail.assignment?.checkpoints ?? [];
  const canInspect = qcRights.canEdit && row?.status === "COMPLETED" && row?.qcStatus !== "APPROVED";
  const updateLevel = (id: string, patch: Partial<ApprovalLevel>) => setLevels((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: 16, paddingBottom: 96 }} keyboardShouldPersistTaps="handled">
      <View style={{ ...card, marginBottom: 18 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
          <Text style={{ flex: 1, fontSize: 15, fontFamily: fonts.heading.bold, color: colors.foreground }}>{row?.sequenceNo != null ? `${row.sequenceNo}. ` : ""}{row?.activityName ?? "Activity"}</Text>
          {!!shown && <StatusPill status={shown} size="md" />}
        </View>
        {!!row?.scopePath && <Text style={{ fontSize: 11, fontFamily: fonts.body.regular, color: colors.mutedForeground, marginTop: 4 }}>{[row.projectName, row.scopePath].filter(Boolean).join(" · ")}</Text>}
        <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
          <View style={{ flex: 1 }}><Btn tone="outline" label="Open activity" onPress={() => navigation.navigate("ActivityDetail", { rungId })} /></View>
          {canInspect && <View style={{ flex: 1 }}><Btn label="Inspect (QC)" icon={<ShieldCheck size={14} color="#04181d" />} onPress={() => navigation.navigate("QcInspect", { rungId })} /></View>}
        </View>
        {row?.status === "COMPLETED" && row.qcStatus === "APPROVED" && <Text style={{ fontSize: 11, color: "#10b981", fontFamily: fonts.body.medium, marginTop: 8 }}>Quality Check passed — waiting on approval.</Text>}
      </View>

      {!canEdit && <Text style={{ fontSize: 11.5, color: colors.mutedForeground, fontFamily: fonts.body.regular, marginBottom: 14 }}>You can view this allocation but not change it.</Text>}

      {/* Approval setup — who may approve this activity's finished work, step by step */}
      <FormSection title="Approval setup">
        {levels.length === 0 ? (
          <Text style={{ fontSize: 11.5, color: colors.mutedForeground, fontFamily: fonts.body.regular, marginBottom: 10 }}>No approvers set — only super admin can approve this activity's work. Add a level to name who else can.</Text>
        ) : levels.map((l, i) => (
          <View key={l.id} style={{ marginBottom: 6 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <View style={{ flex: 1 }}>
                <MultiPickerField label={i === levels.length - 1 ? "Final approver(s)" : `Step ${i + 1} approver(s)`} options={people} selected={l.userIds.map(String)} onChange={(k) => updateLevel(l.id, { userIds: k.map(Number) })} disabled={!canEdit} />
              </View>
              {canEdit && (
                <TouchableOpacity onPress={() => setLevels((ls) => ls.filter((x) => x.id !== l.id))} style={{ padding: 6, marginBottom: 14 }}><Trash2 size={15} color={colors.mutedForeground} /></TouchableOpacity>
              )}
            </View>
            {l.userIds.length > 1 && (
              <TouchableOpacity disabled={!canEdit} onPress={() => updateLevel(l.id, { mode: l.mode === "any" ? "all" : "any" })} style={{ flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", marginTop: -6, marginBottom: 12, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: l.mode === "any" ? "#f59e0b22" : colors.muted }}>
                <Users size={11} color={l.mode === "any" ? "#f59e0b" : colors.mutedForeground} />
                <Text style={{ fontSize: 10.5, fontFamily: fonts.heading.semibold, color: l.mode === "any" ? "#f59e0b" : colors.mutedForeground }}>{l.mode === "any" ? "Any one can approve" : "All must approve"}</Text>
              </TouchableOpacity>
            )}
          </View>
        ))}
        {canEdit && <Btn tone="outline" label="Add approver level" icon={<Plus size={13} color={ACCENT} />} onPress={() => setLevels((ls) => [...ls, newLevel(ls.length)])} />}
      </FormSection>

      <FormSection title="People">
        <MultiPickerField label="Engineers" options={people} selected={engineerIds} onChange={setEngineerIds} placeholder="Select engineers…" disabled={!canEdit} />
        <MultiPickerField label="Quality check" options={people} selected={qcUserIds} onChange={setQcUserIds} placeholder="Select QC…" disabled={!canEdit} />
      </FormSection>

      <FormSection title="Schedule">
        <DateField label="Start date" value={dates.startDate} onChange={(v) => setDates((d) => changeStart(d, v))} disabled={!canEdit} />
        {dates.startAuto && !!dates.startDate && <Text style={{ fontSize: 10.5, color: "#f59e0b", fontFamily: fonts.body.regular, marginTop: -8, marginBottom: 12 }}>Tentative — worked back from the end date</Text>}
        <NumberField label={detail.daysOfCompletion != null ? `Days · ${detail.daysOfCompletion} in Activity Master` : "Days"} value={dates.days} onChangeText={(v) => setDates((d) => changeDays(d, v.replace(/[^0-9]/g, "")))} placeholder="e.g. 10" disabled={!canEdit} />
        <DateField label="End date" value={dates.endDate} onChange={(v) => setDates((d) => changeEnd(d, v))} disabled={!canEdit} />
      </FormSection>

      <FormSection title="Labour & material">
        <PickerField label="Labour given by" value={labourBy} options={givenByOptions} onSelect={setLabourBy} clearable disabled={!canEdit} loading={contractorsQ.isLoading} />
        <View style={{ height: 12 }} />
        <PickerField label="Material given by" value={materialBy} options={givenByOptions} onSelect={setMaterialBy} clearable disabled={!canEdit} loading={contractorsQ.isLoading} />
      </FormSection>

      {detail.candidateItems.length > 0 && (
        <FormSection title="Materials needed">
          {detail.candidateItems.map((it) => (
            <NumberField key={it.itemId} label={`${it.itemName}${it.uom ? ` (${it.uom})` : ""}`} value={qty[it.itemId] ?? ""} onChangeText={(v) => setQty((q) => ({ ...q, [it.itemId]: v }))} placeholder="Quantity" disabled={!canEdit} />
          ))}
        </FormSection>
      )}

      <FormSection title="Notes">
        <RemarksField label="Description" value={description} onChangeText={setDescription} disabled={!canEdit} />
        <RemarksField label="Remarks" value={remarks} onChangeText={setRemarks} disabled={!canEdit} />
      </FormSection>

      <FormSection title={`Checkpoints (${checkpoints.length})`}>
        {checkpoints.length === 0 ? (
          <Text style={{ fontSize: 11.5, color: colors.mutedForeground, fontFamily: fonts.body.regular }}>None tagged — add them in Activity Master. They are ticked off in Reporting.</Text>
        ) : (
          <View style={{ ...card, gap: 8 }}>
            {checkpoints.map((c, i) => (
              <View key={c.id ?? `${c.fieldName}-${i}`} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                {c.isChecked ? <Check size={14} color="#10b981" /> : <Circle size={14} color={colors.mutedForeground} />}
                <Text style={{ flex: 1, fontSize: 12.5, fontFamily: fonts.body.regular, color: colors.foreground }}>{c.fieldName}</Text>
              </View>
            ))}
          </View>
        )}
      </FormSection>

      {canEdit && <Btn label="Save allocation" busy={save.isPending} onPress={() => save.mutate()} />}
    </ScrollView>
  );
}
