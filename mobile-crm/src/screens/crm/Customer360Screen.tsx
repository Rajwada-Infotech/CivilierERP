// One customer, everything (the web's Customer 360, crmCustomer360.js GET /:id): their money in total, each booking
// (tap through to it), applications, calls, service tickets and cancellations.
import { useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useAuth } from "@/auth/AuthContext";
import { getCustomer360 } from "@/api/crmApi";
import type { MainStackParamList } from "@/navigation/MainStack";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { ActionKey, CRM, Empty, Figure, Kv, LinkRow, Section, fmtDate, joinDot, money, Pill, useCardStyle } from "./ui";
import { useCrmOpen } from "./CrmRegisterScreen";

export default function Customer360Screen() {
  const { params } = useRoute<RouteProp<MainStackParamList, "CrmCustomer">>();
  const card = useCardStyle();
  const { canAccessPage, canDoAction } = useAuth();
  const nav = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const open = useCrmOpen();
  const allowed = canAccessPage("crm-customer-360");
  const q = useQuery({ queryKey: ["crm-customer-360", params.customerId], queryFn: () => getCustomer360(params.customerId), enabled: allowed });
  const [refreshing, setRefreshing] = useState(false);
  const opensBooking = canAccessPage("crm-bookings") || canAccessPage("crm-payments");

  if (!allowed) {
    return <View style={{ flex: 1, backgroundColor: colors.background, padding: 16 }}><Empty text="You don't have a right on Customer 360." /></View>;
  }

  const d = q.data;
  const c = d?.customer;
  const s = d?.summary ?? {};

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: 16, paddingBottom: 96 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await q.refetch(); setRefreshing(false); }} tintColor={CRM} />}
    >
      {q.isLoading ? (
        <ActivityIndicator color={colors.mutedForeground} style={{ paddingVertical: 60 }} />
      ) : q.error ? (
        <Text style={{ color: colors.destructive, fontSize: 12, fontFamily: fonts.body.regular }}>{(q.error as Error).message}</Text>
      ) : !c ? null : (
        <>
          <View style={{ ...card, padding: 18, marginBottom: 12 }}>
            <Text style={{ fontSize: 18, fontFamily: fonts.heading.bold, color: colors.foreground }}>{c.CustomerName}</Text>
            <Text style={{ fontSize: 12, fontFamily: fonts.body.regular, color: colors.mutedForeground, marginTop: 4 }}>{joinDot(c.CustomerNo, c.Mobile, c.AltMobile)}</Text>
            {c.Email ? <Text style={{ fontSize: 12, fontFamily: fonts.body.regular, color: colors.mutedForeground, marginTop: 2 }}>{c.Email}</Text> : null}
            <Text style={{ fontSize: 11.5, fontFamily: fonts.body.regular, color: colors.mutedForeground, marginTop: 2 }}>{joinDot(c.Address, c.City, c.State, c.Pincode)}</Text>
            {c.PanNo ? <Text style={{ fontSize: 11.5, fontFamily: fonts.body.regular, color: colors.mutedForeground, marginTop: 2 }}>PAN {c.PanNo}</Text> : null}
            {canDoAction("crm-customers", "edit") ? (
              <View style={{ flexDirection: "row", marginTop: 12 }}>
                <ActionKey outline label="Edit customer" onPress={() => nav.navigate("CrmCustomerForm", { customerId: params.customerId })} />
              </View>
            ) : null}
          </View>

          <View style={{ gap: 10, marginBottom: 12 }}>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Figure label="Invoiced" value={money(s.totalInvoiced)} tone="#3b82f6" />
              <Figure label="Paid" value={money(s.totalPaid)} tone="#10b981" />
            </View>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Figure label="Outstanding" value={money(s.totalOutstanding)} tone={Number(s.totalOutstanding) > 0 ? "#f59e0b" : colors.mutedForeground} />
              <Figure label="On account" value={money(s.totalOnAccountBalance)} tone="#8b5cf6" />
            </View>
          </View>
          {Number(s.totalCredited) > 0 ? <Section title="Credit Notes"><Kv label="Credited" value={money(s.totalCredited)} /></Section> : null}

          <Section title={`Bookings (${d.bookings.length})`}>
            {d.bookings.length === 0 ? <Empty text="No bookings." /> : d.bookings.map((b) => (
              <View key={b.Id} style={{ borderBottomWidth: 1, borderBottomColor: colors.border }}>
                <LinkRow
                  title={joinDot(b.BookingNo, b.UnitNo)}
                  sub={joinDot(b.ProjectName, `Paid ${money(b.TotalPaid)} of ${money(b.GrandTotal ?? b.TotalValue)}`, Number(b.TotalOutstanding) > 0 && `Outstanding ${money(b.TotalOutstanding)}`)}
                  right={b.Status ? <Pill label={b.Status} /> : null}
                  onPress={opensBooking ? () => open({ to: "booking", bookingId: Number(b.Id), title: b.BookingNo }) : undefined}
                />
                <Text style={{ fontSize: 10.5, fontFamily: fonts.body.regular, color: colors.mutedForeground, paddingBottom: 8 }}>
                  {joinDot(b.AgreementStatus && `Agreement ${b.AgreementStatus}`, b.PrePossessionStatus && `Checklist ${b.PrePossessionStatus}`, b.HandoverStatus && `Handover ${b.HandoverStatus}`, Number(b.NocTotalCount) > 0 && `NOC ${Number(b.NocTotalCount) - Number(b.NocPendingCount || 0)}/${b.NocTotalCount}`, b.HasCancellation && "Cancellation raised")}
                </Text>
              </View>
            ))}
          </Section>

          <Section title={`Applications (${d.applications.length})`}>
            {d.applications.length === 0 ? <Empty text="No applications." /> : d.applications.map((a) => (
              <LinkRow key={a.Id} title={joinDot(a.ApplicationNo, a.InterestedProject)} sub={joinDot(a.PropertyType, a.BhkPreference, fmtDate(a.CreatedAt), a.AssigneeName)} right={a.Status ? <Pill label={a.Status} /> : null} />
            ))}
          </Section>

          {d.serviceTickets.length ? (
            <Section title={`Service Tickets (${d.serviceTickets.length})`}>
              {d.serviceTickets.map((t) => (
                <LinkRow key={t.Id} title={t.Subject || t.TicketNo} sub={joinDot(t.TicketNo, t.Category, fmtDate(t.CreatedAt))} right={t.Status ? <Pill label={t.Status} /> : null} />
              ))}
            </Section>
          ) : null}

          {d.calls.length ? (
            <Section title={`Calls (${d.calls.length})`}>
              {d.calls.map((k, i) => (
                <LinkRow key={k.Id ?? i} title={joinDot(k.Outcome || k.CallType, fmtDate(k.CallDate || k.CreatedAt))} sub={k.Notes || undefined} />
              ))}
            </Section>
          ) : null}

          {d.cancellations.length ? (
            <Section title={`Cancellations (${d.cancellations.length})`}>
              {d.cancellations.map((x, i) => (
                <LinkRow key={x.Id ?? i} title={joinDot(x.CancellationNo, x.BookingNo)} sub={joinDot(fmtDate(x.CreatedAt), x.RefundAmount != null && `Refund ${money(x.RefundAmount)}`)} right={x.Status ? <Pill label={x.Status} /> : null} />
              ))}
            </Section>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}
