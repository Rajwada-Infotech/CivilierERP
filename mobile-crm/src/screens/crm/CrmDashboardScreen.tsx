// The CRM dashboard's parts — the web's CRM Dashboard (src/pages/CRM/CrmDashboard.tsx), same route
// (crmDashboard.js GET /) and the same words — built from the app's kit and laid out on the CRM tab (CrmHubScreen.tsx):
// the project picker, this month and next, the collection (due, paid, with Finance, outstanding), what needs attention,
// the pipeline, collection per project and the seven-day lookahead. Home reuses the attention list.
import { ScrollView, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { CalendarDays, KeyRound, ReceiptIndianRupee, ScrollText } from "lucide-react-native";
import { useAuth } from "@/auth/AuthContext";
import { crmGet } from "@/api/crmApi";
import type { MainStackParamList } from "@/navigation/MainStack";
import { useBrand } from "@/theme/ThemeContext";
import { fonts } from "@/theme/fonts";
import { formatCompactINR } from "@/utils/formatCurrency";
import { registerByKey } from "./crmRegisters";
import { Bar, Figure, HeroSurface, LinkRow, ON_HERO, Section, Tap, useCardStyle } from "./ui";

// The web dashboard's attention list (CrmDashboard.tsx), with the phone list each one opens where the app has it.
export const ATTENTION: { key: string; label: string; note: string; hot: boolean; register?: string }[] = [
  { key: "overduePayments", label: "Overdue payments", note: "Demand milestones past their due date", hot: true, register: "demands" },
  { key: "disputedNotices", label: "Possession notices disputed", note: "Disputed by the customer", hot: true, register: "possession" },
  { key: "urgentTickets", label: "Urgent service tickets", note: "High priority, not resolved", hot: true, register: "service-tickets" },
  { key: "welcomeCallPending", label: "Welcome calls pending", note: "Approved bookings with no call made", hot: false, register: "welcome-calls" },
  { key: "agreementsPending", label: "Agreements need action", note: "None drawn up, or in draft over 5 days", hot: false, register: "agreements" },
  { key: "deedsAwaitingCustomer", label: "Deeds awaiting customer", note: "Not yet approved on the portal", hot: false, register: "sales-deed" },
  { key: "deedsAwaitingDirector", label: "Deeds awaiting director", note: "Pending director approval", hot: false, register: "sales-deed" },
  { key: "nocsNotIssued", label: "NOCs not issued", note: "Approved, not handed over", hot: false, register: "noc" },
  { key: "cancellationsPending", label: "Cancellations pending", note: "Awaiting management approval", hot: false, register: "cancellations" },
  { key: "handoversThisWeek", label: "Handovers this week", note: "Scheduled in the next 7 days", hot: false, register: "possession" },
];

const n0 = (v: unknown) => Number(v) || 0;
const short = (v: unknown) => `₹${formatCompactINR(v)}`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The dashboard's figures, for one project or all (crmDashboard.js GET /) — one query key, so Home and the CRM tab
 * share them. */
export function useCrmDashboard(projectId: number | null = null, enabled = true) {
  return useQuery({
    queryKey: ["crm-dashboard", projectId],
    queryFn: () => crmGet<any>(`/api/crm/dashboard${projectId ? `?projectId=${projectId}` : ""}`),
    enabled,
  });
}

/** Open a CRM list when the person has a right on it; undefined when they don't (the row then shows without a link). */
export function useOpenRegister() {
  const nav = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const { canAccessPage } = useAuth();
  return (key?: string) => {
    const reg = key ? registerByKey(key) : undefined;
    return reg && reg.pages.some((p) => canAccessPage(p)) ? () => nav.navigate("CrmRegister", { register: reg.key }) : undefined;
  };
}

/** The lists "Needs attention" links to right now (an alert above 0) — the screens leave those lists' own counts out,
 * so one screen never says the same thing twice. */
export const attentionRegisters = (d: any): string[] =>
  ATTENTION.filter((a) => a.register && n0(d?.alerts?.[a.key]) > 0).map((a) => a.register!);

/** The project picker: all projects, or one — every figure on the page follows it. */
export function ProjectChips({ projects, value, onChange }: { projects: { Id: number; Name: string }[]; value: number | null; onChange: (id: number | null) => void }) {
  const b = useBrand();
  if ((projects ?? []).length < 2) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 2 }} style={{ marginHorizontal: -16 }}>
      <View style={{ width: 8 }} />
      {[{ Id: null as number | null, Name: "All projects" }, ...projects].map((p) => {
        const on = p.Id === value;
        return (
          <Tap key={String(p.Id)} onPress={() => onChange(p.Id)} accessibilityRole="button" accessibilityState={{ selected: on }}
            style={{ paddingHorizontal: 16, paddingVertical: 9, borderRadius: 999, backgroundColor: on ? b.accent : b.surfaceCard, borderWidth: on ? 0 : 1, borderColor: b.border }}>
            <Text style={{ fontSize: 13, fontFamily: fonts.heading.semibold, color: on ? "#fff" : b.textSecondary }}>{p.Name}</Text>
          </Tap>
        );
      })}
      <View style={{ width: 8 }} />
    </ScrollView>
  );
}

/** This month and next (the web's figures and words): units sold, booking value, what falls due in 30 days. */
export function ThisMonthCard({ d }: { d: any }) {
  const m = d?.metrics ?? {};
  const label = (t: string) => <Text style={{ fontSize: 12, fontFamily: fonts.body.medium, color: ON_HERO.secondary, marginTop: 2 }}>{t}</Text>;
  return (
    <HeroSurface>
      <View style={{ flexDirection: "row", gap: 16 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 30, fontFamily: fonts.heading.semibold, color: ON_HERO.primary, letterSpacing: -0.5 }}>{n0(m.unitsSoldThisMonth)}</Text>
          {label("Units sold this month")}
        </View>
        <View style={{ flex: 1.3 }}>
          <Text numberOfLines={1} adjustsFontSizeToFit style={{ fontSize: 30, fontFamily: fonts.heading.semibold, color: ON_HERO.primary, letterSpacing: -0.5 }}>{short(m.revenueThisMonth)}</Text>
          {label("Booking value this month")}
        </View>
      </View>
      <View style={{ height: 1, backgroundColor: ON_HERO.glass, marginVertical: 14 }} />
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: ON_HERO.glass, alignItems: "center", justifyContent: "center" }}>
          <CalendarDays size={17} color={ON_HERO.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 17, fontFamily: fonts.heading.semibold, color: ON_HERO.primary }}>{short(m.forwardDue30Days)}</Text>
          <Text style={{ fontSize: 12, fontFamily: fonts.body.medium, color: ON_HERO.secondary }}>Falling due in 30 days · {plural(n0(m.forwardDueCount), "milestone")}</Text>
        </View>
      </View>
    </HeroSurface>
  );
}

/** Due, paid, with Finance, outstanding — the collection at a glance (the web's band), short (₹6.1Cr) as the web's band
 * shows them, so they fit two to a row on a phone. */
export function MoneyFigures({ d }: { d: any }) {
  const b = useBrand();
  const p = d?.payments ?? {};
  const due = n0(p.TotalDue);
  const paid = n0(p.TotalPaid);
  const withFinance = n0(p.WithFinance);
  const outstanding = Math.max(0, due - paid - withFinance);
  return (
    <View style={{ gap: 10, marginBottom: 12 }}>
      <View style={{ flexDirection: "row", gap: 10 }}>
        <Figure label="Due" value={short(due)} tone={b.isDark ? "#60A5FA" : "#2563EB"} />
        <Figure label="Paid" value={short(paid)} tone={b.success} sub={due ? `${Math.round((paid / due) * 100)}% of due` : undefined} />
      </View>
      <View style={{ flexDirection: "row", gap: 10 }}>
        <Figure label="With Finance" value={short(withFinance)} tone="#8B5CF6" />
        <Figure label="Outstanding" value={short(outstanding)} tone={b.warning} />
      </View>
    </View>
  );
}

/** What needs attention, each row opening its list — or, with `links={false}` where the page lists those pages itself
 * (the CRM tab), just the counts, so no page is offered twice on one screen. */
export function AttentionList({ d, links = true }: { d: any; links?: boolean }) {
  const b = useBrand();
  const openRegister = useOpenRegister();
  const alerts = d?.alerts ?? {};
  const attention = ATTENTION.filter((a) => n0(alerts[a.key]) > 0);
  return (
    <Section title="Needs attention">
      {attention.length === 0 ? (
        <Text style={{ fontSize: 13.5, fontFamily: fonts.body.regular, color: b.textSecondary, paddingVertical: 10 }}>Nothing needs attention.</Text>
      ) : attention.map((a) => (
        <LinkRow key={a.key} title={a.label} sub={a.note}
          right={<Text style={{ fontSize: 17, fontFamily: fonts.heading.semibold, color: a.hot ? b.danger : b.textPrimary, fontVariant: ["tabular-nums"] }}>{n0(alerts[a.key])}</Text>}
          onPress={links ? openRegister(a.register) : undefined} />
      ))}
    </Section>
  );
}

/** The pipeline, applications to possessions, with how much carries on to the next stage (the web's "Pipeline"). The
 * figures only: each stage's list is opened from its own place (the Bookings tab, the CRM tab's rows). */
export function Pipeline({ d }: { d: any }) {
  const b = useBrand();
  const stages = ["Applications", "Bookings", "Agreements", "Possessions"].map((key) => ({ key, value: n0(d?.funnel?.[key]) }));
  const max = Math.max(1, ...stages.map((s) => s.value));
  return (
    <Section title="Pipeline">
      <View style={{ gap: 12, paddingVertical: 6 }}>
        {stages.map((s, i) => {
          const next = stages[i + 1];
          return (
            <View key={s.key} accessibilityLabel={`${s.key}: ${s.value}`} style={{ gap: 6 }}>
              <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
                <Text style={{ flex: 1, fontSize: 14, fontFamily: fonts.body.medium, color: b.textPrimary }}>{s.key}</Text>
                {next ? (
                  <Text style={{ fontSize: 12, fontFamily: fonts.body.regular, color: b.textSecondary }}>
                    {s.value > 0 ? `${Math.round((next.value / s.value) * 100)}% go on` : ""}
                  </Text>
                ) : null}
                <Text style={{ minWidth: 34, textAlign: "right", fontSize: 16, fontFamily: fonts.heading.semibold, color: b.textPrimary, fontVariant: ["tabular-nums"] }}>{s.value}</Text>
              </View>
              <Bar pct={(s.value / max) * 100} color={b.accent} />
            </View>
          );
        })}
      </View>
    </Section>
  );
}

/** Collection per project: paid of due, a bar, overdue milestones. */
export function CollectionPerProject({ d }: { d: any }) {
  const b = useBrand();
  const rows: any[] = d?.metrics?.collectionPerProject ?? [];
  if (rows.length < 2) return null;
  return (
    <Section title="Collection per project">
      <View style={{ gap: 14, paddingVertical: 6 }}>
        {rows.map((p) => {
          const pct = n0(p.TotalDue) ? Math.min(100, (n0(p.TotalPaid) / n0(p.TotalDue)) * 100) : 0;
          return (
            <View key={p.ProjectName} style={{ gap: 6 }}>
              <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
                <Text numberOfLines={1} style={{ flex: 1, fontSize: 14, fontFamily: fonts.heading.semibold, color: b.textPrimary }}>{p.ProjectName}</Text>
                <Text style={{ fontSize: 13, fontFamily: fonts.body.medium, color: b.textSecondary, fontVariant: ["tabular-nums"] }}>{short(p.TotalPaid)} of {short(p.TotalDue)}</Text>
              </View>
              <Bar pct={pct} color={b.success} />
              <Text style={{ fontSize: 12, fontFamily: fonts.body.regular, color: n0(p.OverdueCount) ? b.danger : b.textSecondary }}>
                {Math.round(pct)}% collected{n0(p.OverdueCount) ? ` · ${p.OverdueCount} overdue` : ""}
              </Text>
            </View>
          );
        })}
      </View>
    </Section>
  );
}

/** The seven-day lookahead (the web's): the days with handovers, registries or payments due — the quiet days left out. */
export function WeekAhead({ d }: { d: any }) {
  const b = useBrand();
  const card = useCardStyle();
  const days: any[] = (d?.thisWeek ?? []).filter((w: any) => n0(w.Handovers) || n0(w.Registries) || n0(w.MilestonesDue));
  const chip = (Icon: typeof KeyRound, n: number, one: string, many: string) => n ? (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999, backgroundColor: b.surfaceGlass }}>
      <Icon size={12} color={b.accent} />
      <Text style={{ fontSize: 12, fontFamily: fonts.body.medium, color: b.textPrimary }}>{plural(n, one, many)}</Text>
    </View>
  ) : null;
  return (
    <Section title="Seven-day lookahead">
      {days.length === 0 ? (
        <Text style={{ fontSize: 13.5, fontFamily: fonts.body.regular, color: b.textSecondary, paddingVertical: 10 }}>No handovers, registries or payments due in the next 7 days.</Text>
      ) : (
        <View style={{ gap: 10, paddingVertical: 6 }}>
          {days.map((w) => (
            <View key={w.DayDate} style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <View style={{ ...card, width: 54, alignItems: "center", paddingVertical: 8, borderRadius: 14 }}>
                <Text style={{ fontSize: 11, fontFamily: fonts.body.medium, color: b.textSecondary }}>{String(w.DayLabel).split(" ")[0]}</Text>
                <Text style={{ fontSize: 17, fontFamily: fonts.heading.semibold, color: b.textPrimary }}>{String(w.DayLabel).split(" ")[1]}</Text>
              </View>
              <View style={{ flex: 1, flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                {chip(KeyRound, n0(w.Handovers), "handover", "handovers")}
                {chip(ScrollText, n0(w.Registries), "registry", "registries")}
                {chip(ReceiptIndianRupee, n0(w.MilestonesDue), "payment due", "payments due")}
              </View>
            </View>
          ))}
        </View>
      )}
    </Section>
  );
}
