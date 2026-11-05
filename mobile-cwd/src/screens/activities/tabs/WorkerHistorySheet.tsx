// A worker's attendance across every activity/project, one month at a time — the mobile take on the web's
// "Attendance Record" dialog (GET /api/worker-attendance/workers/:id/calendar).
import { useEffect, useMemo, useState } from "react";
import { Modal, ScrollView, Text, TouchableOpacity, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, X } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { getWorkerCalendar, type AttendanceStatus } from "@/api/cwdApi";
import { Empty, ErrorText, Loading, fromYmd, todayYmd } from "./ui";

export const ATT_META: Record<AttendanceStatus, { label: string; color: string }> = {
  P: { label: "Present", color: "#10b981" },
  H: { label: "Half Day", color: "#f59e0b" },
  A: { label: "Absent", color: "#ef4444" },
};

const monthLabel = (m: string) => fromYmd(`${m}-01`).toLocaleDateString("en-IN", { month: "long", year: "numeric" });

export function WorkerHistorySheet({ worker, onClose }: { worker: { id: number; name: string } | null; onClose: () => void }) {
  const thisMonth = todayYmd().slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
  useEffect(() => { if (worker) setMonth(thisMonth); }, [worker, thisMonth]);

  const q = useQuery({
    queryKey: ["cwd-worker-calendar", worker?.id, month],
    queryFn: () => getWorkerCalendar(worker!.id, month),
    enabled: !!worker,
  });
  const days = q.data?.days ?? [];
  const counts = useMemo(() => {
    const c: Record<AttendanceStatus, number> = { P: 0, H: 0, A: 0 };
    for (const d of days) c[d.status]++;
    return c;
  }, [days]);

  const shift = (n: number) => {
    const [y, m] = month.split("-").map(Number);
    const d = new Date(y, m - 1 + n, 1);
    const next = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    if (next <= thisMonth) setMonth(next);
  };

  return (
    <Modal visible={!!worker} animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }}>
        <View style={{ maxHeight: "85%", backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, borderColor: colors.border, padding: 16, gap: 12 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={{ fontSize: 14, fontFamily: fonts.heading.bold, color: colors.foreground }}>{worker?.name}</Text>
              <Text style={{ fontSize: 10.5, fontFamily: fonts.body.regular, color: colors.mutedForeground }}>Attendance record</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={{ padding: 4 }}><X size={18} color={colors.mutedForeground} /></TouchableOpacity>
          </View>

          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <TouchableOpacity onPress={() => shift(-1)} style={{ padding: 8 }}><ChevronLeft size={18} color={colors.foreground} /></TouchableOpacity>
            <Text style={{ fontSize: 13, fontFamily: fonts.heading.semibold, color: colors.foreground }}>{monthLabel(month)}</Text>
            <TouchableOpacity disabled={month >= thisMonth} onPress={() => shift(1)} style={{ padding: 8, opacity: month >= thisMonth ? 0.25 : 1 }}>
              <ChevronRight size={18} color={colors.foreground} />
            </TouchableOpacity>
          </View>

          <View style={{ flexDirection: "row", gap: 8 }}>
            {(["P", "H", "A"] as AttendanceStatus[]).map((k) => (
              <View key={k} style={{ flex: 1, alignItems: "center", paddingVertical: 8, borderRadius: 12, borderWidth: 1, borderColor: `${ATT_META[k].color}55`, backgroundColor: `${ATT_META[k].color}18` }}>
                <Text style={{ fontSize: 18, fontFamily: fonts.heading.bold, color: ATT_META[k].color }}>{counts[k]}</Text>
                <Text style={{ fontSize: 10, fontFamily: fonts.body.medium, color: colors.mutedForeground }}>{ATT_META[k].label}</Text>
              </View>
            ))}
          </View>

          <ScrollView style={{ flexGrow: 0 }}>
            {q.isLoading ? <Loading /> : q.error ? <ErrorText error={q.error} /> : days.length === 0 ? (
              <Empty text="No attendance recorded this month." />
            ) : days.map((d) => (
              <View key={d.id} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ fontSize: 12.5, fontFamily: fonts.body.medium, color: colors.foreground }}>
                    {fromYmd(d.date).toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short" })}
                  </Text>
                  {!!d.activityLabel && <Text numberOfLines={1} style={{ fontSize: 10.5, fontFamily: fonts.body.regular, color: colors.mutedForeground }}>{d.activityLabel}</Text>}
                  {!!d.remarks && <Text numberOfLines={1} style={{ fontSize: 10.5, fontStyle: "italic", fontFamily: fonts.body.regular, color: colors.mutedForeground }}>— {d.remarks}</Text>}
                </View>
                <View style={{ paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999, backgroundColor: `${ATT_META[d.status].color}22` }}>
                  <Text style={{ fontSize: 10.5, fontFamily: fonts.heading.semibold, color: ATT_META[d.status].color }}>{ATT_META[d.status].label}</Text>
                </View>
              </View>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
