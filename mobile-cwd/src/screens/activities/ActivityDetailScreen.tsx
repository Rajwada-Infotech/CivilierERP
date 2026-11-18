// One activity: who and what it's allocated to, its checkpoints (a checkpoint Quality Check rated
// Poor last time blinks until it's redone), and the actions on it — add a remark (several a day are
// fine, each is its own entry), hold / resume, move the progress bar forward, and — for a Completed
// activity — Quality Check each checkpoint and pass it or send it back for rework.
import { useState } from "react";
import { Alert, RefreshControl, ScrollView, Text, View } from "react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, PauseCircle, PlayCircle, Save, ShieldCheck } from "lucide-react-native";
import { colors, sheet as S } from "@/theme/colors";
import { Body, Detail, Figure, Grow, InfoGrid, Input, Key, Label, Notice, Press, SheetFrame, Skel, TitleText } from "@/components/sheet/Sheet";
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
import { TagField } from "@/components/TagField";

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
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <SheetFrame still>
          <View style={{ padding: 16 }}><Skel h={18} w="40%" /><Skel h={30} /><Skel h={60} /><Skel h={120} /></View>
        </SheetFrame>
      </View>
    );
  }
  if (detailQ.error || !a) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, padding: 16 }}>
        <Notice>{(detailQ.error as Error)?.message || "This activity has no allocation yet."}</Notice>
      </View>
    );
  }

  const locked = status === "COMPLETED" || status === "APPROVED" || status === "CANCELLED";
  const canWork = editRights.canEdit && !locked;
  const canQc = qcRights.canEdit && status === "COMPLETED";
  const log = logQ.data ?? [];
  const remarksTag = String.fromCharCode(67 + (canQc ? 1 : 0) + (canWork ? 1 : 0));

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ paddingBottom: 96 }}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={false} onRefresh={refresh} tintColor={S.ink} />}
    >
      <SheetFrame>
        {/* Title block: where it is, what it is, its status, the timeline hint. */}
        <View style={{ paddingHorizontal: 16, paddingTop: 20, paddingBottom: 16, gap: 8 }}>
          <Label>{[row?.projectName, "Activity"].filter(Boolean).join(" · ")}</Label>
          <TitleText size={24}>{row?.activityName ?? "Activity"}</TitleText>
          {!!row?.scopePath && <Body size={12.5} color={S.ink2}>{row.scopePath}</Body>}
          <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 12, marginTop: 2 }}>
            {!!shown && <StatusPill status={shown} size="md" />}
            {(row?.attemptNo ?? 1) > 1 && <Label color={S.red}>Attempt {row?.attemptNo} · rework</Label>}
          </View>
          {!!hint && <Body size={12} color={S.blue} weight="medium">{hint}</Body>}
        </View>

        {/* The parts of the activity, as keys along an ink rule: the open one filled ink. */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ borderTopWidth: 1, borderBottomWidth: 1, borderColor: S.ink }}>
          {TABS.map((x, i) => {
            const on = tab === x.id;
            return (
              <Press
                key={x.id}
                onPress={() => setTab(x.id)}
                style={(pressed) => ({ paddingHorizontal: 14, paddingVertical: 11, borderLeftWidth: i ? 1 : 0, borderLeftColor: S.rule, backgroundColor: on ? S.ink : pressed ? S.blueWash : "transparent" })}
              >
                <Text style={{ fontSize: 10, letterSpacing: 1.2, textTransform: "uppercase", fontFamily: fonts.heading.semibold, color: on ? S.paper : S.graphite }}>{x.label}</Text>
              </Press>
            );
          })}
        </ScrollView>

        {tab !== "overview" && (
          <View style={{ padding: 14 }}>
            {tab === "photos" && <PhotosTab rungId={rungId} canAdd={canWork || canQc} />}
            {tab === "attendance" && <AttendanceTab rungId={rungId} canEdit={canWork} />}
            {tab === "checkpoints" && <CheckpointsTab rungId={rungId} canEdit={canWork} onChanged={refresh} />}
            {tab === "daily-log" && <DailyLogTab rungId={rungId} canEdit={canWork} />}
            {tab === "comments" && <CommentsTab rungId={rungId} />}
            {tab === "history" && <HistoryTab rungId={rungId} />}
          </View>
        )}

        {tab === "overview" && (
          <Detail tag="A" title="Allocation" style={{ borderTopWidth: 0 }}>
            <InfoGrid
              items={[
                { label: "Engineers", value: row?.engineerNames || "—", wide: true },
                { label: "Dates", value: `${a.startDate?.slice(0, 10) ?? "—"} → ${a.endDate?.slice(0, 10) ?? "—"}${a.days ? ` · ${a.days} days` : ""}`, wide: true },
                { label: "Labour", value: [a.labourSourceName, a.labourSource].filter(Boolean).join(" · ") || "—" },
                { label: "Material", value: [a.materialSourceName, a.materialSource].filter(Boolean).join(" · ") || "—" },
              ]}
            />
            {a.materials.length > 0 && (
              <View style={{ marginTop: 14 }}>
                <View style={{ flexDirection: "row", paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: S.ink }}>
                  <Label style={{ flex: 1 }}>Material</Label>
                  <Label>Quantity</Label>
                </View>
                {a.materials.map((m) => {
                  const item = detailQ.data?.candidateItems.find((c) => c.itemId === m.itemId);
                  return (
                    <View key={m.itemId} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: S.ruleSoft }}>
                      <Body size={13}>{item?.itemName ?? m.itemId}</Body>
                      <Text style={{ fontSize: 13, fontFamily: fonts.heading.medium, color: S.ink, fontVariant: ["tabular-nums"] }}>{m.quantity}{item?.uom ? ` ${item.uom}` : ""}</Text>
                    </View>
                  );
                })}
              </View>
            )}
          </Detail>
        )}

        {tab === "overview" && (
          <Detail tag="B" title="Tag">
            <TagField rungId={rungId} current={row?.tagName} canEdit={editRights.canEdit} onSaved={refresh} />
          </Detail>
        )}

        {tab === "overview" && canQc && (
          <Detail tag="C" title="Quality Check">
            <Press
              onPress={() => navigation.navigate("QcInspect", { rungId })}
              style={(pressed) => ({ flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderWidth: 1.5, borderColor: S.blue, backgroundColor: pressed ? S.blueTint : S.blueWash })}
            >
              <ShieldCheck size={18} color={S.blue} />
              <Text style={{ flex: 1, fontSize: 13.5, fontFamily: fonts.heading.semibold, color: S.ink }}>Inspect this activity</Text>
              <ChevronRight size={16} color={S.graphite} />
            </Press>
          </Detail>
        )}

        {tab === "overview" && canWork && (
          <Detail tag={canQc ? "D" : "C"} title="Work done" note={progress != null && progress !== saved ? "Not saved" : undefined}>
            <Figure size={40}>{shownProgress}%</Figure>
            <View style={{ marginTop: 12, height: 14, borderWidth: 1.5, borderColor: S.ink, backgroundColor: S.paper }}>
              <Grow style={{ height: "100%", width: `${shownProgress}%`, backgroundColor: shownProgress === 100 ? S.blue : S.ink }} />
            </View>
            <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap", marginTop: 14 }}>
              {[5, 10, 25].map((n) => (
                <Key key={n} label={`+${n}%`} onPress={() => setProgress(Math.min(100, shownProgress + n))} style={{ minHeight: 38, paddingHorizontal: 12 }} />
              ))}
              <Key label="Done 100%" onPress={() => setProgress(100)} style={{ minHeight: 38, paddingHorizontal: 12, borderColor: S.blue }} />
              {progress != null && <Key label="Reset" onPress={() => setProgress(null)} style={{ minHeight: 38, paddingHorizontal: 12, borderColor: S.rule }} />}
            </View>
            {progress != null && progress !== saved && (
              <Key
                tone="ink"
                label={saveProgress.isPending ? "Saving…" : shownProgress === 100 ? "Save — send to Quality Check" : "Save progress"}
                icon={<Save size={14} color={S.paper} />}
                disabled={saveProgress.isPending}
                onPress={() => saveProgress.mutate()}
                style={{ marginTop: 12 }}
              />
            )}
            {(status === "IN_PROGRESS" || status === "HOLD" || status === "ALLOCATED" || status === "PENDING") && (
              <Key
                label={status === "HOLD" ? "Resume work" : "Put on hold"}
                icon={status === "HOLD" ? <PlayCircle size={14} color={S.ink} /> : <PauseCircle size={14} color={S.ink} />}
                disabled={setStatus.isPending}
                onPress={() => setStatus.mutate(status === "HOLD" ? "IN_PROGRESS" : "HOLD")}
                style={{ marginTop: 10 }}
              />
            )}
          </Detail>
        )}

        {tab === "overview" && (
          <Detail tag={remarksTag} title="Remarks & updates" note={log.length ? `${log.length} in all` : undefined}>
            {editRights.canEdit && (
              <View style={{ gap: 10, marginBottom: 12 }}>
                <Input value={remark} onChangeText={setRemark} placeholder="Add a remark…" multiline style={{ minHeight: 64, paddingTop: 10, textAlignVertical: "top" }} />
                <Key tone="ink" label={addRemark.isPending ? "Adding…" : "Add remark"} disabled={!remark.trim() || addRemark.isPending} onPress={() => addRemark.mutate()} />
              </View>
            )}
            {log.length === 0 ? (
              <Body size={13} color={S.graphite}>No remarks or progress updates yet.</Body>
            ) : (
              <View style={{ borderTopWidth: 1, borderTopColor: S.ink }}>
                {log.slice(0, 15).map((e) => (
                  <View key={e.id} style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: S.ruleSoft, gap: 3 }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 10 }}>
                      <Text style={{ fontSize: 12.5, fontFamily: fonts.heading.semibold, color: S.ink, fontVariant: ["tabular-nums"] }}>
                        {e.fromProgressPercent != null && e.toProgressPercent != null ? `${e.fromProgressPercent}% → ${e.toProgressPercent}%` : "Remark"}
                      </Text>
                      <Text style={{ fontSize: 11, fontFamily: fonts.body.regular, color: S.graphite }}>
                        {new Date(e.loggedAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}{e.loggedBy ? ` · ${e.loggedBy}` : ""}
                      </Text>
                    </View>
                    {!!e.remarks && <Body size={13}>{e.remarks}</Body>}
                  </View>
                ))}
              </View>
            )}
          </Detail>
        )}
      </SheetFrame>
    </ScrollView>
  );
}
