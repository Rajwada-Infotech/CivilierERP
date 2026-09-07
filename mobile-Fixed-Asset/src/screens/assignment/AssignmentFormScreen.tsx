// Assign a Fixed Asset (FA Item Code) to a holder + a responsible user.
// Mirrors POST/PUT /api/fixed-asset-assignment. The user field locks when
// the assignment was created by a User-Wise Asset Transfer.
import { useEffect, useMemo, useState } from "react";
import { Text } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { RouteProp } from "@react-navigation/native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { toast } from "@/components/Toast";
import { FormScaffold, FormSection, TextField, RemarksField, PickerField, DateField, ImageCaptureField } from "@/components/form";
import { useActiveFinYear } from "@/hooks/useActiveFinYear";
import { getUsers } from "@/api/mastersApi";
import {
  getAssignableAssets, getAssignment, createAssignment, updateAssignment,
} from "@/api/fixedAssetApi";
import type { MainStackParamList } from "@/navigation/MainStack";

export default function AssignmentFormScreen() {
  const route = useRoute<RouteProp<MainStackParamList, "AssignmentForm">>();
  const nav = useNavigation();
  const qc = useQueryClient();
  const editingId = route.params?.id ?? null;
  const { activeFinYear } = useActiveFinYear();

  const [docDate, setDocDate] = useState(new Date().toISOString().slice(0, 10));
  const [finYear, setFinYear] = useState("");
  const [assetId, setAssetId] = useState("");
  const [companyId, setCompanyId] = useState<number | null>(null);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [userId, setUserId] = useState("");
  const [responsibleUserId, setResponsibleUserId] = useState("");
  const [userImage, setUserImage] = useState("");
  const [remarks, setRemarks] = useState("");
  const [transferLocked, setTransferLocked] = useState(false);
  const [hydrated, setHydrated] = useState(!editingId);

  useEffect(() => { if (!finYear && activeFinYear) setFinYear(activeFinYear); }, [activeFinYear]); // eslint-disable-line

  const usersQ = useQuery({ queryKey: ["m-users"], queryFn: getUsers });
  const assetsQ = useQuery({ queryKey: ["fa-assignable"], queryFn: getAssignableAssets, enabled: !editingId });
  const detailQ = useQuery({ queryKey: ["fa-assignment", editingId], queryFn: () => getAssignment(editingId!), enabled: !!editingId });

  useEffect(() => {
    if (!editingId || !detailQ.data || hydrated) return;
    const d = detailQ.data;
    setDocDate(d.DocDate?.slice(0, 10) || "");
    setFinYear(d.FinYear || "");
    setAssetId(String(d.AssetId));
    setUserId(String(d.UserId));
    setResponsibleUserId(d.ResponsibleUserId != null ? String(d.ResponsibleUserId) : "");
    setUserImage(d.UserImage || "");
    setRemarks(d.Remarks || "");
    setTransferLocked(!!d.SourceTransferDocNo);
    setHydrated(true);
  }, [detailQ.data, editingId, hydrated]);

  const userOpts = useMemo(() => (usersQ.data ?? []).map((u) => ({ key: String(u.id), label: u.name, sublabel: u.DepartmentName || undefined })), [usersQ.data]);
  const assetOpts = useMemo(
    () => (assetsQ.data ?? []).map((a) => ({ key: String(a.AssetId), label: a.FAItemCode, sublabel: [a.AssetName, a.CurrentCustodianName ? `held by ${a.CurrentCustodianName}` : null].filter(Boolean).join(" · ") || undefined })),
    [assetsQ.data],
  );

  const onPickAsset = (v: string) => {
    setAssetId(v);
    const a = (assetsQ.data ?? []).find((x) => String(x.AssetId) === v);
    setCompanyId(a?.CompanyId ?? null);
    setProjectId(a?.ProjectId ?? null);
  };

  const save = useMutation({
    mutationFn: async () => {
      if (editingId) {
        await updateAssignment(editingId, {
          docDate, finYear, userId: Number(userId), responsibleUserId: Number(responsibleUserId),
          userImage: userImage || null, remarks: remarks || undefined,
        });
        return;
      }
      await createAssignment({
        docDate, companyId: companyId!, projectId: projectId!, finYear,
        assetId: Number(assetId), userId: Number(userId), responsibleUserId: Number(responsibleUserId),
        userImage: userImage || null, remarks: remarks || undefined,
      });
    },
    onSuccess: () => {
      toast.success(editingId ? "Assignment updated" : "Assignment created");
      qc.invalidateQueries({ queryKey: ["fa-assignment"] });
      qc.invalidateQueries({ queryKey: ["fa-assets"] });
      nav.goBack();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const submit = () => {
    if (!editingId && !assetId) return toast.error("Select an FA Item Code");
    if (!userId) return toast.error("Select the holder");
    if (!responsibleUserId) return toast.error("Select the responsible user");
    if (!finYear) return toast.error("Financial year is required");
    if (!editingId && (companyId == null || projectId == null)) return toast.error("Selected FA Item Code has no company/project");
    save.mutate();
  };

  return (
    <FormScaffold onSubmit={submit} onCancel={() => nav.goBack()} submitLabel={editingId ? "Update" : "Assign"} submitting={save.isPending}>
      <FormSection title="Document">
        <DateField label="Doc Date" value={docDate} onChange={setDocDate} required />
        <TextField label="Financial Year" value={finYear} onChangeText={setFinYear} required autoCapitalize="characters" />
      </FormSection>

      <FormSection title="Assignment">
        {editingId ? (
          <Text style={{ color: colors.mutedForeground, fontSize: 11, fontFamily: fonts.body.medium, marginBottom: 12 }}>
            {detailQ.data?.FAItemCode} · {detailQ.data?.AssetName}
          </Text>
        ) : (
          <PickerField label="FA Item Code" value={assetId} options={assetOpts} onSelect={onPickAsset} loading={assetsQ.isLoading} required />
        )}
        <PickerField label="Holder" value={userId} options={userOpts} onSelect={setUserId} loading={usersQ.isLoading} required
          disabled={transferLocked}
          placeholder={transferLocked ? "Locked — set by a transfer" : "Select the holder"} />
        <PickerField label="Responsible User" value={responsibleUserId} options={userOpts} onSelect={setResponsibleUserId} loading={usersQ.isLoading} required />
        <ImageCaptureField label="Holder Photo" value={userImage} onChange={setUserImage} maxBytes={400 * 1024} hint="Optional · max ~400 KB" />
        <RemarksField label="Remarks" value={remarks} onChangeText={setRemarks} />
      </FormSection>
    </FormScaffold>
  );
}
