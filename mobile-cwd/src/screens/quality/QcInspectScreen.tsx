// Inspect one completed activity: rate every checkpoint Poor / Good / Excellent (a note for a Poor one), attach
// a photo, add remarks, and submit. The decision isn't picked by hand — it follows the ratings: any Poor sends
// the activity back for rework as a new attempt (remarks required), otherwise it is approved.
import { useState } from "react";
import { ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { AlertTriangle, Camera, CheckCircle2, MapPin, RotateCcw } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { toast } from "@/components/Toast";
import { StatusPill, displayStatus } from "@/components/StatusPill";
import { usePageRights } from "@/hooks/usePageRights";
import {
  getActivityAssignment, getActivityPhotos, getQcHistory, getRungDetail, submitQcDecision, uploadActivityPhoto, type QcRating,
} from "@/api/cwdApi";
import type { MainStackParamList } from "@/navigation/MainStack";
import { ACCENT, Btn, ErrorText, Loading, card, takePhoto } from "../activities/tabs/ui";

const RATINGS: { key: QcRating; label: string; color: string }[] = [
  { key: "POOR", label: "Poor", color: "#d946ef" },
  { key: "GOOD", label: "Good", color: "#10b981" },
  { key: "EXCELLENT", label: "Excellent", color: "#14b8a6" },
];
type Verdict = { rating: QcRating | null; note: string };
const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");

function Label({ children }: { children: string }) {
  return <Text style={{ fontSize: 10, fontFamily: fonts.heading.bold, color: colors.mutedForeground, textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 8 }}>{children}</Text>;
}

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

  if (rowQ.isLoading || detailQ.isLoading) return <View style={{ flex: 1, backgroundColor: colors.background }}><Loading /></View>;
  if (detailQ.error || !a) return <View style={{ flex: 1, backgroundColor: colors.background, padding: 24 }}><ErrorText error={detailQ.error || new Error("This activity has no allocation yet.")} /></View>;

  const shown = row ? displayStatus(row.status, row.resumedAt) : "";
  const previous = (histQ.data ?? []).slice(0, 3);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: 16, paddingBottom: 96, gap: 18 }} keyboardShouldPersistTaps="handled">
      <View style={card}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
          <Text style={{ flex: 1, fontSize: 15, fontFamily: fonts.heading.bold, color: colors.foreground }}>{row?.sequenceNo != null ? `${row.sequenceNo}. ` : ""}{row?.activityName ?? "Activity"}</Text>
          {!!shown && <StatusPill status={shown} size="md" />}
        </View>
        {!!row?.scopePath && (
          <View style={{ flexDirection: "row", gap: 5, marginTop: 5, alignItems: "flex-start" }}>
            <MapPin size={11} color={colors.mutedForeground} style={{ marginTop: 2 }} />
            <Text style={{ flex: 1, fontSize: 11, fontFamily: fonts.body.regular, color: colors.mutedForeground }}>{[row.projectName, row.scopePath].filter(Boolean).join(" > ")}</Text>
          </View>
        )}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
          {[["Engineer", row?.engineerNames || "—"], ["Start", fmtDate(a.startDate)], ["End", fmtDate(a.endDate)]].map(([k, v]) => (
            <View key={k} style={{ flexGrow: 1, minWidth: "30%", paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10, backgroundColor: colors.muted }}>
              <Text style={{ fontSize: 9, fontFamily: fonts.heading.bold, color: colors.mutedForeground, textTransform: "uppercase", letterSpacing: 1 }}>{k}</Text>
              <Text numberOfLines={1} style={{ fontSize: 12, fontFamily: fonts.body.medium, color: colors.foreground, marginTop: 1 }}>{v}</Text>
            </View>
          ))}
        </View>
        <TouchableOpacity onPress={() => navigation.navigate("ActivityDetail", { rungId })} style={{ marginTop: 10 }}>
          <Text style={{ fontSize: 11.5, fontFamily: fonts.heading.semibold, color: ACCENT }}>Open the full activity (photos, daily log, attendance) →</Text>
        </TouchableOpacity>
      </View>

      {previous.length > 0 && (
        <View style={{ borderRadius: 14, borderWidth: 1, borderColor: "#f59e0b55", backgroundColor: "#f59e0b0d", padding: 12, gap: 5 }}>
          <Text style={{ fontSize: 10, fontFamily: fonts.heading.bold, color: "#f59e0b", textTransform: "uppercase", letterSpacing: 1.2 }}>Previous QC</Text>
          {previous.map((h) => (
            <Text key={h.id} style={{ fontSize: 12, fontFamily: fonts.body.regular, color: colors.foreground }}>
              <Text style={{ fontFamily: fonts.heading.semibold }}>{h.decision === "APPROVED" ? "Approved" : "Rework"}</Text>
              {` · ${fmtDate(h.qcAt)}${h.qcBy ? ` · ${h.qcBy}` : ""}${h.remarks ? ` — ${h.remarks}` : ""}`}
            </Text>
          ))}
        </View>
      )}

      <View>
        <Label>{`Checklist sign-off (${checkpoints.length})`}</Label>
        {!hasCheckpoints ? (
          <Text style={{ fontSize: 12, fontFamily: fonts.body.regular, color: colors.mutedForeground }}>This activity has no checkpoints, so it can be approved directly.</Text>
        ) : (
          <View style={{ ...card, padding: 0, overflow: "hidden" }}>
            {checkpoints.map((c, i) => {
              const id = c.id!;
              const v = verdicts[id];
              return (
                <View key={id} style={{ padding: 12, gap: 8, borderTopWidth: i ? 1 : 0, borderTopColor: colors.border }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Text style={{ flex: 1, fontSize: 13, fontFamily: fonts.body.medium, color: colors.foreground }}>{c.fieldName}</Text>
                    {c.isChecked && <Text style={{ fontSize: 10, color: "#10b981", fontFamily: fonts.body.medium }}>Engineer ticked</Text>}
                  </View>
                  <View style={{ flexDirection: "row", gap: 6 }}>
                    {RATINGS.map((r) => {
                      const on = v?.rating === r.key;
                      return (
                        <TouchableOpacity key={r.key} disabled={!canEdit} onPress={() => setVerdict(id, { rating: r.key })} style={{ flex: 1, alignItems: "center", paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: on ? r.color : colors.border, backgroundColor: on ? `${r.color}25` : "transparent" }}>
                          <Text style={{ fontSize: 11.5, fontFamily: fonts.heading.semibold, color: on ? r.color : colors.mutedForeground }}>{r.label}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                  {v?.rating === "POOR" && (
                    <TextInput value={v.note} onChangeText={(t) => setVerdict(id, { note: t })} editable={canEdit} placeholder="What's wrong? (optional note)" placeholderTextColor={`${colors.mutedForeground}99`} style={{ color: colors.foreground, fontFamily: fonts.body.regular, fontSize: 12.5, borderWidth: 1, borderColor: "#d946ef55", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 }} />
                  )}
                </View>
              );
            })}
          </View>
        )}
      </View>

      {canEdit && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <View style={{ flex: 1 }}><Btn tone="outline" label="Attach photo" icon={<Camera size={14} color={ACCENT} />} busy={photo.isPending} onPress={() => photo.mutate()} /></View>
          <Text style={{ flex: 1, fontSize: 11.5, color: colors.mutedForeground, fontFamily: fonts.body.regular }}>{photoCount} photo{photoCount === 1 ? "" : "s"} on this activity</Text>
        </View>
      )}

      <View>
        <Label>Remarks</Label>
        <TextInput value={remarks} onChangeText={setRemarks} editable={canEdit} multiline maxLength={1000} placeholder="Required when sending back for rework" placeholderTextColor={`${colors.mutedForeground}99`} style={{ minHeight: 70, textAlignVertical: "top", color: colors.foreground, fontFamily: fonts.body.regular, fontSize: 13, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, borderRadius: 12, padding: 12 }} />
      </View>

      {hasCheckpoints && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 12, padding: 12, backgroundColor: anyPoor ? "#d946ef1a" : "#10b9811a" }}>
          {anyPoor ? <AlertTriangle size={14} color="#d946ef" /> : <CheckCircle2 size={14} color="#10b981" />}
          <Text style={{ flex: 1, fontSize: 12, fontFamily: fonts.body.medium, color: anyPoor ? "#d946ef" : "#10b981" }}>
            {anyPoor ? "One or more checkpoints rated Poor — this will be sent back for Rework." : allRated ? "Every checkpoint rated Good or better — ready to Approve." : "Rate every checkpoint to continue."}
          </Text>
        </View>
      )}

      {canEdit ? (
        <Btn
          label={decision === "REWORK" ? "Send for rework" : "Approve"}
          icon={decision === "REWORK" ? <RotateCcw size={14} color="#04181d" /> : <CheckCircle2 size={14} color="#04181d" />}
          disabled={blocked}
          busy={decide.isPending}
          onPress={() => decide.mutate()}
        />
      ) : (
        <Text style={{ fontSize: 12, fontFamily: fonts.body.regular, color: colors.mutedForeground, textAlign: "center" }}>
          {row?.status === "COMPLETED" ? "You can view this inspection but not submit it." : "This activity is no longer waiting for Quality Check."}
        </Text>
      )}
      {!!remarksMissing && canEdit && <Text style={{ fontSize: 11, color: colors.mutedForeground, textAlign: "center", fontFamily: fonts.body.regular }}>Add a remark explaining the rework.</Text>}
    </ScrollView>
  );
}
