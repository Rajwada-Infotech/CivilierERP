// Who worked on this activity on a given day: Present / Absent / Half-day per worker, saved in one go.
// Workers are added from the existing worker list (registering a brand-new worker, which needs an Aadhaar
// number, stays on the web).
import { useEffect, useMemo, useState } from "react";
import { Alert, Modal, ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Plus, Save, Search, UserX, X } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { toast } from "@/components/Toast";
import { addToRoster, getAttendance, removeFromRoster, saveAttendance, searchWorkers, type AttendanceStatus } from "@/api/cwdApi";
import { ACCENT, Btn, Empty, ErrorText, Loading, card, fmtDay, fromYmd, todayYmd, ymd } from "./ui";

const OPTIONS: { key: AttendanceStatus; label: string; color: string }[] = [
  { key: "P", label: "Present", color: "#10b981" },
  { key: "H", label: "Half", color: "#f59e0b" },
  { key: "A", label: "Absent", color: "#ef4444" },
];

function AddWorkers({ rungId, existing, visible, onClose, onAdded }: { rungId: number; existing: Set<number>; visible: boolean; onClose: () => void; onAdded: () => void }) {
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const [picked, setPicked] = useState<Set<number>>(new Set());
  useEffect(() => { const t = setTimeout(() => setTerm(search.trim()), 350); return () => clearTimeout(t); }, [search]);
  useEffect(() => { if (!visible) { setSearch(""); setPicked(new Set()); } }, [visible]);
  const q = useQuery({ queryKey: ["cwd-worker-search", term], queryFn: () => searchWorkers(term), enabled: visible, staleTime: 15_000 });
  const add = useMutation({
    mutationFn: () => addToRoster(rungId, [...picked]),
    onSuccess: () => { toast.success("Workers added"); onAdded(); onClose(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const list = (q.data ?? []).filter((w) => !existing.has(w.id));
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }}>
        <View style={{ maxHeight: "85%", backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, borderColor: colors.border, padding: 16, gap: 12 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Text style={{ fontSize: 14, fontFamily: fonts.heading.bold, color: colors.foreground }}>Add workers</Text>
            <TouchableOpacity onPress={onClose} style={{ padding: 4 }}><X size={18} color={colors.mutedForeground} /></TouchableOpacity>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 12 }}>
            <Search size={14} color={colors.mutedForeground} />
            <TextInput value={search} onChangeText={setSearch} placeholder="Search by name or Aadhaar…" placeholderTextColor={`${colors.mutedForeground}99`} style={{ flex: 1, color: colors.foreground, fontFamily: fonts.body.regular, fontSize: 13, paddingVertical: 10 }} />
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" style={{ flexGrow: 0 }}>
            {q.isLoading ? <Loading /> : list.length === 0 ? <Empty text="No workers found." /> : list.map((w) => {
              const on = picked.has(w.id);
              return (
                <TouchableOpacity key={w.id} onPress={() => setPicked((p) => { const n = new Set(p); if (!n.delete(w.id)) n.add(w.id); return n; })} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                  <View style={{ width: 20, height: 20, borderRadius: 6, borderWidth: 2, borderColor: on ? ACCENT : colors.border, backgroundColor: on ? ACCENT : "transparent" }} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 13, color: colors.foreground, fontFamily: fonts.body.medium }}>{w.name}</Text>
                    <Text style={{ fontSize: 10.5, color: colors.mutedForeground, fontFamily: fonts.body.regular }}>{w.contractorName || w.skillType}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          <Btn label={picked.size ? `Add ${picked.size} worker${picked.size === 1 ? "" : "s"}` : "Pick workers to add"} disabled={!picked.size} busy={add.isPending} onPress={() => add.mutate()} />
        </View>
      </View>
    </Modal>
  );
}

export function AttendanceTab({ rungId, canEdit }: { rungId: number; canEdit: boolean }) {
  const qc = useQueryClient();
  const today = todayYmd();
  const [date, setDate] = useState(today);
  const [status, setStatus] = useState<Record<number, AttendanceStatus>>({});
  const [adding, setAdding] = useState(false);
  const key = ["cwd-attendance", rungId, date];
  const q = useQuery({ queryKey: key, queryFn: () => getAttendance(rungId, date) });
  const rows = q.data ?? [];

  useEffect(() => {
    const next: Record<number, AttendanceStatus> = {};
    for (const r of q.data ?? []) next[r.workerId] = r.status ?? "P";
    setStatus(next);
  }, [q.data]);

  const refresh = () => qc.invalidateQueries({ queryKey: key });
  const save = useMutation({
    mutationFn: () => saveAttendance(rungId, date, rows.map((r) => ({ workerId: r.workerId, status: status[r.workerId] ?? "P" }))),
    onSuccess: () => { toast.success("Attendance saved"); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: (workerId: number) => removeFromRoster(rungId, workerId),
    onSuccess: () => { toast.success("Worker removed from this activity"); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const existing = useMemo(() => new Set(rows.map((r) => r.workerId)), [rows]);
  const step = (n: number) => { const d = fromYmd(date); d.setDate(d.getDate() + n); const s = ymd(d); if (s <= today) setDate(s); };

  return (
    <View style={{ gap: 12 }}>
      <View style={{ ...card, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 8 }}>
        <TouchableOpacity onPress={() => step(-1)} style={{ padding: 8 }}><ChevronLeft size={18} color={colors.foreground} /></TouchableOpacity>
        <View style={{ alignItems: "center" }}>
          <Text style={{ fontSize: 13, fontFamily: fonts.heading.semibold, color: colors.foreground }}>{fmtDay(date)}</Text>
          {date === today ? <Text style={{ fontSize: 10, color: ACCENT, fontFamily: fonts.heading.semibold }}>Today</Text> : (
            <TouchableOpacity onPress={() => setDate(today)}><Text style={{ fontSize: 10, color: ACCENT, fontFamily: fonts.heading.semibold }}>Jump to today</Text></TouchableOpacity>
          )}
        </View>
        <TouchableOpacity disabled={date >= today} onPress={() => step(1)} style={{ padding: 8, opacity: date >= today ? 0.25 : 1 }}><ChevronRight size={18} color={colors.foreground} /></TouchableOpacity>
      </View>

      {q.isLoading ? <Loading /> : q.error ? <ErrorText error={q.error} /> : rows.length === 0 ? (
        <Empty text="No workers assigned to this activity yet." />
      ) : (
        <View style={{ ...card, padding: 0, overflow: "hidden" }}>
          {rows.map((r, i) => {
            const cur = status[r.workerId] ?? "P";
            return (
              <View key={r.workerId} style={{ padding: 12, gap: 8, borderTopWidth: i ? 1 : 0, borderTopColor: colors.border }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <Text numberOfLines={1} style={{ fontSize: 13, fontFamily: fonts.body.medium, color: colors.foreground }}>{r.workerName}</Text>
                    <Text numberOfLines={1} style={{ fontSize: 10.5, fontFamily: fonts.body.regular, color: colors.mutedForeground }}>{r.contractorName || r.skillType}</Text>
                  </View>
                  {canEdit && (
                    <TouchableOpacity onPress={() => Alert.alert("Remove from this activity?", r.workerName, [{ text: "Cancel", style: "cancel" }, { text: "Remove", style: "destructive", onPress: () => remove.mutate(r.workerId) }])} style={{ padding: 6 }}>
                      <UserX size={15} color={colors.mutedForeground} />
                    </TouchableOpacity>
                  )}
                </View>
                <View style={{ flexDirection: "row", gap: 6 }}>
                  {OPTIONS.map((o) => {
                    const on = cur === o.key;
                    return (
                      <TouchableOpacity key={o.key} disabled={!canEdit} onPress={() => setStatus((p) => ({ ...p, [r.workerId]: o.key }))} style={{ flex: 1, alignItems: "center", paddingVertical: 7, borderRadius: 10, borderWidth: 1, borderColor: on ? o.color : colors.border, backgroundColor: on ? `${o.color}25` : "transparent" }}>
                        <Text style={{ fontSize: 11.5, fontFamily: fonts.heading.semibold, color: on ? o.color : colors.mutedForeground }}>{o.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            );
          })}
        </View>
      )}

      {canEdit && (
        <View style={{ flexDirection: "row", gap: 10 }}>
          <View style={{ flex: 1 }}><Btn tone="outline" label="Add worker" icon={<Plus size={14} color={ACCENT} />} onPress={() => setAdding(true)} /></View>
          <View style={{ flex: 1 }}><Btn label="Save attendance" icon={<Save size={14} color="#04181d" />} disabled={rows.length === 0} busy={save.isPending} onPress={() => save.mutate()} /></View>
        </View>
      )}
      <AddWorkers rungId={rungId} existing={existing} visible={adding} onClose={() => setAdding(false)} onAdded={refresh} />
    </View>
  );
}
