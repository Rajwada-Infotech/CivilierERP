// Create / edit a Fixed Asset Record — mobile port of the web
// FixedAssetRecord form (src/pages/fixedAsset/FixedAssetRecord.tsx). Same
// payload + validation as POST/PUT /api/fixed-assets.
import { useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { RouteProp } from "@react-navigation/native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { formatINR } from "@/utils/formatCurrency";
import { calcDepreciation } from "@/utils/depreciation";
import { toast } from "@/components/Toast";
import {
  FormScaffold, FormSection, TextField, NumberField, RemarksField, PickerField, DateField, ImageCaptureField,
} from "@/components/form";
import { useActiveFinYear } from "@/hooks/useActiveFinYear";
import {
  getCompanies, getProjects, getSuppliers, getSacCodes, getActiveDepreciationSetups,
} from "@/api/mastersApi";
import {
  getFixedAsset, createFixedAsset, updateFixedAsset, getUnassignedFAItemCodes,
  type FixedAssetPayload, type UnassignedFAItemCode,
} from "@/api/fixedAssetApi";
import type { MainStackParamList } from "@/navigation/MainStack";

const ASSET_STATUS = ["Pending", "Active", "Sold", "Scrapped", "Under Maintenance"];

interface FormState {
  docDate: string; companyId: string; projectId: string; finYear: string;
  assetName: string; sourceTagId: string; faItemCode: string;
  assetCategory: string; repairType: string; brand: string; model: string; serialNumber: string;
  purchaseDate: string; activationDate: string; purchaseInvoiceRef: string; supplierId: string;
  purchaseCost: string; quantity: string;
  depreciationSetupId: string; depreciationType: string; depreciationRate: string; usefulLife: string;
  assetStatus: string; sellingPrice: string; saleDate: string; buyerName: string; saleRemarks: string;
  remarks: string; pictureBase64: string;
}

const empty = (finYear: string): FormState => ({
  docDate: new Date().toISOString().slice(0, 10),
  companyId: "", projectId: "", finYear,
  assetName: "", sourceTagId: "", faItemCode: "",
  assetCategory: "", repairType: "", brand: "", model: "", serialNumber: "",
  purchaseDate: "", activationDate: "", purchaseInvoiceRef: "", supplierId: "",
  purchaseCost: "", quantity: "1",
  depreciationSetupId: "", depreciationType: "", depreciationRate: "", usefulLife: "",
  assetStatus: "Active", sellingPrice: "", saleDate: "", buyerName: "", saleRemarks: "",
  remarks: "", pictureBase64: "",
});

export default function AssetFormScreen() {
  const route = useRoute<RouteProp<MainStackParamList, "AssetForm">>();
  const nav = useNavigation();
  const qc = useQueryClient();
  const editingId = route.params?.id ?? null;
  const { activeFinYear } = useActiveFinYear();

  const [form, setForm] = useState<FormState>(empty(activeFinYear));
  const [hydrated, setHydrated] = useState(!editingId);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    if (!editingId && !form.finYear && activeFinYear) set("finYear", activeFinYear);
  }, [activeFinYear]); // eslint-disable-line react-hooks/exhaustive-deps

  const companiesQ = useQuery({ queryKey: ["m-companies"], queryFn: getCompanies });
  const projectsQ = useQuery({ queryKey: ["m-projects"], queryFn: getProjects });
  const suppliersQ = useQuery({ queryKey: ["m-suppliers"], queryFn: getSuppliers });
  const sacQ = useQuery({ queryKey: ["m-sac"], queryFn: getSacCodes });
  const depSetupsQ = useQuery({ queryKey: ["m-dep-setups"], queryFn: getActiveDepreciationSetups });
  const codesQ = useQuery({
    queryKey: ["fa-unassigned-codes"], queryFn: getUnassignedFAItemCodes, enabled: !editingId,
  });
  const detailQ = useQuery({
    queryKey: ["fa-asset", editingId], queryFn: () => getFixedAsset(editingId!), enabled: !!editingId,
  });

  useEffect(() => {
    if (!editingId || !detailQ.data || hydrated) return;
    const d = detailQ.data;
    setForm({
      docDate: d.DocDate?.slice(0, 10) || "",
      companyId: String(d.CompanyId || ""), projectId: String(d.ProjectId || ""),
      finYear: d.FinYear || "",
      assetName: d.AssetName || "", sourceTagId: String(d.SourceTagId || ""), faItemCode: d.FAItemCode || "",
      assetCategory: d.AssetCategory || "", repairType: d.RepairType || "",
      brand: d.Brand || "", model: d.Model || "", serialNumber: d.SerialNumber || "",
      purchaseDate: d.PurchaseDate?.slice(0, 10) || "", activationDate: d.ActivationDate?.slice(0, 10) || "",
      purchaseInvoiceRef: d.PurchaseInvoiceRef || "", supplierId: String(d.SupplierId || ""),
      purchaseCost: d.PurchaseCost != null ? String(d.PurchaseCost) : "", quantity: String(d.Quantity ?? "1"),
      depreciationSetupId: String(d.DepreciationSetupId || ""), depreciationType: d.DepreciationType || "",
      depreciationRate: d.DepreciationRate != null ? String(d.DepreciationRate) : "",
      usefulLife: d.UsefulLife != null ? String(d.UsefulLife) : "",
      assetStatus: d.AssetStatus || "Active",
      sellingPrice: d.SellingPrice != null ? String(d.SellingPrice) : "",
      saleDate: d.SaleDate?.slice(0, 10) || "", buyerName: d.BuyerName || "", saleRemarks: d.SaleRemarks || "",
      remarks: d.Remarks || "", pictureBase64: d.PictureBase64 || "",
    });
    setHydrated(true);
  }, [detailQ.data, editingId, hydrated]);

  const companyOpts = useMemo(
    () => (companiesQ.data ?? []).map((c) => ({ key: String(c.id), label: c.label })),
    [companiesQ.data],
  );
  const projectOpts = useMemo(
    () => (projectsQ.data ?? [])
      .filter((p) => !form.companyId || String(p.company_id) === form.companyId)
      .map((p) => ({ key: String(p.id), label: p.label })),
    [projectsQ.data, form.companyId],
  );
  const supplierOpts = useMemo(
    () => (suppliersQ.data ?? []).map((s) => ({ key: String(s.LHeadId), label: s.LHeadName })),
    [suppliersQ.data],
  );
  const sacOpts = useMemo(
    () => (sacQ.data ?? []).map((s) => ({ key: s.HCode, label: s.HCode, sublabel: s.HShortDescription || s.HDescription || undefined })),
    [sacQ.data],
  );
  const categoryOpts = useMemo(() => {
    const cats = Array.from(new Set((depSetupsQ.data ?? []).map((d) => d.AssetCategory))).sort();
    return cats.map((c) => ({ key: c, label: c }));
  }, [depSetupsQ.data]);
  const codeOpts = useMemo(
    () => (codesQ.data ?? []).map((c) => ({
      key: String(c.TagId), label: c.FAItemCode,
      sublabel: [c.ItemName, c.CompanyName, c.ProjectName].filter(Boolean).join(" · ") || undefined,
    })),
    [codesQ.data],
  );

  const onPickCode = (tagId: string) => {
    const c = (codesQ.data ?? []).find((x) => String(x.TagId) === tagId) as UnassignedFAItemCode | undefined;
    if (!c) { set("sourceTagId", ""); return; }
    setForm((p) => ({
      ...p,
      sourceTagId: String(c.TagId), faItemCode: c.FAItemCode, assetName: c.ItemName || "",
      companyId: c.CompanyId ? String(c.CompanyId) : p.companyId,
      projectId: c.ProjectId ? String(c.ProjectId) : p.projectId,
    }));
  };

  const onPickCategory = (cat: string) => {
    const s = (depSetupsQ.data ?? []).find((d) => d.AssetCategory === cat);
    setForm((p) => ({
      ...p, assetCategory: cat,
      depreciationSetupId: s ? String(s.SetupId) : "",
      depreciationType: s ? s.DepreciationType : p.depreciationType,
      depreciationRate: s ? String(s.DepreciationRate) : p.depreciationRate,
    }));
  };

  const depPreview = useMemo(() => {
    const cost = parseFloat(form.purchaseCost);
    const rate = parseFloat(form.depreciationRate);
    if (!cost || !rate || !form.purchaseDate) return null;
    return calcDepreciation(cost, rate, form.purchaseDate);
  }, [form.purchaseCost, form.depreciationRate, form.purchaseDate]);

  const save = useMutation({
    mutationFn: async (): Promise<{ docNo?: string }> => {
      const payload: FixedAssetPayload = {
        docDate: form.docDate || undefined,
        companyId: form.companyId ? Number(form.companyId) : undefined,
        projectId: form.projectId ? Number(form.projectId) : undefined,
        finYear: form.finYear || undefined,
        assetName: form.assetName || undefined,
        sourceTagId: !editingId && form.sourceTagId ? Number(form.sourceTagId) : undefined,
        assetCategory: form.assetCategory,
        repairType: form.repairType || null,
        brand: form.brand || undefined, model: form.model || undefined, serialNumber: form.serialNumber || undefined,
        purchaseDate: form.purchaseDate || undefined, activationDate: form.activationDate || undefined,
        purchaseInvoiceRef: form.purchaseInvoiceRef || undefined,
        supplierId: form.supplierId ? Number(form.supplierId) : undefined,
        purchaseCost: parseFloat(form.purchaseCost) || 0,
        quantity: parseFloat(form.quantity) || 1,
        depreciationSetupId: form.depreciationSetupId ? Number(form.depreciationSetupId) : undefined,
        depreciationType: form.depreciationType || undefined,
        depreciationRate: form.depreciationRate ? parseFloat(form.depreciationRate) : undefined,
        usefulLife: form.usefulLife ? parseInt(form.usefulLife, 10) : undefined,
        assetStatus: form.assetStatus || "Active",
        sellingPrice: form.sellingPrice ? parseFloat(form.sellingPrice) : undefined,
        saleDate: form.saleDate || undefined, buyerName: form.buyerName || undefined,
        saleRemarks: form.saleRemarks || undefined,
        remarks: form.remarks || undefined,
        pictureBase64: form.pictureBase64 || null,
      };
      if (editingId) { await updateFixedAsset(editingId, payload); return {}; }
      return createFixedAsset(payload);
    },
    onSuccess: (r) => {
      toast.success(editingId ? "Asset updated" : `Asset created — ${r.docNo ?? ""}`);
      qc.invalidateQueries({ queryKey: ["fa-assets"] });
      qc.invalidateQueries({ queryKey: ["fa-asset", editingId] });
      qc.invalidateQueries({ queryKey: ["fa-unassigned-codes"] });
      qc.invalidateQueries({ queryKey: ["fa-tagging"] });
      nav.goBack();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const submit = () => {
    if (!editingId && !form.sourceTagId && !form.assetName.trim()) return toast.error("Select an FA Item Code or enter an asset name");
    if (!form.assetName.trim()) return toast.error("Asset name is required");
    if (!form.assetCategory) return toast.error("Asset category is required");
    if (!form.purchaseCost) return toast.error("Purchase cost is required");
    save.mutate();
  };

  return (
    <FormScaffold
      onSubmit={submit}
      onCancel={() => nav.goBack()}
      submitLabel={editingId ? "Update" : "Create"}
      submitting={save.isPending}
    >
      <FormSection title="Document">
        <DateField label="Doc Date" value={form.docDate} onChange={(v) => set("docDate", v)} required />
        <PickerField label="Company" value={form.companyId} options={companyOpts}
          onSelect={(v) => setForm((p) => ({ ...p, companyId: v, projectId: "" }))} loading={companiesQ.isLoading} clearable />
        <PickerField label="Project" value={form.projectId} options={projectOpts}
          onSelect={(v) => set("projectId", v)} loading={projectsQ.isLoading} clearable
          disabled={!form.companyId} placeholder={form.companyId ? "Select project" : "Pick a company first"} />
        <TextField label="Financial Year" value={form.finYear} onChangeText={(v) => set("finYear", v)} autoCapitalize="characters" />
      </FormSection>

      <FormSection title="Identity">
        {!editingId && (
          <PickerField label="FA Item Code" value={form.sourceTagId} options={codeOpts}
            onSelect={onPickCode} loading={codesQ.isLoading} clearable
            placeholder="Search generated FA Item Codes" />
        )}
        {editingId && !!form.faItemCode && (
          <Text style={{ color: colors.mutedForeground, fontSize: 11, fontFamily: fonts.body.medium, marginBottom: 10 }}>
            FA Item Code: <Text style={{ color: colors.foreground }}>{form.faItemCode}</Text>
          </Text>
        )}
        <TextField label="Asset Name" value={form.assetName} onChangeText={(v) => set("assetName", v)} required autoCapitalize="words" />
      </FormSection>

      <FormSection title="Classification">
        <PickerField label="Asset Category" value={form.assetCategory} options={categoryOpts}
          onSelect={onPickCategory} loading={depSetupsQ.isLoading} required />
        <PickerField label="Type of Repairs (SAC)" value={form.repairType} options={sacOpts}
          onSelect={(v) => set("repairType", v)} loading={sacQ.isLoading} clearable />
        <TextField label="Brand" value={form.brand} onChangeText={(v) => set("brand", v)} autoCapitalize="words" />
        <TextField label="Model" value={form.model} onChangeText={(v) => set("model", v)} />
        <TextField label="Serial Number" value={form.serialNumber} onChangeText={(v) => set("serialNumber", v)} autoCapitalize="characters" />
      </FormSection>

      <FormSection title="Purchase">
        <DateField label="Purchase Date" value={form.purchaseDate} onChange={(v) => set("purchaseDate", v)} />
        <DateField label="Activation Date" value={form.activationDate} onChange={(v) => set("activationDate", v)} />
        <TextField label="Invoice Ref" value={form.purchaseInvoiceRef} onChangeText={(v) => set("purchaseInvoiceRef", v)} />
        <PickerField label="Supplier" value={form.supplierId} options={supplierOpts}
          onSelect={(v) => set("supplierId", v)} loading={suppliersQ.isLoading} clearable />
        <NumberField label="Purchase Cost" value={form.purchaseCost} onChangeText={(v) => set("purchaseCost", v)} required />
        <NumberField label="Quantity" value={form.quantity} onChangeText={(v) => set("quantity", v)} />
      </FormSection>

      <FormSection title="Depreciation">
        <TextField label="Type" value={form.depreciationType} onChangeText={(v) => set("depreciationType", v)} autoCapitalize="characters" />
        <NumberField label="Rate (% p.a.)" value={form.depreciationRate} onChangeText={(v) => set("depreciationRate", v)} />
        <NumberField label="Useful Life (years)" value={form.usefulLife} onChangeText={(v) => set("usefulLife", v)} />
        {depPreview && (
          <View style={{ backgroundColor: `${colors.muted}80`, borderRadius: 10, padding: 10, marginBottom: 4 }}>
            <Text style={{ color: colors.mutedForeground, fontSize: 10, fontFamily: fonts.body.regular }}>Straight-line estimate</Text>
            <Text style={{ color: colors.foreground, fontSize: 12, fontFamily: fonts.body.medium, marginTop: 3 }}>
              {depPreview.years} yrs · annual {formatINR(depPreview.annualDep)} · book value {formatINR(depPreview.bookValue)}
            </Text>
          </View>
        )}
      </FormSection>

      <FormSection title="Status">
        <PickerField label="Asset Status" value={form.assetStatus}
          options={ASSET_STATUS.map((s) => ({ key: s, label: s }))} onSelect={(v) => set("assetStatus", v)} searchable={false} />
        {form.assetStatus === "Sold" && (
          <>
            <NumberField label="Selling Price" value={form.sellingPrice} onChangeText={(v) => set("sellingPrice", v)} />
            <DateField label="Sale Date" value={form.saleDate} onChange={(v) => set("saleDate", v)} />
            <TextField label="Buyer Name" value={form.buyerName} onChangeText={(v) => set("buyerName", v)} autoCapitalize="words" />
            <RemarksField label="Sale Remarks" value={form.saleRemarks} onChangeText={(v) => set("saleRemarks", v)} />
            {depPreview && form.sellingPrice ? (
              <Text style={{ color: parseFloat(form.sellingPrice) >= depPreview.bookValue ? "#10b981" : colors.destructive, fontSize: 11, fontFamily: fonts.body.medium, marginBottom: 8 }}>
                {parseFloat(form.sellingPrice) >= depPreview.bookValue ? "Profit" : "Loss"} on sale: {formatINR(Math.abs(parseFloat(form.sellingPrice) - depPreview.bookValue))} vs book value
              </Text>
            ) : null}
          </>
        )}
      </FormSection>

      <FormSection title="Attachments">
        <ImageCaptureField label="Item Picture" value={form.pictureBase64}
          onChange={(v) => set("pictureBase64", v)} hint="JPG, PNG or WEBP · max 4 MB" />
        <RemarksField label="Remarks" value={form.remarks} onChangeText={(v) => set("remarks", v)} />
      </FormSection>
    </FormScaffold>
  );
}
