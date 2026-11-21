// Home, laid out like Civilier Home's: the deep hero card — a greeting and the collection (how much of what is due has
// come in, a ring) — then what is waiting for the person (approvals, unread notifications), what needs attention
// (the CRM Dashboard's own list, CrmDashboardScreen.tsx), and tiles for the lists they work most. Each part shows
// only to staff with a right on it.
import { Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Bell, Building2, Inbox, LayoutDashboard, PhoneCall, ReceiptIndianRupee, Ticket, Wrench, type LucideIcon } from "lucide-react-native";
import { useAuth } from "@/auth/AuthContext";
import { fetchInbox } from "@/api/approvalInboxApi";
import type { MainStackParamList } from "@/navigation/MainStack";
import { openTab, TAB_LISTS } from "@/navigation/navigationRef";
import { roleText } from "@/navigation/TopHeader";
import { useBrand } from "@/theme/ThemeContext";
import { fonts } from "@/theme/fonts";
import { formatCompactINR } from "@/utils/formatCurrency";
import { useMaintenanceAlerts } from "@/hooks/useMaintenanceAlerts";
import { useCrmNotifications } from "@/screens/notifications/NotificationsScreen";
import { AttentionList, useCrmDashboard } from "@/screens/crm/CrmDashboardScreen";
import { useHasMaintenance } from "@/screens/dashboard/MaintenanceScreen";
import { registerByKey } from "@/screens/crm/crmRegisters";
import { ActionBanner, ErrorText, Heading, HeroSurface, ON_HERO, Page, Ring, Tap, money, useCardStyle } from "@/screens/crm/ui";

// The tiles: the lists staff open most (each needs its page right, crmRegisters.ts) and the dashboard. Bookings is on
// the tab bar, so it isn't a tile.
const TILES: { register?: string; dashboard?: true; icon: LucideIcon; label?: string; alert?: string }[] = [
  { register: "welcome-calls", icon: PhoneCall, alert: "welcomeCallPending" },
  { register: "demands", icon: ReceiptIndianRupee, alert: "overduePayments" },
  { register: "service-tickets", icon: Ticket, alert: "urgentTickets" },
  { register: "customer-360", icon: Building2 },
  { dashboard: true, icon: LayoutDashboard, label: "CRM Dashboard" },
];

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
};
const n0 = (v: unknown) => Number(v) || 0;
/** ₹6.1Cr — a short figure for the hero card. */
const short = (v: unknown) => `₹${formatCompactINR(v)}`;

export default function HomeScreen() {
  const b = useBrand();
  const card = useCardStyle();
  const nav = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const { currentUser, canAccessPage } = useAuth();
  const canApprove = canAccessPage("approval-inbox");
  const seesDashboard = canAccessPage("crm-dashboard");
  const hasMaintenance = useHasMaintenance();

  const inboxQ = useQuery({ queryKey: ["approval-inbox"], queryFn: fetchInbox, enabled: canApprove, staleTime: 30_000 });
  const waiting = (inboxQ.data ?? []).filter((i) => i._canAct !== false).length;
  const dashQ = useCrmDashboard(null, seesDashboard);
  const notesQ = useCrmNotifications();
  const unread = (notesQ.data ?? []).filter((n) => !n.isRead).length;
  const { alerts } = useMaintenanceAlerts();

  const pay = dashQ.data?.payments ?? {};
  const due = n0(pay.TotalDue);
  const paid = n0(pay.TotalPaid);
  const withFinance = n0(pay.WithFinance);
  const outstanding = Math.max(0, due - paid - withFinance);
  const pct = due ? Math.round((paid / due) * 100) : 0;
  const dashAlerts = dashQ.data?.alerts ?? {};

  const tiles = TILES.map((t) => {
    if (t.dashboard) return seesDashboard ? { key: "dash", label: t.label!, icon: t.icon, count: 0, open: () => nav.navigate("CrmDashboard") } : null;
    const reg = registerByKey(t.register!)!;
    if (!reg.pages.some((p) => canAccessPage(p))) return null;
    // A list with its own tab opens that tab; any other opens over Home.
    const open = TAB_LISTS.includes(reg.key) ? () => openTab("Bookings") : () => nav.navigate("CrmRegister", { register: reg.key });
    return { key: reg.key, label: reg.label, icon: t.icon, count: t.alert ? n0(dashAlerts[t.alert]) : 0, open };
  }).filter((t): t is NonNullable<typeof t> => !!t);

  const firstName = (currentUser?.name || "").split(" ")[0];

  return (
    <Page tab gap={14} onRefresh={() => Promise.all([canApprove && inboxQ.refetch(), seesDashboard && dashQ.refetch(), notesQ.refetch()])}>
      <HeroSurface>
        <Text style={{ fontSize: 13, fontFamily: fonts.body.medium, color: ON_HERO.secondary }}>
          {new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}
        </Text>
        <Text style={{ fontSize: 25, fontFamily: fonts.heading.semibold, color: ON_HERO.primary, letterSpacing: -0.4, marginTop: 4 }}>
          {greeting()}{firstName ? `, ${firstName}` : ""}
        </Text>
        <Text style={{ fontSize: 13.5, fontFamily: fonts.body.regular, color: ON_HERO.secondary, marginTop: 2 }}>{roleText(currentUser?.role)}</Text>

        {seesDashboard && dashQ.data ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 18, marginTop: 18 }}>
            <Ring pct={pct} size={92} stroke={9} color={b.accent} track={ON_HERO.glass}>
              <Text style={{ fontSize: 20, fontFamily: fonts.heading.semibold, color: ON_HERO.primary }}>{pct}%</Text>
              <Text style={{ fontSize: 10.5, fontFamily: fonts.body.medium, color: ON_HERO.secondary }}>collected</Text>
            </Ring>
            <View style={{ flex: 1, gap: 8 }}>
              <View>
                <Text style={{ fontSize: 12, fontFamily: fonts.body.medium, color: ON_HERO.secondary }}>Paid of {short(due)} due</Text>
                <Text style={{ fontSize: 22, fontFamily: fonts.heading.semibold, color: ON_HERO.primary, letterSpacing: -0.3 }}>{money(paid)}</Text>
              </View>
              <View style={{ flexDirection: "row", gap: 14 }}>
                <View>
                  <Text style={{ fontSize: 11.5, fontFamily: fonts.body.medium, color: ON_HERO.secondary }}>Outstanding</Text>
                  <Text style={{ fontSize: 14.5, fontFamily: fonts.heading.semibold, color: ON_HERO.primary }}>{short(outstanding)}</Text>
                </View>
                <View>
                  <Text style={{ fontSize: 11.5, fontFamily: fonts.body.medium, color: ON_HERO.secondary }}>With Finance</Text>
                  <Text style={{ fontSize: 14.5, fontFamily: fonts.heading.semibold, color: ON_HERO.primary }}>{short(withFinance)}</Text>
                </View>
              </View>
            </View>
          </View>
        ) : null}
      </HeroSurface>

      {canApprove ? (
        <ActionBanner icon={Inbox} tone={waiting > 0 ? "accent" : "green"}
          title={inboxQ.isLoading ? "Checking approvals…" : waiting > 0 ? `${waiting} approval${waiting > 1 ? "s" : ""} waiting for you` : "No approvals waiting for you"}
          sub="Approval Inbox" onPress={() => nav.navigate("Approvals")} />
      ) : null}
      {unread > 0 ? (
        <ActionBanner icon={Bell} tone="amber" title={`${unread} unread notification${unread > 1 ? "s" : ""}`}
          sub="Payments due, tickets, agreements and reminders" onPress={() => nav.navigate("Notifications")} />
      ) : null}

      {seesDashboard ? (dashQ.error ? <ErrorText error={dashQ.error} /> : dashQ.data ? <AttentionList d={dashQ.data} /> : null) : null}

      {tiles.length ? (
        <>
          <Heading title="Quick access" />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
            {tiles.map((t) => (
              <Tap key={t.key} onPress={t.open} accessibilityRole="button" accessibilityLabel={t.label}
                style={({ pressed }) => ({ ...card, width: "48.4%", padding: 14, gap: 10, opacity: pressed ? 0.75 : 1 })}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                  <View style={{ width: 40, height: 40, borderRadius: 13, backgroundColor: b.accentSoft, alignItems: "center", justifyContent: "center" }}>
                    <t.icon size={20} color={b.accent} />
                  </View>
                  {t.count > 0 ? (
                    <View style={{ minWidth: 24, height: 24, borderRadius: 12, paddingHorizontal: 7, backgroundColor: b.danger, alignItems: "center", justifyContent: "center" }}>
                      <Text style={{ color: "#fff", fontSize: 12, fontFamily: fonts.heading.semibold }}>{t.count}</Text>
                    </View>
                  ) : null}
                </View>
                <Text numberOfLines={1} style={{ fontSize: 14.5, fontFamily: fonts.heading.semibold, color: b.textPrimary }}>{t.label}</Text>
              </Tap>
            ))}
          </View>
        </>
      ) : null}

      {hasMaintenance ? (
        <ActionBanner icon={Wrench} tone="green" title="Maintenance"
          sub={alerts.length ? `${alerts.length} alert${alerts.length > 1 ? "s" : ""} need attention` : "Directory, bills, attendance and electricity"}
          onPress={() => openTab("Maintenance")} />
      ) : null}
    </Page>
  );
}
