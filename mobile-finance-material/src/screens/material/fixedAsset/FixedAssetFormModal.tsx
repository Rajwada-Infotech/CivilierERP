// RN port of FixedAssetRecord.tsx's create/edit form. Single scroll, no
// tabs — matches web (web's only concession to structure is section
// headers, not a stepper). Depreciation Type/Rate are read-only, auto-
// filled from the matching active Depreciation Setup row when a category
// is picked (mirrors web's handleCategoryChange) — editing later does NOT
// re-sync them if the master rate changes, same as web. The Sale section
// only appears once Status is "Sold" or a Selling Price is entered,
// exactly like web's conditional reveal.
import { useEffect, useMemo, useState } from "react";
import { View, Text, Modal, Pressable, ScrollView, TextInput, Alert, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { X, Cpu, Plus } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { formatINR } from "@/utils/formatCurrency";
import {
  getFixedAsset, createFixedAsset, updateFixedAsset,
  getCompanies, getProjects, getSuppliers, fetchFinYearOptions, getActiveDepreciationSetups,
  ASSET_CATEGORIES, ASSET_STATUS_OPTIONS, calcDepreciation,
  type FixedAssetPayload, type AssetStatus,
} from "@/api/fixedAssetApi";
import { PickerRow, OptionPickerModal, type PickerOption } from "@/screens/finance/payment/OptionPicker";

function todayISO() { return new Date().toISOString().slice(0, 10); }

type FormState = {
  docDate: string; companyId: string; companyName: string; projectId: string; projectName: string; finYear: string; remarks: string;
  assetName: string; assetCategory: string; brand: string; model: string; serialNumber: string; assetStatus: AssetStatus;
  purchaseDate: string; activationDate: string; purchaseInvoiceRef: string;
  supplierId: string; supplierName: string; purchaseCost: string; quantity: string;
  location: string; department: string; custodian: string;
  depreciationSetupId: number | null; depreciationType: string; depreciationRate: string; usefulLife: string;
  sellingPrice: string; saleDate: string; buyerName: string; saleRemarks: string;
};

function blankForm(): FormState {
  return {
    docDate: todayISO(), companyId: "", companyName: "", projectId: "", projectName: "", finYear: "", remarks: "",
    assetName: "", assetCategory: "", brand: "", model: "", serialNumber: "", assetStatus: "Active",
    purchaseDate: todayISO(), activationDate: "", purchaseInvoiceRef: "",
    supplierId: "", supplierName: "", purchaseCost: "", quantity: "1",
    location: "", department: "", custodian: "",
    depreciationSetupId: null, depreciationType: "", depreciationRate: "", usefulLife: "",
    sellingPrice: "", saleDate: "", buyerName: "", saleRemarks: "",
  };
}

function SectionHeading({ children }: { children: string }) {
  return (
    <Text style={{ color: colors.mutedForeground, fontSize: 10.5, fontFamily: fonts.heading.semibold, textTransform: "uppercase", letterSpacing: 0.6, marginTop: 8, marginBottom: 10 }}>
      {children}
    </Text>
  );
}

function FieldLabel({ children, required }: { children: string; required?: boolean }) {
  return (
    <Text style={{ color: colors.mutedForeground, fontSize: 10, fontFamily: fonts.body.medium, marginBottom: 5, textTransform: "uppercase", letterSpacing: 0.4 }}>
      {children}{required ? " *" : ""}
    </Text>
  );
}

function TextField({ value, onChangeText, placeholder, keyboardType, editable = true }: {
  value: string; onChangeText: (v: string) => void; placeholder?: string; keyboardType?: "default" | "numeric"; editable?: boolean;
}) {
  return (
    <TextInput
      value={value} onChangeText={onChangeText} placeholder={placeholder} keyboardType={keyboardType} editable={editable}
      placeholderTextColor={`${colors.mutedForeground}99`}
      style={{
        borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10,
        color: colors.foreground, fontFamily: fonts.body.regular, fontSize: 13, marginBottom: 14, opacity: editable ? 1 : 0.6,
      }}
    />
  );
}

export function FixedAssetFormModal({
  visible, editingId, onClose,
}: { visible: boolean; editingId: number | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(blankForm());
  const [saving, setSaving] = useState(false);
  const [showSale, setShowSale] = useState(false);
  const [picker, setPicker] = useState<"company" | "project" | "category" | "status" | "supplier" | "finYear" | null>(null);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  useEffect(() => {
    if (!visible) return;
    if (editingId == null) {
      setForm(blankForm());
      setShowSale(false);
    }
  }, [visible, editingId]);

  const { data: companies = [] } = useQuery({ queryKey: ["fa-form-companies"], queryFn: getCompanies, enabled: visible });
  const { data: projects = [] } = useQuery({ queryKey: ["fa-form-projects"], queryFn: getProjects, enabled: visible });
  const { data: suppliers = [] } = useQuery({ queryKey: ["fa-form-suppliers"], queryFn: getSuppliers, enabled: visible });
  const { data: finYears = [] } = useQuery({ queryKey: ["fa-form-finyears"], queryFn: fetchFinYearOptions, enabled: visible });
  const { data: depSetups = [] } = useQuery({ queryKey: ["fa-form-depsetups"], queryFn: getActiveDepreciationSetups, enabled: visible });

  const { data: existing, isLoading: loadingExisting } = useQuery({
    queryKey: ["fa-editing-record", editingId],
    queryFn: () => getFixedAsset(editingId!),
    enabled: visible && editingId != null,
  });

  useEffect(() => {
    if (!visible || editingId == null || !existing) return;
    setForm({
      docDate: existing.DocDate?.slice(0, 10) || todayISO(),
      companyId: existing.CompanyId ? String(existing.CompanyId) : "", companyName: existing.CompanyName || "",
      projectId: existing.ProjectId ? String(existing.ProjectId) : "", projectName: existing.ProjectName || "",
      finYear: existing.FinYear || "", remarks: existing.Remarks || "",
      assetName: existing.AssetName || "", assetCategory: existing.AssetCategory || "", brand: existing.Brand || "",
      model: existing.Model || "", serialNumber: existing.SerialNumber || "", assetStatus: existing.AssetStatus || "Active",
      purchaseDate: existing.PurchaseDate?.slice(0, 10) || todayISO(), activationDate: existing.ActivationDate?.slice(0, 10) || "",
      purchaseInvoiceRef: existing.PurchaseInvoiceRef || "",
      supplierId: existing.SupplierId ? String(existing.SupplierId) : "", supplierName: existing.SupplierName || "",
      purchaseCost: existing.PurchaseCost != null ? String(existing.PurchaseCost) : "", quantity: existing.Quantity != null ? String(existing.Quantity) : "1",
      location: existing.Location || "", department: existing.Department || "", custodian: existing.Custodian || "",
      depreciationSetupId: existing.DepreciationSetupId ?? null, depreciationType: existing.DepreciationType || "",
      depreciationRate: existing.DepreciationRate != null ? String(existing.DepreciationRate) : "", usefulLife: existing.UsefulLife != null ? String(existing.UsefulLife) : "",
      sellingPrice: existing.SellingPrice != null ? String(existing.SellingPrice) : "", saleDate: existing.SaleDate?.slice(0, 10) || "",
      buyerName: existing.BuyerName || "", saleRemarks: existing.SaleRemarks || "",
    });
    setShowSale(existing.AssetStatus === "Sold" || existing.SellingPrice != null);
  }, [visible, editingId, existing]);

  const handleCategoryChange = (category: string) => {
    const match = depSetups.find((d) => d.AssetCategory === category);
    setForm((f) => ({
      ...f, assetCategory: category,
      depreciationSetupId: match?.SetupId ?? null, depreciationType: match?.DepreciationType ?? "", depreciationRate: match?.DepreciationRate != null ? String(match.DepreciationRate) : "",
    }));
    setPicker(null);
  };

  const depCalc = useMemo(
    () => calcDepreciation(Number(form.purchaseCost) || 0, Number(form.depreciationRate) || 0, form.purchaseDate || null),
    [form.purchaseCost, form.depreciationRate, form.purchaseDate],
  );

  const profitLoss = useMemo(() => {
    if (!form.sellingPrice || !depCalc) return null;
    return Number(form.sellingPrice) - depCalc.bookValue;
  }, [form.sellingPrice, depCalc]);

  const validate = (): string | null => {
    if (!form.assetName.trim()) return "Asset name is required.";
    if (!form.assetCategory) return "Asset category is required.";
    if (!form.purchaseCost) return "Purchase cost is required.";
    return null;
  };

  const handleSave = async () => {
    const error = validate();
    if (error) {
      Alert.alert("Check the form", error);
      return;
    }
    const payload: FixedAssetPayload = {
      docDate: form.docDate || undefined, companyId: form.companyId ? Number(form.companyId) : null, projectId: form.projectId ? Number(form.projectId) : null,
      finYear: form.finYear || undefined, assetName: form.assetName.trim(), assetCategory: form.assetCategory,
      brand: form.brand || undefined, model: form.model || undefined, serialNumber: form.serialNumber || undefined,
      purchaseDate: form.purchaseDate || undefined, activationDate: form.activationDate || undefined, purchaseInvoiceRef: form.purchaseInvoiceRef || undefined,
      supplierId: form.supplierId ? Number(form.supplierId) : null, purchaseCost: Number(form.purchaseCost) || 0, quantity: Number(form.quantity) || 1,
      location: form.location || undefined, department: form.department || undefined, custodian: form.custodian || undefined,
      depreciationSetupId: form.depreciationSetupId, depreciationType: form.depreciationType || undefined,
      depreciationRate: form.depreciationRate ? Number(form.depreciationRate) : null, usefulLife: form.usefulLife ? Number(form.usefulLife) : null,
      assetStatus: form.assetStatus, sellingPrice: showSale && form.sellingPrice ? Number(form.sellingPrice) : null,
      saleDate: showSale ? form.saleDate || undefined : undefined, buyerName: showSale ? form.buyerName || undefined : undefined,
      saleRemarks: showSale ? form.saleRemarks || undefined : undefined, remarks: form.remarks || undefined,
    };
    setSaving(true);
    try {
      if (editingId != null) {
        await updateFixedAsset(editingId, payload);
        Alert.alert("Saved", "Asset updated.");
      } else {
        const created = await createFixedAsset(payload);
        Alert.alert("Saved", `Asset ${created.assetCode} created.`);
      }
      queryClient.invalidateQueries({ queryKey: ["fixed-assets-mobile"], exact: false });
      onClose();
    } catch (err: any) {
      Alert.alert("Failed to save", err.message ?? "Something went wrong.");
    } finally {
      setSaving(false);
    }
  };

  const companyOptions: PickerOption[] = companies.map((c) => ({ key: c.id, label: c.name }));
  const projectOptions: PickerOption[] = (form.companyId ? projects.filter((p) => p.companyId === form.companyId) : projects).map((p) => ({ key: p.id, label: p.name }));
  const categoryOptions: PickerOption[] = Array.from(new Set([...depSetups.map((d) => d.AssetCategory), ...ASSET_CATEGORIES])).map((c) => ({ key: c, label: c }));
  const statusOptions: PickerOption[] = ASSET_STATUS_OPTIONS.map((s) => ({ key: s, label: s }));
  const supplierOptions: PickerOption[] = suppliers.map((s) => ({ key: s.id, label: s.name }));
  const finYearOptions: PickerOption[] = finYears.map((f) => ({ key: f.label, label: f.label }));

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <View style={{ paddingTop: insets.top + 8 }} className="flex-row items-center justify-between px-4 pb-3">
          <View className="flex-row items-center gap-2.5">
            <View className="w-8 h-8 rounded-lg items-center justify-center" style={{ backgroundColor: "#0891b226" }}>
              <Cpu size={14} color="#0891b2" />
            </View>
            <Text style={{ color: colors.foreground, fontSize: 14, fontFamily: fonts.heading.semibold }}>{editingId ? "Edit Asset" : "New Asset"}</Text>
          </View>
          <Pressable onPress={onClose} className="w-8 h-8 rounded-lg items-center justify-center" style={{ borderWidth: 1, borderColor: colors.border }}>
            <X size={15} color={colors.mutedForeground} />
          </Pressable>
        </View>

        {loadingExisting ? (
          <View className="flex-1 items-center justify-center"><ActivityIndicator color={colors.mutedForeground} /></View>
        ) : (
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 16 }} keyboardShouldPersistTaps="handled">
            <SectionHeading>Header Information</SectionHeading>
            <FieldLabel>Document Date</FieldLabel>
            <TextField value={form.docDate} onChangeText={(v) => set("docDate", v)} placeholder="YYYY-MM-DD" />
            <PickerRow label="Company" value={form.companyName} onPress={() => setPicker("company")} />
            <PickerRow label="Project" value={form.projectName} onPress={() => setPicker("project")} disabled={!form.companyId} />
            <PickerRow label="Financial Year" value={form.finYear} placeholder="Optional" onPress={() => setPicker("finYear")} />
            <FieldLabel>Remarks</FieldLabel>
            <TextField value={form.remarks} onChangeText={(v) => set("remarks", v)} placeholder="Optional notes" />

            <SectionHeading>Asset Details</SectionHeading>
            <FieldLabel required>Asset Name</FieldLabel>
            <TextField value={form.assetName} onChangeText={(v) => set("assetName", v)} placeholder="e.g. Dell Latitude 5420" />
            <PickerRow label="Asset Category" value={form.assetCategory} placeholder="Select category" onPress={() => setPicker("category")} />
            <FieldLabel>Brand</FieldLabel>
            <TextField value={form.brand} onChangeText={(v) => set("brand", v)} placeholder="Optional" />
            <FieldLabel>Model</FieldLabel>
            <TextField value={form.model} onChangeText={(v) => set("model", v)} placeholder="Optional" />
            <FieldLabel>Serial Number</FieldLabel>
            <TextField value={form.serialNumber} onChangeText={(v) => set("serialNumber", v)} placeholder="Optional" />
            <PickerRow label="Status" value={form.assetStatus} onPress={() => setPicker("status")} />
            <FieldLabel>Purchase Date</FieldLabel>
            <TextField value={form.purchaseDate} onChangeText={(v) => set("purchaseDate", v)} placeholder="YYYY-MM-DD" />
            <FieldLabel>Activation Date</FieldLabel>
            <TextField value={form.activationDate} onChangeText={(v) => set("activationDate", v)} placeholder="YYYY-MM-DD" />
            <FieldLabel>Purchase Invoice Ref</FieldLabel>
            <TextField value={form.purchaseInvoiceRef} onChangeText={(v) => set("purchaseInvoiceRef", v)} placeholder="Optional" />
            <PickerRow label="Supplier" value={form.supplierName} placeholder="Optional" onPress={() => setPicker("supplier")} />
            <View className="flex-row gap-2">
              <View style={{ flex: 1 }}>
                <FieldLabel required>Purchase Cost ₹</FieldLabel>
                <TextField value={form.purchaseCost} onChangeText={(v) => set("purchaseCost", v.replace(/[^0-9.]/g, ""))} keyboardType="numeric" placeholder="0" />
              </View>
              <View style={{ flex: 1 }}>
                <FieldLabel>Quantity</FieldLabel>
                <TextField value={form.quantity} onChangeText={(v) => set("quantity", v.replace(/[^0-9]/g, ""))} keyboardType="numeric" placeholder="1" />
              </View>
            </View>
            <FieldLabel>Location</FieldLabel>
            <TextField value={form.location} onChangeText={(v) => set("location", v)} placeholder="Optional" />
            <FieldLabel>Department</FieldLabel>
            <TextField value={form.department} onChangeText={(v) => set("department", v)} placeholder="Optional" />
            <FieldLabel>Custodian</FieldLabel>
            <TextField value={form.custodian} onChangeText={(v) => set("custodian", v)} placeholder="Optional" />

            <SectionHeading>Depreciation Details</SectionHeading>
            {!form.assetCategory ? (
              <Text style={{ color: colors.mutedForeground, fontSize: 11, marginBottom: 14 }}>Pick an Asset Category to auto-fill depreciation rate.</Text>
            ) : !form.depreciationRate ? (
              <Text style={{ color: "#d97706", fontSize: 11, marginBottom: 14 }}>No active depreciation rate found for "{form.assetCategory}". Add one in Depreciation Setup.</Text>
            ) : (
              <>
                <View className="flex-row gap-2">
                  <View style={{ flex: 1 }}>
                    <FieldLabel>Depreciation Type</FieldLabel>
                    <TextField value={form.depreciationType} onChangeText={() => {}} editable={false} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <FieldLabel>Depreciation Rate %</FieldLabel>
                    <TextField value={form.depreciationRate} onChangeText={() => {}} editable={false} />
                  </View>
                </View>
                <FieldLabel>Useful Life (years)</FieldLabel>
                <TextField value={form.usefulLife} onChangeText={(v) => set("usefulLife", v.replace(/[^0-9.]/g, ""))} keyboardType="numeric" placeholder="Optional" />
                {depCalc && (
                  <View className="rounded-xl overflow-hidden mb-4" style={{ borderWidth: 1, borderColor: colors.border }}>
                    {[
                      ["Years Elapsed", depCalc.years.toFixed(1)],
                      ["Annual Depreciation", formatINR(depCalc.annualDepreciation)],
                      ["Total Depreciation", formatINR(depCalc.totalDepreciation)],
                      ["Book Value", formatINR(depCalc.bookValue)],
                    ].map(([label, value], i) => (
                      <View key={label} className="flex-row items-center justify-between px-3.5 py-2" style={{ borderTopWidth: i > 0 ? 1 : 0, borderTopColor: `${colors.border}60` }}>
                        <Text style={{ color: colors.mutedForeground, fontSize: 11.5 }}>{label}</Text>
                        <Text style={{ color: colors.foreground, fontSize: 12, fontFamily: fonts.heading.semibold }}>{value}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </>
            )}

            {!showSale ? (
              <Pressable onPress={() => setShowSale(true)} className="flex-row items-center justify-center gap-1.5 py-2.5 rounded-xl mb-2" style={{ borderWidth: 1, borderColor: colors.border, borderStyle: "dashed" }}>
                <Plus size={13} color={colors.primary} />
                <Text style={{ color: colors.primary, fontSize: 12, fontFamily: fonts.heading.medium }}>Add Sale Details</Text>
              </Pressable>
            ) : (
              <>
                <SectionHeading>Asset Sale</SectionHeading>
                <FieldLabel>Selling Price ₹</FieldLabel>
                <TextField value={form.sellingPrice} onChangeText={(v) => set("sellingPrice", v.replace(/[^0-9.]/g, ""))} keyboardType="numeric" placeholder="0" />
                <FieldLabel>Sale Date</FieldLabel>
                <TextField value={form.saleDate} onChangeText={(v) => set("saleDate", v)} placeholder="YYYY-MM-DD" />
                <FieldLabel>Buyer Name</FieldLabel>
                <TextField value={form.buyerName} onChangeText={(v) => set("buyerName", v)} placeholder="Optional" />
                <FieldLabel>Sale Remarks</FieldLabel>
                <TextField value={form.saleRemarks} onChangeText={(v) => set("saleRemarks", v)} placeholder="Optional" />
                {profitLoss != null && (
                  <View className="flex-row items-center justify-between rounded-xl px-3.5 py-3 mb-4" style={{ borderWidth: 1, borderColor: profitLoss >= 0 ? "#05966940" : "#dc262640", backgroundColor: profitLoss >= 0 ? "#0596690d" : "#dc26260d" }}>
                    <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>Profit / Loss</Text>
                    <Text style={{ color: profitLoss >= 0 ? "#059669" : "#dc2626", fontSize: 14, fontFamily: fonts.heading.bold }}>{profitLoss >= 0 ? "+" : ""}{formatINR(profitLoss)}</Text>
                  </View>
                )}
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
            style={{ backgroundColor: "#0891b2", opacity: saving ? 0.7 : 1 }}
          >
            {saving ? <ActivityIndicator size="small" color="#fff" /> : (
              <Text style={{ color: "#fff", fontSize: 12.5, fontFamily: fonts.heading.semibold }}>{editingId ? "Save Changes" : "Save Asset"}</Text>
            )}
          </Pressable>
        </View>
      </View>

      <OptionPickerModal visible={picker === "company"} title="Select Company" options={companyOptions} selectedKey={form.companyId}
        onSelect={(k) => { const c = companies.find((x) => x.id === k); setForm((f) => ({ ...f, companyId: k, companyName: c?.name ?? "", projectId: "", projectName: "" })); setPicker(null); }}
        onClose={() => setPicker(null)} searchable clearable />
      <OptionPickerModal visible={picker === "project"} title="Select Project" options={projectOptions} selectedKey={form.projectId}
        onSelect={(k) => { const p = projects.find((x) => x.id === k); setForm((f) => ({ ...f, projectId: k, projectName: p?.name ?? "" })); setPicker(null); }}
        onClose={() => setPicker(null)} searchable clearable />
      <OptionPickerModal visible={picker === "finYear"} title="Select Financial Year" options={finYearOptions} selectedKey={form.finYear}
        onSelect={(k) => { set("finYear", k); setPicker(null); }} onClose={() => setPicker(null)} clearable />
      <OptionPickerModal visible={picker === "category"} title="Select Category" options={categoryOptions} selectedKey={form.assetCategory}
        onSelect={handleCategoryChange} onClose={() => setPicker(null)} searchable />
      <OptionPickerModal visible={picker === "status"} title="Select Status" options={statusOptions} selectedKey={form.assetStatus}
        onSelect={(k) => { set("assetStatus", k as AssetStatus); if (k === "Sold") setShowSale(true); setPicker(null); }} onClose={() => setPicker(null)} />
      <OptionPickerModal visible={picker === "supplier"} title="Select Supplier" options={supplierOptions} selectedKey={form.supplierId}
        onSelect={(k) => { const s = suppliers.find((x) => x.id === k); setForm((f) => ({ ...f, supplierId: k, supplierName: s?.name ?? "" })); setPicker(null); }}
        onClose={() => setPicker(null)} searchable clearable />
    </Modal>
  );
}
