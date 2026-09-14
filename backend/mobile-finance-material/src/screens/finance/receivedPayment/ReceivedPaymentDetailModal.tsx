// RN port of ReceivedPayment.tsx's viewingPayment detail overlay. Simpler
// than PaymentDetailModal — web's Received Payment page has no GL-posting
// or payment-chain feature at all, so there are no tabs here, just the
// amount highlight + fields grid + remarks. Edit/Delete/Approve/Reject are
// supported, following the same confirm-before-destructive-action pattern
// used for outbound Payment.
import { View, Text, Modal, Pressable, ScrollView, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { X, ArrowDownCircle, Pencil, Trash2, Check } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { formatINR } from "@/utils/formatCurrency";
import { deleteReceivedPayment, approveReceivedPayment, rejectReceivedPayment, type ReceivedPayment } from "@/api/receivedPaymentApi";
import { StatusBadge } from "../payment/PaymentBadges";
import { ModeBadge } from "./ReceivedPaymentBadges";

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ width: "50%", paddingRight: 8, marginBottom: 12 }}>
      <Text style={{ color: colors.mutedForeground, fontSize: 9.5, fontFamily: fonts.heading.medium, textTransform: "uppercase", letterSpacing: 0.5 }}>
        {label}
      </Text>
      <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 12.5, fontFamily: fonts.body.medium, marginTop: 2 }}>
        {value}
      </Text>
    </View>
  );
}

export function ReceivedPaymentDetailModal({
  record, onClose, onEdit, onDeleted, canDelete,
}: {
  record: ReceivedPayment | null;
  onClose: () => void;
  onEdit?: (rec: ReceivedPayment) => void;
  onDeleted?: () => void;
  canDelete?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();

  const deleteMutation = useMutation({
    mutationFn: () => deleteReceivedPayment(record!.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["received-payments-mobile"], exact: false });
      onDeleted?.();
    },
    onError: (err: any) => Alert.alert("Delete failed", err.message ?? "Something went wrong."),
  });
  const approveMutation = useMutation({
    mutationFn: () => approveReceivedPayment(record!.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["received-payments-mobile"], exact: false }),
    onError: (err: any) => Alert.alert("Approve failed", err.message ?? "Something went wrong."),
  });
  const rejectMutation = useMutation({
    mutationFn: () => rejectReceivedPayment(record!.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["received-payments-mobile"], exact: false }),
    onError: (err: any) => Alert.alert("Reject failed", err.message ?? "Something went wrong."),
  });

  const confirmDelete = () => {
    Alert.alert("Delete received payment?", "This can't be undone.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => deleteMutation.mutate() },
    ]);
  };

  if (!record) return null;

  return (
    <Modal visible={!!record} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <View style={{ paddingTop: insets.top + 8 }} className="flex-row items-center justify-between px-4 pb-3">
          <View className="flex-row items-center gap-2.5 flex-1 min-w-0">
            <View className="w-8 h-8 rounded-lg items-center justify-center" style={{ backgroundColor: "#10b98126" }}>
              <ArrowDownCircle size={14} color="#10b981" />
            </View>
            <View className="min-w-0">
              <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 14, fontFamily: fonts.heading.semibold }}>
                {record.companyName || "Received Payment"}
              </Text>
              {!!record.docNo && (
                <Text style={{ color: colors.mutedForeground, fontSize: 10.5, fontFamily: fonts.body.regular }}>{record.docNo}</Text>
              )}
            </View>
          </View>
          <Pressable onPress={onClose} className="w-8 h-8 rounded-lg items-center justify-center" style={{ borderWidth: 1, borderColor: colors.border }}>
            <X size={15} color={colors.mutedForeground} />
          </Pressable>
        </View>

        <View className="flex-row items-center gap-1.5 px-4 pb-3">
          {onEdit && (
            <Pressable onPress={() => onEdit(record)} className="flex-row items-center gap-1.5 px-3 py-2 rounded-lg" style={{ borderWidth: 1, borderColor: colors.border }}>
              <Pencil size={12} color={colors.mutedForeground} />
              <Text style={{ color: colors.mutedForeground, fontSize: 11.5, fontFamily: fonts.heading.medium }}>Edit</Text>
            </Pressable>
          )}
          {record.status === "Pending" && (
            <>
              <Pressable
                onPress={() => approveMutation.mutate()}
                disabled={approveMutation.isPending}
                className="flex-row items-center gap-1.5 px-3 py-2 rounded-lg"
                style={{ borderWidth: 1, borderColor: "#05966933", backgroundColor: "#0596690d" }}
              >
                <Check size={12} color="#059669" />
                <Text style={{ color: "#059669", fontSize: 11.5, fontFamily: fonts.heading.medium }}>Approve</Text>
              </Pressable>
              <Pressable
                onPress={() => rejectMutation.mutate()}
                disabled={rejectMutation.isPending}
                className="flex-row items-center gap-1.5 px-3 py-2 rounded-lg"
                style={{ borderWidth: 1, borderColor: colors.border }}
              >
                <X size={12} color={colors.destructive} />
                <Text style={{ color: colors.destructive, fontSize: 11.5, fontFamily: fonts.heading.medium }}>Reject</Text>
              </Pressable>
            </>
          )}
          {canDelete && (
            <Pressable
              onPress={confirmDelete}
              disabled={deleteMutation.isPending}
              className="flex-row items-center gap-1.5 px-3 py-2 rounded-lg ml-auto"
              style={{ borderWidth: 1, borderColor: colors.border }}
            >
              <Trash2 size={12} color={colors.destructive} />
              <Text style={{ color: colors.destructive, fontSize: 11.5, fontFamily: fonts.heading.medium }}>Delete</Text>
            </Pressable>
          )}
        </View>

        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}>
          <View className="rounded-2xl flex-row items-center justify-between px-4 py-4 mb-4" style={{ borderWidth: 1, borderColor: "#10b98133", backgroundColor: "#10b9810d" }}>
            <View>
              <Text style={{ color: "#10b981b3", fontSize: 9.5, fontFamily: fonts.heading.semibold, textTransform: "uppercase", letterSpacing: 0.5 }}>
                Amount Received
              </Text>
              <Text style={{ color: "#10b981", fontSize: 22, fontFamily: fonts.heading.bold, marginTop: 4 }}>
                +{formatINR(record.amount)}
              </Text>
            </View>
            <View style={{ alignItems: "flex-end", gap: 6 }}>
              <Text style={{ color: colors.mutedForeground, fontSize: 10.5 }}>{record.docDate || "—"}</Text>
              <StatusBadge status={record.status} />
              <ModeBadge mode={record.mode} />
            </View>
          </View>

          <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
            <Field label="Received From" value={record.customerName || record.receivedFrom || "—"} />
            <Field label="Financial Year" value={record.finYear || "—"} />
            <Field label="Company" value={record.companyName || "—"} />
            <Field label="Project" value={record.projectName || "—"} />
            <Field label="Deposit Bank" value={record.depositBankName || "—"} />
            <Field label="Customer Bank" value={record.bankName || "—"} />
            {!!record.checkNumber && <Field label="Cheque No." value={record.checkNumber} />}
            {!!record.transactionId && <Field label="Transaction ID" value={record.transactionId} />}
          </View>

          {!!record.remarks && (
            <View className="mt-2">
              <Text style={{ color: colors.mutedForeground, fontSize: 9.5, fontFamily: fonts.heading.medium, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>
                Remarks
              </Text>
              <View className="rounded-xl px-3 py-2.5" style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: `${colors.muted}30` }}>
                <Text style={{ color: colors.foreground, fontSize: 12 }}>{record.remarks}</Text>
              </View>
            </View>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}
