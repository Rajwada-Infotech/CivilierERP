// RN port of ReceivedPayment.tsx's viewingPayment detail overlay, on the drawing sheet (SheetShell with the action
// keys, ruled panels). Simpler
// than PaymentDetailModal — web's Received Payment page has no GL-posting
// or payment-chain feature at all, so there are no tabs here, just the
// amount highlight + fields grid + remarks. Edit/Delete/Approve/Reject are
// supported, following the same confirm-before-destructive-action pattern
// used for outbound Payment.
import { View, Modal, ScrollView, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { X, Pencil, Trash2, Check } from "lucide-react-native";
import { colors, sheet as S } from "@/theme/colors";
import { Body, InfoGrid, Key, Panel, SheetShell } from "@/components/sheet/Sheet";
import { formatINR } from "@/utils/formatCurrency";
import { deleteReceivedPayment, approveReceivedPayment, rejectReceivedPayment, type ReceivedPayment } from "@/api/receivedPaymentApi";
import { StatusBadge } from "../payment/PaymentBadges";
import { ModeBadge } from "./ReceivedPaymentBadges";

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
      <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top }}>
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}>
          <SheetShell
            eyebrow={`CivilierERP · Receipt${record.docNo ? ` · ${record.docNo}` : ""}`}
            title={`+${formatINR(record.amount)}`}
            subtitle={[record.customerName || record.receivedFrom, record.companyName].filter(Boolean).join(" · ") || undefined}
            action={
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                <Key label="Close" icon={<X size={13} color={S.ink} />} onPress={onClose} />
                {onEdit && <Key label="Edit" icon={<Pencil size={13} color={S.ink} />} onPress={() => onEdit(record)} />}
                {record.status === "Pending" && (
                  <>
                    <Key tone="ink" label={approveMutation.isPending ? "Approving…" : "Approve"} icon={<Check size={13} color={S.paper} />} onPress={() => approveMutation.mutate()} disabled={approveMutation.isPending} />
                    <Key tone="red" label={rejectMutation.isPending ? "Rejecting…" : "Reject"} onPress={() => rejectMutation.mutate()} disabled={rejectMutation.isPending} />
                  </>
                )}
                {canDelete && <Key tone="red" label={deleteMutation.isPending ? "Deleting…" : "Delete"} icon={<Trash2 size={13} color="#ffffff" />} onPress={confirmDelete} disabled={deleteMutation.isPending} />}
              </View>
            }
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <StatusBadge status={record.status} />
              <ModeBadge mode={record.mode} />
              <Body size={12} color={S.graphite}>{record.docDate || "—"}</Body>
            </View>

            <Panel title="Receipt">
              <InfoGrid
                items={[
                  { label: "Received From", value: record.customerName || record.receivedFrom || "—" },
                  { label: "Financial Year", value: record.finYear || "—" },
                  { label: "Company", value: record.companyName || "—" },
                  { label: "Project", value: record.projectName || "—" },
                  { label: "Deposit Bank", value: record.depositBankName || "—" },
                  { label: "Customer Bank", value: record.bankName || "—" },
                  ...(record.checkNumber ? [{ label: "Cheque No.", value: record.checkNumber }] : []),
                  ...(record.transactionId ? [{ label: "Transaction ID", value: record.transactionId }] : []),
                ]}
              />
            </Panel>

            {!!record.remarks && (
              <Panel title="Remarks">
                <Body size={13} color={S.ink2}>{record.remarks}</Body>
              </Panel>
            )}
          </SheetShell>
        </ScrollView>
      </View>
    </Modal>
  );
}
