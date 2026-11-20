// Bills — premium redesign. Same logic as before. Removes dependency on old sheet/Press component.
import { useState } from "react";
import { Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { ChevronRight, Receipt, Zap } from "lucide-react-native";
import { useBrand } from "@/theme/ThemeContext";
import { fonts } from "@/theme/fonts";
import { portal } from "@/api/customerPortalApi";
import { useCustomer } from "@/customer/CustomerContext";
import { Divider, ErrorText, Loading, Muted, Page, Panel, Pill, Row, fmtDate, money, Tap } from "@/customer/ui";
import type { CustomerStackParamList } from "@/navigation/CustomerStack";

const TABS = ["Maintenance", "Electricity"] as const;

export default function CustomerBillsScreen() {
  const brand = useBrand();
  const nav = useNavigation<NativeStackNavigationProp<CustomerStackParamList>>();
  const { appId } = useCustomer();
  const [tab, setTab] = useState<(typeof TABS)[number]>("Maintenance");
  const [openMeter, setOpenMeter] = useState<number | null>(null);
  const maint = useQuery({ queryKey: ["portal-maint-bills", appId], queryFn: () => portal.maintenanceBills(appId as number), enabled: appId != null });
  const elec  = useQuery({ queryKey: ["portal-elec-bills",  appId], queryFn: () => portal.electricityBills(appId as number),  enabled: appId != null && tab === "Electricity" });

  return (
    <Page onRefresh={() => Promise.all([maint.refetch(), tab === "Electricity" ? elec.refetch() : Promise.resolve()])}>

      {/* Tab switcher */}
      <View style={{ flexDirection: "row", gap: 10 }}>
        {TABS.map((x) => {
          const on = x === tab;
          return (
            <Tap key={x} onPress={() => setTab(x)}
              style={{
                flex: 1, paddingVertical: 10, borderRadius: 12, borderWidth: 1.5, alignItems: "center",
                backgroundColor: on ? brand.goldSoft : "transparent",
                borderColor: on ? brand.gold : brand.border,
              }}>
              <Text style={{ fontSize: 13, fontFamily: fonts.heading.semibold, color: on ? brand.gold : brand.textSecondary }}>{x}</Text>
            </Tap>
          );
        })}
      </View>

      {/* Maintenance bills */}
      {tab === "Maintenance" ? (
        <Panel title="Maintenance Bills" icon={Receipt}>
          {maint.isLoading ? <Loading /> : maint.error ? <ErrorText error={maint.error} /> : !maint.data?.length ? (
            <Muted>No maintenance bills yet.</Muted>
          ) : maint.data.map((bill, i) => {
            const overdue = bill.Status === "Active" && !!bill.DueDate && new Date(bill.DueDate) < new Date();
            return (
              <View key={bill.Id}>
                {i ? <Divider /> : null}
                <Tap onPress={() => nav.navigate("CustomerBill", { billId: bill.Id })}
                  style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, opacity: pressed ? 0.7 : 1 })}>
                  <View style={{ flex: 1, gap: 4 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <Text style={{ fontSize: 14, fontFamily: fonts.heading.semibold, color: brand.textPrimary }}>{bill.BillNo}</Text>
                      {overdue ? <Pill label="Overdue" /> : null}
                    </View>
                    <Text style={{ fontSize: 11.5, fontFamily: fonts.body.regular, color: brand.textSecondary }}>
                      {bill.PeriodFrom ? `${fmtDate(bill.PeriodFrom)} – ${fmtDate(bill.PeriodTo)}` : fmtDate(bill.BillDate)}{bill.DueDate ? ` · due ${fmtDate(bill.DueDate)}` : ""}
                    </Text>
                  </View>
                  <Text style={{ fontSize: 14, fontFamily: fonts.heading.semibold, color: overdue ? brand.danger : brand.textPrimary }}>{money(bill.GrandTotal)}</Text>
                  <ChevronRight size={15} color={brand.textFaint} />
                </Tap>
              </View>
            );
          })}
        </Panel>
      ) : (
        /* Electricity bills */
        <Panel title="Electricity Bills" icon={Zap}>
          {elec.isLoading ? <Loading /> : elec.error ? <ErrorText error={elec.error} /> : !elec.data?.length ? (
            <Muted>No electricity bills yet.</Muted>
          ) : elec.data.map((eb, i) => (
            <View key={eb.Id} style={{ gap: 8 }}>
              {i ? <Divider /> : null}
              <Tap onPress={() => setOpenMeter(openMeter === eb.Id ? null : eb.Id)}
                style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 }}>
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={{ fontSize: 14, fontFamily: fonts.heading.semibold, color: brand.textPrimary }}>
                    {fmtDate(eb.BillingPeriodFrom)} – {fmtDate(eb.BillingPeriodTo)}
                  </Text>
                  <Text style={{ fontSize: 11.5, fontFamily: fonts.body.regular, color: brand.textSecondary }}>
                    Meter {eb.MeterNumber} · {Number(eb.PostHandoverUnits ?? eb.TotalUnits ?? 0)} units
                    {eb.BillStatus === "AddedToCustomerBill" ? " · on your maintenance bill" : ""}
                  </Text>
                </View>
                <Text style={{ fontSize: 14, fontFamily: fonts.heading.semibold, color: brand.textPrimary }}>{money(eb.TotalAmount)}</Text>
                <ChevronRight size={15} color={brand.textFaint} style={{ transform: [{ rotate: openMeter === eb.Id ? "90deg" : "0deg" }] }} />
              </Tap>
              {openMeter === eb.Id ? (
                <View style={{ gap: 8, padding: 12, borderRadius: 12, backgroundColor: brand.surface, borderWidth: 1, borderColor: brand.border }}>
                  <Row label="Provider"      value={eb.ProviderName} />
                  <Row label="Units"         value={String(Number(eb.PostHandoverUnits ?? eb.TotalUnits ?? 0))} />
                  <Row label="Energy charge" value={money(eb.EnergyCharge)} />
                  <Row label="Fixed charge"  value={money(eb.FixedCharge)} />
                  {Number(eb.OtherCharge) > 0 ? <Row label="Other charge" value={money(eb.OtherCharge)} /> : null}
                  <View style={{ height: 1, backgroundColor: brand.border }} />
                  <Row label="Total" value={money(eb.TotalAmount)} strong />
                </View>
              ) : null}
            </View>
          ))}
        </Panel>
      )}
    </Page>
  );
}