// RN port of VehicleInOut.tsx's create/edit form (Document Details / PO &
// Supplier / Vehicle Details sections), on the drawing sheet. Web renders this inline in the page; mobile shows it as a
// page of the stack (asScreen, from VehicleInOutFormScreen) with Cancel / Save along its foot.
// Deferred vs. web: CSV import/export, Print — both stay web-only.
import { istNowInput, istToday } from "@/utils/istTime";
import { useLockedFinYear } from "@/hooks/useLockedFinYear";
import { useEffect, useMemo, useState } from "react";
import { View, Pressable, Alert } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as ImagePicker from "expo-image-picker";
import { X, Truck, Camera as CameraIcon, Paperclip, FileText } from "lucide-react-native";
import { sheet as S } from "@/theme/colors";
import { Body, Field, Input, Key, Label, Panel, Skel } from "@/components/sheet/Sheet";
import { TextField } from "@/components/sheet/FormParts";
import { FormPage, ShownValue } from "@/components/sheet/Register";
import {
  getVehicleInOut, getPOItemsRemaining, previewNextVEHNumber, createVehicleInOut, updateVehicleInOut,
  uploadVehicleAttachments, deleteVehicleAttachment,
  fetchCompanyOptions, fetchProjectOptions, fetchSupplierOptions, fetchPurchaseOrders, fetchFinYearOptions,
  type VehicleInOutPayload, type VehicleAttachment, type POItemRemaining, type PickedFile,
} from "@/api/vehicleInOutApi";
import { PickerRow, OptionPickerModal, type PickerOption } from "@/screens/finance/payment/OptionPicker";
import { DateTimeField } from "@/components/DateTimeField";
import { AuthImage } from "@/components/AuthImage";
import { ImagePreviewModal } from "@/components/ImagePreviewModal";

/** `localUri` is the copy on this phone, so a photo just taken previews instantly. */
type FormAttachment = VehicleAttachment & { localUri?: string };

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
  attachments: FormAttachment[];
};

// India time, whatever zone the phone is set to (the server stores the IST digits as typed).
function nowLocal() {
  return istNowInput();
}

function blankForm(): FormState {
  return {
    companyId: "", companyName: "", projectId: "", projectName: "", finYear: "",
    supplierId: "", supplierName: "", poId: "", poNumber: "",
    vehicleNo: "", entryTime: nowLocal(), exitTime: "", challanNo: "", remarks: "",
    attachments: [],
  };
}

function validateForm(f: FormState): string | null {
  if (!f.companyId) return "Company is required.";
  if (!f.projectId) return "Project is required.";
  if (!f.poId) return "A Purchase Order must be selected.";
  if (!f.vehicleNo.trim()) return "Vehicle number is required.";
  if (!f.entryTime) return "Entry time is required.";
  return null;
}

export function VehicleInOutFormModal({
  visible, editingId, onClose, asScreen,
}: { visible: boolean; editingId: number | null; onClose: () => void; asScreen?: boolean }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(blankForm());
  const [receivedQtyByItem, setReceivedQtyByItem] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [picker, setPicker] = useState<"company" | "project" | "finYear" | "supplier" | "po" | null>(null);
  const [previewAtt, setPreviewAtt] = useState<FormAttachment | null>(null);

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
  // Declared after the reset effect above so the locked year isn't wiped by it.
  // New records are locked to the current financial year (else the most
  // recent one); an existing record keeps the year it was saved with.
  const lockedFY = useLockedFinYear(visible && !editingId);
  const finYearLocked = (visible && !editingId) && !!lockedFY;
  useEffect(() => {
    if (!(visible && !editingId) || !lockedFY) return;
    set("finYear", lockedFY.label);
  }, [visible, editingId, lockedFY?.id]);

  const filteredProjects = useMemo(
    () => (form.companyId ? projects.filter((p) => String(p.company_id ?? "") === form.companyId) : projects),
    [projects, form.companyId],
  );

  const filteredPOs = useMemo(() => allPOs.filter((po) => {
    // Always keep whatever PO is currently selected on the form — even if
    // its status has since moved on — so editing an existing entry never
    // finds its own PO silently missing from the list.
    if (form.poId && String(po.PurchaseOrderID) === form.poId) return true;
    // "Pending" means awaiting approval, not yet approved — goods can't be
    // received against a PO nobody's signed off on yet.
    if (!["Approved", "Received"].includes(po.Status)) return false;
    if (form.companyId && String(po.CompanyId ?? "") !== form.companyId) return false;
    if (form.projectId && String(po.ProjectId ?? "") !== form.projectId) return false;
    return true;
  }), [allPOs, form.companyId, form.projectId, form.poId]);

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
      // The server returns attachments in upload order, so each pairs with the file just picked.
      const added: FormAttachment[] = res.attachments.map((a, i) => ({ ...a, localUri: files[i]?.uri }));
      setForm((f) => ({ ...f, attachments: [...f.attachments, ...added] }));
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
      docDate: istToday(),
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
    <FormPage
      asScreen={asScreen}
      visible={visible}
      onClose={onClose}
      eyebrow="CivilierERP · Material · Vehicle in / out"
      title={editingId ? "Edit entry" : "New entry"}
      subtitle={editingId ? existing?.DocNo || undefined : "A vehicle arriving at site against a purchase order, and what it carried."}
      loading={!!editingId && loadingExisting}
      saving={saving}
      onSave={handleSave}
      saveLabel={editingId ? "Save changes" : "Save entry"}
      overlays={
        <>
          <OptionPickerModal visible={picker === "company"} title="Select company" options={companyOptions} selectedKey={form.companyId} onSelect={onCompanyChange} onClose={() => setPicker(null)} searchable />
          <OptionPickerModal visible={picker === "project"} title="Select project" options={projectOptions} selectedKey={form.projectId} onSelect={onProjectChange} onClose={() => setPicker(null)} searchable />
          <OptionPickerModal visible={picker === "finYear"} title="Select financial year" options={finYearOptions} selectedKey={form.finYear} onSelect={(k) => { set("finYear", k); setPicker(null); }} onClose={() => setPicker(null)} />
          <OptionPickerModal visible={picker === "supplier"} title="Select supplier" options={supplierOptions} selectedKey={form.supplierId} onSelect={onSupplierChange} onClose={() => setPicker(null)} searchable />
          <OptionPickerModal visible={picker === "po"} title="Select purchase order" options={poOptions} selectedKey={form.poId} onSelect={onPOChange} onClose={() => setPicker(null)} searchable clearable />
          <ImagePreviewModal visible={!!previewAtt} url={previewAtt?.url} localUri={previewAtt?.localUri} title={previewAtt?.filename} onClose={() => setPreviewAtt(null)} />
        </>
      }
    >
      <Panel title="Document">
        <View>
          <ShownValue label="Doc number" value={editingId ? existing?.DocNo || "—" : docNoPreview?.nextDocNo || "Made on save"} />
          <PickerRow label="Company *" value={form.companyName} placeholder="Select company…" onPress={() => setPicker("company")} />
          <PickerRow label="Project *" value={form.projectName} placeholder="Select project…" onPress={() => setPicker("project")} />
          <PickerRow label={finYearLocked ? "Financial year · locked to current" : "Financial year"} value={form.finYear} onPress={() => setPicker("finYear")} disabled={finYearLocked} />
          <TextField label="Remarks" value={form.remarks} onChangeText={(v) => set("remarks", v)} placeholder="Optional notes" />
        </View>
      </Panel>

      <Panel title="Purchase order & supplier">
        <View>
          <PickerRow label="Purchase order" value={form.poNumber} placeholder="Select a PO…" onPress={() => setPicker("po")} />
          <PickerRow label="Supplier" value={form.supplierName} placeholder="Select supplier…" onPress={() => setPicker("supplier")} disabled={!!form.poId} />
        </View>
        {!!form.poId && (
          <View style={{ borderWidth: 1, borderColor: S.ink }}>
            <View style={{ paddingHorizontal: 10, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: S.ink }}>
              <Label color={S.ink}>PO items · qty received (this lot)</Label>
            </View>
            {loadingPOItems ? (
              <View style={{ padding: 10, gap: 8 }}>
                <Skel h={40} />
                <Skel h={40} />
              </View>
            ) : poItemsRemaining.length === 0 ? (
              <Body size={12} color={S.graphite} style={{ textAlign: "center", paddingVertical: 16 }}>No items on this PO.</Body>
            ) : (
              poItemsRemaining.map((it, i) => {
                const raw = receivedQtyByItem[it.poItemId] ?? "";
                const overLimit = (parseFloat(raw) || 0) > it.remainingQty + 1e-6;
                return (
                  <View key={it.poItemId} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 10, paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderTopColor: S.ruleSoft }}>
                    <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                      <Body size={12.5} weight="semibold">{it.itemName || "—"}</Body>
                      <Body size={11} color={S.graphite}>{`Ordered ${it.orderedQty} · received ${it.receivedSoFar} · left ${it.remainingQty} ${it.uomName || ""}`}</Body>
                    </View>
                    <View style={{ width: 90 }}>
                      <Input
                        value={raw}
                        onChangeText={(v) => handleQtyChange(it, v.replace(/[^0-9.]/g, ""))}
                        placeholder="0"
                        keyboardType="numeric"
                        editable={it.remainingQty > 0}
                        style={{ textAlign: "right", color: overLimit ? S.red : S.ink, opacity: it.remainingQty > 0 ? 1 : 0.5 }}
                      />
                    </View>
                  </View>
                );
              })
            )}
          </View>
        )}
      </Panel>

      <Panel title="Vehicle" icon={<Truck size={14} color={S.ink} />}>
        <View>
          <TextField label="Vehicle number *" value={form.vehicleNo} onChangeText={(v) => set("vehicleNo", v.toUpperCase())} placeholder="e.g. WB-01-AB-1234" />
        </View>
        <Field label="Entry time" required>
          <DateTimeField value={form.entryTime} onChange={(v) => set("entryTime", v)} title="Entry time" />
        </Field>
        <Field label="Exit time">
          <DateTimeField value={form.exitTime} onChange={(v) => set("exitTime", v)} title="Exit time" placeholder="Leave blank if not yet exited" clearable />
        </Field>
        <View>
          <TextField label="Supplier ref / challan no" value={form.challanNo} onChangeText={(v) => set("challanNo", v)} placeholder="e.g. CH-20240601-001" />
        </View>
      </Panel>

      <Panel title={`Attachments (${form.attachments.length})`} icon={<Paperclip size={14} color={S.ink} />}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          <Key label={uploading ? "Uploading…" : "Attach photos"} icon={<Paperclip size={13} color={S.ink} />} onPress={() => pickAndUpload("library")} disabled={uploading} />
          <Key label="Camera" icon={<CameraIcon size={13} color={S.ink} />} onPress={() => pickAndUpload("camera")} disabled={uploading} />
        </View>
        {form.attachments.length > 0 && (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {form.attachments.map((a) => (
              <View key={a.id} style={{ width: 84, height: 84, borderWidth: 1, borderColor: S.line40, overflow: "hidden" }}>
                {a.mimeType?.startsWith("image/") ? (
                  <Pressable onPress={() => setPreviewAtt(a)} style={{ width: "100%", height: "100%" }}>
                    <AuthImage url={a.url} localUri={a.localUri} style={{ width: "100%", height: "100%" }} />
                  </Pressable>
                ) : (
                  <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
                    <FileText size={18} color={S.graphite} />
                  </View>
                )}
                <Pressable
                  onPress={() => removeAttachment(a.id)}
                  hitSlop={6}
                  style={{ position: "absolute", top: 3, right: 3, width: 20, height: 20, backgroundColor: S.ink, alignItems: "center", justifyContent: "center" }}
                >
                  <X size={12} color={S.paper} />
                </Pressable>
              </View>
            ))}
          </View>
        )}
      </Panel>
    </FormPage>
  );
}
