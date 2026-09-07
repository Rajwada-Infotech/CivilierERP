// Create / edit an FA Maintenance & Repair record (Draft). Mirrors POST/PUT
// /api/fixed-asset-maintenance. Editing a Posted record reverses its GL
// voucher and returns it to Draft.
import { useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { RouteProp } from "@react-navigation/native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { formatINR } from "@/utils/formatCurrency";
import { toast } from "@/components/Toast";
import { FormScaffold, FormSection, NumberField, RemarksField, PickerField, DateField } from "@/components/form";
import { getVendors } from "@/api/mastersApi";
import {
  getMaintenanceAssets, getMaintenanceFaItemCodes, getMaintenance, createMaintenance, updateMaintenance,
} from "@/api/fixedAssetApi";
import type { MainStackParamList } from "@/navigation/MainStack";

const REPAIR_TYPES = ["Direct", "Indirect"] as const;

export default function MaintenanceFormScreen() {
  const route = useRoute<RouteProp<MainStackParamList, "MaintenanceForm">>();
  const nav = useNavigation();
  const qc = useQueryClient();
  const editingId = route.params?.id ?? null;

  const [docDate, setDocDate] = useState(new Date().toISOString().slice(0, 10));
  const [companyId, setCompanyId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [itemName, setItemName] = useState("");
  const [assetId, setAssetId] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [repairType, setRepairType] = useState("Direct");
  const [amount, setAmount] = useState("");
  const [remarks, setRemarks] = useState("");
  const [hydrated, setHydrated] = useState(!editingId);

  const assetsQ = useQuery({ queryKey: ["fa-maint-assets"], queryFn: () => getMaintenanceAssets({}) });
  const vendorsQ = useQuery({ queryKey: ["m-vendors"], queryFn: getVendors });
  const codesQ = useQuery({
    queryKey: ["fa-maint-codes", itemName],
    queryFn: () => getMaintenanceFaItemCodes({ itemName }),
    enabled: !!itemName,
  });
  const detailQ = useQuery({ queryKey: ["fa-maint", editingId], queryFn: () => getMaintenance(editingId!), enabled: !!editingId });

  useEffect(() => {
    if (!editingId || !detailQ.data || hydrated) return;
    const d = detailQ.data;
    setDocDate(d.DocDate?.slice(0, 10) || "");
    setCompanyId(d.CompanyId != null ? String(d.CompanyId) : "");
    setProjectId(d.ProjectId != null ? String(d.ProjectId) : "");
    setItemName(d.ItemName || "");
    setAssetId(String(d.AssetId));
    setVendorId(d.VendorId != null ? String(d.VendorId) : "");
    setRepairType(d.RepairExpenseType);
    setAmount(String(d.Amount));
    setRemarks(d.Remarks || "");
    setHydrated(true);
  }, [detailQ.data, editingId, hydrated]);

  // Distinct item names + company/project inferred from the picked FA Item Code.
  const itemNameOpts = useMemo(() => {
    const names = Array.from(new Set((assetsQ.data ?? []).map((a) => a.AssetName))).sort();
    return names.map((n) => ({ key: n, label: n }));
  }, [assetsQ.data]);
  const codeOpts = useMemo(
    () => (codesQ.data ?? []).map((a) => ({ key: String(a.AssetId), label: a.FAItemCode, sublabel: a.SacDescription || a.AssetCategory || undefined })),
    [codesQ.data],
  );
  const vendorOpts = useMemo(() => (vendorsQ.data ?? []).map((v) => ({ key: String(v.id), label: v.label, sublabel: v.code || undefined })), [vendorsQ.data]);

  const selectedCode = (codesQ.data ?? []).find((a) => String(a.AssetId) === assetId)
    ?? (assetsQ.data ?? []).find((a) => String(a.AssetId) === assetId);

  const gstPreview = useMemo(() => {
    const amt = parseFloat(amount);
    if (!amt || !selectedCode?.GstRatePct) return null;
    const gst = Math.round(amt * selectedCode.GstRatePct) / 100;
    return { rate: selectedCode.GstRatePct, gst, total: amt + gst, sac: selectedCode.SacCode };
  }, [amount, selectedCode]);

  const onPickCode = (v: string) => {
    setAssetId(v);
    const a = (codesQ.data ?? []).find((x) => String(x.AssetId) === v);
    if (a) {
      if (a.CompanyId != null) setCompanyId(String(a.CompanyId));
      if (a.ProjectId != null) setProjectId(String(a.ProjectId));
    }
  };

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        docDate, companyId: Number(companyId), projectId: Number(projectId),
        itemName, assetId: Number(assetId), vendorId: Number(vendorId),
        repairExpenseType: repairType as "Direct" | "Indirect", amount: parseFloat(amount), remarks: remarks || undefined,
      };
      if (editingId) return updateMaintenance(editingId, payload);
      return createMaintenance(payload);
    },
    onSuccess: (r) => {
      toast.success(editingId
        ? ((r as { wasPosted?: boolean }).wasPosted ? "Updated — voucher reversed, back to Draft" : "Maintenance record updated")
        : "Maintenance record created (Draft)");
      qc.invalidateQueries({ queryKey: ["fa-maint"] });
      nav.goBack();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const submit = () => {
    if (!companyId) return toast.error("Company is required");
    if (!projectId) return toast.error("Project is required");
    if (!itemName) return toast.error("Item selection is required");
    if (!assetId) return toast.error("FA Item Code is required");
    if (!vendorId) return toast.error("Vendor is required");
    const amt = parseFloat(amount);
    if (!Number.isFinite(amt) || amt <= 0) return toast.error("Amount must be greater than zero");
    save.mutate();
  };

  return (
    <FormScaffold onSubmit={submit} onCancel={() => nav.goBack()} submitLabel={editingId ? "Update" : "Create Draft"} submitting={save.isPending}>
      <FormSection title="Document">
        <DateField label="Doc Date" value={docDate} onChange={setDocDate} required />
      </FormSection>

      <FormSection title="Repair">
        <PickerField label="Item Selection" value={itemName} options={itemNameOpts}
          onSelect={(v) => { setItemName(v); setAssetId(""); }} loading={assetsQ.isLoading} required />
        <PickerField label="FA Item Code" value={assetId} options={codeOpts}
          onSelect={onPickCode} loading={codesQ.isLoading} required
          disabled={!itemName} placeholder={itemName ? "Select the FA Item Code" : "Pick an item first"} />
        <PickerField label="Vendor" value={vendorId} options={vendorOpts} onSelect={setVendorId} loading={vendorsQ.isLoading} required />
        <PickerField label="Repair Expense Type" value={repairType} searchable={false}
          options={REPAIR_TYPES.map((r) => ({ key: r, label: r }))} onSelect={setRepairType} />
        <NumberField label="Amount (taxable)" value={amount} onChangeText={setAmount} required />
        {gstPreview && (
          <View style={{ backgroundColor: `${colors.muted}80`, borderRadius: 10, padding: 10, marginBottom: 4 }}>
            <Text style={{ color: colors.mutedForeground, fontSize: 10, fontFamily: fonts.body.regular }}>
              GST {gstPreview.rate}%{gstPreview.sac ? ` · SAC ${gstPreview.sac}` : ""}
            </Text>
            <Text style={{ color: colors.foreground, fontSize: 12, fontFamily: fonts.body.medium, marginTop: 3 }}>
              GST {formatINR(gstPreview.gst, { decimals: 2 })} · Total {formatINR(gstPreview.total, { decimals: 2 })}
            </Text>
          </View>
        )}
        <RemarksField label="Remarks" value={remarks} onChangeText={setRemarks} />
      </FormSection>
    </FormScaffold>
  );
}
