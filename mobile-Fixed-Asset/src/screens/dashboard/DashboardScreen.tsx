// Fixed Asset overview — KPIs, book-value-by-category, and quick links into
// every module. Mirrors the web FixedAssetDashboard.
import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import {
  Boxes, TrendingDown, Wrench, IndianRupee, ChevronRight, Tag, DownloadCloud, UserCheck, ArrowLeftRight, ShieldCheck,
} from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { formatINR } from "@/utils/formatCurrency";
import { bookValueOf } from "@/utils/depreciation";
import { SectionLabel } from "@/components/home/SectionLabel";
import { navigate } from "@/navigation/navigationRef";
import { useAuth } from "@/auth/AuthContext";
import { PRIVILEGED_ROLES } from "@/auth/permissions";
import { getFixedAssets, getMaintenanceList } from "@/api/fixedAssetApi";
import type { MainStackParamList } from "@/navigation/MainStack";

const ACCENT = "#eab308";

function StatCard({
  label, value, sub, icon: Icon, color, onPress,
}: {
  label: string; value: string; sub?: string;
  icon: React.ComponentType<{ size?: number; color?: string }>; color: string; onPress?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{ flex: 1, minWidth: "45%", backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 14 }}
    >
      <View className="flex-row items-center justify-between mb-3">
        <View style={{ width: 30, height: 30, borderRadius: 9, backgroundColor: `${color}1f`, alignItems: "center", justifyContent: "center" }}>
          <Icon size={15} color={color} />
        </View>
        {onPress && <ChevronRight size={14} color="#5c6270" />}
      </View>
      <Text style={{ color: colors.foreground, fontSize: 20, fontFamily: fonts.heading.bold }}>{value}</Text>
      <Text style={{ color: colors.mutedForeground, fontSize: 11, fontFamily: fonts.body.medium, marginTop: 2 }}>{label}</Text>
      {sub && <Text style={{ color: "#5c6270", fontSize: 10, fontFamily: fonts.body.regular, marginTop: 2 }}>{sub}</Text>}
    </Pressable>
  );
}

const LINKS: { label: string; desc: string; route: keyof MainStackParamList; icon: React.ComponentType<{ size?: number; color?: string }>; pageKey: string }[] = [
  { label: "Asset Register", desc: "Fixed Asset records & depreciation", route: "AssetRegister", icon: Boxes, pageKey: "fixed-asset-record" },
  { label: "FA Inventory", desc: "Tag received stock", route: "Tagging", icon: Tag, pageKey: "fixed-asset-tagging" },
  { label: "Inventory Import", desc: "Opening-stock imports", route: "InventoryImport", icon: DownloadCloud, pageKey: "fixed-asset-inventory-import" },
  { label: "Assignment", desc: "Who holds each asset", route: "Assignment", icon: UserCheck, pageKey: "fixed-asset-assignment" },
  { label: "User-Wise Asset Transfer", desc: "Move custody between users", route: "AssetTransfer", icon: ArrowLeftRight, pageKey: "asset-transfer" },
  { label: "Owner & Quality Checking", desc: "Condition checks & follow-ups", route: "QualityCheck", icon: ShieldCheck, pageKey: "fixed-asset-quality-check" },
  { label: "Maintenance & Repair", desc: "Repair vouchers & spend", route: "Maintenance", icon: Wrench, pageKey: "fixed-asset-maintenance" },
];

export default function DashboardScreen() {
  const [refreshing, setRefreshing] = useState(false);
  const { canAccessPage, currentUser } = useAuth();
  const privileged = PRIVILEGED_ROLES.includes((currentUser?.role ?? "user") as never);

  const assetsQ = useQuery({ queryKey: ["fa-assets"], queryFn: () => getFixedAssets() });
  const maintQ = useQuery({ queryKey: ["fa-maint"], queryFn: () => getMaintenanceList() });

  const stats = useMemo(() => {
    const assets = (assetsQ.data ?? []).filter((a) => a.Status !== "Deleted");
    const maint = maintQ.data ?? [];
    const totalCost = assets.reduce((s, a) => s + Number(a.PurchaseCost || 0), 0);
    const totalBook = assets.reduce((s, a) => s + bookValueOf(Number(a.PurchaseCost || 0), a.DepreciationRate, a.PurchaseDate), 0);
    const postedRepairs = maint.filter((m) => m.Status === "Posted");
    const byCat = new Map<string, number>();
    for (const a of assets) {
      byCat.set(a.AssetCategory, (byCat.get(a.AssetCategory) || 0) + bookValueOf(Number(a.PurchaseCost || 0), a.DepreciationRate, a.PurchaseDate));
    }
    const cats = Array.from(byCat.entries()).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 6);
    return {
      count: assets.length,
      active: assets.filter((a) => a.AssetStatus === "Active").length,
      pending: assets.filter((a) => a.AssetStatus === "Pending").length,
      totalCost, totalBook,
      draftMaint: maint.filter((m) => m.Status === "Draft").length,
      postedMaint: postedRepairs.length,
      repairSpend: postedRepairs.reduce((s, m) => s + Number(m.TotalAmount ?? m.Amount ?? 0), 0),
      cats, catMax: cats.length ? cats[0][1] : 0,
    };
  }, [assetsQ.data, maintQ.data]);

  const loading = assetsQ.isLoading || maintQ.isLoading;
  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([assetsQ.refetch(), maintQ.refetch()]);
    setRefreshing(false);
  };

  const links = LINKS.filter((l) => privileged || canAccessPage(l.pageKey));

  return (
    <ScrollView
      className="flex-1"
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ padding: 16, paddingBottom: 96 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={ACCENT} />}
    >
      <SectionLabel>Fixed Asset Overview</SectionLabel>

      {loading ? (
        <View style={{ paddingVertical: 60, alignItems: "center" }}><ActivityIndicator color={colors.mutedForeground} /></View>
      ) : (
        <>
          <View className="flex-row flex-wrap gap-3">
            <StatCard label="Total Assets" value={String(stats.count)} sub={`${stats.active} active · ${stats.pending} pending`} icon={Boxes} color={ACCENT} onPress={() => navigate("AssetRegister")} />
            <StatCard label="Net Book Value" value={formatINR(stats.totalBook)} sub={`cost ${formatINR(stats.totalCost)}`} icon={TrendingDown} color="#3b82f6" />
            <StatCard label="Repair Vouchers" value={String(stats.postedMaint)} sub={stats.draftMaint ? `${stats.draftMaint} draft` : "all posted"} icon={Wrench} color="#8b5cf6" onPress={() => navigate("Maintenance")} />
            <StatCard label="Repair Spend (posted)" value={formatINR(stats.repairSpend)} sub="incl. GST" icon={IndianRupee} color="#10b981" />
          </View>

          {stats.cats.length > 0 && (
            <View style={{ marginTop: 22 }}>
              <SectionLabel>Book Value by Category</SectionLabel>
              <View style={{ backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 14, gap: 10 }}>
                {stats.cats.map(([cat, val]) => (
                  <View key={cat}>
                    <View className="flex-row items-center justify-between" style={{ marginBottom: 4 }}>
                      <Text style={{ color: colors.foreground, fontSize: 11.5, fontFamily: fonts.body.medium }}>{cat}</Text>
                      <Text style={{ color: colors.mutedForeground, fontSize: 11, fontFamily: fonts.body.regular }}>{formatINR(val)}</Text>
                    </View>
                    <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.muted, overflow: "hidden" }}>
                      <View style={{ height: "100%", borderRadius: 3, backgroundColor: ACCENT, width: `${stats.catMax ? (val / stats.catMax) * 100 : 0}%` }} />
                    </View>
                  </View>
                ))}
              </View>
            </View>
          )}

          <View style={{ marginTop: 22 }}>
            <SectionLabel>Modules</SectionLabel>
            {links.map((l) => (
              <Pressable
                key={l.route}
                onPress={() => navigate(l.route)}
                className="flex-row items-center gap-3"
                style={{ backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 13, marginBottom: 8 }}
              >
                <View style={{ width: 32, height: 32, borderRadius: 9, backgroundColor: `${ACCENT}1f`, alignItems: "center", justifyContent: "center" }}>
                  <l.icon size={15} color={ACCENT} />
                </View>
                <View className="flex-1 min-w-0">
                  <Text style={{ color: colors.foreground, fontSize: 13, fontFamily: fonts.heading.semibold }}>{l.label}</Text>
                  <Text numberOfLines={1} style={{ color: colors.mutedForeground, fontSize: 11, fontFamily: fonts.body.regular, marginTop: 1 }}>{l.desc}</Text>
                </View>
                <ChevronRight size={16} color="#5c6270" />
              </Pressable>
            ))}
          </View>

          {(assetsQ.error || maintQ.error) && (
            <Text style={{ color: colors.destructive, fontSize: 11, fontFamily: fonts.body.regular, marginTop: 12 }}>
              {(assetsQ.error as Error)?.message || (maintQ.error as Error)?.message}
            </Text>
          )}
        </>
      )}
    </ScrollView>
  );
}
