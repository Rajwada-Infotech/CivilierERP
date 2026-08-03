// Wired to the same GET /api/approval-inbox feed the Approval Inbox screen
// uses (and the bell badge in TopHeader.tsx counts) — for this app,
// "notifications" IS "things awaiting your approval". There's no separate
// generic notification backend to plug into (web's own bell components are
// module-specific: SaNotificationBell for Sales Automation, ReminderBell
// for PO/WO/GRN/MR/TDS/PDC/EMI reminders — neither applies to an
// admin-only app with no Finance/Material screens), so this reuses the one
// feed that's both real and actually relevant here.
import { useState } from "react";
import { View, Text, FlatList, Pressable, ActivityIndicator, RefreshControl } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCircle2, ArrowRight } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { formatINR } from "@/utils/formatCurrency";
import { fetchInbox, type InboxItem } from "@/api/approvalInboxApi";
import { MODULE_CONFIG } from "@/screens/admin/approvalInboxConfig";
import { StatusBadge } from "@/screens/admin/StatusBadge";
import { ApprovalInboxDetailModal } from "@/screens/admin/ApprovalInboxDetailModal";
import { navigate } from "@/navigation/navigationRef";

const fmtDate = (d: string | null) => {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
  } catch {
    return "—";
  }
};

function NotificationCard({ item, onPress }: { item: InboxItem; onPress: () => void }) {
  const cfg = MODULE_CONFIG[item.Module];
  const Icon = cfg?.icon ?? Bell;
  const party = item.SupplierName || item.ContractorName || item.CreatedBy || "—";

  return (
    <Pressable
      onPress={onPress}
      style={{ flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 16, padding: 12, marginBottom: 8, backgroundColor: `${colors.card}80`, borderWidth: 1, borderColor: `${colors.border}99` }}
    >
      <View style={{ width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: `${cfg?.color ?? colors.mutedForeground}1f` }}>
        <Icon size={15} color={cfg?.color ?? colors.mutedForeground} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 12.5, fontFamily: fonts.heading.semibold }}>{item.ModuleLabel}</Text>
        <Text numberOfLines={1} style={{ color: colors.mutedForeground, fontSize: 10.5, marginTop: 1 }}>
          {item.Reference || `#${item.RecordId}`} · {party}
        </Text>
        <Text style={{ color: colors.foreground, fontSize: 11.5, fontFamily: fonts.body.medium, marginTop: 3 }}>{formatINR(item.Amount, { decimals: 2 })}</Text>
      </View>
      <View style={{ alignItems: "flex-end", gap: 6 }}>
        <StatusBadge status={item.Status} />
        <Text style={{ color: `${colors.mutedForeground}80`, fontSize: 9.5 }}>{fmtDate(item.RecordDate)}</Text>
      </View>
    </Pressable>
  );
}

export default function NotificationsScreen() {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<InboxItem | null>(null);

  const { data: items = [], isLoading, isFetching, refetch } = useQuery({
    queryKey: ["approval-inbox"],
    queryFn: fetchInbox,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const handleActionDone = () => {
    queryClient.invalidateQueries({ queryKey: ["approval-inbox"] });
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {isLoading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={colors.mutedForeground} />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => `${item.Module}-${item.RecordId}`}
          contentContainerStyle={{ padding: 16 }}
          refreshControl={<RefreshControl refreshing={isFetching && !isLoading} onRefresh={refetch} tintColor={colors.primary} />}
          ListHeaderComponent={
            <View style={{ marginBottom: 14 }}>
              <Text style={{ color: colors.foreground, fontSize: 15, fontFamily: fonts.heading.bold, marginBottom: 3 }}>Notifications</Text>
              <Text style={{ color: colors.mutedForeground, fontSize: 11.5, marginBottom: 10 }}>
                {items.length > 0 ? `${items.length} record${items.length !== 1 ? "s" : ""} awaiting your approval.` : "Records awaiting your approval show up here."}
              </Text>
              {items.length > 0 && (
                <Pressable
                  onPress={() => navigate("ApprovalInbox")}
                  style={{ flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start" }}
                >
                  <Text style={{ color: colors.primary, fontSize: 11, fontFamily: fonts.heading.semibold }}>Open full Approval Inbox</Text>
                  <ArrowRight size={12} color={colors.primary} />
                </Pressable>
              )}
            </View>
          }
          renderItem={({ item }) => <NotificationCard item={item} onPress={() => setSelected(item)} />}
          ListEmptyComponent={
            <View style={{ alignItems: "center", paddingVertical: 48 }}>
              <CheckCircle2 size={28} color={`${colors.mutedForeground}4d`} />
              <Text style={{ color: `${colors.mutedForeground}99`, fontSize: 13, fontFamily: fonts.body.medium, marginTop: 12 }}>All clear!</Text>
              <Text style={{ color: `${colors.mutedForeground}66`, fontSize: 11, marginTop: 3 }}>No records are awaiting approval right now.</Text>
            </View>
          }
        />
      )}

      <ApprovalInboxDetailModal item={selected} onClose={() => setSelected(null)} onActionDone={handleActionDone} />
    </View>
  );
}
