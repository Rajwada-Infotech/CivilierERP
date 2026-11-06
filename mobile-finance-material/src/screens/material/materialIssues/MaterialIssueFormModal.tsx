// RN port of Issues.tsx's create/edit form (IssueForm), on the drawing sheet: a page of the stack (asScreen, from
// MaterialIssueFormScreen) with Cancel / Save along its foot. Core correctness
// piece is the per-line stock cap: a row's usable quantity is the item's
// AvailableStock in the chosen godown minus whatever's already claimed by
// OTHER cart rows on the same item (getStockForRow on web) — kept 1:1.
// Changing the godown resets the cart (web enforces this too, since stock
// figures are godown-scoped). Dropped vs. web: CSV import/export, print.
import { istToday } from "@/utils/istTime";
import { useLockedFinYear } from "@/hooks/useLockedFinYear";
import { useEffect, useMemo, useState } from "react";
import { View, Alert } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PackageMinus } from "lucide-react-native";
import { sheet as S } from "@/theme/colors";
import { Body, Field, Input, Panel } from "@/components/sheet/Sheet";
import { TextField } from "@/components/sheet/FormParts";
import { AddLineKey, FormPage, LineBox, ShownValue } from "@/components/sheet/Register";
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

function todayISO() { return istToday(); }

function blankForm(): FormState {
  return {
    companyId: "", companyName: "", projectId: "", projectName: "", finYear: "",
    godownId: "", godownName: "", date: todayISO(), issuedTo: "", issuedToName: "", costCenter: "",
    reason: "", remarks: "",
  };
}

export function MaterialIssueFormModal({
  visible, editingId, onClose, asScreen,
}: { visible: boolean; editingId: number | null; onClose: () => void; asScreen?: boolean }) {
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
  // New records are locked to the current financial year (else the most
  // recent one); an existing record keeps the year it was saved with.
  const lockedFY = useLockedFinYear(visible && editingId == null);
  const finYearLocked = (visible && editingId == null) && !!lockedFY;
  useEffect(() => {
    if (!(visible && editingId == null) || !lockedFY) return;
    set("finYear", lockedFY.label);
  }, [visible, editingId == null, lockedFY?.id]);
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
    // Both calls used to be unhandled — a rejection from either (network
    // blip, or a 403 on a doc-type-scoped right) crashed the whole app the
    // moment this New Material Issue modal opened, since nothing else
    // catches a promise here. docTypeId/docNo just stay unset on failure —
    // the backend still accepts the request without a preview.
    fetchDocTypes("ISS").then((types) => {
      if (types[0]) {
        setDocTypeId(types[0].TypeOfDocId);
        fetchNextDocNumber(types[0].TypeOfDocId, form.finYear || undefined).then(setDocNo).catch(() => {});
      }
    }).catch(() => {});
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

  // Auto-select the project's own godown once a project is picked — matched
  // on projectId alone, not company+project. A project merely tagged to a
  // company (not owned by it — see web's StockTransfer.tsx projectGodown
  // comment, and the identical fix in StockTransferFormModal.tsx) has its
  // godown listed under the OWNING company, so requiring both to match made
  // a tagged project's godown invisible here.
  useEffect(() => {
    if (!form.projectId) return;
    const matches = godowns.filter((g) => String(g.projectId ?? "") === form.projectId);
    if (matches.length === 1 && form.godownId !== String(matches[0].id)) {
      setForm((f) => ({ ...f, godownId: String(matches[0].id), godownName: matches[0].name }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.projectId, godowns]);

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
  // Once a project is picked, its godown is the unambiguous match regardless
  // of which company it's filed under — same reasoning as the auto-select
  // effect above.
  const godownOptions: PickerOption[] = godowns
    .filter((g) =>
      form.projectId
        ? !g.projectId || String(g.projectId) === form.projectId
        : !form.companyId || !g.companyId || String(g.companyId) === form.companyId,
    )
    .map((g) => ({ key: String(g.id), label: g.name, sublabel: g.code ?? undefined }));
  const finYearOptions: PickerOption[] = finYears.map((f) => ({ key: f.label, label: f.label }));
  const issuedToPickerOptions: PickerOption[] = issuedToOptions.map((o) => ({ key: o.id, label: o.name }));
  const itemPickerOptions: PickerOption[] = itemOptions.map((i) => ({
    key: i.M_Id, label: i.M_Name, sublabel: [i.M_Group, `Stock: ${Number(i.AvailableStock ?? 0).toFixed(2)}`].filter(Boolean).join(" · "),
  }));
  const uomPickerOptions: PickerOption[] = uoms.map((u) => ({ key: u.UOMCode, label: u.UOMName || u.UOMCode }));
  const activeLine = linePicker ? cart[linePicker.idx] : null;

  return (
    <FormPage
      asScreen={asScreen}
      visible={visible}
      onClose={onClose}
      eyebrow="CivilierERP · Material · Material issue"
      title={editingId ? "Edit issue" : "New issue"}
      subtitle={editingId ? existing?.DocNo || existing?.IssueNo || undefined : "Issue material from a godown to its project, within the stock it holds."}
      loading={editingId != null && loadingExisting}
      saving={saving}
      onSave={handleSave}
      saveLabel={editingId ? "Save changes" : "Submit issue"}
      overlays={
        <>
          <OptionPickerModal visible={picker === "company"} title="Select company" options={companyOptions} selectedKey={form.companyId}
            onSelect={(k) => { const c = companies.find((x) => x.id === k); setForm((f) => ({ ...f, companyId: k, companyName: c?.name ?? "", projectId: "", projectName: "", godownId: "", godownName: "" })); setCart([blankCartItem()]); setPicker(null); }}
            onClose={() => setPicker(null)} searchable />
          <OptionPickerModal visible={picker === "project"} title="Select project" options={projectOptions} selectedKey={form.projectId}
            onSelect={(k) => { const p = projects.find((x) => x.id === k); setForm((f) => ({ ...f, projectId: k, projectName: p?.name ?? "", godownId: "", godownName: "" })); setCart([blankCartItem()]); setPicker(null); }}
            onClose={() => setPicker(null)} searchable />
          <OptionPickerModal visible={picker === "finYear"} title="Select financial year" options={finYearOptions} selectedKey={form.finYear}
            onSelect={(k) => { set("finYear", k); setPicker(null); }}
            onClose={() => setPicker(null)} clearable />
          <OptionPickerModal visible={picker === "godown"} title="Select godown" options={godownOptions} selectedKey={form.godownId}
            onSelect={(k) => { const g = godowns.find((x) => String(x.id) === k); handleGodownChange(k, g?.name ?? ""); setPicker(null); }}
            onClose={() => setPicker(null)} searchable />
          <OptionPickerModal visible={picker === "issuedTo"} title="Issued to" options={issuedToPickerOptions} selectedKey={form.issuedTo}
            onSelect={(k) => { const o = issuedToOptions.find((x) => x.id === k); setForm((f) => ({ ...f, issuedTo: k, issuedToName: o?.name ?? "" })); setPicker(null); }}
            onClose={() => setPicker(null)} searchable clearable />
          <OptionPickerModal
            visible={linePicker?.kind === "item"} title="Select item" options={itemPickerOptions}
            selectedKey={activeLine?.itemId ?? ""} onSelect={(k) => linePicker && pickItem(linePicker.idx, k)}
            onClose={() => setLinePicker(null)} searchable
          />
          <OptionPickerModal
            visible={linePicker?.kind === "uom"} title="Select UOM" options={uomPickerOptions}
            selectedKey={activeLine?.uomCode ?? ""} onSelect={(k) => { if (linePicker) updateCartField(linePicker.idx, { uomCode: k }); setLinePicker(null); }}
            onClose={() => setLinePicker(null)} searchable
          />
        </>
      }
    >
      <Panel title="Issue">
        <View>
          <ShownValue label="Doc number" value={editingId ? existing?.DocNo || existing?.IssueNo || "—" : docNo || "Made on save"} />
          <PickerRow label="Company *" value={form.companyName} placeholder="Select company…" onPress={() => setPicker("company")} />
          <PickerRow label="Project *" value={form.projectName} placeholder={form.companyId ? "Select project…" : "Choose a company first"} onPress={() => setPicker("project")} disabled={!form.companyId} />
          <PickerRow label={finYearLocked ? "Financial year · locked to current" : "Financial year"} value={form.finYear} placeholder="Auto" onPress={() => setPicker("finYear")} disabled={finYearLocked} />
          <PickerRow label="Source godown *" value={form.godownName} placeholder="Select godown…" onPress={() => setPicker("godown")} disabled={!form.companyId || !form.projectId} />
          {!!form.godownId && <Body size={11} color={S.graphite} style={{ marginTop: -6, marginBottom: 12 }}>Changing the godown clears the item list.</Body>}
        </View>
        <Field label="Date" required>
          <Input value={form.date} onChangeText={(v) => set("date", v)} placeholder="YYYY-MM-DD" />
        </Field>
        <View>
          <PickerRow label="Issued to" value={form.issuedToName} placeholder="Optional" onPress={() => setPicker("issuedTo")} />
          <TextField label="Cost centre / GL account" value={form.costCenter} onChangeText={(v) => set("costCenter", v)} placeholder="Optional" />
          <TextField label="Reason for issue *" value={form.reason} onChangeText={(v) => set("reason", v)} placeholder="Why is this material being issued?" multiline />
          <TextField label="Remarks" value={form.remarks} onChangeText={(v) => set("remarks", v)} placeholder="Optional notes" />
        </View>
      </Panel>

      <Panel title={`Items to issue (${cart.length})`} icon={<PackageMinus size={14} color={S.ink} />}>
        {!form.godownId ? (
          <Body size={12.5} color={S.graphite} style={{ textAlign: "center", paddingVertical: 14 }}>Select a source godown to add items.</Body>
        ) : (
          <>
            {cart.map((ci, idx) => {
              const remaining = remainingForRow(idx);
              const qty = Number(ci.quantity) || 0;
              const overStock = remaining != null && qty > remaining;
              return (
                <LineBox key={ci.key} index={idx} title={`Item ${idx + 1}`} onRemove={cart.length > 1 ? () => removeCartRow(idx) : undefined}>
                  <View>
                    <PickerRow label="Item" value={ci.itemName} placeholder="Select item…" onPress={() => setLinePicker({ idx, kind: "item" })} />
                  </View>
                  <View style={{ flexDirection: "row", gap: 10 }}>
                    <View style={{ flex: 1 }}>
                      <PickerRow label="UOM" value={ci.uomCode} placeholder="—" onPress={() => setLinePicker({ idx, kind: "uom" })} />
                    </View>
                    <Field label="Quantity" style={{ flex: 1 }}>
                      <Input value={ci.quantity} onChangeText={(v) => updateCartField(idx, { quantity: v.replace(/[^0-9.]/g, "") })} keyboardType="numeric" placeholder="0" style={overStock ? { color: S.red } : undefined} />
                    </Field>
                  </View>
                  {!!ci.itemId && (
                    <Body size={11} color={overStock ? S.red : S.graphite}>
                      {overStock ? `More than the stock: only ${Math.max(remaining ?? 0, 0).toFixed(2)} ${ci.uomCode} available` : `Available ${(remaining ?? 0).toFixed(2)} ${ci.uomCode}`}
                    </Body>
                  )}
                </LineBox>
              );
            })}
            <AddLineKey onPress={addCartRow} />
          </>
        )}
      </Panel>
    </FormPage>
  );
}
