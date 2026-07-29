// RN port of IssueReturn.tsx's create/edit form. A return sources its line
// items from a chosen Approved Material Issue — picking Company/Project/
// Issue Reference cascades down and clears the cart at each step, then the
// Issue's own items get pulled in as the starting cart (create mode only,
// matching web's `!editId` guard). Each row's Return Qty is capped at the
// ORIGINAL issued quantity (`maxQty`) — replicated as-is from web, which
// does not subtract quantity already returned in earlier Return docs.
import { useEffect, useState } from "react";
import { View, Text, Modal, Pressable, ScrollView, TextInput, Alert, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { X, RotateCcw as RotateCcwIcon, Undo2, Trash2 } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import {
  getIssueReturnById, createIssueReturn, updateIssueReturn,
  getCompanies, getProjects, getSourceIssues, getSourceIssueItems,
  type CreateIssueReturnPayload, type IssueReturnLineItem,
} from "@/api/issueReturnApi";
import { PickerRow, OptionPickerModal, type PickerOption } from "@/screens/finance/payment/OptionPicker";

type CartItem = { key: string; origIssueItemId: number | null; itemId: string; itemName: string; quantity: string; uom: string; maxQty: number };

let seq = 0;
const uid = () => `irn-${Date.now()}-${seq++}`;

type FormState = {
  returnDate: string; companyId: string; companyName: string;
  projectId: string; projectName: string; issueId: string; issueDocNo: string;
  reason: string; remarks: string;
};

function todayISO() { return new Date().toISOString().slice(0, 10); }

function blankForm(): FormState {
  return { returnDate: todayISO(), companyId: "", companyName: "", projectId: "", projectName: "", issueId: "", issueDocNo: "", reason: "", remarks: "" };
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

export function IssueReturnFormModal({
  visible, editingId, onClose,
}: { visible: boolean; editingId: number | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(blankForm());
  const [cart, setCart] = useState<CartItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [picker, setPicker] = useState<"company" | "project" | "issue" | null>(null);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  useEffect(() => {
    if (!visible) return;
    if (editingId == null) {
      setForm(blankForm());
      setCart([]);
    }
  }, [visible, editingId]);

  const { data: companies = [] } = useQuery({ queryKey: ["irn-form-companies"], queryFn: getCompanies, enabled: visible });
  const { data: projects = [] } = useQuery({ queryKey: ["irn-form-projects"], queryFn: getProjects, enabled: visible });
  const { data: sourceIssues = [] } = useQuery({
    queryKey: ["irn-form-issues", form.companyId, form.projectId],
    queryFn: () => getSourceIssues(form.companyId || undefined, form.projectId || undefined),
    enabled: visible,
  });

  const { data: existing, isLoading: loadingExisting } = useQuery({
    queryKey: ["irn-editing-record", editingId],
    queryFn: () => getIssueReturnById(editingId!),
    enabled: visible && editingId != null,
  });

  useEffect(() => {
    if (!visible || editingId == null || !existing) return;
    setForm({
      returnDate: existing.ReturnDate?.slice(0, 10) || todayISO(),
      companyId: existing.CompanyId ? String(existing.CompanyId) : "", companyName: existing.CompanyName || "",
      projectId: existing.ProjectId ? String(existing.ProjectId) : "", projectName: existing.ProjectName || "",
      issueId: existing.IssueId ? String(existing.IssueId) : "", issueDocNo: existing.IssueDocNo || "",
      reason: existing.Reason || "", remarks: existing.Remarks || "",
    });
    setCart(
      (existing.items ?? []).map((it) => ({
        key: uid(), origIssueItemId: it.origIssueItemId, itemId: it.M_Id, itemName: it.ItemName,
        quantity: String(it.Quantity), uom: it.UOMSymbol, maxQty: it.maxQty ?? it.Quantity,
      })),
    );
  }, [visible, editingId, existing]);

  const loadItemsFromIssue = async (issueId: string) => {
    if (!issueId) return;
    try {
      const items = await getSourceIssueItems(issueId);
      setCart(items.map((it) => ({
        key: uid(), origIssueItemId: it.origIssueItemId, itemId: it.M_Id, itemName: it.ItemName,
        quantity: String(it.Quantity), uom: it.UOMSymbol, maxQty: it.maxQty ?? it.Quantity,
      })));
    } catch (err: any) {
      Alert.alert("Failed to load items", err.message ?? "Something went wrong.");
    }
  };

  // Auto-pull the issue's items into the cart once, when creating a new return.
  useEffect(() => {
    if (editingId != null || !form.issueId) return;
    loadItemsFromIssue(form.issueId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.issueId, editingId]);

  const updateCartQty = (idx: number, quantity: string) => setCart((prev) => prev.map((ci, i) => (i === idx ? { ...ci, quantity } : ci)));
  const removeCartRow = (idx: number) => setCart((prev) => prev.filter((_, i) => i !== idx));

  const validate = (): string | null => {
    if (!form.returnDate) return "Return date is required.";
    if (cart.length === 0) return "Add at least one item.";
    const overMax = cart.find((ci) => Number(ci.quantity) > ci.maxQty);
    if (overMax) return `Return qty for "${overMax.itemName}" exceeds issued quantity.`;
    if (!cart.some((ci) => Number(ci.quantity) > 0)) return "All items have zero quantity.";
    return null;
  };

  const handleSave = async () => {
    const error = validate();
    if (error) {
      Alert.alert("Check the form", error);
      return;
    }
    const items: IssueReturnLineItem[] = cart
      .filter((ci) => Number(ci.quantity) > 0)
      .map((ci) => ({ origIssueItemId: ci.origIssueItemId, M_Id: ci.itemId, ItemName: ci.itemName, Quantity: Number(ci.quantity), UOMSymbol: ci.uom }));
    const payload: CreateIssueReturnPayload = {
      ReturnDate: form.returnDate, IssueId: form.issueId, CompanyId: form.companyId, ProjectId: form.projectId,
      Reason: form.reason, Remarks: form.remarks, items,
    };
    setSaving(true);
    try {
      if (editingId != null) {
        await updateIssueReturn(editingId, payload);
        Alert.alert("Saved", "Issue Return updated.");
      } else {
        await createIssueReturn(payload);
        Alert.alert("Saved", "Issue Return created as Draft.");
      }
      queryClient.invalidateQueries({ queryKey: ["issue-returns-mobile"], exact: false });
      onClose();
    } catch (err: any) {
      Alert.alert("Failed to save", err.message ?? "Something went wrong.");
    } finally {
      setSaving(false);
    }
  };

  const companyOptions: PickerOption[] = companies.map((c) => ({ key: c.id, label: c.name }));
  const projectOptions: PickerOption[] = (form.companyId ? projects.filter((p) => p.companyId === form.companyId) : projects).map((p) => ({ key: p.id, label: p.name }));
  const issueOptions: PickerOption[] = sourceIssues.map((i) => ({ key: String(i.IssueId), label: i.DocNo, sublabel: i.IssueDate?.slice(0, 10) }));

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <View style={{ paddingTop: insets.top + 8 }} className="flex-row items-center justify-between px-4 pb-3">
          <View className="flex-row items-center gap-2.5">
            <View className="w-8 h-8 rounded-lg items-center justify-center" style={{ backgroundColor: "#0ea5e926" }}>
              <Undo2 size={14} color="#0ea5e9" />
            </View>
            <Text style={{ color: colors.foreground, fontSize: 14, fontFamily: fonts.heading.semibold }}>{editingId ? "Edit Issue Return" : "New Issue Return"}</Text>
          </View>
          <Pressable onPress={onClose} className="w-8 h-8 rounded-lg items-center justify-center" style={{ borderWidth: 1, borderColor: colors.border }}>
            <X size={15} color={colors.mutedForeground} />
          </Pressable>
        </View>

        {loadingExisting ? (
          <View className="flex-1 items-center justify-center"><ActivityIndicator color={colors.mutedForeground} /></View>
        ) : (
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 16 }} keyboardShouldPersistTaps="handled">
            <FieldLabel required>Return Date</FieldLabel>
            <TextField value={form.returnDate} onChangeText={(v) => set("returnDate", v)} placeholder="YYYY-MM-DD" />

            <PickerRow label="Company" value={form.companyName} onPress={() => setPicker("company")} />
            <PickerRow label="Project" value={form.projectName} onPress={() => setPicker("project")} />
            <PickerRow label="Issue Reference" value={form.issueDocNo} placeholder="Select an approved issue" onPress={() => setPicker("issue")} />

            <FieldLabel>Reason</FieldLabel>
            <TextField value={form.reason} onChangeText={(v) => set("reason", v)} placeholder="Why is this being returned?" />
            <FieldLabel>Remarks</FieldLabel>
            <TextField value={form.remarks} onChangeText={(v) => set("remarks", v)} placeholder="Optional notes" />

            <View className="flex-row items-center justify-between mb-2.5">
              <Text style={{ color: colors.mutedForeground, fontSize: 10.5, fontFamily: fonts.heading.semibold, textTransform: "uppercase", letterSpacing: 0.6 }}>
                Return Items ({cart.length})
              </Text>
              {!!form.issueId && (
                <Pressable onPress={() => loadItemsFromIssue(form.issueId)} className="flex-row items-center gap-1 px-2.5 py-1.5 rounded-lg" style={{ borderWidth: 1, borderColor: colors.border }}>
                  <RotateCcwIcon size={11} color={colors.mutedForeground} />
                  <Text style={{ color: colors.mutedForeground, fontSize: 10.5, fontFamily: fonts.heading.medium }}>Load from Issue</Text>
                </Pressable>
              )}
            </View>

            {cart.length === 0 ? (
              <View className="rounded-xl px-3.5 py-4 items-center mb-2" style={{ borderWidth: 1, borderColor: colors.border, borderStyle: "dashed" }}>
                <Text style={{ color: colors.mutedForeground, fontSize: 11.5, textAlign: "center" }}>
                  {form.issueId ? "No items on this issue." : "Select an issue reference first."}
                </Text>
              </View>
            ) : (
              cart.map((ci, idx) => {
                const qty = Number(ci.quantity) || 0;
                const overMax = qty > ci.maxQty;
                return (
                  <View key={ci.key} className="rounded-xl p-3 mb-2.5" style={{ borderWidth: 1, borderColor: overMax ? colors.destructive : colors.border, backgroundColor: `${colors.card}80` }}>
                    <View className="flex-row items-center justify-between mb-2">
                      <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 12.5, fontFamily: fonts.body.medium, flex: 1, marginRight: 8 }}>{ci.itemName}</Text>
                      <Pressable onPress={() => removeCartRow(idx)} className="p-1">
                        <Trash2 size={14} color={colors.destructive} />
                      </Pressable>
                    </View>
                    <View className="flex-row gap-2">
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: colors.mutedForeground, fontSize: 9, textTransform: "uppercase" }}>Issued Qty</Text>
                        <Text style={{ color: colors.mutedForeground, fontSize: 12, marginTop: 6 }}>{ci.maxQty} {ci.uom}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: colors.mutedForeground, fontSize: 9, textTransform: "uppercase" }}>Return Qty</Text>
                        <TextInput
                          value={ci.quantity}
                          onChangeText={(v) => updateCartQty(idx, v.replace(/[^0-9.]/g, ""))}
                          keyboardType="numeric"
                          style={{ borderWidth: 1, borderColor: overMax ? colors.destructive : colors.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, color: colors.foreground, fontSize: 12, marginTop: 3 }}
                        />
                      </View>
                    </View>
                    {overMax && <Text style={{ color: colors.destructive, fontSize: 10, marginTop: 6 }}>Exceeds issued quantity ({ci.maxQty} {ci.uom})</Text>}
                  </View>
                );
              })
            )}
          </ScrollView>
        )}

        <View className="flex-row gap-2.5 px-4" style={{ paddingBottom: insets.bottom + 14, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border }}>
          <Pressable onPress={onClose} className="px-5 py-3 rounded-xl items-center justify-center" style={{ borderWidth: 1, borderColor: colors.border }}>
            <Text style={{ color: colors.mutedForeground, fontSize: 12.5, fontFamily: fonts.heading.medium }}>Cancel</Text>
          </Pressable>
          <Pressable
            onPress={handleSave} disabled={saving}
            className="flex-1 items-center justify-center py-3 rounded-xl"
            style={{ backgroundColor: colors.primary, opacity: saving ? 0.7 : 1 }}
          >
            {saving ? <ActivityIndicator size="small" color="#fff" /> : (
              <Text style={{ color: "#fff", fontSize: 12.5, fontFamily: fonts.heading.semibold }}>{editingId ? "Save Changes" : "Save as Draft"}</Text>
            )}
          </Pressable>
        </View>
      </View>

      <OptionPickerModal visible={picker === "company"} title="Select Company" options={companyOptions} selectedKey={form.companyId}
        onSelect={(k) => { const c = companies.find((x) => x.id === k); setForm((f) => ({ ...f, companyId: k, companyName: c?.name ?? "", projectId: "", projectName: "", issueId: "", issueDocNo: "" })); setCart([]); setPicker(null); }}
        onClose={() => setPicker(null)} searchable clearable />
      <OptionPickerModal visible={picker === "project"} title="Select Project" options={projectOptions} selectedKey={form.projectId}
        onSelect={(k) => { const p = projects.find((x) => x.id === k); setForm((f) => ({ ...f, projectId: k, projectName: p?.name ?? "", issueId: "", issueDocNo: "" })); setCart([]); setPicker(null); }}
        onClose={() => setPicker(null)} searchable clearable />
      <OptionPickerModal visible={picker === "issue"} title="Select Issue Reference" options={issueOptions} selectedKey={form.issueId}
        onSelect={(k) => { const i = sourceIssues.find((x) => String(x.IssueId) === k); setForm((f) => ({ ...f, issueId: k, issueDocNo: i?.DocNo ?? "" })); setPicker(null); }}
        onClose={() => setPicker(null)} searchable clearable />
    </Modal>
  );
}
