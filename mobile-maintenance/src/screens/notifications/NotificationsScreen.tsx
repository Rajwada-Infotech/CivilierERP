// Client-derived alerts for the Maintenance app — see
// hooks/useMaintenanceAlerts.ts — dark-card styling to match the app shell.
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { AlertTriangle, Bell, ChevronRight, Clock, Info } from "lucide-react-native";
import { useState } from "react";
import { fonts } from "@/theme/fonts";
import { colors } from "@/theme/colors";
import { navigate } from "@/navigation/navigationRef";
import { useMaintenanceAlerts, type MaintenanceAlertType } from "@/hooks/useMaintenanceAlerts";

const fmtRelative = (d?: string | null) => {
  if (!d) return "";
  const days = Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
};

const META: Record<MaintenanceAlertType, { icon: React.ComponentType<{ size?: number; color?: string }>; color: string; wash: string; border: string; label: string }> = {
  reading_due: { icon: Clock, color: "#fbbf24", wash: "rgba(245,158,11,0.08)", border: "rgba(245,158,11,0.22)", label: "Reading" },
  not_checked_in: { icon: AlertTriangle, color: "#f87171", wash: "rgba(248,113,113,0.08)", border: "rgba(248,113,113,0.22)", label: "Attendance" },
  info: { icon: Info, color: "#60a5fa", wash: "rgba(96,165,250,0.08)", border: "rgba(96,165,250,0.22)", label: "Info" },
};

export default function NotificationsScreen() {
  const { alerts, isLoading, refetch } = useMaintenanceAlerts();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  return (
    <ScrollView
      className="flex-1"
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#65a30d" />}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <Bell size={17} color="#65a30d" />
        <Text style={{ fontSize: 17, fontFamily: fonts.heading.bold, color: colors.foreground }}>Notifications</Text>
      </View>
      <Text style={{ fontSize: 11.5, fontFamily: fonts.body.regular, color: colors.mutedForeground, marginBottom: 18 }}>
        {alerts.length === 0 ? "All caught up" : `${alerts.length} alert${alerts.length !== 1 ? "s" : ""} need attention`}
      </Text>

      {isLoading ? (
        <View style={{ paddingVertical: 40, alignItems: "center" }}>
          <ActivityIndicator color={colors.mutedForeground} />
        </View>
      ) : alerts.length === 0 ? (
        <View
          className="items-center justify-center gap-2"
          style={{ paddingVertical: 48, borderRadius: 14, borderWidth: 1, borderStyle: "dashed", borderColor: colors.border }}
        >
          <View style={{ width: 48, height: 48, borderRadius: 16, backgroundColor: "rgba(101,163,13,0.10)", alignItems: "center", justifyContent: "center", marginBottom: 4 }}>
            <Bell size={22} color="#65a30d" />
          </View>
          <Text style={{ fontSize: 13, fontFamily: fonts.heading.semibold, color: colors.foreground }}>All clear!</Text>
          <Text style={{ fontSize: 11, fontFamily: fonts.body.regular, color: colors.mutedForeground, textAlign: "center", maxWidth: 240 }}>
            No pending Maintenance alerts right now.
          </Text>
        </View>
      ) : (
        <View style={{ gap: 10 }}>
          {alerts.map((alert) => {
            const m = META[alert.type];
            const Icon = m.icon;
            return (
              <Pressable
                key={alert.id}
                onPress={() => navigate(alert.route as never, alert.params as never)}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "flex-start",
                  gap: 12,
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: pressed ? m.color : m.border,
                  backgroundColor: pressed ? m.wash : colors.card,
                  padding: 14,
                })}
              >
                <View style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: m.wash, alignItems: "center", justifyContent: "center" }}>
                  <Icon size={16} color={m.color} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 3 }}>
                    <Text numberOfLines={1} style={{ flex: 1, fontSize: 12.5, fontFamily: fonts.heading.semibold, color: colors.foreground }}>
                      {alert.title}
                    </Text>
                    {alert.time && (
                      <Text style={{ fontSize: 9.5, fontFamily: fonts.body.medium, color: colors.mutedForeground }}>{fmtRelative(alert.time)}</Text>
                    )}
                  </View>
                  <Text numberOfLines={2} style={{ fontSize: 11, fontFamily: fonts.body.regular, color: colors.mutedForeground, lineHeight: 15 }}>
                    {alert.subtitle}
                  </Text>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 8 }}>
                    <Text style={{ fontSize: 9, fontFamily: fonts.heading.semibold, color: m.color, textTransform: "uppercase", letterSpacing: 0.5 }}>
                      {m.label}
                    </Text>
                  </View>
                </View>
                <ChevronRight size={14} color={colors.mutedForeground} style={{ marginTop: 2 }} />
              </Pressable>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}
