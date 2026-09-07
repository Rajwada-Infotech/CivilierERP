// RN port of MaterialRequest.tsx's ViewModal — single scroll, no tabs (web
// has none here either). Deferred vs. web: DocumentChainPanel and print.
import { useQuery } from "@tanstack/react-query";
import { View, Text, Modal, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { X, ClipboardList, ShoppingCart } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { getMaterialRequestById, getMRLinkedPOs, PRIORITY_COLOR, type MaterialRequest } from "@/api/materialRequestApi";
import { ApprovalStatusChain } from "@/components/ApprovalStatusChain";

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? d : dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ width: "50%", paddingRight: 8, marginBottom: 12 }}>
      <Text style={{ color: colors.mutedForeground, fontSize: 9, fontFamily: fonts.heading.medium, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</Text>
      <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 12.5, fontFamily: fonts.body.medium, marginTop: 2 }}>{value}</Text>
    </View>
  );
}

export function MaterialRequestDetailModal({ recordId, onClose }: { recordId: number | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();

  const { data: mr, isLoading } = useQuery<MaterialRequest>({
    queryKey: ["mr-detail", recordId],
    queryFn: () => getMaterialRequestById(recordId!),
    enabled: recordId != null,
  });

  const { data: linkedPOs = [] } = useQuery({
    queryKey: ["mr-detail-linked-pos", recordId],
    queryFn: () => getMRLinkedPOs(recordId!),
    enabled: recordId != null,
  });

  if (recordId == null) return null;
  const priorityColor = PRIORITY_COLOR[mr?.Priority || "Normal"] ?? PRIORITY_COLOR.Normal;

  return (
    <Modal visible animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <View style={{ paddingTop: insets.top + 8 }} className="flex-row items-center justify-between px-4 pb-3">
          <View className="flex-row items-center gap-2.5 flex-1 min-w-0">
            <View className="w-8 h-8 rounded-lg items-center justify-center" style={{ backgroundColor: "#10b98126" }}>
              <ClipboardList size={14} color="#10b981" />
            </View>
            <View className="min-w-0">
              <Text style={{ color: colors.foreground, fontSize: 14, fontFamily: fonts.heading.semibold }}>Material Request</Text>
              {!!mr?.DocNo && <Text style={{ color: colors.mutedForeground, fontSize: 10.5 }}>{mr.DocNo}</Text>}
            </View>
          </View>
          <Pressable onPress={onClose} className="w-8 h-8 rounded-lg items-center justify-center" style={{ borderWidth: 1, borderColor: colors.border }}>
            <X size={15} color={colors.mutedForeground} />
          </Pressable>
        </View>

        {isLoading || !mr ? (
          <View className="flex-1 items-center justify-center"><ActivityIndicator color={colors.mutedForeground} /></View>
        ) : (
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}>
            <View className="flex-row items-center gap-2 mb-4">
              <ApprovalStatusChain table="MaterialRequests" recordId={mr.MRId} />
              <View className="px-2 py-0.5 rounded-full" style={{ backgroundColor: `${priorityColor}1a`, borderWidth: 1, borderColor: `${priorityColor}40` }}>
                <Text style={{ color: priorityColor, fontSize: 10.5, fontFamily: fonts.heading.semibold }}>{mr.Priority || "Normal"}</Text>
              </View>
            </View>

            <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
              <Field label="Company" value={mr.CompanyName || "—"} />
              <Field label="Project" value={mr.ProjectName || "—"} />
              <Field label="Requested" value={fmtDate(mr.RequestDate)} />
              <Field label="Required By" value={fmtDate(mr.RequiredByDate)} />
              <Field label="Items" value={`${mr.ItemCount ?? mr.items?.length ?? 0} (${(mr.TotalQty ?? 0).toFixed?.(2) ?? mr.TotalQty ?? 0} units)`} />
            </View>

            <View className="rounded-xl px-3 py-2.5 mb-3" style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: `${colors.muted}30` }}>
              <Text style={{ color: colors.mutedForeground, fontSize: 9, fontFamily: fonts.heading.medium, textTransform: "uppercase", marginBottom: 4 }}>Reason</Text>
              <Text style={{ color: colors.foreground, fontSize: 12 }}>{mr.Reason || "—"}</Text>
            </View>

            {!!mr.items?.length && (
              <View className="mb-3">
                <Text style={{ color: colors.mutedForeground, fontSize: 9, fontFamily: fonts.heading.semibold, textTransform: "uppercase", marginBottom: 6 }}>
                  Requested Items ({mr.items.length})
                </Text>
                <View className="rounded-xl overflow-hidden" style={{ borderWidth: 1, borderColor: colors.border }}>
                  {mr.items.map((it, i) => (
                    <View key={i} className="flex-row items-center justify-between px-3 py-2.5" style={{ borderTopWidth: i > 0 ? 1 : 0, borderTopColor: `${colors.border}80` }}>
                      <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 12, flex: 1, marginRight: 8 }}>{it.ItemName || "—"}</Text>
                      <Text style={{ color: colors.primary, fontSize: 12, fontFamily: fonts.heading.semibold }}>{it.Quantity} {it.UOMCode}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {linkedPOs.length > 0 && (
              <View className="mb-3">
                <View className="flex-row items-center gap-1.5 mb-2">
                  <ShoppingCart size={11} color={colors.mutedForeground} />
                  <Text style={{ color: colors.mutedForeground, fontSize: 9, fontFamily: fonts.heading.semibold, textTransform: "uppercase" }}>Linked Purchase Orders</Text>
                </View>
                <View className="rounded-xl overflow-hidden" style={{ borderWidth: 1, borderColor: colors.border }}>
                  {linkedPOs.map((po, i) => (
                    <View key={po.purchaseOrderId} className="px-3 py-2.5" style={{ borderTopWidth: i > 0 ? 1 : 0, borderTopColor: `${colors.border}80` }}>
                      <View className="flex-row items-center justify-between">
                        <Text style={{ color: colors.primary, fontSize: 12, fontFamily: fonts.heading.semibold }}>{po.poNumber}</Text>
                        <Text style={{ color: colors.mutedForeground, fontSize: 10.5 }}>{fmtDate(po.date)}</Text>
                      </View>
                      <Text style={{ color: colors.mutedForeground, fontSize: 10.5, marginTop: 2 }}>
                        Ordered {po.orderedQty} · {po.status} · Remaining after {po.remainingQtyAfter}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {!!mr.Remarks && (
              <View className="rounded-xl px-3 py-2.5" style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: `${colors.muted}30` }}>
                <Text style={{ color: colors.mutedForeground, fontSize: 9, fontFamily: fonts.heading.medium, textTransform: "uppercase", marginBottom: 4 }}>Remarks</Text>
                <Text style={{ color: colors.foreground, fontSize: 12 }}>{mr.Remarks}</Text>
              </View>
            )}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}
