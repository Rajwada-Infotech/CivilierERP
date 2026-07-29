// RN port of AmendmentMenu.tsx's AmendmentDetailDialog — single scroll, no
// tabs. This is the entire before/after "diff" UI on web: a single
// Original→Revised money comparison, not a structured multi-field diff
// (the AmendmentLineChanges sub-system exists server-side but no web page
// ever calls it — not ported). Submit/Approve/Reject/Delete live here,
// gated by Status + role, mirroring web's own gating exactly (approve/
// reject need APPROVER_ROLES, not a page-rights check).
import { View, Text, Modal, Pressable, ScrollView, Alert, ActivityIndicator, TextInput } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { X, FileEdit, ArrowRight, Pencil, Trash2, Send, Check, ShieldCheck } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { formatINR } from "@/utils/formatCurrency";
import { useAuth } from "@/auth/AuthContext";
import {
  getAmendment, deleteAmendment, submitAmendment, approveAmendment, rejectAmendment,
  APPROVER_ROLES, STATUS_COLOR, DOC_TYPE_LABEL, type Amendment,
} from "@/api/amendmentsApi";

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? d : dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLOR[status] ?? "#64748b";
  return (
    <View className="px-2 py-0.5 rounded-full" style={{ backgroundColor: `${color}1a`, borderWidth: 1, borderColor: `${color}40` }}>
      <Text style={{ color, fontSize: 10.5, fontFamily: fonts.heading.semibold }}>{status}</Text>
    </View>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ width: "50%", paddingRight: 8, marginBottom: 12 }}>
      <Text style={{ color: colors.mutedForeground, fontSize: 9, fontFamily: fonts.heading.medium, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</Text>
      <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 12.5, fontFamily: fonts.body.medium, marginTop: 2 }}>{value}</Text>
    </View>
  );
}

export function AmendmentDetailModal({
  recordId, onClose, onEdit, canEdit, canDelete,
}: { recordId: number | null; onClose: () => void; onEdit?: (id: number) => void; canEdit?: boolean; canDelete?: boolean }) {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { currentUser } = useAuth();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectNote, setRejectNote] = useState("");
  const canApprove = APPROVER_ROLES.includes(currentUser?.role ?? "");

  const { data: amd, isLoading } = useQuery<Amendment>({
    queryKey: ["amd-detail", recordId],
    queryFn: () => getAmendment(recordId!),
    enabled: recordId != null,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["amendments-mobile"], exact: false });
    queryClient.invalidateQueries({ queryKey: ["amd-detail", recordId] });
  };

  const submitMutation = useMutation({ mutationFn: () => submitAmendment(recordId!), onSuccess: invalidate, onError: (e: any) => Alert.alert("Submit failed", e.message ?? "Something went wrong.") });
  const approveMutation = useMutation({ mutationFn: () => approveAmendment(recordId!), onSuccess: invalidate, onError: (e: any) => Alert.alert("Approve failed", e.message ?? "Something went wrong.") });
  const rejectMutation = useMutation({
    mutationFn: () => rejectAmendment(recordId!, rejectNote.trim()),
    onSuccess: () => { setRejectOpen(false); setRejectNote(""); invalidate(); },
    onError: (e: any) => Alert.alert("Reject failed", e.message ?? "Something went wrong."),
  });
  const deleteMutation = useMutation({
    mutationFn: () => deleteAmendment(recordId!),
    onSuccess: () => { invalidate(); onClose(); },
    onError: (e: any) => Alert.alert("Delete failed", e.message ?? "Something went wrong."),
  });

  const confirmDelete = () => {
    Alert.alert("Delete amendment?", "Only Draft amendments can be deleted. This can't be undone.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => deleteMutation.mutate() },
    ]);
  };
  const confirmReject = () => {
    if (!rejectNote.trim()) {
      Alert.alert("Rejection note required", "Please explain why this amendment is being rejected.");
      return;
    }
    rejectMutation.mutate();
  };

  if (recordId == null) return null;
  const busy = submitMutation.isPending || approveMutation.isPending || rejectMutation.isPending || deleteMutation.isPending;

  return (
    <Modal visible={recordId != null} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <View style={{ paddingTop: insets.top + 8 }} className="flex-row items-center justify-between px-4 pb-3">
          <View className="flex-row items-center gap-2.5 flex-1 min-w-0">
            <View className="w-8 h-8 rounded-lg items-center justify-center" style={{ backgroundColor: "#7c3aed26" }}>
              <FileEdit size={14} color="#7c3aed" />
            </View>
            <View className="min-w-0">
              <Text style={{ color: colors.foreground, fontSize: 14, fontFamily: fonts.heading.semibold }}>Amendment</Text>
              {!!amd?.AmendmentNo && <Text style={{ color: colors.mutedForeground, fontSize: 10.5 }}>{amd.AmendmentNo} → {amd.RefDocNo}</Text>}
            </View>
          </View>
          <Pressable onPress={onClose} className="w-8 h-8 rounded-lg items-center justify-center" style={{ borderWidth: 1, borderColor: colors.border }}>
            <X size={15} color={colors.mutedForeground} />
          </Pressable>
        </View>

        {isLoading || !amd ? (
          <View className="flex-1 items-center justify-center"><ActivityIndicator color={colors.mutedForeground} /></View>
        ) : (
          <>
            <View className="flex-row items-center flex-wrap gap-1.5 px-4 pb-3">
              {amd.Status === "Draft" && canEdit && onEdit && (
                <Pressable onPress={() => onEdit(amd.Id)} className="flex-row items-center gap-1.5 px-3 py-2 rounded-lg" style={{ borderWidth: 1, borderColor: colors.border }}>
                  <Pencil size={12} color={colors.mutedForeground} />
                  <Text style={{ color: colors.mutedForeground, fontSize: 11.5, fontFamily: fonts.heading.medium }}>Edit</Text>
                </Pressable>
              )}
              {amd.Status === "Draft" && canEdit && (
                <Pressable onPress={() => submitMutation.mutate()} disabled={busy} className="flex-row items-center gap-1.5 px-3 py-2 rounded-lg" style={{ borderWidth: 1, borderColor: "#0ea5e933", backgroundColor: "#0ea5e90d" }}>
                  <Send size={12} color="#0ea5e9" />
                  <Text style={{ color: "#0ea5e9", fontSize: 11.5, fontFamily: fonts.heading.medium }}>Submit</Text>
                </Pressable>
              )}
              {amd.Status === "Pending" && canApprove && (
                <>
                  <Pressable onPress={() => approveMutation.mutate()} disabled={busy} className="flex-row items-center gap-1.5 px-3 py-2 rounded-lg" style={{ borderWidth: 1, borderColor: "#05966933", backgroundColor: "#0596690d" }}>
                    <Check size={12} color="#059669" />
                    <Text style={{ color: "#059669", fontSize: 11.5, fontFamily: fonts.heading.medium }}>Approve</Text>
                  </Pressable>
                  <Pressable onPress={() => setRejectOpen(true)} disabled={busy} className="flex-row items-center gap-1.5 px-3 py-2 rounded-lg" style={{ borderWidth: 1, borderColor: colors.border }}>
                    <X size={12} color={colors.destructive} />
                    <Text style={{ color: colors.destructive, fontSize: 11.5, fontFamily: fonts.heading.medium }}>Reject</Text>
                  </Pressable>
                </>
              )}
              {amd.Status === "Draft" && canDelete && (
                <Pressable onPress={confirmDelete} disabled={busy} className="flex-row items-center gap-1.5 px-3 py-2 rounded-lg ml-auto" style={{ borderWidth: 1, borderColor: colors.border }}>
                  <Trash2 size={12} color={colors.destructive} />
                  <Text style={{ color: colors.destructive, fontSize: 11.5, fontFamily: fonts.heading.medium }}>Delete</Text>
                </Pressable>
              )}
            </View>

            <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}>
              <View className="mb-4"><StatusBadge status={amd.Status} /></View>

              {(amd.OriginalValue != null || amd.RevisedValue != null) && (
                <View className="rounded-2xl p-3.5 mb-4" style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: `${colors.card}80` }}>
                  <View className="flex-row items-center justify-between">
                    <View style={{ flex: 1, alignItems: "center" }}>
                      <Text style={{ color: colors.mutedForeground, fontSize: 9, textTransform: "uppercase" }}>Original</Text>
                      <Text style={{ color: colors.foreground, fontSize: 15, fontFamily: fonts.heading.bold, marginTop: 2 }}>{formatINR(amd.OriginalValue ?? 0)}</Text>
                    </View>
                    <ArrowRight size={16} color={colors.mutedForeground} />
                    <View style={{ flex: 1, alignItems: "center" }}>
                      <Text style={{ color: colors.mutedForeground, fontSize: 9, textTransform: "uppercase" }}>Revised</Text>
                      <Text style={{ color: colors.primary, fontSize: 15, fontFamily: fonts.heading.bold, marginTop: 2 }}>{formatINR(amd.RevisedValue ?? 0)}</Text>
                    </View>
                  </View>
                  {amd.ValueDifference != null && (
                    <Text style={{ color: amd.ValueDifference >= 0 ? "#059669" : "#e11d48", fontSize: 12, fontFamily: fonts.heading.semibold, textAlign: "center", marginTop: 8 }}>
                      Net Change: {amd.ValueDifference >= 0 ? "+" : ""}{formatINR(amd.ValueDifference)}
                    </Text>
                  )}
                </View>
              )}

              <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
                <Field label="Document" value={`${DOC_TYPE_LABEL[amd.RefDocType ?? ""] ?? amd.RefDocType ?? "—"} · ${amd.RefDocNo ?? "—"}`} />
                <Field label="Amendment Date" value={fmtDate(amd.AmendmentDate)} />
                <Field label="Project" value={amd.ProjectName || "—"} />
                <Field label="Company / Vendor" value={amd.CompanyName || "—"} />
                <Field label="Reason" value={amd.Reason || "—"} />
              </View>

              {!!amd.Description && (
                <View className="rounded-xl px-3 py-2.5 mb-3" style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: `${colors.muted}30` }}>
                  <Text style={{ color: colors.mutedForeground, fontSize: 9, fontFamily: fonts.heading.medium, textTransform: "uppercase", marginBottom: 4 }}>Description of Change</Text>
                  <Text style={{ color: colors.foreground, fontSize: 12 }}>{amd.Description}</Text>
                </View>
              )}

              {(amd.ApprovedBy || amd.RejectedBy) && (
                <View className="rounded-xl px-3 py-2.5 mb-3" style={{ borderWidth: 1, borderColor: amd.ApprovedBy ? "#05966940" : "#e11d4840", backgroundColor: amd.ApprovedBy ? "#0596690d" : "#e11d480d" }}>
                  <View className="flex-row items-center gap-1.5 mb-1">
                    <ShieldCheck size={12} color={amd.ApprovedBy ? "#059669" : "#e11d48"} />
                    <Text style={{ color: amd.ApprovedBy ? "#059669" : "#e11d48", fontSize: 11, fontFamily: fonts.heading.semibold }}>
                      {amd.ApprovedBy ? `Approved by ${amd.ApprovedBy}` : `Rejected by ${amd.RejectedBy}`}{" "}
                      {fmtDate(amd.ApprovedBy ? amd.ApprovedAt : amd.RejectedAt)}
                    </Text>
                  </View>
                  {!!amd.RejectionNote && <Text style={{ color: colors.foreground, fontSize: 11.5 }}>{amd.RejectionNote}</Text>}
                </View>
              )}

              <View className="rounded-xl px-3 py-2.5" style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: `${colors.muted}30` }}>
                <Text style={{ color: colors.mutedForeground, fontSize: 9, fontFamily: fonts.heading.medium, textTransform: "uppercase", marginBottom: 4 }}>Audit</Text>
                <Text style={{ color: colors.foreground, fontSize: 11.5 }}>Created by {amd.CreatedBy || "—"} · {fmtDate(amd.CreatedAt)}</Text>
                {!!amd.UpdatedBy && <Text style={{ color: colors.mutedForeground, fontSize: 11, marginTop: 2 }}>Updated by {amd.UpdatedBy} · {fmtDate(amd.UpdatedAt)}</Text>}
              </View>
            </ScrollView>
          </>
        )}
      </View>

      <Modal visible={rejectOpen} transparent animationType="slide" onRequestClose={() => setRejectOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)" }} onPress={() => !rejectMutation.isPending && setRejectOpen(false)}>
          <Pressable onPress={() => {}} style={{ position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, borderColor: colors.border, padding: 20, paddingBottom: insets.bottom + 20 }}>
            <Text style={{ color: colors.foreground, fontSize: 14, fontFamily: fonts.heading.bold, marginBottom: 12 }}>Reject Amendment</Text>
            <Text style={{ color: colors.mutedForeground, fontSize: 10, fontFamily: fonts.body.medium, marginBottom: 5, textTransform: "uppercase" }}>Rejection Note *</Text>
            <TextInput
              value={rejectNote} onChangeText={setRejectNote} placeholder="Why is this being rejected?" multiline
              placeholderTextColor={`${colors.mutedForeground}99`}
              style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, color: colors.foreground, fontSize: 13, minHeight: 80, textAlignVertical: "top", marginBottom: 16 }}
            />
            <View className="flex-row gap-2.5">
              <Pressable onPress={() => setRejectOpen(false)} disabled={rejectMutation.isPending} className="px-5 py-3 rounded-xl items-center justify-center" style={{ borderWidth: 1, borderColor: colors.border }}>
                <Text style={{ color: colors.mutedForeground, fontSize: 12.5, fontFamily: fonts.heading.medium }}>Cancel</Text>
              </Pressable>
              <Pressable onPress={confirmReject} disabled={rejectMutation.isPending} className="flex-1 items-center justify-center py-3 rounded-xl" style={{ backgroundColor: colors.destructive, opacity: rejectMutation.isPending ? 0.7 : 1 }}>
                {rejectMutation.isPending ? <ActivityIndicator size="small" color="#fff" /> : <Text style={{ color: "#fff", fontSize: 12.5, fontFamily: fonts.heading.semibold }}>Confirm Reject</Text>}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </Modal>
  );
}
