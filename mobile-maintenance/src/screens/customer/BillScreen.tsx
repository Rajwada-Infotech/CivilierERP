// One maintenance bill — premium redesign. Same data as before.
import { View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "@tanstack/react-query";
import { Building2, ListChecks } from "lucide-react-native";
import { portal } from "@/api/customerPortalApi";
import { useCustomer } from "@/customer/CustomerContext";
import { Divider, ErrorText, ListRow, Loading, Page, Panel, Row, fmtDate, money } from "@/customer/ui";
import { useBrand } from "@/theme/ThemeContext";
import type { CustomerStackParamList } from "@/navigation/CustomerStack";

export default function CustomerBillScreen({ route }: NativeStackScreenProps<CustomerStackParamList, "CustomerBill">) {
  const brand = useBrand();
  const { appId } = useCustomer();
  const q = useQuery({
    queryKey: ["portal-maint-bill", appId, route.params.billId],
    queryFn: () => portal.maintenanceBill(appId as number, route.params.billId),
    enabled: appId != null,
  });
  const bill = q.data;

  if (q.isLoading) return <Page><Loading /></Page>;
  if (q.error || !bill) return <Page><ErrorText error={q.error} /></Page>;

  return (
    <Page onRefresh={() => q.refetch()}>
      <Panel title={bill.BillNo} icon={Building2}>
        {bill.CompanyName  ? <Row label="From"  value={bill.CompanyName}  /> : null}
        {bill.CompanyGstNo ? <Row label="GSTIN" value={bill.CompanyGstNo} /> : null}
        <Row label="Unit"      value={[bill.UnitNo, bill.BlockName].filter(Boolean).join(" · ") || "—"} />
        <Row label="Bill date" value={fmtDate(bill.BillDate)} />
        {bill.PeriodFrom ? <Row label="Period"   value={`${fmtDate(bill.PeriodFrom)} – ${fmtDate(bill.PeriodTo)}`} /> : null}
        {bill.DueDate    ? <Row label="Due date" value={fmtDate(bill.DueDate)} /> : null}
      </Panel>

      <Panel title="Charges" icon={ListChecks}>
        {(bill.items || []).map((it, i) => (
          <View key={it.Id}>
            {i ? <Divider /> : null}
            <ListRow
              title={it.ChargeHeadName}
              right={money(it.TotalAmount)}
              sub={`${money(it.Rate)}${Number(it.TaxPct) > 0 ? ` + GST ${Number(it.TaxPct)}% ${money(it.TaxAmount)}` : ""}${it.HsnCode ? ` · HSN ${it.HsnCode}` : ""}`}
            />
          </View>
        ))}
        <View style={{ height: 1, backgroundColor: brand.border }} />
        <Row label="Subtotal" value={money(bill.Subtotal)} />
        <Row label="GST"      value={money(bill.TotalTax)} />
        <View style={{ height: 1, backgroundColor: brand.borderGold }} />
        <Row label="Total"    value={money(bill.GrandTotal)} strong />
        {bill.Notes ? (
          <View style={{ padding: 10, borderRadius: 10, backgroundColor: brand.goldSoft, borderWidth: 1, borderColor: brand.borderGold }}>
            <Row label="Notes" value={bill.Notes} />
          </View>
        ) : null}
      </Panel>
    </Page>
  );
}