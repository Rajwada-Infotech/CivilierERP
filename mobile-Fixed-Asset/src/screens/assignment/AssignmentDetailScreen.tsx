// One assignment — detail + edit / delete. Delete is blocked for
// transfer-sourced rows (the route rejects it).
import { useState } from "react";
import { Image, View } from "react-native";
import type { RouteProp } from "@react-navigation/native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Trash2 } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { navigate } from "@/navigation/navigationRef";
import { toast } from "@/components/Toast";
import { ConfirmSheet } from "@/components/ConfirmSheet";
import { DetailScaffold, DetailSection, DetailRow, ActionButton } from "@/components/detail/DetailScaffold";
import { usePageRights } from "@/hooks/usePageRights";
import { getAssignment, deleteAssignment } from "@/api/fixedAssetApi";
import type { MainStackParamList } from "@/navigation/MainStack";

export default function AssignmentDetailScreen() {
  const { id } = useRoute<RouteProp<MainStackParamList, "AssignmentDetail">>().params;
  const nav = useNavigation();
  const qc = useQueryClient();
  const rights = usePageRights("fixed-asset-assignment");
  const [refreshing, setRefreshing] = useState(false);
  const [confirm, setConfirm] = useState(false);

  const q = useQuery({ queryKey: ["fa-assignment", id], queryFn: () => getAssignment(id) });
  const d = q.data;
  const onRefresh = async () => { setRefreshing(true); await q.refetch(); setRefreshing(false); };

  const delMut = useMutation({
    mutationFn: () => deleteAssignment(id),
    onSuccess: () => {
      toast.success("Assignment deleted");
      qc.invalidateQueries({ queryKey: ["fa-assignment"] });
      qc.invalidateQueries({ queryKey: ["fa-assets"] });
      setConfirm(false);
      nav.goBack();
    },
    onError: (e: Error) => { toast.error(e.message); setConfirm(false); },
  });

  const fromTransfer = !!d?.SourceTransferDocNo;

  return (
    <>
      <DetailScaffold
        loading={q.isLoading}
        error={q.error ? (q.error as Error).message : null}
        title={d?.DocNo || (d ? `#${d.AssignmentId}` : "")}
        subtitle={d?.FAItemCode || undefined}
        status={d?.IsCurrent ? "Current" : "Superseded"}
        refreshing={refreshing}
        onRefresh={onRefresh}
        actions={d && (
          <>
            {rights.canEdit && (
              <ActionButton label="Edit" tone="primary" icon={(p) => <Pencil {...p} />} onPress={() => navigate("AssignmentForm", { id })} />
            )}
            {rights.canDelete && !fromTransfer && (
              <ActionButton label="Delete" tone="danger" icon={(p) => <Trash2 {...p} />} onPress={() => setConfirm(true)} />
            )}
          </>
        )}
      >
        {d && (
          <>
            {d.UserImage ? (
              <View style={{ alignItems: "flex-start", marginBottom: 12 }}>
                <Image source={{ uri: d.UserImage }} style={{ width: 90, height: 90, borderRadius: 12, borderWidth: 1, borderColor: colors.border }} />
              </View>
            ) : null}
            <DetailSection title="Assignment">
              <DetailRow label="Asset" value={d.AssetName} />
              <DetailRow label="Category" value={d.AssetCategory} />
              <DetailRow label="Holder" value={d.UserName} />
              <DetailRow label="Responsible" value={d.ResponsibleUserName} />
              <DetailRow label="Source Transfer" value={d.SourceTransferDocNo} />
            </DetailSection>
            <DetailSection title="Context">
              <DetailRow label="Company" value={d.CompanyName} />
              <DetailRow label="Project" value={d.ProjectName} />
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
        title="Delete this assignment?"
        message="The asset's current holder is recomputed from the remaining assignment / transfer history."
        confirmLabel="Delete"
        loading={delMut.isPending}
        onConfirm={() => delMut.mutate()}
        onClose={() => setConfirm(false)}
      />
    </>
  );
}
