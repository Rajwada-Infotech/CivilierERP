// Invoice detail — invoice number, type, GST breakdown, credit note offsets.
// Endpoint: GET /api/crm/invoices/:id
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { useRoute, type RouteProp } from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";
import { crmGet, type Row } from "@/api/crmApi";
import { fonts } from "@/theme/fonts";
import { useBrand } from "@/theme/ThemeContext";
import type { MainStackParamList } from "@/navigation/MainStack";
import { Kv, Pill, Section, fmtDate, money, words } from "./ui";

const STATUS_COLOR: Record<string, string> = {
  Draft:   "#94a3b8",
  Issued:  "#3b82f6",
  Void:    "#ef4444",
  Final:   "#10b981",
};

const TYPE_LABEL: Record<string, string> = {
  Tax:    "Tax Invoice",
  Proforma: "Proforma",
  Final:  "Final Statement",
};

export default function CrmInvoiceScreen() {
  const { params } = useRoute<RouteProp<MainStackParamList, "CrmInvoice">>();
  const { invoiceId } = params;
  const b = useBrand();

  const q = useQuery<Row>({
    queryKey: ["crm-invoice", invoiceId],
    queryFn: () => crmGet(`/api/crm/invoices/${invoiceId}`),
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

  const inv = q.data;
  const statusColor = STATUS_COLOR[inv.Status as string] ?? b.textSecondary;
  const typeLabel = TYPE_LABEL[inv.InvoiceType as string] ?? words(inv.InvoiceType as string);
  const hasTax = Number(inv.GstAmount) > 0 || Number(inv.TaxableValue) > 0;
  const netAfterCredit = Number(inv.Amount) - Number(inv.CreditedAmount ?? 0);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: b.surface }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 56 }}>

      {/* Identity */}
      <Section title="Invoice">
        <Kv label="Number" value={inv.InvoiceNo as string} />
        <Kv label="Type" value={typeLabel} />
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 2 }}>
          <Text style={{ fontSize: 12.5, fontFamily: fonts.body.regular, color: b.textFaint }}>Status</Text>
          <Pill label={inv.Status as string} tone={statusColor} />
        </View>
        <Kv label="Date" value={fmtDate(inv.InvoiceDate)} />
        <Kv label="Booking" value={[inv.BookingNo, inv.UnitNo, inv.ProjectName].filter(Boolean).join(" · ")} />
        <Kv label="Applicant" value={inv.ApplicantName as string} />
        {inv.Description ? <Kv label="Description" value={inv.Description as string} /> : null}
        {inv.VoidReason ? (
          <View style={{ backgroundColor: b.dangerSoft, borderRadius: 8, padding: 10, marginTop: 4 }}>
            <Text style={{ fontSize: 11.5, fontFamily: fonts.body.regular, color: b.danger, marginBottom: 2 }}>Voided</Text>
            <Text style={{ fontSize: 12.5, fontFamily: fonts.body.regular, color: b.textPrimary }}>{inv.VoidReason as string}</Text>
          </View>
        ) : null}
      </Section>

      {/* Amounts */}
      <Section title="Amounts">
        {hasTax ? (
          <>
            <Kv label="Taxable value" value={money(inv.TaxableValue)} />
            <Kv label="GST" value={money(inv.GstAmount)} />
            <View style={{ height: 1, backgroundColor: b.border, marginVertical: 4 }} />
          </>
        ) : null}
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <Text style={{ fontSize: 14, fontFamily: fonts.heading.semibold, color: b.textPrimary }}>Invoice amount</Text>
          <Text style={{ fontSize: 14, fontFamily: fonts.heading.bold, color: b.accent }}>{money(inv.Amount)}</Text>
        </View>
        {Number(inv.CreditedAmount) > 0 ? (
          <>
            <Kv label="Credit notes" value={`− ${money(inv.CreditedAmount)}`} />
            <View style={{ height: 1, backgroundColor: b.border, marginVertical: 4 }} />
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Text style={{ fontSize: 13, fontFamily: fonts.heading.semibold, color: b.textPrimary }}>Net after credits</Text>
              <Text style={{ fontSize: 13, fontFamily: fonts.heading.bold, color: netAfterCredit <= 0 ? b.success : b.accent }}>{money(netAfterCredit)}</Text>
            </View>
            {inv.CreditNoteNos ? (
              <Kv label="Credit note nos." value={inv.CreditNoteNos as string} />
            ) : null}
          </>
        ) : null}
      </Section>

    </ScrollView>
  );
}
