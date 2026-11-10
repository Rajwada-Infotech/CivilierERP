// RN port of IssueReturn.tsx's detail overlay, on the drawing sheet: the return's number as the title with its date,
// company and project; its status mark; the particulars (return date, the issue it returns against, created, reason,
// remarks); and the returned items line by line. This module runs its own submit / approve / reject (not the generic
// approval trail), so its keys sit in the title block: Edit and Submit while Draft, Approve and Reject while Pending,
// Delete while Draft or Rejected. Web leaves Approve / Reject to the list row; mobile adds them here.
import { View, Alert } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Pencil, Send, Trash2, Undo2 } from "lucide-react-native";
import { sheet as S } from "@/theme/colors";
import { getIssueReturnById, deleteIssueReturn, submitIssueReturn, approveIssueReturn, rejectIssueReturn, type IssueReturn } from "@/api/issueReturnApi";
import { InfoGrid, Key, Panel, SheetMark, statusTone } from "@/components/sheet/Sheet";
import { DetailSheet, LineList, fmtDate } from "@/components/sheet/Register";

export function IssueReturnDetailModal({
  recordId, onClose, onEdit, canEdit, canDelete,
}: { recordId: number | null; onClose: () => void; onEdit?: (id: number) => void; canEdit?: boolean; canDelete?: boolean }) {
  const queryClient = useQueryClient();
  const { data: rec, isLoading, isError, error, refetch } = useQuery<IssueReturn>({
    queryKey: ["irn-detail", recordId],
    queryFn: () => getIssueReturnById(recordId!),
    enabled: recordId != null,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["issue-returns-mobile"], exact: false });
    queryClient.invalidateQueries({ queryKey: ["irn-detail", recordId] });
  };
  const submitMutation = useMutation({ mutationFn: () => submitIssueReturn(recordId!), onSuccess: refresh, onError: (e: any) => Alert.alert("Could not submit", e.message ?? "Something went wrong.") });
  const approveMutation = useMutation({ mutationFn: () => approveIssueReturn(recordId!), onSuccess: refresh, onError: (e: any) => Alert.alert("Could not approve", e.message ?? "Something went wrong.") });
  const rejectMutation = useMutation({ mutationFn: () => rejectIssueReturn(recordId!), onSuccess: refresh, onError: (e: any) => Alert.alert("Could not reject", e.message ?? "Something went wrong.") });
  const deleteMutation = useMutation({
    mutationFn: () => deleteIssueReturn(recordId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["issue-returns-mobile"], exact: false });
      onClose();
    },
    onError: (e: any) => Alert.alert("Could not delete", e.message ?? "Something went wrong."),
  });
  const confirmDelete = () =>
    Alert.alert("Delete issue return?", "This can't be undone.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => deleteMutation.mutate() },
    ]);

  const busy = submitMutation.isPending || approveMutation.isPending || rejectMutation.isPending || deleteMutation.isPending;
  const status = rec?.Status || "Draft";

  return (
    <DetailSheet
      visible={recordId != null}
      onClose={onClose}
      eyebrow="CivilierERP · Material · Issue return"
      title={rec ? rec.DocNo || `IRN-${rec.ReturnId}` : "Issue return"}
      subtitle={rec ? [fmtDate(rec.ReturnDate), rec.CompanyName, rec.ProjectName].filter(Boolean).join(" · ") : undefined}
      actions={
        rec ? (
          <>
            {status === "Draft" && canEdit && onEdit && <Key label="Edit" icon={<Pencil size={13} color={S.ink} />} onPress={() => onEdit(rec.ReturnId)} />}
            {status === "Draft" && canEdit && <Key tone="ink" label={submitMutation.isPending ? "Submitting…" : "Submit"} icon={<Send size={13} color={S.paper} />} onPress={() => submitMutation.mutate()} disabled={busy} />}
            {status === "Pending" && canEdit && (
              <>
                <Key tone="ink" label={approveMutation.isPending ? "Approving…" : "Approve"} icon={<Check size={13} color={S.paper} />} onPress={() => approveMutation.mutate()} disabled={busy} />
                <Key tone="red" label={rejectMutation.isPending ? "Rejecting…" : "Reject"} onPress={() => rejectMutation.mutate()} disabled={busy} />
              </>
            )}
            {canDelete && (status === "Draft" || status === "Rejected") && (
              <Key tone="red" label="Delete" icon={<Trash2 size={13} color="#ffffff" />} onPress={confirmDelete} disabled={busy} />
            )}
          </>
        ) : null
      }
      loading={isLoading || !rec}
      error={isError ? (error as Error)?.message || "Could not load this return." : null}
      onRetry={() => refetch()}
    >
      {rec && (
        <>
          <View style={{ flexDirection: "row" }}>
            <SheetMark text={status} tone={/draft/i.test(status) ? "draft" : statusTone(status)} />
          </View>
          <InfoGrid
            items={[
              { label: "Return date", value: fmtDate(rec.ReturnDate) },
              { label: "Against issue", value: rec.IssueDocNo || "—" },
              { label: "Company", value: rec.CompanyName || "—" },
              { label: "Project", value: rec.ProjectName || "—" },
              { label: "Created", value: fmtDate(rec.CreatedAt) },
              ...(rec.Reason ? [{ label: "Reason", value: rec.Reason, wide: true }] : []),
              ...(rec.Remarks ? [{ label: "Remarks", value: rec.Remarks, wide: true }] : []),
            ]}
          />
          <Panel title={`Returned items (${rec.items?.length ?? 0})`} icon={<Undo2 size={14} color={S.ink} />}>
            <LineList empty="No items on this return." rows={(rec.items ?? []).map((it, i) => ({ key: i, title: it.ItemName || "—", right: `${it.Quantity} ${it.UOMSymbol}` }))} />
          </Panel>
        </>
      )}
    </DetailSheet>
  );
}
