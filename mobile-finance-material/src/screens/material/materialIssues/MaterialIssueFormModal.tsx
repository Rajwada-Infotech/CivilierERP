// RN port of Issues.tsx's create/edit form (IssueForm). Core correctness
// piece is the per-line stock cap: a row's usable quantity is the item's
// AvailableStock in the chosen godown minus whatever's already claimed by
// OTHER cart rows on the same item (getStockForRow on web) — kept 1:1.
// Changing the godown resets the cart (web enforces this too, since stock
// figures are godown-scoped). Dropped vs. web: CSV import/export, print.
import { useEffect, useMemo, useState } from "react";
import { View, Text, Modal, Pressable, ScrollView, TextInput, Alert, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { X, PackageMinus, Plus, Trash2 } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import {
  getMaterialIssueById, createMaterialIssue, updateMaterialIssue,
  getCompanies, getProjects, getGodowns, getIssueItemOptions, getUomOptions, getIssuedToOptions,
  fetchFinYearOptions, fetchDocTypes, fetchNextDocNumber,
  type CreateIssuePayload, type IssueLineItem,
} from "@/api/issuesApi";
import { PickerRow, OptionPickerModal, type PickerOption } from "@/screens/finance/payment/OptionPicker";

type CartItem = { key: string; itemId: string; itemName: string; uomCode: string; quantity: string; remarks: string; availableStock: number };

let seq = 0;
const uid = () => `iss-${Date.now()}-${seq++}`;

function blankCartItem(): CartItem {
  return { key: uid(), itemId: "", itemName: "", uomCode: "", quantity: "", remarks: "", availableStock: 0 };
}

type FormState = {
  companyId: string; companyName: string;
  projectId: string; projectName: string;
  finYear: string;
  godownId: string; godownName: string;
  date: string; issuedTo: string; issuedToName: string; costCenter: string;
  reason: string; remarks: string;
};

function todayISO() { return new Date().toISOString().slice(0, 10); }

function blankForm(): FormState {
  return {
    companyId: "", companyName: "", projectId: "", projectName: "", finYear: "",
    godownId: "", godownName: "", date: todayISO(), issuedTo: "", issuedToName: "", costCenter: "",
    reason: "", remarks: "",
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

export function MaterialIssueFormModal({
  visible, editingId, onClose,
}: { visible: boolean; editingId: number | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(blankForm());
  const [cart, setCart] = useState<CartItem[]>([blankCartItem()]);
  const [saving, setSaving] = useState(false);
  const [docTypeId, setDocTypeId] = useState<number | null>(null);
  const [docNo, setDocNo] = useState("");
  const [picker, setPicker] = useState<"company" | "project" | "finYear" | "godown" | "issuedTo" | null>(null);
  const [linePicker, setLinePicker] = useState<{ idx: number; kind: "item" | "uom" } | null>(null);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  useEffect(() => {
    if (!visible) return;
    if (editingId == null) {
      setForm(blankForm());
      setCart([blankCartItem()]);
    }
  }, [visible, editingId]);

  const { data: companies = [] } = useQuery({ queryKey: ["issue-form-companies"], queryFn: getCompanies, enabled: visible });
  const { data: projects = [] } = useQuery({ queryKey: ["issue-form-projects"], queryFn: getProjects, enabled: visible });
  const { data: godowns = [] } = useQuery({ queryKey: ["issue-form-godowns"], queryFn: getGodowns, enabled: visible });
  const { data: uoms = [] } = useQuery({ queryKey: ["issue-form-uoms"], queryFn: getUomOptions, enabled: visible });
  const { data: issuedToOptions = [] } = useQuery({ queryKey: ["issue-form-issued-to"], queryFn: getIssuedToOptions, enabled: visible });
  const { data: finYears = [] } = useQuery({ queryKey: ["issue-form-finyears"], queryFn: fetchFinYearOptions, enabled: visible });
  const { data: itemOptions = [] } = useQuery({
    queryKey: ["issue-form-items", form.godownId],
    queryFn: () => getIssueItemOptions(form.godownId),
    enabled: visible && !!form.godownId,
  });

  const { data: existing, isLoading: loadingExisting } = useQuery({
    queryKey: ["issue-editing-record", editingId],
    queryFn: () => getMaterialIssueById(editingId!),
    enabled: visible && editingId != null,
  });

  useEffect(() => {
    if (!visible || editingId != null) return;
    fetchDocTypes("ISS").then((types) => {
      if (types[0]) {
        setDocTypeId(types[0].TypeOfDocId);
        fetchNextDocNumber(types[0].TypeOfDocId, form.finYear || undefined).then(setDocNo);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, editingId, form.finYear]);

  useEffect(() => {
    if (!visible || editingId == null || !existing) return;
    setForm({
      companyId: existing.CompanyId ? String(existing.CompanyId) : "", companyName: existing.CompanyName || "",
      projectId: existing.ProjectId ? String(existing.ProjectId) : "", projectName: existing.ProjectName || "",
      finYear: existing.FinYearName || "",
      godownId: existing.GodownId ? String(existing.GodownId) : "", godownName: existing.GodownName || "",
      date: existing.Date?.slice(0, 10) || todayISO(), issuedTo: "", issuedToName: existing.IssuedTo || "", costCenter: existing.CostCenter || "",
      reason: existing.Reason || "", remarks: existing.Remarks || "",
    });
    setCart(
      (existing.items ?? []).length
        ? existing.items!.map((it) => ({ key: uid(), itemId: it.ItemId, itemName: it.ItemName || "", uomCode: it.UOMCode, quantity: String(it.Quantity), remarks: it.Remarks || "", availableStock: 0 }))
        : [blankCartItem()],
    );
  }, [visible, editingId, existing]);

  // Auto-select the godown when exactly one matches the chosen company+project.
  useEffect(() => {
    if (!form.companyId || !form.projectId) return;
    const matches = godowns.filter((g) => (!g.companyId || String(g.companyId) === form.companyId) && (!g.projectId || String(g.projectId) === form.projectId));
    if (matches.length === 1 && form.godownId !== String(matches[0].id)) {
      setForm((f) => ({ ...f, godownId: String(matches[0].id), godownName: matches[0].name }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.companyId, form.projectId, godowns]);

  const itemMap = useMemo(() => new Map(itemOptions.map((i) => [i.M_Id, i])), [itemOptions]);

  const handleGodownChange = (id: string, name: string) => {
    setForm((f) => ({ ...f, godownId: id, godownName: name }));
    setCart([blankCartItem()]);
  };

  const pickItem = (idx: number, itemId: string) => {
    const found = itemMap.get(itemId);
    const defaultUom = found?.DefaultUOM || uoms[0]?.UOMCode || "";
    setCart((prev) => prev.map((ci, i) => i === idx ? { ...ci, itemId, itemName: found?.M_Name || "", uomCode: defaultUom, availableStock: found?.AvailableStock ?? 0 } : ci));
    setLinePicker(null);
  };

  const updateCartField = (idx: number, patch: Partial<CartItem>) => setCart((prev) => prev.map((ci, i) => (i === idx ? { ...ci, ...patch } : ci)));
  const addCartRow = () => setCart((p) => [...p, blankCartItem()]);
  const removeCartRow = (idx: number) => setCart((p) => (p.length > 1 ? p.filter((_, i) => i !== idx) : p));

  // Available stock for a row, net of what other rows on the same item already claim.
  const remainingForRow = (idx: number): number | null => {
    const row = cart[idx];
    if (!row.itemId) return null;
    const claimedByOthers = cart.reduce((sum, ci, i) => (i !== idx && ci.itemId === row.itemId ? sum + (Number(ci.quantity) || 0) : sum), 0);
    return row.availableStock - claimedByOthers;
  };

  const validate = (): string | null => {
    if (!form.companyId) return "Company is required.";
    if (!form.projectId) return "Project is required.";
    if (!form.godownId) return "Source godown is required.";
    if (!form.date) return "Date is required.";
    if (!form.reason.trim()) return "Reason is required.";
    if (cart.length === 0) return "Add at least one item.";
    for (let i = 0; i < cart.length; i++) {
      const ci = cart[i];
      if (!ci.itemId || !ci.uomCode || !ci.quantity || Number(ci.quantity) <= 0) return "Each item needs an item, UOM, and a valid quantity.";
      const remaining = remainingForRow(i);
      if (remaining != null && Number(ci.quantity) > remaining) return `${ci.itemName || "An item"} exceeds available stock in ${form.godownName || "the selected godown"}.`;
    }
    return null;
  };

  const handleSave = async () => {
    const error = validate();
    if (error) {
      Alert.alert("Check the form", error);
      return;
    }
    const items: IssueLineItem[] = cart.map((ci) => ({
      ItemId: ci.itemId, ItemName: ci.itemName || itemMap.get(ci.itemId)?.M_Name || undefined,
      UOMCode: ci.uomCode, Quantity: Number(ci.quantity), Remarks: ci.remarks || undefined,
    }));
    const finYearRecord = finYears.find((f) => f.label === form.finYear);
    const payload: CreateIssuePayload = {
      CompanyId: Number(form.companyId) || null, ProjectId: Number(form.projectId) || null, FinYearId: finYearRecord?.id ?? null,
      Date: form.date, Reason: form.reason, Remarks: form.remarks || null, GodownId: Number(form.godownId) || null,
      DocTypeId: docTypeId, IssuedTo: form.issuedToName || null, CostCenter: form.costCenter || null, items,
    };
    setSaving(true);
    try {
      if (editingId != null) {
        await updateMaterialIssue(editingId, payload);
        Alert.alert("Saved", "Material Issue updated.");
      } else {
        await createMaterialIssue(payload);
        Alert.alert("Saved", "Material Issue created and sent for approval.");
      }
      queryClient.invalidateQueries({ queryKey: ["material-issues-mobile"], exact: false });
      onClose();
    } catch (err: any) {
      Alert.alert("Failed to save", err.message ?? "Something went wrong.");
    } finally {
      setSaving(false);
    }
  };

  const companyOptions: PickerOption[] = companies.map((c) => ({ key: c.id, label: c.name }));
  const projectOptions: PickerOption[] = (form.companyId ? projects.filter((p) => p.companyId === form.companyId) : projects).map((p) => ({ key: p.id, label: p.name }));
  const godownOptions: PickerOption[] = godowns
    .filter((g) => (!form.companyId || !g.companyId || String(g.companyId) === form.companyId) && (!form.projectId || !g.projectId || String(g.projectId) === form.projectId))
    .map((g) => ({ key: String(g.id), label: g.name, sublabel: g.code ?? undefined }));
  const finYearOptions: PickerOption[] = finYears.map((f) => ({ key: f.label, label: f.label }));
  const issuedToPickerOptions: PickerOption[] = issuedToOptions.map((o) => ({ key: o.id, label: o.name }));
  const itemPickerOptions: PickerOption[] = itemOptions.map((i) => ({
    key: i.M_Id, label: i.M_Name, sublabel: [i.M_Group, `Stock: ${Number(i.AvailableStock ?? 0).toFixed(2)}`].filter(Boolean).join(" · "),
  }));
  const uomPickerOptions: PickerOption[] = uoms.map((u) => ({ key: u.UOMCode, label: u.UOMName || u.UOMCode }));
  const activeLine = linePicker ? cart[linePicker.idx] : null;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <View style={{ paddingTop: insets.top + 8 }} className="flex-row items-center justify-between px-4 pb-3">
          <View className="flex-row items-center gap-2.5">
            <View className="w-8 h-8 rounded-lg items-center justify-center" style={{ backgroundColor: "#f9731626" }}>
              <PackageMinus size={14} color="#f97316" />
            </View>
            <Text style={{ color: colors.foreground, fontSize: 14, fontFamily: fonts.heading.semibold }}>{editingId ? "Edit Material Issue" : "New Material Issue"}</Text>
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
            <PickerRow label="Project" value={form.projectName} onPress={() => setPicker("project")} disabled={!form.companyId} />
            <PickerRow label="Financial Year" value={form.finYear} placeholder="Auto" onPress={() => setPicker("finYear")} />
            <PickerRow
              label="Source Godown" value={form.godownName} placeholder="Select godown"
              onPress={() => setPicker("godown")} disabled={!form.companyId || !form.projectId}
            />
            {form.godownId && (
              <Text style={{ color: colors.mutedForeground, fontSize: 10, marginTop: -10, marginBottom: 12 }}>
                Changing the godown clears the item list.
              </Text>
            )}

            <FieldLabel required>Date</FieldLabel>
            <TextField value={form.date} onChangeText={(v) => set("date", v)} placeholder="YYYY-MM-DD" />

            <PickerRow label="Issued To" value={form.issuedToName} placeholder="Optional" onPress={() => setPicker("issuedTo")} />
            <FieldLabel>Cost Center / GL Account</FieldLabel>
            <TextField value={form.costCenter} onChangeText={(v) => set("costCenter", v)} placeholder="Optional" />

            <View className="rounded-xl px-3.5 py-3 mb-4" style={{ borderWidth: 1, borderColor: colors.border, borderStyle: "dashed" }}>
              <Text style={{ color: colors.mutedForeground, fontSize: 10, textTransform: "uppercase" }}>Doc Number</Text>
              <Text style={{ color: colors.primary, fontSize: 13, fontFamily: fonts.heading.semibold, marginTop: 2 }}>
                {editingId ? (existing?.DocNo || existing?.IssueNo || "—") : (docNo || "Auto-generated on save")}
              </Text>
            </View>

            <FieldLabel required>Reason for Issue</FieldLabel>
            <TextField value={form.reason} onChangeText={(v) => set("reason", v)} placeholder="Why is this material being issued?" multiline />
            <FieldLabel>Remarks</FieldLabel>
            <TextField value={form.remarks} onChangeText={(v) => set("remarks", v)} placeholder="Optional notes" />

            <Text style={{ color: colors.mutedForeground, fontSize: 10.5, fontFamily: fonts.heading.semibold, textTransform: "uppercase", letterSpacing: 0.6, marginTop: 6, marginBottom: 10 }}>
              Items to Issue ({cart.length})
            </Text>

            {!form.godownId ? (
              <View className="rounded-xl px-3.5 py-4 items-center mb-2" style={{ borderWidth: 1, borderColor: colors.border, borderStyle: "dashed" }}>
                <Text style={{ color: colors.mutedForeground, fontSize: 11.5, textAlign: "center" }}>Select a source godown to add items.</Text>
              </View>
            ) : (
              <>
                {cart.map((ci, idx) => {
                  const remaining = remainingForRow(idx);
                  const qty = Number(ci.quantity) || 0;
                  const overStock = remaining != null && qty > remaining;
                  return (
                    <View key={ci.key} className="rounded-xl p-3 mb-2.5" style={{ borderWidth: 1, borderColor: overStock ? colors.destructive : colors.border, backgroundColor: `${colors.card}80` }}>
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
                            style={{ borderWidth: 1, borderColor: overStock ? colors.destructive : colors.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, color: colors.foreground, fontSize: 12, marginTop: 3 }}
                          />
                        </View>
                      </View>
                      {!!ci.itemId && (
                        <Text style={{ color: overStock ? colors.destructive : colors.mutedForeground, fontSize: 10, marginTop: 6 }}>
                          {overStock ? `Exceeds stock — only ${Math.max(remaining ?? 0, 0).toFixed(2)} ${ci.uomCode} available` : `Available: ${(remaining ?? 0).toFixed(2)} ${ci.uomCode}`}
                        </Text>
                      )}
                    </View>
                  );
                })}
                <Pressable onPress={addCartRow} className="flex-row items-center justify-center gap-1.5 py-2.5 rounded-xl mb-2" style={{ borderWidth: 1, borderColor: colors.border, borderStyle: "dashed" }}>
                  <Plus size={13} color={colors.primary} />
                  <Text style={{ color: colors.primary, fontSize: 12, fontFamily: fonts.heading.medium }}>Add Item</Text>
                </Pressable>
              </>
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
              <Text style={{ color: "#fff", fontSize: 12.5, fontFamily: fonts.heading.semibold }}>{editingId ? "Save Changes" : "Submit Issue"}</Text>
            )}
          </Pressable>
        </View>
      </View>

      <OptionPickerModal visible={picker === "company"} title="Select Company" options={companyOptions} selectedKey={form.companyId}
        onSelect={(k) => { const c = companies.find((x) => x.id === k); setForm((f) => ({ ...f, companyId: k, companyName: c?.name ?? "", projectId: "", projectName: "", godownId: "", godownName: "" })); setCart([blankCartItem()]); setPicker(null); }}
        onClose={() => setPicker(null)} searchable />
      <OptionPickerModal visible={picker === "project"} title="Select Project" options={projectOptions} selectedKey={form.projectId}
        onSelect={(k) => { const p = projects.find((x) => x.id === k); setForm((f) => ({ ...f, projectId: k, projectName: p?.name ?? "", godownId: "", godownName: "" })); setCart([blankCartItem()]); setPicker(null); }}
        onClose={() => setPicker(null)} searchable />
      <OptionPickerModal visible={picker === "finYear"} title="Select Financial Year" options={finYearOptions} selectedKey={form.finYear}
        onSelect={(k) => { set("finYear", k); setPicker(null); }}
        onClose={() => setPicker(null)} clearable />
      <OptionPickerModal visible={picker === "godown"} title="Select Godown" options={godownOptions} selectedKey={form.godownId}
        onSelect={(k) => { const g = godowns.find((x) => String(x.id) === k); handleGodownChange(k, g?.name ?? ""); setPicker(null); }}
        onClose={() => setPicker(null)} searchable />
      <OptionPickerModal visible={picker === "issuedTo"} title="Issued To" options={issuedToPickerOptions} selectedKey={form.issuedTo}
        onSelect={(k) => { const o = issuedToOptions.find((x) => x.id === k); setForm((f) => ({ ...f, issuedTo: k, issuedToName: o?.name ?? "" })); setPicker(null); }}
        onClose={() => setPicker(null)} searchable clearable />

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
