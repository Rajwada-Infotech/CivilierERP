// Notifications on the drawing sheet: the alerts useCwdAlerts derives (work sent back for rework, work on hold, notes),
// as a ruled register under the page's title block. Each alert opens what it is about.
import { useState } from "react";
import { Text, View } from "react-native";
import { ChevronRight } from "lucide-react-native";
import { fonts } from "@/theme/fonts";
import { sheet as S } from "@/theme/colors";
import { navigate } from "@/navigation/navigationRef";
import { useCwdAlerts, type CwdAlertType } from "@/hooks/useCwdAlerts";
import { Body, Press, RegisterHead, SheetMark, SheetShell, Skel, type MarkTone } from "@/components/sheet/Sheet";
import { SheetPage } from "@/components/sheet/Register";

const fmtRelative = (d?: string | null) => {
  if (!d) return "";
  const days = Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
};

const META: Record<CwdAlertType, { tone: MarkTone; label: string }> = {
  rework: { tone: "stopped", label: "Rework" },
  hold: { tone: "waiting", label: "On hold" },
  info: { tone: "draft", label: "Info" },
};

export default function NotificationsScreen() {
  const { alerts, isLoading, refetch } = useCwdAlerts();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  return (
    <SheetPage refreshing={refreshing} onRefresh={onRefresh}>
      <SheetShell
        eyebrow="Civil Work DPR"
        title="Notifications"
        subtitle={alerts.length === 0 ? "All caught up." : `${alerts.length} alert${alerts.length !== 1 ? "s" : ""} need attention.`}
      >
        <View>
          <RegisterHead title="Alerts" count={alerts.length} unit={["alert", "alerts"]} />
          {isLoading ? (
            <View style={{ paddingTop: 12 }}><Skel h={56} /><Skel h={56} /></View>
          ) : alerts.length === 0 ? (
            <Body size={13} color={S.graphite} style={{ paddingVertical: 20 }}>Nothing is waiting on rework or on hold.</Body>
          ) : (
            alerts.map((alert) => {
              const m = META[alert.type];
              return (
                <Press
                  key={alert.id}
                  onPress={() => navigate(alert.route as never, alert.params as never)}
                  style={(pressed) => ({ flexDirection: "row", alignItems: "flex-start", gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: S.ruleSoft, backgroundColor: pressed ? S.blueWash : "transparent" })}
                >
                  <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <Text numberOfLines={1} style={{ flex: 1, fontSize: 13.5, fontFamily: fonts.body.semibold, color: S.ink }}>{alert.title}</Text>
                      {!!alert.time && <Text style={{ fontSize: 11, fontFamily: fonts.heading.medium, color: S.graphite }}>{fmtRelative(alert.time)}</Text>}
                    </View>
                    <Body size={12} color={S.graphite} style={{ lineHeight: 17 }}>{alert.subtitle}</Body>
                    <SheetMark text={m.label} tone={m.tone} />
                  </View>
                  <ChevronRight size={14} color={S.graphite} style={{ marginTop: 3 }} />
                </Press>
              );
            })
          )}
        </View>
      </SheetShell>
    </SheetPage>
  );
}
