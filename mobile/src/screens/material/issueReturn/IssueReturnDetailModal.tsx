// RN port of IssueReturn.tsx's detail overlay — single scroll, no tabs.
// This module runs its own submit/approve/reject actions (not the generic
// ApprovalStatusChain trail), so the action buttons live here directly,
// following the same pattern as ReceivedPaymentDetailModal.tsx. Web's
// overlay only exposes Edit/Submit inline and leaves Approve/Reject to the
// list row — mobile adds them here too since a user viewing detail is the
// more natural place to act from.
import { View, Text, Modal, Pressable, ScrollView, Alert, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X, Undo2, Pencil, Trash2, Send, Check } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import {
  getIssueReturnById, deleteIssueReturn, submitIssueReturn, approveIssueReturn, rejectIssueReturn,
  STATUS_COLOR, type IssueReturn,
} from "@/api/issueReturnApi";

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? d : dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ width: "50%", paddingRight: 8, marginBottom: 12 }}>
      <Text style={{ color: colors.mutedForeground, fontSize: 9, fontFamily: fonts.heading.medium, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</Text>
      <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 12.5, fontFamily: fonts.body.medium, marginTop: 2 }}>{value}</Text>
    </View>
  );
}

function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLOR[status] ?? "#64748b";
  return (
    <View className="px-2 py-0.5 rounded-full" style={{ backgroundColor: `${color}1a`, borderWidth: 1, borderColor: `${color}40` }}>
      <Text style={{ color, fontSize: 10.5, fontFamily: fonts.heading.semibold }}>{status}</Text>
    </View>
  );
}

export function IssueReturnDetailModal({
  recordId, onClose, onEdit, canEdit, canDelete,
}: { recordId: number | null; onClose: () => void; onEdit?: (id: number) => void; canEdit?: boolean; canDelete?: boolean }) {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const { data: rec, isLoading } = useQuery<IssueReturn>({
    queryKey: ["irn-detail", recordId],
    queryFn: () => getIssueReturnById(recordId!),
    enabled: recordId != null,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["issue-returns-mobile"], exact: false });

  const submitMutation = useMutation({
    mutationFn: () => submitIssueReturn(recordId!),
    onSuccess: () => { invalidate(); queryClient.invalidateQueries({ queryKey: ["irn-detail", recordId] }); },
    onError: (err: any) => Alert.alert("Submit failed", err.message ?? "Something went wrong."),
  });
  const approveMutation = useMutation({
    mutationFn: () => approveIssueReturn(recordId!),
    onSuccess: () => { invalidate(); queryClient.invalidateQueries({ queryKey: ["irn-detail", recordId] }); },
    onError: (err: any) => Alert.alert("Approve failed", err.message ?? "Something went wrong."),
  });
  const rejectMutation = useMutation({
    mutationFn: () => rejectIssueReturn(recordId!),
    onSuccess: () => { invalidate(); queryClient.invalidateQueries({ queryKey: ["irn-detail", recordId] }); },
    onError: (err: any) => Alert.alert("Reject failed", err.message ?? "Something went wrong."),
  });
  const deleteMutation = useMutation({
    mutationFn: () => deleteIssueReturn(recordId!),
    onSuccess: () => { invalidate(); onClose(); },
    onError: (err: any) => Alert.alert("Delete failed", err.message ?? "Something went wrong."),
  });

  const confirmDelete = () => {
    Alert.alert("Delete Issue Return?", "This can't be undone.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => deleteMutation.mutate() },
    ]);
  };

  if (recordId == null) return null;

  const canDeleteRow = canDelete && (rec?.Status === "Draft" || rec?.Status === "Rejected");
  const busy = submitMutation.isPending || approveMutation.isPending || rejectMutation.isPending || deleteMutation.isPending;

  return (
    <Modal visible={recordId != null} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <View style={{ paddingTop: insets.top + 8 }} className="flex-row items-center justify-between px-4 pb-3">
          <View className="flex-row items-center gap-2.5 flex-1 min-w-0">
            <View className="w-8 h-8 rounded-lg items-center justify-center" style={{ backgroundColor: "#0ea5e926" }}>
              <Undo2 size={14} color="#0ea5e9" />
            </View>
            <View className="min-w-0">
              <Text style={{ color: colors.foreground, fontSize: 14, fontFamily: fonts.heading.semibold }}>Issue Return</Text>
              {!!rec?.DocNo && <Text style={{ color: colors.mutedForeground, fontSize: 10.5 }}>{rec.DocNo}</Text>}
            </View>
          </View>
          <Pressable onPress={onClose} className="w-8 h-8 rounded-lg items-center justify-center" style={{ borderWidth: 1, borderColor: colors.border }}>
            <X size={15} color={colors.mutedForeground} />
          </Pressable>
        </View>

        {isLoading || !rec ? (
          <View className="flex-1 items-center justify-center"><ActivityIndicator color={colors.mutedForeground} /></View>
        ) : (
          <>
            <View className="flex-row items-center flex-wrap gap-1.5 px-4 pb-3">
              {rec.Status === "Draft" && canEdit && onEdit && (
                <Pressable onPress={() => onEdit(rec.ReturnId)} className="flex-row items-center gap-1.5 px-3 py-2 rounded-lg" style={{ borderWidth: 1, borderColor: colors.border }}>
                  <Pencil size={12} color={colors.mutedForeground} />
                  <Text style={{ color: colors.mutedForeground, fontSize: 11.5, fontFamily: fonts.heading.medium }}>Edit</Text>
                </Pressable>
              )}
              {rec.Status === "Draft" && canEdit && (
                <Pressable
                  onPress={() => submitMutation.mutate()} disabled={busy}
                  className="flex-row items-center gap-1.5 px-3 py-2 rounded-lg" style={{ borderWidth: 1, borderColor: "#0ea5e933", backgroundColor: "#0ea5e90d" }}
                >
                  <Send size={12} color="#0ea5e9" />
                  <Text style={{ color: "#0ea5e9", fontSize: 11.5, fontFamily: fonts.heading.medium }}>Submit</Text>
                </Pressable>
              )}
              {rec.Status === "Pending" && canEdit && (
                <>
                  <Pressable
                    onPress={() => approveMutation.mutate()} disabled={busy}
                    className="flex-row items-center gap-1.5 px-3 py-2 rounded-lg" style={{ borderWidth: 1, borderColor: "#05966933", backgroundColor: "#0596690d" }}
                  >
                    <Check size={12} color="#059669" />
                    <Text style={{ color: "#059669", fontSize: 11.5, fontFamily: fonts.heading.medium }}>Approve</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => rejectMutation.mutate()} disabled={busy}
                    className="flex-row items-center gap-1.5 px-3 py-2 rounded-lg" style={{ borderWidth: 1, borderColor: colors.border }}
                  >
                    <X size={12} color={colors.destructive} />
                    <Text style={{ color: colors.destructive, fontSize: 11.5, fontFamily: fonts.heading.medium }}>Reject</Text>
                  </Pressable>
                </>
              )}
              {canDeleteRow && (
                <Pressable
                  onPress={confirmDelete} disabled={busy}
                  className="flex-row items-center gap-1.5 px-3 py-2 rounded-lg ml-auto" style={{ borderWidth: 1, borderColor: colors.border }}
                >
                  <Trash2 size={12} color={colors.destructive} />
                  <Text style={{ color: colors.destructive, fontSize: 11.5, fontFamily: fonts.heading.medium }}>Delete</Text>
                </Pressable>
              )}
            </View>

            <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}>
              <View className="mb-4"><StatusBadge status={rec.Status} /></View>

              <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
                <Field label="Return Date" value={fmtDate(rec.ReturnDate)} />
                <Field label="Issue Reference" value={rec.IssueDocNo || "—"} />
                <Field label="Company" value={rec.CompanyName || "—"} />
                <Field label="Project" value={rec.ProjectName || "—"} />
                <Field label="Created" value={fmtDate(rec.CreatedAt)} />
              </View>

              {!!rec.Reason && (
                <View className="rounded-xl px-3 py-2.5 mb-3" style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: `${colors.muted}30` }}>
                  <Text style={{ color: colors.mutedForeground, fontSize: 9, fontFamily: fonts.heading.medium, textTransform: "uppercase", marginBottom: 4 }}>Reason</Text>
                  <Text style={{ color: colors.foreground, fontSize: 12 }}>{rec.Reason}</Text>
                </View>
              )}

              {!!rec.items?.length && (
                <View className="mb-3">
                  <Text style={{ color: colors.mutedForeground, fontSize: 9, fontFamily: fonts.heading.semibold, textTransform: "uppercase", marginBottom: 6 }}>
                    Return Items ({rec.items.length})
                  </Text>
                  <View className="rounded-xl overflow-hidden" style={{ borderWidth: 1, borderColor: colors.border }}>
                    {rec.items.map((it, i) => (
                      <View key={i} className="flex-row items-center justify-between px-3 py-2.5" style={{ borderTopWidth: i > 0 ? 1 : 0, borderTopColor: `${colors.border}80` }}>
                        <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 12, flex: 1, marginRight: 8 }}>{it.ItemName || "—"}</Text>
                        <Text style={{ color: colors.primary, fontSize: 12, fontFamily: fonts.heading.semibold }}>{it.Quantity} {it.UOMSymbol}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}

              {!!rec.Remarks && (
                <View className="rounded-xl px-3 py-2.5" style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: `${colors.muted}30` }}>
                  <Text style={{ color: colors.mutedForeground, fontSize: 9, fontFamily: fonts.heading.medium, textTransform: "uppercase", marginBottom: 4 }}>Remarks</Text>
                  <Text style={{ color: colors.foreground, fontSize: 12 }}>{rec.Remarks}</Text>
                </View>
              )}
            </ScrollView>
          </>
        )}
      </View>
    </Modal>
  );
}
