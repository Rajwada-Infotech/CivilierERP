// RN port of src/pages/finance/FinanceDashboard.tsx (web). Web has no
// separate mobile layout — its Tailwind grids just collapse at narrow
// widths (grid-cols-2 lg:grid-cols-4 stays 2-col on phones, grid-cols-1
// sm:grid-cols-3 fully stacks, grid-cols-1 lg:grid-cols-2 stacks the two
// recent-activity tables) — so this screen reproduces that same collapsed
// arrangement natively rather than inventing a new one: Today's Activity
// (2-col stat tiles), Totals (stacked), Recent Activity (two stacked row
// lists in place of web's <table>s), Cheque Summary (2-col tiles), Quick
// Actions (2-col nav buttons). No chart library — web doesn't use one either.
import { useState } from "react";
import { View, Text, ScrollView, Pressable, ActivityIndicator, RefreshControl, Alert } from "react-native";
import { useQuery } from "@tanstack/react-query";
import {
  RefreshCw, CreditCard, Landmark, BookOpen, Receipt, BadgeDollarSign,
  CheckCircle2, Clock, Plus, ArrowDownToLine, Wallet,
} from "lucide-react-native";
import { fetchFinanceDashboard, type FinanceDashboardData, type RecentPaymentMade, type RecentPaymentReceived } from "@/api/financeDashboardApi";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { SectionLabel } from "@/components/home/SectionLabel";
import { FadeSlideIn } from "@/components/FadeSlideIn";

const FINANCE = "#3b82f6";

function fmtDay(d?: string) {
  if (!d) return "—";
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? "—" : dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

function fmtRupees(n: number) {
  if (!n) return "₹0";
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
  if (n >= 1000) return `₹${(n / 1000).toFixed(1)}K`;
  return `₹${n.toLocaleString("en-IN")}`;
}

function notBuiltYet(title: string) {
  Alert.alert(title, `The ${title} screen isn't built on mobile yet — use the web app for now.`);
}

function StatTile({
  label, value, icon: Icon, accent, onPress, wide,
}: {
  label: string; value: string | number; icon: React.ComponentType<{ size?: number; color?: string }>; accent: string; onPress?: () => void; wide?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{ width: wide ? "100%" : "48%", marginBottom: 10 }}
      className="rounded-xl overflow-hidden"
    >
      <View
        className="flex-row items-center gap-2.5 px-3.5 py-3"
        style={{ backgroundColor: `${colors.card}b3`, borderWidth: 1, borderColor: `${colors.border}80`, borderLeftWidth: 3, borderLeftColor: accent }}
      >
        <View className="w-8 h-8 rounded-lg items-center justify-center" style={{ backgroundColor: `${accent}26`, borderWidth: 1, borderColor: `${accent}4d` }}>
          <Icon size={14} color={accent} />
        </View>
        <View className="flex-1 min-w-0">
          <Text numberOfLines={1} style={{ color: colors.mutedForeground, fontSize: 10.5, fontFamily: fonts.body.regular }}>
            {label}
          </Text>
          <Text style={{ color: colors.foreground, fontFamily: fonts.heading.bold, fontSize: 16, marginTop: 1 }}>{value}</Text>
        </View>
      </View>
    </Pressable>
  );
}

function GlassPanel({ title, onViewAll, children }: { title: string; onViewAll?: () => void; children: React.ReactNode }) {
  return (
    <View className="rounded-2xl mb-4" style={{ backgroundColor: `${colors.card}80`, borderWidth: 1, borderColor: `${colors.border}99` }}>
      <View className="flex-row items-center justify-between px-4 pt-3.5 pb-2">
        <Text style={{ color: colors.foreground, fontFamily: fonts.heading.semibold, fontSize: 13 }}>{title}</Text>
        {onViewAll && (
          <Pressable onPress={onViewAll}>
            <Text style={{ color: FINANCE, fontSize: 11, fontFamily: fonts.body.medium }}>View all →</Text>
          </Pressable>
        )}
      </View>
      <View className="px-4 pb-1">{children}</View>
    </View>
  );
}

function PaymentMadeRow({ item, isLast }: { item: RecentPaymentMade; isLast: boolean }) {
  return (
    <View
      className="flex-row items-center justify-between py-2.5"
      style={!isLast ? { borderBottomWidth: 1, borderBottomColor: `${colors.border}60` } : undefined}
    >
      <View className="flex-1 min-w-0 pr-2">
        <Text numberOfLines={1} style={{ color: colors.foreground, fontFamily: fonts.body.semibold, fontSize: 12 }}>
          {item.PPaymentName || item.PProject || "—"}
        </Text>
        <Text style={{ color: colors.mutedForeground, fontSize: 10, marginTop: 2, fontFamily: fonts.body.regular }}>
          {item.PMode ?? "—"} · {fmtDay(item.PDate)}
        </Text>
      </View>
      <Text style={{ color: "#f43f5e", fontFamily: fonts.heading.semibold, fontSize: 12 }}>
        {fmtRupees(Number(item.PAmount ?? 0))}
      </Text>
    </View>
  );
}

const STATUS_COLOR: Record<string, string> = {
  Approved: "#10b981",
  Draft: "#f59e0b",
  Cleared: "#3b82f6",
  Rejected: "#ef4444",
};

function PaymentReceivedRow({ item, isLast }: { item: RecentPaymentReceived; isLast: boolean }) {
  const statusColor = STATUS_COLOR[item.RPStatus] ?? colors.mutedForeground;
  return (
    <View
      className="flex-row items-center justify-between py-2.5"
      style={!isLast ? { borderBottomWidth: 1, borderBottomColor: `${colors.border}60` } : undefined}
    >
      <View className="flex-1 min-w-0 pr-2">
        <Text numberOfLines={1} style={{ color: colors.foreground, fontFamily: fonts.body.semibold, fontSize: 12 }}>
          {item.RPReceivedFrom || "—"}
        </Text>
        <View className="flex-row items-center gap-1.5 mt-1">
          <View className="px-1.5 py-0.5 rounded-full" style={{ backgroundColor: `${statusColor}26` }}>
            <Text style={{ color: statusColor, fontSize: 8.5, fontFamily: fonts.heading.semibold }}>{item.RPStatus}</Text>
          </View>
          <Text style={{ color: colors.mutedForeground, fontSize: 10, fontFamily: fonts.body.regular }}>
            {item.RPMode ?? "—"} · {fmtDay(item.RPDocDate)}
          </Text>
        </View>
      </View>
      <Text style={{ color: "#10b981", fontFamily: fonts.heading.semibold, fontSize: 12 }}>
        {fmtRupees(Number(item.RPAmount ?? 0))}
      </Text>
    </View>
  );
}

function QuickAction({ label, icon: Icon, onPress }: { label: string; icon: React.ComponentType<{ size?: number; color?: string }>; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={{ width: "48%", marginBottom: 10 }} className="rounded-xl overflow-hidden">
      <View
        className="items-center justify-center gap-1.5 py-3.5"
        style={{ backgroundColor: `${colors.card}b3`, borderWidth: 1, borderColor: `${colors.border}80` }}
      >
        <View className="w-8 h-8 rounded-lg items-center justify-center" style={{ backgroundColor: `${FINANCE}26` }}>
          <Icon size={15} color={FINANCE} />
        </View>
        <Text style={{ color: colors.foreground, fontSize: 11, fontFamily: fonts.body.medium }}>{label}</Text>
      </View>
    </Pressable>
  );
}

export default function FinanceDashboardScreen() {
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, isError, refetch, isFetching, dataUpdatedAt } = useQuery<FinanceDashboardData>({
    queryKey: ["finance-dashboard"],
    queryFn: fetchFinanceDashboard,
    staleTime: 60 * 1000,
    refetchInterval: 2 * 60 * 1000,
    retry: 2,
  });

  const lastUpdated = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })
    : null;

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  return (
    <ScrollView
      className="flex-1"
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      {/* Header */}
      <FadeSlideIn delay={0}>
        <View className="flex-row items-center gap-2.5 mb-1">
          <View className="w-9 h-9 rounded-xl items-center justify-center" style={{ backgroundColor: `${FINANCE}26`, borderWidth: 1, borderColor: `${FINANCE}4d` }}>
            <Landmark size={16} color={FINANCE} />
          </View>
          <View className="flex-1">
            <Text style={{ color: colors.foreground, fontFamily: fonts.heading.bold, fontSize: 20 }}>Finance Overview</Text>
            {lastUpdated && (
              <Text style={{ color: `${colors.mutedForeground}80`, fontSize: 10, fontFamily: fonts.body.regular }}>Updated {lastUpdated}</Text>
            )}
          </View>
          <Pressable onPress={() => refetch()} disabled={isFetching} hitSlop={8} className="p-2 rounded-lg" style={{ borderWidth: 1, borderColor: colors.border }}>
            {isFetching ? <ActivityIndicator size="small" color={colors.mutedForeground} /> : <RefreshCw size={14} color={colors.mutedForeground} />}
          </Pressable>
        </View>
      </FadeSlideIn>

      {isError && (
        <View className="mt-3 flex-row items-center gap-2 px-4 py-2.5 rounded-xl" style={{ backgroundColor: `${colors.destructive}1a`, borderWidth: 1, borderColor: `${colors.destructive}33` }}>
          <Text style={{ color: colors.destructive, fontSize: 11, fontFamily: fonts.body.medium, flex: 1 }}>
            Could not reach the server — showing cached data.
          </Text>
        </View>
      )}

      {isLoading ? (
        <View className="py-16 items-center">
          <ActivityIndicator color={colors.mutedForeground} />
        </View>
      ) : (
        <>
          {/* Today's Activity */}
          <View className="mt-7">
            <SectionLabel>Today's Activity</SectionLabel>
            <View className="flex-row flex-wrap justify-between">
              <StatTile label="Payments Made Today" value={data?.paymentsMade.todayCount ?? 0} icon={Receipt} accent="#f43f5e" onPress={() => notBuiltYet("Payments")} />
              <StatTile label="Received Today" value={data?.receivedPayments.todayCount ?? 0} icon={BadgeDollarSign} accent="#10b981" onPress={() => notBuiltYet("Received Payments")} />
              <StatTile label="Cheque Lots" value={data?.cheques.totalCount ?? 0} icon={BookOpen} accent="#f59e0b" onPress={() => notBuiltYet("Cheques")} />
              <StatTile label="Active Cards" value={data?.cards.activeCount ?? 0} icon={CreditCard} accent="#8b5cf6" onPress={() => notBuiltYet("Cards")} />
            </View>
          </View>

          {/* Totals */}
          <View className="mt-3">
            <SectionLabel>Totals</SectionLabel>
            <View className="flex-row flex-wrap justify-between">
              <StatTile label="Bank Accounts" value={data?.banks.totalCount ?? 0} icon={Landmark} accent="#3b82f6" wide onPress={() => notBuiltYet("Banks")} />
              <StatTile label="Total Payments Made" value={fmtRupees(data?.paymentsMade.totalAmount ?? 0)} icon={Receipt} accent="#f43f5e" wide />
              <StatTile label="Total Received" value={fmtRupees(data?.receivedPayments.totalAmount ?? 0)} icon={BadgeDollarSign} accent="#10b981" wide />
            </View>
          </View>

          {/* Recent Activity */}
          <View className="mt-3">
            <SectionLabel>Recent Activity</SectionLabel>
            <GlassPanel title="Recent Payments Made" onViewAll={() => notBuiltYet("Payments")}>
              {(data?.recentPaymentsMade ?? []).length === 0 ? (
                <Text className="py-6 text-center" style={{ color: `${colors.mutedForeground}66`, fontSize: 12, fontFamily: fonts.body.regular }}>
                  No recent payments.
                </Text>
              ) : (
                data!.recentPaymentsMade.map((p, i) => (
                  <PaymentMadeRow key={p.PPaymentID ?? i} item={p} isLast={i === data!.recentPaymentsMade.length - 1} />
                ))
              )}
            </GlassPanel>
            <GlassPanel title="Recent Received Payments" onViewAll={() => notBuiltYet("Received Payments")}>
              {(data?.recentPaymentsReceived ?? []).length === 0 ? (
                <Text className="py-6 text-center" style={{ color: `${colors.mutedForeground}66`, fontSize: 12, fontFamily: fonts.body.regular }}>
                  No recent receipts.
                </Text>
              ) : (
                data!.recentPaymentsReceived.map((p, i) => (
                  <PaymentReceivedRow key={p.RPPaymentID ?? i} item={p} isLast={i === data!.recentPaymentsReceived.length - 1} />
                ))
              )}
            </GlassPanel>
          </View>

          {/* Cheque Summary */}
          <View className="mt-1">
            <SectionLabel>Cheque Summary</SectionLabel>
            <View className="flex-row flex-wrap justify-between">
              <StatTile label="Total Cheque Lots" value={data?.cheques.totalCount ?? 0} icon={BookOpen} accent="#3b82f6" />
              <StatTile label="Active" value={data?.cheques.activeCount ?? 0} icon={CheckCircle2} accent="#10b981" />
              <StatTile label="Inactive" value={data?.cheques.inactiveCount ?? 0} icon={Clock} accent="#f59e0b" />
              <StatTile label="Active Cards" value={data?.cards.activeCount ?? 0} icon={CreditCard} accent="#8b5cf6" />
            </View>
          </View>

          {/* Quick Actions */}
          <View className="mt-3 mb-2">
            <SectionLabel>Quick Actions</SectionLabel>
            <View className="flex-row flex-wrap justify-between">
              <QuickAction label="New Payment" icon={Plus} onPress={() => notBuiltYet("New Payment")} />
              <QuickAction label="New Received" icon={ArrowDownToLine} onPress={() => notBuiltYet("New Received")} />
              <QuickAction label="Cheques" icon={BookOpen} onPress={() => notBuiltYet("Cheques")} />
              <QuickAction label="Cards" icon={CreditCard} onPress={() => notBuiltYet("Cards")} />
              <QuickAction label="Banks" icon={Wallet} onPress={() => notBuiltYet("Banks")} />
            </View>
          </View>
        </>
      )}
    </ScrollView>
  );
}
