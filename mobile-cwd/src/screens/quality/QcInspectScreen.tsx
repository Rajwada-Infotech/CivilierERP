// Inspect one completed activity: rate every checkpoint Poor / Good / Excellent (a note for a Poor one), attach
// a photo, add remarks, and submit. The decision isn't picked by hand — it follows the ratings: any Poor sends
// the activity back for rework as a new attempt (remarks required), otherwise it is approved.
import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { AlertTriangle, Camera, CheckCircle2, RotateCcw } from "lucide-react-native";
import { colors, sheet as S } from "@/theme/colors";
import { Body, Detail, InfoGrid, Input, Label, LinkLabel, Notice, Press, SheetFrame, Skel, TitleText } from "@/components/sheet/Sheet";
import { fonts } from "@/theme/fonts";
import { toast } from "@/components/Toast";
import { StatusPill, displayStatus } from "@/components/StatusPill";
import { usePageRights } from "@/hooks/usePageRights";
import {
  getActivityAssignment, getActivityPhotos, getQcHistory, getRungDetail, submitQcDecision, uploadActivityPhoto, type QcRating,
} from "@/api/cwdApi";
import type { MainStackParamList } from "@/navigation/MainStack";
import { Btn, takePhoto } from "../activities/tabs/ui";

const RATINGS: { key: QcRating; label: string; color: string }[] = [
  { key: "POOR", label: "Poor", color: S.red },
  { key: "GOOD", label: "Good", color: S.blue },
  { key: "EXCELLENT", label: "Excellent", color: S.blue },
];
type Verdict = { rating: QcRating | null; note: string };
const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");

export default function QcInspectScreen() {
  const { rungId } = useRoute<RouteProp<MainStackParamList, "QcInspect">>().params;
  const navigation = useNavigation<{ goBack: () => void; navigate: (name: string, params?: object) => void }>();
  const qc = useQueryClient();
  const rights = usePageRights("civilworkdpr-quality-check");
  const [verdicts, setVerdicts] = useState<Record<number, Verdict>>({});
  const [remarks, setRemarks] = useState("");

  const rowQ = useQuery({ queryKey: ["cwd-row", rungId], queryFn: () => getActivityAssignment(rungId) });
  const detailQ = useQuery({ queryKey: ["cwd-detail", rungId], queryFn: () => getRungDetail(rungId) });
  const histQ = useQuery({ queryKey: ["cwd-qc-history", rungId], queryFn: () => getQcHistory(rungId) });
  const photosQ = useQuery({ queryKey: ["cwd-photos", rungId], queryFn: () => getActivityPhotos(rungId) });

  const row = rowQ.data ?? undefined;
  const a = detailQ.data?.assignment;
  const checkpoints = (a?.checkpoints ?? []).filter((c) => c.id != null);
  const photoCount = (photosQ.data?.before.length ?? 0) + (photosQ.data?.after.length ?? 0);
  const canEdit = rights.canEdit && row?.status === "COMPLETED";

  const setVerdict = (id: number, patch: Partial<Verdict>) => setVerdicts((v) => ({ ...v, [id]: { ...({ rating: null, note: "" } as Verdict), ...v[id], ...patch } }));
  const allRated = checkpoints.length > 0 && checkpoints.every((c) => !!verdicts[c.id!]?.rating);
  const anyPoor = checkpoints.some((c) => verdicts[c.id!]?.rating === "POOR");
  const decision: "APPROVED" | "REWORK" = anyPoor ? "REWORK" : "APPROVED";
  const hasCheckpoints = checkpoints.length > 0;
  const remarksMissing = decision === "REWORK" && remarks.trim().length < 3;
  const blocked = (hasCheckpoints && !allRated) || remarksMissing;

  const photo = useMutation({
    mutationFn: async () => {
      const uri = await takePhoto();
      if (!uri) return false;
      await uploadActivityPhoto(rungId, "after", uri, "QC inspection");
      return true;
    },
    onSuccess: (done) => { if (done) { toast.success("Photo added"); qc.invalidateQueries({ queryKey: ["cwd-photos", rungId] }); } },
    onError: (e: Error) => toast.error(e.message),
  });

  const decide = useMutation({
    mutationFn: () =>
      submitQcDecision(rungId, {
        decision,
        remarks: remarks.trim() || undefined,
        checks: checkpoints.map((c) => ({ checkpointId: c.id!, rating: (verdicts[c.id!]?.rating ?? "GOOD") as QcRating, note: verdicts[c.id!]?.note.trim() || undefined })),
      }),
    onSuccess: () => {
      toast.success(decision === "APPROVED" ? "Activity approved" : "Sent back for rework as a new attempt");
      for (const k of ["cwd-activities", "cwd-room", "cwd-scope-summary", "cwd-alerts", "cwd-dashboard"]) qc.invalidateQueries({ queryKey: [k] });
      qc.invalidateQueries({ queryKey: ["cwd-row", rungId] });
      qc.invalidateQueries({ queryKey: ["cwd-detail", rungId] });
      navigation.goBack();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (rowQ.isLoading || detailQ.isLoading) return <View style={{ flex: 1, backgroundColor: colors.background }}><SheetFrame still><View style={{ padding: 16 }}><Skel h={18} w="40%" /><Skel h={30} /><Skel h={160} /></View></SheetFrame></View>;
  if (detailQ.error || !a) return <View style={{ flex: 1, backgroundColor: colors.background, padding: 16 }}><Notice>{(detailQ.error as Error)?.message || "This activity has no allocation yet."}</Notice></View>;

  const shown = row ? displayStatus(row.status, row.resumedAt) : "";
  const previous = (histQ.data ?? []).slice(0, 3);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ paddingBottom: 96 }} keyboardShouldPersistTaps="handled">
      <SheetFrame still>
        {/* Title block: what is being inspected, where, by whom, when. */}
        <View style={{ paddingHorizontal: 16, paddingTop: 20, paddingBottom: 16, gap: 8 }}>
          <Label>{[row?.projectName, "Quality Check"].filter(Boolean).join(" · ")}</Label>
          <TitleText size={24}>{`${row?.sequenceNo != null ? `${row.sequenceNo}. ` : ""}${row?.activityName ?? "Activity"}`}</TitleText>
          {!!row?.scopePath && <Body size={12.5} color={S.ink2}>{row.scopePath}</Body>}
          {!!shown && <StatusPill status={shown} size="md" />}
          <View style={{ marginTop: 6 }}>
            <InfoGrid items={[{ label: "Engineer", value: row?.engineerNames || "—", wide: true }, { label: "Start", value: fmtDate(a.startDate) }, { label: "End", value: fmtDate(a.endDate) }]} />
          </View>
          <View style={{ marginTop: 8 }}>
            <LinkLabel onPress={() => navigation.navigate("ActivityDetail", { rungId })}>Open the full activity</LinkLabel>
          </View>
        </View>

        {previous.length > 0 && (
          <Detail tag="!" title="Previous QC" note={`${previous.length} shown`}>
            {previous.map((h) => (
              <View key={h.id} style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: S.ruleSoft }}>
                <Text style={{ fontSize: 13, fontFamily: fonts.body.regular, color: S.ink }}>
                  <Text style={{ fontFamily: fonts.heading.semibold, color: h.decision === "APPROVED" ? S.blue : S.red }}>{h.decision === "APPROVED" ? "Approved" : "Rework"}</Text>
                  {` · ${fmtDate(h.qcAt)}${h.qcBy ? ` · ${h.qcBy}` : ""}${h.remarks ? ` — ${h.remarks}` : ""}`}
                </Text>
              </View>
            ))}
          </Detail>
        )}

        <Detail tag="A" title="Checklist sign-off" note={`${checkpoints.length} checkpoint${checkpoints.length === 1 ? "" : "s"}`}>
          {!hasCheckpoints ? (
            <Body size={13} color={S.graphite}>This activity has no checkpoints, so it can be approved directly.</Body>
          ) : (
            <View style={{ borderTopWidth: 1, borderTopColor: S.ink }}>
              {checkpoints.map((c) => {
                const id = c.id!;
                const v = verdicts[id];
                return (
                  <View key={id} style={{ paddingVertical: 12, gap: 9, borderBottomWidth: 1, borderBottomColor: S.ruleSoft }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <Text style={{ flex: 1, fontSize: 13.5, fontFamily: fonts.body.semibold, color: S.ink }}>{c.fieldName}</Text>
                      {c.isChecked && <Label color={S.blue}>Engineer ticked</Label>}
                    </View>
                    {/* Poor / Good / Excellent as one segmented key: the chosen rating filled (Poor in red). */}
                    <View style={{ flexDirection: "row", borderWidth: 1, borderColor: S.ink }}>
                      {RATINGS.map((r, i) => {
                        const on = v?.rating === r.key;
                        const fill = r.key === "POOR" ? S.red : S.ink;
                        return (
                          <Press
                            key={r.key}
                            disabled={!canEdit}
                            onPress={() => setVerdict(id, { rating: r.key })}
                            style={(pressed) => ({ flex: 1, alignItems: "center", paddingVertical: 10, borderLeftWidth: i ? 1 : 0, borderLeftColor: S.ink, backgroundColor: on ? fill : pressed ? S.blueWash : "transparent" })}
                          >
                            <Text style={{ fontSize: 10.5, letterSpacing: 1.1, textTransform: "uppercase", fontFamily: fonts.heading.semibold, color: on ? (r.key === "POOR" ? "#ffffff" : S.paper) : S.graphite }}>{r.label}</Text>
                          </Press>
                        );
                      })}
                    </View>
                    {v?.rating === "POOR" && (
                      <Input value={v.note} onChangeText={(t) => setVerdict(id, { note: t })} editable={canEdit} placeholder="What's wrong? (optional note)" />
                    )}
                  </View>
                );
              })}
            </View>
          )}
        </Detail>

        <Detail tag="B" title="Photo & remarks" note={`${photoCount} photo${photoCount === 1 ? "" : "s"}`}>
          <View style={{ gap: 12 }}>
            {canEdit && <Btn tone="outline" label="Attach photo" icon={<Camera size={14} color={S.ink} />} busy={photo.isPending} onPress={() => photo.mutate()} />}
            <View style={{ gap: 6 }}>
              <Label>Remarks</Label>
              <Input value={remarks} onChangeText={setRemarks} editable={canEdit} multiline maxLength={1000} placeholder="Required when sending back for rework" style={{ minHeight: 76, paddingTop: 10, textAlignVertical: "top" }} />
            </View>
          </View>
        </Detail>

        <Detail tag="C" title="Decision">
          <View style={{ gap: 12 }}>
            {hasCheckpoints && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderWidth: 1, borderColor: anyPoor ? S.red : S.blue, backgroundColor: anyPoor ? S.redWash : S.blueWash }}>
                {anyPoor ? <AlertTriangle size={14} color={S.red} /> : <CheckCircle2 size={14} color={S.blue} />}
                <Text style={{ flex: 1, fontSize: 13, fontFamily: fonts.body.medium, color: anyPoor ? S.red : S.ink }}>
                  {anyPoor ? "One or more checkpoints rated Poor — this will be sent back for Rework." : allRated ? "Every checkpoint rated Good or better — ready to Approve." : "Rate every checkpoint to continue."}
                </Text>
              </View>
            )}
            {canEdit ? (
              <Btn
                tone={decision === "REWORK" ? "danger" : "accent"}
                label={decision === "REWORK" ? "Send for rework" : "Approve"}
                icon={decision === "REWORK" ? <RotateCcw size={14} color="#ffffff" /> : <CheckCircle2 size={14} color={S.paper} />}
                disabled={blocked}
                busy={decide.isPending}
                onPress={() => decide.mutate()}
              />
            ) : (
              <Body size={13} color={S.graphite} style={{ textAlign: "center" }}>
                {row?.status === "COMPLETED" ? "You can view this inspection but not submit it." : "This activity is no longer waiting for Quality Check."}
              </Body>
            )}
            {!!remarksMissing && canEdit && <Body size={12} color={S.red} style={{ textAlign: "center" }}>Add a remark explaining the rework.</Body>}
          </View>
        </Detail>
      </SheetFrame>
    </ScrollView>
  );
}
