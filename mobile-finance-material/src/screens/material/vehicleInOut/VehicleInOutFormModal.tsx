// RN port of VehicleInOut.tsx's create/edit form (Document Details / PO &
// Supplier / Vehicle Details sections). Web renders this inline in the
// page; mobile uses a full-screen modal, matching this app's established
// convention (PaymentFormModal.tsx, ReceivedPaymentFormModal.tsx).
// Deferred vs. web: CSV import/export, Print — both stay web-only.
import { useEffect, useMemo, useState } from "react";
import { View, Text, Modal, Pressable, ScrollView, TextInput, Alert, ActivityIndicator, Image } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as ImagePicker from "expo-image-picker";
import { X, Truck, Camera as CameraIcon, Paperclip, FileText } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import {
  getVehicleInOut, getPOItemsRemaining, previewNextVEHNumber, createVehicleInOut, updateVehicleInOut,
  uploadVehicleAttachments, deleteVehicleAttachment,
  fetchCompanyOptions, fetchProjectOptions, fetchSupplierOptions, fetchPurchaseOrders, fetchFinYearOptions,
  type VehicleInOutPayload, type VehicleAttachment, type POItemRemaining, type PickedFile,
} from "@/api/vehicleInOutApi";
import { PickerRow, OptionPickerModal, type PickerOption } from "@/screens/finance/payment/OptionPicker";

type FormState = {
  companyId: string;
  companyName: string;
  projectId: string;
  projectName: string;
  finYear: string;
  supplierId: string;
  supplierName: string;
  poId: string;
  poNumber: string;
  vehicleNo: string;
  entryTime: string;
  exitTime: string;
  challanNo: string;
  remarks: string;
  attachments: VehicleAttachment[];
};

function nowLocal() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function blankForm(): FormState {
  return {
    companyId: "", companyName: "", projectId: "", projectName: "", finYear: "",
    supplierId: "", supplierName: "", poId: "", poNumber: "",
    vehicleNo: "", entryTime: nowLocal(), exitTime: "", challanNo: "", remarks: "",
    attachments: [],
  };
}

function FieldLabel({ children, required }: { children: string; required?: boolean }) {
  return (
    <Text style={{ color: colors.mutedForeground, fontSize: 10, fontFamily: fonts.body.medium, marginBottom: 5, textTransform: "uppercase", letterSpacing: 0.4 }}>
      {children}{required ? " *" : ""}
    </Text>
  );
}

function TextField({ value, onChangeText, placeholder, keyboardType, disabled }: {
  value: string; onChangeText: (v: string) => void; placeholder?: string; keyboardType?: "default" | "numeric"; disabled?: boolean;
}) {
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={`${colors.mutedForeground}99`}
      keyboardType={keyboardType}
      editable={!disabled}
      style={{
        borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10,
        color: colors.foreground, fontFamily: fonts.body.regular, fontSize: 13, marginBottom: 14,
        opacity: disabled ? 0.6 : 1,
      }}
    />
  );
}

function validateForm(f: FormState): string | null {
  if (!f.companyId) return "Company is required.";
  if (!f.projectId) return "Project is required.";
  if (!f.vehicleNo.trim()) return "Vehicle number is required.";
  if (!f.entryTime) return "Entry time is required.";
  return null;
}

export function VehicleInOutFormModal({
  visible, editingId, onClose,
}: { visible: boolean; editingId: number | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(blankForm());
  const [receivedQtyByItem, setReceivedQtyByItem] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [picker, setPicker] = useState<"company" | "project" | "finYear" | "supplier" | "po" | null>(null);

  const { data: companies = [] } = useQuery({ queryKey: ["veh-form-companies"], queryFn: fetchCompanyOptions, enabled: visible });
  const { data: projects = [] } = useQuery({ queryKey: ["veh-form-projects"], queryFn: fetchProjectOptions, enabled: visible });
  const { data: finYears = [] } = useQuery({ queryKey: ["veh-form-finyears"], queryFn: fetchFinYearOptions, enabled: visible });
  const { data: suppliers = [] } = useQuery({ queryKey: ["veh-form-suppliers"], queryFn: fetchSupplierOptions, enabled: visible });
  const { data: allPOs = [] } = useQuery({ queryKey: ["veh-form-pos"], queryFn: fetchPurchaseOrders, enabled: visible });

  const { data: docNoPreview } = useQuery({
    queryKey: ["veh-next-docno"],
    queryFn: previewNextVEHNumber,
    enabled: visible && !editingId,
    staleTime: 15_000,
  });

  const { data: existing, isLoading: loadingExisting } = useQuery({
    queryKey: ["veh-editing-record", editingId],
    queryFn: () => getVehicleInOut(editingId!),
    enabled: visible && editingId != null,
  });

  // Reset (or prefill from `existing`) whenever the modal opens or the record it's editing changes.
  useEffect(() => {
    if (!visible) return;
    if (editingId == null) {
      setForm(blankForm());
      setReceivedQtyByItem({});
      return;
    }
    if (existing) {
      setForm({
        companyId: existing.CompanyID ? String(existing.CompanyID) : "",
        companyName: existing.CompanyName || "",
        projectId: existing.ProjectID ? String(existing.ProjectID) : "",
        projectName: existing.ProjectName || "",
        finYear: existing.FinYear || "",
        supplierId: existing.SupplierID ? String(existing.SupplierID) : "",
        supplierName: existing.SupplierName || "",
        poId: existing.POID ? String(existing.POID) : "",
        poNumber: existing.PONumber || "",
        vehicleNo: existing.VehicleNo || "",
        entryTime: existing.EntryTime ? existing.EntryTime.slice(0, 16) : nowLocal(),
        exitTime: existing.ExitTime ? existing.ExitTime.slice(0, 16) : "",
        challanNo: existing.ChallanNo || "",
        remarks: existing.Remarks || "",
        attachments: existing.Attachments ?? [],
      });
      setReceivedQtyByItem(
        Object.fromEntries((existing.Items ?? []).map((it) => [it.POItemId, String(it.ReceivedQty)])),
      );
    }
  }, [visible, editingId, existing]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  const filteredProjects = useMemo(
    () => (form.companyId ? projects.filter((p) => String(p.company_id ?? "") === form.companyId) : projects),
    [projects, form.companyId],
  );

  const filteredPOs = useMemo(() => allPOs.filter((po) => {
    if (!["Approved", "Pending", "Received"].includes(po.Status)) return false;
    if (form.companyId && String(po.CompanyId ?? "") !== form.companyId) return false;
    if (form.projectId && String(po.ProjectId ?? "") !== form.projectId) return false;
    return true;
  }), [allPOs, form.companyId, form.projectId]);

  const { data: poItemsRemaining = [], isFetching: loadingPOItems } = useQuery<POItemRemaining[]>({
    queryKey: ["veh-po-items-remaining", form.poId, editingId],
    queryFn: () => getPOItemsRemaining(Number(form.poId), editingId ?? undefined),
    enabled: !!form.poId,
  });

  const itemsPayload = useMemo(
    () => Object.entries(receivedQtyByItem)
      .map(([poItemId, raw]) => ({ poItemId: Number(poItemId), receivedQty: parseFloat(raw) || 0 }))
      .filter((it) => it.receivedQty > 0),
    [receivedQtyByItem],
  );

  const onCompanyChange = (id: string) => {
    const c = companies.find((x) => String(x.id) === id);
    setForm((f) => ({ ...f, companyId: id, companyName: c?.label ?? "", projectId: "", projectName: "", poId: "", poNumber: "", supplierId: "", supplierName: "" }));
    setReceivedQtyByItem({});
    setPicker(null);
  };
  const onProjectChange = (id: string) => {
    const p = projects.find((x) => String(x.id) === id);
    setForm((f) => ({ ...f, projectId: id, projectName: p?.label ?? "", poId: "", poNumber: "", supplierId: "", supplierName: "" }));
    setReceivedQtyByItem({});
    setPicker(null);
  };
  const onPOChange = (id: string) => {
    if (!id) {
      setForm((f) => ({ ...f, poId: "", poNumber: "" }));
      setReceivedQtyByItem({});
      setPicker(null);
      return;
    }
    const po = filteredPOs.find((x) => String(x.PurchaseOrderID) === id);
    setForm((f) => ({
      ...f, poId: id, poNumber: po?.DocNo || po?.PurchaseOrderNo || "",
      supplierId: po?.SupplierID ? String(po.SupplierID) : "", supplierName: po?.SupplierName ?? "",
      companyId: po?.CompanyId ? String(po.CompanyId) : f.companyId,
      projectId: po?.ProjectId ? String(po.ProjectId) : f.projectId,
    }));
    setReceivedQtyByItem({});
    setPicker(null);
  };
  const onSupplierChange = (id: string) => {
    const s = suppliers.find((x) => String(x.id) === id);
    setForm((f) => ({ ...f, supplierId: id, supplierName: s?.label ?? "" }));
    setPicker(null);
  };

  const handleQtyChange = (it: POItemRemaining, raw: string) => {
    const entered = parseFloat(raw) || 0;
    if (entered > it.remainingQty + 1e-6) {
      Alert.alert("Over limit", `${it.itemName || "Item"}: quantity can't be greater than ${it.remainingQty} ${it.uomName || ""}`.trim());
    }
    setReceivedQtyByItem((prev) => ({ ...prev, [it.poItemId]: raw }));
  };

  const pickAndUpload = async (source: "library" | "camera") => {
    const perm = source === "library"
      ? await ImagePicker.requestMediaLibraryPermissionsAsync()
      : await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Permission needed", source === "library" ? "Photo library access is needed to attach a photo." : "Camera access is needed to take a photo.");
      return;
    }
    const result = source === "library"
      ? await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.7, allowsMultipleSelection: true })
      : await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.7 });
    if (result.canceled || !result.assets?.length) return;

    const files: PickedFile[] = result.assets.map((asset, i) => ({
      uri: asset.uri,
      name: asset.fileName || `photo-${Date.now()}-${i}.jpg`,
      type: asset.mimeType || "image/jpeg",
    }));

    setUploading(true);
    try {
      const res = await uploadVehicleAttachments(files);
      setForm((f) => ({ ...f, attachments: [...f.attachments, ...res.attachments] }));
    } catch (err: any) {
      Alert.alert("Upload failed", err.message ?? "Something went wrong.");
    } finally {
      setUploading(false);
    }
  };

  const removeAttachment = async (attachmentId: number) => {
    const prev = form.attachments;
    setForm((f) => ({ ...f, attachments: f.attachments.filter((a) => a.id !== attachmentId) }));
    try {
      await deleteVehicleAttachment(attachmentId);
    } catch (err: any) {
      setForm((f) => ({ ...f, attachments: prev }));
      Alert.alert("Failed to remove attachment", err.message ?? "Something went wrong.");
    }
  };

  const handleSave = async () => {
    const error = validateForm(form);
    if (error) {
      Alert.alert("Check the form", error);
      return;
    }
    for (const it of itemsPayload) {
      const po = poItemsRemaining.find((p) => p.poItemId === it.poItemId);
      if (po && it.receivedQty > po.remainingQty + 1e-6) {
        Alert.alert("Check the form", `${po.itemName || "An item"}: cannot receive ${it.receivedQty} — only ${po.remainingQty} remaining on the PO.`);
        return;
      }
    }
    const payload: VehicleInOutPayload = {
      docDate: new Date().toISOString().slice(0, 10),
      companyId: form.companyId ? Number(form.companyId) : null,
      projectId: form.projectId ? Number(form.projectId) : null,
      finYear: form.finYear || null,
      supplierId: form.supplierId ? Number(form.supplierId) : null,
      supplierName: form.supplierName,
      poId: form.poId ? Number(form.poId) : null,
      poNumber: form.poNumber,
      vehicleNo: form.vehicleNo.trim().toUpperCase(),
      entryTime: form.entryTime,
      exitTime: form.exitTime || null,
      challanNo: form.challanNo,
      attachmentIds: form.attachments.map((a) => a.id),
      remarks: form.remarks,
      items: itemsPayload,
    };
    setSaving(true);
    try {
      if (editingId) {
        await updateVehicleInOut(editingId, payload);
        Alert.alert("Saved", "Record updated.");
      } else {
        const res = await createVehicleInOut(payload);
        Alert.alert("Saved", `Vehicle In/Out ${res.docNo} created.`);
      }
      queryClient.invalidateQueries({ queryKey: ["vehicle-in-out-mobile"], exact: false });
      onClose();
    } catch (err: any) {
      Alert.alert("Failed to save", err.message ?? "Something went wrong.");
    } finally {
      setSaving(false);
    }
  };

  const companyOptions: PickerOption[] = companies.map((c) => ({ key: String(c.id), label: c.label }));
  const projectOptions: PickerOption[] = filteredProjects.map((p) => ({ key: String(p.id), label: p.label }));
  const finYearOptions: PickerOption[] = finYears.map((f) => ({ key: f.label, label: f.label }));
  const supplierOptions: PickerOption[] = suppliers.map((s) => ({ key: String(s.id), label: s.label }));
  const poOptions: PickerOption[] = filteredPOs.map((po) => ({
    key: String(po.PurchaseOrderID), label: po.DocNo || po.PurchaseOrderNo || `PO #${po.PurchaseOrderID}`,
    sublabel: po.SupplierName ?? undefined,
  }));

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <View style={{ paddingTop: insets.top + 8 }} className="flex-row items-center justify-between px-4 pb-3">
          <View className="flex-row items-center gap-2.5">
            <View className="w-8 h-8 rounded-lg items-center justify-center" style={{ backgroundColor: "#3b82f626" }}>
              <Truck size={14} color="#3b82f6" />
            </View>
            <Text style={{ color: colors.foreground, fontSize: 14, fontFamily: fonts.heading.semibold }}>
              {editingId ? "Edit Vehicle Entry" : "New Vehicle Entry"}
            </Text>
          </View>
          <Pressable onPress={onClose} className="w-8 h-8 rounded-lg items-center justify-center" style={{ borderWidth: 1, borderColor: colors.border }}>
            <X size={15} color={colors.mutedForeground} />
          </Pressable>
        </View>

        {loadingExisting ? (
          <View className="flex-1 items-center justify-center"><ActivityIndicator color={colors.mutedForeground} /></View>
        ) : (
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 16 }} keyboardShouldPersistTaps="handled">
            <Text style={{ color: colors.mutedForeground, fontSize: 10.5, fontFamily: fonts.heading.semibold, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 10 }}>
              Document Details
            </Text>
            <PickerRow label="Company" value={form.companyName} onPress={() => setPicker("company")} />
            <PickerRow label="Project" value={form.projectName} onPress={() => setPicker("project")} />
            <PickerRow label="Financial Year" value={form.finYear} onPress={() => setPicker("finYear")} />
            <View className="rounded-xl px-3.5 py-3 mb-4" style={{ borderWidth: 1, borderColor: colors.border, borderStyle: "dashed" }}>
              <Text style={{ color: colors.mutedForeground, fontSize: 10, textTransform: "uppercase" }}>Doc Number</Text>
              <Text style={{ color: colors.primary, fontSize: 13, fontFamily: fonts.heading.semibold, marginTop: 2 }}>
                {editingId ? (existing?.DocNo || "—") : (docNoPreview?.nextDocNo || "Auto-generated on save")}
              </Text>
            </View>
            <FieldLabel>Remarks</FieldLabel>
            <TextField value={form.remarks} onChangeText={(v) => set("remarks", v)} placeholder="Optional notes" />

            <Text style={{ color: colors.mutedForeground, fontSize: 10.5, fontFamily: fonts.heading.semibold, textTransform: "uppercase", letterSpacing: 0.6, marginTop: 6, marginBottom: 10 }}>
              Purchase Order &amp; Supplier
            </Text>
            <PickerRow label="Purchase Order" value={form.poNumber} placeholder="No PO linked" onPress={() => setPicker("po")} />
            <PickerRow label="Supplier" value={form.supplierName} onPress={() => setPicker("supplier")} disabled={!!form.poId} />

            {!!form.poId && (
              <View className="rounded-xl overflow-hidden mb-4" style={{ borderWidth: 1, borderColor: colors.border }}>
                <View className="px-3.5 py-2.5" style={{ backgroundColor: `${colors.muted}30`, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                  <Text style={{ color: colors.mutedForeground, fontSize: 10, fontFamily: fonts.heading.semibold, textTransform: "uppercase" }}>
                    PO Items — Qty Received (This Lot)
                  </Text>
                </View>
                {loadingPOItems ? (
                  <View className="py-6 items-center"><ActivityIndicator size="small" color={colors.mutedForeground} /></View>
                ) : poItemsRemaining.length === 0 ? (
                  <Text style={{ color: colors.mutedForeground, fontSize: 12, textAlign: "center", paddingVertical: 16 }}>No items on this PO.</Text>
                ) : (
                  poItemsRemaining.map((it, i) => {
                    const raw = receivedQtyByItem[it.poItemId] ?? "";
                    const entered = parseFloat(raw) || 0;
                    const overLimit = entered > it.remainingQty + 1e-6;
                    return (
                      <View key={it.poItemId} className="px-3.5 py-3" style={{ borderTopWidth: i > 0 ? 1 : 0, borderTopColor: `${colors.border}80` }}>
                        <View className="flex-row items-center justify-between mb-1.5">
                          <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 12, fontFamily: fonts.body.semibold, flex: 1, marginRight: 8 }}>
                            {it.itemName || "—"}
                          </Text>
                          <Text style={{ color: colors.mutedForeground, fontSize: 10.5 }}>
                            Remaining {it.remainingQty} {it.uomName || ""}
                          </Text>
                        </View>
                        <View className="flex-row items-center justify-between">
                          <Text style={{ color: colors.mutedForeground, fontSize: 10 }}>
                            Ordered {it.orderedQty} · Received so far {it.receivedSoFar}
                          </Text>
                          <TextInput
                            value={raw}
                            onChangeText={(v) => handleQtyChange(it, v.replace(/[^0-9.]/g, ""))}
                            placeholder="0"
                            keyboardType="numeric"
                            editable={it.remainingQty > 0}
                            style={{
                              width: 80, textAlign: "right", borderWidth: 1, borderColor: overLimit ? "#dc2626" : colors.border,
                              borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, color: overLimit ? "#dc2626" : colors.foreground, fontSize: 12.5,
                              opacity: it.remainingQty > 0 ? 1 : 0.5,
                            }}
                          />
                        </View>
                      </View>
                    );
                  })
                )}
              </View>
            )}

            <Text style={{ color: colors.mutedForeground, fontSize: 10.5, fontFamily: fonts.heading.semibold, textTransform: "uppercase", letterSpacing: 0.6, marginTop: 6, marginBottom: 10 }}>
              Vehicle Details
            </Text>
            <FieldLabel required>Vehicle Number</FieldLabel>
            <TextField value={form.vehicleNo} onChangeText={(v) => set("vehicleNo", v.toUpperCase())} placeholder="e.g. WB-01-AB-1234" />

            <FieldLabel required>Entry Time</FieldLabel>
            <TextField value={form.entryTime} onChangeText={(v) => set("entryTime", v)} placeholder="YYYY-MM-DDTHH:mm" />

            <FieldLabel>Exit Time</FieldLabel>
            <TextField value={form.exitTime} onChangeText={(v) => set("exitTime", v)} placeholder="Leave blank if not yet exited" />

            <FieldLabel>Supplier Ref / Challan No</FieldLabel>
            <TextField value={form.challanNo} onChangeText={(v) => set("challanNo", v)} placeholder="e.g. CH-20240601-001" />

            <FieldLabel>Attachments</FieldLabel>
            <View className="flex-row gap-2 mb-3">
              <Pressable
                onPress={() => pickAndUpload("library")}
                disabled={uploading}
                className="flex-row items-center gap-1.5 px-3 py-2 rounded-lg"
                style={{ borderWidth: 1, borderColor: colors.border, opacity: uploading ? 0.6 : 1 }}
              >
                <Paperclip size={12} color={colors.mutedForeground} />
                <Text style={{ color: colors.mutedForeground, fontSize: 11.5, fontFamily: fonts.body.medium }}>{uploading ? "Uploading…" : "Attach Photos"}</Text>
              </Pressable>
              <Pressable
                onPress={() => pickAndUpload("camera")}
                disabled={uploading}
                className="flex-row items-center gap-1.5 px-3 py-2 rounded-lg"
                style={{ borderWidth: 1, borderColor: colors.border, opacity: uploading ? 0.6 : 1 }}
              >
                <CameraIcon size={12} color={colors.mutedForeground} />
                <Text style={{ color: colors.mutedForeground, fontSize: 11.5, fontFamily: fonts.body.medium }}>Camera</Text>
              </Pressable>
            </View>

            {form.attachments.length > 0 && (
              <View className="flex-row flex-wrap gap-2 mb-2">
                {form.attachments.map((a) => (
                  <View key={a.id} className="rounded-lg overflow-hidden" style={{ width: 64, height: 64, borderWidth: 1, borderColor: colors.border }}>
                    {a.mimeType?.startsWith("image/") ? (
                      <Image source={{ uri: a.url }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
                    ) : (
                      <View className="flex-1 items-center justify-center" style={{ backgroundColor: `${colors.muted}40` }}>
                        <FileText size={18} color={colors.mutedForeground} />
                      </View>
                    )}
                    <Pressable
                      onPress={() => removeAttachment(a.id)}
                      style={{ position: "absolute", top: 2, right: 2, width: 16, height: 16, borderRadius: 8, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center" }}
                    >
                      <X size={10} color="#fff" />
                    </Pressable>
                  </View>
                ))}
              </View>
            )}
          </ScrollView>
        )}

        <View className="flex-row gap-2.5 px-4" style={{ paddingBottom: insets.bottom + 14, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border }}>
          <Pressable onPress={onClose} className="px-5 py-3 rounded-xl items-center justify-center" style={{ borderWidth: 1, borderColor: colors.border }}>
            <Text style={{ color: colors.mutedForeground, fontSize: 12.5, fontFamily: fonts.heading.medium }}>Cancel</Text>
          </Pressable>
          <Pressable
            onPress={handleSave}
            disabled={saving}
            className="flex-1 items-center justify-center py-3 rounded-xl"
            style={{ backgroundColor: colors.primary, opacity: saving ? 0.7 : 1 }}
          >
            {saving ? <ActivityIndicator size="small" color="#fff" /> : (
              <Text style={{ color: "#fff", fontSize: 12.5, fontFamily: fonts.heading.semibold }}>{editingId ? "Save Changes" : "Save Entry"}</Text>
            )}
          </Pressable>
        </View>
      </View>

      <OptionPickerModal visible={picker === "company"} title="Select Company" options={companyOptions} selectedKey={form.companyId} onSelect={onCompanyChange} onClose={() => setPicker(null)} searchable />
      <OptionPickerModal visible={picker === "project"} title="Select Project" options={projectOptions} selectedKey={form.projectId} onSelect={onProjectChange} onClose={() => setPicker(null)} searchable />
      <OptionPickerModal visible={picker === "finYear"} title="Select Financial Year" options={finYearOptions} selectedKey={form.finYear} onSelect={(k) => { set("finYear", k); setPicker(null); }} onClose={() => setPicker(null)} />
      <OptionPickerModal visible={picker === "supplier"} title="Select Supplier" options={supplierOptions} selectedKey={form.supplierId} onSelect={onSupplierChange} onClose={() => setPicker(null)} searchable />
      <OptionPickerModal visible={picker === "po"} title="Select Purchase Order" options={poOptions} selectedKey={form.poId} onSelect={onPOChange} onClose={() => setPicker(null)} searchable clearable />
    </Modal>
  );
}
