// One Fixed Asset — key fields + posted depreciation history for the
// current financial year (read-only; posting is done on web).
import { useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import type { RouteProp } from "@react-navigation/native";
import { useRoute } from "@react-navigation/native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { formatINR } from "@/utils/formatCurrency";
import { getFixedAsset, getAssetDepreciation } from "@/api/fixedAssetApi";
import type { MainStackParamList } from "@/navigation/MainStack";

const ACCENT = "#eab308";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <View className="flex-row justify-between py-1.5" style={{ borderBottomWidth: 1, borderBottomColor: `${colors.border}80` }}>
      <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: fonts.body.regular }}>{label}</Text>
      <Text style={{ color: colors.foreground, fontSize: 12, fontFamily: fonts.body.medium, maxWidth: "60%", textAlign: "right" }}>{value}</Text>
    </View>
  );
}

export default function AssetDetailScreen() {
  const route = useRoute<RouteProp<MainStackParamList, "AssetDetail">>();
  const { id } = route.params;
  const [refreshing, setRefreshing] = useState(false);
  const now = new Date();

  const assetQ = useQuery({ queryKey: ["fa-asset", id], queryFn: () => getFixedAsset(id) });
  const depQ = useQuery({
    queryKey: ["fa-asset-dep", id],
    queryFn: () => getAssetDepreciation(id, now.getFullYear(), now.getMonth() + 1),
  });

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([assetQ.refetch(), depQ.refetch()]);
    setRefreshing(false);
  };

  const a = assetQ.data;
  const history = (depQ.data?.history ?? []).filter((h) => h.Status !== "Reversed");

  return (
    <ScrollView
      className="flex-1"
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ padding: 16, paddingBottom: 96 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={ACCENT} />}
    >
      {assetQ.isLoading ? (
        <View style={{ paddingVertical: 60, alignItems: "center" }}>
          <ActivityIndicator color={colors.mutedForeground} />
        </View>
      ) : assetQ.error ? (
        <Text style={{ color: colors.destructive, fontSize: 12, fontFamily: fonts.body.regular }}>{(assetQ.error as Error).message}</Text>
      ) : a ? (
        <>
          <Text style={{ color: colors.foreground, fontSize: 18, fontFamily: fonts.heading.bold }}>{a.AssetName}</Text>
          <Text style={{ color: ACCENT, fontSize: 12, fontFamily: fonts.body.medium, marginTop: 2 }}>
            {a.AssetCode || "—"} · {a.AssetCategory}
          </Text>

          <View style={{ backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 14, marginTop: 14 }}>
            <Row label="FA Item Code" value={a.FAItemCode} />
            <Row label="Type of Repairs (SAC)" value={a.RepairType} />
            <Row label="Brand / Model" value={[a.Brand, a.Model].filter(Boolean).join(" ") || null} />
            <Row label="Serial Number" value={a.SerialNumber} />
            <Row label="Company" value={a.CompanyName} />
            <Row label="Project" value={a.ProjectName} />
            <Row label="Financial Year" value={a.FinYear} />
            <Row label="Purchase Date" value={a.PurchaseDate ? new Date(a.PurchaseDate).toLocaleDateString("en-IN") : null} />
            <Row label="Activation Date" value={a.ActivationDate ? new Date(a.ActivationDate).toLocaleDateString("en-IN") : null} />
            <Row label="Purchase Cost" value={formatINR(a.PurchaseCost, { decimals: 2 })} />
            <Row label="Depreciation" value={a.DepreciationRate ? `${a.DepreciationType || "SLM"} · ${a.DepreciationRate}% p.a.` : null} />
            <Row label="Custodian" value={a.Custodian} />
            <Row label="Location" value={a.Location} />
            <Row label="Status" value={a.AssetStatus} />
          </View>

          <Text style={{ color: colors.mutedForeground, fontSize: 11, fontFamily: fonts.heading.bold, letterSpacing: 1.5, marginTop: 20, marginBottom: 8, textTransform: "uppercase" }}>
            Posted Depreciation
          </Text>
          {depQ.isLoading ? (
            <ActivityIndicator color={colors.mutedForeground} />
          ) : history.length === 0 ? (
            <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: fonts.body.regular }}>
              No depreciation posted yet.
            </Text>
          ) : (
            <View style={{ backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.border, overflow: "hidden" }}>
              {history.map((h, i) => (
                <View
                  key={h.EntryId}
                  className="flex-row items-center justify-between px-3 py-2.5"
                  style={i > 0 ? { borderTopWidth: 1, borderTopColor: `${colors.border}80` } : undefined}
                >
                  <View>
                    <Text style={{ color: colors.foreground, fontSize: 12, fontFamily: fonts.body.medium }}>
                      {MONTHS[h.PeriodMonth - 1]} {h.PeriodYear}
                    </Text>
                    <Text style={{ color: "#5c6270", fontSize: 10, fontFamily: fonts.body.regular }}>{h.VoucherNo || "—"}</Text>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={{ color: colors.foreground, fontSize: 12, fontFamily: fonts.body.semibold }}>
                      {formatINR(h.DepreciationAmount, { decimals: 2 })}
                    </Text>
                    <Text style={{ color: "#5c6270", fontSize: 10, fontFamily: fonts.body.regular }}>
                      BV {formatINR(h.ClosingBookValue, { decimals: 2 })}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          )}
        </>
      ) : null}
    </ScrollView>
  );
}
