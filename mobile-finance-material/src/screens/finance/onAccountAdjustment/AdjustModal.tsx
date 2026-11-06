// RN port of OnAccountAdjustment.tsx's inline <AdjustDialog>, on the drawing sheet: the sheet's list-picker frame (a paper
// panel up from the bottom under an ink rule — web renders this as a small dialog, not a page), ruled figures, Cancel and
// Confirm keys. Applies a party's on-account credit against a different outstanding invoice than the one that generated
// it (excludeOriginatingInvoice keeps that invoice out of the picker).
import { useEffect, useMemo, useState } from "react";
import { View, Text, ScrollView, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import { sheet as S } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { formatINR } from "@/utils/formatCurrency";
import {
  getInvoicesForParty, applyOAAdjustment, previewOAAdjustment, excludeOriginatingInvoice,
  type CreditEntry,
} from "@/api/onAccountApi";
import { Body, Field, Input, Key, Label, SheetMark, Skel } from "@/components/sheet/Sheet";
import { SheetPicker } from "@/components/sheet/FormParts";
import { OptionPickerModal, PickerRow, type PickerOption } from "../payment/OptionPicker";

/** A ruled line of figures: label left, amount right. */
function Row({ label, value, tone, bold, last }: { label: string; value: string; tone?: "red" | "blue"; bold?: boolean; last?: boolean }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, paddingVertical: 9, borderBottomWidth: last ? 0 : 1, borderBottomColor: S.ruleSoft }}>
      <Body size={12.5} color={S.ink2}>{label}</Body>
      <Text style={{ color: tone === "red" ? S.red : tone === "blue" ? S.blue : S.ink, fontSize: bold ? 15 : 13, fontFamily: fonts.heading.semibold }}>{value}</Text>
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
    <>
      <SheetPicker
        visible={!!entry && !pickerOpen}
        title="Adjust On A/C balance"
        note={entry.PartyName}
        onClose={onClose}
        footer={
          done ? undefined : (
            <View style={{ flexDirection: "row", gap: 10, paddingHorizontal: 16, paddingTop: 12, paddingBottom: insets.bottom + 14, borderTopWidth: 1, borderTopColor: S.ink }}>
              <Key label="Cancel" onPress={onClose} disabled={submitting} />
              <Key tone="ink" label={submitting ? "Adjusting…" : "Confirm adjust"} onPress={handleSubmit} disabled={!canSubmit} style={{ flex: 1 }} />
            </View>
          )
        }
      >
        {done ? (
          <View style={{ padding: 16, paddingBottom: insets.bottom + 24, gap: 14 }}>
            <SheetMark text="Adjustment applied" tone="done" />
            <Body size={13} color={S.ink2}>{`${formatINR(done.applied)} adjusted against ${selectedDoc}.`}</Body>
            <View style={{ borderTopWidth: 1.5, borderTopColor: S.ink }}>
              <Row label="Remaining balance" value={formatINR(done.remaining)} tone="blue" bold last />
            </View>
            <Key label="Close" onPress={onClose} />
          </View>
        ) : (
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 8, gap: 14 }} keyboardShouldPersistTaps="handled">
            <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
              <Label>Available On A/C balance</Label>
              <Text style={{ color: S.ink, fontSize: 18, letterSpacing: -0.3, fontFamily: fonts.heading.semibold }}>{formatINR(currentBalance)}</Text>
            </View>

            {isLoading ? (
              <Skel h={44} />
            ) : adjustableInvoices.length === 0 ? (
              <Body size={12.5} color={S.graphite}>No other invoices found for this supplier.</Body>
            ) : (
              <PickerRow label="Invoice / contract" value={selected ? selected.docNo : ""} placeholder="Choose an invoice…" onPress={() => setPickerOpen(true)} />
            )}

            {selected && (
              <View style={{ borderTopWidth: 1, borderTopColor: S.ink }}>
                <Row label="Invoice amount (incl. GST)" value={formatINR(selected.invoiceAmount)} />
                <Row label="Total paid" value={formatINR(selected.totalPaid)} />
                <Row label="Remaining to pay" value={formatINR(invoiceRemaining)} last={!(adjAmount > 0 && preview)} />
                {adjAmount > 0 && preview && (
                  <Row label="Remaining after this adjustment" value={formatINR(preview.invoiceRemainingAfter)} tone={preview.isFullyCovered ? "blue" : undefined} last />
                )}
              </View>
            )}

            <Field label="Amount to adjust">
              <Input value={amount} onChangeText={(v) => setAmount(v.replace(/[^0-9.]/g, ""))} placeholder="Enter amount" keyboardType="numeric" />
            </Field>
            {adjAmount > currentBalance && <Body size={12} color={S.red}>{`Exceeds the available balance of ${formatINR(currentBalance)}.`}</Body>}

            {adjAmount > 0 && adjAmount <= currentBalance && (
              <View style={{ borderTopWidth: 1, borderTopColor: S.ink }}>
                <Row label="Current balance" value={formatINR(currentBalance)} />
                <Row label="Adjusting" value={`− ${formatINR(adjAmount)}`} tone="red" />
                <Row label="New balance" value={formatINR(previewBalance)} tone={previewBalance > 0 ? "blue" : undefined} bold last />
              </View>
            )}
          </ScrollView>
        )}
      </SheetPicker>

      <OptionPickerModal
        visible={!!entry && pickerOpen}
        title="Select invoice"
        options={invoiceOptions}
        selectedKey={selectedDoc}
        onSelect={(k) => {
          setSelectedDoc(k);
          setPickerOpen(false);
        }}
        onClose={() => setPickerOpen(false)}
        searchable
      />
    </>
  );
}
