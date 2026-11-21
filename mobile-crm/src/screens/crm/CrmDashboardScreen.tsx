// The CRM Dashboard on the phone — the web's (src/pages/CRM/CrmDashboard.tsx), same route (crmDashboard.js GET /) and
// the same wording: the collection (due, paid, with Finance, outstanding), what needs attention, this month and next,
// collection per project, the pipeline and the week ahead. A project chip narrows it as the web's project picker does.
import { useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useAuth } from "@/auth/AuthContext";
import { crmGet } from "@/api/crmApi";
import type { MainStackParamList } from "@/navigation/MainStack";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { registerByKey } from "./crmRegisters";
import { CRM, Figure, Kv, LinkRow, Section, money } from "./ui";

// The web dashboard's attention list (CrmDashboard.tsx), with the phone list each one opens where the app has it.
const ATTENTION: { key: string; label: string; note: string; hot: boolean; register?: string }[] = [
  { key: "overduePayments", label: "Overdue payments", note: "Demand milestones past their due date", hot: true, register: "demands" },
  { key: "disputedNotices", label: "Possession notices disputed", note: "Disputed by the customer", hot: true, register: "possession" },
  { key: "urgentTickets", label: "Urgent service tickets", note: "High priority, not resolved", hot: true, register: "service-tickets" },
  { key: "welcomeCallPending", label: "Welcome calls pending", note: "Approved bookings with no call made", hot: false, register: "welcome-calls" },
  { key: "agreementsPending", label: "Agreements need action", note: "None drawn up, or in draft over 5 days", hot: false },
  { key: "deedsAwaitingCustomer", label: "Deeds awaiting customer", note: "Not yet approved on the portal", hot: false },
  { key: "deedsAwaitingDirector", label: "Deeds awaiting director", note: "Pending director approval", hot: false },
  { key: "nocsNotIssued", label: "NOCs not issued", note: "Approved, not handed over", hot: false },
  { key: "cancellationsPending", label: "Cancellations pending", note: "Awaiting management approval", hot: false },
  { key: "handoversThisWeek", label: "Handovers this week", note: "Scheduled in the next 7 days", hot: false, register: "possession" },
];

const n0 = (v: unknown) => Number(v) || 0;

export default function CrmDashboardScreen() {
  const nav = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const { canAccessPage } = useAuth();
  const [projectId, setProjectId] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const q = useQuery({
    queryKey: ["crm-dashboard", projectId],
    queryFn: () => crmGet<any>(`/api/crm/dashboard${projectId ? `?projectId=${projectId}` : ""}`),
  });

  const d = q.data ?? {};
  const alerts = d.alerts ?? {};
  const metrics = d.metrics ?? {};
  const payments = d.payments ?? {};
  const due = n0(payments.TotalDue);
  const paid = n0(payments.TotalPaid);
  const withFinance = n0(payments.WithFinance);
  const outstanding = Math.max(0, due - paid - withFinance);

  const openRegister = (key?: string) => {
    const reg = key ? registerByKey(key) : undefined;
    if (reg && reg.pages.some((p) => canAccessPage(p))) nav.navigate("CrmRegister", { register: reg.key });
  };
  const opens = (key?: string) => { const reg = key ? registerByKey(key) : undefined; return !!reg && reg.pages.some((p) => canAccessPage(p)); };

  const attention = ATTENTION.filter((a) => n0(alerts[a.key]) > 0);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: 16, paddingBottom: 96 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await q.refetch(); setRefreshing(false); }} tintColor={CRM} />}
    >
      {(d.projects ?? []).length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 12 }}>
          {[{ Id: null, Name: "All projects" }, ...d.projects].map((p: { Id: number | null; Name: string }) => {
            const active = p.Id === projectId;
            return (
              <Pressable key={String(p.Id)} onPress={() => setProjectId(p.Id)}
                style={{ paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: active ? `${CRM}80` : colors.border, backgroundColor: active ? `${CRM}22` : colors.card }}>
                <Text style={{ fontSize: 12, fontFamily: fonts.body.medium, color: active ? colors.foreground : colors.mutedForeground }}>{p.Name}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}

      {q.isLoading ? (
        <ActivityIndicator color={colors.mutedForeground} style={{ paddingVertical: 60 }} />
      ) : q.error ? (
        <Text style={{ color: colors.destructive, fontSize: 12, fontFamily: fonts.body.regular }}>{(q.error as Error).message}</Text>
      ) : (
        <>
          <View style={{ gap: 10, marginBottom: 12 }}>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Figure label="Due" value={money(due)} tone="#3b82f6" />
              <Figure label="Paid" value={money(paid)} tone="#10b981" sub={due ? `${Math.round((paid / due) * 100)}% of due` : undefined} />
            </View>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Figure label="With Finance" value={money(withFinance)} tone="#8b5cf6" />
              <Figure label="Outstanding" value={money(outstanding)} tone="#f59e0b" sub={n0(payments.OverdueCount) ? `${payments.OverdueCount} overdue` : undefined}
                onPress={opens("demands") ? () => openRegister("demands") : undefined} />
            </View>
          </View>

          <Section title="Needs attention">
            {attention.length === 0 ? (
              <Text style={{ fontSize: 12, fontFamily: fonts.body.regular, color: colors.mutedForeground, paddingVertical: 10 }}>Nothing needs attention.</Text>
            ) : attention.map((a) => (
              <LinkRow key={a.key} title={a.label} sub={a.note}
                right={<Text style={{ fontSize: 16, fontFamily: fonts.heading.bold, color: a.hot ? "#ef4444" : colors.foreground, fontVariant: ["tabular-nums"] }}>{n0(alerts[a.key])}</Text>}
                onPress={opens(a.register) ? () => openRegister(a.register) : undefined} />
            ))}
          </Section>

          <Section title="This month and next">
            <Kv label="Units sold this month" value={String(n0(metrics.unitsSoldThisMonth))} strong />
            <Kv label="Booking value this month" value={money(metrics.revenueThisMonth)} strong />
            <Kv label={`Falling due in 30 days (${n0(metrics.forwardDueCount)} milestone${n0(metrics.forwardDueCount) === 1 ? "" : "s"})`} value={money(metrics.forwardDue30Days)} strong />
          </Section>

          {(metrics.collectionPerProject ?? []).length ? (
            <Section title="Collection per project">
              {metrics.collectionPerProject.map((p: any) => {
                const pct = n0(p.TotalDue) ? Math.min(100, (n0(p.TotalPaid) / n0(p.TotalDue)) * 100) : 0;
                return (
                  <View key={p.ProjectName} style={{ paddingVertical: 8 }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
                      <Text numberOfLines={1} style={{ flex: 1, fontSize: 12.5, fontFamily: fonts.heading.semibold, color: colors.foreground }}>{p.ProjectName}</Text>
                      <Text style={{ fontSize: 11.5, fontFamily: fonts.body.medium, color: colors.mutedForeground, fontVariant: ["tabular-nums"] }}>{money(p.TotalPaid)} / {money(p.TotalDue)}</Text>
                    </View>
                    <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.muted, marginTop: 6, overflow: "hidden" }}>
                      <View style={{ width: `${pct}%`, height: 6, backgroundColor: "#10b981" }} />
                    </View>
                    {n0(p.OverdueCount) ? <Text style={{ fontSize: 10.5, fontFamily: fonts.body.regular, color: "#ef4444", marginTop: 3 }}>{p.OverdueCount} overdue</Text> : null}
                  </View>
                );
              })}
            </Section>
          ) : null}

          {d.funnel ? (
            <Section title="Pipeline">
              <Kv label="Applications" value={String(n0(d.funnel.Applications))} />
              <Kv label="Bookings" value={String(n0(d.funnel.Bookings))} />
              <Kv label="Agreements" value={String(n0(d.funnel.Agreements))} />
              <Kv label="Possessions" value={String(n0(d.funnel.Possessions))} />
            </Section>
          ) : null}

          {(d.thisWeek ?? []).length ? (
            <Section title="Seven-day lookahead">
              {d.thisWeek.map((w: any) => {
                const parts = [
                  n0(w.Handovers) && `${w.Handovers} handover${n0(w.Handovers) === 1 ? "" : "s"}`,
                  n0(w.Registries) && `${w.Registries} registr${n0(w.Registries) === 1 ? "y" : "ies"}`,
                  n0(w.MilestonesDue) && `${w.MilestonesDue} payment${n0(w.MilestonesDue) === 1 ? "" : "s"} due`,
                ].filter(Boolean);
                return <Kv key={w.DayDate} label={w.DayLabel} value={parts.length ? parts.join(" · ") : "—"} />;
              })}
            </Section>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}
