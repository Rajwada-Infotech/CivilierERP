// Move a Fixed Asset's custody from one user to another. Mirrors POST/PUT
// /api/asset-transfer. The From User is derived from the asset's current
// custodian; Remarks are required.
import { useEffect, useMemo, useState } from "react";
import { Text } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { RouteProp } from "@react-navigation/native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { toast } from "@/components/Toast";
import { FormScaffold, FormSection, RemarksField, PickerField, DateField } from "@/components/form";
import { useActiveFinYear } from "@/hooks/useActiveFinYear";
import { getCompanies, getProjects, getUsers, getDepartments } from "@/api/mastersApi";
import {
  getTransferableAssets, getAssetTransfer, createAssetTransfer, updateAssetTransfer,
} from "@/api/fixedAssetApi";
import type { MainStackParamList } from "@/navigation/MainStack";

export default function AssetTransferFormScreen() {
  const route = useRoute<RouteProp<MainStackParamList, "AssetTransferForm">>();
  const nav = useNavigation();
  const qc = useQueryClient();
  const editingId = route.params?.id ?? null;
  const { activeFinYear } = useActiveFinYear();

  const [docDate, setDocDate] = useState(new Date().toISOString().slice(0, 10));
  const [finYear, setFinYear] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [assetId, setAssetId] = useState("");
  const [fromUserId, setFromUserId] = useState<number | null>(null);
  const [fromUserName, setFromUserName] = useState("");
  const [toUserId, setToUserId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [remarks, setRemarks] = useState("");
  const [hydrated, setHydrated] = useState(!editingId);

  useEffect(() => { if (!finYear && activeFinYear) setFinYear(activeFinYear); }, [activeFinYear]); // eslint-disable-line

  const companiesQ = useQuery({ queryKey: ["m-companies"], queryFn: getCompanies });
  const projectsQ = useQuery({ queryKey: ["m-projects"], queryFn: getProjects });
  const usersQ = useQuery({ queryKey: ["m-users"], queryFn: getUsers });
  const deptsQ = useQuery({ queryKey: ["m-depts"], queryFn: getDepartments });
  const assetsQ = useQuery({
    queryKey: ["fa-transferable", projectId, companyId],
    queryFn: () => getTransferableAssets({
      projectId: projectId ? Number(projectId) : undefined,
      companyId: companyId ? Number(companyId) : undefined,
    }),
    enabled: !editingId && !!projectId,
  });
  const detailQ = useQuery({ queryKey: ["fa-transfer", editingId], queryFn: () => getAssetTransfer(editingId!), enabled: !!editingId });

  useEffect(() => {
    if (!editingId || !detailQ.data || hydrated) return;
    const d = detailQ.data;
    setDocDate((d.DocDate || d.TransferDate)?.slice(0, 10) || "");
    setFinYear(d.FinYear || "");
    setAssetId(String(d.AssetId));
    setFromUserId(d.FromUserId);
    setFromUserName(d.FromUserName || "");
    setToUserId(String(d.ToUserId));
    setDepartmentId(d.DepartmentId != null ? String(d.DepartmentId) : "");
    setRemarks(d.Remarks || "");
    setHydrated(true);
  }, [detailQ.data, editingId, hydrated]);

  const companyOpts = useMemo(() => (companiesQ.data ?? []).map((c) => ({ key: String(c.id), label: c.label })), [companiesQ.data]);
  const projectOpts = useMemo(
    () => (projectsQ.data ?? []).filter((p) => !companyId || String(p.company_id) === companyId).map((p) => ({ key: String(p.id), label: p.label })),
    [projectsQ.data, companyId],
  );
  const userOpts = useMemo(() => (usersQ.data ?? []).map((u) => ({ key: String(u.id), label: u.name, sublabel: u.DepartmentName || undefined })), [usersQ.data]);
  const deptOpts = useMemo(() => (deptsQ.data ?? []).filter((d) => d.IsActive).map((d) => ({ key: String(d.Id), label: d.DepartmentName })), [deptsQ.data]);
  const assetOpts = useMemo(
    () => (assetsQ.data ?? []).map((a) => ({ key: String(a.AssetId), label: a.FAItemCode || a.AssetName, sublabel: [a.AssetName, a.CustodianName ? `held by ${a.CustodianName}` : null].filter(Boolean).join(" · ") || undefined })),
    [assetsQ.data],
  );

  const onPickAsset = (v: string) => {
    setAssetId(v);
    const a = (assetsQ.data ?? []).find((x) => String(x.AssetId) === v);
    setFromUserId(a?.CustodianUserId ?? null);
    setFromUserName(a?.CustodianName || "");
  };

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        docDate, transferDate: docDate, companyId: companyId ? Number(companyId) : null,
        projectId: Number(projectId || detailQ.data?.ProjectId), finYear: finYear || undefined,
        assetId: Number(assetId), fromUserId: Number(fromUserId), toUserId: Number(toUserId),
        departmentId: Number(departmentId), remarks: remarks.trim(),
      };
      if (editingId) { await updateAssetTransfer(editingId, payload); return; }
      await createAssetTransfer(payload);
    },
    onSuccess: () => {
      toast.success(editingId ? "Transfer updated" : "Transfer recorded");
      qc.invalidateQueries({ queryKey: ["fa-transfer"] });
      qc.invalidateQueries({ queryKey: ["fa-assignment"] });
      qc.invalidateQueries({ queryKey: ["fa-assets"] });
      nav.goBack();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const submit = () => {
    if (!editingId && !projectId) return toast.error("Project is required");
    if (!assetId) return toast.error("Select an asset");
    if (!fromUserId) return toast.error("This asset has no current custodian");
    if (!toUserId) return toast.error("Select the To User");
    if (Number(toUserId) === fromUserId) return toast.error("From and To user must differ");
    if (!departmentId) return toast.error("Department is required");
    if (!remarks.trim()) return toast.error("Remarks are required");
    save.mutate();
  };

  return (
    <FormScaffold onSubmit={submit} onCancel={() => nav.goBack()} submitLabel={editingId ? "Update" : "Transfer"} submitting={save.isPending}>
      <FormSection title="Document">
        <DateField label="Transfer Date" value={docDate} onChange={setDocDate} required />
      </FormSection>

      <FormSection title="Transfer">
        {!editingId && (
          <>
            <PickerField label="Company" value={companyId} options={companyOpts}
              onSelect={(v) => { setCompanyId(v); setProjectId(""); setAssetId(""); }} loading={companiesQ.isLoading} clearable />
            <PickerField label="Project" value={projectId} options={projectOpts}
              onSelect={(v) => { setProjectId(v); setAssetId(""); }} loading={projectsQ.isLoading} required />
            <PickerField label="Asset (FA Item Code)" value={assetId} options={assetOpts}
              onSelect={onPickAsset} loading={assetsQ.isLoading} required
              disabled={!projectId} placeholder={projectId ? "Select an asset" : "Pick a project first"} />
          </>
        )}
        {editingId && (
          <Text style={{ color: colors.mutedForeground, fontSize: 11, fontFamily: fonts.body.medium, marginBottom: 10 }}>
            {detailQ.data?.FAItemCode} · {detailQ.data?.AssetName}
          </Text>
        )}
        <Text style={{ color: colors.mutedForeground, fontSize: 10, fontFamily: fonts.body.medium, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 }}>From User</Text>
        <Text style={{ color: colors.foreground, fontSize: 13, fontFamily: fonts.body.medium, marginBottom: 14 }}>{fromUserName || "—"}</Text>
        <PickerField label="To User" value={toUserId} options={userOpts} onSelect={setToUserId} loading={usersQ.isLoading} required />
        <PickerField label="Department" value={departmentId} options={deptOpts} onSelect={setDepartmentId} loading={deptsQ.isLoading} required />
        <RemarksField label="Remarks" value={remarks} onChangeText={setRemarks} required />
      </FormSection>
    </FormScaffold>
  );
}
