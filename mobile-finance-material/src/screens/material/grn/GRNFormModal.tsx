// RN port of GRN.tsx's create/edit form. Both ways to source a GRN's line
// items are supported (per scope decision, mirroring PO's GST/UOM engine
// and VIO's PO-receiving grid both being core, not trimmable):
//   - Vehicle In/Out mode: pick a pending lot for the PO — quantities are
//     locked to what the vehicle physically brought in.
//   - Remaining mode: "Create GRN for Remaining Items" — editable
//     receivedQty/rate/billing-qty, capped at what's still on the PO.
// A PO only shows up in the picker once ≥1 Vehicle In/Out has been logged
// against it (goods can't be receipted before a vehicle brought them in).
import { useEffect, useMemo, useState } from "react";
import { View, Text, Modal, Pressable, ScrollView, TextInput, Alert, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { X, PackageCheck, Lock, CheckCircle2, CopyPlus } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
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

function todayISO() { return new Date().toISOString().slice(0, 10); }

function blankForm(): FormState {
  return {
    companyId: "", companyName: "", projectId: "", projectName: "", godownId: "", godownName: "",
    poId: "", poNumber: "", supplierId: "", supplierName: "", vehicleInOutId: "", vehicleInOutDocNo: "",
    grnSourceMode: "", grnDate: todayISO(), docDate: todayISO(), finYear: "", remarks: "",
    parentDocNo: "", rootExBDocNo: "", poTotalAmount: 0,
  };
}

function FieldLabel({ children, required }: { children: string; required?: boolean }) {
  return (
    <Text style={{ color: colors.mutedForeground, fontSize: 10, fontFamily: fonts.body.medium, marginBottom: 5, textTransform: "uppercase", letterSpacing: 0.4 }}>
      {children}{required ? " *" : ""}
    </Text>
  );
}

function TextField({ value, onChangeText, placeholder }: { value: string; onChangeText: (v: string) => void; placeholder?: string }) {
  return (
    <TextInput
      value={value} onChangeText={onChangeText} placeholder={placeholder}
      placeholderTextColor={`${colors.mutedForeground}99`}
      style={{
        borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10,
        color: colors.foreground, fontFamily: fonts.body.regular, fontSize: 13, marginBottom: 14,
      }}
    />
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <Text style={{ color: colors.mutedForeground, fontSize: 10.5, fontFamily: fonts.heading.semibold, textTransform: "uppercase", letterSpacing: 0.6, marginTop: 8, marginBottom: 10 }}>
      {children}
    </Text>
  );
}

const round3 = (n: number) => Math.round((Number(n) || 0) * 1000) / 1000;

export function GRNFormModal({
  visible, editingId, onClose,
}: { visible: boolean; editingId: number | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
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
  const godownOptions: PickerOption[] = godowns.map((g) => ({ key: String(g.id), label: g.name }));
  const finYearOptions: PickerOption[] = finYears.map((f) => ({ key: f.label, label: f.label }));

  const isLocked = form.grnSourceMode === "vehicleInOut";

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <View style={{ paddingTop: insets.top + 8 }} className="flex-row items-center justify-between px-4 pb-3">
          <View className="flex-row items-center gap-2.5">
            <View className="w-8 h-8 rounded-lg items-center justify-center" style={{ backgroundColor: "#10b98126" }}>
              <PackageCheck size={14} color="#10b981" />
            </View>
            <Text style={{ color: colors.foreground, fontSize: 14, fontFamily: fonts.heading.semibold }}>{editingId ? "Edit GRN" : "New GRN"}</Text>
          </View>
          <Pressable onPress={onClose} className="w-8 h-8 rounded-lg items-center justify-center" style={{ borderWidth: 1, borderColor: colors.border }}>
            <X size={15} color={colors.mutedForeground} />
          </Pressable>
        </View>

        {loadingExisting ? (
          <View className="flex-1 items-center justify-center"><ActivityIndicator color={colors.mutedForeground} /></View>
        ) : (
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 16 }} keyboardShouldPersistTaps="handled">
            <SectionHeading>Purchase Order</SectionHeading>
            <PickerRow label="Company" value={form.companyName} onPress={() => setPicker("company")} />
            <PickerRow label="Project" value={form.projectName} onPress={() => setPicker("project")} />
            <PickerRow label="Godown" value={form.godownName} placeholder="Main Godown" onPress={() => setPicker("godown")} />
            <PickerRow label="Purchase Order" value={form.poNumber} onPress={() => setPicker("po")} disabled={editingId != null} />

            {!!form.poId && (
              <PickerRow
                label="Vehicle In/Out Document" value={form.vehicleInOutDocNo}
                placeholder={loadingVIOs ? "Loading…" : form.grnSourceMode === "remaining" ? "Using remaining items instead" : "Select a lot…"}
                onPress={() => setPicker("vio")} disabled={form.grnSourceMode === "remaining" || editingId != null}
              />
            )}

            {!!form.poId && editingId == null && (
              <View className="rounded-xl p-3.5 mb-4" style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: `${colors.card}80` }}>
                <Text style={{ color: colors.mutedForeground, fontSize: 10.5, fontFamily: fonts.heading.semibold, textTransform: "uppercase", marginBottom: 8 }}>
                  Remaining Items on this PO
                </Text>
                {poRemainingItems.length === 0 || !hasRemainingItems(poRemainingItems) ? (
                  <Text style={{ color: colors.mutedForeground, fontSize: 11.5 }}>Fully received — no quantity left to receive on this PO.</Text>
                ) : (
                  <>
                    <Text style={{ color: colors.mutedForeground, fontSize: 11, marginBottom: 8 }}>
                      {countRemainingItems(poRemainingItems)} item{countRemainingItems(poRemainingItems) !== 1 ? "s" : ""} still pending.
                    </Text>
                    <Pressable
                      onPress={handleUseRemainingItems}
                      disabled={loadingPO || form.grnSourceMode === "vehicleInOut"}
                      className="flex-row items-center gap-1.5 self-start px-3 py-1.5 rounded-lg"
                      style={{
                        borderWidth: 1,
                        borderColor: form.grnSourceMode === "remaining" ? "#05966966" : form.grnSourceMode === "vehicleInOut" ? colors.border : "#05966950",
                        backgroundColor: form.grnSourceMode === "remaining" ? "#05966915" : "transparent",
                        opacity: form.grnSourceMode === "vehicleInOut" ? 0.5 : 1,
                      }}
                    >
                      {form.grnSourceMode === "remaining" ? <CheckCircle2 size={13} color="#059669" /> : <CopyPlus size={13} color="#059669" />}
                      <Text style={{ color: "#059669", fontSize: 11.5, fontFamily: fonts.heading.semibold }}>
                        {form.grnSourceMode === "remaining" ? "Using Remaining Items" : "Create GRN for Remaining Items"}
                      </Text>
                    </Pressable>
                  </>
                )}
              </View>
            )}

            {!!form.supplierName && (
              <View className="flex-row flex-wrap gap-2 mb-4">
                <View className="px-2.5 py-1 rounded-lg" style={{ backgroundColor: `${colors.muted}30`, borderWidth: 1, borderColor: colors.border }}>
                  <Text style={{ color: colors.mutedForeground, fontSize: 9.5 }}>Supplier</Text>
                  <Text style={{ color: colors.foreground, fontSize: 11 }}>{form.supplierName}</Text>
                </View>
              </View>
            )}

            <SectionHeading>Dates &amp; GRN Number</SectionHeading>
            <FieldLabel>GRN Date</FieldLabel>
            <TextField value={form.grnDate} onChangeText={(v) => set("grnDate", v)} placeholder="YYYY-MM-DD" />
            <FieldLabel>Doc Date</FieldLabel>
            <TextField value={form.docDate} onChangeText={(v) => set("docDate", v)} placeholder="YYYY-MM-DD" />
            <PickerRow label="Financial Year" value={form.finYear} placeholder="Auto" onPress={() => setPicker("finYear")} />
            <View className="rounded-xl px-3.5 py-3 mb-4" style={{ borderWidth: 1, borderColor: colors.border, borderStyle: "dashed" }}>
              <Text style={{ color: colors.mutedForeground, fontSize: 10, textTransform: "uppercase" }}>GRN Number</Text>
              <Text style={{ color: colors.primary, fontSize: 13, fontFamily: fonts.heading.semibold, marginTop: 2 }}>
                {editingId ? (existing?.GRNNo || "—") : (docNoPreview?.nextDocNo || "Auto-generated on save")}
              </Text>
            </View>

            <SectionHeading>Received Items ({items.length})</SectionHeading>
            {!form.poId ? (
              <View className="rounded-xl py-8 items-center mb-4" style={{ borderWidth: 1, borderColor: colors.border, borderStyle: "dashed" }}>
                <Text style={{ color: `${colors.mutedForeground}99`, fontSize: 12, fontStyle: "italic" }}>Select a Purchase Order above</Text>
              </View>
            ) : (
              items.map((item, idx) => (
                <View key={idx} className="rounded-xl p-3 mb-2.5" style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: `${colors.card}80` }}>
                  <View className="flex-row items-center justify-between mb-2">
                    <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 12.5, fontFamily: fonts.body.semibold, flex: 1, marginRight: 8 }}>{item.itemName || "—"}</Text>
                    <View className="px-1.5 py-0.5 rounded-full" style={{ backgroundColor: `${colors.muted}50` }}>
                      <Text style={{ color: colors.mutedForeground, fontSize: 9.5 }}>{item.uom || "—"}</Text>
                    </View>
                  </View>
                  <View className="flex-row justify-between mb-2.5">
                    <View>
                      <Text style={{ color: colors.mutedForeground, fontSize: 9, textTransform: "uppercase" }}>Ordered</Text>
                      <Text style={{ color: colors.foreground, fontSize: 11.5, marginTop: 1 }}>{item.orderedQty}</Text>
                    </View>
                    <View>
                      <Text style={{ color: colors.mutedForeground, fontSize: 9, textTransform: "uppercase" }}>Pending</Text>
                      <Text style={{ color: item.remainingQty > 0 ? "#d97706" : "#059669", fontSize: 11.5, marginTop: 1, fontFamily: fonts.body.semibold }}>{item.remainingQty}</Text>
                    </View>
                    <View style={{ alignItems: "flex-end" }}>
                      <Text style={{ color: colors.mutedForeground, fontSize: 9, textTransform: "uppercase" }}>Total</Text>
                      <Text style={{ color: "#059669", fontSize: 12, fontFamily: fonts.heading.bold, marginTop: 1 }}>{item.totalAmount > 0 ? formatINR(item.totalAmount) : "—"}</Text>
                    </View>
                  </View>

                  <View className="flex-row gap-2">
                    {([
                      ["receivedQty", "Received"], ["rate", "Rate ₹"], ["quantity", "Qty Bill"],
                    ] as const).map(([field, label]) => (
                      <View key={field} style={{ flex: 1 }}>
                        <Text style={{ color: colors.mutedForeground, fontSize: 9, textTransform: "uppercase" }}>{label}</Text>
                        {isLocked ? (
                          <View className="flex-row items-center gap-1 rounded-lg px-2.5 py-2 mt-1" style={{ backgroundColor: `${colors.muted}30`, borderWidth: 1, borderColor: colors.border }}>
                            <Lock size={9} color={colors.mutedForeground} />
                            <Text numberOfLines={1} style={{ color: colors.mutedForeground, fontSize: 11.5 }}>{item[field]}</Text>
                          </View>
                        ) : (
                          <TextInput
                            value={String(item[field])}
                            onChangeText={(v) => updateItemField(idx, field, parseFloat(v.replace(/[^0-9.]/g, "")) || 0)}
                            keyboardType="numeric"
                            style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, color: colors.foreground, fontSize: 12, marginTop: 3 }}
                          />
                        )}
                      </View>
                    ))}
                  </View>
                </View>
              ))
            )}

            <FieldLabel>Remarks</FieldLabel>
            <TextField value={form.remarks} onChangeText={(v) => set("remarks", v)} placeholder="Optional notes" />
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
              <Text style={{ color: "#fff", fontSize: 12.5, fontFamily: fonts.heading.semibold }}>{editingId ? "Save Changes" : "Save GRN"}</Text>
            )}
          </Pressable>
        </View>
      </View>

      <OptionPickerModal visible={picker === "company"} title="Select Company" options={companyOptions} selectedKey={form.companyId}
        onSelect={(k) => { const c = companies.find((x) => x.id === k); setForm((f) => ({ ...f, companyId: k, companyName: c?.name ?? "", projectId: "", projectName: "" })); setPicker(null); }}
        onClose={() => setPicker(null)} searchable />
      <OptionPickerModal visible={picker === "project"} title="Select Project" options={projectOptions} selectedKey={form.projectId}
        onSelect={(k) => { const p = projects.find((x) => x.id === k); setForm((f) => ({ ...f, projectId: k, projectName: p?.name ?? "" })); setPicker(null); }}
        onClose={() => setPicker(null)} searchable />
      <OptionPickerModal visible={picker === "godown"} title="Select Godown" options={godownOptions} selectedKey={form.godownId}
        onSelect={(k) => { const g = godowns.find((x) => String(x.id) === k); setForm((f) => ({ ...f, godownId: k, godownName: g?.name ?? "" })); setPicker(null); }}
        onClose={() => setPicker(null)} searchable clearable />
      <OptionPickerModal visible={picker === "po"} title="Select Purchase Order" options={poOptions} selectedKey={form.poId}
        onSelect={handlePOSelect} onClose={() => setPicker(null)} searchable />
      <OptionPickerModal visible={picker === "vio"} title="Select Vehicle In/Out" options={vioOptions} selectedKey={form.vehicleInOutId}
        onSelect={handleVIOSelect} onClose={() => setPicker(null)} searchable loading={loadingVIOs} />
      <OptionPickerModal visible={picker === "finYear"} title="Select Financial Year" options={finYearOptions} selectedKey={form.finYear}
        onSelect={(k) => { set("finYear", k); setPicker(null); }} onClose={() => setPicker(null)} clearable />
    </Modal>
  );
}
