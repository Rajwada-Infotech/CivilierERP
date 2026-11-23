// The Maintenance tab: the Maintenance pages the person has a right on (the web's MaintenanceSidebar.ts keys), then
// the Maintenance overview — RN port of src/pages/maintenance/MaintenanceDashboard.tsx (web): the same four stat
// cards and Breakdown section, from the same three endpoints. Charts are hand-drawn with react-native-svg (see
// components/charts/*).
import { useMemo, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Users, Receipt, ListChecks, Wallet, TrendingUp, ShieldCheck, Zap, Ticket } from "lucide-react-native";
import { useAuth } from "@/auth/AuthContext";
import type { MainStackParamList } from "@/navigation/MainStack";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { formatINR } from "@/utils/formatCurrency";
import { DonutChart } from "@/components/charts/DonutChart";
import { TrendLineChart } from "@/components/charts/TrendLineChart";
import { getMaintenanceDirectory } from "@/api/maintenanceApi";
import { getActiveChargeHeads } from "@/api/chargeHeadApi";
import { getMaintenanceBills } from "@/api/maintenanceBillApi";
import { Figure, Heading, MenuGroup, Section, TAB_BAR_CLEARANCE } from "@/screens/crm/ui";


type MaintenanceRoute = "Directory" | "Bills" | "ServiceRequests" | "Attendance" | "Electricity";
/** The Maintenance pages, each with the page right that shows it — one list for the tab, its visibility and Home. */
export const MAINTENANCE_ITEMS: { route: MaintenanceRoute; label: string; sub: string; icon: typeof Users; pageKey: string }[] = [
  { route: "Directory",       label: "Customer Directory",      sub: "Residents of handed-over homes", icon: Users,       pageKey: "maintenance-directory" },
  { route: "Bills",           label: "Maintenance Bills",       sub: "Raise and view bills",           icon: Receipt,     pageKey: "maintenance-bills" },
  { route: "ServiceRequests", label: "Service Requests",        sub: "Residents' tickets",             icon: Ticket,      pageKey: "crm-service-tickets" },
  { route: "Attendance",      label: "Security Attendance",     sub: "Guards' check-ins and shifts",   icon: ShieldCheck, pageKey: "maintenance-security-attendance" },
  { route: "Electricity",     label: "Electricity Maintenance", sub: "Meters, readings and bills",     icon: Zap,         pageKey: "maintenance-electricity" },
];
// The Maintenance module's own pages. Service Requests is a CRM page the Maintenance team also works, so a right on it
// alone shows it under the CRM tab, not a Maintenance tab.
const MAINTENANCE_PAGES = ["maintenance-directory", "maintenance-bills", "maintenance-security-attendance", "maintenance-electricity"];

/** True when the person may open any Maintenance page — the Maintenance tab shows only then. */
export function useHasMaintenance() {
  const { canAccessPage } = useAuth();
  return MAINTENANCE_PAGES.some((p) => canAccessPage(p));
}

// The overview's figure tiles and chart cards, in the app's kit (screens/crm/ui.tsx).
function StatCard({ label, value, color }: { label: string; value: string; icon?: unknown; color: string }) {
  return <Figure label={label} value={value} tone={color} />;
}

function ChartCard({ title, icon, children }: { title: string; icon: React.ComponentType<{ size?: number; color?: string }>; children: React.ReactNode }) {
  return <Section title={title} icon={icon as never}>{children}</Section>;
}

export default function MaintenanceScreen() {
  const [refreshing, setRefreshing] = useState(false);
  const { canAccessPage } = useAuth();
  const nav = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const pages = MAINTENANCE_ITEMS.filter((i) => canAccessPage(i.pageKey));
  // The overview reads the customer directory, charge heads and bills: shown to staff with both of those pages.
  const overview = canAccessPage("maintenance-directory") && canAccessPage("maintenance-bills");

  const directoryQ = useQuery({ queryKey: ["maint-directory", ""], queryFn: () => getMaintenanceDirectory(""), staleTime: 60_000, enabled: overview });
  const chargeHeadsQ = useQuery({ queryKey: ["charge-heads-active"], queryFn: getActiveChargeHeads, staleTime: 60_000, enabled: overview });
  const billsQ = useQuery({ queryKey: ["maint-bills", {}], queryFn: () => getMaintenanceBills(), staleTime: 60_000, enabled: overview });

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

  const loading = overview && (directoryQ.isLoading || chargeHeadsQ.isLoading || billsQ.isLoading);

  const onRefresh = async () => {
    setRefreshing(true);
    if (overview) await Promise.all([directoryQ.refetch(), chargeHeadsQ.refetch(), billsQ.refetch()]);
    setRefreshing(false);
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: 16, paddingBottom: TAB_BAR_CLEARANCE }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      <MenuGroup items={pages.map((p) => ({ key: p.route, label: p.label, sub: p.sub, icon: p.icon, tint: colors.primary, onPress: () => nav.navigate(p.route) }))} />
      <View style={{ height: 18 }} />

      {!overview ? null : <View style={{ marginBottom: 10 }}><Heading title="Maintenance Overview" /></View>}

      {!overview ? null : loading ? (
        <View style={{ paddingVertical: 60, alignItems: "center" }}>
          <ActivityIndicator color={colors.mutedForeground} />
        </View>
      ) : (
        <>
          <View style={{ gap: 10, marginBottom: 20 }}>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <StatCard label="Confirmed Customers" value={String(directoryRows.length)} icon={Users} color={colors.primary} />
              <StatCard label="Active Charge Heads" value={String(chargeHeadRows.length)} icon={ListChecks} color="#0ea5e9" />
            </View>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <StatCard label="Bills Issued" value={String(activeBills.length)} icon={Receipt} color="#f59e0b" />
              <StatCard label="Total Billed" value={formatINR(totalBilled)} icon={Wallet} color="#22c55e" />
            </View>
          </View>

          <View style={{ marginBottom: 10 }}><Heading title="Breakdown" /></View>

          <ChartCard title="Bill Status" icon={Receipt}>
            {billRows.length === 0 ? (
              <Text style={{ textAlign: "center", color: colors.mutedForeground, fontSize: 12, fontFamily: fonts.body.regular, paddingVertical: 24 }}>
                No data yet
              </Text>
            ) : (
              <DonutChart
                data={[
                  { name: "Active", value: activeBills.length, color: colors.primary },
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
                  { name: "Billed", value: billedCustomerCount, color: colors.primary },
                  { name: "Not Yet Billed", value: unbilledCustomerCount, color: "#94a3b8" },
                ]}
              />
            )}
          </ChartCard>

          <ChartCard title="Billing Amount — Last 14 Days" icon={TrendingUp}>
            <TrendLineChart data={trendData} color={colors.primary} />
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
