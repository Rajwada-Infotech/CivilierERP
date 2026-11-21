// Home: the day's work first. Approvals waiting for this person, then the CRM — the collection and what needs
// attention (the CRM Dashboard's own parts, CrmDashboardScreen.tsx) — the lists they work most, unread notifications
// and, for Maintenance staff, the Maintenance alerts. Each part shows only to staff with a right on it.
import { useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Bell, ChevronRight, Inbox, PhoneCall, ReceiptIndianRupee, Ticket, Wrench, ClipboardList, LayoutDashboard } from "lucide-react-native";
import { useAuth } from "@/auth/AuthContext";
import { fetchInbox } from "@/api/approvalInboxApi";
import type { MainStackParamList } from "@/navigation/MainStack";
import { openTab } from "@/navigation/navigationRef";
import { colors, moduleAccents } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { useMaintenanceAlerts } from "@/hooks/useMaintenanceAlerts";
import { useCrmNotifications } from "@/screens/notifications/NotificationsScreen";
import { AttentionList, MoneyFigures, useCrmDashboard } from "@/screens/crm/CrmDashboardScreen";
import { useHasMaintenance } from "@/screens/dashboard/MaintenanceScreen";
import { registerByKey } from "@/screens/crm/crmRegisters";
import { LinkRow, Section } from "@/screens/crm/ui";

const CRM = moduleAccents.crm;

// The lists staff open most, straight from Home (each needs its page right, crmRegisters.ts).
const SHORTCUTS: { register: string; icon: React.ComponentType<{ size?: number; color?: string }> }[] = [
  { register: "welcome-calls", icon: PhoneCall },
  { register: "demands", icon: ReceiptIndianRupee },
  { register: "bookings", icon: ClipboardList },
  { register: "service-tickets", icon: Ticket },
];

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
};

function Card({ icon: Icon, tone, title, sub, onPress, strong }: {
  icon: React.ComponentType<{ size?: number; color?: string }>; tone: string; title: string; sub: string; onPress: () => void; strong?: boolean;
}) {
  return (
    <Pressable onPress={onPress}
      style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 12, padding: 14, marginBottom: 12, borderRadius: 14,
        backgroundColor: colors.card, borderWidth: 1, borderColor: strong ? tone : colors.border, opacity: pressed ? 0.8 : 1 })}>
      <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: `${tone}1f`, alignItems: "center", justifyContent: "center" }}>
        <Icon size={19} color={tone} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 14, fontFamily: fonts.heading.semibold, color: colors.foreground }}>{title}</Text>
        <Text style={{ fontSize: 11.5, fontFamily: fonts.body.regular, color: colors.mutedForeground, marginTop: 1 }}>{sub}</Text>
      </View>
      <ChevronRight size={18} color={colors.mutedForeground} />
    </Pressable>
  );
}

export default function HomeScreen() {
  const nav = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const { currentUser, canAccessPage } = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  const canApprove = canAccessPage("approval-inbox");
  const seesDashboard = canAccessPage("crm-dashboard");
  const hasMaintenance = useHasMaintenance();

  const inboxQ = useQuery({ queryKey: ["approval-inbox"], queryFn: fetchInbox, enabled: canApprove, staleTime: 30_000 });
  const waiting = (inboxQ.data ?? []).filter((i) => i._canAct !== false).length;
  const dashQ = useCrmDashboard(null, seesDashboard);
  const notesQ = useCrmNotifications();
  const unread = (notesQ.data ?? []).filter((n) => !n.isRead).length;
  const { alerts } = useMaintenanceAlerts();
  const shortcuts = SHORTCUTS.map((s) => ({ ...s, reg: registerByKey(s.register)! })).filter((s) => s.reg.pages.some((p) => canAccessPage(p)));

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([canApprove && inboxQ.refetch(), seesDashboard && dashQ.refetch(), notesQ.refetch()]);
    setRefreshing(false);
  };

  const firstName = (currentUser?.name || "").split(" ")[0];

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={CRM} />}
    >
      <Text style={{ fontSize: 20, fontFamily: fonts.heading.bold, color: colors.foreground }}>{greeting()}{firstName ? `, ${firstName}` : ""}</Text>
      <Text style={{ fontSize: 12, fontFamily: fonts.body.regular, color: colors.mutedForeground, marginTop: 2, marginBottom: 16 }}>
        {new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
      </Text>

      {canApprove ? (
        <Card icon={Inbox} tone={waiting > 0 ? CRM : colors.mutedForeground} strong={waiting > 0}
          title={inboxQ.isLoading ? "Checking approvals…" : waiting > 0 ? `${waiting} approval${waiting > 1 ? "s" : ""} waiting for you` : "No approvals waiting for you"}
          sub="Approval Inbox" onPress={() => openTab("Approvals")} />
      ) : null}

      {unread > 0 ? (
        <Card icon={Bell} tone="#f59e0b" title={`${unread} unread notification${unread > 1 ? "s" : ""}`} sub="Payments due, tickets, agreements and reminders"
          onPress={() => nav.navigate("Notifications")} />
      ) : null}

      {seesDashboard ? (
        dashQ.isLoading ? <ActivityIndicator color={colors.mutedForeground} style={{ paddingVertical: 30 }} />
          : dashQ.error ? <Text style={{ color: colors.destructive, fontSize: 12, fontFamily: fonts.body.regular, marginBottom: 12 }}>{(dashQ.error as Error).message}</Text>
          : (
            <>
              <MoneyFigures d={dashQ.data} />
              <AttentionList d={dashQ.data} />
            </>
          )
      ) : null}

      {shortcuts.length || seesDashboard ? (
        <Section title="Go to">
          {seesDashboard ? <LinkRow title="CRM Dashboard" icon={LayoutDashboard} onPress={() => nav.navigate("CrmDashboard")} /> : null}
          {shortcuts.map((s) => (
            <LinkRow key={s.register} title={s.reg.label} icon={s.icon} onPress={() => nav.navigate("CrmRegister", { register: s.register })} />
          ))}
        </Section>
      ) : null}

      {hasMaintenance ? (
        <Card icon={Wrench} tone="#65a30d" title="Maintenance"
          sub={alerts.length ? `${alerts.length} alert${alerts.length > 1 ? "s" : ""} need attention` : "Directory, bills, attendance and electricity"}
          onPress={() => openTab("Maintenance")} />
      ) : null}
    </ScrollView>
  );
}
