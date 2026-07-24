// RN port of src/pages/material/MaterialDashboard.tsx, collapsed to mobile
// width the same way FinanceDashboardScreen mirrors FinanceDashboard.tsx:
// stat tiles (2-col grid, web's grid-cols-2 sm:grid-cols-4 collapse),
// Totals (stacked), Recent GRNs + Recent POs (row lists in place of web's
// <DataTable>s), Quick Actions grid. Not yet ported: the drill-down modals
// behind each stat tile (Item Master / GRN / PO / Expenses / Stock /
// Issues / Requests lists), Recent Expenses/Issues/Requests panels, PO
// Status Breakdown, Material Requests breakdown, and Top Items — same
// "one page at a time" scoping as the rest of this app. Tapping a stat
// tile or quick action for something not built yet shows the standard
// "not built on mobile yet" alert.
import { useState } from "react";
import { View, Text, ScrollView, Pressable, ActivityIndicator, RefreshControl, Alert } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery } from "@tanstack/react-query";
import {
  Package, Truck, FileText, ShoppingCart, Receipt, Layers, RefreshCw,
  PackageCheck, Send, Ruler, ClipboardList, TrendingUp,
} from "lucide-react-native";
import { fetchMaterialDashboard, type MaterialDashboardData } from "@/api/materialDashboardApi";
import type { MainStackParamList } from "@/navigation/MainStack";
import { colors, moduleAccents } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { SectionLabel } from "@/components/home/SectionLabel";
import { FadeSlideIn } from "@/components/FadeSlideIn";

const MATERIAL = moduleAccents.material;

const STATUS_COLOR: Record<string, string> = {
  Approved: "#10b981",
  Closed: "#10b981",
  "Fully Received": "#10b981",
  Ordered: "#8b5cf6",
  "Partially Ordered": "#a855f7",
  Pending: "#f59e0b",
  Draft: colors.mutedForeground,
  Rejected: "#ef4444",
  Cancelled: "#ef4444",
};

function fmtNum(n: number) {
  return Math.round(n || 0).toLocaleString("en-IN");
}

function fmtRupees(n: number) {
  if (!n) return "₹0";
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
  if (n >= 1000) return `₹${(n / 1000).toFixed(1)}K`;
  return `₹${n.toLocaleString("en-IN")}`;
}

function fmtDay(d?: string) {
  if (!d) return "—";
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? "—" : dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

function notBuiltYet(title: string) {
  Alert.alert(title, `The ${title} screen isn't built on mobile yet — use the web app for now.`);
}

function StatTile({
  label, value, sub, icon: Icon, accent, onPress, wide,
}: {
  label: string; value: string | number; sub?: string; icon: React.ComponentType<{ size?: number; color?: string }>; accent: string; onPress?: () => void; wide?: boolean;
}) {
  return (
    <Pressable onPress={onPress} style={{ width: wide ? "100%" : "48%", marginBottom: 10 }} className="rounded-xl overflow-hidden">
      <View
        className="px-3.5 py-3"
        style={{ backgroundColor: `${colors.card}b3`, borderWidth: 1, borderColor: `${colors.border}80`, borderLeftWidth: 3, borderLeftColor: accent }}
      >
        <View className="flex-row items-center justify-between">
          <Text numberOfLines={1} style={{ color: accent, fontSize: 9.5, fontFamily: fonts.heading.bold, textTransform: "uppercase", letterSpacing: 0.6, flexShrink: 1 }}>
            {label}
          </Text>
          <View className="w-7 h-7 rounded-lg items-center justify-center" style={{ backgroundColor: `${accent}26`, borderWidth: 1, borderColor: `${accent}4d` }}>
            <Icon size={13} color={accent} />
          </View>
        </View>
        <Text style={{ color: colors.foreground, fontFamily: fonts.heading.bold, fontSize: 17, marginTop: 8 }}>{value}</Text>
        {!!sub && (
          <Text numberOfLines={1} style={{ color: `${colors.mutedForeground}b3`, fontSize: 10, fontFamily: fonts.body.regular, marginTop: 2 }}>{sub}</Text>
        )}
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
            <Text style={{ color: MATERIAL, fontSize: 11, fontFamily: fonts.body.medium }}>View all →</Text>
          </Pressable>
        )}
      </View>
      <View className="px-4 pb-1">{children}</View>
    </View>
  );
}

function GrnRow({ item, isLast }: { item: MaterialDashboardData["recentGRNs"][number]; isLast: boolean }) {
  const statusColor = STATUS_COLOR[item.Status ?? ""] ?? colors.mutedForeground;
  return (
    <View className="flex-row items-center justify-between py-2.5" style={!isLast ? { borderBottomWidth: 1, borderBottomColor: `${colors.border}60` } : undefined}>
      <View className="flex-1 min-w-0 pr-2">
        <Text numberOfLines={1} style={{ color: "#34d399", fontFamily: fonts.heading.semibold, fontSize: 12 }}>
          {item.GRNNo || `#${item.GRNID}`}
        </Text>
        <View className="flex-row items-center gap-1.5 mt-1">
          <View className="px-1.5 py-0.5 rounded-full" style={{ backgroundColor: `${statusColor}26` }}>
            <Text style={{ color: statusColor, fontSize: 8.5, fontFamily: fonts.heading.semibold }}>{item.Status || "Draft"}</Text>
          </View>
          <Text numberOfLines={1} style={{ color: colors.mutedForeground, fontSize: 10, fontFamily: fonts.body.regular, flexShrink: 1 }}>
            {item.SupplierName || "—"} · {fmtDay(item.GRNDate)}
          </Text>
        </View>
      </View>
      <Text style={{ color: colors.foreground, fontFamily: fonts.heading.semibold, fontSize: 12 }}>
        {item.TotalAmount != null ? fmtRupees(item.TotalAmount) : "—"}
      </Text>
    </View>
  );
}

function PoRow({ item, isLast }: { item: MaterialDashboardData["recentPOs"][number]; isLast: boolean }) {
  const statusColor = STATUS_COLOR[item.Status ?? ""] ?? colors.mutedForeground;
  return (
    <View className="flex-row items-center justify-between py-2.5" style={!isLast ? { borderBottomWidth: 1, borderBottomColor: `${colors.border}60` } : undefined}>
      <View className="flex-1 min-w-0 pr-2">
        <Text numberOfLines={1} style={{ color: "#34d399", fontFamily: fonts.heading.semibold, fontSize: 12 }}>
          {item.PurchaseOrderNo || `#${item.PurchaseOrderID}`}
        </Text>
        <View className="flex-row items-center gap-1.5 mt-1">
          <View className="px-1.5 py-0.5 rounded-full" style={{ backgroundColor: `${statusColor}26` }}>
            <Text style={{ color: statusColor, fontSize: 8.5, fontFamily: fonts.heading.semibold }}>{item.Status || "Draft"}</Text>
          </View>
          <Text numberOfLines={1} style={{ color: colors.mutedForeground, fontSize: 10, fontFamily: fonts.body.regular, flexShrink: 1 }}>
            {item.SupplierName || "—"} · {fmtDay(item.PODate)}
          </Text>
        </View>
      </View>
      <Text style={{ color: colors.foreground, fontFamily: fonts.heading.semibold, fontSize: 12 }}>
        {item.TotalAmount != null ? fmtRupees(item.TotalAmount) : "—"}
      </Text>
    </View>
  );
}

function QuickAction({ label, icon: Icon, onPress }: { label: string; icon: React.ComponentType<{ size?: number; color?: string }>; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={{ width: "31%", marginBottom: 10 }} className="rounded-xl overflow-hidden">
      <View className="items-center justify-center gap-1.5 py-3.5" style={{ backgroundColor: `${colors.card}b3`, borderWidth: 1, borderColor: `${colors.border}80` }}>
        <View className="w-8 h-8 rounded-lg items-center justify-center" style={{ backgroundColor: `${MATERIAL}26` }}>
          <Icon size={15} color={MATERIAL} />
        </View>
        <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 10, fontFamily: fonts.body.medium, textAlign: "center" }}>{label}</Text>
      </View>
    </Pressable>
  );
}

export default function MaterialDashboardScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const goToPurchaseOrder = () => navigation.navigate("PurchaseOrder");
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, isError, refetch, isFetching, dataUpdatedAt } = useQuery<MaterialDashboardData>({
    queryKey: ["material-dashboard"],
    queryFn: fetchMaterialDashboard,
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
    retry: 1,
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
          <View className="w-9 h-9 rounded-xl items-center justify-center" style={{ backgroundColor: `${MATERIAL}26`, borderWidth: 1, borderColor: `${MATERIAL}4d` }}>
            <Package size={16} color={MATERIAL} />
          </View>
          <View className="flex-1">
            <Text style={{ color: colors.foreground, fontFamily: fonts.heading.bold, fontSize: 20 }}>Material Overview</Text>
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
          {/* Stat cards */}
          <View className="mt-7">
            <SectionLabel>Overview</SectionLabel>
            <View className="flex-row flex-wrap justify-between">
              <StatTile label="Total Items" value={fmtNum(data?.items.count ?? 0)} sub={`${data?.items.groupCount ?? 0} item groups`} icon={Package} accent="#10b981" onPress={() => notBuiltYet("Item Master")} />
              <StatTile label="GRNs This Month" value={fmtNum(data?.grns.thisMonth ?? 0)} sub={`${data?.grns.today ?? 0} today · ${fmtRupees(data?.grns.thisMonthValue ?? 0)}`} icon={Truck} accent="#3b82f6" onPress={() => notBuiltYet("GRN")} />
              <StatTile label="Open POs" value={fmtNum(data?.purchaseOrders.open ?? 0)} sub={`${fmtRupees(data?.purchaseOrders.openValue ?? 0)} outstanding`} icon={ShoppingCart} accent="#f59e0b" onPress={() => goToPurchaseOrder()} />
              <StatTile label="Pending Expenses" value={fmtNum(data?.expenses.pending ?? 0)} sub={`${fmtRupees(data?.expenses.pendingAmount ?? 0)} pending`} icon={Receipt} accent="#ef4444" onPress={() => notBuiltYet("Expenses")} />
              <StatTile label="Net Stock" value={fmtNum((data?.stock.totalIn ?? 0) - (data?.stock.totalOut ?? 0))} sub={`${fmtNum(data?.stock.uniqueItems ?? 0)} items tracked`} icon={Layers} accent="#14b8a6" onPress={() => notBuiltYet("Stock")} />
              <StatTile label="Material Issues" value={fmtNum(data?.materialIssues.thisMonth ?? 0)} sub={`${data?.materialIssues.today ?? 0} today`} icon={PackageCheck} accent="#f97316" onPress={() => notBuiltYet("Material Issues")} />
              <StatTile label="Material Requests" value={fmtNum(data?.materialRequests.total ?? 0)} sub={`${data?.materialRequests.pending ?? 0} pending`} icon={Send} accent="#6366f1" onPress={() => notBuiltYet("Material Requests")} wide />
            </View>
          </View>

          {/* Totals */}
          <View className="mt-3">
            <SectionLabel>Totals</SectionLabel>
            <View className="flex-row flex-wrap justify-between">
              <StatTile label="Total GRN Value" value={fmtRupees(data?.grns.totalValue ?? 0)} sub={`${data?.grns.total ?? 0} total receipts`} icon={TrendingUp} accent="#10b981" wide />
              <StatTile label="Total PO Value" value={fmtRupees(data?.purchaseOrders.totalValue ?? 0)} sub={`${data?.purchaseOrders.total ?? 0} total orders`} icon={FileText} accent="#3b82f6" wide />
              <StatTile label="Total Expense Amount" value={fmtRupees(data?.expenses.totalAmount ?? 0)} sub={`${data?.expenses.approved ?? 0} approved`} icon={Receipt} accent="#f59e0b" wide />
            </View>
          </View>

          {/* Recent activity */}
          <View className="mt-3">
            <SectionLabel>Recent Activity</SectionLabel>
            <GlassPanel title="Recent GRNs" onViewAll={() => notBuiltYet("GRN")}>
              {(data?.recentGRNs ?? []).length === 0 ? (
                <Text className="py-6 text-center" style={{ color: `${colors.mutedForeground}66`, fontSize: 12, fontFamily: fonts.body.regular }}>
                  No GRNs recorded yet.
                </Text>
              ) : (
                data!.recentGRNs.slice(0, 6).map((g, i, arr) => <GrnRow key={g.GRNID ?? i} item={g} isLast={i === Math.min(arr.length, 6) - 1} />)
              )}
            </GlassPanel>
            <GlassPanel title="Recent Purchase Orders" onViewAll={() => goToPurchaseOrder()}>
              {(data?.recentPOs ?? []).length === 0 ? (
                <Text className="py-6 text-center" style={{ color: `${colors.mutedForeground}66`, fontSize: 12, fontFamily: fonts.body.regular }}>
                  No purchase orders yet.
                </Text>
              ) : (
                data!.recentPOs.slice(0, 6).map((p, i, arr) => <PoRow key={p.PurchaseOrderID ?? i} item={p} isLast={i === Math.min(arr.length, 6) - 1} />)
              )}
            </GlassPanel>
          </View>

          {/* Quick Actions */}
          <View className="mt-1 mb-2">
            <SectionLabel>Quick Actions</SectionLabel>
            <View className="flex-row flex-wrap justify-between">
              <QuickAction label="New GRN" icon={Truck} onPress={() => notBuiltYet("GRN")} />
              <QuickAction label="Purchase Order" icon={ShoppingCart} onPress={() => goToPurchaseOrder()} />
              <QuickAction label="Issues" icon={PackageCheck} onPress={() => notBuiltYet("Issues")} />
              <QuickAction label="Material Request" icon={Send} onPress={() => notBuiltYet("Material Request")} />
              <QuickAction label="Expense Booking" icon={Receipt} onPress={() => notBuiltYet("Expense Booking")} />
              <QuickAction label="UOM Master" icon={Ruler} onPress={() => notBuiltYet("UOM Master")} />
              <QuickAction label="Inventory" icon={ClipboardList} onPress={() => notBuiltYet("Inventory")} />
              <QuickAction label="T&C Master" icon={FileText} onPress={() => notBuiltYet("T&C Master")} />
            </View>
          </View>
        </>
      )}
    </ScrollView>
  );
}
