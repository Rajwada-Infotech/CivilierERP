// RN port of src/pages/maintenance/MaintenanceDashboard.tsx (web) — same
// four stat cards (Confirmed Customers, Active Charge Heads, Bills Issued,
// Total Billed) and the same Breakdown section (Bill Status donut, Billed
// vs Unbilled Customers donut, 14-day billing trend line), pulling from the
// exact same three endpoints. Charts are hand-drawn with react-native-svg
// (see components/charts/*) since recharts has no RN equivalent.
import { useMemo, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Users, Receipt, ListChecks, Wallet, TrendingUp } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { formatINR } from "@/utils/formatCurrency";
import { SectionLabel } from "@/components/home/SectionLabel";
import { DonutChart } from "@/components/charts/DonutChart";
import { TrendLineChart } from "@/components/charts/TrendLineChart";
import { getMaintenanceDirectory } from "@/api/maintenanceApi";
import { getActiveChargeHeads } from "@/api/chargeHeadApi";
import { getMaintenanceBills } from "@/api/maintenanceBillApi";

const ACCENT = "#65a30d";

function StatCard({ label, value, icon: Icon, color }: {
  label: string; value: string; icon: React.ComponentType<{ size?: number; color?: string }>; color: string;
}) {
  return (
    <View
      style={{ flex: 1, minWidth: "45%", backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: `${color}30`, padding: 14, overflow: "hidden" }}
    >
      <View style={{ position: "absolute", left: 0, top: 10, bottom: 10, width: 2.5, borderRadius: 2, backgroundColor: color }} />
      <View className="flex-row items-start justify-between mb-3">
        <Text style={{ fontSize: 9.5, fontFamily: fonts.heading.bold, color, opacity: 0.9, textTransform: "uppercase", letterSpacing: 1.2, flex: 1, marginRight: 6 }}>
          {label}
        </Text>
        <View style={{ width: 26, height: 26, borderRadius: 8, backgroundColor: `${color}20`, borderWidth: 1, borderColor: `${color}40`, alignItems: "center", justifyContent: "center" }}>
          <Icon size={12} color={color} />
        </View>
      </View>
      <Text style={{ fontSize: 20, fontFamily: fonts.heading.bold, color: colors.foreground }}>{value}</Text>
    </View>
  );
}

function ChartCard({ title, icon: Icon, children }: {
  title: string; icon: React.ComponentType<{ size?: number; color?: string }>; children: React.ReactNode;
}) {
  return (
    <View style={{ borderRadius: 14, borderWidth: 1, borderColor: `${ACCENT}30`, backgroundColor: colors.card, marginBottom: 14, overflow: "hidden" }}>
      <View className="flex-row items-center gap-2" style={{ paddingHorizontal: 14, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: `${ACCENT}20` }}>
        <View style={{ width: 20, height: 20, borderRadius: 6, backgroundColor: `${ACCENT}26`, alignItems: "center", justifyContent: "center" }}>
          <Icon size={11} color={ACCENT} />
        </View>
        <Text style={{ fontSize: 12, fontFamily: fonts.heading.semibold, color: colors.foreground }}>{title}</Text>
      </View>
      <View style={{ padding: 14 }}>{children}</View>
    </View>
  );
}

export default function DashboardScreen() {
  const [refreshing, setRefreshing] = useState(false);

  const directoryQ = useQuery({ queryKey: ["maint-directory", ""], queryFn: () => getMaintenanceDirectory(""), staleTime: 60_000 });
  const chargeHeadsQ = useQuery({ queryKey: ["charge-heads-active"], queryFn: getActiveChargeHeads, staleTime: 60_000 });
  const billsQ = useQuery({ queryKey: ["maint-bills", {}], queryFn: () => getMaintenanceBills(), staleTime: 60_000 });

  const directoryRows = directoryQ.data ?? [];
  const chargeHeadRows = chargeHeadsQ.data ?? [];
  const billRows = billsQ.data ?? [];
  const activeBills = billRows.filter((b) => b.Status === "Active");
  const cancelledBills = billRows.filter((b) => b.Status === "Cancelled");
  const totalBilled = activeBills.reduce((s, b) => s + (Number(b.GrandTotal) || 0), 0);

  const billedCustomerCount = new Set(activeBills.map((b) => b.BookingId)).size;
  const unbilledCustomerCount = Math.max(0, directoryRows.length - billedCustomerCount);

  const trendData = useMemo(() => {
    const days: { date: string; amount: number }[] = [];
    const byDate = new Map<string, number>();
    activeBills.forEach((b) => {
      if (!b.BillDate) return;
      const key = b.BillDate.slice(0, 10);
      byDate.set(key, (byDate.get(key) || 0) + (Number(b.GrandTotal) || 0));
    });
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      days.push({ date: key, amount: byDate.get(key) || 0 });
    }
    return days;
  }, [activeBills]);

  const loading = directoryQ.isLoading || chargeHeadsQ.isLoading || billsQ.isLoading;

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([directoryQ.refetch(), chargeHeadsQ.refetch(), billsQ.refetch()]);
    setRefreshing(false);
  };

  return (
    <ScrollView
      className="flex-1"
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ padding: 16, paddingBottom: 96 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={ACCENT} />}
    >
      <SectionLabel>Maintenance Overview</SectionLabel>

      {loading ? (
        <View style={{ paddingVertical: 60, alignItems: "center" }}>
          <ActivityIndicator color={colors.mutedForeground} />
        </View>
      ) : (
        <>
          <View className="flex-row flex-wrap gap-3 mb-5">
            <StatCard
              label="Confirmed Customers"
              value={String(directoryRows.length)}
              icon={Users}
              color={ACCENT}
            />
            <StatCard
              label="Active Charge Heads"
              value={String(chargeHeadRows.length)}
              icon={ListChecks}
              color="#0ea5e9"
            />
            <StatCard
              label="Bills Issued"
              value={String(activeBills.length)}
              icon={Receipt}
              color="#f59e0b"
            />
            <StatCard
              label="Total Billed"
              value={formatINR(totalBilled)}
              icon={Wallet}
              color="#22c55e"
            />
          </View>

          <SectionLabel>Breakdown</SectionLabel>

          <ChartCard title="Bill Status" icon={Receipt}>
            {billRows.length === 0 ? (
              <Text style={{ textAlign: "center", color: colors.mutedForeground, fontSize: 12, fontFamily: fonts.body.regular, paddingVertical: 24 }}>
                No data yet
              </Text>
            ) : (
              <DonutChart
                data={[
                  { name: "Active", value: activeBills.length, color: ACCENT },
                  { name: "Cancelled", value: cancelledBills.length, color: "#ef4444" },
                ]}
              />
            )}
          </ChartCard>

          <ChartCard title="Billed vs Unbilled Customers" icon={Users}>
            {directoryRows.length === 0 && billedCustomerCount === 0 ? (
              <Text style={{ textAlign: "center", color: colors.mutedForeground, fontSize: 12, fontFamily: fonts.body.regular, paddingVertical: 24 }}>
                No data yet
              </Text>
            ) : (
              <DonutChart
                data={[
                  { name: "Billed", value: billedCustomerCount, color: ACCENT },
                  { name: "Not Yet Billed", value: unbilledCustomerCount, color: "#94a3b8" },
                ]}
              />
            )}
          </ChartCard>

          <ChartCard title="Billing Amount — Last 14 Days" icon={TrendingUp}>
            <TrendLineChart data={trendData} color={ACCENT} />
          </ChartCard>
        </>
      )}

      {(directoryQ.error || chargeHeadsQ.error || billsQ.error) && (
        <Text style={{ color: colors.destructive, fontSize: 11, fontFamily: fonts.body.regular, marginTop: 4 }}>
          {(directoryQ.error as Error)?.message || (chargeHeadsQ.error as Error)?.message || (billsQ.error as Error)?.message}
        </Text>
      )}
    </ScrollView>
  );
}
