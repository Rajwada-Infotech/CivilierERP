// Brokerage record detail — broker, commission, payment log.
// Endpoint: GET /api/crm/brokerage/:id  → { brokerage, payments[] }
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { useRoute, type RouteProp } from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";
import { crmGet, type Row } from "@/api/crmApi";
import { fonts } from "@/theme/fonts";
import { useBrand } from "@/theme/ThemeContext";
import type { MainStackParamList } from "@/navigation/MainStack";
import { Kv, Pill, Section, fmtDate, money, words } from "./ui";

const STATUS_COLOR: Record<string, string> = {
  Pending:  "#f59e0b",
  Approved: "#3b82f6",
  Paid:     "#10b981",
  Rejected: "#ef4444",
};

type BrokerageData = { brokerage: Row; payments: Row[] };

export default function CrmBrokerageScreen() {
  const { params } = useRoute<RouteProp<MainStackParamList, "CrmBrokerage">>();
  const { brokerageId } = params;
  const b = useBrand();

  const q = useQuery<BrokerageData>({
    queryKey: ["crm-brokerage", brokerageId],
    queryFn: () => crmGet(`/api/crm/brokerage/${brokerageId}`),
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

  const { brokerage: br, payments } = q.data;
  const statusColor = STATUS_COLOR[br.Status as string] ?? b.textSecondary;
  const rateLabel = br.RateType === "Percentage"
    ? `${Number(br.RateValue).toFixed(2)}%`
    : br.RateType === "Amount"
    ? money(br.RateValue)
    : br.RateValue != null ? String(br.RateValue) : null;

  const balance = Number(br.ComputedAmount ?? 0) - Number(br.TotalPaid ?? 0);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: b.surface }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 56 }}>

      {/* Identity */}
      <Section title="Brokerage">
        <Kv label="Booking" value={[br.BookingNo, br.UnitNo].filter(Boolean).join(" · ")} />
        <Kv label="Applicant" value={br.ApplicantName as string} />
        {br.MilestoneName ? <Kv label="Milestone" value={br.MilestoneName as string} /> : null}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 2 }}>
          <Text style={{ fontSize: 12.5, fontFamily: fonts.body.regular, color: b.textFaint }}>Status</Text>
          <Pill label={words(br.Status as string)} tone={statusColor} />
          {br.IsLocked ? <Pill label="Locked" tone={b.textFaint} /> : null}
        </View>
      </Section>

      {/* Broker */}
      <Section title="Broker">
        <Kv label="Name" value={(br.BrokerMasterName || br.BrokerName || "—") as string} />
        {br.BrokerFirm ? <Kv label="Firm" value={br.BrokerFirm as string} /> : null}
        {br.BrokerContact || br.BrokerMasterPhone ? (
          <Kv label="Contact" value={(br.BrokerContact || br.BrokerMasterPhone) as string} />
        ) : null}
      </Section>

      {/* Commission */}
      <Section title="Commission">
        {rateLabel ? <Kv label={`Rate (${words(br.RateType as string)})`} value={rateLabel} /> : null}
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <Text style={{ fontSize: 14, fontFamily: fonts.heading.semibold, color: b.textPrimary }}>Commission</Text>
          <Text style={{ fontSize: 14, fontFamily: fonts.heading.bold, color: b.accent }}>{money(br.ComputedAmount)}</Text>
        </View>
        {Number(br.TotalPaid) > 0 ? (
          <>
            <Kv label="Paid so far" value={money(br.TotalPaid)} />
            <View style={{ height: 1, backgroundColor: b.border, marginVertical: 4 }} />
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Text style={{ fontSize: 13, fontFamily: fonts.heading.semibold, color: b.textPrimary }}>Balance</Text>
              <Text style={{ fontSize: 13, fontFamily: fonts.heading.bold, color: balance <= 0 ? b.success : b.accent }}>{money(balance)}</Text>
            </View>
          </>
        ) : null}
        {Number(br.TotalSubmitted) > 0 && br.Status !== "Paid" ? (
          <Kv label="Submitted to Finance" value={money(br.TotalSubmitted)} />
        ) : null}
        {br.FinancePaymentDocNo ? (
          <Kv label="Finance voucher" value={[br.FinancePaymentDocNo, words(br.FinancePaymentStatus as string)].filter(Boolean).join(" · ")} />
        ) : null}
      </Section>

      {/* Payment log */}
      {payments.length > 0 ? (
        <Section title="Payments made">
          <View style={{ gap: 8 }}>
            {payments.map((p, i) => (
              <View key={i} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 12.5, fontFamily: fonts.body.medium, color: b.textPrimary }}>{fmtDate(p.PaidDate)}</Text>
                  {p.Remarks ? (
                    <Text style={{ fontSize: 11.5, fontFamily: fonts.body.regular, color: b.textFaint }}>{p.Remarks as string}</Text>
                  ) : null}
                </View>
                <Text style={{ fontSize: 13, fontFamily: fonts.heading.semibold, color: b.success }}>{money(p.Amount)}</Text>
              </View>
            ))}
          </View>
        </Section>
      ) : null}

    </ScrollView>
  );
}
