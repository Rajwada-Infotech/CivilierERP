// The interactive checklist: tick a checkpoint off (blocked until its wait days after the start date have
// passed — same rule the server enforces), and for "daily" checkpoints log one photo update per day.
// A checkpoint Quality Check rated Poor last time blinks until it's ticked again.
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Animated, ScrollView, Text, TextInput, TouchableOpacity, View, type ScrollViewInstance } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, CalendarDays, Check, RotateCcw, Timer, Trash2 } from "lucide-react-native";
import { sheet as S } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { toast } from "@/components/Toast";
import { useCanDeleteDprWork } from "@/hooks/usePageRights";
import {
  deleteCheckpointUpdate, getCheckpointUpdates, getRungDetail, saveCheckpointUpdate, saveCheckpoints,
  type RungCheckpoint,
} from "@/api/cwdApi";
import { ACCENT, AuthImage, Btn, Empty, ErrorText, Loading, card, fmtDay, fromYmd, takePhoto, todayYmd, ymd } from "./ui";

function Blink({ on, children }: { on: boolean; children: React.ReactNode }) {
  const v = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!on) { v.setValue(1); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 0.35, duration: 550, useNativeDriver: true }),
      Animated.timing(v, { toValue: 1, duration: 550, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [on, v]);
  return <Animated.View style={{ opacity: v }}>{children}</Animated.View>;
}

/** "15:42" -> "03:42 pm" */
const fmtTime = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return hhmm;
  return `${String(h % 12 || 12).padStart(2, "0")}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
};
const addDays = (s: string, n: number) => { const d = fromYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
const diffDays = (a: string, b: string) => Math.round((fromYmd(b).getTime() - fromYmd(a).getTime()) / 86_400_000);

function DailyUpdates({ checkpointId, canEdit }: { checkpointId: number; canEdit: boolean }) {
  const canDelete = useCanDeleteDprWork();
  const qc = useQueryClient();
  const today = useMemo(() => todayYmd(), []);
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");
  const key = ["cwd-cp-updates", checkpointId];
  const q = useQuery({ queryKey: key, queryFn: () => getCheckpointUpdates(checkpointId) });
  const byDate = useMemo(() => new Map((q.data ?? []).map((u) => [u.date.slice(0, 10), u])), [q.data]);
  const current = byDate.get(date);

  // Every day from the start date (or the last 14) up to today, newest last, so the strip lands on today.
  // Locked to today: a daily update is a same-day record (the server enforces it too).
  const days = useMemo(() => [today], [today]);
  const strip = useRef<ScrollViewInstance>(null);

  const save = useMutation({
    mutationFn: async () => {
      const photoUri = await takePhoto();
      if (!photoUri) return false;
      await saveCheckpointUpdate(checkpointId, { date, photoUri, note: note.trim() || undefined });
      return true;
    },
    onSuccess: (done) => { if (done) { toast.success(`Update for ${fmtDay(date)} saved`); setNote(""); qc.invalidateQueries({ queryKey: key }); } },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: (id: number) => deleteCheckpointUpdate(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <View style={{ marginTop: 8, borderRadius: 0, borderWidth: 1, borderStyle: "dashed", borderColor: S.blueTint, backgroundColor: S.blueWash, padding: 10, gap: 10 }}>
      <ScrollView ref={strip} horizontal showsHorizontalScrollIndicator={false} onContentSizeChange={() => strip.current?.scrollToEnd({ animated: false })} contentContainerStyle={{ gap: 6 }}>
        {days.map((d) => {
          const on = d === date;
          const logged = byDate.has(d);
          const dt = fromYmd(d);
          return (
            <TouchableOpacity key={d} onPress={() => setDate(d)} style={{ width: 42, paddingVertical: 6, borderRadius: 0, alignItems: "center", borderWidth: 1, borderColor: on ? ACCENT : logged ? S.blue : S.rule, backgroundColor: on ? S.blueWash : logged ? S.blueWash : "transparent" }}>
              <Text style={{ fontSize: 9, fontFamily: fonts.body.regular, color: S.graphite }}>{dt.toLocaleDateString("en-IN", { month: "short" })}</Text>
              <Text style={{ fontSize: 13, fontFamily: fonts.heading.bold, color: on ? ACCENT : S.ink }}>{dt.getDate()}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
      <Text style={{ fontSize: 11, fontFamily: fonts.body.medium, color: S.graphite }}>
        Today · {fmtDay(date)}{current?.loggedTime ? ` · logged at ${fmtTime(current.loggedTime)}` : ""} · {(q.data ?? []).length} day{(q.data ?? []).length === 1 ? "" : "s"} logged
      </Text>

      {canEdit && (
        <>
          <TextInput value={note} onChangeText={setNote} maxLength={500} placeholder="Note for this photo (optional)" placeholderTextColor={S.faint} style={{ color: S.ink, fontFamily: fonts.body.regular, fontSize: 12.5, borderWidth: 1, borderColor: S.rule, borderRadius: 0, paddingHorizontal: 10, paddingVertical: 8 }} />
          <Btn label={current?.hasPhoto ? "Retake photo" : "Take photo"} icon={<Camera size={13} color={S.paper} />} busy={save.isPending} onPress={() => save.mutate()} />
        </>
      )}

      {current && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          {current.hasPhoto && <AuthImage path={`/api/dependency-activity-assignment/checkpoint-update/${current.id}/photo`} style={{ width: 72, height: 54, borderRadius: 0, borderWidth: 1, borderColor: S.rule }} />}
          <View style={{ flex: 1 }}>
            {!!current.note && <Text numberOfLines={2} style={{ fontSize: 11.5, color: S.ink, fontFamily: fonts.body.regular }}>{current.note}</Text>}
            {!!current.createdBy && <Text style={{ fontSize: 10.5, color: S.graphite, fontFamily: fonts.body.regular }}>by {current.createdBy}</Text>}
          </View>
          {canDelete && (
            <TouchableOpacity onPress={() => Alert.alert("Remove this day's update?", undefined, [{ text: "Cancel", style: "cancel" }, { text: "Remove", style: "destructive", onPress: () => remove.mutate(current.id) }])} style={{ padding: 6 }}>
              <Trash2 size={14} color={S.graphite} />
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}

export function CheckpointsTab({ rungId, canEdit, onChanged }: { rungId: number; canEdit: boolean; onChanged: () => void }) {
  const q = useQuery({ queryKey: ["cwd-detail", rungId], queryFn: () => getRungDetail(rungId) });
  const [saving, setSaving] = useState<number | null>(null);
  const a = q.data?.assignment ?? null;
  const startDate = a?.startDate ? a.startDate.slice(0, 10) : "";
  const today = todayYmd();

  const gate = (cp: RungCheckpoint): { locked: boolean; daysLeft: number | null } => {
    if (cp.isChecked || cp.minWaitDays == null || cp.minWaitDays <= 0) return { locked: false, daysLeft: null };
    if (!startDate) return { locked: true, daysLeft: null };
    const eligible = addDays(startDate, cp.minWaitDays);
    return today >= eligible ? { locked: false, daysLeft: null } : { locked: true, daysLeft: diffDays(today, eligible) };
  };

  const toggle = async (i: number) => {
    if (!a || !canEdit) return;
    const cp = a.checkpoints[i];
    if (!cp.isChecked) {
      const g = gate(cp);
      if (g.locked) {
        toast.error(startDate ? `"${cp.fieldName}" needs ${cp.minWaitDays} day(s) after the start date — ${g.daysLeft} day(s) left.` : `"${cp.fieldName}" needs a Start Date (set in Work Allocation) first.`);
        return;
      }
    }
    setSaving(i);
    try {
      await saveCheckpoints(rungId, a, a.checkpoints.map((c, j) => (j === i ? { ...c, isChecked: !c.isChecked } : c)));
      await q.refetch();
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(null);
    }
  };

  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorText error={q.error} />;
  const cps = a?.checkpoints ?? [];
  if (!cps.length) return <Empty text="No checkpoints tagged to this activity — add them in Activity Master." />;

  return (
    <View style={{ gap: 10 }}>
      {cps.map((cp, i) => {
        const g = gate(cp);
        return (
          <Blink key={cp.id ?? `${cp.fieldName}-${i}`} on={!!cp.needsRework}>
            <View style={{ ...card, padding: 12, ...(cp.needsRework ? { borderColor: S.ink, backgroundColor: S.redWash } : {}) }}>
              <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
                <TouchableOpacity
                  disabled={!canEdit || saving === i}
                  onPress={() => toggle(i)}
                  activeOpacity={0.7}
                  style={{ width: 24, height: 24, borderWidth: 1.5, alignItems: "center", justifyContent: "center", borderColor: g.locked && !cp.isChecked ? S.red : S.ink, backgroundColor: cp.isChecked ? S.ink : "transparent", opacity: saving === i ? 0.5 : 1 }}
                >
                  {cp.isChecked && <Check size={13} color={S.paper} strokeWidth={3} />}
                </TouchableOpacity>
                <View style={{ flex: 1, gap: 6 }}>
                  <Text style={{ fontSize: 13, fontFamily: fonts.body.medium, color: S.ink }}>{cp.fieldName}</Text>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                    {cp.needsRework && <Tag icon={<RotateCcw size={9} color={S.ink} />} text="Redo — rated Poor" color={S.ink} />}
                    {cp.isDaily && <Tag icon={<CalendarDays size={9} color={ACCENT} />} text="Daily" color={ACCENT} />}
                    {g.locked && <Tag icon={<Timer size={9} color={S.ink} />} text={g.daysLeft != null ? `${g.daysLeft}d left` : `${cp.minWaitDays}d wait`} color={S.ink} />}
                  </View>
                </View>
              </View>
              {cp.isDaily && cp.id != null && <DailyUpdates checkpointId={cp.id} canEdit={canEdit} />}
            </View>
          </Blink>
        );
      })}
    </View>
  );
}

function Tag({ icon, text, color }: { icon: React.ReactNode; text: string; color: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 0, backgroundColor: `${color}1f` }}>
      {icon}
      <Text style={{ fontSize: 9.5, fontFamily: fonts.heading.semibold, color }}>{text}</Text>
    </View>
  );
}
