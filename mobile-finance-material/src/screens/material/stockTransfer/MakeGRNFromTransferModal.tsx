// RN port of StockTransfer.tsx's MakeGRNModal — creates a GRN from a plain
// Stock Transfer so the receiving side has a formal document to approve,
// same remarks-only form as web (deliberately no supplier field — see
// grnApi.ts's own comment on why that matters for stock not double-posting).
import { useState } from "react";
import { View, Text, Modal, Pressable, TextInput, ActivityIndicator, Alert } from "react-native";
import { X, FileText, AlertCircle } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { createGRNFromTransfer } from "@/api/grnApi";
import type { StockTransfer } from "@/api/stockTransferApi";

export function MakeGRNFromTransferModal({
  transfer, onClose, onSuccess,
}: {
  transfer: StockTransfer | null; onClose: () => void; onSuccess: (grnNo: string) => void;
}) {
  const [remarks, setRemarks] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (!transfer) return null;

  const handleCreate = async () => {
    setSubmitting(true);
    try {
      const result = await createGRNFromTransfer(transfer.TransferID, {
        remarks: remarks || `Auto-generated from Stock Transfer ${transfer.DocNo}`,
      });
      onSuccess(result.grnNo);
    } catch (err: any) {
      Alert.alert("Failed to create GRN", err?.message ?? "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }} onPress={onClose}>
        <Pressable onPress={() => {}} style={{ backgroundColor: colors.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, borderColor: colors.border }}>
          <View className="flex-row items-center justify-between px-4 py-3.5" style={{ borderBottomWidth: 1, borderBottomColor: colors.border }}>
            <View className="flex-row items-center gap-2.5">
              <View className="w-8 h-8 rounded-lg items-center justify-center" style={{ backgroundColor: "#10b98126" }}>
                <FileText size={14} color="#10b981" />
              </View>
              <View>
                <Text style={{ color: colors.foreground, fontSize: 14, fontFamily: fonts.heading.semibold }}>Create GRN from Transfer</Text>
                <Text style={{ color: colors.mutedForeground, fontSize: 10.5, marginTop: 1 }}>Ref: {transfer.DocNo}</Text>
              </View>
            </View>
            <Pressable onPress={onClose} hitSlop={8}><X size={16} color={colors.mutedForeground} /></Pressable>
          </View>

          <View style={{ padding: 16 }}>
            <Text style={{ color: colors.mutedForeground, fontSize: 10, fontFamily: fonts.body.medium, textTransform: "uppercase", marginBottom: 6 }}>
              Items ({transfer.TransferItems?.length ?? 0})
            </Text>
            <View className="rounded-xl overflow-hidden mb-4" style={{ borderWidth: 1, borderColor: colors.border }}>
              {(transfer.TransferItems ?? []).map((it, i) => (
                <View key={i} className="flex-row items-center justify-between px-3 py-2" style={{ borderTopWidth: i > 0 ? 1 : 0, borderTopColor: `${colors.border}80` }}>
                  <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 12, flex: 1, marginRight: 8 }}>{it.itemName || it.itemId}</Text>
                  <Text style={{ color: colors.mutedForeground, fontSize: 11.5 }}>{it.qty} {it.uom || ""}</Text>
                </View>
              ))}
            </View>

            <Text style={{ color: colors.mutedForeground, fontSize: 10, fontFamily: fonts.body.medium, textTransform: "uppercase", marginBottom: 6 }}>Remarks</Text>
            <TextInput
              value={remarks}
              onChangeText={setRemarks}
              placeholder={`Auto-generated from Stock Transfer ${transfer.DocNo}`}
              placeholderTextColor={`${colors.mutedForeground}80`}
              multiline
              numberOfLines={2}
              style={{ color: colors.foreground, fontSize: 12.5, backgroundColor: `${colors.muted}50`, borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, minHeight: 56, textAlignVertical: "top" }}
            />

            <View className="flex-row items-start gap-2 rounded-xl px-3 py-2.5 mt-4" style={{ backgroundColor: "#10b9810d", borderWidth: 1, borderColor: "#10b98133" }}>
              <AlertCircle size={13} color="#10b981" style={{ marginTop: 1 }} />
              <Text style={{ color: "#10b981", fontSize: 11, flex: 1 }}>
                The GRN is created in Draft/Pending status and follows the normal approval workflow.
              </Text>
            </View>

            <Pressable
              onPress={handleCreate}
              disabled={submitting}
              className="rounded-xl items-center mt-4"
              style={{ backgroundColor: "#10b981", paddingVertical: 13, opacity: submitting ? 0.6 : 1 }}
            >
              {submitting ? <ActivityIndicator color="#fff" /> : (
                <Text style={{ color: "#fff", fontSize: 13.5, fontFamily: fonts.heading.semibold }}>Create GRN</Text>
              )}
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
