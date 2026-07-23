// RN port of Payment.tsx's add-payment form (view="form", !editingId) —
// v1 covers the core flow: purpose/mode/amount/date, company/project,
// optional invoice link (autofills payee + suggested amount), and the
// mode-specific reference panels (ChequePanel/DigitalRefPanel/CardPanel
// ports below). Deliberately deferred vs. web: editing an existing payment,
// the Contract-linking tab, on-account-balance auto-apply, GST/partial-
// payment preview, and bounce/reissue handling — all stay web-only for now.
import { useEffect, useMemo, useState } from "react";
import { View, Text, Modal, Pressable, ScrollView, TextInput, Alert, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { X, Wallet, AlertTriangle, Link2 } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import {
  addPayment, fetchCompanyOptions, fetchProjectOptions, fetchBankOptions,
  fetchChequeLots, fetchChequeNumbers, deductChequeFromLot, fetchCardsByBank,
  fetchExpenseOptions, maskCardNumber, PAYMENT_MODES,
  type PaymentFormPayload,
} from "@/api/newPaymentApi";
import { ModeBadge } from "./PaymentBadges";
import { PickerRow, OptionPickerModal, type PickerOption } from "./OptionPicker";

type FormState = {
  paymentName: string;
  mode: string;
  amount: string;
  date: string;
  company: string;
  project: string;
  bankId: number | null;
  bankName: string;
  expenseId: string;
  expenseRef: string;
  parentDocNo: string;
  paidTo: string;
  partyId: number | null;
  chequeNo: string;
  chequeLotId: number | null;
  chequeLotNumber: string;
  chequeAccountNumber: string;
  chequeIfsc: string;
  chequeDate: string;
  isPostDated: boolean;
  neftNumber: string;
  upiTransactionId: string;
  rtgsReference: string;
  impsReference: string;
  cardReference: string;
  cardId: number | null;
};

function blankForm(): FormState {
  return {
    paymentName: "", mode: "", amount: "", date: new Date().toISOString().slice(0, 10),
    company: "", project: "", bankId: null, bankName: "",
    expenseId: "", expenseRef: "", parentDocNo: "", paidTo: "", partyId: null,
    chequeNo: "", chequeLotId: null, chequeLotNumber: "", chequeAccountNumber: "", chequeIfsc: "",
    chequeDate: "", isPostDated: false,
    neftNumber: "", upiTransactionId: "", rtgsReference: "", impsReference: "", cardReference: "", cardId: null,
  };
}

const DIGITAL_FIELD: Record<string, { key: keyof FormState; label: string; placeholder: string }> = {
  NEFT: { key: "neftNumber", label: "NEFT UTR Number", placeholder: "e.g. HDFC0000012345" },
  UPI: { key: "upiTransactionId", label: "UPI Transaction ID", placeholder: "e.g. 405987654321" },
  RTGS: { key: "rtgsReference", label: "RTGS UTR Reference", placeholder: "e.g. RTGS2026050600001" },
  IMPS: { key: "impsReference", label: "IMPS Reference Number", placeholder: "e.g. 412210987654" },
  Card: { key: "cardReference", label: "Card Transaction / Approval ID", placeholder: "e.g. AUTH123456" },
};

function FieldLabel({ children, required }: { children: string; required?: boolean }) {
  return (
    <Text style={{ color: colors.mutedForeground, fontSize: 10, fontFamily: fonts.body.medium, marginBottom: 5, textTransform: "uppercase", letterSpacing: 0.4 }}>
      {children}{required ? " *" : ""}
    </Text>
  );
}

function TextField({
  value, onChangeText, placeholder, keyboardType,
}: { value: string; onChangeText: (v: string) => void; placeholder?: string; keyboardType?: "default" | "numeric" }) {
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={`${colors.mutedForeground}99`}
      keyboardType={keyboardType}
      style={{
        borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10,
        color: colors.foreground, fontFamily: fonts.body.regular, fontSize: 13, marginBottom: 14,
      }}
    />
  );
}

function validateForm(f: FormState): string | null {
  if (!f.paymentName.trim()) return "Payment purpose is required.";
  if (!f.mode) return "Please select a payment mode.";
  if (!f.date) return "Payment date is required.";
  if (!f.amount || Number(f.amount) <= 0) return "Amount must be greater than zero.";

  const isChequeMode = f.mode === "Cheque" || f.mode === "Post-Dated Cheque";
  const isDigitalMode = ["NEFT", "UPI", "RTGS", "IMPS", "Card"].includes(f.mode);

  if (isChequeMode) {
    if (!f.bankId) return "Please select a bank account.";
    if (!f.chequeLotId) return "No active cheque lot found for the selected bank.";
    if (!f.chequeNo) return "Please select a cheque number from the lot.";
    if (f.mode === "Post-Dated Cheque") {
      if (!f.chequeDate) return "Post-dated cheque requires a cheque date.";
      const validUntil = new Date(f.chequeDate);
      validUntil.setMonth(validUntil.getMonth() + 3);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (validUntil < today) return "This post-dated cheque has expired. Please select a valid cheque date.";
    }
  }

  if (isDigitalMode) {
    if (!f.bankId) return "Please select a bank account.";
    const cfg = DIGITAL_FIELD[f.mode];
    if (cfg && !(f[cfg.key] as string).trim()) return `${cfg.label} is required.`;
  }

  return null;
}

export function PaymentFormModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(blankForm());
  const [saving, setSaving] = useState(false);
  const [picker, setPicker] = useState<"company" | "project" | "bank" | "invoice" | "chequeLot" | "chequeNo" | "card" | null>(null);
  const [chequeValidating, setChequeValidating] = useState(false);

  useEffect(() => {
    if (visible) setForm(blankForm());
  }, [visible]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  const isChequeMode = form.mode === "Cheque" || form.mode === "Post-Dated Cheque";
  const isDigitalMode = ["NEFT", "UPI", "RTGS", "IMPS", "Card"].includes(form.mode);
  const needsBank = isChequeMode || isDigitalMode;

  const { data: companies = [] } = useQuery({ queryKey: ["form-companies"], queryFn: fetchCompanyOptions, enabled: visible });
  const { data: projects = [] } = useQuery({ queryKey: ["form-projects"], queryFn: fetchProjectOptions, enabled: visible });
  const { data: banks = [] } = useQuery({ queryKey: ["form-banks"], queryFn: fetchBankOptions, enabled: visible });
  const { data: invoices = [], isLoading: invoicesLoading } = useQuery({ queryKey: ["form-invoices"], queryFn: fetchExpenseOptions, enabled: visible });

  const { data: chequeLots = [], isLoading: lotsLoading } = useQuery({
    queryKey: ["form-cheque-lots", form.bankId],
    queryFn: () => fetchChequeLots(form.bankId),
    enabled: visible && isChequeMode && !!form.bankId,
  });
  const { data: chequeNumbers = [], isLoading: numbersLoading } = useQuery({
    queryKey: ["form-cheque-numbers", form.chequeLotId],
    queryFn: () => fetchChequeNumbers(form.chequeLotId!),
    enabled: visible && isChequeMode && !!form.chequeLotId,
  });
  const { data: cards = [] } = useQuery({
    queryKey: ["form-cards", form.bankId],
    queryFn: () => fetchCardsByBank(form.bankId),
    enabled: visible && form.mode === "Card" && !!form.bankId,
  });

  // Auto-select the first active lot once loaded, mirroring ChequePanel.
  useEffect(() => {
    if (chequeLots.length > 0 && !form.chequeLotId) {
      const first = chequeLots[0];
      setForm((f) => ({
        ...f, chequeLotId: first.CId, chequeLotNumber: first.ChequeLotNumber,
        chequeAccountNumber: first.AccountNumber || "", chequeIfsc: first.IFSCCode || "", chequeNo: "",
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chequeLots]);

  // Auto-select a lone card, mirroring CardPanel.
  useEffect(() => {
    if (cards.length === 1 && !form.cardId) set("cardId", cards[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards]);

  const activeLot = chequeLots.find((l) => l.CId === form.chequeLotId) ?? null;
  const availableCheques = chequeNumbers.filter((c) => !c.used && !c.bounced);
  const selectedInvoice = invoices.find((o) => o.id === form.expenseId) ?? null;
  const selectedCard = cards.find((c) => c.id === form.cardId) ?? null;

  const onBankSelect = (key: string) => {
    const bank = banks.find((b) => String(b.id) === key);
    setForm((f) => ({
      ...f, bankId: bank?.id ?? null, bankName: bank?.label?.split(" — ")[0] ?? "",
      chequeLotId: null, chequeLotNumber: "", chequeNo: "", cardId: null,
    }));
    setPicker(null);
  };

  const onLotSelect = (key: string) => {
    const lot = chequeLots.find((l) => String(l.CId) === key);
    if (!lot) return;
    setForm((f) => ({
      ...f, chequeLotId: lot.CId, chequeLotNumber: lot.ChequeLotNumber,
      chequeAccountNumber: lot.AccountNumber || "", chequeIfsc: lot.IFSCCode || "", chequeNo: "",
    }));
    setPicker(null);
  };

  const onChequeNumberSelect = async (chequeNo: string) => {
    setPicker(null);
    if (!chequeNo || !form.chequeLotId) return;
    setChequeValidating(true);
    try {
      await deductChequeFromLot(form.chequeLotId, chequeNo);
      set("chequeNo", chequeNo);
    } catch (err: any) {
      Alert.alert("Cheque unavailable", err.message ?? "Could not reserve this cheque number.");
    } finally {
      setChequeValidating(false);
    }
  };

  const onInvoiceSelect = (key: string) => {
    setPicker(null);
    if (!key) {
      setForm((f) => ({ ...f, expenseId: "", expenseRef: "", parentDocNo: "", paidTo: "", partyId: null }));
      return;
    }
    const o = invoices.find((x) => x.id === key);
    if (!o) return;
    const suggestedAmount = o.remainingAmount != null && o.remainingAmount > 0 ? o.remainingAmount : o.amount;
    setForm((f) => ({
      ...f,
      expenseId: o.id,
      expenseRef: o.refNumber || o.docNo || o.label,
      parentDocNo: o.parentDocNo || "",
      project: o.projectName || f.project,
      company: o.companyName || f.company,
      paidTo: o.supplierName || f.paidTo,
      partyId: o.partyId ?? f.partyId,
      amount: suggestedAmount != null ? String(suggestedAmount) : f.amount,
    }));
  };

  const handleSave = async () => {
    const error = validateForm(form);
    if (error) {
      Alert.alert("Check the form", error);
      return;
    }
    const payload: PaymentFormPayload = {
      companyId: form.company || null,
      projectId: form.project || null,
      docDate: form.date,
      docTypeId: null,
      remarks: form.paymentName || null,
      supplierId: form.expenseRef || null,
      partyId: form.partyId ?? null,
      bankId: form.bankId ?? null,
      amount: Number(form.amount) || 0,
      bankName: form.bankName || null,
      parentDocNo: form.parentDocNo || null,
      mode: form.mode || null,
      chequeNo: form.chequeNo || null,
      chequeLotId: form.chequeLotId ?? null,
      chequeLotNumber: form.chequeLotNumber || null,
      chequeDate: form.chequeDate || null,
      chequeAccountNumber: form.chequeAccountNumber || null,
      chequeIfsc: form.chequeIfsc || null,
      isPostDated: form.isPostDated,
      neftNumber: form.neftNumber || null,
      upiTransactionId: form.upiTransactionId || null,
      rtgsReference: form.rtgsReference || null,
      impsReference: form.impsReference || null,
      cardReference: form.cardReference || null,
      cardId: form.cardId ?? null,
    };
    setSaving(true);
    try {
      await addPayment(payload);
      queryClient.invalidateQueries({ queryKey: ["payments-mobile"], exact: false });
      Alert.alert("Saved", "Payment recorded.");
      onClose();
    } catch (err: any) {
      Alert.alert("Failed to save", err.message ?? "Something went wrong.");
    } finally {
      setSaving(false);
    }
  };

  const companyOptions: PickerOption[] = useMemo(() => companies.map((c) => ({ key: c.label, label: c.label })), [companies]);
  const projectOptions: PickerOption[] = useMemo(() => projects.map((p) => ({ key: p.label, label: p.label })), [projects]);
  const bankOptions: PickerOption[] = useMemo(() => banks.map((b) => ({ key: String(b.id), label: b.label })), [banks]);
  const lotOptions: PickerOption[] = useMemo(() => chequeLots.map((l) => ({
    key: String(l.CId), label: l.ChequeLotNumber, sublabel: l.RemainingCheques != null ? `${l.RemainingCheques} remaining` : undefined,
  })), [chequeLots]);
  const chequeNoOptions: PickerOption[] = useMemo(() => availableCheques.map((c) => ({ key: c.number, label: `# ${c.number}` })), [availableCheques]);
  const cardOptions: PickerOption[] = useMemo(() => cards.map((c) => ({
    key: String(c.id), label: [c.card_network, maskCardNumber(c.card_number), c.card_holder_name].filter(Boolean).join(" · "),
  })), [cards]);
  const invoiceOptions: PickerOption[] = useMemo(() => invoices.map((o) => ({
    key: o.id, label: o.label, sublabel: [o.projectName, o.supplierName].filter(Boolean).join(" · "),
  })), [invoices]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <View style={{ paddingTop: insets.top + 8 }} className="flex-row items-center justify-between px-4 pb-3">
          <View className="flex-row items-center gap-2.5">
            <View className="w-8 h-8 rounded-lg items-center justify-center" style={{ backgroundColor: "#3b82f626" }}>
              <Wallet size={14} color="#3b82f6" />
            </View>
            <Text style={{ color: colors.foreground, fontSize: 14, fontFamily: fonts.heading.semibold }}>New Payment</Text>
          </View>
          <Pressable onPress={onClose} className="w-8 h-8 rounded-lg items-center justify-center" style={{ borderWidth: 1, borderColor: colors.border }}>
            <X size={15} color={colors.mutedForeground} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 16 }} keyboardShouldPersistTaps="handled">
          <PickerRow label="Company" value={form.company} onPress={() => setPicker("company")} />
          <PickerRow label="Project" value={form.project} onPress={() => setPicker("project")} />

          <FieldLabel required>Payment Date</FieldLabel>
          <TextField value={form.date} onChangeText={(v) => set("date", v)} placeholder="YYYY-MM-DD" />

          <Pressable
            onPress={() => setPicker("invoice")}
            className="flex-row items-center gap-2 px-3.5 py-3 rounded-xl mb-3"
            style={{ borderWidth: 1, borderColor: selectedInvoice ? colors.primary : colors.border, backgroundColor: selectedInvoice ? `${colors.primary}12` : `${colors.card}80` }}
          >
            <Link2 size={13} color={selectedInvoice ? colors.primary : colors.mutedForeground} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.mutedForeground, fontSize: 10, fontFamily: fonts.body.regular }}>Link to Invoice (optional)</Text>
              <Text numberOfLines={1} style={{ color: selectedInvoice ? colors.primary : `${colors.mutedForeground}99`, fontSize: 12.5, fontFamily: fonts.body.medium, marginTop: 2 }}>
                {selectedInvoice ? selectedInvoice.label : "Autofills payee, company, project & amount"}
              </Text>
            </View>
          </Pressable>

          <FieldLabel required>Amount</FieldLabel>
          <TextField value={form.amount} onChangeText={(v) => set("amount", v.replace(/[^0-9.]/g, ""))} placeholder="0.00" keyboardType="numeric" />

          <FieldLabel required>Payment Purpose</FieldLabel>
          <TextField value={form.paymentName} onChangeText={(v) => set("paymentName", v)} placeholder="e.g. Cement advance to ABC Traders" />

          <FieldLabel required>Payment Mode</FieldLabel>
          <View className="flex-row flex-wrap gap-2 mb-4">
            {PAYMENT_MODES.map((m) => (
              <Pressable
                key={m}
                onPress={() => set("mode", m === form.mode ? "" : m)}
                style={{ opacity: form.mode && form.mode !== m ? 0.5 : 1 }}
              >
                <ModeBadge mode={m} />
              </Pressable>
            ))}
          </View>

          {!!form.paidTo && (
            <View className="rounded-xl p-3 mb-3" style={{ backgroundColor: `${colors.card}80`, borderWidth: 1, borderColor: colors.border }}>
              <Text style={{ color: colors.mutedForeground, fontSize: 10, fontFamily: fonts.body.regular }}>Paid To</Text>
              <Text style={{ color: colors.foreground, fontSize: 12.5, fontFamily: fonts.body.medium, marginTop: 2 }}>{form.paidTo}</Text>
            </View>
          )}

          {needsBank && (
            <PickerRow label="Bank Account" value={form.bankName} onPress={() => setPicker("bank")} />
          )}

          {isChequeMode && form.bankId && (
            <View className="mb-2">
              {lotsLoading ? (
                <View className="flex-row items-center gap-2 mb-3"><ActivityIndicator size="small" color={colors.mutedForeground} /><Text style={{ color: colors.mutedForeground, fontSize: 11.5 }}>Loading cheque lots…</Text></View>
              ) : chequeLots.length === 0 ? (
                <View className="flex-row items-center gap-2 px-3 py-2.5 rounded-xl mb-3" style={{ backgroundColor: "#d9770615", borderWidth: 1, borderColor: "#d9770630" }}>
                  <AlertTriangle size={12} color="#d97706" />
                  <Text style={{ color: "#d97706", fontSize: 11.5, fontFamily: fonts.body.medium }}>No active cheque lots for this bank.</Text>
                </View>
              ) : (
                <PickerRow label="Cheque Lot" value={activeLot ? `${activeLot.ChequeLotNumber}${activeLot.RemainingCheques != null ? ` (${activeLot.RemainingCheques} left)` : ""}` : ""} onPress={() => chequeLots.length > 1 && setPicker("chequeLot")} disabled={chequeLots.length <= 1} />
              )}

              {form.chequeLotId && (
                <>
                  <PickerRow
                    label="Cheque Number"
                    value={form.chequeNo ? `# ${form.chequeNo}` : ""}
                    placeholder={chequeValidating ? "Reserving…" : numbersLoading ? "Loading…" : "Select a cheque number"}
                    onPress={() => setPicker("chequeNo")}
                    disabled={numbersLoading || chequeValidating}
                  />
                  {availableCheques.length === 0 && !numbersLoading && (
                    <Text style={{ color: "#d97706", fontSize: 10.5, marginTop: -6, marginBottom: 10 }}>No available cheques left in this lot.</Text>
                  )}
                  <FieldLabel required={form.mode === "Post-Dated Cheque"}>
                    {form.mode === "Post-Dated Cheque" ? "Post-Dated Cheque Date" : "Cheque Date"}
                  </FieldLabel>
                  <TextField value={form.chequeDate} onChangeText={(v) => { set("chequeDate", v); set("isPostDated", form.mode === "Post-Dated Cheque"); }} placeholder="YYYY-MM-DD" />
                </>
              )}
            </View>
          )}

          {isDigitalMode && DIGITAL_FIELD[form.mode] && (
            <>
              <FieldLabel required>{DIGITAL_FIELD[form.mode].label}</FieldLabel>
              <TextField
                value={form[DIGITAL_FIELD[form.mode].key] as string}
                onChangeText={(v) => set(DIGITAL_FIELD[form.mode].key, v)}
                placeholder={DIGITAL_FIELD[form.mode].placeholder}
              />
            </>
          )}

          {form.mode === "Card" && form.bankId && cards.length > 0 && (
            <PickerRow label="Card Used (optional)" value={selectedCard ? [selectedCard.card_network, maskCardNumber(selectedCard.card_number), selectedCard.card_holder_name].filter(Boolean).join(" · ") : ""} onPress={() => setPicker("card")} />
          )}
        </ScrollView>

        <View className="flex-row gap-2.5 px-4" style={{ paddingBottom: insets.bottom + 14, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border }}>
          <Pressable onPress={onClose} className="px-5 py-3 rounded-xl items-center justify-center" style={{ borderWidth: 1, borderColor: colors.border }}>
            <Text style={{ color: colors.mutedForeground, fontSize: 12.5, fontFamily: fonts.heading.medium }}>Cancel</Text>
          </Pressable>
          <Pressable
            onPress={handleSave}
            disabled={saving}
            className="flex-1 items-center justify-center py-3 rounded-xl"
            style={{ backgroundColor: colors.primary, opacity: saving ? 0.7 : 1 }}
          >
            {saving ? <ActivityIndicator size="small" color="#fff" /> : (
              <Text style={{ color: "#fff", fontSize: 12.5, fontFamily: fonts.heading.semibold }}>Save Payment</Text>
            )}
          </Pressable>
        </View>
      </View>

      <OptionPickerModal
        visible={picker === "company"} title="Select Company" options={companyOptions}
        selectedKey={form.company} onSelect={(k) => { set("company", k); setPicker(null); }} onClose={() => setPicker(null)} searchable clearable
      />
      <OptionPickerModal
        visible={picker === "project"} title="Select Project" options={projectOptions}
        selectedKey={form.project} onSelect={(k) => { set("project", k); setPicker(null); }} onClose={() => setPicker(null)} searchable clearable
      />
      <OptionPickerModal
        visible={picker === "bank"} title="Select Bank Account" options={bankOptions}
        selectedKey={form.bankId ? String(form.bankId) : null} onSelect={onBankSelect} onClose={() => setPicker(null)} searchable
      />
      <OptionPickerModal
        visible={picker === "chequeLot"} title="Select Cheque Lot" options={lotOptions}
        selectedKey={form.chequeLotId ? String(form.chequeLotId) : null} onSelect={onLotSelect} onClose={() => setPicker(null)}
      />
      <OptionPickerModal
        visible={picker === "chequeNo"} title="Select Cheque Number" options={chequeNoOptions}
        selectedKey={form.chequeNo} onSelect={onChequeNumberSelect} onClose={() => setPicker(null)} searchable
      />
      <OptionPickerModal
        visible={picker === "card"} title="Select Card" options={cardOptions}
        selectedKey={form.cardId ? String(form.cardId) : null}
        onSelect={(k) => { set("cardId", k ? Number(k) : null); setPicker(null); }} onClose={() => setPicker(null)} clearable
      />
      <OptionPickerModal
        visible={picker === "invoice"} title="Link to Invoice" options={invoiceOptions}
        selectedKey={form.expenseId} onSelect={onInvoiceSelect} onClose={() => setPicker(null)} searchable clearable loading={invoicesLoading}
      />
    </Modal>
  );
}
