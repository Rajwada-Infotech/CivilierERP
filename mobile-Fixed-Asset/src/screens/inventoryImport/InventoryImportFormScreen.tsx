// Inventory Import — bring a Fixed-Asset item into inventory (StockLedger IN
// + Pending batch + best-effort auto-tag). Mirrors POST
// /api/fixed-asset-inventory-import. Create only; reversal is on the detail.
import { useMemo, useState } from "react";
import { Text } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigation } from "@react-navigation/native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { toast } from "@/components/Toast";
import { FormScaffold, FormSection, NumberField, RemarksField, PickerField, DateField } from "@/components/form";
import { getCompanies, getProjects, getGodowns, getFixedAssetItems } from "@/api/mastersApi";
import { createInventoryImport } from "@/api/fixedAssetApi";

export default function InventoryImportFormScreen() {
  const nav = useNavigation();
  const qc = useQueryClient();

  const [docDate, setDocDate] = useState(new Date().toISOString().slice(0, 10));
  const [companyId, setCompanyId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [godownId, setGodownId] = useState("");
  const [itemId, setItemId] = useState("");
  const [qty, setQty] = useState("");
  const [rate, setRate] = useState("");
  const [remarks, setRemarks] = useState("");

  const companiesQ = useQuery({ queryKey: ["m-companies"], queryFn: getCompanies });
  const projectsQ = useQuery({ queryKey: ["m-projects"], queryFn: getProjects });
  const godownsQ = useQuery({ queryKey: ["m-godowns"], queryFn: getGodowns });
  const itemsQ = useQuery({ queryKey: ["m-fa-items"], queryFn: getFixedAssetItems });

  const companyOpts = useMemo(() => (companiesQ.data ?? []).map((c) => ({ key: String(c.id), label: c.label })), [companiesQ.data]);
  const projectOpts = useMemo(
    () => (projectsQ.data ?? []).filter((p) => !companyId || String(p.company_id) === companyId).map((p) => ({ key: String(p.id), label: p.label })),
    [projectsQ.data, companyId],
  );
  const godownOpts = useMemo(() => (godownsQ.data ?? []).map((g) => ({ key: String(g.GodownID), label: g.GodownName, sublabel: g.GodownCode })), [godownsQ.data]);
  const itemOpts = useMemo(
    () => (itemsQ.data ?? []).map((i) => ({ key: i.M_Id, label: i.M_Name, sublabel: [i.M_code, i.M_Group].filter(Boolean).join(" · ") || undefined })),
    [itemsQ.data],
  );

  const save = useMutation({
    mutationFn: () => createInventoryImport({
      docDate, companyId: companyId ? Number(companyId) : null, projectId: projectId ? Number(projectId) : null,
      godownId: Number(godownId), itemId, quantity: parseFloat(qty), rate: rate ? parseFloat(rate) : null, remarks: remarks || undefined,
    }),
    onSuccess: (r) => {
      toast.success(`Imported — ${r.docNo}${r.tagged ? ` · ${r.tagged} auto-tagged` : ""}`);
      qc.invalidateQueries({ queryKey: ["fa-inv-import"] });
      qc.invalidateQueries({ queryKey: ["fa-assets"] });
      qc.invalidateQueries({ queryKey: ["fa-tagging"] });
      nav.goBack();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const submit = () => {
    if (!godownId) return toast.error("Godown is required");
    if (!itemId) return toast.error("Select a Fixed-Asset item");
    const n = parseFloat(qty);
    if (!Number.isFinite(n) || n <= 0) return toast.error("Quantity must be greater than zero");
    save.mutate();
  };

  return (
    <FormScaffold onSubmit={submit} onCancel={() => nav.goBack()} submitLabel="Import" submitting={save.isPending}>
      <FormSection title="Document">
        <DateField label="Doc Date" value={docDate} onChange={setDocDate} required />
        <PickerField label="Company" value={companyId} options={companyOpts}
          onSelect={(v) => { setCompanyId(v); setProjectId(""); }} loading={companiesQ.isLoading} clearable />
        <PickerField label="Project" value={projectId} options={projectOpts}
          onSelect={setProjectId} loading={projectsQ.isLoading} clearable
          disabled={!companyId} placeholder={companyId ? "Select project" : "Pick a company first"} />
      </FormSection>

      <FormSection title="Item">
        <PickerField label="Godown" value={godownId} options={godownOpts} onSelect={setGodownId} loading={godownsQ.isLoading} required />
        <PickerField label="Fixed-Asset Item" value={itemId} options={itemOpts} onSelect={setItemId} loading={itemsQ.isLoading} required />
        <NumberField label="Quantity" value={qty} onChangeText={setQty} required />
        <NumberField label="Rate (per unit)" value={rate} onChangeText={setRate} />
        {rate && qty ? (
          <Text style={{ color: colors.mutedForeground, fontSize: 11, fontFamily: fonts.body.regular, marginBottom: 8 }}>
            Purchase cost: {(parseFloat(rate) * parseFloat(qty) || 0).toLocaleString("en-IN")}
          </Text>
        ) : null}
        <RemarksField label="Remarks" value={remarks} onChangeText={setRemarks} />
      </FormSection>
    </FormScaffold>
  );
}
