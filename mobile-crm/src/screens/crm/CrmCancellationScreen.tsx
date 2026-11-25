// Cancellation detail — amounts, deductions, approval chain, and refund status.
// Endpoint: GET /api/crm/cancellations/:id
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { useRoute, useNavigation, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery } from "@tanstack/react-query";
import { crmGet, type Row } from "@/api/crmApi";
import { useAuth } from "@/auth/AuthContext";
import { fonts } from "@/theme/fonts";
import { useBrand } from "@/theme/ThemeContext";
import type { MainStackParamList } from "@/navigation/MainStack";
import { ActionKey, Kv, Pill, Section, fmtDate, money, words } from "./ui";

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

export default function CrmCancellationScreen() {
  const { params } = useRoute<RouteProp<MainStackParamList, "CrmCancellation">>();
  const { cancellationId } = params;
  const b = useBrand();
  const nav = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const { canAccessPage } = useAuth();

  const q = useQuery<Row>({
    queryKey: ["crm-cancellation", cancellationId],
    queryFn: () => crmGet(`/api/crm/cancellations/${cancellationId}`),
  });

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

  return (
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
        {c.Reason ? <Kv label="Reason" value={c.Reason as string} /> : null}
        {c.Notes ? <Kv label="Notes" value={c.Notes as string} /> : null}
      </Section>

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
  );
}
