// The bell: the person's CRM notifications — from the same list as the web's bell (backend/routes/saNotifications.js),
// the CRM ones only (payments due, tickets, agreements, deeds, SLA reminders; isCrmNotification) — and, for
// Maintenance staff, the Maintenance alerts
// (hooks/useMaintenanceAlerts.ts). Tapping one opens what it is about (navigationRef.ts notificationTarget) and marks
// it read; "Mark all read" does the same as the web's.
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { AlertTriangle, Bell, ChevronRight, Clock, Info } from "lucide-react-native";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fonts } from "@/theme/fonts";
import { colors, accent } from "@/theme/colors";
import { fetchWithAuth } from "@/services/fetchWithAuth";
import { navigate, notificationTarget } from "@/navigation/navigationRef";
import { useMaintenanceAlerts, type MaintenanceAlertType } from "@/hooks/useMaintenanceAlerts";
import { Tap, useCardStyle } from "@/screens/crm/ui";



export interface BellItem { id: number; type: string; title: string; body: string | null; refId: number | null; refType: string | null; isRead: boolean; createdAt: string }

const NOTIFICATIONS_KEY = ["sa-notifications"];

/** A CRM notification, by the type the server gives it (services/notify.js callers): crm_*, the CRM SLA engine's sla_*,
 * service tickets, payment demands / overdue and handovers. Other modules' alerts (Legal, Sales Automation leads)
 * stay on the web bell. */
export const isCrmNotification = (type: string) => /^(crm_|sla_|service_ticket_|payment_|handover_)/.test(type);
async function fetchNotifications(): Promise<BellItem[]> {
  const res = await fetchWithAuth("/api/sa/notifications");
  if (!res.ok) throw new Error("Could not load notifications.");
  return res.json();
}

/** The person's notifications, refreshed every minute while the app is open. */
export function useCrmNotifications() {
  return useQuery({
    queryKey: NOTIFICATIONS_KEY, queryFn: fetchNotifications, staleTime: 30_000, refetchInterval: 60_000,
    select: (all) => all.filter((n) => isCrmNotification(n.type)),
  });
}

/** The bell's number: unread notifications plus Maintenance alerts. */
export function useBellCount() {
  const { data } = useCrmNotifications();
  const { alerts } = useMaintenanceAlerts();
  return (data ?? []).filter((n) => !n.isRead).length + alerts.length;
}

// The server keeps these times as its wall-clock time, sent with a "Z" as if they were UTC (the same as the web's gate
// times, src/utils/vehicleInOutDocument.ts). So they are compared with the phone's own wall-clock time, read the same
// way — the phone and the office keep the same clock.
const wallNow = () => Date.now() - new Date().getTimezoneOffset() * 60_000;
const fmtRelative = (d?: string | null) => {
  if (!d) return "";
  const mins = Math.floor((wallNow() - new Date(d).getTime()) / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "UTC" });
};

const META: Record<MaintenanceAlertType, { icon: React.ComponentType<{ size?: number; color?: string }>; color: string; label: string }> = {
  reading_due: { icon: Clock, color: "#fbbf24", label: "Reading" },
  not_checked_in: { icon: AlertTriangle, color: "#f87171", label: "Attendance" },
  info: { icon: Info, color: "#60a5fa", label: "Info" },
};

function SectionTitle({ children, right }: { children: string; right?: React.ReactNode }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 8, marginBottom: 10 }}>
      <Text style={{ fontSize: 17, fontFamily: fonts.heading.semibold, letterSpacing: -0.2, color: colors.foreground }}>{children}</Text>
      {right}
    </View>
  );
}

function Item({ title, body, time, tag, tagColor, unread, Icon, onPress }: {
  title: string; body?: string | null; time?: string | null; tag: string; tagColor: string; unread?: boolean;
  Icon: React.ComponentType<{ size?: number; color?: string }>; onPress: () => void;
}) {
  const card = useCardStyle();
  return (
    <Tap onPress={onPress}
      style={({ pressed }) => ({ ...card, flexDirection: "row", gap: 12, padding: 16, marginBottom: 10, opacity: pressed ? 0.75 : 1 })}>
      <View style={{ width: 40, height: 40, borderRadius: 13, backgroundColor: `${tagColor}1f`, alignItems: "center", justifyContent: "center" }}>
        <Icon size={16} color={tagColor} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          {unread ? <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: tagColor }} /> : null}
          <Text numberOfLines={2} style={{ flex: 1, fontSize: 13, fontFamily: unread ? fonts.heading.semibold : fonts.body.medium, color: colors.foreground }}>{title}</Text>
          {time ? <Text style={{ fontSize: 10, fontFamily: fonts.body.medium, color: colors.mutedForeground }}>{fmtRelative(time)}</Text> : null}
        </View>
        {body ? <Text numberOfLines={3} style={{ fontSize: 11.5, fontFamily: fonts.body.regular, color: colors.mutedForeground, marginTop: 3, lineHeight: 16 }}>{body}</Text> : null}
        <Text style={{ fontSize: 9, fontFamily: fonts.heading.semibold, color: tagColor, textTransform: "uppercase", letterSpacing: 0.6, marginTop: 6 }}>{tag}</Text>
      </View>
      <ChevronRight size={14} color={colors.mutedForeground} style={{ marginTop: 2 }} />
    </Tap>
  );
}

export default function NotificationsScreen() {
  const qc = useQueryClient();
  const crmQ = useCrmNotifications();
  const { alerts, isLoading: alertsLoading, refetch: refetchAlerts } = useMaintenanceAlerts();
  const [refreshing, setRefreshing] = useState(false);
  const items = crmQ.data ?? [];
  const unread = items.filter((n) => !n.isRead).length;

  const markRead = (id: number) => {
    qc.setQueryData<BellItem[]>(NOTIFICATIONS_KEY, (old) => old?.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
    fetchWithAuth(`/api/sa/notifications/${id}/read`, { method: "PUT" }).catch(() => {});
  };
  // Only the CRM ones shown here — the web bell's other modules' alerts stay unread for the web.
  const markAllRead = async () => {
    const ids = items.filter((n) => !n.isRead).map((n) => n.id);
    qc.setQueryData<BellItem[]>(NOTIFICATIONS_KEY, (old) => old?.map((n) => (ids.includes(n.id) ? { ...n, isRead: true } : n)));
    await Promise.all(ids.map((id) => fetchWithAuth(`/api/sa/notifications/${id}/read`, { method: "PUT" }).catch(() => {})));
    crmQ.refetch();
  };
  const open = (n: BellItem) => {
    if (!n.isRead) markRead(n.id);
    const t = notificationTarget(n);
    if (t.route !== "Notifications") navigate(t.route as never, t.params as never);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([crmQ.refetch(), refetchAlerts()]);
    setRefreshing(false);
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={accent} />}
    >
      <Text style={{ fontSize: 12, fontFamily: fonts.body.regular, color: colors.mutedForeground, marginBottom: 6 }}>
        {unread + alerts.length === 0 ? "All caught up." : `${unread} unread${alerts.length ? ` · ${alerts.length} Maintenance alert${alerts.length === 1 ? "" : "s"}` : ""}`}
      </Text>

      <SectionTitle right={unread > 0 ? (
        <Pressable onPress={markAllRead} hitSlop={8}><Text style={{ fontSize: 12, fontFamily: fonts.heading.semibold, color: accent }}>Mark all read</Text></Pressable>
      ) : undefined}>CRM</SectionTitle>
      {crmQ.isLoading ? (
        <ActivityIndicator color={colors.mutedForeground} style={{ paddingVertical: 24 }} />
      ) : crmQ.error ? (
        <Text style={{ color: colors.destructive, fontSize: 12, fontFamily: fonts.body.regular }}>{(crmQ.error as Error).message}</Text>
      ) : items.length === 0 ? (
        <Text style={{ fontSize: 12, fontFamily: fonts.body.regular, color: colors.mutedForeground, paddingVertical: 12 }}>No CRM notifications yet.</Text>
      ) : items.map((n) => (
        <Item key={n.id} title={n.title} body={n.body} time={n.createdAt} tag="CRM" tagColor={accent} unread={!n.isRead} Icon={Bell} onPress={() => open(n)} />
      ))}

      {alertsLoading || alerts.length ? <SectionTitle>Maintenance</SectionTitle> : null}
      {alertsLoading ? <ActivityIndicator color={colors.mutedForeground} style={{ paddingVertical: 24 }} /> : alerts.map((a) => {
        const m = META[a.type];
        return <Item key={a.id} title={a.title} body={a.subtitle} time={a.time} tag={m.label} tagColor={m.color} unread Icon={m.icon}
          onPress={() => navigate(a.route as never, a.params as never)} />;
      })}
    </ScrollView>
  );
}
