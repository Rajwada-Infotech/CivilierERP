// FA Inventory — generate N FA Item Codes and tag that many units of a
// Fixed-Asset item at a godown. Mirrors POST /api/fixed-asset-tagging.
// Editing only touches date + remarks (the route allows nothing else).
import { useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { RouteProp } from "@react-navigation/native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { toast } from "@/components/Toast";
import { FormScaffold, FormSection, NumberField, RemarksField, PickerField, DateField } from "@/components/form";
import { getCompanies, getProjects, getGodowns } from "@/api/mastersApi";
import {
  getEligibleAssetItems, createFixedAssetTagging, getFixedAssetTagging, updateFixedAssetTagging,
} from "@/api/fixedAssetApi";
import type { MainStackParamList } from "@/navigation/MainStack";

export default function TaggingFormScreen() {
  const route = useRoute<RouteProp<MainStackParamList, "TaggingForm">>();
  const nav = useNavigation();
  const qc = useQueryClient();
  const editingId = route.params?.id ?? null;

  const [docDate, setDocDate] = useState(new Date().toISOString().slice(0, 10));
  const [companyId, setCompanyId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [godownId, setGodownId] = useState("");
  const [itemId, setItemId] = useState("");
  const [count, setCount] = useState("1");
  const [remarks, setRemarks] = useState("");
  const [hydrated, setHydrated] = useState(!editingId);

  const companiesQ = useQuery({ queryKey: ["m-companies"], queryFn: getCompanies });
  const projectsQ = useQuery({ queryKey: ["m-projects"], queryFn: getProjects });
  const godownsQ = useQuery({ queryKey: ["m-godowns"], queryFn: getGodowns });
  const itemsQ = useQuery({
    queryKey: ["fa-eligible-items", godownId, companyId, projectId],
    queryFn: () => getEligibleAssetItems({
      godownId: Number(godownId),
      companyId: companyId ? Number(companyId) : undefined,
      projectId: projectId ? Number(projectId) : undefined,
    }),
    enabled: !editingId && !!godownId,
  });
  const detailQ = useQuery({
    queryKey: ["fa-tagging", editingId], queryFn: () => getFixedAssetTagging(editingId!), enabled: !!editingId,
  });

  useEffect(() => {
    if (!editingId || !detailQ.data || hydrated) return;
    setDocDate(detailQ.data.DocDate?.slice(0, 10) || "");
    setRemarks(detailQ.data.Remarks || "");
    setHydrated(true);
  }, [detailQ.data, editingId, hydrated]);

  const companyOpts = useMemo(() => (companiesQ.data ?? []).map((c) => ({ key: String(c.id), label: c.label })), [companiesQ.data]);
  const projectOpts = useMemo(
    () => (projectsQ.data ?? []).filter((p) => !companyId || String(p.company_id) === companyId).map((p) => ({ key: String(p.id), label: p.label })),
    [projectsQ.data, companyId],
  );
  const godownOpts = useMemo(() => (godownsQ.data ?? []).map((g) => ({ key: String(g.GodownID), label: g.GodownName, sublabel: g.GodownCode })), [godownsQ.data]);
  const itemOpts = useMemo(
    () => (itemsQ.data ?? []).map((i) => ({
      key: i.ItemId, label: i.ItemName || i.ItemId,
      sublabel: `${i.UntaggedQty} untagged${i.AssetCategory ? ` · ${i.AssetCategory}` : ""}`,
    })),
    [itemsQ.data],
  );
  const selectedItem = (itemsQ.data ?? []).find((i) => i.ItemId === itemId);

  const save = useMutation({
    mutationFn: async () => {
      if (editingId) { await updateFixedAssetTagging(editingId, { docDate: docDate || undefined, remarks: remarks || undefined }); return { codes: [] as string[] }; }
      return createFixedAssetTagging({
        docDate, companyId: companyId ? Number(companyId) : null, projectId: Number(projectId),
        godownId: Number(godownId), itemId, numberOfItems: parseInt(count, 10), remarks: remarks || undefined,
      });
    },
    onSuccess: (r) => {
      toast.success(editingId ? "Tagging entry updated" : `${r.codes.length} FA Item Code(s) generated`);
      qc.invalidateQueries({ queryKey: ["fa-tagging"] });
      qc.invalidateQueries({ queryKey: ["fa-assets"] });
      qc.invalidateQueries({ queryKey: ["fa-unassigned-codes"] });
      nav.goBack();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const submit = () => {
    if (editingId) return save.mutate();
    if (!projectId) return toast.error("Project is required");
    if (!godownId) return toast.error("Godown is required");
    if (!itemId) return toast.error("Select an item");
    const n = parseInt(count, 10);
    if (!Number.isFinite(n) || n <= 0) return toast.error("Number of units must be a positive whole number");
    if (selectedItem && n > selectedItem.UntaggedQty) return toast.error(`Only ${selectedItem.UntaggedQty} untagged unit(s) available`);
    save.mutate();
  };

  if (editingId) {
    return (
      <FormScaffold onSubmit={submit} onCancel={() => nav.goBack()} submitLabel="Update" submitting={save.isPending}>
        <FormSection title="Tagging Entry">
          {!!detailQ.data?.FAItemCode && (
            <Text style={{ color: colors.mutedForeground, fontSize: 11, fontFamily: fonts.body.medium, marginBottom: 10 }}>
              {detailQ.data.FAItemCode}
            </Text>
          )}
          <DateField label="Doc Date" value={docDate} onChange={setDocDate} />
          <RemarksField label="Remarks" value={remarks} onChangeText={setRemarks} />
        </FormSection>
      </FormScaffold>
    );
  }

  return (
    <FormScaffold onSubmit={submit} onCancel={() => nav.goBack()} submitLabel="Generate Codes" submitting={save.isPending}>
      <FormSection title="Document">
        <DateField label="Doc Date" value={docDate} onChange={setDocDate} required />
        <PickerField label="Company" value={companyId} options={companyOpts}
          onSelect={(v) => { setCompanyId(v); setProjectId(""); }} loading={companiesQ.isLoading} clearable />
        <PickerField label="Project" value={projectId} options={projectOpts}
          onSelect={setProjectId} loading={projectsQ.isLoading} required
          disabled={!companyId} placeholder={companyId ? "Select project" : "Pick a company first"} />
      </FormSection>

      <FormSection title="Tagging">
        <PickerField label="Godown" value={godownId} options={godownOpts}
          onSelect={(v) => { setGodownId(v); setItemId(""); }} loading={godownsQ.isLoading} required />
        <PickerField label="Item" value={itemId} options={itemOpts}
          onSelect={setItemId} loading={itemsQ.isLoading} required
          disabled={!godownId} placeholder={godownId ? "Select an item with untagged stock" : "Pick a godown first"} />
        <NumberField label="Number of Units" value={count} onChangeText={setCount} required />
        {selectedItem && (
          <Text style={{ color: colors.mutedForeground, fontSize: 11, fontFamily: fonts.body.regular, marginBottom: 8 }}>
            {selectedItem.UntaggedQty} untagged of {selectedItem.AvailableQty} in stock
          </Text>
        )}
        <RemarksField label="Remarks" value={remarks} onChangeText={setRemarks} />
      </FormSection>
    </FormScaffold>
  );
}
