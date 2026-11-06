// RN port of IssueReturn.tsx's create/edit form, on the drawing sheet: a page of the stack (asScreen, from
// IssueReturnFormScreen) with Cancel / Save along its foot. A return sources its line
// items from a chosen Approved Material Issue — picking Company/Project/
// Issue Reference cascades down and clears the cart at each step, then the
// Issue's own items get pulled in as the starting cart (create mode only,
// matching web's `!editId` guard). Each row's Return Qty is capped at the
// ORIGINAL issued quantity (`maxQty`) — replicated as-is from web, which
// does not subtract quantity already returned in earlier Return docs.
import { istToday } from "@/utils/istTime";
import { useEffect, useState } from "react";
import { View, Alert } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCcw as RotateCcwIcon, Undo2 } from "lucide-react-native";
import { sheet as S } from "@/theme/colors";
import { Body, Field, Input, Key, Label, Panel } from "@/components/sheet/Sheet";
import { TextField } from "@/components/sheet/FormParts";
import { FormPage, LineBox } from "@/components/sheet/Register";
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

function todayISO() { return istToday(); }

function blankForm(): FormState {
  return { returnDate: todayISO(), companyId: "", companyName: "", projectId: "", projectName: "", issueId: "", issueDocNo: "", reason: "", remarks: "" };
}

export function IssueReturnFormModal({
  visible, editingId, onClose, asScreen,
}: { visible: boolean; editingId: number | null; onClose: () => void; asScreen?: boolean }) {
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
    <FormPage
      asScreen={asScreen}
      visible={visible}
      onClose={onClose}
      eyebrow="CivilierERP · Material · Issue return"
      title={editingId ? "Edit return" : "New return"}
      subtitle="Material coming back from a project, against an approved issue. Saved as a draft; submit it from the return."
      loading={editingId != null && loadingExisting}
      saving={saving}
      onSave={handleSave}
      saveLabel={editingId ? "Save changes" : "Save as draft"}
      overlays={
        <>
          <OptionPickerModal visible={picker === "company"} title="Select company" options={companyOptions} selectedKey={form.companyId}
            onSelect={(k) => { const c = companies.find((x) => x.id === k); setForm((f) => ({ ...f, companyId: k, companyName: c?.name ?? "", projectId: "", projectName: "", issueId: "", issueDocNo: "" })); setCart([]); setPicker(null); }}
            onClose={() => setPicker(null)} searchable clearable />
          <OptionPickerModal visible={picker === "project"} title="Select project" options={projectOptions} selectedKey={form.projectId}
            onSelect={(k) => { const p = projects.find((x) => x.id === k); setForm((f) => ({ ...f, projectId: k, projectName: p?.name ?? "", issueId: "", issueDocNo: "" })); setCart([]); setPicker(null); }}
            onClose={() => setPicker(null)} searchable clearable />
          <OptionPickerModal visible={picker === "issue"} title="Select issue reference" options={issueOptions} selectedKey={form.issueId}
            onSelect={(k) => { const i = sourceIssues.find((x) => String(x.IssueId) === k); setForm((f) => ({ ...f, issueId: k, issueDocNo: i?.DocNo ?? "" })); setPicker(null); }}
            onClose={() => setPicker(null)} searchable clearable />
        </>
      }
    >
      <Panel title="Return">
        <Field label="Return date" required>
          <Input value={form.returnDate} onChangeText={(v) => set("returnDate", v)} placeholder="YYYY-MM-DD" />
        </Field>
        <View>
          <PickerRow label="Company" value={form.companyName} placeholder="Select company…" onPress={() => setPicker("company")} />
          <PickerRow label="Project" value={form.projectName} placeholder="Select project…" onPress={() => setPicker("project")} />
          <PickerRow label="Issue reference *" value={form.issueDocNo} placeholder="Select an approved issue…" onPress={() => setPicker("issue")} />
          <TextField label="Reason" value={form.reason} onChangeText={(v) => set("reason", v)} placeholder="Why is this being returned?" />
          <TextField label="Remarks" value={form.remarks} onChangeText={(v) => set("remarks", v)} placeholder="Optional notes" />
        </View>
      </Panel>

      <Panel title={`Return items (${cart.length})`} icon={<Undo2 size={14} color={S.ink} />}>
        {!!form.issueId && <Key label="Load from issue" icon={<RotateCcwIcon size={13} color={S.ink} />} onPress={() => loadItemsFromIssue(form.issueId)} style={{ alignSelf: "flex-start" }} />}
        {cart.length === 0 ? (
          <Body size={12.5} color={S.graphite} style={{ textAlign: "center", paddingVertical: 14 }}>{form.issueId ? "No items on this issue." : "Select an issue reference first."}</Body>
        ) : (
          cart.map((ci, idx) => {
            const overMax = (Number(ci.quantity) || 0) > ci.maxQty;
            return (
              <LineBox key={ci.key} index={idx} title={ci.itemName} onRemove={() => removeCartRow(idx)}>
                <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-end" }}>
                  <View style={{ flex: 1, gap: 6 }}>
                    <Label>Issued qty</Label>
                    <Body size={13.5} color={S.graphite} style={{ paddingVertical: 12 }}>{`${ci.maxQty} ${ci.uom}`}</Body>
                  </View>
                  <Field label="Return qty" style={{ flex: 1 }}>
                    <Input value={ci.quantity} onChangeText={(v) => updateCartQty(idx, v.replace(/[^0-9.]/g, ""))} keyboardType="numeric" style={overMax ? { color: S.red } : undefined} />
                  </Field>
                </View>
                {overMax && <Body size={11} color={S.red}>{`More than was issued (${ci.maxQty} ${ci.uom})`}</Body>}
              </LineBox>
            );
          })
        )}
      </Panel>
    </FormPage>
  );
}
