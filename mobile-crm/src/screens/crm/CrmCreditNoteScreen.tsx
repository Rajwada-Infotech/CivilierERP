// Credit note detail — document numbers, GST tax breakdown, customer and booking info,
// and full lifecycle actions matching web CrmCreditNotes.tsx:
// - Draft/Rejected: Edit (amount, reason, remarks), Send for approval
// - Pending: Approve, Send back with note
// - Issued: Cancel request
// - Cancellation pending: Approve cancel, Keep it
// - Cancelled: Re-issue
// - View PDF / Open Booking / Open Invoice
import { useState, type ReactNode } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useRoute, useNavigation, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { crmGet, crmSend, type Row } from "@/api/crmApi";
import { useAuth } from "@/auth/AuthContext";
import { toast } from "@/components/Toast";
import { fonts } from "@/theme/fonts";
import { useBrand } from "@/theme/ThemeContext";
import type { MainStackParamList } from "@/navigation/MainStack";
import { openDocument } from "@/utils/documents";
import { ActionKey, CRM, Kv, Pill, Section, fmtDate, money, words } from "./ui";

const REASON_LABEL: Record<string, string> = {
  Discount: "Discount",
  AreaChange: "Area change",
  PriceCorrection: "Price correction",
  Other: "Other",
};

const REASON_OPTIONS = ["Discount", "AreaChange", "PriceCorrection", "Other"];

function Sheet({ open, title, sub, children, cancel, confirm, onConfirm, onClose, disabled, danger, busy }: {
  open: boolean; title: string; sub?: string; children?: ReactNode; cancel: string; confirm: string;
  onConfirm: () => void; onClose: () => void; disabled?: boolean; danger?: boolean; busy?: boolean;
}) {
  const b = useBrand();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)" }} onPress={onClose} />
      <View style={{ maxHeight: "88%", backgroundColor: b.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: insets.bottom + 16 }}>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 12 }} keyboardShouldPersistTaps="handled">
          <Text style={{ fontSize: 18, fontFamily: fonts.heading.semibold, color: b.textPrimary }}>{title}</Text>
          {sub ? <Text style={{ fontSize: 12.5, fontFamily: fonts.body.regular, color: b.textSecondary }}>{sub}</Text> : null}
          {children}
        </ScrollView>
        <View style={{ flexDirection: "row", gap: 10, paddingHorizontal: 20 }}>
          <ActionKey outline label={cancel} onPress={onClose} />
          <ActionKey label={busy ? "…" : confirm} tone={danger ? b.danger : undefined} onPress={() => { if (!disabled && !busy) onConfirm(); }} />
        </View>
      </View>
    </Modal>
  );
}

function Field({ label, hint, required, value, onChange, multiline, keyboardType }: {
  label: string; hint?: string; required?: boolean; value: string; onChange: (v: string) => void; multiline?: boolean; keyboardType?: "default" | "numeric";
}) {
  const b = useBrand();
  return (
    <View style={{ gap: 5 }}>
      <Text style={{ fontSize: 12.5, fontFamily: fonts.body.medium, color: b.textSecondary }}>{label}{required ? " *" : ""}</Text>
      <TextInput value={value} onChangeText={onChange} multiline={multiline} keyboardType={keyboardType} placeholderTextColor={b.textFaint}
        style={{ minHeight: multiline ? 76 : 46, textAlignVertical: multiline ? "top" : "center", borderWidth: 1, borderColor: b.border,
          borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14.5, fontFamily: fonts.body.regular,
          color: b.textPrimary, backgroundColor: b.surfaceCard }} />
      {hint ? <Text style={{ fontSize: 11.5, fontFamily: fonts.body.regular, color: b.textFaint }}>{hint}</Text> : null}
    </View>
  );
}

export default function CrmCreditNoteScreen() {
  const { params } = useRoute<RouteProp<MainStackParamList, "CrmCreditNote">>();
  const { creditNoteId } = params;
  const b = useBrand();
  const nav = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const { canAccessPage, canDoAction } = useAuth();
  const qc = useQueryClient();

  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<null | "edit" | "reject" | "cancel" | "cancelDecision">(null);

  // Edit fields
  const [amount, setAmount] = useState("");
  const [reasonType, setReasonType] = useState("Discount");
  const [remarks, setRemarks] = useState("");

  // Reject / Cancel notes
  const [note, setNote] = useState("");

  const canEdit = canDoAction("crm-refunds", "edit");

  const q = useQuery<Row>({
    queryKey: ["crm-credit-note", creditNoteId],
    queryFn: () => crmGet(`/api/crm/refunds/gst-notes/${creditNoteId}`),
  });

  const n = q.data;

  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ["crm-credit-note", creditNoteId] });
    qc.invalidateQueries({ queryKey: ["crm"] });
  };

  const handleEditOpen = () => {
    if (!n) return;
    setAmount(String(n.TotalAmount ?? ""));
    setReasonType(n.ReasonType || "Discount");
    setRemarks(n.Remarks || "");
    setSheet("edit");
  };

  const handleSaveEdit = async () => {
    if (!amount.trim() || !(Number(amount) > 0)) {
      toast.error("Enter a valid amount.");
      return;
    }
    setBusy(true);
    try {
      await crmSend(`/api/crm/refunds/gst-notes/${creditNoteId}`, "PUT", {
        Amount: Number(amount),
        ReasonType: reasonType,
        Remarks: remarks.trim(),
      });
      toast.success("Credit note updated");
      setSheet(null);
      refreshAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleSubmitApproval = async () => {
    setBusy(true);
    try {
      await crmSend(`/api/crm/refunds/gst-notes/${creditNoteId}/submit`, "PUT", {});
      toast.success("Sent for approval");
      refreshAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleApprove = async () => {
    setBusy(true);
    try {
      await crmSend(`/api/crm/refunds/gst-notes/${creditNoteId}/approve`, "PUT", { note: note.trim() });
      toast.success("Credit note approved and issued");
      refreshAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleReject = async () => {
    if (!note.trim()) {
      toast.error("Enter remarks to send back");
      return;
    }
    setBusy(true);
    try {
      await crmSend(`/api/crm/refunds/gst-notes/${creditNoteId}/reject`, "PUT", { note: note.trim() });
      toast.success("Credit note sent back");
      setSheet(null);
      setNote("");
      refreshAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleCancelRequest = async () => {
    if (!note.trim()) {
      toast.error("Enter cancellation reason");
      return;
    }
    setBusy(true);
    try {
      await crmSend(`/api/crm/refunds/gst-notes/${creditNoteId}/cancel`, "PUT", { reason: note.trim() });
      toast.success("Cancellation sent for approval");
      setSheet(null);
      setNote("");
      refreshAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleCancelDecision = async (approve: boolean) => {
    setBusy(true);
    try {
      await crmSend(`/api/crm/refunds/gst-notes/cancel-requests/${creditNoteId}/${approve ? "approve" : "reject"}`, "PUT", { note: note.trim() });
      toast.success(approve ? "Cancellation approved" : "Cancellation turned down");
      setSheet(null);
      setNote("");
      refreshAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleReissue = async () => {
    if (!n?.RefundId) return;
    setBusy(true);
    try {
      await crmSend(`/api/crm/refunds/${n.RefundId}/gst-notes/reissue`, "POST", {});
      toast.success("Credit note re-issued");
      refreshAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (q.isLoading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: b.surface }}>
        <ActivityIndicator size="large" color={CRM} />
      </View>
    );
  }

  if (q.isError || !n) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: b.surface }}>
        <Text style={{ fontSize: 16, fontFamily: fonts.heading.bold, color: b.danger, textAlign: "center" }}>
          {q.error instanceof Error ? q.error.message : "Credit note not found"}
        </Text>
      </View>
    );
  }

  const isRequest = ["Draft", "Pending", "Rejected"].includes(n.Status);
  const isDraftOrRejected = ["Draft", "Rejected"].includes(n.Status);
  const isPending = n.Status === "Pending";
  const isIssued = n.Status === "Issued";
  const isCancelled = n.Status === "Cancelled";
  const isCancelPending = n.CancelApprovalStatus === "Pending";

  const sameState = n.IntraState !== false;
  const halfGst = Math.round((Number(n.GstAmount || 0) / 2) * 100) / 100;

  return (
    <>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, backgroundColor: b.surface }}>
        {/* Banner */}
        <View style={{ padding: 16, borderRadius: 16, backgroundColor: b.surfaceCard, borderWidth: 1, borderColor: b.border, gap: 8 }}>
          <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 12, fontFamily: fonts.body.medium, color: b.textSecondary, textTransform: "uppercase", letterSpacing: 0.8 }}>
                {n.DocType === "CreditNote" ? "Credit Note" : "Refund Voucher"}
              </Text>
              <Text style={{ fontSize: 20, fontFamily: fonts.heading.bold, color: b.textPrimary, marginTop: 2 }}>
                {n.DocNo || (isRequest ? "Awaiting Approval" : "Credit Note")}
              </Text>
            </View>
            <Pill label={isCancelPending ? "Cancel Asked" : n.Status} />
          </View>

          <Text style={{ fontSize: 14, fontFamily: fonts.heading.semibold, color: b.textPrimary, marginTop: 4 }}>
            {n.CustomerName}
          </Text>
          <Text style={{ fontSize: 12.5, fontFamily: fonts.body.regular, color: b.textSecondary }}>
            {[n.Property, n.ProjectName, n.BookingNo && `Booking ${n.BookingNo}`].filter(Boolean).join(" · ")}
          </Text>

          <View style={{ marginTop: 8, paddingTop: 12, borderTopWidth: 1, borderTopColor: b.border, flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" }}>
            <View>
              <Text style={{ fontSize: 11.5, fontFamily: fonts.body.regular, color: b.textSecondary }}>Total Amount</Text>
              <Text style={{ fontSize: 22, fontFamily: fonts.heading.bold, color: b.textPrimary }}>
                {money(n.TotalAmount)}
              </Text>
            </View>
            <Text style={{ fontSize: 12.5, fontFamily: fonts.body.medium, color: b.textSecondary }}>
              {n.DocDate ? fmtDate(n.DocDate) : fmtDate(n.CreatedAt)}
            </Text>
          </View>
        </View>

        {/* Status guidance banner */}
        {isCancelPending ? (
          <View style={{ padding: 12, borderRadius: 12, backgroundColor: `${b.danger}15`, borderWidth: 1, borderColor: b.danger, gap: 4 }}>
            <Text style={{ fontSize: 13, fontFamily: fonts.heading.semibold, color: b.danger }}>Cancellation Requested</Text>
            <Text style={{ fontSize: 12, fontFamily: fonts.body.regular, color: b.textPrimary }}>
              {n.CancelRequestReason ? `Reason: ${n.CancelRequestReason}` : "Waiting for approver decision."}
            </Text>
          </View>
        ) : isCancelled ? (
          <View style={{ padding: 12, borderRadius: 12, backgroundColor: `${b.danger}15`, borderWidth: 1, borderColor: b.danger, gap: 4 }}>
            <Text style={{ fontSize: 13, fontFamily: fonts.heading.semibold, color: b.danger }}>Cancelled</Text>
            <Text style={{ fontSize: 12, fontFamily: fonts.body.regular, color: b.textPrimary }}>
              {n.CancelReason ? `Reason: ${n.CancelReason}` : "This credit note was cancelled."}
            </Text>
          </View>
        ) : n.Status === "Rejected" ? (
          <View style={{ padding: 12, borderRadius: 12, backgroundColor: `${b.danger}15`, borderWidth: 1, borderColor: b.danger, gap: 4 }}>
            <Text style={{ fontSize: 13, fontFamily: fonts.heading.semibold, color: b.danger }}>Sent Back</Text>
            <Text style={{ fontSize: 12, fontFamily: fonts.body.regular, color: b.textPrimary }}>
              {n.RejectionNote ? `Note: ${n.RejectionNote}` : "Changes requested before approval."}
            </Text>
          </View>
        ) : null}

        {/* GST & Financial Split */}
        <Section title="GST & Amount Breakdown">
          <Kv label="Taxable Value" value={money(n.TaxableValue)} />
          <Kv label="GST Rate" value={n.GstRate != null ? `${Number(n.GstRate)}%` : "—"} />
          <Kv label="Total GST" value={money(n.GstAmount)} />
          {sameState ? (
            <>
              <Kv label="CGST" value={money(halfGst)} />
              <Kv label="SGST" value={money(halfGst)} />
            </>
          ) : (
            <Kv label="IGST" value={money(n.GstAmount)} />
          )}
          <Kv label="Total Amount" value={money(n.TotalAmount)} />
        </Section>

        {/* Reference & Origin */}
        <Section title="Reference & Timeline">
          <Kv label="Against Reference" value={n.AgainstRef || n.RefundNo || "—"} />
          {n.AgainstDate ? <Kv label="Against Date" value={fmtDate(n.AgainstDate)} /> : null}
          {n.ReasonType ? <Kv label="Reason" value={REASON_LABEL[n.ReasonType] || n.ReasonType} /> : null}
          {n.Remarks ? <Kv label="Remarks" value={n.Remarks} /> : null}
          {n.DeadlineDate ? <Kv label="Declare By (GSTR-1)" value={fmtDate(n.DeadlineDate)} /> : null}
          {n.CustomerGst ? <Kv label="Customer GSTIN" value={n.CustomerGst} /> : null}
          <Kv label="Created" value={fmtDate(n.CreatedAt)} />
        </Section>

        {/* Actions bar */}
        <View style={{ gap: 8, marginTop: 4 }}>
          {/* Draft/Rejected actions */}
          {canEdit && isDraftOrRejected ? (
            <View style={{ flexDirection: "row", gap: 8 }}>
              <ActionKey outline label="Edit Details" onPress={handleEditOpen} />
              <ActionKey label={n.Status === "Rejected" ? "Send Again" : "Send for Approval"} onPress={handleSubmitApproval} />
            </View>
          ) : null}

          {/* Pending approval actions */}
          {canEdit && isPending ? (
            <View style={{ flexDirection: "row", gap: 8 }}>
              <ActionKey label="Approve" onPress={handleApprove} />
              <ActionKey outline tone={b.danger} label="Send Back" onPress={() => { setNote(""); setSheet("reject"); }} />
            </View>
          ) : null}

          {/* Cancel request action (Issued) */}
          {canEdit && isIssued && !isCancelPending ? (
            <ActionKey outline tone={b.danger} label="Request Cancellation" onPress={() => { setNote(""); setSheet("cancel"); }} />
          ) : null}

          {/* Cancel decision actions (when cancel requested) */}
          {canEdit && isCancelPending ? (
            <View style={{ flexDirection: "row", gap: 8 }}>
              <ActionKey tone={b.danger} label="Approve Cancellation" onPress={() => handleCancelDecision(true)} />
              <ActionKey outline label="Keep Credit Note" onPress={() => handleCancelDecision(false)} />
            </View>
          ) : null}

          {/* Re-issue (when cancelled) */}
          {canEdit && isCancelled && n.RefundId ? (
            <ActionKey label="Re-issue Credit Note" onPress={handleReissue} />
          ) : null}

          {/* Navigation links */}
          <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
            {n.BookingId ? (
              <ActionKey outline label={`Booking ${n.BookingNo || ""}`} onPress={() => nav.navigate("CrmBooking", { bookingId: Number(n.BookingId), title: n.BookingNo || "Booking" })} />
            ) : null}
            {n.InvoiceId ? (
              <ActionKey outline label="Open Invoice" onPress={() => nav.navigate("CrmInvoice", { invoiceId: Number(n.InvoiceId), title: n.AgainstRef || "Invoice" })} />
            ) : null}
          </View>
        </View>
      </ScrollView>

      {/* Edit Sheet */}
      <Sheet open={sheet === "edit"} title="Edit Credit Note" sub="Update the reduction amount and reason before sending for approval."
        cancel="Cancel" confirm="Save Changes" busy={busy} onConfirm={handleSaveEdit} onClose={() => setSheet(null)}>
        <Field label="Total Amount (₹ incl. GST)" required value={amount} onChange={setAmount} keyboardType="numeric" />
        <View style={{ gap: 6 }}>
          <Text style={{ fontSize: 12.5, fontFamily: fonts.body.medium, color: b.textSecondary }}>Reason Type *</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {REASON_OPTIONS.map((opt) => (
              <Pressable key={opt} onPress={() => setReasonType(opt)}
                style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1,
                  borderColor: reasonType === opt ? CRM : b.border, backgroundColor: reasonType === opt ? `${CRM}22` : b.surfaceCard }}>
                <Text style={{ fontSize: 12, fontFamily: fonts.body.medium, color: reasonType === opt ? b.textPrimary : b.textSecondary }}>{REASON_LABEL[opt]}</Text>
              </Pressable>
            ))}
          </View>
        </View>
        <Field label="Remarks / What changed" required value={remarks} onChange={setRemarks} multiline hint="Explain what changed on this invoice" />
      </Sheet>

      {/* Reject Sheet */}
      <Sheet open={sheet === "reject"} title="Send Back Credit Note" sub="Explain what needs to be corrected."
        cancel="Cancel" confirm="Send Back" danger busy={busy} onConfirm={handleReject} onClose={() => setSheet(null)}>
        <Field label="Remarks" required value={note} onChange={setNote} multiline hint="Reasons why this credit note was sent back" />
      </Sheet>

      {/* Cancel Request Sheet */}
      <Sheet open={sheet === "cancel"} title="Request Cancellation" sub="Cancelling requires approval. State the reason clearly."
        cancel="Cancel" confirm="Submit Cancellation" danger busy={busy} onConfirm={handleCancelRequest} onClose={() => setSheet(null)}>
        <Field label="Cancellation Reason" required value={note} onChange={setNote} multiline hint="Why is this credit note being cancelled?" />
      </Sheet>
    </>
  );
}
