// RN port of MaterialRequest.tsx's create/edit form (MRForm), on the drawing sheet: a page of the stack (asScreen, from
// MaterialRequestFormScreen) with Cancel / Save along its foot. Scope trim vs. web:
// the UOM item-alternates live cross-unit conversion display is dropped
// for a plain UOM picker (any active UOM, no category filtering) — the
// most complex part of the web form and not needed for correctness, since
// quantity/UOM are stored as entered either way.
import { istToday } from "@/utils/istTime";
import { DateTimeField } from "@/components/DateTimeField";
import { filterProjectsByCompany } from "@/utils/projectBelongsTo";
import { useLockedFinYear } from "@/hooks/useLockedFinYear";
import { useEffect, useMemo, useState } from "react";
import { View, Alert } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardList } from "lucide-react-native";
import { sheet as S } from "@/theme/colors";
import { Field, Input, Panel } from "@/components/sheet/Sheet";
import { TextField } from "@/components/sheet/FormParts";
import { AddLineKey, FormPage, KeyRow, LineBox, ShownValue } from "@/components/sheet/Register";
import {
  getMaterialRequestById, createMaterialRequest, updateMaterialRequest,
  getMRCompanies, getMRProjects, getMRFinYears, getMRItemOptions, getMRUomOptions, previewNextMRNumber, fetchDocTypes,
  PRIORITY_OPTIONS,
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

function todayISO() { return istToday(); }

function blankForm(): FormState {
  return {
    companyId: "", companyName: "", projectId: "", projectName: "", finYearId: "", finYearName: "",
    requestDate: todayISO(), requiredByDate: "", priority: "Normal", reason: "", remarks: "",
  };
}

export function MaterialRequestFormModal({
  visible, editingId, onClose, asScreen,
}: { visible: boolean; editingId: number | null; onClose: () => void; asScreen?: boolean }) {
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
  // New records are locked to the current financial year (else the most
  // recent one); an existing record keeps the year it was saved with.
  const lockedFY = useLockedFinYear(visible && editingId == null);
  const finYearLocked = (visible && editingId == null) && !!lockedFY;
  useEffect(() => {
    if (!(visible && editingId == null) || !lockedFY) return;
    setForm((f) => ({ ...f, finYearId: String(lockedFY.id), finYearName: lockedFY.label }));
  }, [visible, editingId == null, lockedFY?.id]);
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
    // Unhandled here used to crash the whole app on open — this call fires
    // the moment the New Material Request modal appears, with nothing else
    // catching a rejection (a network blip, or a 403 for a role without
    // document-type rights). docTypeId just stays null on failure — the
    // backend still accepts the request without it.
    fetchDocTypes("MR").then((types) => { if (types[0]) setDocTypeId(types[0].TypeOfDocId); }).catch(() => setDocTypeId(null));
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
  // Only the projects that belong to the chosen company (own or tagged).
  const projectOptions: PickerOption[] = filterProjectsByCompany(projects, form.companyId).map((p) => ({ key: String(p.id), label: p.name }));
  const finYearOptions: PickerOption[] = finYears.map((f) => ({ key: String(f.id), label: f.name }));
  const itemPickerOptions: PickerOption[] = itemOptions.map((i) => ({
    key: i.M_Id, label: i.M_Name, sublabel: [i.M_Group, i.AvailableStock != null ? `Stock: ${Number(i.AvailableStock).toFixed(2)}` : null].filter(Boolean).join(" · "),
  }));
  const uomPickerOptions: PickerOption[] = uoms.map((u) => ({ key: u.UOMCode, label: u.UOMName || u.UOMCode }));
  const activeLine = linePicker ? cart[linePicker.idx] : null;

  return (
    <FormPage
      asScreen={asScreen}
      visible={visible}
      onClose={onClose}
      eyebrow="CivilierERP · Material · Material request"
      title={editingId ? "Edit request" : "New request"}
      subtitle={editingId ? existing?.DocNo || undefined : "Ask for materials for a project; it goes for approval on save."}
      loading={editingId != null && loadingExisting}
      saving={saving}
      onSave={handleSave}
      saveLabel={editingId ? "Save changes" : "Submit request"}
      overlays={
        <>
          <OptionPickerModal visible={picker === "company"} title="Select company" options={companyOptions} selectedKey={form.companyId}
            onSelect={(k) => { const c = companies.find((x) => String(x.id) === k); setForm((f) => ({ ...f, companyId: k, companyName: c?.name ?? "", projectId: "", projectName: "" })); setPicker(null); }}
            onClose={() => setPicker(null)} searchable />
          <OptionPickerModal visible={picker === "project"} title="Select project" options={projectOptions} selectedKey={form.projectId}
            onSelect={(k) => { const p = projects.find((x) => String(x.id) === k); setForm((f) => ({ ...f, projectId: k, projectName: p?.name ?? "" })); setPicker(null); }}
            onClose={() => setPicker(null)} searchable />
          <OptionPickerModal visible={picker === "finYear"} title="Select financial year" options={finYearOptions} selectedKey={form.finYearId}
            onSelect={(k) => { const f = finYears.find((x) => String(x.id) === k); setForm((st) => ({ ...st, finYearId: k, finYearName: f?.name ?? "" })); setPicker(null); }}
            onClose={() => setPicker(null)} clearable />
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
      <Panel title="Request">
        <View>
          <ShownValue label="Doc number" value={editingId ? existing?.DocNo || "—" : docNoPreview?.nextDocNo || "Made on save"} />
          <PickerRow label="Company *" value={form.companyName} placeholder="Select company…" onPress={() => setPicker("company")} />
          <PickerRow label="Project *" value={form.projectName} placeholder={form.companyId ? "Select project…" : "Choose a company first"} onPress={() => setPicker("project")} disabled={!form.companyId} />
          <PickerRow label={finYearLocked ? "Financial year · locked to current" : "Financial year"} value={form.finYearName} placeholder="Auto" onPress={() => setPicker("finYear")} disabled={finYearLocked} />
        </View>
        <Field label="Priority" required>
          <KeyRow options={PRIORITY_OPTIONS.map((p) => ({ value: p as string, label: p }))} value={form.priority} onChange={(p) => set("priority", p)} />
        </Field>
        <Field label="Request date" required>
          <DateTimeField mode="date" value={form.requestDate} onChange={(v) => set("requestDate", v)} title="Request date" />
        </Field>
        <Field label="Required by">
          <DateTimeField mode="date" value={form.requiredByDate} onChange={(v) => set("requiredByDate", v)} title="Required by" placeholder="Select a date (optional)" clearable />
        </Field>
        <View>
          <TextField label="Reason *" value={form.reason} onChangeText={(v) => set("reason", v)} placeholder="Why is this material needed?" multiline />
          <TextField label="Remarks" value={form.remarks} onChangeText={(v) => set("remarks", v)} placeholder="Optional notes" />
        </View>
      </Panel>

      <Panel title={`Requested items (${cart.length})`} icon={<ClipboardList size={14} color={S.ink} />}>
        {cart.map((ci, idx) => (
          <LineBox key={ci.key} index={idx} title={`Item ${idx + 1}`} onRemove={cart.length > 1 ? () => removeCartRow(idx) : undefined}>
            <View>
              <PickerRow label="Item" value={ci.itemName} placeholder="Select item…" onPress={() => setLinePicker({ idx, kind: "item" })} />
            </View>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <View style={{ flex: 1 }}>
                <PickerRow label="UOM" value={ci.uomCode} placeholder="—" onPress={() => setLinePicker({ idx, kind: "uom" })} />
              </View>
              <Field label="Quantity" style={{ flex: 1 }}>
                <Input value={ci.quantity} onChangeText={(v) => updateCartField(idx, { quantity: v.replace(/[^0-9.]/g, "") })} keyboardType="numeric" placeholder="0" />
              </Field>
            </View>
          </LineBox>
        ))}
        <AddLineKey onPress={addCartRow} />
      </Panel>
    </FormPage>
  );
}
