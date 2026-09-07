// RN port of StockTransfer.tsx's "New Transfer" tab — Intra-Company mode
// only (see stockTransferApi.ts header comment: Inter-Company/"Dummy Bank"
// mode is a wholly separate cross-company commercial-document-chain
// feature, out of scope). Create-only, no edit — a transfer executes
// immediately on submit (stock ledger OUT+IN posted atomically server-
// side), there's no Draft state to come back and edit.
//
// One deliberate improvement over web: web caps each cart row's qty
// against its own availableQty snapshot independently, with no netting
// against OTHER rows on the same item (so two rows under the limit
// individually could together overrequest — the backend catches this on
// submit, but the web UI doesn't warn beforehand). This port nets other
// rows the same way Material Issues' getStockForRow does, since it's a
// straightforward correctness improvement with the same data already in
// hand.
import { useEffect, useMemo, useState } from "react";
import { View, Text, Modal, Pressable, ScrollView, TextInput, Alert, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { X, Repeat, Plus, Trash2, ArrowRight } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { getGodowns, getCompanies, getProjects, getInventoryMaster } from "@/api/stockApi";
import { createStockTransfer, type CreateTransferPayload, type TransferItem } from "@/api/stockTransferApi";
import { PickerRow, OptionPickerModal, type PickerOption } from "@/screens/finance/payment/OptionPicker";

type CartItem = { key: string; itemId: string; itemName: string; uom: string; quantity: string; availableStock: number };

let seq = 0;
const uid = () => `trf-${Date.now()}-${seq++}`;

function blankCartItem(): CartItem {
  return { key: uid(), itemId: "", itemName: "", uom: "", quantity: "", availableStock: 0 };
}

function todayISO() { return new Date().toISOString().slice(0, 10); }

type FormState = {
  companyId: string; projectId: string;
  fromGodownId: string; fromGodownName: string;
  toGodownId: string; toGodownName: string;
  transferDate: string; remarks: string;
};

function blankForm(): FormState {
  return { companyId: "", projectId: "", fromGodownId: "", fromGodownName: "", toGodownId: "", toGodownName: "", transferDate: todayISO(), remarks: "" };
}

function FieldLabel({ children, required }: { children: string; required?: boolean }) {
  return (
    <Text style={{ color: colors.mutedForeground, fontSize: 10, fontFamily: fonts.body.medium, marginBottom: 5, textTransform: "uppercase", letterSpacing: 0.4 }}>
      {children}{required ? " *" : ""}
    </Text>
  );
}

export function StockTransferFormModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(blankForm());
  const [cart, setCart] = useState<CartItem[]>([blankCartItem()]);
  const [saving, setSaving] = useState(false);
  const [picker, setPicker] = useState<"company" | "project" | "fromGodown" | "toGodown" | null>(null);
  const [linePicker, setLinePicker] = useState<number | null>(null);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  useEffect(() => {
    if (!visible) return;
    setForm(blankForm());
    setCart([blankCartItem()]);
  }, [visible]);

  const { data: companies = [] } = useQuery({ queryKey: ["trf-form-companies"], queryFn: getCompanies, enabled: visible });
  const { data: projects = [] } = useQuery({ queryKey: ["trf-form-projects"], queryFn: getProjects, enabled: visible });
  const { data: godowns = [] } = useQuery({ queryKey: ["trf-form-godowns"], queryFn: getGodowns, enabled: visible });

  const { data: inventory, isFetching: loadingItems } = useQuery({
    queryKey: ["trf-form-items", form.fromGodownId],
    queryFn: () => getInventoryMaster(todayISO(), Number(form.fromGodownId)),
    enabled: visible && !!form.fromGodownId,
  });

  const availableItems = useMemo(
    () => (inventory?.data ?? []).filter((r) => r.ClosingStock > 0).map((r) => ({
      itemId: r.ItemID, itemName: r.ItemName || r.ItemID, uom: r.UOMSymbol || r.UOMName || r.UOMCode || "", available: r.ClosingStock,
    })),
    [inventory],
  );
  const itemMap = useMemo(() => new Map(availableItems.map((i) => [i.itemId, i])), [availableItems]);

  // Auto-select the project's own godown when both company+project narrow to a single match.
  useEffect(() => {
    if (!form.companyId || !form.projectId) return;
    const matches = godowns.filter((g) => (!g.companyId || String(g.companyId) === form.companyId) && (!g.projectId || String(g.projectId) === form.projectId));
    if (matches.length === 1 && form.fromGodownId !== String(matches[0].id)) {
      setForm((f) => ({ ...f, fromGodownId: String(matches[0].id), fromGodownName: matches[0].name }));
      setCart([blankCartItem()]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.companyId, form.projectId, godowns]);

  const handleFromGodownChange = (id: string, name: string) => {
    setForm((f) => ({ ...f, fromGodownId: id, fromGodownName: name, toGodownId: f.toGodownId === id ? "" : f.toGodownId, toGodownName: f.toGodownId === id ? "" : f.toGodownName }));
    setCart([blankCartItem()]);
  };

  const pickItem = (idx: number, itemId: string) => {
    const found = itemMap.get(itemId);
    setCart((prev) => prev.map((ci, i) => i === idx ? { ...ci, itemId, itemName: found?.itemName || "", uom: found?.uom || "", availableStock: found?.available ?? 0 } : ci));
    setLinePicker(null);
  };

  const updateQty = (idx: number, quantity: string) => setCart((prev) => prev.map((ci, i) => (i === idx ? { ...ci, quantity } : ci)));
  const addCartRow = () => setCart((p) => [...p, blankCartItem()]);
  const removeCartRow = (idx: number) => setCart((p) => (p.length > 1 ? p.filter((_, i) => i !== idx) : p));

  const remainingForRow = (idx: number): number | null => {
    const row = cart[idx];
    if (!row.itemId) return null;
    const claimedByOthers = cart.reduce((sum, ci, i) => (i !== idx && ci.itemId === row.itemId ? sum + (Number(ci.quantity) || 0) : sum), 0);
    return row.availableStock - claimedByOthers;
  };

  const sameGodown = !!form.fromGodownId && form.fromGodownId === form.toGodownId;

  const validate = (): string | null => {
    if (!form.fromGodownId) return "Source godown is required.";
    if (!form.toGodownId) return "Destination godown is required.";
    if (sameGodown) return "Source and destination godowns must be different.";
    if (cart.every((ci) => !ci.itemId || !(Number(ci.quantity) > 0))) return "Add at least one item with a quantity.";
    for (let i = 0; i < cart.length; i++) {
      const ci = cart[i];
      if (!ci.itemId) continue;
      const qty = Number(ci.quantity) || 0;
      if (qty <= 0) continue;
      const remaining = remainingForRow(i);
      if (remaining != null && qty > remaining) return `${ci.itemName || "An item"} exceeds available stock (${Math.max(remaining, 0).toFixed(2)} ${ci.uom} left).`;
    }
    return null;
  };

  const handleTransfer = async () => {
    const error = validate();
    if (error) {
      Alert.alert("Check the form", error);
      return;
    }
    const items: TransferItem[] = cart
      .filter((ci) => ci.itemId && Number(ci.quantity) > 0)
      .map((ci) => ({ itemId: ci.itemId, itemName: ci.itemName, qty: Number(ci.quantity), uom: ci.uom }));
    const payload: CreateTransferPayload = {
      FromGodownID: Number(form.fromGodownId), ToGodownID: Number(form.toGodownId),
      TransferItems: items, Remarks: form.remarks || undefined, TransferDate: form.transferDate,
    };
    setSaving(true);
    try {
      const result = await createStockTransfer(payload);
      Alert.alert("Transfer complete", `${result.DocNo} moved ${items.length} item${items.length === 1 ? "" : "s"} to ${form.toGodownName}.`);
      queryClient.invalidateQueries({ queryKey: ["stock-transfers-mobile"], exact: false });
      queryClient.invalidateQueries({ queryKey: ["inventory-master"], exact: false });
      queryClient.invalidateQueries({ queryKey: ["stock-ledger"], exact: false });
      onClose();
    } catch (err: any) {
      Alert.alert("Transfer failed", err.message ?? "Something went wrong.");
    } finally {
      setSaving(false);
    }
  };

  const companyOptions: PickerOption[] = companies.map((c) => ({ key: c.id, label: c.name }));
  const projectOptions: PickerOption[] = projects.map((p) => ({ key: p.id, label: p.name }));
  const fromGodownOptions: PickerOption[] = godowns
    .filter((g) => (!form.companyId || !g.companyId || String(g.companyId) === form.companyId) && (!form.projectId || !g.projectId || String(g.projectId) === form.projectId))
    .map((g) => ({ key: String(g.id), label: g.name, sublabel: g.code ?? undefined }));
  const toGodownOptions: PickerOption[] = fromGodownOptions.filter((o) => o.key !== form.fromGodownId);
  const itemOptions: PickerOption[] = availableItems.map((i) => ({ key: i.itemId, label: i.itemName, sublabel: `Available: ${i.available.toFixed(2)} ${i.uom}` }));

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <View style={{ paddingTop: insets.top + 8 }} className="flex-row items-center justify-between px-4 pb-3">
          <View className="flex-row items-center gap-2.5">
            <View className="w-8 h-8 rounded-lg items-center justify-center" style={{ backgroundColor: "#0891b226" }}>
              <Repeat size={14} color="#0891b2" />
            </View>
            <Text style={{ color: colors.foreground, fontSize: 14, fontFamily: fonts.heading.semibold }}>New Stock Transfer</Text>
          </View>
          <Pressable onPress={onClose} className="w-8 h-8 rounded-lg items-center justify-center" style={{ borderWidth: 1, borderColor: colors.border }}>
            <X size={15} color={colors.mutedForeground} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 16 }} keyboardShouldPersistTaps="handled">
          <PickerRow label="Company" value={companies.find((c) => c.id === form.companyId)?.name ?? ""} placeholder="All" onPress={() => setPicker("company")} />
          <PickerRow label="Project" value={projects.find((p) => p.id === form.projectId)?.name ?? ""} placeholder="All" onPress={() => setPicker("project")} />

          <View className="flex-row items-center gap-2 mb-1">
            <View style={{ flex: 1 }}>
              <PickerRow label="From Godown" value={form.fromGodownName} placeholder="Source" onPress={() => setPicker("fromGodown")} />
            </View>
            <ArrowRight size={16} color={colors.mutedForeground} style={{ marginTop: 10 }} />
            <View style={{ flex: 1 }}>
              <PickerRow label="To Godown" value={form.toGodownName} placeholder="Destination" onPress={() => setPicker("toGodown")} disabled={!form.fromGodownId} />
            </View>
          </View>
          {sameGodown && (
            <Text style={{ color: colors.destructive, fontSize: 10.5, marginTop: -6, marginBottom: 12 }}>Source and destination must be different godowns.</Text>
          )}

          <FieldLabel required>Transfer Date</FieldLabel>
          <TextInput
            value={form.transferDate} onChangeText={(v) => set("transferDate", v)} placeholder="YYYY-MM-DD"
            placeholderTextColor={`${colors.mutedForeground}99`}
            style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, color: colors.foreground, fontSize: 13, marginBottom: 14 }}
          />

          <Text style={{ color: colors.mutedForeground, fontSize: 10.5, fontFamily: fonts.heading.semibold, textTransform: "uppercase", letterSpacing: 0.6, marginTop: 6, marginBottom: 10 }}>
            Items to Transfer ({cart.length})
          </Text>

          {!form.fromGodownId ? (
            <View className="rounded-xl px-3.5 py-4 items-center mb-2" style={{ borderWidth: 1, borderColor: colors.border, borderStyle: "dashed" }}>
              <Text style={{ color: colors.mutedForeground, fontSize: 11.5, textAlign: "center" }}>Select a source godown to add items.</Text>
            </View>
          ) : loadingItems ? (
            <View className="py-6 items-center"><ActivityIndicator color={colors.mutedForeground} /></View>
          ) : (
            <>
              {cart.map((ci, idx) => {
                const remaining = remainingForRow(idx);
                const qty = Number(ci.quantity) || 0;
                const overStock = remaining != null && qty > remaining;
                return (
                  <View key={ci.key} className="rounded-xl p-3 mb-2.5" style={{ borderWidth: 1, borderColor: overStock ? colors.destructive : colors.border, backgroundColor: `${colors.card}80` }}>
                    <View className="flex-row items-center justify-between mb-2">
                      <Pressable onPress={() => setLinePicker(idx)} style={{ flex: 1, marginRight: 8 }}>
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
                        <Text style={{ color: colors.foreground, fontSize: 12, marginTop: 6 }}>{ci.uom || "—"}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: colors.mutedForeground, fontSize: 9, textTransform: "uppercase" }}>Quantity</Text>
                        <TextInput
                          value={ci.quantity}
                          onChangeText={(v) => updateQty(idx, v.replace(/[^0-9.]/g, ""))}
                          keyboardType="numeric"
                          style={{ borderWidth: 1, borderColor: overStock ? colors.destructive : colors.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, color: colors.foreground, fontSize: 12, marginTop: 3 }}
                        />
                      </View>
                    </View>
                    {!!ci.itemId && (
                      <Text style={{ color: overStock ? colors.destructive : colors.mutedForeground, fontSize: 10, marginTop: 6 }}>
                        {overStock ? `Exceeds stock — only ${Math.max(remaining ?? 0, 0).toFixed(2)} ${ci.uom} available` : `Available: ${(remaining ?? 0).toFixed(2)} ${ci.uom}`}
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

          <FieldLabel>Remarks</FieldLabel>
          <TextInput
            value={form.remarks} onChangeText={(v) => set("remarks", v)} placeholder="Optional notes" multiline
            placeholderTextColor={`${colors.mutedForeground}99`}
            style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, color: colors.foreground, fontSize: 13, minHeight: 70, textAlignVertical: "top" }}
          />
        </ScrollView>

        <View className="flex-row gap-2.5 px-4" style={{ paddingBottom: insets.bottom + 14, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border }}>
          <Pressable onPress={onClose} className="px-5 py-3 rounded-xl items-center justify-center" style={{ borderWidth: 1, borderColor: colors.border }}>
            <Text style={{ color: colors.mutedForeground, fontSize: 12.5, fontFamily: fonts.heading.medium }}>Cancel</Text>
          </Pressable>
          <Pressable
            onPress={handleTransfer} disabled={saving}
            className="flex-1 items-center justify-center py-3 rounded-xl"
            style={{ backgroundColor: "#0891b2", opacity: saving ? 0.7 : 1 }}
          >
            {saving ? <ActivityIndicator size="small" color="#fff" /> : (
              <Text style={{ color: "#fff", fontSize: 12.5, fontFamily: fonts.heading.semibold }}>Execute Transfer</Text>
            )}
          </Pressable>
        </View>
      </View>

      <OptionPickerModal visible={picker === "company"} title="Select Company" options={companyOptions} selectedKey={form.companyId}
        onSelect={(k) => { set("companyId", k); setPicker(null); }} onClose={() => setPicker(null)} searchable clearable />
      <OptionPickerModal visible={picker === "project"} title="Select Project" options={projectOptions} selectedKey={form.projectId}
        onSelect={(k) => { set("projectId", k); setPicker(null); }} onClose={() => setPicker(null)} searchable clearable />
      <OptionPickerModal visible={picker === "fromGodown"} title="Select Source Godown" options={fromGodownOptions} selectedKey={form.fromGodownId}
        onSelect={(k) => { const g = godowns.find((x) => String(x.id) === k); handleFromGodownChange(k, g?.name ?? ""); setPicker(null); }}
        onClose={() => setPicker(null)} searchable />
      <OptionPickerModal visible={picker === "toGodown"} title="Select Destination Godown" options={toGodownOptions} selectedKey={form.toGodownId}
        onSelect={(k) => { const g = godowns.find((x) => String(x.id) === k); set("toGodownId", k); set("toGodownName", g?.name ?? ""); setPicker(null); }}
        onClose={() => setPicker(null)} searchable />

      <OptionPickerModal
        visible={linePicker != null} title="Select Item" options={itemOptions}
        selectedKey={linePicker != null ? cart[linePicker]?.itemId ?? "" : ""}
        onSelect={(k) => linePicker != null && pickItem(linePicker, k)}
        onClose={() => setLinePicker(null)} searchable
      />
    </Modal>
  );
}
