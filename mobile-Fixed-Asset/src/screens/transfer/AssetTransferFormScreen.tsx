// Move a Fixed Asset's custody from one user to another — mobile port of the
// web AssetTransfer form (src/pages/fixedAsset/AssetTransfer.tsx). Same
// payload + validation as POST/PUT /api/asset-transfer. The From User is the
// asset's current custodian; To User auto-fills Department; Remarks required.
import { useEffect, useMemo, useState } from "react";
import { Image, Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { RouteProp } from "@react-navigation/native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { ArrowRight } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { toast } from "@/components/Toast";
import { Avatar } from "@/components/Avatar";
import { FormScaffold, FormSection, RemarksField, PickerField, DateField, ImageCaptureField, FieldLabel } from "@/components/form";
import { useActiveFinYear } from "@/hooks/useActiveFinYear";
import { getCompanies, getProjects, getUsers, getDepartments } from "@/api/mastersApi";
import {
  getTransferableAssets, getAssetTransfer, getFixedAsset, createAssetTransfer, updateAssetTransfer, setAssetPicture,
} from "@/api/fixedAssetApi";
import type { MainStackParamList } from "@/navigation/MainStack";

export default function AssetTransferFormScreen() {
  const route = useRoute<RouteProp<MainStackParamList, "AssetTransferForm">>();
  const nav = useNavigation();
  const qc = useQueryClient();
  const editingId = route.params?.id ?? null;
  const { activeFinYear, finYearOptions } = useActiveFinYear();

  const [docDate, setDocDate] = useState(new Date().toISOString().slice(0, 10));
  const [transferDate, setTransferDate] = useState(new Date().toISOString().slice(0, 10));
  const [finYear, setFinYear] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [assetId, setAssetId] = useState("");
  const [fromUserId, setFromUserId] = useState<number | null>(null);
  const [toUserId, setToUserId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [remarks, setRemarks] = useState("");
  const [localPicture, setLocalPicture] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(!editingId);

  useEffect(() => { if (!finYear && activeFinYear) setFinYear(activeFinYear); }, [activeFinYear]); // eslint-disable-line

  const companiesQ = useQuery({ queryKey: ["m-companies"], queryFn: getCompanies });
  const projectsQ = useQuery({ queryKey: ["m-projects"], queryFn: getProjects });
  const usersQ = useQuery({ queryKey: ["m-users"], queryFn: getUsers });
  const deptsQ = useQuery({ queryKey: ["m-depts"], queryFn: getDepartments });
  const assetsQ = useQuery({
    queryKey: ["fa-transferable", projectId, companyId, finYear],
    queryFn: () => getTransferableAssets({
      projectId: projectId ? Number(projectId) : undefined,
      companyId: companyId ? Number(companyId) : undefined,
      finYear: finYear || undefined,
    }),
    enabled: !editingId && !!projectId,
  });
  const detailQ = useQuery({ queryKey: ["fa-transfer", editingId], queryFn: () => getAssetTransfer(editingId!), enabled: !!editingId });
  // On edit, the transfer row has no picture — pull it from the asset record.
  const editAssetId = editingId ? detailQ.data?.AssetId : undefined;
  const assetQ = useQuery({ queryKey: ["fa-asset", editAssetId], queryFn: () => getFixedAsset(editAssetId!), enabled: !!editAssetId });

  useEffect(() => {
    if (!editingId || !detailQ.data || hydrated) return;
    const d = detailQ.data;
    setDocDate(d.DocDate?.slice(0, 10) || "");
    setTransferDate((d.TransferDate || d.DocDate)?.slice(0, 10) || "");
    setFinYear(d.FinYear || "");
    setCompanyId(d.CompanyId != null ? String(d.CompanyId) : "");
    setProjectId(d.ProjectId != null ? String(d.ProjectId) : "");
    setAssetId(String(d.AssetId));
    setFromUserId(d.FromUserId);
    setToUserId(String(d.ToUserId));
    setDepartmentId(d.DepartmentId != null ? String(d.DepartmentId) : "");
    setRemarks(d.Remarks || "");
    setHydrated(true);
  }, [detailQ.data, editingId, hydrated]);

  const users = usersQ.data ?? [];
  const findUser = (id: number | null) => users.find((u) => u.id === id);

  const companyOpts = useMemo(() => (companiesQ.data ?? []).map((c) => ({ key: String(c.id), label: c.label })), [companiesQ.data]);
  const projectOpts = useMemo(
    () => (projectsQ.data ?? []).filter((p) => !companyId || String(p.company_id) === companyId).map((p) => ({ key: String(p.id), label: p.label })),
    [projectsQ.data, companyId],
  );
  const finYearOpts = useMemo(() => finYearOptions.map((y) => ({ key: y, label: y })), [finYearOptions]);
  const toUserOpts = useMemo(
    () => users.filter((u) => u.id !== fromUserId).map((u) => ({ key: String(u.id), label: u.name, sublabel: u.DepartmentName || undefined })),
    [users, fromUserId],
  );
  const deptOpts = useMemo(() => (deptsQ.data ?? []).filter((d) => d.IsActive).map((d) => ({ key: String(d.Id), label: d.DepartmentName })), [deptsQ.data]);
  const assetOpts = useMemo(
    () => (assetsQ.data ?? []).map((a) => ({
      key: String(a.AssetId), label: a.FAItemCode || a.AssetName,
      sublabel: [a.AssetName + (a.AssetCategory ? ` (${a.AssetCategory})` : ""), a.CustodianName ? `Held by ${a.CustodianName}` : "No current holder"].filter(Boolean).join(" · "),
    })),
    [assetsQ.data],
  );

  const selectedAsset = (assetsQ.data ?? []).find((a) => String(a.AssetId) === assetId);
  const assetPicture = localPicture !== null
    ? localPicture
    : (selectedAsset?.PictureBase64 || assetQ.data?.PictureBase64 || "");
  const fromUser = findUser(fromUserId);
  const toUser = findUser(toUserId ? Number(toUserId) : null);

  const clearDownstream = () => { setAssetId(""); setFromUserId(null); setToUserId(""); setDepartmentId(""); };

  const onPickAsset = (v: string) => {
    setLocalPicture(null);
    setAssetId(v);
    const a = (assetsQ.data ?? []).find((x) => String(x.AssetId) === v);
    setFromUserId(a?.CustodianUserId ?? null);
    setToUserId("");
    setDepartmentId("");
  };

  const onPickToUser = (v: string) => {
    setToUserId(v);
    const u = users.find((x) => String(x.id) === v);
    setDepartmentId(u?.DepartmentId ? String(u.DepartmentId) : "");
  };

  const pictureMut = useMutation({
    mutationFn: (dataUri: string) => setAssetPicture(Number(assetId), dataUri || null),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fa-transferable"] });
      qc.invalidateQueries({ queryKey: ["fa-assets"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const onPickPicture = (dataUri: string) => {
    setLocalPicture(dataUri || "");
    if (assetId) pictureMut.mutate(dataUri);
  };

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        docDate, transferDate: transferDate || docDate,
        companyId: companyId ? Number(companyId) : null,
        projectId: Number(projectId || detailQ.data?.ProjectId),
        finYear: finYear || undefined,
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
    if (!assetId) return toast.error("Select an FA Item Code");
    if (!fromUserId) return toast.error("This asset has no current holder");
    if (!toUserId) return toast.error("Select the To User");
    if (Number(toUserId) === fromUserId) return toast.error("From and To user must differ");
    if (!departmentId) return toast.error("Department is required");
    if (!remarks.trim()) return toast.error("Remarks are required");
    save.mutate();
  };

  return (
    <FormScaffold onSubmit={submit} onCancel={() => nav.goBack()} submitLabel={editingId ? "Update" : "Transfer"} submitting={save.isPending}>
      <FormSection title="Document">
        {!editingId && (
          <>
            <PickerField label="Company" value={companyId} options={companyOpts} clearable loading={companiesQ.isLoading}
              onSelect={(v) => { clearDownstream(); setCompanyId(v); setProjectId(""); }} />
            <PickerField label="Project" value={projectId} options={projectOpts} required loading={projectsQ.isLoading}
              disabled={!companyId} placeholder={companyId ? "Select project" : "Pick a company first"}
              onSelect={(v) => { clearDownstream(); setProjectId(v); }} />
            <PickerField label="Financial Year" value={finYear} options={finYearOpts} searchable={false}
              onSelect={(v) => { clearDownstream(); setFinYear(v); }} />
          </>
        )}
        <DateField label="Document Date" value={docDate} onChange={setDocDate} required />
        <DateField label="Transfer Date" value={transferDate} onChange={setTransferDate} required />
      </FormSection>

      <FormSection title="Transfer Details">
        {!editingId ? (
          <PickerField label="FA Item Code" value={assetId} options={assetOpts} required loading={assetsQ.isLoading}
            disabled={!projectId} placeholder={projectId ? "Select FA Item Code" : "Pick a project first"} onSelect={onPickAsset} />
        ) : (
          <Text style={{ color: colors.mutedForeground, fontSize: 11, fontFamily: fonts.body.medium, marginBottom: 10 }}>
            {detailQ.data?.FAItemCode} · {detailQ.data?.AssetName}
          </Text>
        )}
        {!editingId && projectId && !assetsQ.isLoading && (assetsQ.data ?? []).length === 0 && (
          <Text style={{ color: "#f59e0b", fontSize: 10.5, fontFamily: fonts.body.regular, marginBottom: 12 }}>
            No transferable FA Item Codes found for the selected project.
          </Text>
        )}

        <ImageCaptureField label="Item Picture" value={assetPicture} onChange={onPickPicture}
          hint={assetId ? "Saved to the asset record · JPG, PNG or WEBP · max 4 MB" : "Select an FA Item Code first"} />

        <FieldLabel label="From User" />
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, minHeight: 46, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: `${colors.card}80`, marginBottom: 14 }}>
          {fromUser ? (
            <>
              <Avatar name={fromUser.name} url={fromUser.avatar_url} id={fromUser.id} size={28} />
              <Text style={{ color: colors.foreground, fontSize: 13, fontFamily: fonts.body.medium }}>{fromUser.name}</Text>
            </>
          ) : (
            <>
              <Avatar name="?" id={0} size={28} />
              <Text style={{ color: `${colors.mutedForeground}99`, fontSize: 13, fontFamily: fonts.body.regular }}>
                {assetId ? "No current holder" : "Select an asset first"}
              </Text>
            </>
          )}
        </View>

        <PickerField label="To User" value={toUserId} options={toUserOpts} required loading={usersQ.isLoading}
          disabled={!fromUserId} placeholder={fromUserId ? "Select the To User" : "Select an asset first"} onSelect={onPickToUser} />
        {toUser && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: -4, marginBottom: 12 }}>
            <Avatar name={toUser.name} url={toUser.avatar_url} id={toUser.id} size={24} />
            <Text style={{ color: colors.foreground, fontSize: 12, fontFamily: fonts.body.medium }}>{toUser.name}</Text>
          </View>
        )}

        <PickerField label="Department" value={departmentId} options={deptOpts} required loading={deptsQ.isLoading}
          disabled={!toUserId} placeholder={toUserId ? "Select department" : "Select To User first"} onSelect={setDepartmentId} />
      </FormSection>

      <FormSection title="Remarks">
        <RemarksField label="Reason for transfer" value={remarks} onChangeText={setRemarks} required />
      </FormSection>

      {(fromUser || toUser || selectedAsset) && (
        <View style={{ backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 14 }}>
          <Text style={{ color: colors.mutedForeground, fontSize: 10, fontFamily: fonts.heading.bold, letterSpacing: 1, textTransform: "uppercase", marginBottom: 10 }}>
            Preview
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            {assetPicture ? (
              <Image source={{ uri: assetPicture }} style={{ width: 46, height: 46, borderRadius: 10, borderWidth: 1, borderColor: colors.border }} />
            ) : null}
            <Text style={{ flex: 1, color: colors.foreground, fontSize: 13, fontFamily: fonts.body.semibold }}>
              {selectedAsset?.AssetName || detailQ.data?.AssetName || "—"}
            </Text>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 }}>
            <Avatar name={fromUser?.name} url={fromUser?.avatar_url} id={fromUser?.id ?? 0} size={22} />
            <Text style={{ color: colors.foreground, fontSize: 12, fontFamily: fonts.body.medium }}>{fromUser?.name || "—"}</Text>
            <ArrowRight size={13} color="#eab308" />
            <Avatar name={toUser?.name} url={toUser?.avatar_url} id={toUser?.id ?? 0} size={22} />
            <Text style={{ color: colors.foreground, fontSize: 12, fontFamily: fonts.body.semibold }}>{toUser?.name || "—"}</Text>
          </View>
          <Text style={{ color: colors.mutedForeground, fontSize: 10.5, fontFamily: fonts.body.regular, marginTop: 6 }}>
            {deptOpts.find((d) => d.key === departmentId)?.label || "—"}
            {transferDate ? ` · ${new Date(transferDate).toLocaleDateString("en-IN")}` : ""}
          </Text>
        </View>
      )}
    </FormScaffold>
  );
}
