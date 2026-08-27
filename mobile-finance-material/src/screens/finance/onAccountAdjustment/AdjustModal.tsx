// RN port of OnAccountAdjustment.tsx's inline <AdjustDialog> — a focused
// bottom-sheet action (not a full-screen modal like PaymentFormModal, since
// web renders this as a small centered dialog, not a page). Applies a
// party's on-account credit against a different outstanding invoice than
// the one that generated it (excludeOriginatingInvoice keeps that invoice
// out of the picker).
import { useEffect, useMemo, useState } from "react";
import { View, Text, Modal, Pressable, ScrollView, TextInput, ActivityIndicator, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import { X, CheckCircle2, ChevronRight } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { formatINR } from "@/utils/formatCurrency";
import {
  getInvoicesForParty, applyOAAdjustment, previewOAAdjustment, excludeOriginatingInvoice,
  type CreditEntry,
} from "@/api/onAccountApi";
import { OptionPickerModal, type PickerOption } from "../payment/OptionPicker";

function Row({ label, value, color, bold }: { label: string; value: string; color?: string; bold?: boolean }) {
  return (
    <View className="flex-row items-center justify-between px-3 py-2.5">
      <Text style={{ color: color ?? colors.mutedForeground, fontSize: 11.5, fontFamily: fonts.body.regular }}>{label}</Text>
      <Text style={{ color: color ?? colors.foreground, fontSize: 12.5, fontFamily: bold ? fonts.heading.bold : fonts.body.semibold }}>{value}</Text>
    </View>
  );
}

export function AdjustModal({
  entry, currentBalance, onClose, onSuccess,
}: {
  entry: CreditEntry | null;
  currentBalance: number;
  onClose: () => void;
  onSuccess: (partyId: number, newBalance: number) => void;
}) {
  const insets = useSafeAreaInsets();
  const [selectedDoc, setSelectedDoc] = useState("");
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{ applied: number; remaining: number } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    if (entry) { setSelectedDoc(""); setAmount(""); setDone(null); }
  }, [entry?.OAId]);

  const { data: invoices = [], isLoading } = useQuery({
    queryKey: ["oa-invoices-for-party", entry?.PartyId],
    queryFn: () => getInvoicesForParty(entry!.PartyId),
    enabled: !!entry,
  });

  const adjustableInvoices = useMemo(
    () => excludeOriginatingInvoice(invoices, entry?.InvoiceRef),
    [invoices, entry?.InvoiceRef],
  );

  const selected = adjustableInvoices.find((i) => i.docNo === selectedDoc);
  const invoiceRemaining = selected ? (selected.remaining > 0 ? selected.remaining : selected.invoiceAmount) : 0;

  // Pre-fill amount with as much as this adjustment can cover, mirroring web.
  useEffect(() => {
    if (!selected) { setAmount(""); return; }
    const preview = previewOAAdjustment(currentBalance, invoiceRemaining);
    setAmount(String(Math.round(preview.applyAmount)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.docNo, currentBalance]);

  const adjAmount = parseFloat(amount) || 0;
  const preview = selected ? previewOAAdjustment(currentBalance, invoiceRemaining, adjAmount) : null;
  const previewBalance = preview ? preview.balanceAfter : Math.max(0, currentBalance - adjAmount);
  const canSubmit = !!selectedDoc && adjAmount > 0 && adjAmount <= currentBalance && !submitting;

  const invoiceOptions: PickerOption[] = useMemo(() => adjustableInvoices.map((inv) => ({
    key: inv.docNo,
    label: inv.docNo,
    sublabel: `${inv.billStatus ?? "Unknown"} · Remaining ${formatINR(inv.remaining)}`,
  })), [adjustableInvoices]);

  const handleSubmit = async () => {
    if (!canSubmit || !entry) return;
    setSubmitting(true);
    try {
      const result = await applyOAAdjustment({
        expenseRef: selectedDoc,
        amount: adjAmount,
        partyId: entry.PartyId,
        paymentDocNo: entry.PaymentDocNo,
      });
      setDone({ applied: result.applied, remaining: result.remainingBalance });
      onSuccess(entry.PartyId, result.remainingBalance);
    } catch (err: any) {
      Alert.alert("Adjustment failed", err.message ?? "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!entry) return null;

  return (
    <Modal visible={!!entry} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)" }} onPress={onClose}>
        <Pressable
          onPress={() => {}}
          style={{
            position: "absolute", left: 0, right: 0, bottom: 0, maxHeight: "88%",
            backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24,
            borderWidth: 1, borderColor: colors.border, overflow: "hidden",
          }}
        >
          <View className="items-center pt-2 pb-1">
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: `${colors.mutedForeground}4d` }} />
          </View>

          <View className="flex-row items-center justify-between px-4 py-2.5">
            <View>
              <Text style={{ color: colors.foreground, fontSize: 13.5, fontFamily: fonts.heading.semibold }}>Adjust On A/C Balance</Text>
              <Text style={{ color: colors.mutedForeground, fontSize: 11, fontFamily: fonts.body.regular, marginTop: 1 }}>{entry.PartyName}</Text>
            </View>
            <Pressable onPress={onClose} className="w-8 h-8 rounded-lg items-center justify-center" style={{ borderWidth: 1, borderColor: colors.border }}>
              <X size={15} color={colors.mutedForeground} />
            </Pressable>
          </View>

          {done ? (
            <View className="px-5 py-8 items-center" style={{ paddingBottom: insets.bottom + 24 }}>
              <View className="w-12 h-12 rounded-full items-center justify-center mb-3" style={{ backgroundColor: "#10b98120" }}>
                <CheckCircle2 size={24} color="#10b981" />
              </View>
              <Text style={{ color: colors.foreground, fontSize: 13.5, fontFamily: fonts.heading.semibold }}>Adjustment Applied</Text>
              <Text style={{ color: colors.mutedForeground, fontSize: 11.5, fontFamily: fonts.body.regular, marginTop: 4, textAlign: "center" }}>
                {formatINR(done.applied)} adjusted against {selectedDoc}
              </Text>
              <View className="w-full rounded-xl mt-4 flex-row items-center justify-between px-4 py-3" style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: `${colors.muted}40` }}>
                <Text style={{ color: colors.mutedForeground, fontSize: 10.5, fontFamily: fonts.body.regular, textTransform: "uppercase" }}>Remaining Balance</Text>
                <Text style={{ color: "#10b981", fontSize: 13, fontFamily: fonts.heading.bold }}>{formatINR(done.remaining)}</Text>
              </View>
              <Pressable onPress={onClose} className="mt-4 px-6 py-2.5 rounded-xl" style={{ borderWidth: 1, borderColor: colors.border }}>
                <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: fonts.heading.medium }}>Close</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 8 }} keyboardShouldPersistTaps="handled">
                <View className="rounded-xl flex-row items-center justify-between px-4 py-3 mb-4" style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: `${colors.muted}30` }}>
                  <Text style={{ color: colors.mutedForeground, fontSize: 11, fontFamily: fonts.body.regular }}>Available On A/C Balance</Text>
                  <Text style={{ color: "#10b981", fontSize: 13.5, fontFamily: fonts.heading.bold }}>{formatINR(currentBalance)}</Text>
                </View>

                <Text style={{ color: colors.mutedForeground, fontSize: 10, fontFamily: fonts.body.medium, marginBottom: 5, textTransform: "uppercase", letterSpacing: 0.4 }}>
                  Select Invoice / Contract
                </Text>
                {isLoading ? (
                  <View className="py-3"><ActivityIndicator size="small" color={colors.mutedForeground} /></View>
                ) : adjustableInvoices.length === 0 ? (
                  <Text style={{ color: colors.mutedForeground, fontSize: 12, paddingVertical: 8 }}>No other invoices found for this supplier.</Text>
                ) : (
                  <Pressable
                    onPress={() => setPickerOpen(true)}
                    className="flex-row items-center justify-between px-3.5 py-3 rounded-xl mb-1"
                    style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: `${colors.card}80` }}
                  >
                    <Text style={{ color: selected ? colors.primary : `${colors.mutedForeground}99`, fontSize: 12.5, fontFamily: fonts.body.medium }}>
                      {selected ? selected.docNo : "Choose an invoice…"}
                    </Text>
                    <ChevronRight size={15} color={colors.mutedForeground} />
                  </Pressable>
                )}

                {selected && (
                  <View className="rounded-xl overflow-hidden mt-3 mb-1" style={{ borderWidth: 1, borderColor: colors.border }}>
                    <Row label="Invoice Amount (incl. GST)" value={formatINR(selected.invoiceAmount)} />
                    <Row label="Total Paid" value={formatINR(selected.totalPaid)} color="#10b981" />
                    <Row label="Remaining to Pay" value={formatINR(invoiceRemaining)} color="#d97706" />
                    {adjAmount > 0 && preview && (
                      <Row
                        label="Remaining After This Adjustment"
                        value={formatINR(preview.invoiceRemainingAfter)}
                        color={preview.isFullyCovered ? "#10b981" : "#d97706"}
                      />
                    )}
                  </View>
                )}

                <Text style={{ color: colors.mutedForeground, fontSize: 10, fontFamily: fonts.body.medium, marginTop: 14, marginBottom: 5, textTransform: "uppercase", letterSpacing: 0.4 }}>
                  Amount to Adjust
                </Text>
                <TextInput
                  value={amount}
                  onChangeText={(v) => setAmount(v.replace(/[^0-9.]/g, ""))}
                  placeholder="Enter amount"
                  placeholderTextColor={`${colors.mutedForeground}99`}
                  keyboardType="numeric"
                  style={{
                    borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10,
                    color: colors.foreground, fontFamily: fonts.body.regular, fontSize: 13,
                  }}
                />
                {adjAmount > currentBalance && (
                  <Text style={{ color: "#ef4444", fontSize: 11, marginTop: 5 }}>Exceeds available balance of {formatINR(currentBalance)}</Text>
                )}

                {adjAmount > 0 && adjAmount <= currentBalance && (
                  <View className="rounded-xl overflow-hidden mt-4" style={{ borderWidth: 1, borderColor: colors.border }}>
                    <Row label="Current Balance" value={formatINR(currentBalance)} />
                    <Row label="Adjusting" value={`− ${formatINR(adjAmount)}`} color="#ef4444" />
                    <Row label="New Balance" value={formatINR(previewBalance)} color={previewBalance > 0 ? "#10b981" : colors.mutedForeground} bold />
                  </View>
                )}
              </ScrollView>

              <View className="flex-row gap-2.5 px-4" style={{ paddingBottom: insets.bottom + 14, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border }}>
                <Pressable onPress={onClose} disabled={submitting} className="flex-1 items-center justify-center py-3 rounded-xl" style={{ borderWidth: 1, borderColor: colors.border }}>
                  <Text style={{ color: colors.mutedForeground, fontSize: 12.5, fontFamily: fonts.heading.medium }}>Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={handleSubmit}
                  disabled={!canSubmit}
                  className="flex-1 items-center justify-center py-3 rounded-xl"
                  style={{ backgroundColor: "#10b981", opacity: canSubmit ? 1 : 0.5 }}
                >
                  {submitting ? <ActivityIndicator size="small" color="#fff" /> : (
                    <Text style={{ color: "#fff", fontSize: 12.5, fontFamily: fonts.heading.semibold }}>Confirm Adjust</Text>
                  )}
                </Pressable>
              </View>
            </>
          )}
        </Pressable>
      </Pressable>

      <OptionPickerModal
        visible={pickerOpen}
        title="Select Invoice"
        options={invoiceOptions}
        selectedKey={selectedDoc}
        onSelect={(k) => { setSelectedDoc(k); setPickerOpen(false); }}
        onClose={() => setPickerOpen(false)}
        searchable
      />
    </Modal>
  );
}
