// Attendance: one month at a time — summary figures, a calendar grid coloured by status, and the day list.
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react-native";
import { api, type MonthDay } from "@/api/employeeApi";
import { Screen } from "@/components/Screen";
import { Chip } from "@/components/Chip";
import { Body, IconKey, Label, Notice, Panel, Skel, StatGrid, SheetFrame, TitleText } from "@/components/sheet/Sheet";
import { sheet as S } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { fmtDate, fmtTime, MONTHS, todayIst } from "@/utils/format";

const DOT: Record<string, string> = { Present: "#1f8a4c", Absent: "#d64545", "Half Day": "#b7791f", "On Leave": "#3b6fd6", Holiday: "#8b5cf6", "Week Off": "#6b7280" };

function Calendar({ month, days }: { month: string; days: MonthDay[] }) {
  const [y, m] = month.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const byDate = new Map(days.map((d) => [d.Date, d]));
  const today = todayIst();
  const cells: (number | null)[] = [...Array(first).fill(null), ...Array.from({ length: count }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  return (
    <View>
      <View style={{ flexDirection: "row" }}>
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => <Text key={i} style={{ flex: 1, textAlign: "center", color: S.graphite, fontFamily: fonts.heading.semibold, fontSize: 10 }}>{d}</Text>)}
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 6 }}>
        {cells.map((n, i) => {
          const key = n ? `${month}-${String(n).padStart(2, "0")}` : "";
          const st = n ? byDate.get(key)?.Status : null;
          const c = st ? DOT[st] ?? S.graphite : null;
          return (
            <View key={i} style={{ width: `${100 / 7}%`, aspectRatio: 1, padding: 2 }}>
              {n && (
                <View style={{ flex: 1, alignItems: "center", justifyContent: "center", borderWidth: key === today ? 1.5 : 1, borderColor: key === today ? S.ink : S.ruleSoft, backgroundColor: c ? `${c}22` : "transparent" }}>
                  <Text style={{ color: S.ink, fontFamily: fonts.body.medium, fontSize: 12 }}>{n}</Text>
                  {c && <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: c, marginTop: 2 }} />}
                </View>
              )}
            </View>
          );
        })}
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 10 }}>
        {Object.entries(DOT).map(([k, c]) => (
          <View key={k} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <View style={{ width: 8, height: 8, backgroundColor: c }} /><Body size={11} color={S.graphite}>{k}</Body>
          </View>
        ))}
      </View>
    </View>
  );
}

export default function AttendanceScreen() {
  const [month, setMonth] = useState(todayIst().slice(0, 7));
  const q = useQuery({ queryKey: ["month", month], queryFn: () => api.month(month) });
  const shift = (n: number) => {
    const [y, m] = month.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    setMonth(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  };
  const [y, m] = month.split("-").map(Number);
  const isCurrent = month >= todayIst().slice(0, 7);
  const s = q.data?.Summary;

  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => q.refetch()}>
      <SheetFrame>
        <View style={{ padding: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <IconKey onPress={() => shift(-1)}><ChevronLeft size={16} color={S.ink} /></IconKey>
          <View style={{ alignItems: "center" }}>
            <Label>Attendance</Label>
            <TitleText size={20}>{MONTHS[m - 1]} {y}</TitleText>
          </View>
          <IconKey onPress={() => shift(1)} disabled={isCurrent}><ChevronRight size={16} color={S.ink} /></IconKey>
        </View>
      </SheetFrame>

      {q.isError && <Notice>{(q.error as Error).message}</Notice>}
      <StatGrid cols={3} size={18} loading={q.isLoading} items={[
        { label: "Present", value: s?.Present ?? 0 },
        { label: "On leave", value: s?.OnLeave ?? 0 },
        { label: "Absent", value: s?.Absent ?? 0, red: !!s?.Absent },
        { label: "Half day", value: s?.HalfDay ?? 0 },
        { label: "Holidays", value: s?.Holiday ?? 0 },
        { label: "Week off", value: s?.WeekOff ?? 0 },
        { label: "Break min", value: s?.BreakMinutes ?? 0 },
        { label: "Extra min", value: s?.ExtraMinutes ?? 0, red: !!s?.ExtraMinutes },
      ]} />

      <Panel title="Calendar">{q.isLoading ? <Skel h={220} /> : <Calendar month={month} days={q.data?.Days ?? []} />}</Panel>

      <Panel title="Days">
        {q.isLoading ? <Skel h={60} /> : !q.data?.Days.length ? (
          <Body color={S.graphite}>Nothing recorded this month.</Body>
        ) : (
          [...q.data.Days].reverse().map((d) => (
            <Pressable key={d.Date} style={{ borderBottomWidth: 1, borderBottomColor: S.ruleSoft, paddingBottom: 10, gap: 4 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Body weight="semibold">{fmtDate(d.Date)}</Body>
                {d.Status && <Chip text={d.Status} />}
              </View>
              {(d.CheckIn || d.CheckInText) && (
                <Body size={12} color={S.ink2}>
                  In {d.CheckIn ? fmtTime(d.CheckIn) : d.CheckInText} · Out {d.CheckOut ? fmtTime(d.CheckOut) : d.CheckOutText || "—"}
                  {d.Hours != null ? ` · ${d.Hours} h` : ""}
                </Body>
              )}
              {!!(d.BreakMinutes || d.ExtraMinutes) && (
                <Body size={11.5} color={d.ExtraMinutes ? S.red : S.graphite}>Breaks {d.BreakMinutes ?? 0} min{d.ExtraMinutes ? ` · ${d.ExtraMinutes} min extra` : ""}</Body>
              )}
              {d.Note && <Body size={11.5} color={S.graphite}>{d.Note}</Body>}
            </Pressable>
          ))
        )}
      </Panel>
    </Screen>
  );
}
