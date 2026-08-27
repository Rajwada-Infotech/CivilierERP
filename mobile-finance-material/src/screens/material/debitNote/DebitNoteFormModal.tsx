// RN port of DebitNoteMaster.tsx's create/edit form (the generic MasterPage
// fields array on web). Picking a bill auto-fills Company/Project/Supplier
// (matching web's handleBillOptionSelect), but those three stay editable
// pickers afterward — same as web, they're independently required fields,
// not locked derivatives of the bill. Line items are always freehand
// (Description/Qty/UOM/Rate/Amount) — there's no source document to pull
// them from, unlike GRN/PO line items. Reason is a mobile addition (see
// debitNoteApi.ts header comment); the web discount-preview panel is
// dropped since it's never persisted.
import { useEffect, useMemo, useState } from "react";
import { View, Text, Modal, Pressable, ScrollView, TextInput, Alert, ActivityIndicator, Switch } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { X, ClipboardMinus, Plus, Trash2 } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import {
  getDebitNoteById, createDebitNote, updateDebitNote,
  getCompanies, getProjects, getSuppliers, fetchFinYearOptions, getBillOptions,
  type CreateDebitNotePayload, type DebitNoteItem,
} from "@/api/debitNoteApi";
import { PickerRow, OptionPickerModal, type PickerOption } from "@/screens/finance/payment/OptionPicker";

type CartItem = { key: string; description: string; quantity: string; uom: string; rate: string; amount: string };

let seq = 0;
const uid = () => `dn-${Date.now()}-${seq++}`;

function blankCartItem(): CartItem {
  return { key: uid(), description: "", quantity: "", uom: "", rate: "", amount: "" };
}

function todayISO() { return new Date().toISOString().slice(0, 10); }

type FormState = {
  finYear: string;
  billId: string; billLabel: string;
  companyId: string; companyName: string;
  projectId: string; projectName: string;
  supplierId: string; supplierName: string;
  debitDate: string; reason: string; isActive: boolean;
};

function blankForm(): FormState {
  return {
    finYear: "", billId: "", billLabel: "", companyId: "", companyName: "", projectId: "", projectName: "",
    supplierId: "", supplierName: "", debitDate: todayISO(), reason: "", isActive: true,
  };
}

function FieldLabel({ children, required }: { children: string; required?: boolean }) {
  return (
    <Text style={{ color: colors.mutedForeground, fontSize: 10, fontFamily: fonts.body.medium, marginBottom: 5, textTransform: "uppercase", letterSpacing: 0.4 }}>
      {children}{required ? " *" : ""}
    </Text>
  );
}

function TextField({ value, onChangeText, placeholder, multiline }: { value: string; onChangeText: (v: string) => void; placeholder?: string; multiline?: boolean }) {
  return (
    <TextInput
      value={value} onChangeText={onChangeText} placeholder={placeholder} multiline={multiline}
      placeholderTextColor={`${colors.mutedForeground}99`}
      style={{
        borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: multiline ? 12 : 10,
        color: colors.foreground, fontFamily: fonts.body.regular, fontSize: 13, marginBottom: 14,
        textAlignVertical: multiline ? "top" : "center", minHeight: multiline ? 70 : undefined,
      }}
    />
  );
}

export function DebitNoteFormModal({
  visible, editingId, onClose,
}: { visible: boolean; editingId: number | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(blankForm());
  const [cart, setCart] = useState<CartItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [picker, setPicker] = useState<"finYear" | "bill" | "company" | "project" | "supplier" | null>(null);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  useEffect(() => {
    if (!visible) return;
    if (editingId == null) {
      setForm(blankForm());
      setCart([]);
    }
  }, [visible, editingId]);

  const { data: companies = [] } = useQuery({ queryKey: ["dn-form-companies"], queryFn: getCompanies, enabled: visible });
  const { data: projects = [] } = useQuery({ queryKey: ["dn-form-projects"], queryFn: getProjects, enabled: visible });
  const { data: suppliers = [] } = useQuery({ queryKey: ["dn-form-suppliers"], queryFn: getSuppliers, enabled: visible });
  const { data: finYears = [] } = useQuery({ queryKey: ["dn-form-finyears"], queryFn: fetchFinYearOptions, enabled: visible });
  const { data: bills = [], isFetching: loadingBills } = useQuery({
    queryKey: ["dn-form-bills", form.finYear, form.supplierId],
    queryFn: () => getBillOptions(form.finYear || undefined, form.supplierId || undefined),
    enabled: visible && !!form.finYear,
  });

  const { data: existing, isLoading: loadingExisting } = useQuery({
    queryKey: ["dn-editing-record", editingId],
    queryFn: () => getDebitNoteById(editingId!),
    enabled: visible && editingId != null,
  });

  useEffect(() => {
    if (!visible || editingId == null || !existing) return;
    setForm({
      finYear: "", billId: existing.bill_id ? String(existing.bill_id) : "", billLabel: "",
      companyId: existing.company_id ? String(existing.company_id) : "", companyName: existing.company_name || "",
      projectId: existing.project_id ? String(existing.project_id) : "", projectName: existing.project_name || "",
      supplierId: existing.supplier_id ? String(existing.supplier_id) : "", supplierName: existing.supplier_name || "",
      debitDate: existing.DebitDate?.slice(0, 10) || todayISO(), reason: existing.Reason || "", isActive: existing.is_active !== false,
    });
    setCart(
      (existing.items ?? []).map((it) => ({
        key: uid(), description: it.Description, quantity: it.Quantity != null ? String(it.Quantity) : "",
        uom: it.UOMSymbol || "", rate: it.Rate != null ? String(it.Rate) : "", amount: it.Amount != null ? String(it.Amount) : "",
      })),
    );
  }, [visible, editingId, existing]);

  const pickBill = (billId: string) => {
    const bill = bills.find((b) => b.id === billId);
    if (!bill) return;
    const matchCompany = bill.companyId != null ? companies.find((c) => c.id === String(bill.companyId)) : undefined;
    const matchProject = bill.projectName ? projects.find((p) => p.name === bill.projectName) : undefined;
    const matchSupplier = bill.partyId != null ? suppliers.find((s) => s.id === String(bill.partyId)) : undefined;
    setForm((f) => ({
      ...f, billId, billLabel: bill.label,
      companyId: matchCompany?.id ?? f.companyId, companyName: matchCompany?.name ?? f.companyName,
      projectId: matchProject?.id ?? f.projectId, projectName: matchProject?.name ?? f.projectName,
      supplierId: matchSupplier?.id ?? f.supplierId, supplierName: matchSupplier?.name ?? bill.supplierName ?? f.supplierName,
    }));
    setPicker(null);
  };

  const updateCartField = (idx: number, patch: Partial<CartItem>) => setCart((prev) => prev.map((ci, i) => {
    if (i !== idx) return ci;
    const updated = { ...ci, ...patch };
    if (patch.quantity !== undefined || patch.rate !== undefined) {
      const qty = Number(updated.quantity) || 0;
      const rate = Number(updated.rate) || 0;
      updated.amount = (qty * rate).toFixed(2);
    }
    return updated;
  }));
  const addCartRow = () => setCart((p) => [...p, blankCartItem()]);
  const removeCartRow = (idx: number) => setCart((p) => p.filter((_, i) => i !== idx));

  const totalAmount = useMemo(() => cart.reduce((s, ci) => s + (Number(ci.amount) || 0), 0), [cart]);

  const validate = (): string | null => {
    if (!form.companyId) return "Company is required.";
    if (!form.projectId) return "Project is required.";
    if (!form.supplierId) return "Supplier is required.";
    if (!form.billId) return "A bill is required — pick one from the Financial Year + Bill fields.";
    if (cart.some((ci) => ci.description.trim() && Number(ci.amount) < 0)) return "Line item amounts can't be negative.";
    return null;
  };

  const handleSave = async () => {
    const error = validate();
    if (error) {
      Alert.alert("Check the form", error);
      return;
    }
    const items: DebitNoteItem[] = cart
      .filter((ci) => ci.description.trim())
      .map((ci) => ({
        Description: ci.description.trim(), Quantity: ci.quantity ? Number(ci.quantity) : null,
        UOMSymbol: ci.uom || null, Rate: ci.rate ? Number(ci.rate) : null, Amount: Number(ci.amount) || 0,
      }));
    const payload: CreateDebitNotePayload = {
      company_id: Number(form.companyId), project_id: Number(form.projectId), supplier_id: Number(form.supplierId),
      bill_id: Number(form.billId), is_active: form.isActive, DebitDate: form.debitDate || null, Reason: form.reason || null, items,
    };
    setSaving(true);
    try {
      if (editingId != null) {
        await updateDebitNote(editingId, payload);
        Alert.alert("Saved", "Debit Note updated.");
      } else {
        await createDebitNote(payload);
        Alert.alert("Saved", "Debit Note created.");
      }
      queryClient.invalidateQueries({ queryKey: ["debit-notes-mobile"], exact: false });
      onClose();
    } catch (err: any) {
      Alert.alert("Failed to save", err.message ?? "Something went wrong.");
    } finally {
      setSaving(false);
    }
  };

  const finYearOptions: PickerOption[] = finYears.map((f) => ({ key: f.label, label: f.label }));
  const billOptions: PickerOption[] = bills.map((b) => ({ key: b.id, label: b.label, sublabel: b.type === "emi" ? "EMI Installment" : "Bill" }));
  const companyOptions: PickerOption[] = companies.map((c) => ({ key: c.id, label: c.name }));
  const projectOptions: PickerOption[] = (form.companyId ? projects.filter((p) => p.companyId === form.companyId) : projects).map((p) => ({ key: p.id, label: p.name }));
  const supplierOptions: PickerOption[] = suppliers.map((s) => ({ key: s.id, label: s.name }));

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <View style={{ paddingTop: insets.top + 8 }} className="flex-row items-center justify-between px-4 pb-3">
          <View className="flex-row items-center gap-2.5">
            <View className="w-8 h-8 rounded-lg items-center justify-center" style={{ backgroundColor: "#dc262626" }}>
              <ClipboardMinus size={14} color="#dc2626" />
            </View>
            <Text style={{ color: colors.foreground, fontSize: 14, fontFamily: fonts.heading.semibold }}>{editingId ? "Edit Debit Note" : "New Debit Note"}</Text>
          </View>
          <Pressable onPress={onClose} className="w-8 h-8 rounded-lg items-center justify-center" style={{ borderWidth: 1, borderColor: colors.border }}>
            <X size={15} color={colors.mutedForeground} />
          </Pressable>
        </View>

        {loadingExisting ? (
          <View className="flex-1 items-center justify-center"><ActivityIndicator color={colors.mutedForeground} /></View>
        ) : (
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 16 }} keyboardShouldPersistTaps="handled">
            <Text style={{ color: colors.mutedForeground, fontSize: 10.5, fontFamily: fonts.heading.semibold, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 10 }}>Reference</Text>
            <PickerRow label="Financial Year" value={form.finYear} placeholder="Select year to load bills" onPress={() => setPicker("finYear")} />
            <PickerRow
              label="Bill" value={form.billLabel} placeholder={loadingBills ? "Loading…" : !form.finYear ? "Select a Financial Year first" : "Select a bill"}
              onPress={() => setPicker("bill")} disabled={!form.finYear}
            />

            <Text style={{ color: colors.mutedForeground, fontSize: 10.5, fontFamily: fonts.heading.semibold, textTransform: "uppercase", letterSpacing: 0.6, marginTop: 8, marginBottom: 10 }}>Company, Project &amp; Supplier</Text>
            <PickerRow label="Company" value={form.companyName} onPress={() => setPicker("company")} />
            <PickerRow label="Project" value={form.projectName} onPress={() => setPicker("project")} />
            <PickerRow label="Supplier" value={form.supplierName} onPress={() => setPicker("supplier")} />

            <FieldLabel required>Debit Date</FieldLabel>
            <TextField value={form.debitDate} onChangeText={(v) => set("debitDate", v)} placeholder="YYYY-MM-DD" />
            <FieldLabel>Reason</FieldLabel>
            <TextField value={form.reason} onChangeText={(v) => set("reason", v)} placeholder="Why is this being debited?" multiline />

            <View className="flex-row items-center justify-between rounded-xl px-3.5 py-3 mb-4" style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: `${colors.card}80` }}>
              <Text style={{ color: colors.foreground, fontSize: 12.5, fontFamily: fonts.body.medium }}>Active</Text>
              <Switch value={form.isActive} onValueChange={(v) => set("isActive", v)} trackColor={{ true: colors.primary, false: colors.border }} />
            </View>

            <View className="flex-row items-center justify-between mb-2.5">
              <Text style={{ color: colors.mutedForeground, fontSize: 10.5, fontFamily: fonts.heading.semibold, textTransform: "uppercase", letterSpacing: 0.6 }}>
                Line Items ({cart.length})
              </Text>
              {cart.length > 0 && <Text style={{ color: colors.primary, fontSize: 12, fontFamily: fonts.heading.bold }}>Total: {totalAmount.toFixed(2)}</Text>}
            </View>

            {cart.length === 0 && (
              <View className="rounded-xl px-3.5 py-4 items-center mb-2" style={{ borderWidth: 1, borderColor: colors.border, borderStyle: "dashed" }}>
                <Text style={{ color: colors.mutedForeground, fontSize: 11.5, textAlign: "center" }}>No line items yet — optional, but the total is built from these.</Text>
              </View>
            )}
            {cart.map((ci, idx) => (
              <View key={ci.key} className="rounded-xl p-3 mb-2.5" style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: `${colors.card}80` }}>
                <View className="flex-row items-center justify-between mb-2">
                  <TextInput
                    value={ci.description} onChangeText={(v) => updateCartField(idx, { description: v })}
                    placeholder="Description" placeholderTextColor={`${colors.mutedForeground}99`}
                    style={{ flex: 1, marginRight: 8, color: colors.foreground, fontSize: 12.5, fontFamily: fonts.body.medium }}
                  />
                  <Pressable onPress={() => removeCartRow(idx)} className="p-1">
                    <Trash2 size={14} color={colors.destructive} />
                  </Pressable>
                </View>
                <View className="flex-row gap-2 mb-2">
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.mutedForeground, fontSize: 9, textTransform: "uppercase" }}>Qty</Text>
                    <TextInput
                      value={ci.quantity} onChangeText={(v) => updateCartField(idx, { quantity: v.replace(/[^0-9.]/g, "") })}
                      keyboardType="numeric"
                      style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, color: colors.foreground, fontSize: 12, marginTop: 3 }}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.mutedForeground, fontSize: 9, textTransform: "uppercase" }}>UOM</Text>
                    <TextInput
                      value={ci.uom} onChangeText={(v) => updateCartField(idx, { uom: v })}
                      style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, color: colors.foreground, fontSize: 12, marginTop: 3 }}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.mutedForeground, fontSize: 9, textTransform: "uppercase" }}>Rate</Text>
                    <TextInput
                      value={ci.rate} onChangeText={(v) => updateCartField(idx, { rate: v.replace(/[^0-9.]/g, "") })}
                      keyboardType="numeric"
                      style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, color: colors.foreground, fontSize: 12, marginTop: 3 }}
                    />
                  </View>
                </View>
                <View>
                  <Text style={{ color: colors.mutedForeground, fontSize: 9, textTransform: "uppercase" }}>Amount</Text>
                  <TextInput
                    value={ci.amount} onChangeText={(v) => updateCartField(idx, { amount: v.replace(/[^0-9.]/g, "") })}
                    keyboardType="numeric"
                    style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, color: colors.foreground, fontSize: 12, marginTop: 3, fontFamily: fonts.heading.semibold }}
                  />
                </View>
              </View>
            ))}
            <Pressable onPress={addCartRow} className="flex-row items-center justify-center gap-1.5 py-2.5 rounded-xl mb-2" style={{ borderWidth: 1, borderColor: colors.border, borderStyle: "dashed" }}>
              <Plus size={13} color={colors.primary} />
              <Text style={{ color: colors.primary, fontSize: 12, fontFamily: fonts.heading.medium }}>Add Line Item</Text>
            </Pressable>
          </ScrollView>
        )}

        <View className="flex-row gap-2.5 px-4" style={{ paddingBottom: insets.bottom + 14, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border }}>
          <Pressable onPress={onClose} className="px-5 py-3 rounded-xl items-center justify-center" style={{ borderWidth: 1, borderColor: colors.border }}>
            <Text style={{ color: colors.mutedForeground, fontSize: 12.5, fontFamily: fonts.heading.medium }}>Cancel</Text>
          </Pressable>
          <Pressable
            onPress={handleSave} disabled={saving}
            className="flex-1 items-center justify-center py-3 rounded-xl"
            style={{ backgroundColor: "#dc2626", opacity: saving ? 0.7 : 1 }}
          >
            {saving ? <ActivityIndicator size="small" color="#fff" /> : (
              <Text style={{ color: "#fff", fontSize: 12.5, fontFamily: fonts.heading.semibold }}>{editingId ? "Save Changes" : "Save Debit Note"}</Text>
            )}
          </Pressable>
        </View>
      </View>

      <OptionPickerModal visible={picker === "finYear"} title="Select Financial Year" options={finYearOptions} selectedKey={form.finYear}
        onSelect={(k) => { set("finYear", k); set("billId", ""); set("billLabel", ""); setPicker(null); }} onClose={() => setPicker(null)} clearable />
      <OptionPickerModal visible={picker === "bill"} title="Select Bill" options={billOptions} selectedKey={form.billId}
        onSelect={pickBill} onClose={() => setPicker(null)} searchable loading={loadingBills} />
      <OptionPickerModal visible={picker === "company"} title="Select Company" options={companyOptions} selectedKey={form.companyId}
        onSelect={(k) => { const c = companies.find((x) => x.id === k); setForm((f) => ({ ...f, companyId: k, companyName: c?.name ?? "" })); setPicker(null); }}
        onClose={() => setPicker(null)} searchable />
      <OptionPickerModal visible={picker === "project"} title="Select Project" options={projectOptions} selectedKey={form.projectId}
        onSelect={(k) => { const p = projects.find((x) => x.id === k); setForm((f) => ({ ...f, projectId: k, projectName: p?.name ?? "" })); setPicker(null); }}
        onClose={() => setPicker(null)} searchable />
      <OptionPickerModal visible={picker === "supplier"} title="Select Supplier" options={supplierOptions} selectedKey={form.supplierId}
        onSelect={(k) => { const s = suppliers.find((x) => x.id === k); setForm((f) => ({ ...f, supplierId: k, supplierName: s?.name ?? "" })); setPicker(null); }}
        onClose={() => setPicker(null)} searchable />
    </Modal>
  );
}
