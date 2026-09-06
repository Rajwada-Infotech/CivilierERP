// One quality check — detail, quick Complete/Cancel of the follow-up,
// edit and delete.
import { useState } from "react";
import { Image, View } from "react-native";
import type { RouteProp } from "@react-navigation/native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Trash2, Check, Ban } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { navigate } from "@/navigation/navigationRef";
import { toast } from "@/components/Toast";
import { ConfirmSheet } from "@/components/ConfirmSheet";
import { DetailScaffold, DetailSection, DetailRow, ActionButton } from "@/components/detail/DetailScaffold";
import { usePageRights } from "@/hooks/usePageRights";
import { getQualityCheck, setFollowUpStatus, deleteQualityCheck } from "@/api/fixedAssetApi";
import type { MainStackParamList } from "@/navigation/MainStack";

export default function QualityCheckDetailScreen() {
  const { id } = useRoute<RouteProp<MainStackParamList, "QualityCheckDetail">>().params;
  const nav = useNavigation();
  const qc = useQueryClient();
  const rights = usePageRights("fixed-asset-quality-check");
  const [refreshing, setRefreshing] = useState(false);
  const [confirm, setConfirm] = useState(false);

  const q = useQuery({ queryKey: ["fa-quality", id], queryFn: () => getQualityCheck(id) });
  const d = q.data;
  const onRefresh = async () => { setRefreshing(true); await q.refetch(); setRefreshing(false); };

  const invalidate = () => qc.invalidateQueries({ queryKey: ["fa-quality"] });

  const fuMut = useMutation({
    mutationFn: (status: "Completed" | "Cancelled") => setFollowUpStatus(id, status),
    onSuccess: () => { toast.success("Follow-up updated"); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const delMut = useMutation({
    mutationFn: () => deleteQualityCheck(id),
    onSuccess: () => { toast.success("Quality check deleted"); invalidate(); setConfirm(false); nav.goBack(); },
    onError: (e: Error) => { toast.error(e.message); setConfirm(false); },
  });

  const overdue = d?.IsOverdue === 1 && d?.FollowUpStatus === "Pending";
  const pending = d?.FollowUpStatus === "Pending";

  return (
    <>
      <DetailScaffold
        loading={q.isLoading}
        error={q.error ? (q.error as Error).message : null}
        title={d?.DocNo || (d ? `#${d.QualityCheckId}` : "")}
        subtitle={d?.FAItemCode || undefined}
        status={overdue ? "Overdue" : d?.FollowUpStatus}
        refreshing={refreshing}
        onRefresh={onRefresh}
        actions={d && (
          <>
            {rights.canEdit && pending && (
              <>
                <ActionButton label="Complete" tone="primary" icon={(p) => <Check {...p} />} onPress={() => fuMut.mutate("Completed")} disabled={fuMut.isPending} />
                <ActionButton label="Cancel FU" icon={(p) => <Ban {...p} />} onPress={() => fuMut.mutate("Cancelled")} disabled={fuMut.isPending} />
              </>
            )}
            {rights.canEdit && (
              <ActionButton label="Edit" icon={(p) => <Pencil {...p} />} onPress={() => navigate("QualityCheckForm", { id })} />
            )}
            {rights.canDelete && (
              <ActionButton label="Delete" tone="danger" icon={(p) => <Trash2 {...p} />} onPress={() => setConfirm(true)} />
            )}
          </>
        )}
      >
        {d && (
          <>
            {d.ItemPicture ? (
              <View style={{ marginBottom: 12 }}>
                <Image source={{ uri: d.ItemPicture }} style={{ width: 110, height: 110, borderRadius: 12, borderWidth: 1, borderColor: colors.border }} />
              </View>
            ) : null}
            <DetailSection title="Quality">
              <DetailRow label="Status" value={d.QualityStatus} />
              <DetailRow label="Item" value={d.ItemName} />
              <DetailRow label="Holder" value={d.CurrentUserName} />
              <DetailRow label="Responsible" value={d.ResponsibleUserName} />
              <DetailRow label="Remarks" value={d.Remarks} />
            </DetailSection>
            <DetailSection title="Follow-Up">
              <DetailRow label="Type" value={d.FollowUpType} />
              <DetailRow label="Next Date" value={d.NextFollowUpDate ? new Date(d.NextFollowUpDate).toLocaleDateString("en-IN") : null} />
              <DetailRow label="Status" value={d.FollowUpStatus} />
              <DetailRow label="Last Follow-Up" value={d.LastFollowUpDate ? new Date(d.LastFollowUpDate).toLocaleDateString("en-IN") : null} />
              <DetailRow label="Follow-Up Remarks" value={d.FollowUpRemarks} />
              <DetailRow label="Completed By" value={d.CompletedBy} />
            </DetailSection>
            <DetailSection title="Context">
              <DetailRow label="Company" value={d.CompanyName} />
              <DetailRow label="Project" value={d.ProjectName} />
              <DetailRow label="Doc Date" value={d.DocDate ? new Date(d.DocDate).toLocaleDateString("en-IN") : null} />
              <DetailRow label="Created By" value={d.CreatedBy} />
            </DetailSection>
          </>
        )}
      </DetailScaffold>
      <ConfirmSheet
        visible={confirm}
        title="Delete this quality check?"
        confirmLabel="Delete"
        loading={delMut.isPending}
        onConfirm={() => delMut.mutate()}
        onClose={() => setConfirm(false)}
      />
    </>
  );
}
