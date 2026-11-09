// RN port of DebitNoteMaster.tsx's create/edit form, on the drawing sheet: a page of the stack (asScreen, from
// DebitNoteFormScreen) with Cancel / Save along its foot. (The generic MasterPage
// fields array on web). Picking a bill auto-fills Company/Project/Supplier
// (matching web's handleBillOptionSelect), but those three stay editable
// pickers afterward — same as web, they're independently required fields,
// not locked derivatives of the bill. Line items are always freehand
// (Description/Qty/UOM/Rate/Amount) — there's no source document to pull
// them from, unlike GRN/PO line items. Reason is a mobile addition (see
// debitNoteApi.ts header comment); the web discount-preview panel is
// dropped since it's never persisted.
import { istToday } from "@/utils/istTime";
import { useEffect, useMemo, useState } from "react";
import { View, Alert } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardMinus } from "lucide-react-native";
import { sheet as S } from "@/theme/colors";
import { formatINR } from "@/utils/formatCurrency";
import { Body, Field, Input, Label, Panel, Seg } from "@/components/sheet/Sheet";
import { TextField } from "@/components/sheet/FormParts";
import { AddLineKey, FormPage, LineBox } from "@/components/sheet/Register";
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

function todayISO() { return istToday(); }

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

export function DebitNoteFormModal({
  visible, editingId, onClose, asScreen,
}: { visible: boolean; editingId: number | null; onClose: () => void; asScreen?: boolean }) {
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
    <FormPage
      asScreen={asScreen}
      visible={visible}
      onClose={onClose}
      eyebrow="CivilierERP · Material · Debit note"
      title={editingId ? "Edit debit note" : "New debit note"}
      subtitle="A value adjustment against a supplier's bill."
      loading={editingId != null && loadingExisting}
      saving={saving}
      onSave={handleSave}
      saveLabel={editingId ? "Save changes" : "Save debit note"}
      overlays={
        <>
          <OptionPickerModal visible={picker === "finYear"} title="Select financial year" options={finYearOptions} selectedKey={form.finYear}
            onSelect={(k) => { set("finYear", k); set("billId", ""); set("billLabel", ""); setPicker(null); }} onClose={() => setPicker(null)} clearable />
          <OptionPickerModal visible={picker === "bill"} title="Select bill" options={billOptions} selectedKey={form.billId}
            onSelect={pickBill} onClose={() => setPicker(null)} searchable loading={loadingBills} />
          <OptionPickerModal visible={picker === "company"} title="Select company" options={companyOptions} selectedKey={form.companyId}
            onSelect={(k) => { const c = companies.find((x) => x.id === k); setForm((f) => ({ ...f, companyId: k, companyName: c?.name ?? "" })); setPicker(null); }}
            onClose={() => setPicker(null)} searchable />
          <OptionPickerModal visible={picker === "project"} title="Select project" options={projectOptions} selectedKey={form.projectId}
            onSelect={(k) => { const p = projects.find((x) => x.id === k); setForm((f) => ({ ...f, projectId: k, projectName: p?.name ?? "" })); setPicker(null); }}
            onClose={() => setPicker(null)} searchable />
          <OptionPickerModal visible={picker === "supplier"} title="Select supplier" options={supplierOptions} selectedKey={form.supplierId}
            onSelect={(k) => { const s = suppliers.find((x) => x.id === k); setForm((f) => ({ ...f, supplierId: k, supplierName: s?.name ?? "" })); setPicker(null); }}
            onClose={() => setPicker(null)} searchable />
        </>
      }
    >
      <Panel title="Reference">
        <View>
          <PickerRow label="Financial year" value={form.finYear} placeholder="Select year to load bills…" onPress={() => setPicker("finYear")} />
          <PickerRow label="Bill" value={form.billLabel} placeholder={loadingBills ? "Loading…" : !form.finYear ? "Select a financial year first" : "Select a bill…"} onPress={() => setPicker("bill")} disabled={!form.finYear} />
        </View>
      </Panel>

      <Panel title="Company, project & supplier">
        <View>
          <PickerRow label="Company *" value={form.companyName} placeholder="Select company…" onPress={() => setPicker("company")} />
          <PickerRow label="Project *" value={form.projectName} placeholder="Select project…" onPress={() => setPicker("project")} />
          <PickerRow label="Supplier *" value={form.supplierName} placeholder="Select supplier…" onPress={() => setPicker("supplier")} />
        </View>
        <Field label="Debit date" required>
          <Input value={form.debitDate} onChangeText={(v) => set("debitDate", v)} placeholder="YYYY-MM-DD" />
        </Field>
        <View>
          <TextField label="Reason" value={form.reason} onChangeText={(v) => set("reason", v)} placeholder="Why is this being debited?" multiline />
        </View>
        <Field label="Status">
          <Seg options={[{ value: "on", label: "Active" }, { value: "off", label: "Inactive" }]} value={form.isActive ? "on" : "off"} onChange={(v) => set("isActive", v === "on")} />
        </Field>
      </Panel>

      <Panel title={`Line items (${cart.length})`} icon={<ClipboardMinus size={14} color={S.ink} />}>
        {cart.length === 0 && <Body size={12.5} color={S.graphite}>No line items yet. They are optional, but the total is built from them.</Body>}
        {cart.map((ci, idx) => (
          <LineBox key={ci.key} index={idx} title={`Line ${idx + 1}`} onRemove={() => removeCartRow(idx)}>
            <Field label="Description">
              <Input value={ci.description} onChangeText={(v) => updateCartField(idx, { description: v })} placeholder="Description" />
            </Field>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Field label="Qty" style={{ flex: 1 }}>
                <Input value={ci.quantity} onChangeText={(v) => updateCartField(idx, { quantity: v.replace(/[^0-9.]/g, "") })} keyboardType="numeric" />
              </Field>
              <Field label="UOM" style={{ flex: 1 }}>
                <Input value={ci.uom} onChangeText={(v) => updateCartField(idx, { uom: v })} />
              </Field>
              <Field label="Rate" style={{ flex: 1 }}>
                <Input value={ci.rate} onChangeText={(v) => updateCartField(idx, { rate: v.replace(/[^0-9.]/g, "") })} keyboardType="numeric" />
              </Field>
            </View>
            <Field label="Amount">
              <Input value={ci.amount} onChangeText={(v) => updateCartField(idx, { amount: v.replace(/[^0-9.]/g, "") })} keyboardType="numeric" />
            </Field>
          </LineBox>
        ))}
        <AddLineKey label="Add line" onPress={addCartRow} />
        {cart.length > 0 && (
          <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", paddingTop: 10, borderTopWidth: 1.5, borderTopColor: S.ink }}>
            <Label color={S.ink}>Total</Label>
            <Body size={18} weight="semibold">{formatINR(totalAmount)}</Body>
          </View>
        )}
      </Panel>
    </FormPage>
  );
}
