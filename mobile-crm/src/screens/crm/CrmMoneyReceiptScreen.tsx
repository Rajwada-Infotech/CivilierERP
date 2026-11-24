// Money receipt detail — amount, payment instrument, Finance link, bounce reason.
// Endpoints: GET /api/crm/money-receipts/:id
//            GET /api/crm/money-receipts/:id/pdf  (opens in device PDF viewer)
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { useRoute, type RouteProp } from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";
import { crmGet, type Row } from "@/api/crmApi";
import { fonts } from "@/theme/fonts";
import { useBrand } from "@/theme/ThemeContext";
import type { MainStackParamList } from "@/navigation/MainStack";
import { ActionKey, Kv, Pill, Section, fmtDate, money, words } from "./ui";
import { openDocument } from "@/utils/documents";

const STATUS_COLOR: Record<string, string> = {
  Pending:  "#f59e0b",
  Approved: "#10b981",
  Bounced:  "#ef4444",
};

export default function CrmMoneyReceiptScreen() {
  const { params } = useRoute<RouteProp<MainStackParamList, "CrmMoneyReceipt">>();
  const { receiptId } = params;
  const b = useBrand();

  const q = useQuery<Row>({
    queryKey: ["crm-money-receipt", receiptId],
    queryFn: () => crmGet(`/api/crm/money-receipts/${receiptId}`),
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
  const hasInstrument = r.ChequeNo || r.ChequeDate || r.TransactionRef;
  const isBounced = r.Status === "Bounced";
  const isApproved = r.Status === "Approved";
  const hasTax = Number(r.GSTAmount) > 0 || Number(r.BaseAmount) > 0;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: b.surface }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 56 }}>

      {/* Identity */}
      <Section title="Receipt">
        <Kv label="Receipt no." value={r.ReceiptNo as string} />
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 2 }}>
          <Text style={{ fontSize: 12.5, fontFamily: fonts.body.regular, color: b.textFaint }}>Status</Text>
          <Pill label={r.Status as string} tone={statusColor} />
        </View>
        <Kv label="Received" value={fmtDate(r.ReceivedDate)} />
        <Kv label="Booking" value={[r.BookingNo, r.UnitNo, r.ProjectName].filter(Boolean).join(" · ")} />
        <Kv label="Applicant" value={r.ApplicantName as string} />
        {isApproved && r.ApprovedAt ? <Kv label="Approved" value={fmtDate(r.ApprovedAt)} /> : null}
        {isBounced && r.BouncedReason ? (
          <View style={{ backgroundColor: b.dangerSoft, borderRadius: 8, padding: 10, marginTop: 4 }}>
            <Text style={{ fontSize: 11.5, fontFamily: fonts.body.regular, color: b.danger, marginBottom: 2 }}>Bounce reason</Text>
            <Text style={{ fontSize: 12.5, fontFamily: fonts.body.regular, color: b.textPrimary }}>{r.BouncedReason as string}</Text>
          </View>
        ) : null}
      </Section>

      {/* Amount */}
      <Section title="Amount">
        {hasTax ? (
          <>
            <Kv label="Base amount" value={money(r.BaseAmount)} />
            <Kv label="GST" value={money(r.GSTAmount)} />
            <View style={{ height: 1, backgroundColor: b.border, marginVertical: 4 }} />
          </>
        ) : null}
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <Text style={{ fontSize: 14, fontFamily: fonts.heading.semibold, color: b.textPrimary }}>Total received</Text>
          <Text style={{ fontSize: 14, fontFamily: fonts.heading.bold, color: b.accent }}>{money(r.Amount)}</Text>
        </View>
        <Kv label="Mode" value={words(r.PaymentMode as string)} />
      </Section>

      {/* Instrument */}
      {hasInstrument ? (
        <Section title="Instrument">
          {r.ChequeNo ? <Kv label="Cheque no." value={r.ChequeNo as string} /> : null}
          {r.ChequeDate ? <Kv label="Cheque date" value={fmtDate(r.ChequeDate)} /> : null}
          {r.TransactionRef ? <Kv label="Transaction ref" value={r.TransactionRef as string} /> : null}
        </Section>
      ) : null}

      {/* Finance */}
      {r.RPDocNo ? (
        <Section title="Finance">
          <Kv label="Received Payment" value={r.RPDocNo as string} />
          {r.RPStatus ? <Kv label="Status" value={words(r.RPStatus as string)} /> : null}
        </Section>
      ) : null}

      {/* PDF */}
      <ActionKey
        label="Open PDF receipt"
        onPress={() =>
          openDocument(`/api/crm/money-receipts/${receiptId}/pdf`, `${r.ReceiptNo as string}.pdf`).catch(() => {})
        }
      />

    </ScrollView>
  );
}
