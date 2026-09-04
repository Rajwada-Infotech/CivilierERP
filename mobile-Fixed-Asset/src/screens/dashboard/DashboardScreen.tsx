// Fixed Asset overview — live counts + book value from /api/fixed-assets
// and posted-repair spend from /api/fixed-asset-maintenance. Cards deep-link
// into the Asset Register and Maintenance screens.
import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Boxes, TrendingDown, Wrench, IndianRupee, ChevronRight } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { formatINR } from "@/utils/formatCurrency";
import { SectionLabel } from "@/components/home/SectionLabel";
import { navigate } from "@/navigation/navigationRef";
import { getFixedAssets, getMaintenanceList } from "@/api/fixedAssetApi";

const ACCENT = "#eab308";

// Straight-line book value estimate, matching the web dashboard's
// calcDepreciation() (time-since-purchase × annual rate, capped at cost).
function bookValue(cost: number, rate: number | null, purchaseDate: string | null): number {
  if (!cost || !rate || !purchaseDate) return cost || 0;
  const yrs = Math.max(0, (Date.now() - new Date(purchaseDate).getTime()) / (365.25 * 864e5));
  const totalDep = Math.min(cost, cost * (rate / 100) * yrs);
  return Math.max(0, cost - totalDep);
}

function StatCard({
  label, value, sub, icon: Icon, color, onPress,
}: {
  label: string; value: string; sub?: string;
  icon: React.ComponentType<{ size?: number; color?: string }>; color: string; onPress?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        flex: 1,
        minWidth: "45%",
        backgroundColor: colors.card,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: colors.border,
        padding: 14,
      }}
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

export default function DashboardScreen() {
  const [refreshing, setRefreshing] = useState(false);

  const assetsQ = useQuery({ queryKey: ["fa-assets"], queryFn: () => getFixedAssets() });
  const maintQ = useQuery({ queryKey: ["fa-maint"], queryFn: () => getMaintenanceList() });

  const stats = useMemo(() => {
    const assets = assetsQ.data ?? [];
    const maint = maintQ.data ?? [];
    const active = assets.filter((a) => a.AssetStatus === "Active").length;
    const totalCost = assets.reduce((s, a) => s + Number(a.PurchaseCost || 0), 0);
    const totalBook = assets.reduce((s, a) => s + bookValue(Number(a.PurchaseCost || 0), a.DepreciationRate, a.PurchaseDate), 0);
    const postedRepairs = maint.filter((m) => m.Status === "Posted");
    const repairSpend = postedRepairs.reduce((s, m) => s + Number(m.TotalAmount ?? m.Amount ?? 0), 0);
    return {
      count: assets.length, active,
      totalCost, totalBook,
      draftMaint: maint.filter((m) => m.Status === "Draft").length,
      postedMaint: postedRepairs.length,
      repairSpend,
    };
  }, [assetsQ.data, maintQ.data]);

  const loading = assetsQ.isLoading || maintQ.isLoading;

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([assetsQ.refetch(), maintQ.refetch()]);
    setRefreshing(false);
  };

  return (
    <ScrollView
      className="flex-1"
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ padding: 16, paddingBottom: 96 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={ACCENT} />}
    >
      <SectionLabel>Fixed Asset Overview</SectionLabel>

      {loading ? (
        <View style={{ paddingVertical: 60, alignItems: "center" }}>
          <ActivityIndicator color={colors.mutedForeground} />
        </View>
      ) : (
        <>
          <View className="flex-row flex-wrap gap-3">
            <StatCard
              label="Fixed Assets" value={String(stats.count)} sub={`${stats.active} active`}
              icon={Boxes} color={ACCENT} onPress={() => navigate("AssetRegister")}
            />
            <StatCard
              label="Net Book Value" value={formatINR(stats.totalBook)}
              sub={`cost ${formatINR(stats.totalCost)}`} icon={TrendingDown} color="#3b82f6"
            />
            <StatCard
              label="Repair Vouchers" value={String(stats.postedMaint)}
              sub={stats.draftMaint ? `${stats.draftMaint} draft` : "all posted"}
              icon={Wrench} color="#8b5cf6" onPress={() => navigate("Maintenance")}
            />
            <StatCard
              label="Repair Spend (posted)" value={formatINR(stats.repairSpend)}
              sub="incl. GST" icon={IndianRupee} color="#10b981"
            />
          </View>

          <View style={{ marginTop: 22 }}>
            <SectionLabel>Quick Links</SectionLabel>
            {[
              { label: "Asset Register", desc: "Browse & search fixed assets", route: "AssetRegister" as const },
              { label: "Maintenance & Repair", desc: "Posted & draft repair vouchers", route: "Maintenance" as const },
            ].map((l) => (
              <Pressable
                key={l.route}
                onPress={() => navigate(l.route)}
                className="flex-row items-center justify-between"
                style={{ backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 14, marginBottom: 8 }}
              >
                <View>
                  <Text style={{ color: colors.foreground, fontSize: 13, fontFamily: fonts.heading.semibold }}>{l.label}</Text>
                  <Text style={{ color: colors.mutedForeground, fontSize: 11, fontFamily: fonts.body.regular, marginTop: 2 }}>{l.desc}</Text>
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
