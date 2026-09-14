// One user-wise asset transfer — detail + edit / delete (soft).
import { useState } from "react";
import type { RouteProp } from "@react-navigation/native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Trash2 } from "lucide-react-native";
import { navigate } from "@/navigation/navigationRef";
import { toast } from "@/components/Toast";
import { ConfirmSheet } from "@/components/ConfirmSheet";
import { DetailScaffold, DetailSection, DetailRow, ActionButton } from "@/components/detail/DetailScaffold";
import { usePageRights } from "@/hooks/usePageRights";
import { getAssetTransfer, deleteAssetTransfer } from "@/api/fixedAssetApi";
import type { MainStackParamList } from "@/navigation/MainStack";

export default function AssetTransferDetailScreen() {
  const { id } = useRoute<RouteProp<MainStackParamList, "AssetTransferDetail">>().params;
  const nav = useNavigation();
  const qc = useQueryClient();
  const rights = usePageRights("asset-transfer");
  const [refreshing, setRefreshing] = useState(false);
  const [confirm, setConfirm] = useState(false);

  const q = useQuery({ queryKey: ["fa-transfer", id], queryFn: () => getAssetTransfer(id) });
  const d = q.data;
  const onRefresh = async () => { setRefreshing(true); await q.refetch(); setRefreshing(false); };

  const delMut = useMutation({
    mutationFn: () => deleteAssetTransfer(id),
    onSuccess: () => {
      toast.success("Transfer deleted");
      qc.invalidateQueries({ queryKey: ["fa-transfer"] });
      qc.invalidateQueries({ queryKey: ["fa-assignment"] });
      qc.invalidateQueries({ queryKey: ["fa-assets"] });
      setConfirm(false);
      nav.goBack();
    },
    onError: (e: Error) => { toast.error(e.message); setConfirm(false); },
  });

  return (
    <>
      <DetailScaffold
        loading={q.isLoading}
        error={q.error ? (q.error as Error).message : null}
        title={d?.DocNo || (d ? `#${d.Id}` : "")}
        subtitle={d?.FAItemCode || d?.AssetName || undefined}
        refreshing={refreshing}
        onRefresh={onRefresh}
        actions={d && (
          <>
            {rights.canEdit && (
              <ActionButton label="Edit" tone="primary" icon={(p) => <Pencil {...p} />} onPress={() => navigate("AssetTransferForm", { id })} />
            )}
            {rights.canDelete && (
              <ActionButton label="Delete" tone="danger" icon={(p) => <Trash2 {...p} />} onPress={() => setConfirm(true)} />
            )}
          </>
        )}
      >
        {d && (
          <>
            <DetailSection title="Transfer">
              <DetailRow label="Asset" value={d.AssetName} />
              <DetailRow label="Category" value={d.AssetCategory} />
              <DetailRow label="From" value={d.FromUserName} />
              <DetailRow label="To" value={d.ToUserName} />
              <DetailRow label="Department" value={d.DepartmentName} />
              <DetailRow label="Transferred By" value={d.TransferredByName} />
            </DetailSection>
            <DetailSection title="Context">
              <DetailRow label="Company" value={d.CompanyName} />
              <DetailRow label="Project" value={d.ProjectName} />
              <DetailRow label="Financial Year" value={d.FinYear} />
              <DetailRow label="Transfer Date" value={(d.TransferDate || d.DocDate) ? new Date(d.TransferDate || d.DocDate!).toLocaleDateString("en-IN") : null} />
              <DetailRow label="Remarks" value={d.Remarks} />
            </DetailSection>
          </>
        )}
      </DetailScaffold>
      <ConfirmSheet
        visible={confirm}
        title="Delete this transfer?"
        message="Soft-deleted for audit. The asset's custody reverts to whatever the remaining history says."
        confirmLabel="Delete"
        loading={delMut.isPending}
        onConfirm={() => delMut.mutate()}
        onClose={() => setConfirm(false)}
      />
    </>
  );
}
