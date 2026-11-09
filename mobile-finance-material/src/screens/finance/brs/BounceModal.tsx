// RN port of Brs.tsx's <BounceModal> — records a bounced / dishonoured cheque or transfer against a BRS entry — on the
// drawing sheet: the sheet's list-picker frame (a paper panel up from the bottom; web's is a small dialog), the entry's
// figures ruled off, the date, reason and remarks, and Cancel / Confirm bounce keys (red: it is the destructive step).
import { istToday } from "@/utils/istTime";
import { useState } from "react";
import { View, Text, ScrollView, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import { sheet as S } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { formatINR } from "@/utils/formatCurrency";
import { getReturnReasonOptions } from "@/api/returnReasonApi";
import { markBounced, type BrsEntry } from "@/api/brsApi";
import { Body, Field, Input, Key } from "@/components/sheet/Sheet";
import { SheetPicker } from "@/components/sheet/FormParts";
import { OptionPickerModal, PickerRow, type PickerOption } from "../payment/OptionPicker";

export function BounceModal({
  entry, onClose, onSaved,
}: { entry: BrsEntry | null; onClose: () => void; onSaved: () => void }) {
  const insets = useSafeAreaInsets();
  const [bounceDate, setBounceDate] = useState(istToday());
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
    <>
      <SheetPicker
        visible={!!entry && !reasonPickerOpen}
        title="Mark as bounced"
        note={`${entry.DocNo ?? entry.TxnId ?? `${entry.SourceType} #${entry.SourceID}`}${entry.ChequeNo ? ` · Cheque #${entry.ChequeNo}` : ""}`}
        onClose={onClose}
        footer={
          <View style={{ flexDirection: "row", gap: 10, paddingHorizontal: 16, paddingTop: 12, paddingBottom: insets.bottom + 14, borderTopWidth: 1, borderTopColor: S.ink }}>
            <Key label="Cancel" onPress={onClose} disabled={saving} />
            <Key tone="red" label={saving ? "Recording…" : "Confirm bounce"} onPress={handleConfirm} disabled={!canConfirm} style={{ flex: 1 }} />
          </View>
        }
      >
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 8, gap: 14 }} keyboardShouldPersistTaps="handled">
          <View style={{ borderTopWidth: 1, borderTopColor: S.red }}>
            {[
              ["Payee / Party", entry.PaymentName || "—"],
              ["Amount", formatINR(entry.Amount)],
              ["Bank", entry.BankName || "—"],
            ].map(([label, value]) => (
              <View key={label} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: S.ruleSoft }}>
                <Body size={12.5} color={S.ink2}>{label}</Body>
                <Text numberOfLines={1} style={{ flexShrink: 1, color: S.ink, fontSize: 13, fontFamily: fonts.heading.semibold }}>{value}</Text>
              </View>
            ))}
          </View>

          <Field label="Bounce / Return Date" required>
            <Input value={bounceDate} onChangeText={setBounceDate} placeholder="YYYY-MM-DD" />
          </Field>
          <PickerRow label="Reason for Return *" value={bounceReason} placeholder="Select a reason" onPress={() => setReasonPickerOpen(true)} />
          <Field label="Remarks (optional)">
            <Input value={bounceRemarks} onChangeText={setBounceRemarks} placeholder="Additional notes, e.g. the bank memo number…" multiline numberOfLines={3} style={{ minHeight: 70, paddingVertical: 10, textAlignVertical: "top" }} />
          </Field>
        </ScrollView>
      </SheetPicker>

      <OptionPickerModal
        visible={!!entry && reasonPickerOpen} title="Select reason" options={reasonOptions}
        selectedKey={bounceReason} onSelect={(k) => { setBounceReason(k); setReasonPickerOpen(false); }} onClose={() => setReasonPickerOpen(false)} searchable
      />
    </>
  );
}
