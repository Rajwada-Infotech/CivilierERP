// RN port of ReceivedPayment.tsx's inline create form (view === "form").
// Web renders this as a swapped-in view within the same page; mobile uses
// its own page of the stack (ReceivedPaymentFormScreen, `asScreen`) under the app's header, drawn on the sheet —
// matching PaymentFormModal.tsx's convention.
// Field order follows the same "context fields first, then amount/purpose/
// mode" convention requested for the outbound Payment form. Create AND
// edit are supported (editingRecord prop, mirroring PaymentFormModal's
// modal-prop pattern). Deliberately dropped vs. web: Contract-linking
// (on-account advance tagging), print, and submit-for-approval.
import { istToday } from "@/utils/istTime";
import { useLockedFinYear } from "@/hooks/useLockedFinYear";
import { useEffect, useMemo, useState } from "react";
import { View, Text, Modal, ScrollView, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react-native";
import { colors, sheet as S } from "@/theme/colors";
import { Body, Field, Input, Key, Label, Panel, Press, SheetShell } from "@/components/sheet/Sheet";
import { fonts } from "@/theme/fonts";
import {
  addReceivedPayment, updateReceivedPayment, fetchCompanyOptions, fetchProjectOptions, fetchCustomerOptions,
  fetchBankOptions, fetchFinYearOptions, fetchDocTypes, fetchNextDocNumber,
  PAYMENT_MODES, type ReceivedPaymentFormPayload, type ReceivedPayment,
} from "@/api/receivedPaymentApi";
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
    date: istToday(), amount: "", mode: "",
    checkNumber: "", chequeDate: "", isPostDated: false, transactionId: "", bankName: "", remarks: "",
  };
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

export function ReceivedPaymentFormModal({
  visible, onClose, editingRecord, asScreen,
}: {
  visible: boolean; onClose: () => void; editingRecord?: ReceivedPayment | null;
  /** Drawn as a page of the stack (ReceivedPaymentFormScreen) instead of a modal over the list. */
  asScreen?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const isEditing = !!editingRecord;
  const [form, setForm] = useState<FormState>(blankForm());
  const [saving, setSaving] = useState(false);
  const [docNoPreview, setDocNoPreview] = useState("");
  const [docNoLoading, setDocNoLoading] = useState(false);
  const [recDocTypeId, setRecDocTypeId] = useState<number | null>(null);
  const [picker, setPicker] = useState<"company" | "project" | "finYear" | "customer" | "bank" | null>(null);

  useEffect(() => {
    if (!visible) return;
    if (editingRecord) {
      const r = editingRecord;
      setForm({
        companyId: r.companyId != null ? String(r.companyId) : "", companyName: r.companyName,
        projectId: r.projectId != null ? String(r.projectId) : "", projectName: r.projectName,
        finYear: r.finYear || "", customerName: r.customerName || r.receivedFrom,
        depositBankId: r.depositBankId != null ? String(r.depositBankId) : "", depositBankName: r.depositBankName || "",
        date: r.docDate || istToday(), amount: String(r.amount), mode: r.mode,
        checkNumber: r.checkNumber || "", chequeDate: r.chequeDate || "", isPostDated: !!r.isPostDated,
        transactionId: r.transactionId || "", bankName: r.bankName || "", remarks: r.remarks || "",
      });
      setDocNoPreview(r.docNo);
    } else {
      setForm(blankForm());
      setDocNoPreview("");
      fetchDocTypes("RECP").then((rows) => setRecDocTypeId(rows[0]?.TypeOfDocId ?? null)).catch(() => setRecDocTypeId(null));
    }
  }, [visible, editingRecord]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  const { data: companies = [] } = useQuery({ queryKey: ["rp-form-companies"], queryFn: fetchCompanyOptions, enabled: visible });
  const { data: projects = [] } = useQuery({ queryKey: ["rp-form-projects"], queryFn: fetchProjectOptions, enabled: visible });
  const { data: finYears = [] } = useQuery({ queryKey: ["rp-form-finyears"], queryFn: fetchFinYearOptions, enabled: visible });
  // New records are locked to the current financial year (else the most
  // recent one); an existing record keeps the year it was saved with.
  const lockedFY = useLockedFinYear(visible && !editingRecord);
  const finYearLocked = (visible && !editingRecord) && !!lockedFY;
  useEffect(() => {
    if (!(visible && !editingRecord) || !lockedFY) return;
    set("finYear", lockedFY.label);
  }, [visible, editingRecord, lockedFY?.id]);
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
    const today = istToday();
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
      if (isEditing) {
        await updateReceivedPayment(editingRecord!.id, payload);
        queryClient.invalidateQueries({ queryKey: ["received-payments-mobile"], exact: false });
        Alert.alert("Saved", "Payment updated.");
      } else {
        await addReceivedPayment(payload);
        queryClient.invalidateQueries({ queryKey: ["received-payments-mobile"], exact: false });
        Alert.alert("Saved", "Payment recorded.");
      }
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

  const content = (
    <>
      <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: asScreen ? 0 : insets.top }}>
        <ScrollView contentContainerStyle={{ paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
          <SheetShell
            eyebrow="CivilierERP · Finance · Receipt"
            title={isEditing ? "Edit receipt" : "New receipt"}
            subtitle={docNoLoading ? "Numbering…" : docNoPreview || "A payment received from a client or customer"}
            action={<Key label={asScreen ? "Back" : "Close"} icon={<X size={13} color={S.ink} />} onPress={onClose} style={{ alignSelf: "flex-start" }} />}
          >
            <Panel title="Party & date">
              <View>
                <PickerRow label="Company" value={form.companyName} onPress={() => setPicker("company")} />
                <PickerRow label="Project" value={form.projectName} onPress={() => setPicker("project")} />
                <PickerRow label={finYearLocked ? "Financial Year · locked to current" : "Financial Year"} value={form.finYear} onPress={() => setPicker("finYear")} disabled={finYearLocked} />
                <Field label="Date of Receipt" required style={{ marginBottom: 12 }}>
                  <Input value={form.date} onChangeText={(v) => set("date", v)} placeholder="YYYY-MM-DD" />
                </Field>
                <PickerRow label="Customer" value={form.customerName} onPress={() => setPicker("customer")} placeholder="Search / select a customer" />
                <PickerRow label="Deposit Bank" value={form.depositBankName} onPress={() => setPicker("bank")} disabled={!form.companyId} />
              </View>
            </Panel>

            <Panel title="Receipt">
              <Field label="Amount" required>
                <Input value={form.amount} onChangeText={(v) => set("amount", v.replace(/[^0-9.]/g, ""))} placeholder="0.00" keyboardType="numeric" />
              </Field>

              <Field label="Payment Type / Mode" required>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {PAYMENT_MODES.map((m) => {
                    const on = form.mode === m;
                    return (
                      <Press
                        key={m}
                        onPress={() => set("mode", on ? "" : m)}
                        style={(pressed) => ({ paddingHorizontal: 12, paddingVertical: 9, borderWidth: 1, borderColor: S.ink, backgroundColor: on ? S.ink : pressed ? S.blueWash : "transparent" })}
                      >
                        <Text style={{ color: on ? S.paper : S.ink, fontSize: 10, letterSpacing: 1.1, textTransform: "uppercase", fontFamily: fonts.heading.semibold }}>{m}</Text>
                      </Press>
                    );
                  })}
                </View>
              </Field>

              {needsBankRef && (
                <>
                  {form.mode === "Check" ? (
                    <>
                      <Field label="Cheque Number">
                        <Input value={form.checkNumber} onChangeText={(v) => set("checkNumber", v)} placeholder="Cheque No." />
                      </Field>
                      <Field label="Cheque Date">
                        <Input value={form.chequeDate} onChangeText={onChequeDateChange} placeholder="YYYY-MM-DD" />
                      </Field>
                      {form.isPostDated && <Body size={12} color={S.ink2}>Marked as post-dated (a future cheque date).</Body>}
                    </>
                  ) : (
                    <Field label="Transaction / UTR Ref">
                      <Input value={form.transactionId} onChangeText={(v) => set("transactionId", v)} placeholder="Transaction ID / UTR" />
                    </Field>
                  )}
                  <Field label="Customer Bank Name">
                    <Input value={form.bankName} onChangeText={(v) => set("bankName", v)} placeholder="Bank of customer" />
                  </Field>
                </>
              )}

              <Field label="Remarks">
                <Input value={form.remarks} onChangeText={(v) => set("remarks", v)} placeholder="Optional notes" multiline numberOfLines={3} style={{ minHeight: 76, paddingVertical: 10, textAlignVertical: "top" }} />
              </Field>
            </Panel>

            {(docNoLoading || docNoPreview) && (
              <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: S.ink }}>
                <Label>Document number</Label>
                <Text style={{ color: S.ink, fontSize: 14, fontFamily: fonts.heading.semibold }}>{docNoLoading ? "Loading…" : docNoPreview}</Text>
              </View>
            )}
          </SheetShell>
        </ScrollView>

        <View style={{ flexDirection: "row", gap: 10, paddingHorizontal: 12, paddingTop: 10, paddingBottom: insets.bottom + 12, borderTopWidth: 1.5, borderTopColor: S.ink, backgroundColor: colors.background }}>
          <Key label="Cancel" onPress={onClose} />
          <Key tone="ink" label={saving ? "Saving…" : isEditing ? "Update receipt" : "Save receipt"} onPress={handleSave} disabled={saving} style={{ flex: 1 }} />
        </View>
      </View>

      <OptionPickerModal
        visible={picker === "company"} title="Select company" options={companyOptions}
        selectedKey={form.companyId}
        onSelect={(k) => {
          const c = companies.find((x) => String(x.id) === k);
          setForm((f) => ({ ...f, companyId: k, companyName: c?.label ?? "", depositBankId: "", depositBankName: "" }));
          setPicker(null);
        }}
        onClose={() => setPicker(null)} searchable
      />
      <OptionPickerModal
        visible={picker === "project"} title="Select project" options={projectOptions}
        selectedKey={form.projectId}
        onSelect={(k) => {
          const p = projects.find((x) => String(x.id) === k);
          setForm((f) => ({ ...f, projectId: k, projectName: p?.label ?? "" }));
          setPicker(null);
        }}
        onClose={() => setPicker(null)} searchable
      />
      <OptionPickerModal
        visible={picker === "finYear"} title="Select financial year" options={finYearOptions}
        selectedKey={form.finYear} onSelect={(k) => { set("finYear", k); setPicker(null); }} onClose={() => setPicker(null)}
      />
      <OptionPickerModal
        visible={picker === "customer"} title="Select customer" options={customerOptions}
        selectedKey={form.customerName} onSelect={(k) => { set("customerName", k); setPicker(null); }} onClose={() => setPicker(null)} searchable
      />
      <OptionPickerModal
        visible={picker === "bank"} title="Select deposit bank" options={bankOptions}
        selectedKey={form.depositBankId}
        onSelect={(k) => {
          const b = depositBankOptions.find((x) => String(x.id) === k);
          setForm((f) => ({ ...f, depositBankId: k, depositBankName: b?.label ?? "" }));
          setPicker(null);
        }}
        onClose={() => setPicker(null)} searchable
      />
    </>
  );

  return asScreen ? (
    <View style={{ flex: 1 }}>{content}</View>
  ) : (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      {content}
    </Modal>
  );
}
