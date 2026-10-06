// One activity: who and what it's allocated to, its checkpoints (a checkpoint Quality Check rated
// Poor last time blinks until it's redone), and the actions on it — add a remark (several a day are
// fine, each is its own entry), hold / resume, move the progress bar forward, and — for a Completed
// activity — Quality Check each checkpoint and pass it or send it back for rework.
import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, PauseCircle, PlayCircle, Save, ShieldCheck } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { StatusPill, displayStatus } from "@/components/StatusPill";
import { usePageRights } from "@/hooks/usePageRights";
import {
  getActivityAssignment,
  getProgressLog,
  getRungDetail,
  timelineMessage,
  updateAssignment,
} from "@/api/cwdApi";
import type { MainStackParamList } from "@/navigation/MainStack";
import { PhotosTab } from "./tabs/PhotosTab";
import { AttendanceTab } from "./tabs/AttendanceTab";
import { CheckpointsTab } from "./tabs/CheckpointsTab";
import { DailyLogTab } from "./tabs/DailyLogTab";
import { CommentsTab } from "./tabs/CommentsTab";
import { HistoryTab } from "./tabs/HistoryTab";

type Tab = "overview" | "photos" | "attendance" | "checkpoints" | "daily-log" | "comments" | "history";
const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "photos", label: "Photos" },
  { id: "attendance", label: "Attendance" },
  { id: "checkpoints", label: "Checkpoints" },
  { id: "daily-log", label: "Daily Log" },
  { id: "comments", label: "Comments" },
  { id: "history", label: "History" },
];

const ACCENT = "#0891b2";
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: 18 }}>
      <Text style={{ fontSize: 10, fontFamily: fonts.heading.bold, color: colors.mutedForeground, textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 8 }}>
        {title}
      </Text>
      {children}
    </View>
  );
}

const card = { backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 14 } as const;

export default function ActivityDetailScreen() {
  const { rungId } = useRoute<RouteProp<MainStackParamList, "ActivityDetail">>().params;
  const qc = useQueryClient();
  const navigation = useNavigation<{ navigate: (name: string, params?: object) => void }>();
  const editRights = usePageRights("civilworkdpr-activity-reporting");
  const qcRights = usePageRights("civilworkdpr-quality-check");

  const rowQ = useQuery({ queryKey: ["cwd-row", rungId], queryFn: () => getActivityAssignment(rungId) });
  const detailQ = useQuery({ queryKey: ["cwd-detail", rungId], queryFn: () => getRungDetail(rungId) });
  const logQ = useQuery({ queryKey: ["cwd-log", rungId], queryFn: () => getProgressLog(rungId) });
  const row = rowQ.data ?? undefined;
  const a = detailQ.data?.assignment;

  const [tab, setTab] = useState<Tab>("overview");
  const [remark, setRemark] = useState("");
  const [progress, setProgress] = useState<number | null>(null);

  const saved = row?.progressPercent ?? 0;
  const shownProgress = progress ?? saved;
  const status = row?.status;
  const shown = status ? displayStatus(status, row?.resumedAt) : "";
  const hint = row ? timelineMessage(row) : null;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["cwd-room"] });
    qc.invalidateQueries({ queryKey: ["cwd-daily-log", rungId] });
    qc.invalidateQueries({ queryKey: ["cwd-scope-summary"] });
    qc.invalidateQueries({ queryKey: ["cwd-activities"] });
    qc.invalidateQueries({ queryKey: ["cwd-alerts"] });
    qc.invalidateQueries({ queryKey: ["cwd-row", rungId] });
    qc.invalidateQueries({ queryKey: ["cwd-detail", rungId] });
    qc.invalidateQueries({ queryKey: ["cwd-log", rungId] });
    qc.invalidateQueries({ queryKey: ["cwd-dashboard"] });
  };
  const onError = (e: unknown) => Alert.alert("Couldn't save", (e as Error).message);

  const addRemark = useMutation({
    mutationFn: () => updateAssignment(rungId, { remarks: remark.trim(), append: true }),
    onSuccess: () => { setRemark(""); refresh(); },
    onError,
  });
  const setStatus = useMutation({
    mutationFn: (s: "HOLD" | "IN_PROGRESS") => updateAssignment(rungId, { status: s }),
    onSuccess: refresh,
    onError,
  });
  const saveProgress = useMutation({
    mutationFn: () =>
      updateAssignment(rungId, { progressPercent: shownProgress, ...(shownProgress === 100 && status !== "COMPLETED" ? { status: "COMPLETED" as const } : {}) }),
    onSuccess: () => { setProgress(null); refresh(); },
    onError,
  });

  if (detailQ.isLoading || rowQ.isLoading) {
    return <View style={{ flex: 1, backgroundColor: colors.background, alignItems: "center", justifyContent: "center" }}><ActivityIndicator color={colors.mutedForeground} /></View>;
  }
  if (detailQ.error || !a) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, padding: 24 }}>
        <Text style={{ color: colors.destructive, fontFamily: fonts.body.regular, fontSize: 12 }}>{(detailQ.error as Error)?.message || "This activity has no allocation yet."}</Text>
      </View>
    );
  }

  const locked = status === "COMPLETED" || status === "APPROVED" || status === "CANCELLED";
  const canWork = editRights.canEdit && !locked;
  const canQc = qcRights.canEdit && status === "COMPLETED";

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: 16, paddingBottom: 96 }}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={false} onRefresh={refresh} tintColor={ACCENT} />}
    >
      <View style={{ ...card, marginBottom: 18 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
          <Text style={{ flex: 1, fontSize: 15, fontFamily: fonts.heading.bold, color: colors.foreground }}>{row?.activityName ?? "Activity"}</Text>
          {!!shown && <StatusPill status={shown} size="md" />}
        </View>
        {!!row?.scopePath && <Text style={{ fontSize: 11, fontFamily: fonts.body.regular, color: colors.mutedForeground, marginTop: 4 }}>{[row.projectName, row.scopePath].filter(Boolean).join(" · ")}</Text>}
        {!!hint && <Text style={{ fontSize: 11, fontFamily: fonts.body.medium, color: ACCENT, marginTop: 8 }}>{hint}</Text>}
        {(row?.attemptNo ?? 1) > 1 && <Text style={{ fontSize: 11, fontFamily: fonts.body.medium, color: "#d946ef", marginTop: 6 }}>Attempt {row?.attemptNo} — rework</Text>}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16, marginHorizontal: -16 }} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
        {TABS.map((x) => {
          const on = tab === x.id;
          return (
            <TouchableOpacity key={x.id} activeOpacity={0.7} onPress={() => setTab(x.id)} style={{ paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: on ? ACCENT : colors.border, backgroundColor: on ? `${ACCENT}22` : "transparent" }}>
              <Text style={{ fontSize: 11.5, fontFamily: fonts.heading.semibold, color: on ? ACCENT : colors.mutedForeground }}>{x.label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {tab === "photos" && <PhotosTab rungId={rungId} canAdd={canWork || canQc} />}
      {tab === "attendance" && <AttendanceTab rungId={rungId} canEdit={canWork} />}
      {tab === "checkpoints" && <CheckpointsTab rungId={rungId} canEdit={canWork} onChanged={refresh} />}
      {tab === "daily-log" && <DailyLogTab rungId={rungId} canEdit={canWork} />}
      {tab === "comments" && <CommentsTab rungId={rungId} />}
      {tab === "history" && <HistoryTab rungId={rungId} />}

      {tab === "overview" && (
        <>

      <Section title="Allocation">
        <View style={{ ...card, gap: 8 }}>
          {[
            ["Engineers", row?.engineerNames || "—"],
            ["Dates", `${a.startDate?.slice(0, 10) ?? "—"} → ${a.endDate?.slice(0, 10) ?? "—"}${a.days ? ` · ${a.days} days` : ""}`],
            ["Labour", [a.labourSourceName, a.labourSource].filter(Boolean).join(" · ") || "—"],
            ["Material", [a.materialSourceName, a.materialSource].filter(Boolean).join(" · ") || "—"],
          ].map(([k, v]) => (
            <View key={k} style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
              <Text style={{ fontSize: 11, fontFamily: fonts.body.regular, color: colors.mutedForeground }}>{k}</Text>
              <Text style={{ flex: 1, textAlign: "right", fontSize: 12, fontFamily: fonts.body.medium, color: colors.foreground }}>{v}</Text>
            </View>
          ))}
          {a.materials.length > 0 && (
            <View style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8, gap: 4 }}>
              {a.materials.map((m) => {
                const item = detailQ.data?.candidateItems.find((c) => c.itemId === m.itemId);
                return (
                  <View key={m.itemId} style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={{ fontSize: 12, fontFamily: fonts.body.regular, color: colors.foreground }}>{item?.itemName ?? m.itemId}</Text>
                    <Text style={{ fontSize: 12, fontFamily: fonts.body.medium, color: colors.mutedForeground }}>{m.quantity}{item?.uom ? ` ${item.uom}` : ""}</Text>
                  </View>
                );
              })}
            </View>
          )}
        </View>
      </Section>

      {canQc && (
        <Section title="Quality Check">
          <TouchableOpacity activeOpacity={0.8} onPress={() => navigation.navigate("QcInspect", { rungId })} style={{ ...card, flexDirection: "row", alignItems: "center", gap: 10, borderColor: `${ACCENT}66` }}>
            <ShieldCheck size={18} color={ACCENT} />
            <Text style={{ flex: 1, fontSize: 13, fontFamily: fonts.heading.semibold, color: colors.foreground }}>Inspect this activity</Text>
            <ChevronRight size={16} color={colors.mutedForeground} />
          </TouchableOpacity>
        </Section>
      )}

      {canWork && (
        <Section title="Work done">
          <View style={{ ...card, gap: 12 }}>
            <Text style={{ fontSize: 22, fontFamily: fonts.heading.bold, color: colors.foreground }}>{shownProgress}%</Text>
            <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.muted, overflow: "hidden" }}>
              <View style={{ width: `${shownProgress}%`, height: 6, backgroundColor: ACCENT }} />
            </View>
            <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
              {[5, 10, 25].map((n) => (
                <Pressable key={n} onPress={() => setProgress(Math.min(100, shownProgress + n))} style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, borderWidth: 1, borderColor: colors.border }}>
                  <Text style={{ fontSize: 12, fontFamily: fonts.heading.semibold, color: colors.foreground }}>+{n}%</Text>
                </Pressable>
              ))}
              <Pressable onPress={() => setProgress(100)} style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, borderWidth: 1, borderColor: ACCENT }}>
                <Text style={{ fontSize: 12, fontFamily: fonts.heading.semibold, color: ACCENT }}>Done 100%</Text>
              </Pressable>
              {progress != null && (
                <Pressable onPress={() => setProgress(null)} style={{ paddingHorizontal: 12, paddingVertical: 7 }}>
                  <Text style={{ fontSize: 12, color: colors.mutedForeground, fontFamily: fonts.body.medium }}>Reset</Text>
                </Pressable>
              )}
            </View>
            {progress != null && progress !== saved && (
              <Pressable disabled={saveProgress.isPending} onPress={() => saveProgress.mutate()} style={{ flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center", paddingVertical: 11, borderRadius: 12, backgroundColor: ACCENT }}>
                <Save size={14} color="#04181d" />
                <Text style={{ fontFamily: fonts.heading.bold, color: "#04181d", fontSize: 12 }}>{shownProgress === 100 ? "Save — send to Quality Check" : "Save progress"}</Text>
              </Pressable>
            )}
            {(status === "IN_PROGRESS" || status === "HOLD" || status === "ALLOCATED" || status === "PENDING") && (
              <Pressable disabled={setStatus.isPending} onPress={() => setStatus.mutate(status === "HOLD" ? "IN_PROGRESS" : "HOLD")} style={{ flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center", paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: status === "HOLD" ? "#14b8a6" : "#f59e0b" }}>
                {status === "HOLD" ? <PlayCircle size={14} color="#14b8a6" /> : <PauseCircle size={14} color="#f59e0b" />}
                <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 12, color: status === "HOLD" ? "#14b8a6" : "#f59e0b" }}>{status === "HOLD" ? "Resume work" : "Put on hold"}</Text>
              </Pressable>
            )}
          </View>
        </Section>
      )}

      <Section title="Remarks & updates">
        <View style={{ ...card, gap: 10 }}>
          {editRights.canEdit && (
            <>
              <TextInput value={remark} onChangeText={setRemark} placeholder="Add a remark…" placeholderTextColor={`${colors.mutedForeground}99`} multiline style={{ color: colors.foreground, fontFamily: fonts.body.regular, fontSize: 13, minHeight: 44, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 10 }} />
              <Pressable disabled={!remark.trim() || addRemark.isPending} onPress={() => addRemark.mutate()} style={{ alignItems: "center", paddingVertical: 10, borderRadius: 12, backgroundColor: ACCENT, opacity: !remark.trim() || addRemark.isPending ? 0.4 : 1 }}>
                <Text style={{ fontFamily: fonts.heading.bold, color: "#04181d", fontSize: 12 }}>Add remark</Text>
              </Pressable>
            </>
          )}
          {(logQ.data ?? []).slice(0, 15).map((e) => (
            <View key={e.id} style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={{ fontSize: 11, fontFamily: fonts.body.medium, color: colors.foreground }}>
                  {e.fromProgressPercent != null && e.toProgressPercent != null ? `${e.fromProgressPercent}% → ${e.toProgressPercent}%` : "Remark"}
                </Text>
                <Text style={{ fontSize: 10, fontFamily: fonts.body.regular, color: colors.mutedForeground }}>
                  {new Date(e.loggedAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}{e.loggedBy ? ` · ${e.loggedBy}` : ""}
                </Text>
              </View>
              {!!e.remarks && <Text style={{ fontSize: 12.5, fontFamily: fonts.body.regular, color: colors.foreground, marginTop: 3 }}>{e.remarks}</Text>}
            </View>
          ))}
        </View>
      </Section>
        </>
      )}
    </ScrollView>
  );
}
