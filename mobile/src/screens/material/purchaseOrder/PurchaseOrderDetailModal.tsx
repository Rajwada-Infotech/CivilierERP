// RN port of PurchaseOrderMaster.tsx's quick "Preview Modal" — Details tab
// only (per scope decision). Deferred vs. web: the "Supplier" tab (embedded
// OrderChat), the separate full-page read-only view with its "Purchase
// Flow Status" chain panel, and print — all stay web-only.
import { useQuery } from "@tanstack/react-query";
import { View, Text, Modal, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { X, ShoppingCart, Link2 } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { formatINR } from "@/utils/formatCurrency";
import {
  getPurchaseOrderById, getSupplierDetails, getCompanyDetails,
  type PurchaseOrder,
} from "@/api/purchaseOrdersApi";
import { ApprovalStatusChain } from "@/components/ApprovalStatusChain";

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? d : dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={{ width: "50%", paddingRight: 8, marginBottom: 12 }}>
      <Text style={{ color: colors.mutedForeground, fontSize: 9, fontFamily: fonts.heading.medium, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</Text>
      <Text numberOfLines={1} style={{ color: mono ? colors.primary : colors.foreground, fontSize: 12.5, fontFamily: fonts.body.medium, marginTop: 2 }}>{value}</Text>
    </View>
  );
}

export function PurchaseOrderDetailModal({ recordId, onClose }: { recordId: number | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();

  const { data: po, isLoading } = useQuery<PurchaseOrder>({
    queryKey: ["po-detail", recordId],
    queryFn: () => getPurchaseOrderById(recordId!),
    enabled: recordId != null,
  });

  const { data: supplier } = useQuery({
    queryKey: ["po-detail-supplier", po?.SupplierID],
    queryFn: () => getSupplierDetails(po!.SupplierID!),
    enabled: !!po?.SupplierID,
  });
  const { data: company } = useQuery({
    queryKey: ["po-detail-company", po?.CompanyId],
    queryFn: () => getCompanyDetails(po!.CompanyId!),
    enabled: !!po?.CompanyId,
  });

  if (recordId == null) return null;

  return (
    <Modal visible={recordId != null} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <View style={{ paddingTop: insets.top + 8 }} className="flex-row items-center justify-between px-4 pb-3">
          <View className="flex-row items-center gap-2.5 flex-1 min-w-0">
            <View className="w-8 h-8 rounded-lg items-center justify-center" style={{ backgroundColor: "#10b98126" }}>
              <ShoppingCart size={14} color="#10b981" />
            </View>
            <View className="min-w-0">
              <Text style={{ color: colors.foreground, fontSize: 14, fontFamily: fonts.heading.semibold }}>Purchase Order</Text>
              {!!po?.PurchaseOrderNo && <Text style={{ color: colors.mutedForeground, fontSize: 10.5 }}>{po.PurchaseOrderNo}</Text>}
            </View>
          </View>
          <Pressable onPress={onClose} className="w-8 h-8 rounded-lg items-center justify-center" style={{ borderWidth: 1, borderColor: colors.border }}>
            <X size={15} color={colors.mutedForeground} />
          </Pressable>
        </View>

        {isLoading || !po ? (
          <View className="flex-1 items-center justify-center"><ActivityIndicator color={colors.mutedForeground} /></View>
        ) : (
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}>
            <View className="flex-row items-center gap-2 mb-4">
              <ApprovalStatusChain table="PurchaseOrders" recordId={po.PurchaseOrderID} />
            </View>

            <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
              <Field label="PO Number" value={po.PurchaseOrderNo || "—"} mono />
              <Field label="PO Type" value={po.POType || "—"} />
              <Field label="PO Date" value={fmtDate(po.PODate)} />
              <Field label="Expected Delivery" value={fmtDate(po.ExpectedDeliveryDate)} />
              <Field label="Supplier" value={po.SupplierName || "—"} />
              <Field label="Company" value={po.CompanyName || "—"} />
              <Field label="Project / Site" value={po.ProjectName || "—"} />
              <Field label="Cost Center" value={po.CostCenterName || "—"} />
              <Field label="Total Amount" value={formatINR(po.TotalAmount ?? 0)} />
            </View>

            {(po.SourceMRDocNo || po.SourceWODocNo || po.SourceWDDocNo) && (
              <View className="flex-row flex-wrap gap-2 mb-3">
                {!!po.SourceMRDocNo && (
                  <View className="flex-row items-center gap-1.5 px-2.5 py-1 rounded-lg" style={{ backgroundColor: "#3b82f615", borderWidth: 1, borderColor: "#3b82f630" }}>
                    <Link2 size={9} color="#3b82f6" />
                    <Text style={{ color: "#3b82f6", fontSize: 10, fontFamily: fonts.body.semibold }}>MR: {po.SourceMRDocNo}</Text>
                  </View>
                )}
                {!!po.SourceWODocNo && (
                  <View className="flex-row items-center gap-1.5 px-2.5 py-1 rounded-lg" style={{ backgroundColor: "#8b5cf615", borderWidth: 1, borderColor: "#8b5cf630" }}>
                    <Link2 size={9} color="#8b5cf6" />
                    <Text style={{ color: "#8b5cf6", fontSize: 10, fontFamily: fonts.body.semibold }}>WO: {po.SourceWODocNo}</Text>
                  </View>
                )}
              </View>
            )}

            {!!po.PaymentTerms && (
              <View className="rounded-xl px-3 py-2.5 mb-3" style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: `${colors.muted}30` }}>
                <Text style={{ color: colors.mutedForeground, fontSize: 9, fontFamily: fonts.heading.medium, textTransform: "uppercase", marginBottom: 4 }}>Payment Terms / T&C</Text>
                <Text style={{ color: colors.foreground, fontSize: 12 }}>{po.PaymentTerms}</Text>
              </View>
            )}

            {(supplier || company) && (
              <View className="mb-3" style={{ gap: 8 }}>
                {!!supplier && (
                  <View className="rounded-xl p-3" style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: `${colors.muted}20` }}>
                    <Text style={{ color: colors.mutedForeground, fontSize: 9, fontFamily: fonts.heading.semibold, textTransform: "uppercase", marginBottom: 4 }}>Supplier Details</Text>
                    <Text style={{ color: colors.foreground, fontSize: 12, fontFamily: fonts.body.medium }}>{supplier.LHeadName}</Text>
                    {!!supplier.LHeadAddress && <Text style={{ color: colors.mutedForeground, fontSize: 10.5, marginTop: 2 }}>{supplier.LHeadAddress}</Text>}
                    {!!supplier.LGST && <Text style={{ color: colors.mutedForeground, fontSize: 10.5, marginTop: 2 }}>GSTIN: {supplier.LGST}</Text>}
                  </View>
                )}
                {!!company && (
                  <View className="rounded-xl p-3" style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: `${colors.muted}20` }}>
                    <Text style={{ color: colors.mutedForeground, fontSize: 9, fontFamily: fonts.heading.semibold, textTransform: "uppercase", marginBottom: 4 }}>Billing Company</Text>
                    <Text style={{ color: colors.foreground, fontSize: 12, fontFamily: fonts.body.medium }}>{company.name}</Text>
                    {!!company.address && <Text style={{ color: colors.mutedForeground, fontSize: 10.5, marginTop: 2 }}>{company.address}</Text>}
                    {!!company.gst_no && <Text style={{ color: colors.mutedForeground, fontSize: 10.5, marginTop: 2 }}>GSTIN: {company.gst_no}</Text>}
                  </View>
                )}
              </View>
            )}

            {!!po.POItems?.length && (
              <View className="mb-3">
                <Text style={{ color: colors.mutedForeground, fontSize: 9, fontFamily: fonts.heading.semibold, textTransform: "uppercase", marginBottom: 6 }}>
                  Order Items ({po.POItems.length})
                </Text>
                <View className="rounded-xl overflow-hidden" style={{ borderWidth: 1, borderColor: colors.border }}>
                  {po.POItems.map((li, i) => {
                    const qty = Number(li.Quantity ?? 0);
                    const received = li.ReceivedQty != null ? Number(li.ReceivedQty) : null;
                    return (
                      <View key={i} className="px-3 py-2.5" style={{ borderTopWidth: i > 0 ? 1 : 0, borderTopColor: `${colors.border}80` }}>
                        <View className="flex-row items-center justify-between mb-1">
                          <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 12, fontFamily: fonts.body.semibold, flex: 1, marginRight: 8 }}>
                            {li.ItemName || li.Description || "—"}
                          </Text>
                          <Text style={{ color: colors.foreground, fontSize: 12, fontFamily: fonts.heading.semibold }}>
                            {formatINR(li.LineAmount ?? qty * (li.Rate ?? 0))}
                          </Text>
                        </View>
                        <View className="flex-row items-center justify-between">
                          <Text style={{ color: colors.mutedForeground, fontSize: 10 }}>
                            {qty} {li.UomName || ""} × {formatINR(li.Rate ?? 0)}{li.TaxPct ? ` · ${li.TaxPct}% GST` : ""}
                          </Text>
                          {received != null && (
                            <Text style={{ color: received >= qty ? "#059669" : colors.mutedForeground, fontSize: 10, fontFamily: fonts.body.semibold }}>
                              Received: {received}
                            </Text>
                          )}
                        </View>
                      </View>
                    );
                  })}
                </View>
              </View>
            )}

            {!!po.Remarks && (
              <View className="rounded-xl px-3 py-2.5" style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: `${colors.muted}30` }}>
                <Text style={{ color: colors.mutedForeground, fontSize: 9, fontFamily: fonts.heading.medium, textTransform: "uppercase", marginBottom: 4 }}>Remarks</Text>
                <Text style={{ color: colors.foreground, fontSize: 12 }}>{po.Remarks}</Text>
              </View>
            )}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}
