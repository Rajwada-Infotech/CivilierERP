// Refund detail — gross/deduction/net amounts, full approval chain, due-date
// countdown, and bank payout details.
// Endpoint: GET /api/crm/refunds/:id
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { useRoute, type RouteProp } from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";
import { crmGet, type Row } from "@/api/crmApi";
import { fonts } from "@/theme/fonts";
import { useBrand } from "@/theme/ThemeContext";
import type { MainStackParamList } from "@/navigation/MainStack";
import { Kv, Pill, Section, fmtDate, money, words } from "./ui";

const STATUS_COLOR: Record<string, string> = {
  Draft:            "#94a3b8",
  Pending:          "#f59e0b",
  Approved:         "#3b82f6",
  FinancePending:   "#f59e0b",
  FinanceApproved:  "#3b82f6",
  Paid:             "#10b981",
  Rejected:         "#ef4444",
  Cancelled:        "#ef4444",
};

export default function CrmRefundScreen() {
  const { params } = useRoute<RouteProp<MainStackParamList, "CrmRefund">>();
  const { refundId } = params;
  const b = useBrand();

  const q = useQuery<Row>({
    queryKey: ["crm-refund", refundId],
    queryFn: () => crmGet(`/api/crm/refunds/${refundId}`),
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

  const r = q.data;
  const statusColor = STATUS_COLOR[r.Status as string] ?? b.textSecondary;
  const isOverdue = r.IsOverdue === 1 || r.IsOverdue === true;
  const daysLeft = r.DaysRemaining != null ? Number(r.DaysRemaining) : null;
  const hasBankDetails = r.CustomerAccountNo || r.CustomerBankName || r.CustomerIfscCode;

  const dueDateLabel = (() => {
    if (!r.RefundDueDate) return null;
    const base = fmtDate(r.RefundDueDate);
    if (isOverdue) return `${base} (overdue)`;
    if (daysLeft != null && daysLeft >= 0) return `${base} (${daysLeft}d left)`;
    return base;
  })();

  return (
    <ScrollView style={{ flex: 1, backgroundColor: b.surface }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 56 }}>

      {/* Identity */}
      <Section title="Refund">
        <Kv label="Customer" value={r.CustomerName as string} />
        {r.BookingNo ? <Kv label="Booking" value={[r.BookingNo, r.UnitNo, r.ProjectName].filter(Boolean).join(" · ")} /> : null}
        {r.CancellationNo ? <Kv label="Cancellation" value={r.CancellationNo as string} /> : null}
        <Kv label="Number" value={r.RefundNo as string} />
        <Kv label="Source" value={words(r.SourceType as string)} />
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 2 }}>
          <Text style={{ fontSize: 12.5, fontFamily: fonts.body.regular, color: b.textFaint }}>Status</Text>
          <Pill label={words(r.Status as string)} tone={statusColor} />
          {isOverdue ? <Pill label="Overdue" tone={b.danger} /> : null}
        </View>
        {r.Reason ? <Kv label="Reason" value={r.Reason as string} /> : null}
        {r.Notes ? <Kv label="Notes" value={r.Notes as string} /> : null}
      </Section>

      {/* Amounts */}
      <Section title="Amounts">
        <Kv label="Gross" value={money(r.GrossAmount)} />
        {Number(r.DeductionPercent) > 0 || Number(r.DeductionAmount) > 0 ? (
          <Kv label={`Deduction${Number(r.DeductionPercent) > 0 ? ` (${Number(r.DeductionPercent).toFixed(1)}%)` : ""}`}
            value={money(r.DeductionAmount)} />
        ) : null}
        <View style={{ height: 1, backgroundColor: b.border, marginVertical: 4 }} />
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <Text style={{ fontSize: 14, fontFamily: fonts.heading.semibold, color: b.textPrimary }}>Net refund</Text>
          <Text style={{ fontSize: 14, fontFamily: fonts.heading.bold, color: b.accent }}>{money(r.NetAmount)}</Text>
        </View>
        {dueDateLabel ? (
          <Kv label="Due by" value={dueDateLabel} />
        ) : null}
      </Section>

      {/* Approval chain */}
      <Section title="Approval chain">
        {/* Step 1: Requested */}
        <View style={{ gap: 2 }}>
          <Text style={{ fontSize: 12, fontFamily: fonts.heading.semibold, color: b.textSecondary }}>Requested</Text>
          <Kv label="By" value={(r.RequestedByName || "—") as string} />
          {r.RequestedAt ? <Kv label="On" value={fmtDate(r.RequestedAt)} /> : null}
        </View>

        {/* Step 2: CRM Approved / Rejected */}
        {r.ApprovedAt || r.ApprovedBy || (["Rejected", "Cancelled"].includes(r.Status as string) && r.RejectionNote) ? (
          <View style={{ gap: 2, marginTop: 10 }}>
            <Text style={{ fontSize: 12, fontFamily: fonts.heading.semibold, color: b.textSecondary }}>
              {["Rejected", "Cancelled"].includes(r.Status as string) ? "Rejected" : "CRM Approved"}
            </Text>
            {r.ApprovedByName ? <Kv label="By" value={r.ApprovedByName as string} /> : null}
            {r.ApprovedAt ? <Kv label="On" value={fmtDate(r.ApprovedAt)} /> : null}
            {r.RejectionNote ? (
              <View style={{ backgroundColor: b.dangerSoft, borderRadius: 8, padding: 10, marginTop: 4 }}>
                <Text style={{ fontSize: 12, fontFamily: fonts.body.regular, color: b.danger }}>{r.RejectionNote as string}</Text>
              </View>
            ) : null}
          </View>
        ) : null}

        {/* Step 3: Finance Cleared */}
        {r.FinanceClearedAt || r.FinanceClearedByName ? (
          <View style={{ gap: 2, marginTop: 10 }}>
            <Text style={{ fontSize: 12, fontFamily: fonts.heading.semibold, color: b.textSecondary }}>Finance Cleared</Text>
            {r.FinanceClearedByName ? <Kv label="By" value={r.FinanceClearedByName as string} /> : null}
            {r.FinanceClearedAt ? <Kv label="On" value={fmtDate(r.FinanceClearedAt)} /> : null}
          </View>
        ) : null}

        {/* Step 4: Paid */}
        {r.PaidAt ? (
          <View style={{ gap: 2, marginTop: 10 }}>
            <Text style={{ fontSize: 12, fontFamily: fonts.heading.semibold, color: b.success }}>Paid</Text>
            <Kv label="On" value={fmtDate(r.PaidAt)} />
          </View>
        ) : null}
      </Section>

      {/* Payout details */}
      {(hasBankDetails || r.PreferredPaymentMode || r.RefundBankName) ? (
        <Section title="Payout details">
          {r.PreferredPaymentMode ? <Kv label="Mode" value={r.PreferredPaymentMode as string} /> : null}
          {r.RefundBankName ? <Kv label="Company bank" value={r.RefundBankName as string} /> : null}
          {r.CustomerBankName ? <Kv label="Customer bank" value={r.CustomerBankName as string} /> : null}
          {r.CustomerAccountNo ? <Kv label="Account no." value={r.CustomerAccountNo as string} /> : null}
          {r.CustomerIfscCode ? <Kv label="IFSC" value={r.CustomerIfscCode as string} /> : null}
          {r.NeedsAccount === 1 || r.NeedsAccount === true ? (
            <View style={{ backgroundColor: b.warningSoft, borderRadius: 8, padding: 10, marginTop: 4 }}>
              <Text style={{ fontSize: 12, fontFamily: fonts.body.regular, color: b.warning }}>
                Customer bank account details needed before this can be approved.
              </Text>
            </View>
          ) : null}
        </Section>
      ) : null}

    </ScrollView>
  );
}
