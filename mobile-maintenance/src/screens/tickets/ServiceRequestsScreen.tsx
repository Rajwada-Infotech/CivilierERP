// Service Requests screen for the mobile-maintenance app.
// Lists all CrmServiceTickets for handed-over (post-possession) residents
// — the same handedOverOnly=true filter used by the web app's
// src/pages/maintenance/MaintenanceServiceRequests.tsx.
// Staff can mark tickets In Progress, Resolve, and Close from this screen.
import { useState, useCallback } from "react";
import { View, Text, ScrollView, Pressable, ActivityIndicator, RefreshControl, TextInput } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ticket, Clock, CheckCircle, XCircle, Search } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { toast } from "@/components/Toast";
import {
  getHandedOverTickets, markTicketInProgress, resolveServiceTicket, closeServiceTicket,
  type ServiceTicketRow, type TicketStatus,
} from "@/api/serviceTicketApi";

const VIOLET = "#a78bfa";

const STATUS_COLOR: Record<string, { bg: string; text: string; border: string }> = {
  Open:       { bg: "#fef3c720", text: "#d97706", border: "#fbbf2440" },
  Assigned:   { bg: "#e0f2fe20", text: "#0284c7", border: "#38bdf840" },
  InProgress: { bg: "#ede9fe20", text: "#7c3aed", border: "#a78bfa40" },
  Resolved:   { bg: "#d1fae520", text: "#059669", border: "#34d39940" },
  Closed:     { bg: colors.muted + "20", text: colors.mutedForeground, border: colors.border },
  Reopened:   { bg: "#fed7aa20", text: "#c2410c", border: "#fb923c40" },
};

const PRIORITY_COLOR: Record<string, string> = {
  Urgent: "#ef4444", High: "#f97316", Normal: "#0ea5e9", Low: colors.mutedForeground,
};

const STATUS_TABS: { label: string; value: string }[] = [
  { label: "All", value: "" },
  { label: "Open", value: "Open" },
  { label: "Assigned", value: "Assigned" },
  { label: "In Progress", value: "InProgress" },
  { label: "Resolved", value: "Resolved" },
  { label: "Closed", value: "Closed" },
];

const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-IN") : "";

export default function ServiceRequestsScreen() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusTab, setStatusTab] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [actionLoading, setActionLoading] = useState<number | null>(null);

  const { data = [], isLoading, error, refetch } = useQuery({
    queryKey: ["maint-service-requests", statusTab, search],
    queryFn: () => getHandedOverTickets({ status: statusTab || undefined, search: search || undefined }),
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const doAction = async (id: number, fn: () => Promise<void>, msg: string) => {
    setActionLoading(id);
    try {
      await fn();
      toast.success(msg);
      qc.invalidateQueries({ queryKey: ["maint-service-requests"] });
    } catch (err: unknown) {
      toast.error((err as Error).message || "Failed");
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Search bar */}
      <View style={{ paddingHorizontal: 14, paddingTop: 12, paddingBottom: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.muted, borderRadius: 12, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 9 }}>
          <Search size={14} color={colors.mutedForeground} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search tickets..."
            placeholderTextColor={colors.mutedForeground}
            style={{ flex: 1, color: colors.foreground, fontSize: 13, fontFamily: fonts.body.regular }}
          />
        </View>
      </View>

      {/* Status tabs */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 14, gap: 6, paddingBottom: 10 }}>
        {STATUS_TABS.map((tab) => {
          const active = statusTab === tab.value;
          return (
            <Pressable
              key={tab.value}
              onPress={() => setStatusTab(tab.value)}
              style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10, borderWidth: 1, borderColor: active ? `${VIOLET}60` : colors.border, backgroundColor: active ? `${VIOLET}18` : "transparent" }}
            >
              <Text style={{ fontSize: 12, fontFamily: active ? fonts.heading.semibold : fonts.body.regular, color: active ? VIOLET : colors.mutedForeground }}>
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* List */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 100 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={VIOLET} />}
      >
        {isLoading ? (
          <View style={{ paddingVertical: 60, alignItems: "center" }}>
            <ActivityIndicator color={colors.mutedForeground} />
          </View>
        ) : error ? (
          <Text style={{ color: colors.destructive, fontSize: 12, fontFamily: fonts.body.regular, marginTop: 24, textAlign: "center" }}>
            Failed to load service requests.
          </Text>
        ) : data.length === 0 ? (
          <View style={{ paddingVertical: 60, alignItems: "center", gap: 10 }}>
            <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: `${VIOLET}14`, alignItems: "center", justifyContent: "center" }}>
              <Ticket size={22} color={VIOLET} />
            </View>
            <Text style={{ color: colors.foreground, fontSize: 13.5, fontFamily: fonts.body.semibold }}>No service requests</Text>
            <Text style={{ color: colors.mutedForeground, fontSize: 11.5, fontFamily: fonts.body.regular, textAlign: "center", maxWidth: 240 }}>
              No tickets found for handed-over residents.
            </Text>
          </View>
        ) : (
          <View style={{ gap: 10 }}>
            {data.map((t) => {
              const sc = STATUS_COLOR[t.Status] || STATUS_COLOR.Closed;
              const isActing = actionLoading === t.Id;
              return (
                <View
                  key={t.Id}
                  style={{ borderRadius: 14, borderWidth: 1, borderColor: sc.border, backgroundColor: colors.card, padding: 13, gap: 8 }}
                >
                  {/* Header row */}
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flex: 1, minWidth: 0 }}>
                      <Text style={{ fontSize: 10, fontFamily: fonts.body.regular, color: colors.mutedForeground }}>{t.TicketNo}</Text>
                      <View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8, borderWidth: 1, borderColor: sc.border, backgroundColor: sc.bg }}>
                        <Text style={{ fontSize: 10, fontFamily: fonts.heading.semibold, color: sc.text }}>{t.Status}</Text>
                      </View>
                      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: PRIORITY_COLOR[t.Priority] }} />
                    </View>
                    <Text style={{ fontSize: 10, fontFamily: fonts.body.regular, color: colors.mutedForeground }}>{t.Category}</Text>
                  </View>

                  {/* Subject */}
                  <Text numberOfLines={2} style={{ color: colors.foreground, fontSize: 13, fontFamily: fonts.heading.semibold }}>
                    {t.Subject}
                  </Text>

                  {/* Customer info */}
                  {(t.ApplicantName || t.UnitNo) && (
                    <Text style={{ color: colors.mutedForeground, fontSize: 11, fontFamily: fonts.body.regular }}>
                      {[t.ApplicantName, t.UnitNo].filter(Boolean).join(" \u00B7 ")}
                    </Text>
                  )}
                  {t.AssigneeName && (
                    <Text style={{ color: colors.mutedForeground, fontSize: 11, fontFamily: fonts.body.regular }}>
                      Assigned: {t.AssigneeName}
                    </Text>
                  )}
                  {t.SlaDueDate && (
                    <Text style={{ color: colors.mutedForeground, fontSize: 11, fontFamily: fonts.body.regular }}>
                      SLA: {fmtDate(t.SlaDueDate)}
                    </Text>
                  )}

                  {/* Action buttons */}
                  {(["Assigned", "InProgress", "Reopened", "Resolved"].includes(t.Status)) && (
                    <View style={{ flexDirection: "row", gap: 8, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10, marginTop: 2 }}>
                      {t.Status === "Assigned" && (
                        <Pressable
                          onPress={() => doAction(t.Id, () => markTicketInProgress(t.Id), "Marked In Progress")}
                          disabled={isActing}
                          style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: `${VIOLET}50`, backgroundColor: `${VIOLET}12`, opacity: isActing ? 0.5 : 1 }}
                        >
                          {isActing ? <ActivityIndicator size="small" color={VIOLET} /> : <Clock size={13} color={VIOLET} />}
                          <Text style={{ fontSize: 12, fontFamily: fonts.heading.semibold, color: VIOLET }}>In Progress</Text>
                        </Pressable>
                      )}
                      {["Assigned", "InProgress", "Reopened"].includes(t.Status) && (
                        <Pressable
                          onPress={() => doAction(t.Id, () => resolveServiceTicket(t.Id, "Resolved via mobile app"), "Resolved")}
                          disabled={isActing}
                          style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: "#34d39940", backgroundColor: "#d1fae512", opacity: isActing ? 0.5 : 1 }}
                        >
                          {isActing ? <ActivityIndicator size="small" color="#059669" /> : <CheckCircle size={13} color="#059669" />}
                          <Text style={{ fontSize: 12, fontFamily: fonts.heading.semibold, color: "#059669" }}>Resolve</Text>
                        </Pressable>
                      )}
                      {t.Status === "Resolved" && (
                        <Pressable
                          onPress={() => doAction(t.Id, () => closeServiceTicket(t.Id), "Ticket closed")}
                          disabled={isActing}
                          style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.muted, opacity: isActing ? 0.5 : 1 }}
                        >
                          {isActing ? <ActivityIndicator size="small" color={colors.mutedForeground} /> : <XCircle size={13} color={colors.mutedForeground} />}
                          <Text style={{ fontSize: 12, fontFamily: fonts.heading.semibold, color: colors.foreground }}>Close</Text>
                        </Pressable>
                      )}
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
    </View>
  );
}