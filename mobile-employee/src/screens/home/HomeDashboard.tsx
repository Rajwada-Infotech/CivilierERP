// The rest of the web Employee Portal dashboard, under today's punch card: this month's figures, hours this week,
// leave usage, salary and latest payslip, upcoming holidays and the latest leave applications. Same API as the web.
import { Pressable, View } from "react-native";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useNavigation } from "@react-navigation/native";
import { CalendarDays, ChevronRight, Plane, Timer, Wallet } from "lucide-react-native";
import { api } from "@/api/employeeApi";
import { Chip } from "@/components/Chip";
import { toneOf } from "@/components/Screen";
import { Body, Key, Label, Panel, Skel, StatGrid } from "@/components/sheet/Sheet";
import { sheet as S } from "@/theme/colors";
import { fmtDate, MONTHS, rupee, todayIst } from "@/utils/format";

const ymd = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;

/** Monday → Sunday of this week (IST dates). */
function thisWeek() {
  const t = new Date(`${todayIst()}T00:00:00Z`);
  const mon = new Date(t.getTime() - ((t.getUTCDay() + 6) % 7) * 86_400_000);
  return Array.from({ length: 7 }, (_, i) => new Date(mon.getTime() + i * 86_400_000));
}

function WeekHours() {
  const days = thisWeek();
  const keys = [...new Set(days.map((d) => ymd(d).slice(0, 7)))];
  const res = useQueries({ queries: keys.map((k) => ({ queryKey: ["month", k], queryFn: () => api.month(k), staleTime: 60_000 })) });
  const byDate = new Map<string, number>();
  res.forEach((r) => r.data?.Days.forEach((d) => byDate.set(d.Date, Number(d.Hours) || 0)));
  const hours = days.map((d) => byDate.get(ymd(d)) ?? 0);
  const total = hours.reduce((a, b) => a + b, 0);
  const max = Math.max(...hours, 0.01);
  const today = todayIst();
  return (
    <Panel title={`Hours this week · ${total.toFixed(1)} h`} icon={<Timer size={14} color={S.ink} />}>
      {res.some((r) => r.isLoading) ? <Skel h={110} /> : (
        <View style={{ flexDirection: "row", alignItems: "flex-end", height: 110, gap: 8 }}>
          {days.map((d, i) => {
            const h = hours[i];
            const isToday = ymd(d) === today;
            return (
              <View key={i} style={{ flex: 1, alignItems: "center", justifyContent: "flex-end", height: "100%", gap: 4 }}>
                {h > 0 && <Body size={9.5} color={S.graphite}>{h.toFixed(1)}</Body>}
                <View style={{ width: 10, height: `${Math.max(4, (h / max) * 70)}%`, backgroundColor: S.ink, opacity: h ? 1 : 0.2 }} />
                <Body size={10.5} weight={isToday ? "semibold" : "regular"} color={isToday ? S.ink : S.graphite}>{"MTWTFSS"[i]}</Body>
              </View>
            );
          })}
        </View>
      )}
    </Panel>
  );
}

function LinkRow({ text, onPress }: { text: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={{ flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start" }}>
      <Label color={S.ink}>{text}</Label><ChevronRight size={13} color={S.ink} />
    </Pressable>
  );
}

export default function HomeDashboard() {
  // The tabs and stack screens share one navigator tree; navigate by name.
  const nav = useNavigation<{ navigate: (name: string, params?: object) => void }>();
  const today = todayIst();
  const year = Number(today.slice(0, 4));
  const month = today.slice(0, 7);
  const att = useQuery({ queryKey: ["month", month], queryFn: () => api.month(month), staleTime: 60_000 });
  const bal = useQuery({ queryKey: ["leave-bal", year], queryFn: () => api.balances(year), staleTime: 60_000 });
  const sal = useQuery({ queryKey: ["salary"], queryFn: api.salary, staleTime: 60_000 });
  const slips = useQuery({ queryKey: ["payslips"], queryFn: api.payslips, staleTime: 60_000 });
  const hol = useQuery({ queryKey: ["holidays", year], queryFn: () => api.holidays(year), staleTime: 5 * 60_000 });
  const leaves = useQuery({ queryKey: ["leaves"], queryFn: api.leaves, staleTime: 60_000 });

  const s = att.data?.Summary;
  const limited = (bal.data?.Balances ?? []).filter((b) => b.LeaveType !== "Unpaid" && b.Entitled);
  const left = limited.reduce((t, b) => t + (Number(b.Balance) || 0), 0);
  const entitled = limited.reduce((t, b) => t + Number(b.Entitled), 0);
  const used = limited.reduce((t, b) => t + Number(b.Used) + Number(b.Pending), 0);
  const pct = entitled ? Math.round((used / entitled) * 100) : 0;
  const latest = slips.data?.[0];
  const upcoming = (hol.data ?? []).filter((h) => h.HolidayDate.slice(0, 10) >= today).slice(0, 3);
  const recent = (leaves.data ?? []).slice(0, 6);

  return (
    <>
      <StatGrid cols={3} size={18} loading={att.isLoading || bal.isLoading} items={[
        { label: "Present days", value: s?.Present ?? "–", onPress: () => nav.navigate("Attendance") },
        { label: "Leave left", value: bal.data ? left : "–", onPress: () => nav.navigate("Leave") },
        { label: "Break time", value: s ? `${s.BreakMinutes}m` : "–", red: !!s?.ExtraMinutes },
      ]} />

      <WeekHours />

      <Panel title={`Leave · ${pct}% used`} icon={<Plane size={14} color={S.ink} />}>
        {bal.isLoading ? <Skel h={60} /> : limited.length === 0 ? <Body color={S.graphite}>No leave entitlement set yet.</Body> : limited.map((b) => {
          const p = b.Entitled ? Math.min(100, Math.round(((Number(b.Used) + Number(b.Pending)) / Number(b.Entitled)) * 100)) : 0;
          return (
            <View key={b.LeaveType} style={{ gap: 4 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Body weight="semibold">{b.LeaveType}</Body>
                <Body size={12}><Body weight="semibold" size={12}>{b.Balance}</Body> left of {b.Entitled}</Body>
              </View>
              <View style={{ height: 6, backgroundColor: S.ruleSoft }}><View style={{ height: 6, width: `${p}%`, backgroundColor: S.ink }} /></View>
            </View>
          );
        })}
        <Key tone="ink" label="Apply for leave" onPress={() => nav.navigate("Leave")} />
      </Panel>

      <Panel title="Salary summary" icon={<Wallet size={14} color={S.ink} />}>
        <StatGrid cols={2} size={15} loading={sal.isLoading} items={[
          { label: "CTC", value: sal.data?.CTCAmount != null ? `${rupee(sal.data.CTCAmount)} / ${sal.data.CTCFrequency === "Annual" ? "year" : "month"}` : "—", wide: true },
          { label: "Structure", value: sal.data?.SalaryStructureName || "—" },
          { label: "Latest gross", value: sal.data?.Latest ? rupee(sal.data.Latest.GrossSalary) : "—" },
        ]} />
        <Label>Latest payslip</Label>
        {latest ? (
          <Pressable onPress={() => nav.navigate("Payslip", { runId: latest.PayrollRunId })} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <View><Body weight="semibold">{MONTHS[latest.PeriodMonth - 1]} {latest.PeriodYear}</Body><Body size={11.5} color={S.graphite}>Deductions {rupee(latest.TotalEmployeeDeduction)}</Body></View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}><Body weight="semibold">{rupee(latest.NetSalary)}</Body><ChevronRight size={15} color={S.graphite} /></View>
          </Pressable>
        ) : <Body size={12} color={S.graphite}>Appears once HR locks a payroll month.</Body>}
      </Panel>

      <Panel title="Upcoming holidays" icon={<CalendarDays size={14} color={S.ink} />}>
        {hol.isLoading ? <Skel h={40} /> : upcoming.length === 0 ? <Body color={S.graphite}>No more holidays this year.</Body> : upcoming.map((h) => (
          <View key={h.HolidayId} style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Body weight="semibold">{h.HolidayName}</Body><Body size={12} color={S.graphite}>{fmtDate(h.HolidayDate)}</Body>
          </View>
        ))}
        <LinkRow text="Holiday calendar" onPress={() => nav.navigate("Holidays")} />
      </Panel>

      <Panel title={`Leave applications · ${(leaves.data ?? []).filter((l) => l.Status === "Approved").length}/${leaves.data?.length ?? 0} approved`}>
        {leaves.isLoading ? <Skel h={40} /> : recent.length === 0 ? <Body color={S.graphite}>You haven't applied for leave yet.</Body> : recent.map((l) => (
          <View key={l.LeaveId} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Body weight="semibold">{l.LeaveType} · {l.TotalDays} day{l.TotalDays > 1 ? "s" : ""}</Body>
              <Body size={11.5} color={S.graphite}>{fmtDate(l.FromDate)}{l.FromDate !== l.ToDate ? ` – ${fmtDate(l.ToDate)}` : ""}</Body>
            </View>
            <Chip text={l.Status} tone={toneOf(l.Status)} />
          </View>
        ))}
        <LinkRow text="Apply / view all" onPress={() => nav.navigate("Leave")} />
      </Panel>
    </>
  );
}
