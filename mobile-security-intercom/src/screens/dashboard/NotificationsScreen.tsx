// Opened from the header's bell: what needs this person now (see notifications/useSecurityNotifications.ts).
// Residents and guards see visitor requests still waiting; security admins see alerts nobody has acknowledged yet, and
// can acknowledge them here.
import { useCallback, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { markNotificationsSeen } from "@/notifications/seenStore";
import { View, Text, ScrollView, RefreshControl, Alert } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { MainStackParamList } from "@/navigation/MainStack";
import { colors, sheet as S } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { Body, Label, LinkLabel, Press, SheetFrame, Skel, TitleBlock } from "@/components/sheet/Sheet";
import { fetchWithAuth } from "@/services/fetchWithAuth";
import { useSecurityNotifications, type OpenAlert } from "@/notifications/useSecurityNotifications";

const ALERT_LABEL: Record<OpenAlert["type"], string> = { LEFT_ZONE: "Left the zone", DEVICE_OFFLINE: "Device offline", UNANSWERED: "Request unanswered" };
const flatOf = (block: string | null, flat: string) => (block ? `${block}-${flat}` : flat);
const COMPLAINT_WORD: Record<string, string> = { OPEN: "reopened", IN_REVIEW: "being looked into", RESOLVED: "resolved", DISMISSED: "closed" };
function ago(iso: string) {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

export default function NotificationsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const { view, visitors, alerts, complaints, earlierVisitors, earlierAlerts, earlierComplaints, loading, refetch } = useSecurityNotifications();
  const [refreshing, setRefreshing] = useState(false);
  // Leaving the page counts everything on it as seen (the guard's bell then counts only newer answers).
  useFocusEffect(useCallback(() => () => void markNotificationsSeen(), []));

  const acknowledge = async (a: OpenAlert) => {
    try {
      const res = await fetchWithAuth(`/api/security/alerts/${a.id}/acknowledge`, { method: "POST" });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || "Could not acknowledge.");
      }
      await refetch();
    } catch (e) {
      Alert.alert("Alert", (e as Error).message);
    }
  };

  const empty =
    view === "admin" ? "No alert is waiting for acknowledgement." : view === "guard" ? "No new answers from the flats." : view === "customer" ? "Nobody is waiting at the gate for you." : "Nothing here.";

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ paddingBottom: 96 }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          tintColor={S.ink}
          onRefresh={async () => {
            setRefreshing(true);
            await refetch();
            setRefreshing(false);
          }}
        />
      }
    >
      <SheetFrame>
        <TitleBlock eyebrow="Civilier Security" title="Notifications" subtitle={view === "admin" ? "Alerts and complaints waiting for you" : view === "guard" ? "New answers to your visitor requests" : "Visitors and updates on your complaints"} />
        <View style={{ borderTopWidth: 1, borderTopColor: S.ink, paddingHorizontal: 16 }}>
          {loading ? (
            <View style={{ paddingVertical: 16, gap: 10 }}>
              <Skel h={44} />
              <Skel h={44} />
            </View>
          ) : visitors.length + alerts.length + complaints.length === 0 ? (
            <Body size={13.5} color={S.ink2} style={{ paddingVertical: 20 }}>{empty}</Body>
          ) : (
            <>
              {visitors.map((v, i) => (
                <Press
                  key={`v${v.id}`}
                  onPress={() => (view === "customer" ? navigation.navigate("VisitorDecision", { id: v.id }) : navigation.navigate("VisitorStatus", { id: v.id }))}
                  style={(p) => ({ paddingVertical: 12, borderBottomWidth: i === visitors.length - 1 && !alerts.length ? 0 : 1, borderBottomColor: S.ruleSoft, backgroundColor: p ? S.blueWash : "transparent" })}
                >
                  <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 10 }}>
                    <Label color={v.status === "DENIED" ? S.red : S.blue}>
                      {view === "guard" ? `${v.status === "APPROVED" ? "Approved" : v.status === "DENIED" ? "Denied" : "No response"} · flat ${flatOf(v.block, v.flat)}` : `Visitor · flat ${flatOf(v.block, v.flat)}`}
                    </Label>
                    <Body size={11.5} color={S.graphite}>{ago(v.requestedAt)}</Body>
                  </View>
                  <Text style={{ fontFamily: fonts.body.semibold, fontSize: 14, color: S.ink, marginTop: 4 }}>
                    {v.visitorName || "Visitor"} · {v.reason}
                  </Text>
                  <Body size={12} color={S.graphite}>{view === "customer" ? `At ${v.gateName}. Tap to approve or deny.` : v.decidedBy ? `${v.decidedBy} answered` : v.gateName}</Body>
                </Press>
              ))}
              {complaints.map((c, i) => (
                <Press
                  key={`c${c.id}`}
                  onPress={() => navigation.navigate(view === "admin" ? "AdminComplaints" : "Complaints")}
                  style={(p) => ({ paddingVertical: 12, borderBottomWidth: i === complaints.length - 1 && !alerts.length ? 0 : 1, borderBottomColor: S.ruleSoft, backgroundColor: p ? S.blueWash : "transparent" })}
                >
                  <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 10 }}>
                    <Label color={view === "admin" ? S.red : c.status === "RESOLVED" ? S.blue : S.ink2}>
                      {view === "admin" ? "New complaint" : `Complaint ${COMPLAINT_WORD[c.status]}`}
                    </Label>
                    <Body size={11.5} color={S.graphite}>{ago(c.handledAt ?? c.createdAt)}</Body>
                  </View>
                  <Text style={{ fontFamily: fonts.body.semibold, fontSize: 14, color: S.ink, marginTop: 4 }}>{c.categoryLabel}</Text>
                  <Body size={12} color={S.graphite}>
                    {view === "admin"
                      ? [c.residentName, `flat ${flatOf(c.block, c.flat)}`, c.guardName ? `guard ${c.guardName}` : "guard not named"].filter(Boolean).join(" · ")
                      : c.adminNote || "Tap to see your complaint."}
                  </Body>
                </Press>
              ))}
              {alerts.map((a, i) => (
                <View key={`a${a.id}`} style={{ paddingVertical: 12, borderBottomWidth: i === alerts.length - 1 ? 0 : 1, borderBottomColor: S.ruleSoft }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 10 }}>
                    <Label color={S.red}>{ALERT_LABEL[a.type] ?? a.type}{a.escalatedAt ? " · escalated" : ""}</Label>
                    <Body size={11.5} color={S.graphite}>{ago(a.at)}</Body>
                  </View>
                  <Text style={{ fontFamily: fonts.body.semibold, fontSize: 14, color: S.ink, marginTop: 4 }}>{a.detail || a.guardName || "Alert"}</Text>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
                    <Body size={12} color={S.graphite}>{[a.guardName, a.projectName].filter(Boolean).join(" · ")}</Body>
                    <LinkLabel onPress={() => void acknowledge(a)} color={S.blue}>Acknowledge</LinkLabel>
                  </View>
                </View>
              ))}
            </>
          )}
        </View>

        {(earlierVisitors.length > 0 || earlierAlerts.length > 0 || earlierComplaints.length > 0) && (
          <View style={{ borderTopWidth: 1, borderTopColor: S.rule, paddingHorizontal: 16, paddingTop: 14 }}>
            <Label>Earlier</Label>
            {earlierVisitors.map((v, i) => (
              <Press
                key={`ev${v.id}`}
                onPress={() => (view === "customer" ? navigation.navigate("VisitorDecision", { id: v.id }) : navigation.navigate("VisitorStatus", { id: v.id }))}
                style={(p) => ({ paddingVertical: 10, borderBottomWidth: i === earlierVisitors.length - 1 ? 0 : 1, borderBottomColor: S.ruleSoft, backgroundColor: p ? S.blueWash : "transparent" })}
              >
                <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 10 }}>
                  <Text style={{ fontFamily: fonts.body.medium, fontSize: 13, color: S.ink2, flex: 1 }} numberOfLines={1}>
                    {v.visitorName || "Visitor"} · flat {flatOf(v.block, v.flat)} · {v.status === "APPROVED" ? "approved" : v.status === "DENIED" ? "denied" : "no response"}
                  </Text>
                  <Body size={11.5} color={S.graphite}>{ago(v.decidedAt ?? v.requestedAt)}</Body>
                </View>
              </Press>
            ))}
            {earlierComplaints.map((c, i) => (
              <Press
                key={`ec${c.id}`}
                onPress={() => navigation.navigate("Complaints")}
                style={(p) => ({ paddingVertical: 10, borderBottomWidth: i === earlierComplaints.length - 1 && !earlierAlerts.length ? 0 : 1, borderBottomColor: S.ruleSoft, backgroundColor: p ? S.blueWash : "transparent" })}
              >
                <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 10 }}>
                  <Text style={{ fontFamily: fonts.body.medium, fontSize: 13, color: S.ink2, flex: 1 }} numberOfLines={1}>
                    Complaint {COMPLAINT_WORD[c.status]} · {c.categoryLabel}
                  </Text>
                  <Body size={11.5} color={S.graphite}>{ago(c.handledAt ?? c.createdAt)}</Body>
                </View>
              </Press>
            ))}
            {earlierAlerts.map((a, i) => (
              <View key={`ea${a.id}`} style={{ paddingVertical: 10, borderBottomWidth: i === earlierAlerts.length - 1 ? 0 : 1, borderBottomColor: S.ruleSoft }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 10 }}>
                  <Text style={{ fontFamily: fonts.body.medium, fontSize: 13, color: S.ink2, flex: 1 }} numberOfLines={1}>
                    {ALERT_LABEL[a.type] ?? a.type} · {a.detail || a.guardName}
                  </Text>
                  <Body size={11.5} color={S.graphite}>{ago(a.at)}</Body>
                </View>
                <Body size={11.5} color={S.graphite}>Acknowledged by {a.acknowledgedBy ?? "—"}</Body>
              </View>
            ))}
          </View>
        )}
      </SheetFrame>
    </ScrollView>
  );
}
