// RN port of FixedAssetRecord.tsx's detail view — web renders this as a
// full page, not a modal/dialog; ported as a single-scroll modal here to
// match the sheet pattern used everywhere else in mobile. Same 5
// conditional sections as web: hero + stat row, Asset Details (only
// non-empty fields render), Depreciation Details, Sale Information (only
// if AssetStatus==="Sold"), Remarks. No depreciation-schedule table and no
// transfer/disposal history — web has neither, it's a single computed
// snapshot (see fixedAssetApi.ts's calcDepreciation).
import { useQuery } from "@tanstack/react-query";
import { View, Text, Modal, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { X, Cpu } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { formatINR } from "@/utils/formatCurrency";
import { getFixedAsset, calcDepreciation, STATUS_COLOR, type FixedAssetDetail } from "@/api/fixedAssetApi";

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? d : dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <View style={{ width: "50%", paddingRight: 8, marginBottom: 12 }}>
      <Text style={{ color: colors.mutedForeground, fontSize: 9, fontFamily: fonts.heading.medium, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</Text>
      <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 12.5, fontFamily: fonts.body.medium, marginTop: 2 }}>{value}</Text>
    </View>
  );
}

export function FixedAssetDetailModal({ recordId, onClose }: { recordId: number | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();

  const { data: asset, isLoading } = useQuery<FixedAssetDetail>({
    queryKey: ["fa-detail", recordId],
    queryFn: () => getFixedAsset(recordId!),
    enabled: recordId != null,
  });

  if (recordId == null) return null;
  const dc = asset ? calcDepreciation(asset.PurchaseCost, asset.DepreciationRate, asset.PurchaseDate) : null;
  const statusColor = asset ? STATUS_COLOR[asset.AssetStatus] ?? "#64748b" : "#64748b";
  const profitLoss = asset?.SellingPrice != null && dc ? asset.SellingPrice - dc.bookValue : null;

  return (
    <Modal visible animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <View style={{ paddingTop: insets.top + 8 }} className="flex-row items-center justify-between px-4 pb-3">
          <View className="flex-row items-center gap-2.5 flex-1 min-w-0">
            <View className="w-8 h-8 rounded-lg items-center justify-center" style={{ backgroundColor: "#0891b226" }}>
              <Cpu size={14} color="#0891b2" />
            </View>
            <View className="min-w-0">
              <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 14, fontFamily: fonts.heading.semibold }}>{asset?.AssetName || "Asset"}</Text>
              {!!asset?.AssetCode && <Text style={{ color: colors.mutedForeground, fontSize: 10.5 }}>{asset.AssetCode}</Text>}
            </View>
          </View>
          <Pressable onPress={onClose} className="w-8 h-8 rounded-lg items-center justify-center" style={{ borderWidth: 1, borderColor: colors.border }}>
            <X size={15} color={colors.mutedForeground} />
          </Pressable>
        </View>

        {isLoading || !asset ? (
          <View className="flex-1 items-center justify-center"><ActivityIndicator color={colors.mutedForeground} /></View>
        ) : (
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}>
            <View className="flex-row items-center gap-2 mb-4">
              <View className="px-2 py-0.5 rounded-full" style={{ backgroundColor: `${statusColor}1a`, borderWidth: 1, borderColor: `${statusColor}40` }}>
                <Text style={{ color: statusColor, fontSize: 10.5, fontFamily: fonts.heading.semibold }}>{asset.AssetStatus}</Text>
              </View>
              <View className="px-2 py-0.5 rounded-full" style={{ backgroundColor: `${colors.mutedForeground}1a`, borderWidth: 1, borderColor: `${colors.mutedForeground}40` }}>
                <Text style={{ color: colors.mutedForeground, fontSize: 10.5, fontFamily: fonts.heading.semibold }}>{asset.AssetCategory}</Text>
              </View>
            </View>

            {dc && (
              <View className="rounded-xl overflow-hidden mb-4" style={{ borderWidth: 1, borderColor: colors.border }}>
                {[
                  ["Purchase Cost", formatINR(asset.PurchaseCost)],
                  ["Annual Depreciation", formatINR(dc.annualDepreciation)],
                  ["Total Depreciation", formatINR(dc.totalDepreciation)],
                  ["Current Book Value", formatINR(dc.bookValue)],
                ].map(([label, value], i) => (
                  <View key={label} className="flex-row items-center justify-between px-3.5 py-2.5" style={{ borderTopWidth: i > 0 ? 1 : 0, borderTopColor: `${colors.border}60`, backgroundColor: i === 3 ? `${colors.primary}0d` : "transparent" }}>
                    <Text style={{ color: colors.mutedForeground, fontSize: 11.5 }}>{label}</Text>
                    <Text style={{ color: i === 3 ? colors.primary : colors.foreground, fontSize: i === 3 ? 14 : 12, fontFamily: fonts.heading.semibold }}>{value}</Text>
                  </View>
                ))}
              </View>
            )}

            <Text style={{ color: colors.mutedForeground, fontSize: 9, fontFamily: fonts.heading.semibold, textTransform: "uppercase", marginBottom: 6 }}>Asset Details</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", marginBottom: 4 }}>
              <Field label="Brand" value={asset.Brand} />
              <Field label="Model" value={asset.Model} />
              <Field label="Serial Number" value={asset.SerialNumber} />
              <Field label="Company" value={asset.CompanyName} />
              <Field label="Project" value={asset.ProjectName} />
              <Field label="Financial Year" value={asset.FinYear} />
              <Field label="Purchase Date" value={fmtDate(asset.PurchaseDate)} />
              <Field label="Activation Date" value={asset.ActivationDate ? fmtDate(asset.ActivationDate) : null} />
              <Field label="Invoice Ref" value={asset.PurchaseInvoiceRef} />
              <Field label="Supplier" value={asset.SupplierName} />
              <Field label="Quantity" value={asset.Quantity != null ? String(asset.Quantity) : null} />
              <Field label="Location" value={asset.Location} />
              <Field label="Department" value={asset.Department} />
              <Field label="Custodian" value={asset.Custodian} />
              <Field label="Useful Life" value={asset.UsefulLife != null ? `${asset.UsefulLife} yrs` : null} />
            </View>

            {dc && (
              <>
                <Text style={{ color: colors.mutedForeground, fontSize: 9, fontFamily: fonts.heading.semibold, textTransform: "uppercase", marginTop: 6, marginBottom: 6 }}>Depreciation Details</Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", marginBottom: 4 }}>
                  <Field label="Type" value={asset.DepreciationType} />
                  <Field label="Rate" value={asset.DepreciationRate != null ? `${asset.DepreciationRate}%` : null} />
                  <Field label="Years Elapsed" value={dc.years.toFixed(1)} />
                  <Field label="Annual Dep." value={formatINR(dc.annualDepreciation)} />
                  <Field label="Total Dep." value={formatINR(dc.totalDepreciation)} />
                  <Field label="Book Value" value={formatINR(dc.bookValue)} />
                </View>
              </>
            )}

            {asset.AssetStatus === "Sold" && (
              <>
                <Text style={{ color: colors.mutedForeground, fontSize: 9, fontFamily: fonts.heading.semibold, textTransform: "uppercase", marginTop: 6, marginBottom: 6 }}>Sale Information</Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", marginBottom: 4 }}>
                  <Field label="Buyer" value={asset.BuyerName} />
                  <Field label="Sale Date" value={asset.SaleDate ? fmtDate(asset.SaleDate) : null} />
                  <Field label="Purchase Cost" value={formatINR(asset.PurchaseCost)} />
                  <Field label="Book Value" value={dc ? formatINR(dc.bookValue) : null} />
                  <Field label="Selling Price" value={asset.SellingPrice != null ? formatINR(asset.SellingPrice) : null} />
                </View>
                {!!asset.SaleRemarks && (
                  <View className="rounded-xl px-3 py-2.5 mb-3" style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: `${colors.muted}30` }}>
                    <Text style={{ color: colors.mutedForeground, fontSize: 9, fontFamily: fonts.heading.medium, textTransform: "uppercase", marginBottom: 4 }}>Sale Remarks</Text>
                    <Text style={{ color: colors.foreground, fontSize: 12 }}>{asset.SaleRemarks}</Text>
                  </View>
                )}
                {profitLoss != null && (
                  <View className="flex-row items-center justify-between rounded-xl px-3.5 py-3 mb-3" style={{ borderWidth: 1, borderColor: profitLoss >= 0 ? "#05966940" : "#dc262640", backgroundColor: profitLoss >= 0 ? "#0596690d" : "#dc26260d" }}>
                    <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>Profit / Loss</Text>
                    <Text style={{ color: profitLoss >= 0 ? "#059669" : "#dc2626", fontSize: 14, fontFamily: fonts.heading.bold }}>{profitLoss >= 0 ? "+" : ""}{formatINR(profitLoss)}</Text>
                  </View>
                )}
              </>
            )}

            {!!asset.Remarks && (
              <View className="rounded-xl px-3 py-2.5" style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: `${colors.muted}30` }}>
                <Text style={{ color: colors.mutedForeground, fontSize: 9, fontFamily: fonts.heading.medium, textTransform: "uppercase", marginBottom: 4 }}>Remarks</Text>
                <Text style={{ color: colors.foreground, fontSize: 12 }}>{asset.Remarks}</Text>
              </View>
            )}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}
