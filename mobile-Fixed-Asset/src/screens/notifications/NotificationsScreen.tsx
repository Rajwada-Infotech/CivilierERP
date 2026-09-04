// Client-derived alerts for the Fixed Asset app. Stub list for now
// (see hooks/useFaAlerts.ts) — dark-card styling to match the app shell.
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { AlertTriangle, Bell, ChevronRight, Clock, Info } from "lucide-react-native";
import { useState } from "react";
import { fonts } from "@/theme/fonts";
import { colors } from "@/theme/colors";
import { navigate } from "@/navigation/navigationRef";
import { useFaAlerts, type FaAlertType } from "@/hooks/useFaAlerts";

const fmtRelative = (d?: string | null) => {
  if (!d) return "";
  const days = Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
};

const META: Record<FaAlertType, { icon: React.ComponentType<{ size?: number; color?: string }>; color: string; wash: string; border: string; label: string }> = {
  followup_due: { icon: Clock, color: "#fbbf24", wash: "rgba(245,158,11,0.08)", border: "rgba(245,158,11,0.22)", label: "Follow-up" },
  draft_pending: { icon: AlertTriangle, color: "#f87171", wash: "rgba(248,113,113,0.08)", border: "rgba(248,113,113,0.22)", label: "Draft" },
  info: { icon: Info, color: "#60a5fa", wash: "rgba(96,165,250,0.08)", border: "rgba(96,165,250,0.22)", label: "Info" },
};

export default function NotificationsScreen() {
  const { alerts, isLoading, refetch } = useFaAlerts();
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
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#eab308" />}
    >
      <View className="flex-row items-center gap-2 mb-1">
        <Bell size={16} color="#eab308" />
        <Text style={{ fontSize: 16, fontFamily: fonts.heading.bold, color: colors.foreground }}>Notifications</Text>
      </View>
      <Text style={{ fontSize: 11, fontFamily: fonts.body.regular, color: colors.mutedForeground, marginBottom: 16 }}>
        {alerts.length === 0 ? "All caught up" : `${alerts.length} alert${alerts.length !== 1 ? "s" : ""}`}
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
          <View style={{ width: 48, height: 48, borderRadius: 16, backgroundColor: "rgba(234,179,8,0.10)", alignItems: "center", justifyContent: "center", marginBottom: 4 }}>
            <Bell size={22} color="#eab308" />
          </View>
          <Text style={{ fontSize: 13, fontFamily: fonts.heading.semibold, color: colors.foreground }}>All clear!</Text>
          <Text style={{ fontSize: 11, fontFamily: fonts.body.regular, color: colors.mutedForeground, textAlign: "center", maxWidth: 240 }}>
            No pending Fixed Asset alerts right now.
          </Text>
        </View>
      ) : (
        <View style={{ gap: 8 }}>
          {alerts.map((alert) => {
            const m = META[alert.type];
            const Icon = m.icon;
            return (
              <Pressable
                key={alert.id}
                onPress={() => navigate(alert.route as never, alert.params as never)}
                className="flex-row items-center gap-3"
                style={{ borderRadius: 12, borderWidth: 1, borderColor: m.border, backgroundColor: colors.card, padding: 12 }}
              >
                <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: m.wash, alignItems: "center", justifyContent: "center" }}>
                  <Icon size={15} color={m.color} />
                </View>
                <View className="flex-1 min-w-0">
                  <Text numberOfLines={1} style={{ fontSize: 12, fontFamily: fonts.heading.semibold, color: colors.foreground }}>
                    {alert.title}
                  </Text>
                  <Text numberOfLines={1} style={{ fontSize: 11, fontFamily: fonts.body.regular, color: colors.mutedForeground, marginTop: 2 }}>
                    {alert.subtitle}
                  </Text>
                </View>
                {alert.time && (
                  <Text style={{ fontSize: 9, fontFamily: fonts.body.regular, color: "#5c6270" }}>{fmtRelative(alert.time)}</Text>
                )}
                <ChevronRight size={14} color="#5c6270" />
              </Pressable>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}
