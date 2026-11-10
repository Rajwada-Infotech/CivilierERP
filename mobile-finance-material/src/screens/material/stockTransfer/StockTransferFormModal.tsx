// RN port of StockTransfer.tsx's "New Transfer" tab, on the drawing sheet: a page of the stack (asScreen, from
// StockTransferFormScreen) with Cancel / Execute along its foot. Intra-Company mode
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
import { istToday } from "@/utils/istTime";
import { useEffect, useMemo, useState } from "react";
import { View, Alert } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Repeat } from "lucide-react-native";
import { sheet as S } from "@/theme/colors";
import { Body, Field, Input, Label, Panel, Skel } from "@/components/sheet/Sheet";
import { TextField } from "@/components/sheet/FormParts";
import { AddLineKey, FormPage, LineBox } from "@/components/sheet/Register";
import { getGodowns, getCompanies, getProjects, getInventoryMaster } from "@/api/stockApi";
import { createStockTransfer, type CreateTransferPayload, type TransferItem } from "@/api/stockTransferApi";
import { PickerRow, OptionPickerModal, type PickerOption } from "@/screens/finance/payment/OptionPicker";

type CartItem = { key: string; itemId: string; itemName: string; uom: string; quantity: string; availableStock: number };

let seq = 0;
const uid = () => `trf-${Date.now()}-${seq++}`;

function blankCartItem(): CartItem {
  return { key: uid(), itemId: "", itemName: "", uom: "", quantity: "", availableStock: 0 };
}

function todayISO() { return istToday(); }

type FormState = {
  companyId: string; projectId: string;
  fromGodownId: string; fromGodownName: string;
  toGodownId: string; toGodownName: string;
  transferDate: string; remarks: string;
};

function blankForm(): FormState {
  return { companyId: "", projectId: "", fromGodownId: "", fromGodownName: "", toGodownId: "", toGodownName: "", transferDate: todayISO(), remarks: "" };
}

export function StockTransferFormModal({ visible, onClose, asScreen }: { visible: boolean; onClose: () => void; asScreen?: boolean }) {
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

  // Auto-select the project's own godown once a project is picked — matched
  // on projectId alone, not company+project. A project merely tagged to a
  // company (not owned by it — see web's StockTransfer.tsx projectGodown
  // comment) has its godown listed under the OWNING company, so requiring
  // both to match made a tagged project's godown invisible here.
  useEffect(() => {
    if (!form.projectId) return;
    const matches = godowns.filter((g) => String(g.projectId ?? "") === form.projectId);
    if (matches.length === 1 && form.fromGodownId !== String(matches[0].id)) {
      setForm((f) => ({ ...f, fromGodownId: String(matches[0].id), fromGodownName: matches[0].name }));
      setCart([blankCartItem()]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.projectId, godowns]);

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
  // Once a project is picked, its godown is the unambiguous match regardless
  // of which company it's filed under — same reasoning as the auto-select
  // effect above. Company alone only narrows the list before a project is
  // chosen.
  const fromGodownOptions: PickerOption[] = godowns
    .filter((g) =>
      form.projectId
        ? !g.projectId || String(g.projectId) === form.projectId
        : !form.companyId || !g.companyId || String(g.companyId) === form.companyId,
    )
    .map((g) => ({ key: String(g.id), label: g.name, sublabel: g.code ?? undefined }));
  const toGodownOptions: PickerOption[] = fromGodownOptions.filter((o) => o.key !== form.fromGodownId);
  const itemOptions: PickerOption[] = availableItems.map((i) => ({ key: i.itemId, label: i.itemName, sublabel: `Available: ${i.available.toFixed(2)} ${i.uom}` }));

  return (
    <FormPage
      asScreen={asScreen}
      visible={visible}
      onClose={onClose}
      eyebrow="CivilierERP · Material · Stock transfer"
      title="New transfer"
      subtitle="Move stock from one godown to another. It executes at once: there is no draft to come back to."
      saving={saving}
      onSave={handleTransfer}
      saveLabel="Execute transfer"
      overlays={
        <>
          <OptionPickerModal visible={picker === "company"} title="Select company" options={companyOptions} selectedKey={form.companyId}
            onSelect={(k) => { set("companyId", k); setPicker(null); }} onClose={() => setPicker(null)} searchable clearable />
          <OptionPickerModal visible={picker === "project"} title="Select project" options={projectOptions} selectedKey={form.projectId}
            onSelect={(k) => { set("projectId", k); setPicker(null); }} onClose={() => setPicker(null)} searchable clearable />
          <OptionPickerModal visible={picker === "fromGodown"} title="Select source godown" options={fromGodownOptions} selectedKey={form.fromGodownId}
            onSelect={(k) => { const g = godowns.find((x) => String(x.id) === k); handleFromGodownChange(k, g?.name ?? ""); setPicker(null); }}
            onClose={() => setPicker(null)} searchable />
          <OptionPickerModal visible={picker === "toGodown"} title="Select destination godown" options={toGodownOptions} selectedKey={form.toGodownId}
            onSelect={(k) => { const g = godowns.find((x) => String(x.id) === k); set("toGodownId", k); set("toGodownName", g?.name ?? ""); setPicker(null); }}
            onClose={() => setPicker(null)} searchable />
          <OptionPickerModal
            visible={linePicker != null} title="Select item" options={itemOptions}
            selectedKey={linePicker != null ? cart[linePicker]?.itemId ?? "" : ""}
            onSelect={(k) => linePicker != null && pickItem(linePicker, k)}
            onClose={() => setLinePicker(null)} searchable
          />
        </>
      }
    >
      <Panel title="Route">
        <View>
          <PickerRow label="Company" value={companies.find((c) => c.id === form.companyId)?.name ?? ""} placeholder="All" onPress={() => setPicker("company")} />
          <PickerRow label="Project" value={projects.find((p) => p.id === form.projectId)?.name ?? ""} placeholder="All" onPress={() => setPicker("project")} />
          <PickerRow label="From godown *" value={form.fromGodownName} placeholder="Source…" onPress={() => setPicker("fromGodown")} />
          <PickerRow label="To godown *" value={form.toGodownName} placeholder={form.fromGodownId ? "Destination…" : "Choose the source first"} onPress={() => setPicker("toGodown")} disabled={!form.fromGodownId} />
          {sameGodown && <Body size={11} color={S.red} style={{ marginTop: -6, marginBottom: 12 }}>Source and destination must be different godowns.</Body>}
        </View>
        <Field label="Transfer date" required>
          <Input value={form.transferDate} onChangeText={(v) => set("transferDate", v)} placeholder="YYYY-MM-DD" />
        </Field>
      </Panel>

      <Panel title={`Items to transfer (${cart.length})`} icon={<Repeat size={14} color={S.ink} />}>
        {!form.fromGodownId ? (
          <Body size={12.5} color={S.graphite} style={{ textAlign: "center", paddingVertical: 14 }}>Select a source godown to add items.</Body>
        ) : loadingItems ? (
          <>
            <Skel h={60} />
            <Skel h={60} />
          </>
        ) : (
          <>
            {cart.map((ci, idx) => {
              const remaining = remainingForRow(idx);
              const overStock = remaining != null && (Number(ci.quantity) || 0) > remaining;
              return (
                <LineBox key={ci.key} index={idx} title={`Item ${idx + 1}`} onRemove={cart.length > 1 ? () => removeCartRow(idx) : undefined}>
                  <View>
                    <PickerRow label="Item" value={ci.itemName} placeholder="Select item…" onPress={() => setLinePicker(idx)} />
                  </View>
                  <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-end" }}>
                    <View style={{ flex: 1, gap: 6 }}>
                      <Label>UOM</Label>
                      <Body size={13.5} style={{ paddingVertical: 12 }}>{ci.uom || "—"}</Body>
                    </View>
                    <Field label="Quantity" style={{ flex: 1 }}>
                      <Input value={ci.quantity} onChangeText={(v) => updateQty(idx, v.replace(/[^0-9.]/g, ""))} keyboardType="numeric" placeholder="0" style={overStock ? { color: S.red } : undefined} />
                    </Field>
                  </View>
                  {!!ci.itemId && (
                    <Body size={11} color={overStock ? S.red : S.graphite}>
                      {overStock ? `More than the stock: only ${Math.max(remaining ?? 0, 0).toFixed(2)} ${ci.uom} available` : `Available ${(remaining ?? 0).toFixed(2)} ${ci.uom}`}
                    </Body>
                  )}
                </LineBox>
              );
            })}
            <AddLineKey onPress={addCartRow} />
          </>
        )}
      </Panel>

      <View>
        <TextField label="Remarks" value={form.remarks} onChangeText={(v) => set("remarks", v)} placeholder="Optional notes" multiline />
      </View>
    </FormPage>
  );
}
