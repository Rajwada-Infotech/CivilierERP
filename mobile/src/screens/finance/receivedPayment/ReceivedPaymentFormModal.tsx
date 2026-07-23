// RN port of ReceivedPayment.tsx's inline create form (view === "form").
// Web renders this as a swapped-in view within the same page; mobile uses
// a full-screen modal instead, matching PaymentFormModal.tsx's convention.
// Field order follows the same "context fields first, then amount/purpose/
// mode" convention requested for the outbound Payment form. Deliberately
// dropped vs. web: editing an existing record, Contract-linking (on-account
// advance tagging), print, submit-for-approval, and delete — all stay
// web-only for now, consistent with Payment's create-only mobile scope.
import { useEffect, useMemo, useState } from "react";
import { View, Text, Modal, Pressable, ScrollView, TextInput, Alert, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { X, ArrowDownCircle } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import {
  addReceivedPayment, fetchCompanyOptions, fetchProjectOptions, fetchCustomerOptions,
  fetchBankOptions, fetchFinYearOptions, fetchDocTypes, fetchNextDocNumber,
  PAYMENT_MODES, type ReceivedPaymentFormPayload,
} from "@/api/receivedPaymentApi";
import { ModeBadge } from "./ReceivedPaymentBadges";
import { PickerRow, OptionPickerModal, type PickerOption } from "../payment/OptionPicker";

type FormState = {
  companyId: string;
  companyName: string;
  projectId: string;
  projectName: string;
  finYear: string;
  customerName: string;
  depositBankId: string;
  depositBankName: string;
  date: string;
  amount: string;
  mode: string;
  checkNumber: string;
  chequeDate: string;
  isPostDated: boolean;
  transactionId: string;
  bankName: string;
  remarks: string;
};

function blankForm(): FormState {
  return {
    companyId: "", companyName: "", projectId: "", projectName: "", finYear: "",
    customerName: "", depositBankId: "", depositBankName: "",
    date: new Date().toISOString().slice(0, 10), amount: "", mode: "",
    checkNumber: "", chequeDate: "", isPostDated: false, transactionId: "", bankName: "", remarks: "",
  };
}

function FieldLabel({ children, required }: { children: string; required?: boolean }) {
  return (
    <Text style={{ color: colors.mutedForeground, fontSize: 10, fontFamily: fonts.body.medium, marginBottom: 5, textTransform: "uppercase", letterSpacing: 0.4 }}>
      {children}{required ? " *" : ""}
    </Text>
  );
}

function TextField({
  value, onChangeText, placeholder, keyboardType, multiline,
}: { value: string; onChangeText: (v: string) => void; placeholder?: string; keyboardType?: "default" | "numeric"; multiline?: boolean }) {
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={`${colors.mutedForeground}99`}
      keyboardType={keyboardType}
      multiline={multiline}
      style={{
        borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: multiline ? 12 : 10,
        color: colors.foreground, fontFamily: fonts.body.regular, fontSize: 13, marginBottom: 14,
        textAlignVertical: multiline ? "top" : "center", minHeight: multiline ? 80 : undefined,
      }}
    />
  );
}

function validateForm(f: FormState): string | null {
  if (!f.companyId) return "Company is required.";
  if (!f.projectId) return "Project is required.";
  if (!f.finYear) return "Financial year is required.";
  if (!f.date) return "Date of receipt is required.";
  if (!f.customerName.trim()) return "Customer name is required.";
  if (!f.depositBankId) return "Deposit bank is required.";
  if (!f.amount || Number(f.amount) <= 0) return "Valid amount is required.";
  return null;
}

export function ReceivedPaymentFormModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(blankForm());
  const [saving, setSaving] = useState(false);
  const [docNoPreview, setDocNoPreview] = useState("");
  const [docNoLoading, setDocNoLoading] = useState(false);
  const [recDocTypeId, setRecDocTypeId] = useState<number | null>(null);
  const [picker, setPicker] = useState<"company" | "project" | "finYear" | "customer" | "bank" | null>(null);

  useEffect(() => {
    if (visible) {
      setForm(blankForm());
      setDocNoPreview("");
      fetchDocTypes("RECP").then((rows) => setRecDocTypeId(rows[0]?.TypeOfDocId ?? null)).catch(() => setRecDocTypeId(null));
    }
  }, [visible]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  const { data: companies = [] } = useQuery({ queryKey: ["rp-form-companies"], queryFn: fetchCompanyOptions, enabled: visible });
  const { data: projects = [] } = useQuery({ queryKey: ["rp-form-projects"], queryFn: fetchProjectOptions, enabled: visible });
  const { data: finYears = [] } = useQuery({ queryKey: ["rp-form-finyears"], queryFn: fetchFinYearOptions, enabled: visible });
  const { data: customers = [] } = useQuery({ queryKey: ["rp-form-customers"], queryFn: fetchCustomerOptions, enabled: visible });
  const { data: banks = [] } = useQuery({ queryKey: ["rp-form-banks"], queryFn: fetchBankOptions, enabled: visible });

  // Only banks linked to the selected company, falling back to all banks —
  // mirrors web's `depositBanks` useMemo (ReceivedPayment.tsx:455-465).
  const depositBankOptions = useMemo(() => {
    if (!form.companyName) return banks;
    const norm = (v?: string | null) => (v || "").trim().replace(/\s+/g, " ").toLowerCase();
    const target = norm(form.companyName);
    const matched = banks.filter((b) => {
      const bc = norm(b.companyName);
      return !bc || bc === target;
    });
    return matched.length > 0 ? matched : banks;
  }, [banks, form.companyName]);

  // Auto-refresh doc number preview when fin year or doc type resolves.
  useEffect(() => {
    if (!visible || !recDocTypeId) return;
    setDocNoLoading(true);
    fetchNextDocNumber(recDocTypeId, form.finYear || undefined)
      .then(setDocNoPreview)
      .catch(() => setDocNoPreview(""))
      .finally(() => setDocNoLoading(false));
  }, [visible, recDocTypeId, form.finYear]);

  const needsBankRef = ["Check", "UPI", "NEFT", "RTGS", "Card"].includes(form.mode);

  const onChequeDateChange = (v: string) => {
    const today = new Date().toISOString().slice(0, 10);
    set("chequeDate", v);
    set("isPostDated", !!v && v > today);
  };

  const handleSave = async () => {
    const error = validateForm(form);
    if (error) {
      Alert.alert("Check the form", error);
      return;
    }
    const payload: ReceivedPaymentFormPayload = {
      RPCompanyName: form.companyName || null,
      RPCompanyId: Number(form.companyId) || null,
      RPReceivedFrom: form.customerName.trim(),
      RPCustomerName: form.customerName.trim(),
      RPProjectName: form.projectName,
      RPProjectId: Number(form.projectId) || null,
      RPDocDate: form.date,
      RPFinYear: form.finYear,
      RPDocTypeId: recDocTypeId,
      RPMode: form.mode,
      RPAmount: Number(form.amount),
      RPBankName: form.bankName || null,
      RPTransactionID: form.transactionId || null,
      RPCheckNumber: form.checkNumber || null,
      RPChequeDate: form.chequeDate || null,
      RPIsPostDated: !!form.isPostDated,
      RPRemarks: form.remarks || null,
      RPDepositBankId: Number(form.depositBankId) || null,
      RPDepositBankName: form.depositBankName || null,
    };
    setSaving(true);
    try {
      await addReceivedPayment(payload);
      queryClient.invalidateQueries({ queryKey: ["received-payments-mobile"], exact: false });
      Alert.alert("Saved", "Payment recorded.");
      onClose();
    } catch (err: any) {
      Alert.alert("Failed to save", err.message ?? "Something went wrong.");
    } finally {
      setSaving(false);
    }
  };

  const companyOptions: PickerOption[] = useMemo(() => companies.map((c) => ({ key: String(c.id), label: c.label })), [companies]);
  const projectOptions: PickerOption[] = useMemo(() => projects.map((p) => ({ key: String(p.id), label: p.label })), [projects]);
  const finYearOptions: PickerOption[] = useMemo(() => finYears.map((f) => ({ key: f.label, label: f.label })), [finYears]);
  const customerOptions: PickerOption[] = useMemo(() => customers.map((c) => ({ key: c.label, label: c.label })), [customers]);
  const bankOptions: PickerOption[] = useMemo(() => depositBankOptions.map((b) => ({ key: String(b.id), label: b.label })), [depositBankOptions]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <View style={{ paddingTop: insets.top + 8 }} className="flex-row items-center justify-between px-4 pb-3">
          <View className="flex-row items-center gap-2.5">
            <View className="w-8 h-8 rounded-lg items-center justify-center" style={{ backgroundColor: "#10b98126" }}>
              <ArrowDownCircle size={14} color="#10b981" />
            </View>
            <Text style={{ color: colors.foreground, fontSize: 14, fontFamily: fonts.heading.semibold }}>New Received Payment</Text>
          </View>
          <Pressable onPress={onClose} className="w-8 h-8 rounded-lg items-center justify-center" style={{ borderWidth: 1, borderColor: colors.border }}>
            <X size={15} color={colors.mutedForeground} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 16 }} keyboardShouldPersistTaps="handled">
          <PickerRow
            label="Company" value={form.companyName}
            onPress={() => setPicker("company")}
          />
          <PickerRow label="Project" value={form.projectName} onPress={() => setPicker("project")} />
          <PickerRow label="Financial Year" value={form.finYear} onPress={() => setPicker("finYear")} />

          <FieldLabel required>Date of Receipt</FieldLabel>
          <TextField value={form.date} onChangeText={(v) => set("date", v)} placeholder="YYYY-MM-DD" />

          <PickerRow label="Customer" value={form.customerName} onPress={() => setPicker("customer")} placeholder="Search / select a customer" />

          <PickerRow
            label="Deposit Bank" value={form.depositBankName}
            onPress={() => setPicker("bank")}
            disabled={!form.companyId}
          />

          <FieldLabel required>Amount</FieldLabel>
          <TextField value={form.amount} onChangeText={(v) => set("amount", v.replace(/[^0-9.]/g, ""))} placeholder="0.00" keyboardType="numeric" />

          <FieldLabel required>Payment Type / Mode</FieldLabel>
          <View className="flex-row flex-wrap gap-2 mb-4">
            {PAYMENT_MODES.map((m) => (
              <Pressable key={m} onPress={() => set("mode", m === form.mode ? "" : m)} style={{ opacity: form.mode && form.mode !== m ? 0.5 : 1 }}>
                <ModeBadge mode={m} />
              </Pressable>
            ))}
          </View>

          {needsBankRef && (
            <>
              {form.mode === "Check" ? (
                <>
                  <FieldLabel>Cheque Number</FieldLabel>
                  <TextField value={form.checkNumber} onChangeText={(v) => set("checkNumber", v)} placeholder="Cheque No." />
                  <FieldLabel>Cheque Date</FieldLabel>
                  <TextField value={form.chequeDate} onChangeText={onChequeDateChange} placeholder="YYYY-MM-DD" />
                  {form.isPostDated && (
                    <Text style={{ color: "#8b5cf6", fontSize: 10.5, marginTop: -10, marginBottom: 14 }}>Marked as post-dated (future cheque date).</Text>
                  )}
                </>
              ) : (
                <>
                  <FieldLabel>Transaction / UTR Ref</FieldLabel>
                  <TextField value={form.transactionId} onChangeText={(v) => set("transactionId", v)} placeholder="Transaction ID / UTR" />
                </>
              )}
              <FieldLabel>Customer Bank Name</FieldLabel>
              <TextField value={form.bankName} onChangeText={(v) => set("bankName", v)} placeholder="Bank of customer" />
            </>
          )}

          <FieldLabel>Remarks</FieldLabel>
          <TextField value={form.remarks} onChangeText={(v) => set("remarks", v)} placeholder="Optional notes" multiline />

          {(docNoLoading || docNoPreview) && (
            <View className="rounded-xl px-3.5 py-2.5 mt-1" style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: `${colors.muted}30` }}>
              <Text style={{ color: colors.mutedForeground, fontSize: 10, fontFamily: fonts.body.regular }}>Document Number</Text>
              <Text style={{ color: colors.foreground, fontSize: 12.5, fontFamily: fonts.heading.semibold, marginTop: 2 }}>
                {docNoLoading ? "Loading…" : docNoPreview}
              </Text>
            </View>
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
            style={{ backgroundColor: "#10b981", opacity: saving ? 0.7 : 1 }}
          >
            {saving ? <ActivityIndicator size="small" color="#fff" /> : (
              <Text style={{ color: "#fff", fontSize: 12.5, fontFamily: fonts.heading.semibold }}>Save Payment</Text>
            )}
          </Pressable>
        </View>
      </View>

      <OptionPickerModal
        visible={picker === "company"} title="Select Company" options={companyOptions}
        selectedKey={form.companyId}
        onSelect={(k) => {
          const c = companies.find((x) => String(x.id) === k);
          setForm((f) => ({ ...f, companyId: k, companyName: c?.label ?? "", depositBankId: "", depositBankName: "" }));
          setPicker(null);
        }}
        onClose={() => setPicker(null)} searchable
      />
      <OptionPickerModal
        visible={picker === "project"} title="Select Project" options={projectOptions}
        selectedKey={form.projectId}
        onSelect={(k) => {
          const p = projects.find((x) => String(x.id) === k);
          setForm((f) => ({ ...f, projectId: k, projectName: p?.label ?? "" }));
          setPicker(null);
        }}
        onClose={() => setPicker(null)} searchable
      />
      <OptionPickerModal
        visible={picker === "finYear"} title="Select Financial Year" options={finYearOptions}
        selectedKey={form.finYear} onSelect={(k) => { set("finYear", k); setPicker(null); }} onClose={() => setPicker(null)}
      />
      <OptionPickerModal
        visible={picker === "customer"} title="Select Customer" options={customerOptions}
        selectedKey={form.customerName} onSelect={(k) => { set("customerName", k); setPicker(null); }} onClose={() => setPicker(null)} searchable
      />
      <OptionPickerModal
        visible={picker === "bank"} title="Select Deposit Bank" options={bankOptions}
        selectedKey={form.depositBankId}
        onSelect={(k) => {
          const b = depositBankOptions.find((x) => String(x.id) === k);
          setForm((f) => ({ ...f, depositBankId: k, depositBankName: b?.label ?? "" }));
          setPicker(null);
        }}
        onClose={() => setPicker(null)} searchable
      />
    </Modal>
  );
}
