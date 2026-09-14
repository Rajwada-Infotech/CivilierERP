// RN port of Brs.tsx's <BounceModal> — records a bounced/dishonoured
// cheque or transfer against a BRS entry. Bottom sheet instead of web's
// centered dialog, matching this app's established sheet convention.
import { useState } from "react";
import { View, Text, Modal, Pressable, TextInput, ActivityIndicator, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import { X, Ban, ChevronRight } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { formatINR } from "@/utils/formatCurrency";
import { getReturnReasonOptions } from "@/api/returnReasonApi";
import { markBounced, type BrsEntry } from "@/api/brsApi";
import { OptionPickerModal, type PickerOption } from "../payment/OptionPicker";

export function BounceModal({
  entry, onClose, onSaved,
}: { entry: BrsEntry | null; onClose: () => void; onSaved: () => void }) {
  const insets = useSafeAreaInsets();
  const [bounceDate, setBounceDate] = useState(new Date().toISOString().slice(0, 10));
  const [bounceReason, setBounceReason] = useState("");
  const [bounceRemarks, setBounceRemarks] = useState("");
  const [saving, setSaving] = useState(false);
  const [reasonPickerOpen, setReasonPickerOpen] = useState(false);

  const { data: reasons = [] } = useQuery({
    queryKey: ["return-reason-options"],
    queryFn: getReturnReasonOptions,
    staleTime: 5 * 60 * 1000,
    enabled: !!entry,
  });

  if (!entry) return null;

  const reasonOptions: PickerOption[] = reasons.map((r) => ({ key: r.name, label: r.name }));
  const canConfirm = !!bounceDate && !!bounceReason && !saving;

  const handleConfirm = async () => {
    if (!canConfirm) return;
    setSaving(true);
    try {
      await markBounced(entry.SourceType, entry.SourceID, { bounceDate, bounceReason, bounceRemarks: bounceRemarks || undefined });
      onSaved();
    } catch (err: any) {
      Alert.alert("Failed to record bounce", err.message ?? "Something went wrong.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={!!entry} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)" }} onPress={onClose}>
        <Pressable
          onPress={() => {}}
          style={{
            position: "absolute", left: 0, right: 0, bottom: 0, maxHeight: "85%",
            backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24,
            borderWidth: 1, borderColor: colors.border, overflow: "hidden",
          }}
        >
          <View className="items-center pt-2 pb-1">
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: `${colors.mutedForeground}4d` }} />
          </View>

          <View className="flex-row items-start gap-3 px-4 py-3">
            <View className="w-9 h-9 rounded-xl items-center justify-center" style={{ backgroundColor: "#ef444420" }}>
              <Ban size={16} color="#ef4444" />
            </View>
            <View className="flex-1 min-w-0">
              <Text style={{ color: colors.foreground, fontSize: 13.5, fontFamily: fonts.heading.semibold }}>Mark as Bounced</Text>
              <Text numberOfLines={1} style={{ color: colors.mutedForeground, fontSize: 11, marginTop: 1 }}>
                {entry.DocNo ?? entry.TxnId ?? `${entry.SourceType} #${entry.SourceID}`}
                {entry.ChequeNo ? ` · Cheque #${entry.ChequeNo}` : ""}
              </Text>
            </View>
            <Pressable onPress={onClose} className="w-7 h-7 rounded-lg items-center justify-center" style={{ borderWidth: 1, borderColor: colors.border }}>
              <X size={13} color={colors.mutedForeground} />
            </Pressable>
          </View>

          <View style={{ padding: 16, paddingTop: 4 }}>
            <View className="rounded-xl overflow-hidden mb-4" style={{ borderWidth: 1, borderColor: "#ef444433", backgroundColor: "#ef44440f" }}>
              {[
                ["Payee / Party", entry.PaymentName || "—"],
                ["Amount", formatINR(entry.Amount)],
                ["Bank", entry.BankName || "—"],
              ].map(([label, value], i) => (
                <View key={label} className="flex-row items-center justify-between px-3 py-2" style={{ borderTopWidth: i > 0 ? 1 : 0, borderTopColor: "#ef444422" }}>
                  <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>{label}</Text>
                  <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 12, fontFamily: fonts.body.semibold, maxWidth: 180 }}>{value}</Text>
                </View>
              ))}
            </View>

            <Text style={{ color: colors.mutedForeground, fontSize: 10, fontFamily: fonts.body.medium, marginBottom: 5, textTransform: "uppercase" }}>
              Bounce / Return Date *
            </Text>
            <TextInput
              value={bounceDate}
              onChangeText={setBounceDate}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={`${colors.mutedForeground}99`}
              style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, color: colors.foreground, fontFamily: fonts.body.regular, fontSize: 13, marginBottom: 14 }}
            />

            <Text style={{ color: colors.mutedForeground, fontSize: 10, fontFamily: fonts.body.medium, marginBottom: 5, textTransform: "uppercase" }}>
              Reason for Return *
            </Text>
            <Pressable
              onPress={() => setReasonPickerOpen(true)}
              className="flex-row items-center justify-between px-3.5 py-3 rounded-xl mb-4"
              style={{ borderWidth: 1, borderColor: colors.border }}
            >
              <Text style={{ color: bounceReason ? colors.foreground : `${colors.mutedForeground}99`, fontSize: 13 }}>
                {bounceReason || "— Select reason —"}
              </Text>
              <ChevronRight size={15} color={colors.mutedForeground} />
            </Pressable>

            <Text style={{ color: colors.mutedForeground, fontSize: 10, fontFamily: fonts.body.medium, marginBottom: 5, textTransform: "uppercase" }}>
              Remarks (optional)
            </Text>
            <TextInput
              value={bounceRemarks}
              onChangeText={setBounceRemarks}
              placeholder="Additional notes e.g. bank memo number…"
              placeholderTextColor={`${colors.mutedForeground}99`}
              multiline
              style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, color: colors.foreground, fontFamily: fonts.body.regular, fontSize: 13, minHeight: 70, textAlignVertical: "top" }}
            />
          </View>

          <View className="flex-row gap-2.5 px-4" style={{ paddingBottom: insets.bottom + 14, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border }}>
            <Pressable onPress={onClose} disabled={saving} className="flex-1 items-center justify-center py-3 rounded-xl" style={{ borderWidth: 1, borderColor: colors.border }}>
              <Text style={{ color: colors.mutedForeground, fontSize: 12.5, fontFamily: fonts.heading.medium }}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={handleConfirm}
              disabled={!canConfirm}
              className="flex-1 items-center justify-center py-3 rounded-xl"
              style={{ backgroundColor: "#ef4444", opacity: canConfirm ? 1 : 0.5 }}
            >
              {saving ? <ActivityIndicator size="small" color="#fff" /> : (
                <Text style={{ color: "#fff", fontSize: 12.5, fontFamily: fonts.heading.semibold }}>Confirm Bounce</Text>
              )}
            </Pressable>
          </View>
        </Pressable>
      </Pressable>

      <OptionPickerModal
        visible={reasonPickerOpen} title="Select Reason" options={reasonOptions}
        selectedKey={bounceReason} onSelect={(k) => { setBounceReason(k); setReasonPickerOpen(false); }} onClose={() => setReasonPickerOpen(false)} searchable
      />
    </Modal>
  );
}
