// RN port of MaterialRequest.tsx's create/edit form. Scope trim vs. web:
// the UOM item-alternates live cross-unit conversion display is dropped
// for a plain UOM picker (any active UOM, no category filtering) — the
// most complex part of the web form and not needed for correctness, since
// quantity/UOM are stored as entered either way.
import { useEffect, useMemo, useState } from "react";
import { View, Text, Modal, Pressable, ScrollView, TextInput, Alert, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { X, ClipboardList, Plus, Trash2 } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import {
  getMaterialRequestById, createMaterialRequest, updateMaterialRequest,
  getMRCompanies, getMRProjects, getMRFinYears, getMRItemOptions, getMRUomOptions, previewNextMRNumber, fetchDocTypes,
  PRIORITY_OPTIONS, PRIORITY_COLOR,
  type CreateMRPayload, type MRLineItem,
} from "@/api/materialRequestApi";
import { PickerRow, OptionPickerModal, type PickerOption } from "@/screens/finance/payment/OptionPicker";

type CartItem = { key: string; itemId: string; itemName: string; uomCode: string; quantity: string; remarks: string };

let seq = 0;
const uid = () => `mr-${Date.now()}-${seq++}`;

function blankCartItem(): CartItem {
  return { key: uid(), itemId: "", itemName: "", uomCode: "", quantity: "", remarks: "" };
}

type FormState = {
  companyId: string; companyName: string;
  projectId: string; projectName: string;
  finYearId: string; finYearName: string;
  requestDate: string; requiredByDate: string;
  priority: string; reason: string; remarks: string;
};

function todayISO() { return new Date().toISOString().slice(0, 10); }

function blankForm(): FormState {
  return {
    companyId: "", companyName: "", projectId: "", projectName: "", finYearId: "", finYearName: "",
    requestDate: todayISO(), requiredByDate: "", priority: "Normal", reason: "", remarks: "",
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

export function MaterialRequestFormModal({
  visible, editingId, onClose,
}: { visible: boolean; editingId: number | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(blankForm());
  const [cart, setCart] = useState<CartItem[]>([blankCartItem()]);
  const [saving, setSaving] = useState(false);
  const [docTypeId, setDocTypeId] = useState<number | null>(null);
  const [picker, setPicker] = useState<"company" | "project" | "finYear" | null>(null);
  const [linePicker, setLinePicker] = useState<{ idx: number; kind: "item" | "uom" } | null>(null);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  useEffect(() => {
    if (!visible) return;
    if (editingId == null) {
      setForm(blankForm());
      setCart([blankCartItem()]);
    }
  }, [visible, editingId]);

  const { data: companies = [] } = useQuery({ queryKey: ["mr-form-companies"], queryFn: getMRCompanies, enabled: visible });
  const { data: projects = [] } = useQuery({ queryKey: ["mr-form-projects"], queryFn: getMRProjects, enabled: visible });
  const { data: finYears = [] } = useQuery({ queryKey: ["mr-form-finyears"], queryFn: getMRFinYears, enabled: visible });
  const { data: itemOptions = [] } = useQuery({ queryKey: ["mr-form-items", form.projectId], queryFn: () => getMRItemOptions(form.projectId || null), enabled: visible });
  const { data: uoms = [] } = useQuery({ queryKey: ["mr-form-uoms"], queryFn: getMRUomOptions, enabled: visible });

  const { data: existing, isLoading: loadingExisting } = useQuery({
    queryKey: ["mr-editing-record", editingId],
    queryFn: () => getMaterialRequestById(editingId!),
    enabled: visible && editingId != null,
  });

  const { data: docNoPreview } = useQuery({
    queryKey: ["mr-next-docno"],
    queryFn: previewNextMRNumber,
    enabled: visible && editingId == null,
  });

  useEffect(() => {
    if (!visible || editingId != null) return;
    fetchDocTypes("MR").then((types) => { if (types[0]) setDocTypeId(types[0].TypeOfDocId); });
  }, [visible, editingId]);

  useEffect(() => {
    if (!visible || editingId == null || !existing) return;
    setForm({
      companyId: existing.CompanyId ? String(existing.CompanyId) : "", companyName: existing.CompanyName || "",
      projectId: existing.ProjectId ? String(existing.ProjectId) : "", projectName: existing.ProjectName || "",
      finYearId: existing.FinYearId ? String(existing.FinYearId) : "", finYearName: existing.FinYearName || "",
      requestDate: existing.RequestDate?.slice(0, 10) || todayISO(), requiredByDate: existing.RequiredByDate?.slice(0, 10) || "",
      priority: existing.Priority || "Normal", reason: existing.Reason || "", remarks: existing.Remarks || "",
    });
    setCart(
      (existing.items ?? []).length
        ? existing.items!.map((it) => ({ key: uid(), itemId: it.ItemId, itemName: it.ItemName || "", uomCode: it.UOMCode, quantity: String(it.Quantity), remarks: it.Remarks || "" }))
        : [blankCartItem()],
    );
  }, [visible, editingId, existing]);

  const itemMap = useMemo(() => new Map(itemOptions.map((i) => [i.M_Id, i])), [itemOptions]);

  const pickItem = (idx: number, itemId: string) => {
    const found = itemMap.get(itemId);
    const defaultUom = found?.DefaultUOM || uoms[0]?.UOMCode || "";
    setCart((prev) => prev.map((ci, i) => i === idx ? { ...ci, itemId, itemName: found?.M_Name || "", uomCode: defaultUom } : ci));
    setLinePicker(null);
  };

  const updateCartField = (idx: number, patch: Partial<CartItem>) => setCart((prev) => prev.map((ci, i) => (i === idx ? { ...ci, ...patch } : ci)));
  const addCartRow = () => setCart((p) => [...p, blankCartItem()]);
  const removeCartRow = (idx: number) => setCart((p) => (p.length > 1 ? p.filter((_, i) => i !== idx) : p));

  const validate = (): string | null => {
    if (!form.companyId) return "Company is required.";
    if (!form.projectId) return "Project is required.";
    if (!form.requestDate) return "Request date is required.";
    if (!form.reason.trim()) return "Reason is required.";
    if (cart.length === 0 || cart.some((ci) => !ci.itemId || !ci.uomCode || !ci.quantity || Number(ci.quantity) <= 0)) {
      return "Each item needs an item, UOM, and a valid quantity.";
    }
    return null;
  };

  const handleSave = async () => {
    const error = validate();
    if (error) {
      Alert.alert("Check the form", error);
      return;
    }
    const items: MRLineItem[] = cart.map((ci) => ({
      ItemId: ci.itemId, ItemName: ci.itemName || itemMap.get(ci.itemId)?.M_Name || undefined,
      UOMCode: ci.uomCode, Quantity: Number(ci.quantity), Remarks: ci.remarks || undefined,
    }));
    const payload: CreateMRPayload = {
      CompanyId: Number(form.companyId) || null, ProjectId: Number(form.projectId) || null, FinYearId: Number(form.finYearId) || null,
      RequestDate: form.requestDate, RequiredByDate: form.requiredByDate || null, Priority: form.priority,
      Reason: form.reason, Remarks: form.remarks || null, DocTypeId: docTypeId, items,
    };
    setSaving(true);
    try {
      if (editingId != null) {
        await updateMaterialRequest(editingId, payload);
        Alert.alert("Saved", "Material Request updated.");
      } else {
        await createMaterialRequest(payload);
        Alert.alert("Saved", "Material Request created and sent for approval.");
      }
      queryClient.invalidateQueries({ queryKey: ["material-requests-mobile"], exact: false });
      onClose();
    } catch (err: any) {
      Alert.alert("Failed to save", err.message ?? "Something went wrong.");
    } finally {
      setSaving(false);
    }
  };

  const companyOptions: PickerOption[] = companies.map((c) => ({ key: String(c.id), label: c.name }));
  const projectOptions: PickerOption[] = projects.map((p) => ({ key: String(p.id), label: p.name }));
  const finYearOptions: PickerOption[] = finYears.map((f) => ({ key: String(f.id), label: f.name }));
  const itemPickerOptions: PickerOption[] = itemOptions.map((i) => ({
    key: i.M_Id, label: i.M_Name, sublabel: [i.M_Group, i.AvailableStock != null ? `Stock: ${Number(i.AvailableStock).toFixed(2)}` : null].filter(Boolean).join(" · "),
  }));
  const uomPickerOptions: PickerOption[] = uoms.map((u) => ({ key: u.UOMCode, label: u.UOMName || u.UOMCode }));
  const activeLine = linePicker ? cart[linePicker.idx] : null;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <View style={{ paddingTop: insets.top + 8 }} className="flex-row items-center justify-between px-4 pb-3">
          <View className="flex-row items-center gap-2.5">
            <View className="w-8 h-8 rounded-lg items-center justify-center" style={{ backgroundColor: "#10b98126" }}>
              <ClipboardList size={14} color="#10b981" />
            </View>
            <Text style={{ color: colors.foreground, fontSize: 14, fontFamily: fonts.heading.semibold }}>{editingId ? "Edit Material Request" : "New Material Request"}</Text>
          </View>
          <Pressable onPress={onClose} className="w-8 h-8 rounded-lg items-center justify-center" style={{ borderWidth: 1, borderColor: colors.border }}>
            <X size={15} color={colors.mutedForeground} />
          </Pressable>
        </View>

        {loadingExisting ? (
          <View className="flex-1 items-center justify-center"><ActivityIndicator color={colors.mutedForeground} /></View>
        ) : (
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 16 }} keyboardShouldPersistTaps="handled">
            <PickerRow label="Company" value={form.companyName} onPress={() => setPicker("company")} />
            <PickerRow label="Project" value={form.projectName} onPress={() => setPicker("project")} />
            <PickerRow label="Financial Year" value={form.finYearName} placeholder="Auto" onPress={() => setPicker("finYear")} />

            <FieldLabel required>Priority</FieldLabel>
            <View className="flex-row flex-wrap gap-2 mb-4">
              {PRIORITY_OPTIONS.map((p) => {
                const active = form.priority === p;
                const color = PRIORITY_COLOR[p];
                return (
                  <Pressable key={p} onPress={() => set("priority", p)} className="px-3 py-1.5 rounded-full" style={{ borderWidth: 1, borderColor: active ? color : colors.border, backgroundColor: active ? `${color}1a` : "transparent" }}>
                    <Text style={{ color: active ? color : colors.mutedForeground, fontSize: 11.5, fontFamily: fonts.heading.medium }}>{p}</Text>
                  </Pressable>
                );
              })}
            </View>

            <FieldLabel required>Request Date</FieldLabel>
            <TextField value={form.requestDate} onChangeText={(v) => set("requestDate", v)} placeholder="YYYY-MM-DD" />
            <FieldLabel>Required By Date</FieldLabel>
            <TextField value={form.requiredByDate} onChangeText={(v) => set("requiredByDate", v)} placeholder="YYYY-MM-DD" />

            <View className="rounded-xl px-3.5 py-3 mb-4" style={{ borderWidth: 1, borderColor: colors.border, borderStyle: "dashed" }}>
              <Text style={{ color: colors.mutedForeground, fontSize: 10, textTransform: "uppercase" }}>Doc Number</Text>
              <Text style={{ color: colors.primary, fontSize: 13, fontFamily: fonts.heading.semibold, marginTop: 2 }}>
                {editingId ? (existing?.DocNo || "—") : (docNoPreview?.nextDocNo || "Auto-generated on save")}
              </Text>
            </View>

            <FieldLabel required>Reason</FieldLabel>
            <TextField value={form.reason} onChangeText={(v) => set("reason", v)} placeholder="Why is this material needed?" multiline />
            <FieldLabel>Remarks</FieldLabel>
            <TextField value={form.remarks} onChangeText={(v) => set("remarks", v)} placeholder="Optional notes" />

            <Text style={{ color: colors.mutedForeground, fontSize: 10.5, fontFamily: fonts.heading.semibold, textTransform: "uppercase", letterSpacing: 0.6, marginTop: 6, marginBottom: 10 }}>
              Requested Items ({cart.length})
            </Text>
            {cart.map((ci, idx) => (
              <View key={ci.key} className="rounded-xl p-3 mb-2.5" style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: `${colors.card}80` }}>
                <View className="flex-row items-center justify-between mb-2">
                  <Pressable onPress={() => setLinePicker({ idx, kind: "item" })} style={{ flex: 1, marginRight: 8 }}>
                    <Text numberOfLines={1} style={{ color: ci.itemName ? colors.foreground : colors.mutedForeground, fontSize: 12.5, fontFamily: fonts.body.medium }}>
                      {ci.itemName || "— Select Item —"}
                    </Text>
                  </Pressable>
                  {cart.length > 1 && (
                    <Pressable onPress={() => removeCartRow(idx)} className="p-1">
                      <Trash2 size={14} color={colors.destructive} />
                    </Pressable>
                  )}
                </View>
                <View className="flex-row gap-2">
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.mutedForeground, fontSize: 9, textTransform: "uppercase" }}>UOM</Text>
                    <Pressable onPress={() => setLinePicker({ idx, kind: "uom" })} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, marginTop: 3 }}>
                      <Text numberOfLines={1} style={{ color: ci.uomCode ? colors.foreground : colors.mutedForeground, fontSize: 12 }}>{ci.uomCode || "—"}</Text>
                    </Pressable>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.mutedForeground, fontSize: 9, textTransform: "uppercase" }}>Quantity</Text>
                    <TextInput
                      value={ci.quantity}
                      onChangeText={(v) => updateCartField(idx, { quantity: v.replace(/[^0-9.]/g, "") })}
                      keyboardType="numeric"
                      style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, color: colors.foreground, fontSize: 12, marginTop: 3 }}
                    />
                  </View>
                </View>
              </View>
            ))}
            <Pressable onPress={addCartRow} className="flex-row items-center justify-center gap-1.5 py-2.5 rounded-xl mb-2" style={{ borderWidth: 1, borderColor: colors.border, borderStyle: "dashed" }}>
              <Plus size={13} color={colors.primary} />
              <Text style={{ color: colors.primary, fontSize: 12, fontFamily: fonts.heading.medium }}>Add Item</Text>
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
            style={{ backgroundColor: colors.primary, opacity: saving ? 0.7 : 1 }}
          >
            {saving ? <ActivityIndicator size="small" color="#fff" /> : (
              <Text style={{ color: "#fff", fontSize: 12.5, fontFamily: fonts.heading.semibold }}>{editingId ? "Save Changes" : "Submit Request"}</Text>
            )}
          </Pressable>
        </View>
      </View>

      <OptionPickerModal visible={picker === "company"} title="Select Company" options={companyOptions} selectedKey={form.companyId}
        onSelect={(k) => { const c = companies.find((x) => String(x.id) === k); setForm((f) => ({ ...f, companyId: k, companyName: c?.name ?? "", projectId: "", projectName: "" })); setPicker(null); }}
        onClose={() => setPicker(null)} searchable />
      <OptionPickerModal visible={picker === "project"} title="Select Project" options={projectOptions} selectedKey={form.projectId}
        onSelect={(k) => { const p = projects.find((x) => String(x.id) === k); setForm((f) => ({ ...f, projectId: k, projectName: p?.name ?? "" })); setPicker(null); }}
        onClose={() => setPicker(null)} searchable />
      <OptionPickerModal visible={picker === "finYear"} title="Select Financial Year" options={finYearOptions} selectedKey={form.finYearId}
        onSelect={(k) => { const f = finYears.find((x) => String(x.id) === k); setForm((s) => ({ ...s, finYearId: k, finYearName: f?.name ?? "" })); setPicker(null); }}
        onClose={() => setPicker(null)} clearable />

      <OptionPickerModal
        visible={linePicker?.kind === "item"} title="Select Item" options={itemPickerOptions}
        selectedKey={activeLine?.itemId ?? ""} onSelect={(k) => linePicker && pickItem(linePicker.idx, k)}
        onClose={() => setLinePicker(null)} searchable
      />
      <OptionPickerModal
        visible={linePicker?.kind === "uom"} title="Select UOM" options={uomPickerOptions}
        selectedKey={activeLine?.uomCode ?? ""} onSelect={(k) => { if (linePicker) updateCartField(linePicker.idx, { uomCode: k }); setLinePicker(null); }}
        onClose={() => setLinePicker(null)} searchable
      />
    </Modal>
  );
}
