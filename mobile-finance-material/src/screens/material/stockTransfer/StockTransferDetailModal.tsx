// RN port of StockTransfer.tsx's TransferPreviewModal — single scroll, no
// tabs (web has none either). No "Make GRN from Transfer" section: that's
// a separate documentation bolt-on into the GRN module (and a latent
// double-stock-posting risk per the web research — see
// stockTransferApi.ts), not part of a plain Stock Transfer record.
import { useQuery } from "@tanstack/react-query";
import { View, Text, Modal, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { X, Repeat, ArrowRight } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { getStockTransferById, type StockTransfer } from "@/api/stockTransferApi";
import { ApprovalStatusChain } from "@/components/ApprovalStatusChain";

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? d : dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function StockTransferDetailModal({ recordId, onClose }: { recordId: number | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();

  const { data: transfer, isLoading } = useQuery<StockTransfer>({
    queryKey: ["trf-detail", recordId],
    queryFn: () => getStockTransferById(recordId!),
    enabled: recordId != null,
  });

  if (recordId == null) return null;

  return (
    <Modal visible animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <View style={{ paddingTop: insets.top + 8 }} className="flex-row items-center justify-between px-4 pb-3">
          <View className="flex-row items-center gap-2.5 flex-1 min-w-0">
            <View className="w-8 h-8 rounded-lg items-center justify-center" style={{ backgroundColor: "#0891b226" }}>
              <Repeat size={14} color="#0891b2" />
            </View>
            <View className="min-w-0">
              <Text style={{ color: colors.foreground, fontSize: 14, fontFamily: fonts.heading.semibold }}>Stock Transfer</Text>
              {!!transfer?.DocNo && <Text style={{ color: colors.mutedForeground, fontSize: 10.5 }}>{transfer.DocNo}</Text>}
            </View>
          </View>
          <Pressable onPress={onClose} className="w-8 h-8 rounded-lg items-center justify-center" style={{ borderWidth: 1, borderColor: colors.border }}>
            <X size={15} color={colors.mutedForeground} />
          </Pressable>
        </View>

        {isLoading || !transfer ? (
          <View className="flex-1 items-center justify-center"><ActivityIndicator color={colors.mutedForeground} /></View>
        ) : (
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}>
            <View className="flex-row items-center justify-between mb-4">
              <Text style={{ color: colors.mutedForeground, fontSize: 10.5 }}>
                {fmtDate(transfer.TransferDate)}{transfer.CreatedBy ? ` · ${transfer.CreatedBy.split("@")[0]}` : ""}
              </Text>
              <ApprovalStatusChain table="StockTransfers" recordId={transfer.TransferID} />
            </View>

            <View className="flex-row items-center gap-2 mb-4">
              <View className="flex-1 rounded-xl px-3 py-2.5" style={{ borderWidth: 1, borderColor: "#f9731640", backgroundColor: "#f973160d" }}>
                <Text style={{ color: "#f97316", fontSize: 9, fontFamily: fonts.heading.medium, textTransform: "uppercase" }}>From</Text>
                <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 12.5, fontFamily: fonts.heading.semibold, marginTop: 2 }}>{transfer.FromGodownName}</Text>
              </View>
              <ArrowRight size={16} color={colors.mutedForeground} />
              <View className="flex-1 rounded-xl px-3 py-2.5" style={{ borderWidth: 1, borderColor: "#05966940", backgroundColor: "#0596690d" }}>
                <Text style={{ color: "#059669", fontSize: 9, fontFamily: fonts.heading.medium, textTransform: "uppercase" }}>To</Text>
                <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 12.5, fontFamily: fonts.heading.semibold, marginTop: 2 }}>{transfer.ToGodownName}</Text>
              </View>
            </View>

            {!!transfer.TransferItems?.length && (
              <View className="mb-3">
                <Text style={{ color: colors.mutedForeground, fontSize: 9, fontFamily: fonts.heading.semibold, textTransform: "uppercase", marginBottom: 6 }}>
                  Items ({transfer.TransferItems.length})
                </Text>
                <View className="rounded-xl overflow-hidden" style={{ borderWidth: 1, borderColor: colors.border }}>
                  {transfer.TransferItems.map((it, i) => (
                    <View key={i} className="flex-row items-center justify-between px-3 py-2.5" style={{ borderTopWidth: i > 0 ? 1 : 0, borderTopColor: `${colors.border}80` }}>
                      <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 12, flex: 1, marginRight: 8 }}>{it.itemName || it.itemId}</Text>
                      <Text style={{ color: colors.primary, fontSize: 12, fontFamily: fonts.heading.semibold }}>{it.qty} {it.uom || ""}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {!!transfer.Remarks && (
              <View className="rounded-xl px-3 py-2.5" style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: `${colors.muted}30` }}>
                <Text style={{ color: colors.mutedForeground, fontSize: 9, fontFamily: fonts.heading.medium, textTransform: "uppercase", marginBottom: 4 }}>Remarks</Text>
                <Text style={{ color: colors.foreground, fontSize: 12 }}>{transfer.Remarks}</Text>
              </View>
            )}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}
