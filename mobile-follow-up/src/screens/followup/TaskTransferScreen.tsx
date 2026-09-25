import { useState } from "react";
import { ScrollView, View, Text, Pressable, Alert } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react-native";
import { getTransferHistory, getTransferUsers, getTransferableTasks, transferTasks } from "@/api/followupApi";
import { ACCENT, Btn, Picker, Section, TextField, fmtDate } from "@/components/formKit";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";

export default function TaskTransferScreen() {
  const qc = useQueryClient();
  const [from, setFrom] = useState<number | null>(null);
  const [to, setTo] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  const [picked, setPicked] = useState<number[]>([]);
  const users = useQuery({ queryKey: ["transfer-users"], queryFn: getTransferUsers });
  const tasks = useQuery({ queryKey: ["transfer-tasks", from], queryFn: () => getTransferableTasks(from!), enabled: from != null });
  const history = useQuery({ queryKey: ["transfer-history"], queryFn: getTransferHistory });
  const opts = (users.data ?? []).map((u) => ({ id: u.id, name: u.name }));

  const go = useMutation({
    mutationFn: () => transferTasks({ TaskIds: picked, FromUserId: from!, ToUserId: to!, Notes: notes.trim() || undefined }),
    onSuccess: () => {
      setPicked([]);
      setNotes("");
      qc.invalidateQueries();
      Alert.alert("Tasks transferred");
    },
    onError: (e: Error) => Alert.alert("Transfer failed", e.message),
  });

  const toggle = (id: number) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const text = { color: colors.foreground, fontSize: 13, fontFamily: fonts.body.regular } as const;
  const muted = { color: colors.mutedForeground, fontSize: 11, fontFamily: fonts.body.regular } as const;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: 16, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
      <Section title="Transfer Tasks">
        <Picker label="From user" value={from} options={opts} onChange={(v) => { setFrom(v); setPicked([]); }} />
        <Picker label="To user" value={to} options={opts.filter((o) => o.id !== from)} onChange={setTo} />
        {from != null ? (
          <>
            <Text style={{ ...muted, marginBottom: 6 }}>Open tasks ({tasks.data?.length ?? 0}) — tap to select</Text>
            {(tasks.data ?? []).map((t) => {
              const on = picked.includes(t.Id);
              return (
                <Pressable key={t.Id} onPress={() => toggle(t.Id)} className="flex-row items-center py-2" style={{ borderBottomWidth: 1, borderBottomColor: `${colors.border}66` }}>
                  <View className="items-center justify-center mr-3" style={{ width: 20, height: 20, borderRadius: 5, borderWidth: 1, borderColor: on ? ACCENT : colors.border, backgroundColor: on ? ACCENT : "transparent" }}>
                    {on ? <Check size={13} color="#fff" /> : null}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={text} numberOfLines={1}>{t.TaskNo} · {t.Subject}</Text>
                    <Text style={muted}>Due {fmtDate(t.DueDate)}</Text>
                  </View>
                </Pressable>
              );
            })}
          </>
        ) : null}
        <View style={{ marginTop: 12 }}>
          <TextField label="Notes" value={notes} onChangeText={setNotes} multiline />
          <Btn label={`Transfer ${picked.length || ""} task${picked.length === 1 ? "" : "s"}`.replace("  ", " ")} disabled={!picked.length || from == null || to == null} busy={go.isPending} onPress={() => go.mutate()} />
        </View>
      </Section>

      <Section title="Recent Transfers">
        {(history.data ?? []).slice(0, 30).map((h) => (
          <View key={h.Id} className="mb-2">
            <Text style={text} numberOfLines={1}>{h.TaskNo} · {h.TaskSubject}</Text>
            <Text style={muted}>{h.FromUserName ?? "—"} → {h.ToUserName ?? "—"} · {fmtDate(h.TransferredAt, true)}</Text>
          </View>
        ))}
        {!history.data?.length ? <Text style={muted}>No transfers yet.</Text> : null}
      </Section>
    </ScrollView>
  );
}
