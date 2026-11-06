// RN port of GRN.tsx's create/edit form, on the drawing sheet: a page of the stack (asScreen, from GRNFormScreen) with
// Cancel / Save along its foot. Both ways to source a GRN's line
// items are supported (per scope decision, mirroring PO's GST/UOM engine
// and VIO's PO-receiving grid both being core, not trimmable):
//   - Vehicle In/Out mode: pick a pending lot for the PO — quantities are
//     locked to what the vehicle physically brought in.
//   - Remaining mode: "Create GRN for Remaining Items" — editable
//     receivedQty/rate/billing-qty, capped at what's still on the PO.
// A PO only shows up in the picker once ≥1 Vehicle In/Out has been logged
// against it (goods can't be receipted before a vehicle brought them in).
import { istToday } from "@/utils/istTime";
import { useLockedFinYear } from "@/hooks/useLockedFinYear";
import { useEffect, useMemo, useState } from "react";
import { View, Alert } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PackageCheck, Lock, CheckCircle2, CopyPlus } from "lucide-react-native";
import { sheet as S } from "@/theme/colors";
import { Body, Field, InfoGrid, Input, Key, Label, Panel } from "@/components/sheet/Sheet";
import { TextField } from "@/components/sheet/FormParts";
import { Facts, FormPage, LineBox, ShownValue } from "@/components/sheet/Register";
import { formatINR } from "@/utils/formatCurrency";
import {
  getGRNById, addGRN, updateGRN, previewNextGRNNumber,
  getCompanies, getProjects, getGodowns, getPurchaseOrders, getPurchaseOrderById, fetchFinYearOptions,
  getPoIdsWithVio, getPendingVehicleInOutsForPO, getVehicleInOutItemsEnriched,
  computeRemainingPOItems, hasRemainingItems, countRemainingItems, buildGRNLineItemsFromRemaining,
  createEmptyGRNItem,
  type GRNFormDataPayload, type GRNItemLine, type RemainingPOItem,
} from "@/api/grnApi";
import { PickerRow, OptionPickerModal, type PickerOption } from "@/screens/finance/payment/OptionPicker";

type FormState = {
  companyId: string; companyName: string;
  projectId: string; projectName: string;
  godownId: string; godownName: string;
  poId: string; poNumber: string;
  supplierId: string; supplierName: string;
  vehicleInOutId: string; vehicleInOutDocNo: string;
  grnSourceMode: "" | "vehicleInOut" | "remaining";
  grnDate: string; docDate: string;
  finYear: string; remarks: string;
  parentDocNo: string; rootExBDocNo: string;
  poTotalAmount: number;
};

function todayISO() { return istToday(); }

function blankForm(): FormState {
  return {
    companyId: "", companyName: "", projectId: "", projectName: "", godownId: "", godownName: "",
    poId: "", poNumber: "", supplierId: "", supplierName: "", vehicleInOutId: "", vehicleInOutDocNo: "",
    grnSourceMode: "", grnDate: todayISO(), docDate: todayISO(), finYear: "", remarks: "",
    parentDocNo: "", rootExBDocNo: "", poTotalAmount: 0,
  };
}

const round3 = (n: number) => Math.round((Number(n) || 0) * 1000) / 1000;

export function GRNFormModal({
  visible, editingId, onClose, asScreen,
}: { visible: boolean; editingId: number | null; onClose: () => void; asScreen?: boolean }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(blankForm());
  const [items, setItems] = useState<GRNItemLine[]>([createEmptyGRNItem()]);
  const [poRemainingItems, setPoRemainingItems] = useState<RemainingPOItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [loadingPO, setLoadingPO] = useState(false);
  const [picker, setPicker] = useState<"company" | "project" | "godown" | "po" | "vio" | "finYear" | null>(null);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  useEffect(() => {
    if (!visible) return;
    if (editingId == null) {
      setForm(blankForm());
      setItems([createEmptyGRNItem()]);
      setPoRemainingItems([]);
    }
  }, [visible, editingId]);

  const { data: companies = [] } = useQuery({ queryKey: ["grn-form-companies"], queryFn: getCompanies, enabled: visible });
  const { data: projects = [] } = useQuery({ queryKey: ["grn-form-projects"], queryFn: getProjects, enabled: visible });
  const { data: godowns = [] } = useQuery({ queryKey: ["grn-form-godowns"], queryFn: getGodowns, enabled: visible });
  const { data: purchaseOrders = [] } = useQuery({ queryKey: ["grn-form-pos"], queryFn: getPurchaseOrders, enabled: visible });
  const { data: poIdsWithVio } = useQuery({ queryKey: ["grn-form-po-ids-with-vio"], queryFn: getPoIdsWithVio, enabled: visible });
  const { data: finYears = [] } = useQuery({ queryKey: ["grn-form-finyears"], queryFn: fetchFinYearOptions, enabled: visible });
  // New records are locked to the current financial year (else the most
  // recent one); an existing record keeps the year it was saved with.
  const lockedFY = useLockedFinYear(visible && editingId == null);
  const finYearLocked = (visible && editingId == null) && !!lockedFY;
  useEffect(() => {
    if (!(visible && editingId == null) || !lockedFY) return;
    set("finYear", lockedFY.label);
  }, [visible, editingId == null, lockedFY?.id]);

  const { data: existing, isLoading: loadingExisting } = useQuery({
    queryKey: ["grn-editing-record", editingId],
    queryFn: () => getGRNById(editingId!),
    enabled: visible && editingId != null,
  });

  const { data: pendingVIOs = [], isLoading: loadingVIOs } = useQuery({
    queryKey: ["grn-form-pending-vios", form.poId],
    queryFn: () => getPendingVehicleInOutsForPO(form.poId),
    enabled: !!form.poId && editingId == null,
  });

  const { data: docNoPreview } = useQuery({
    queryKey: ["grn-next-docno", form.parentDocNo],
    queryFn: () => previewNextGRNNumber(form.parentDocNo || null),
    enabled: visible && editingId == null && !!form.poId,
  });

  useEffect(() => {
    if (!visible || editingId == null || !existing) return;
    setForm({
      companyId: existing.CompanyId ? String(existing.CompanyId) : "", companyName: existing.CompanyName || "",
      projectId: existing.ProjectId ? String(existing.ProjectId) : "", projectName: existing.ProjectName || "",
      godownId: existing.GodownID ? String(existing.GodownID) : "", godownName: "",
      poId: existing.POID ? String(existing.POID) : "", poNumber: existing.PONumber || "",
      supplierId: existing.SupplierID ? String(existing.SupplierID) : "", supplierName: existing.SupplierName || "",
      vehicleInOutId: existing.VehicleInOutID ? String(existing.VehicleInOutID) : "", vehicleInOutDocNo: "",
      grnSourceMode: existing.VehicleInOutID ? "vehicleInOut" : "remaining",
      grnDate: existing.GRNDate?.slice(0, 10) || todayISO(), docDate: existing.DocDate?.slice(0, 10) || todayISO(),
      finYear: existing.FinYear || "", remarks: existing.Remarks || "",
      parentDocNo: existing.PONumber || "", rootExBDocNo: "", poTotalAmount: Number(existing.POTotalAmount ?? 0),
    });
    setItems(existing.GRNItems?.length ? existing.GRNItems : [createEmptyGRNItem()]);
  }, [visible, editingId, existing]);

  // Same rule as web: once a project is picked, the godown is the one linked to
  // that project (not any godown company-wide). No project yet → every non-main godown.
  const projectGodown = useMemo(
    () => (form.projectId ? godowns.find((g) => g.projectId != null && String(g.projectId) === form.projectId) ?? null : null),
    [godowns, form.projectId],
  );
  useEffect(() => {
    if (!visible || editingId != null || !form.projectId) return;
    const id = projectGodown ? String(projectGodown.id) : "";
    const name = projectGodown?.name ?? "";
    setForm((f) => (f.godownId === id && f.godownName === name ? f : { ...f, godownId: id, godownName: name }));
  }, [visible, editingId, form.projectId, projectGodown]);

  const filteredProjects = useMemo(() => (form.companyId ? projects.filter((p) => p.companyId === form.companyId) : projects), [projects, form.companyId]);

  const poOptions: PickerOption[] = useMemo(() => purchaseOrders
    .filter((po) => {
      if (form.poId && String(po.PurchaseOrderID) === form.poId) return true;
      if (po.Status !== "Approved" && po.Status !== "Received") return false;
      if (form.companyId && String(po.CompanyId ?? "") !== form.companyId) return false;
      if (form.projectId && String(po.ProjectId ?? "") !== form.projectId) return false;
      if (!poIdsWithVio?.has(Number(po.PurchaseOrderID))) return false;
      return true;
    })
    .map((po) => ({
      key: String(po.PurchaseOrderID),
      label: `${po.DocNo || po.PurchaseOrderNo}${po.POType && po.POType !== "Direct" ? ` [${po.POType}]` : ""}`,
      sublabel: po.SupplierName,
    })), [purchaseOrders, form.companyId, form.projectId, form.poId, poIdsWithVio]);

  const vioOptions: PickerOption[] = pendingVIOs.map((v) => ({ key: String(v.VehicleInOutID), label: v.DocNo, sublabel: v.VehicleNo }));

  const handlePOSelect = async (poId: string) => {
    setPicker(null);
    if (!poId) {
      setForm((f) => ({ ...f, poId: "", poNumber: "", vehicleInOutId: "", vehicleInOutDocNo: "", grnSourceMode: "", supplierId: "", supplierName: "", parentDocNo: "", poTotalAmount: 0 }));
      setItems([createEmptyGRNItem()]);
      setPoRemainingItems([]);
      return;
    }
    setLoadingPO(true);
    try {
      const po = await getPurchaseOrderById(poId);
      setPoRemainingItems(computeRemainingPOItems(po));
      setForm((f) => ({
        ...f, poId, poNumber: po.PurchaseOrderNo ?? "", vehicleInOutId: "", vehicleInOutDocNo: "", grnSourceMode: "",
        supplierId: po.SupplierID ? String(po.SupplierID) : "", supplierName: po.SupplierName ?? "",
        companyId: po.CompanyId ? String(po.CompanyId) : f.companyId, projectId: po.ProjectId ? String(po.ProjectId) : f.projectId,
        parentDocNo: po.DocNo || po.PurchaseOrderNo || "", finYear: f.finYear || "",
        poTotalAmount: Number(po.TotalAmount ?? 0),
      }));
      setItems([createEmptyGRNItem()]);
    } catch (err: any) {
      Alert.alert("Failed to load PO", err.message ?? "Something went wrong.");
    } finally {
      setLoadingPO(false);
    }
  };

  const handleVIOSelect = async (vioId: string) => {
    setPicker(null);
    if (!vioId) {
      setForm((f) => ({ ...f, vehicleInOutId: "", vehicleInOutDocNo: "", grnSourceMode: "" }));
      setItems([createEmptyGRNItem()]);
      return;
    }
    setLoadingPO(true);
    try {
      const enriched = await getVehicleInOutItemsEnriched(vioId);
      const lineItems: GRNItemLine[] = enriched.map((it) => {
        const rate = Number(it.Rate ?? 0);
        const qty = Number(it.VehicleQty ?? 0);
        const gstPct = Number(it.TaxPct ?? 0);
        const totalAmount = rate * qty;
        return { itemId: it.ItemId, itemName: it.ItemName, orderedQty: qty, receivedQty: qty, remainingQty: 0, uom: it.UomName, rate, quantity: qty, totalAmount, gstPct, gstAmount: totalAmount * (gstPct / 100) };
      });
      const vio = pendingVIOs.find((v) => String(v.VehicleInOutID) === vioId);
      setForm((f) => ({ ...f, vehicleInOutId: vioId, vehicleInOutDocNo: vio?.DocNo ?? "", grnSourceMode: "vehicleInOut", grnDate: vio?.DocDate?.slice(0, 10) || f.grnDate }));
      setItems(lineItems.length ? lineItems : [createEmptyGRNItem()]);
    } catch (err: any) {
      Alert.alert("Failed to load Vehicle In/Out items", err.message ?? "Something went wrong.");
    } finally {
      setLoadingPO(false);
    }
  };

  const handleUseRemainingItems = () => {
    if (!hasRemainingItems(poRemainingItems)) return;
    setForm((f) => ({ ...f, vehicleInOutId: "", vehicleInOutDocNo: "", grnSourceMode: "remaining", grnDate: todayISO() }));
    setItems(buildGRNLineItemsFromRemaining(poRemainingItems));
  };

  const updateItemField = (idx: number, field: "receivedQty" | "rate" | "quantity", value: number) => {
    setItems((prev) => prev.map((it, i) => {
      if (i !== idx) return it;
      const current = { ...it, [field]: value };
      if (field === "receivedQty") {
        current.remainingQty = round3(current.orderedQty - value);
        if (it.quantity === it.receivedQty) current.quantity = value;
      }
      current.totalAmount = Number(current.rate || 0) * Number(current.quantity || 0);
      current.gstAmount = current.totalAmount * (Number(current.gstPct || 0) / 100);
      return current;
    }));
  };

  const validate = (): string | null => {
    if (!form.poId) return "Purchase Order is required.";
    if (!form.vehicleInOutId && form.grnSourceMode !== "remaining") return "Select a Vehicle In/Out document, or use \"Create GRN for Remaining Items\".";
    if (!form.supplierId) return "Supplier could not be determined.";
    if (items.every((i) => i.receivedQty <= 0)) return "Enter received quantity for at least one item.";
    if (items.some((i) => i.receivedQty > 0 && (!i.rate || i.rate <= 0))) return "Enter a rate (₹) for each received item.";
    if (items.some((i) => i.receivedQty > 0 && (!i.quantity || i.quantity <= 0))) return "Enter billing qty for each received item.";
    const overOrdered = items.find((i) => i.orderedQty > 0 && i.receivedQty > i.orderedQty);
    if (overOrdered) return `${overOrdered.itemName || "An item"}: received quantity (${overOrdered.receivedQty}) exceeds ordered quantity (${overOrdered.orderedQty}).`;
    return null;
  };

  const handleSave = async () => {
    const error = validate();
    if (error) {
      Alert.alert("Check the form", error);
      return;
    }
    const payload: GRNFormDataPayload = {
      grnNo: "", grnDate: form.grnDate, docDate: form.docDate,
      supplierId: Number(form.supplierId), poId: Number(form.poId),
      vehicleInOutId: form.vehicleInOutId ? Number(form.vehicleInOutId) : null,
      grnItems: items, status: "Draft", remarks: form.remarks,
      supplierName: form.supplierName, poNumber: form.poNumber, docNo: "",
      finYear: form.finYear || null, parentDocNo: form.parentDocNo || null, rootExBDocNo: form.rootExBDocNo || null,
      projectId: form.projectId ? Number(form.projectId) : null, godownId: form.godownId ? Number(form.godownId) : null,
    };
    setSaving(true);
    try {
      if (editingId != null) {
        await updateGRN(editingId, payload);
        Alert.alert("Saved", "GRN updated.");
      } else {
        await addGRN(payload);
        Alert.alert("Saved", "GRN created.");
      }
      queryClient.invalidateQueries({ queryKey: ["grns-mobile"], exact: false });
      onClose();
    } catch (err: any) {
      Alert.alert("Failed to save", err.message ?? "Something went wrong.");
    } finally {
      setSaving(false);
    }
  };

  const companyOptions: PickerOption[] = companies.map((c) => ({ key: c.id, label: c.name }));
  const projectOptions: PickerOption[] = filteredProjects.map((p) => ({ key: p.id, label: p.name }));
  const godownOptions: PickerOption[] = godowns.filter((g) => !g.isMain).map((g) => ({ key: String(g.id), label: g.name }));
  const finYearOptions: PickerOption[] = finYears.map((f) => ({ key: f.label, label: f.label }));

  const isLocked = form.grnSourceMode === "vehicleInOut";

  return (
    <FormPage
      asScreen={asScreen}
      visible={visible}
      onClose={onClose}
      eyebrow="CivilierERP · Material · Goods receipt note"
      title={editingId ? "Edit GRN" : "New GRN"}
      subtitle={editingId ? existing?.GRNNo || undefined : "Receive goods against a purchase order: a vehicle's lot, or what is left on the order."}
      loading={editingId != null && loadingExisting}
      saving={saving}
      onSave={handleSave}
      saveLabel={editingId ? "Save changes" : "Save GRN"}
      overlays={
        <>
          <OptionPickerModal visible={picker === "company"} title="Select company" options={companyOptions} selectedKey={form.companyId}
            onSelect={(k) => { const c = companies.find((x) => x.id === k); setForm((f) => ({ ...f, companyId: k, companyName: c?.name ?? "", projectId: "", projectName: "" })); setPicker(null); }}
            onClose={() => setPicker(null)} searchable />
          <OptionPickerModal visible={picker === "project"} title="Select project" options={projectOptions} selectedKey={form.projectId}
            onSelect={(k) => { const p = projects.find((x) => x.id === k); setForm((f) => ({ ...f, projectId: k, projectName: p?.name ?? "" })); setPicker(null); }}
            onClose={() => setPicker(null)} searchable />
          <OptionPickerModal visible={picker === "godown"} title="Select godown" options={godownOptions} selectedKey={form.godownId}
            onSelect={(k) => { const g = godowns.find((x) => String(x.id) === k); setForm((f) => ({ ...f, godownId: k, godownName: g?.name ?? "" })); setPicker(null); }}
            onClose={() => setPicker(null)} searchable clearable />
          <OptionPickerModal visible={picker === "po"} title="Select purchase order" options={poOptions} selectedKey={form.poId}
            onSelect={handlePOSelect} onClose={() => setPicker(null)} searchable />
          <OptionPickerModal visible={picker === "vio"} title="Select vehicle in / out" options={vioOptions} selectedKey={form.vehicleInOutId}
            onSelect={handleVIOSelect} onClose={() => setPicker(null)} searchable loading={loadingVIOs} />
          <OptionPickerModal visible={picker === "finYear"} title="Select financial year" options={finYearOptions} selectedKey={form.finYear}
            onSelect={(k) => { set("finYear", k); setPicker(null); }} onClose={() => setPicker(null)} clearable />
        </>
      }
    >
      <Panel title="Purchase order">
        <View>
          <PickerRow label="Company" value={form.companyName} placeholder="Select company…" onPress={() => setPicker("company")} />
          <PickerRow label="Project" value={form.projectName} placeholder="Select project…" onPress={() => setPicker("project")} />
          <PickerRow
            label={form.projectId ? "Godown (linked to project)" : "Godown"}
            value={form.projectId ? projectGodown?.name ?? "" : form.godownName}
            placeholder="Main godown"
            disabled={!!form.projectId}
            onPress={() => setPicker("godown")}
          />
          <PickerRow label="Purchase order *" value={form.poNumber} placeholder="Select a PO…" onPress={() => setPicker("po")} disabled={editingId != null} />
          {!!form.poId && (
            <PickerRow
              label="Vehicle in / out lot"
              value={form.vehicleInOutDocNo}
              placeholder={loadingVIOs ? "Loading…" : form.grnSourceMode === "remaining" ? "Using remaining items instead" : "Select a lot…"}
              onPress={() => setPicker("vio")}
              disabled={form.grnSourceMode === "remaining" || editingId != null}
            />
          )}
        </View>
        {!!form.supplierName && <InfoGrid items={[{ label: "Supplier", value: form.supplierName, wide: true }]} />}
        {!!form.poId && editingId == null && (
          <View style={{ borderWidth: 1, borderColor: S.line40, padding: 10, gap: 8 }}>
            <Label color={S.ink}>Remaining items on this PO</Label>
            {poRemainingItems.length === 0 || !hasRemainingItems(poRemainingItems) ? (
              <Body size={12} color={S.graphite}>Fully received: nothing left to receive on this PO.</Body>
            ) : (
              <>
                <Body size={12} color={S.graphite}>{`${countRemainingItems(poRemainingItems)} item${countRemainingItems(poRemainingItems) !== 1 ? "s" : ""} still pending.`}</Body>
                <Key
                  tone={form.grnSourceMode === "remaining" ? "ink" : "line"}
                  label={form.grnSourceMode === "remaining" ? "Using remaining items" : "GRN for remaining items"}
                  icon={form.grnSourceMode === "remaining" ? <CheckCircle2 size={13} color={S.paper} /> : <CopyPlus size={13} color={S.ink} />}
                  onPress={handleUseRemainingItems}
                  disabled={loadingPO || form.grnSourceMode === "vehicleInOut"}
                  style={{ alignSelf: "flex-start" }}
                />
              </>
            )}
          </View>
        )}
      </Panel>

      <Panel title="Dates & GRN number">
        <View>
          <ShownValue label="GRN number" value={editingId ? existing?.GRNNo || "—" : docNoPreview?.nextDocNo || "Made on save"} />
        </View>
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Field label="GRN date" style={{ flex: 1 }}>
            <Input value={form.grnDate} onChangeText={(v) => set("grnDate", v)} placeholder="YYYY-MM-DD" />
          </Field>
          <Field label="Doc date" style={{ flex: 1 }}>
            <Input value={form.docDate} onChangeText={(v) => set("docDate", v)} placeholder="YYYY-MM-DD" />
          </Field>
        </View>
        <View>
          <PickerRow label={finYearLocked ? "Financial year · locked to current" : "Financial year"} value={form.finYear} placeholder="Auto" onPress={() => setPicker("finYear")} disabled={finYearLocked} />
        </View>
      </Panel>

      <Panel title={`Received items (${items.length})`} icon={<PackageCheck size={14} color={S.ink} />}>
        {!form.poId ? (
          <Body size={12.5} color={S.graphite} style={{ textAlign: "center", paddingVertical: 16 }}>Select a purchase order above.</Body>
        ) : (
          items.map((item, idx) => (
            <LineBox key={idx} index={idx} title={item.itemName || "—"}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 10 }}>
                <Facts items={[["Ordered", item.orderedQty], ["Pending", item.remainingQty], ["UOM", item.uom || "—"]]} />
                <Body size={13} weight="semibold">{item.totalAmount > 0 ? formatINR(item.totalAmount) : "—"}</Body>
              </View>
              <View style={{ flexDirection: "row", gap: 8 }}>
                {([
                  ["receivedQty", "Received"],
                  ["rate", "Rate ₹"],
                  ["quantity", "Qty bill"],
                ] as const).map(([field, label]) => (
                  <Field key={field} label={label} style={{ flex: 1 }}>
                    {isLocked ? (
                      <View style={{ minHeight: 44, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, borderWidth: 1, borderStyle: "dashed", borderColor: S.line40 }}>
                        <Lock size={10} color={S.graphite} />
                        <Body size={13} color={S.graphite}>{String(item[field])}</Body>
                      </View>
                    ) : (
                      <Input value={String(item[field])} onChangeText={(v) => updateItemField(idx, field, parseFloat(v.replace(/[^0-9.]/g, "")) || 0)} keyboardType="numeric" />
                    )}
                  </Field>
                ))}
              </View>
            </LineBox>
          ))
        )}
        {isLocked && <Body size={11} color={S.graphite}>Quantities are locked to what the vehicle brought in.</Body>}
      </Panel>

      <View>
        <TextField label="Remarks" value={form.remarks} onChangeText={(v) => set("remarks", v)} placeholder="Optional notes" />
      </View>
    </FormPage>
  );
}
