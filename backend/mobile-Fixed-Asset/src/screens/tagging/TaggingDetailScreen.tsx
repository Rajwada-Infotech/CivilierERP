// One FA Inventory tagging entry — detail + edit (date/remarks) + cancel.
import { useState } from "react";
import type { RouteProp } from "@react-navigation/native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Ban } from "lucide-react-native";
import { navigate } from "@/navigation/navigationRef";
import { toast } from "@/components/Toast";
import { ConfirmSheet } from "@/components/ConfirmSheet";
import { DetailScaffold, DetailSection, DetailRow, ActionButton } from "@/components/detail/DetailScaffold";
import { usePageRights } from "@/hooks/usePageRights";
import { getFixedAssetTagging, deleteFixedAssetTagging } from "@/api/fixedAssetApi";
import type { MainStackParamList } from "@/navigation/MainStack";

export default function TaggingDetailScreen() {
  const { id } = useRoute<RouteProp<MainStackParamList, "TaggingDetail">>().params;
  const nav = useNavigation();
  const qc = useQueryClient();
  const rights = usePageRights("fixed-asset-tagging");
  const [refreshing, setRefreshing] = useState(false);
  const [confirm, setConfirm] = useState(false);

  const q = useQuery({ queryKey: ["fa-tagging", id], queryFn: () => getFixedAssetTagging(id) });
  const d = q.data;

  const onRefresh = async () => { setRefreshing(true); await q.refetch(); setRefreshing(false); };

  const cancelMut = useMutation({
    mutationFn: () => deleteFixedAssetTagging(id),
    onSuccess: () => {
      toast.success("Tagging entry cancelled");
      qc.invalidateQueries({ queryKey: ["fa-tagging"] });
      qc.invalidateQueries({ queryKey: ["fa-assets"] });
      setConfirm(false);
      nav.goBack();
    },
    onError: (e: Error) => { toast.error(e.message); setConfirm(false); },
  });

  const canModify = d?.Status === "Tagged";

  return (
    <>
      <DetailScaffold
        loading={q.isLoading}
        error={q.error ? (q.error as Error).message : null}
        title={d?.DocNo || (d ? `#${d.TagId}` : "")}
        subtitle={d?.FAItemCode || undefined}
        status={d?.Status}
        refreshing={refreshing}
        onRefresh={onRefresh}
        actions={d && (
          <>
            {rights.canEdit && canModify && (
              <ActionButton label="Edit" tone="primary" icon={(p) => <Pencil {...p} />} onPress={() => navigate("TaggingForm", { id })} />
            )}
            {rights.canDelete && canModify && d.RecordStatus !== "Done" && (
              <ActionButton label="Cancel Tag" tone="danger" icon={(p) => <Ban {...p} />} onPress={() => setConfirm(true)} />
            )}
          </>
        )}
      >
        {d && (
          <>
            <DetailSection title="Tagging">
              <DetailRow label="Asset" value={d.AssetName} />
              <DetailRow label="Category" value={d.AssetCategory} />
              <DetailRow label="Asset Code" value={d.AssetCode} />
              <DetailRow label="Tagged Qty" value={String(d.TaggedQty)} />
              <DetailRow label="Batch Quantity" value={d.BatchQuantity != null ? String(d.BatchQuantity) : null} />
              <DetailRow label="Record" value={d.RecordStatus || "—"} />
            </DetailSection>
            <DetailSection title="Context">
              <DetailRow label="Company" value={d.CompanyName} />
              <DetailRow label="Project" value={d.ProjectName} />
              <DetailRow label="Godown" value={d.GodownName} />
              <DetailRow label="Financial Year" value={d.FinYear} />
              <DetailRow label="Doc Date" value={d.DocDate ? new Date(d.DocDate).toLocaleDateString("en-IN") : null} />
              <DetailRow label="Created By" value={d.CreatedBy} />
              <DetailRow label="Remarks" value={d.Remarks} />
            </DetailSection>
          </>
        )}
      </DetailScaffold>
      <ConfirmSheet
        visible={confirm}
        title="Cancel this tag?"
        message="The tagged quantity is freed back to the batch. Blocked if the FA Item Code already has a Fixed Asset Record."
        confirmLabel="Cancel Tag"
        loading={cancelMut.isPending}
        onConfirm={() => cancelMut.mutate()}
        onClose={() => setConfirm(false)}
      />
    </>
  );
}
