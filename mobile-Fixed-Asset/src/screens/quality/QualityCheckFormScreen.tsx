// Record an Owner & Quality Check + its follow-up. Mirrors POST/PUT
// /api/fixed-asset-quality-check. Current user & responsible user are
// server-derived from the FA Item Code's latest assignment.
import { useEffect, useMemo, useState } from "react";
import { Image, Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { RouteProp } from "@react-navigation/native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { toast } from "@/components/Toast";
import { FormScaffold, FormSection, RemarksField, PickerField, DateField, ImageCaptureField } from "@/components/form";
import { getQCAssets, getQCAssetContext, getQualityCheck, createQualityCheck, updateQualityCheck } from "@/api/fixedAssetApi";
import type { MainStackParamList } from "@/navigation/MainStack";

const QUALITY = ["Good", "Average", "Defective", "Repairing"] as const;
const FOLLOWUP_TYPES = ["Inspection", "Repair Follow-Up", "Maintenance", "Recheck"];

export default function QualityCheckFormScreen() {
  const route = useRoute<RouteProp<MainStackParamList, "QualityCheckForm">>();
  const nav = useNavigation();
  const qc = useQueryClient();
  const editingId = route.params?.id ?? null;

  const [docDate, setDocDate] = useState(new Date().toISOString().slice(0, 10));
  const [assetId, setAssetId] = useState("");
  const [qualityStatus, setQualityStatus] = useState("Good");
  const [remarks, setRemarks] = useState("");
  const [itemPicture, setItemPicture] = useState("");
  const [nextFollowUpDate, setNextFollowUpDate] = useState("");
  const [followUpType, setFollowUpType] = useState("Inspection");
  const [followUpRemarks, setFollowUpRemarks] = useState("");
  const [hydrated, setHydrated] = useState(!editingId);

  const assetsQ = useQuery({ queryKey: ["qc-assets"], queryFn: () => getQCAssets({}), enabled: !editingId });
  const ctxQ = useQuery({ queryKey: ["qc-context", assetId], queryFn: () => getQCAssetContext(Number(assetId)), enabled: !editingId && !!assetId });
  const detailQ = useQuery({ queryKey: ["fa-quality", editingId], queryFn: () => getQualityCheck(editingId!), enabled: !!editingId });

  useEffect(() => {
    if (!editingId || !detailQ.data || hydrated) return;
    const d = detailQ.data;
    setDocDate(d.DocDate?.slice(0, 10) || "");
    setAssetId(String(d.AssetId));
    setQualityStatus(d.QualityStatus);
    setRemarks(d.Remarks || "");
    setItemPicture(d.ItemPicture || "");
    setNextFollowUpDate(d.NextFollowUpDate?.slice(0, 10) || "");
    setFollowUpType(d.FollowUpType || "Inspection");
    setFollowUpRemarks(d.FollowUpRemarks || "");
    setHydrated(true);
  }, [detailQ.data, editingId, hydrated]);

  const assetOpts = useMemo(
    () => (assetsQ.data ?? []).map((a) => ({ key: String(a.AssetId), label: a.FAItemCode, sublabel: a.AssetName })),
    [assetsQ.data],
  );
  const ctx = ctxQ.data;

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        docDate,
        assetId: Number(assetId),
        qualityStatus: qualityStatus as (typeof QUALITY)[number],
        remarks: remarks || undefined,
        itemPicture: itemPicture || null,
        nextFollowUpDate,
        followUpType: followUpType || undefined,
        followUpRemarks: followUpRemarks || undefined,
      };
      if (editingId) { await updateQualityCheck(editingId, payload); return; }
      await createQualityCheck(payload);
    },
    onSuccess: () => {
      toast.success(editingId ? "Quality check updated" : "Quality check recorded");
      qc.invalidateQueries({ queryKey: ["fa-quality"] });
      nav.goBack();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const submit = () => {
    if (!assetId) return toast.error("Select an FA Item Code");
    if (!QUALITY.includes(qualityStatus as never)) return toast.error("Pick a quality status");
    if (!nextFollowUpDate) return toast.error("Next follow-up date is required");
    save.mutate();
  };

  return (
    <FormScaffold onSubmit={submit} onCancel={() => nav.goBack()} submitLabel={editingId ? "Update" : "Record"} submitting={save.isPending}>
      <FormSection title="Document">
        <DateField label="Doc Date" value={docDate} onChange={setDocDate} required />
        {editingId ? (
          <Text style={{ color: colors.mutedForeground, fontSize: 11, fontFamily: fonts.body.medium, marginBottom: 10 }}>
            {detailQ.data?.FAItemCode} · {detailQ.data?.ItemName}
          </Text>
        ) : (
          <PickerField label="FA Item Code" value={assetId} options={assetOpts} onSelect={setAssetId} loading={assetsQ.isLoading} required />
        )}
        {ctx && (
          <View style={{ backgroundColor: `${colors.muted}80`, borderRadius: 10, padding: 10, marginBottom: 14 }}>
            <Text style={{ color: colors.foreground, fontSize: 12, fontFamily: fonts.body.medium }}>{ctx.itemName}</Text>
            <Text style={{ color: colors.mutedForeground, fontSize: 10.5, fontFamily: fonts.body.regular, marginTop: 2 }}>
              Holder: {ctx.currentUserName || "—"} · Responsible: {ctx.responsibleUserName || "—"}
            </Text>
            {ctx.itemPicture && (
              <View style={{ flexDirection: "row", gap: 8, alignItems: "center", marginTop: 8 }}>
                <Image source={{ uri: ctx.itemPicture }} style={{ width: 44, height: 44, borderRadius: 8 }} />
                <Text style={{ color: "#5c6270", fontSize: 9.5, fontFamily: fonts.body.regular, flex: 1 }}>
                  Previous image{ctx.itemPictureFromDocNo ? ` · ${ctx.itemPictureFromDocNo}` : ""}
                </Text>
              </View>
            )}
          </View>
        )}
      </FormSection>

      <FormSection title="Quality">
        <PickerField label="Quality Status" value={qualityStatus} searchable={false}
          options={QUALITY.map((q) => ({ key: q, label: q }))} onSelect={setQualityStatus} required />
        <ImageCaptureField label="Item Picture" value={itemPicture} onChange={setItemPicture} hint="JPG, PNG or WEBP · max 4 MB" />
        <RemarksField label="Remarks" value={remarks} onChangeText={setRemarks} />
      </FormSection>

      <FormSection title="Follow-Up">
        <DateField label="Next Follow-Up Date" value={nextFollowUpDate} onChange={setNextFollowUpDate} required />
        <PickerField label="Follow-Up Type" value={followUpType} searchable={false}
          options={FOLLOWUP_TYPES.map((t) => ({ key: t, label: t }))} onSelect={setFollowUpType} />
        <RemarksField label="Follow-Up Remarks" value={followUpRemarks} onChangeText={setFollowUpRemarks} />
      </FormSection>
    </FormScaffold>
  );
}
