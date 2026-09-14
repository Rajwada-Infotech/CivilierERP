// RN port of src/pages/supplier/SupplierNotifications.tsx (web) — same
// client-derived alert list (see useSupplierAlerts.ts), dark-card styling
// to match the rest of the authenticated app shell.
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  ChevronRight,
  Clock,
  FileText,
  Package,
  Zap,
} from "lucide-react-native";
import { useState } from "react";
import { fonts } from "@/theme/fonts";
import { navigate } from "@/navigation/navigationRef";
import { useSupplierAlerts, type SupplierAlertType } from "@/hooks/useSupplierAlerts";

const fmtDate = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const fmtRelative = (d?: string | null) => {
  if (!d) return "";
  const diff = Date.now() - new Date(d).getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return fmtDate(d);
};

const META: Record<
  SupplierAlertType,
  { icon: React.ComponentType<{ size?: number; color?: string }>; color: string; wash: string; border: string; label: string }
> = {
  overdue: { icon: AlertTriangle, color: "#f87171", wash: "rgba(248,113,113,0.08)", border: "rgba(248,113,113,0.22)", label: "Overdue" },
  due_soon: { icon: Clock, color: "#fbbf24", wash: "rgba(245,158,11,0.08)", border: "rgba(245,158,11,0.22)", label: "Due Soon" },
  new: { icon: Zap, color: "#60a5fa", wash: "rgba(96,165,250,0.08)", border: "rgba(96,165,250,0.22)", label: "New" },
  submitted: { icon: CheckCircle2, color: "#6ee7b7", wash: "rgba(16,185,129,0.08)", border: "rgba(16,185,129,0.22)", label: "Submitted" },
  goods_pending: { icon: Package, color: "#fbbf24", wash: "rgba(245,158,11,0.08)", border: "rgba(245,158,11,0.22)", label: "Pending Delivery" },
};

export default function NotificationsScreen() {
  const { alerts, isLoading, refetch } = useSupplierAlerts();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  return (
    <ScrollView
      className="flex-1"
      style={{ backgroundColor: "#0c0c12" }}
      contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#6ee7b7" />}
    >
      <View className="flex-row items-center gap-2 mb-1">
        <Bell size={16} color="#6ee7b7" />
        <Text style={{ fontSize: 16, fontFamily: fonts.heading.bold, color: "#e7e9ef" }}>Notifications</Text>
      </View>
      <Text style={{ fontSize: 11, fontFamily: fonts.body.regular, color: "#818898", marginBottom: 16 }}>
        {alerts.length === 0 ? "All caught up" : `${alerts.length} alert${alerts.length !== 1 ? "s" : ""} require attention`}
      </Text>

      {isLoading ? (
        <View style={{ paddingVertical: 40, alignItems: "center" }}>
          <ActivityIndicator color="#818898" />
        </View>
      ) : alerts.length === 0 ? (
        <View
          className="items-center justify-center gap-2"
          style={{ paddingVertical: 48, borderRadius: 14, borderWidth: 1, borderStyle: "dashed", borderColor: "#272735" }}
        >
          <View style={{ width: 48, height: 48, borderRadius: 16, backgroundColor: "rgba(16,185,129,0.10)", alignItems: "center", justifyContent: "center", marginBottom: 4 }}>
            <Bell size={22} color="#6ee7b7" />
          </View>
          <Text style={{ fontSize: 13, fontFamily: fonts.heading.semibold, color: "#e7e9ef" }}>All clear!</Text>
          <Text style={{ fontSize: 11, fontFamily: fonts.body.regular, color: "#818898", textAlign: "center", maxWidth: 220 }}>
            No pending alerts. You'll be notified when new RFQs arrive.
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
                onPress={() => navigate(alert.route, alert.params)}
                className="flex-row items-center gap-3"
                style={{ borderRadius: 12, borderWidth: 1, borderColor: m.border, backgroundColor: "#15151e", padding: 12 }}
              >
                <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: m.wash, alignItems: "center", justifyContent: "center" }}>
                  <Icon size={15} color={m.color} />
                </View>
                <View className="flex-1 min-w-0">
                  <View className="flex-row items-center flex-wrap gap-1.5">
                    <Text style={{ fontSize: 12, fontFamily: fonts.heading.semibold, color: "#e7e9ef" }} numberOfLines={1}>
                      {alert.title}
                    </Text>
                    <View style={{ backgroundColor: m.wash, paddingHorizontal: 6, paddingVertical: 1.5, borderRadius: 999 }}>
                      <Text style={{ fontSize: 9, fontFamily: fonts.heading.bold, color: m.color }}>{m.label}</Text>
                    </View>
                  </View>
                  <Text style={{ fontSize: 11, fontFamily: fonts.body.regular, color: "#818898", marginTop: 2 }} numberOfLines={1}>
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

      {!isLoading && alerts.length > 0 && (
        <View className="flex-row items-center justify-center gap-1.5" style={{ marginTop: 16 }}>
          <FileText size={10} color="#5c6270" />
          <Text style={{ fontSize: 10, fontFamily: fonts.body.regular, color: "#5c6270" }}>
            Alerts are generated from your active RFQ list
          </Text>
        </View>
      )}
    </ScrollView>
  );
}
