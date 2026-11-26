// Cancellation detail — amounts, deductions, approval chain, and refund status.
// Endpoint: GET /api/crm/cancellations/:id
import { useState, type ReactNode } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useRoute, useNavigation, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { crmGet, crmSend, type Row } from "@/api/crmApi";
import { useAuth } from "@/auth/AuthContext";
import { toast } from "@/components/Toast";
import { fonts } from "@/theme/fonts";
import { useBrand } from "@/theme/ThemeContext";
import type { MainStackParamList } from "@/navigation/MainStack";
import { ActionKey, Kv, Pill, Section, fmtDate, money, words } from "./ui";

const API = "/api/crm/cancellations";

const STATUS_COLOR: Record<string, string> = {
  Pending:  "#f59e0b",
  Approved: "#10b981",
  Rejected: "#ef4444",
};

const REFUND_COLOR: Record<string, string> = {
  Paid:      "#10b981",
  Processed: "#10b981",
  Pending:   "#f59e0b",
  Overdue:   "#ef4444",
};

/** Bottom sheet — same pattern as CrmRefundScreen */
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

function Field({ label, hint, required, value, onChange, multiline }: {
  label: string; hint?: string; required?: boolean; value: string; onChange: (v: string) => void; multiline?: boolean;
}) {
  const b = useBrand();
  return (
    <View style={{ gap: 5 }}>
      <Text style={{ fontSize: 12.5, fontFamily: fonts.body.medium, color: b.textSecondary }}>{label}{required ? " *" : ""}</Text>
      <TextInput value={value} onChangeText={onChange} multiline={multiline} placeholderTextColor={b.textFaint}
        style={{ minHeight: multiline ? 76 : 46, textAlignVertical: multiline ? "top" : "center", borderWidth: 1, borderColor: b.border,
          borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14.5, fontFamily: fonts.body.regular,
          color: b.textPrimary, backgroundColor: b.surfaceCard }} />
      {hint ? <Text style={{ fontSize: 11.5, fontFamily: fonts.body.regular, color: b.textFaint }}>{hint}</Text> : null}
    </View>
  );
}

export default function CrmCancellationScreen() {
  const { params } = useRoute<RouteProp<MainStackParamList, "CrmCancellation">>();
  const { cancellationId } = params;
  const b = useBrand();
  const nav = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const { canAccessPage, canDoAction } = useAuth();
  const canEdit = canDoAction("crm-cancellations", "edit");

  const q = useQuery<Row>({
    queryKey: ["crm-cancellation", cancellationId],
    queryFn: () => crmGet(`${API}/${cancellationId}`),
  });

  // Approver check
  const approverQ = useQuery({
    queryKey: ["can-act", "crm-cancellation"],
    staleTime: 5 * 60_000,
    queryFn: () =>
      crmGet<{ canAct: boolean }>(`/api/approval-workflows/can-act?module=crm-cancellation`)
        .then((d) => !!d.canAct)
        .catch(() => false),
  });
  const isApprover = approverQ.data ?? false;

  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<null | "approve" | "reject" | "withdraw" | "edit">(null);
  const [notes, setNotes] = useState("");
  const [deductPct, setDeductPct] = useState("");
  const [reason, setReason] = useState("");

  const run = async (work: () => Promise<Row>, done: string) => {
    setBusy(true);
    try {
      await work();
      toast.success(done);
      void q.refetch();
      setSheet(null);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const put = (path: string, body?: object) =>
    crmSend<Row>(`${API}/${cancellationId}${path}`, "PUT", body ?? {});

  const openSheet = (s: "approve" | "reject" | "withdraw" | "edit") => {
    setNotes(s === "edit" ? String(q.data?.Notes ?? "") : "");
    setDeductPct(s === "edit" && q.data?.DeductionPercent != null ? String(q.data.DeductionPercent) : "");
    setReason(s === "edit" ? String(q.data?.Reason ?? "") : "");
    setSheet(s);
  };

  if (q.isLoading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: b.surface }}>
        <ActivityIndicator color={b.accent} />
      </View>
    );
  }
  if (q.error || !q.data) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: b.surface, padding: 24 }}>
        <Text style={{ color: b.danger, fontFamily: fonts.body.medium, textAlign: "center" }}>
          {q.error ? (q.error as Error).message : "Not found"}
        </Text>
      </View>
    );
  }

  const c = q.data;
  const statusColor = STATUS_COLOR[c.Status as string] ?? b.textSecondary;
  const refundColor = c.RefundStatus ? (REFUND_COLOR[c.RefundStatus as string] ?? b.textSecondary) : b.textFaint;
  const daysLeft = c.RefundDaysRemaining != null ? Number(c.RefundDaysRemaining) : null;
  const isOverdue = c.IsRefundOverdue === 1 || c.IsRefundOverdue === true;
  const isPending = c.Status === "Pending";
  const isRejected = c.Status === "Rejected";

  const showApprove = isPending && isApprover;
  const showReject = isPending && isApprover;
  const showWithdraw = isPending && canEdit;
  const showEdit = (isPending || isRejected) && canEdit;
  const showResubmit = isRejected && canEdit;

  const sub = `${c.CancellationNo ?? ""} · ${c.ApplicantName ?? ""} · ${money(c.RefundAmount)}`;

  return (
    <>
      <ScrollView style={{ flex: 1, backgroundColor: b.surface }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 56 }}>

        {/* Identity */}
        <Section title="Cancellation">
          <Kv label="Booking" value={[c.BookingNo, c.UnitNo, c.ProjectName].filter(Boolean).join(" · ")} />
          {c.BookingId && (canAccessPage("crm-bookings") || canAccessPage("crm-payments")) ? (
            <View style={{ flexDirection: "row", marginBottom: 4 }}>
              <ActionKey outline label="Open booking" onPress={() => nav.navigate("CrmBooking", { bookingId: Number(c.BookingId), title: c.BookingNo as string || "Booking" })} />
            </View>
          ) : null}
          <Kv label="Applicant" value={c.ApplicantName as string} />
          <Kv label="Number" value={c.CancellationNo as string} />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 2 }}>
            <Text style={{ fontSize: 12.5, fontFamily: fonts.body.regular, color: b.textFaint }}>Status</Text>
            <Pill label={c.Status as string} tone={statusColor} />
          </View>
          <Kv label="Requested" value={fmtDate(c.RequestedDate)} />
          {c.RequestedByName ? <Kv label="Requested by" value={c.RequestedByName as string} /> : null}
          <Kv label="Reason" value={c.Reason as string} />
          {c.Notes ? <Kv label="Notes" value={c.Notes as string} /> : null}
        </Section>

        {/* Action buttons */}
        {(showApprove || showReject || showWithdraw || showEdit || showResubmit) ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {showApprove ? (
              <ActionKey half label="Approve" tone={b.success} onPress={() => openSheet("approve")} />
            ) : null}
            {showReject ? (
              <ActionKey half outline tone={b.danger} label="Reject" onPress={() => openSheet("reject")} />
            ) : null}
            {showResubmit ? (
              <ActionKey half label="Re-submit for approval" onPress={() => void run(() => put("/submit"), "Cancellation re-submitted for approval")} />
            ) : null}
            {showEdit ? (
              <ActionKey half outline label="Edit details" onPress={() => openSheet("edit")} />
            ) : null}
            {showWithdraw ? (
              <ActionKey half outline label="Withdraw" onPress={() => openSheet("withdraw")} />
            ) : null}
          </View>
        ) : null}

        {/* Approval */}
        {(c.ApprovedAt || c.RejectionNote) ? (
          <Section title="Approval">
            {c.ApprovedAt ? (
              <>
                <Kv label="Approved on" value={fmtDate(c.ApprovedAt)} />
                {c.ApprovedByName ? <Kv label="Approved by" value={c.ApprovedByName as string} /> : null}
              </>
            ) : null}
            {c.RejectionNote ? (
              <View style={{ backgroundColor: b.dangerSoft, borderRadius: 8, padding: 10, marginTop: 4 }}>
                <Text style={{ fontSize: 12, fontFamily: fonts.body.regular, color: b.danger }}>{c.RejectionNote as string}</Text>
                {c.RejectedAt ? (
                  <Text style={{ fontSize: 11, fontFamily: fonts.body.regular, color: b.textFaint, marginTop: 2 }}>
                    {fmtDate(c.RejectedAt)}
                  </Text>
                ) : null}
              </View>
            ) : null}
          </Section>
        ) : null}

        {/* Money */}
        <Section title="Amounts">
          <Kv label="Unit price" value={money(c.TotalValue)} />
          <Kv label="Paid to date" value={money(c.AmountPaidTillDate)} />
          {Number(c.DeductionPercent) > 0 ? (
            <Kv label={`Deduction (${Number(c.DeductionPercent).toFixed(1)}%)`} value={money(c.DeductionAmount)} />
          ) : (
            <Kv label="Deduction" value={money(c.DeductionAmount)} />
          )}
          <View style={{ height: 1, backgroundColor: b.border, marginVertical: 4 }} />
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Text style={{ fontSize: 14, fontFamily: fonts.heading.semibold, color: b.textPrimary }}>Refund amount</Text>
            <Text style={{ fontSize: 14, fontFamily: fonts.heading.bold, color: b.accent }}>{money(c.RefundAmount)}</Text>
          </View>
        </Section>

        {/* Refund tracking */}
        {c.RefundId || c.SettlementStatus ? (
          <Section title="Refund">
            {c.RefundId && canAccessPage("crm-refunds") ? (
              <View style={{ flexDirection: "row", marginBottom: 8 }}>
                <ActionKey outline label="Open refund" onPress={() => nav.navigate("CrmRefund", { refundId: Number(c.RefundId), title: c.RefundNo as string || "Refund" })} />
              </View>
            ) : null}
            {c.RefundNo ? <Kv label="Refund no." value={c.RefundNo as string} /> : null}
            {c.RefundStatus ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 2 }}>
                <Text style={{ fontSize: 12.5, fontFamily: fonts.body.regular, color: b.textFaint }}>Refund status</Text>
                <Pill label={words(c.RefundStatus as string)} tone={refundColor} />
              </View>
            ) : null}
            {Number(c.RefundNetAmount) > 0 ? <Kv label="Refund amount" value={money(c.RefundNetAmount)} /> : null}
            {c.RefundDueDate ? (
              <Kv
                label="Due by"
                value={
                  isOverdue
                    ? `${fmtDate(c.RefundDueDate)} (overdue)`
                    : daysLeft != null && daysLeft >= 0
                    ? `${fmtDate(c.RefundDueDate)} (${daysLeft}d left)`
                    : fmtDate(c.RefundDueDate)
                }
              />
            ) : null}
            {c.SettlementStatus ? <Kv label="Settlement" value={words(c.SettlementStatus as string)} /> : null}
            {c.HeldAmount ? <Kv label="Held on account" value={money(c.HeldAmount)} /> : null}
          </Section>
        ) : null}

      </ScrollView>

      {/* Approve dialog */}
      <Sheet open={sheet === "approve"} title="Approve Cancellation" sub={sub}
        cancel="Cancel" confirm="Approve" busy={busy} onClose={() => setSheet(null)}
        onConfirm={() =>
          void run(() => put("/approve", {
            Notes: notes.trim() || undefined,
            DeductionPercent: deductPct.trim() ? Number(deductPct) : undefined,
          }), "Cancellation approved")
        }>
        <Kv label="Booking" value={[c.BookingNo, c.UnitNo, c.ProjectName].filter(Boolean).join(" · ")} />
        <Kv label="Applicant" value={c.ApplicantName as string} />
        <Kv label="Default deduction" value={`${Number(c.DeductionPercent).toFixed(1)}%`} />
        <Kv label="Net refund" value={money(c.RefundAmount)} />
        <Field label="Override deduction %" hint="Leave blank to use the default" value={deductPct} onChange={setDeductPct} />
        <Field label="Notes" value={notes} onChange={setNotes} multiline />
      </Sheet>

      {/* Reject dialog */}
      <Sheet open={sheet === "reject"} title="Reject Cancellation" sub={sub}
        cancel="Cancel" confirm="Confirm Rejection" danger busy={busy} disabled={!notes.trim()}
        onClose={() => setSheet(null)}
        onConfirm={() => void run(() => put("/reject", { Notes: notes.trim() }), "Cancellation rejected")}>
        <Field label="Reason for rejection" required hint="Required before rejecting" value={notes} onChange={setNotes} multiline />
      </Sheet>

      {/* Edit dialog */}
      <Sheet open={sheet === "edit"} title="Edit Cancellation Details" sub={sub}
        cancel="Cancel" confirm="Save Details" busy={busy} disabled={!reason.trim()}
        onClose={() => setSheet(null)}
        onConfirm={() =>
          void run(() => put("", {
            Reason: reason.trim(),
            DeductionPercent: deductPct.trim() ? Number(deductPct) : null,
            Notes: notes.trim() || undefined,
          }), "Cancellation details saved")
        }>
        <Field label="Reason for cancellation" required hint="Required" value={reason} onChange={setReason} multiline />
        <Field label="Cancellation charge %" hint="Override deduction %" value={deductPct} onChange={setDeductPct} />
        <Field label="Internal notes (optional)" value={notes} onChange={setNotes} multiline />
      </Sheet>

      {/* Withdraw dialog */}
      <Sheet open={sheet === "withdraw"} title="Withdraw this request?" sub={sub}
        cancel="Keep It" confirm="Withdraw" danger busy={busy}
        onClose={() => setSheet(null)}
        onConfirm={() => void run(() => put("/withdraw", { Reason: notes.trim() || undefined }), "Cancellation request withdrawn")}>
        <Text style={{ fontSize: 13, color: b.textSecondary }}>
          Withdrawing removes the cancellation request. The booking remains active.
        </Text>
        <Field label="Reason (optional)" value={notes} onChange={setNotes} multiline />
      </Sheet>
    </>
  );
}
