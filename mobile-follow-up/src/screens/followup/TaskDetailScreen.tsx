import { useState } from "react";
import { ScrollView, View, Text, Alert, Pressable } from "react-native";
import { useRoute, type RouteProp } from "@react-navigation/native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  PRIORITIES, addFollowUp, getCancelTemplates, getChat, getFollowUps, getTask, markFollowUpDone,
  sendChat, setTaskPriority, setTaskProgress, setTaskStatus, type Priority, type TaskStatus,
} from "@/api/followupApi";
import type { MainStackParamList } from "@/navigation/MainStack";
import { useModuleAccess } from "@/navigation/moduleAccess";
import { ACCENT, Btn, Chip, Pill, Picker, PRIORITY_COLOR, QueryState, Section, STATUS_COLOR, TextField, fmtDate } from "@/components/formKit";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";

const body = { color: colors.foreground, fontSize: 13, fontFamily: fonts.body.regular } as const;
const muted = { color: colors.mutedForeground, fontSize: 11, fontFamily: fonts.body.regular } as const;

export default function TaskDetailScreen() {
  const { id } = useRoute<RouteProp<MainStackParamList, "TaskDetail">>().params;
  const { privileged } = useModuleAccess();
  const qc = useQueryClient();
  const task = useQuery({ queryKey: ["task", id], queryFn: () => getTask(id) });
  const fups = useQuery({ queryKey: ["task-fups", id], queryFn: () => getFollowUps(id) });
  const chat = useQuery({ queryKey: ["task-chat", id], queryFn: () => getChat(id) });
  const cancels = useQuery({ queryKey: ["cancel-templates"], queryFn: getCancelTemplates, enabled: privileged });

  const [progress, setProgress] = useState("");
  const [note, setNote] = useState("");
  const [next, setNext] = useState("");
  const [msg, setMsg] = useState("");
  const [cancelId, setCancelId] = useState<number | null>(null);

  const refreshAll = () => qc.invalidateQueries();
  const onError = (e: Error) => Alert.alert("Error", e.message);
  const prog = useMutation({ mutationFn: () => setTaskProgress(id, Number(progress)), onSuccess: () => { setProgress(""); refreshAll(); }, onError });
  const status = useMutation({ mutationFn: (v: { s: TaskStatus; c?: number }) => setTaskStatus(id, v.s, v.c), onSuccess: refreshAll, onError });
  const prio = useMutation({ mutationFn: (p: Priority) => setTaskPriority(id, p), onSuccess: refreshAll, onError });
  const addFu = useMutation({ mutationFn: () => addFollowUp(id, note.trim(), next.trim() || undefined), onSuccess: () => { setNote(""); setNext(""); refreshAll(); }, onError });
  const done = useMutation({ mutationFn: (fid: number) => markFollowUpDone(id, fid), onSuccess: refreshAll, onError });
  const send = useMutation({ mutationFn: () => sendChat(id, msg.trim()), onSuccess: () => { setMsg(""); refreshAll(); }, onError });

  const t = task.data;
  const open = t?.Status === "Active" || t?.Status === "Hold";
  const pct = Math.round(Number(t?.EffectiveProgress ?? t?.Progress ?? 0));

  const submitProgress = () => {
    const n = Number(progress);
    if (progress.trim() === "" || !Number.isInteger(n) || n < 0 || n > 100) return Alert.alert("Progress must be a whole number 0–100");
    prog.mutate();
  };

  return (
    <QueryState isLoading={task.isLoading} isError={task.isError} error={task.error} onRetry={() => task.refetch()}>
      {t ? (
        <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: 16, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
          <Section
            title={t.TaskNo}
            right={
              <View className="flex-row gap-1.5">
                <Pill label={t.Status} color={STATUS_COLOR[t.Status] ?? ACCENT} />
                {t.Priority ? <Pill label={t.Priority} color={PRIORITY_COLOR[t.Priority] ?? ACCENT} /> : null}
              </View>
            }
          >
            <Text style={{ ...body, fontFamily: fonts.heading.semibold, fontSize: 15 }}>{t.Subject}</Text>
            {t.Details ? <Text style={{ ...body, marginTop: 6 }}>{t.Details}</Text> : null}
            <Text style={{ ...muted, marginTop: 8 }}>Assignee: {t.AssigneeName ?? "—"} · By {t.CreatedByName ?? "—"}</Text>
            <Text style={muted}>
              Due {fmtDate(t.DueDate)}
              {t.Department ? ` · ${t.Department}` : ""}
              {t.CaseProjectName ? ` · ${t.CaseProjectName}` : ""}
            </Text>
            {t.CancelReasonLabel ? <Text style={{ ...muted, color: "#ef4444" }}>Cancelled: {t.CancelReasonLabel}</Text> : null}
            <View className="mt-3 h-2 rounded-full overflow-hidden" style={{ backgroundColor: colors.muted }}>
              <View style={{ width: `${pct}%`, height: "100%", backgroundColor: ACCENT }} />
            </View>
            <Text style={{ ...muted, marginTop: 4 }}>{pct}% complete</Text>
          </Section>

          {open ? (
            <Section title="Update Progress">
              {t.HasChildren ? (
                <Text style={muted}>Progress is derived from sub-tasks.</Text>
              ) : (
                <View className="flex-row items-end gap-2">
                  <View style={{ flex: 1 }}>
                    <TextField label="Progress %" value={progress} onChangeText={setProgress} keyboardType="number-pad" placeholder={String(pct)} />
                  </View>
                  <View style={{ marginBottom: 12 }}>
                    <Btn label="Save" onPress={submitProgress} busy={prog.isPending} />
                  </View>
                </View>
              )}
            </Section>
          ) : null}

          {privileged ? (
            <Section title="Admin">
              <View className="flex-row flex-wrap">
                {PRIORITIES.map((p) => <Chip key={p} label={p} active={t.Priority === p} onPress={() => prio.mutate(p)} />)}
              </View>
              <View className="flex-row flex-wrap mb-2">
                {(["Active", "Hold", "Closed"] as TaskStatus[]).map((s) => (
                  <Chip key={s} label={s} active={t.Status === s} color={STATUS_COLOR[s]} onPress={() => t.Status !== s && status.mutate({ s })} />
                ))}
              </View>
              {open ? (
                <>
                  <Picker label="Cancel reason" value={cancelId} options={(cancels.data ?? []).map((c) => ({ id: c.Id, name: c.Name }))} onChange={setCancelId} />
                  <Btn
                    label="Cancel Task"
                    tone="danger"
                    disabled={cancelId == null}
                    busy={status.isPending}
                    onPress={() =>
                      Alert.alert("Cancel this task?", t.TaskNo, [
                        { text: "No" },
                        { text: "Cancel Task", style: "destructive", onPress: () => status.mutate({ s: "Cancel", c: cancelId! }) },
                      ])
                    }
                  />
                </>
              ) : null}
            </Section>
          ) : null}

          <Section title={`Follow-ups (${fups.data?.length ?? 0})`}>
            {(fups.data ?? []).map((f) => (
              <View key={f.Id} className="mb-2.5 pb-2.5" style={{ borderBottomWidth: 1, borderBottomColor: `${colors.border}66` }}>
                <Text style={body}>{f.Note}</Text>
                <Text style={muted}>
                  {f.CreatedByName ?? "—"} · {fmtDate(f.CreatedAt, true)}
                  {f.NextReminderAt ? ` · next ${fmtDate(f.NextReminderAt, true)}` : ""}
                </Text>
                {f.IsDone ? (
                  <Text style={{ ...muted, color: ACCENT }}>Done {fmtDate(f.DoneAt)}</Text>
                ) : open ? (
                  <Pressable onPress={() => done.mutate(f.Id)}>
                    <Text style={{ color: ACCENT, fontSize: 12, fontFamily: fonts.heading.semibold, marginTop: 4 }}>Mark done</Text>
                  </Pressable>
                ) : null}
              </View>
            ))}
            {open ? (
              <>
                <TextField label="Note" value={note} onChangeText={setNote} multiline />
                <TextField label="Next reminder (YYYY-MM-DD)" value={next} onChangeText={setNext} autoCapitalize="none" />
                <Btn label="Add Follow-up" disabled={!note.trim()} busy={addFu.isPending} onPress={() => addFu.mutate()} />
              </>
            ) : null}
          </Section>

          <Section title="Chat">
            {(chat.data ?? []).map((m) => (
              <View key={m.Id} className="mb-2">
                <Text style={body}>{m.Message}</Text>
                <Text style={muted}>{m.SenderName ?? "—"} · {fmtDate(m.CreatedAt, true)}</Text>
              </View>
            ))}
            <TextField label="Message" value={msg} onChangeText={setMsg} multiline />
            <Btn label="Send" disabled={!msg.trim()} busy={send.isPending} onPress={() => send.mutate()} />
          </Section>
        </ScrollView>
      ) : null}
    </QueryState>
  );
}
