// One booking on the phone: the buyer (Call / WhatsApp), the money first (price, paid, balance, overdue, on account),
// what can be done here (log a welcome call, take a payment, raise a ticket), the journey from booking to mutation,
// the payment milestones (Pay on the open ones), the booking's papers (money receipts, invoices, documents), its
// service tickets, the buyer and the agreement. Each part comes from the route the web page uses and shows only to
// staff with that page's right.
import { useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useRoute, type RouteProp } from "@react-navigation/native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { CheckCircle2, Circle, FileText, Lock, PhoneCall, Ticket, Wallet } from "lucide-react-native";
import { useAuth } from "@/auth/AuthContext";
import { crmGet, getBooking, getBookingLifecycle, getBookingPayments, type Row } from "@/api/crmApi";
import { getTicketsForBooking } from "@/api/serviceTicketApi";
import type { MainStackParamList } from "@/navigation/MainStack";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { ActionKey, CRM, ContactKeys, Empty, HeroSurface, Kv, LinkRow, ON_HERO, Section, Tap, fmtDate, joinDot, money, Pill, useCardStyle, words } from "./ui";
import { useCrmOpen } from "./CrmRegisterScreen";
import { milestoneMissing, nextOpenMilestone } from "./CrmForms";

// A booking that no longer takes money here (the web's "closed" plan).
const CLOSED = ["Cancelled", "UnitChanged", "Rejected"];
const kb = (n: unknown) => { const b = Number(n) || 0; return b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : b ? `${Math.max(1, Math.round(b / 1024))} KB` : ""; };

const STEP_ICON = { done: CheckCircle2, active: Circle, locked: Lock } as const;
const STEP_TONE: Record<string, string> = { done: "#10b981", active: CRM, locked: colors.mutedForeground };

export default function BookingDetailScreen() {
  const { params } = useRoute<RouteProp<MainStackParamList, "CrmBooking">>();
  const card = useCardStyle();
  const id = params.bookingId;
  const { canAccessPage, canDoAction } = useAuth();
  const nav = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const open = useCrmOpen();
  const seesBooking = canAccessPage("crm-bookings");
  const seesMoney = canAccessPage("crm-payments");
  const [refreshing, setRefreshing] = useState(false);

  const bookingQ = useQuery({ queryKey: ["crm-booking", id], queryFn: () => getBooking(id), enabled: seesBooking });
  const lifeQ = useQuery({ queryKey: ["crm-booking-life", id], queryFn: () => getBookingLifecycle(id), enabled: seesBooking });
  const payQ = useQuery({ queryKey: ["crm-booking-pay", id], queryFn: () => getBookingPayments(id), enabled: seesMoney });
  // The booking's papers and tickets, each behind the right its route checks.
  const seesReceipts = canAccessPage("crm-money-receipts") || seesMoney;
  const seesInvoices = seesBooking || canAccessPage("crm-invoices");
  const seesTickets = canAccessPage("crm-service-tickets");
  const receiptsQ = useQuery({ queryKey: ["crm-booking-receipts", id], queryFn: () => crmGet<Row[]>(`/api/crm/money-receipts?bookingId=${id}`), enabled: seesReceipts });
  const invoicesQ = useQuery({ queryKey: ["crm-booking-invoices", id], queryFn: () => crmGet<Row[]>(`/api/crm/bookings/${id}/invoices`), enabled: seesInvoices });
  const docsQ = useQuery({ queryKey: ["crm-booking-docs", id], queryFn: () => crmGet<Row[]>(`/api/crm/bookings/${id}/attachments`), enabled: seesBooking });
  const ticketsQ = useQuery({ queryKey: ["crm-booking-tickets", id], queryFn: () => getTicketsForBooking(id), enabled: seesTickets });

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([seesBooking && bookingQ.refetch(), seesBooking && lifeQ.refetch(), seesMoney && payQ.refetch(),
      seesReceipts && receiptsQ.refetch(), seesInvoices && invoicesQ.refetch(), seesBooking && docsQ.refetch(), seesTickets && ticketsQ.refetch()]);
    setRefreshing(false);
  };

  const b = bookingQ.data?.booking;
  const pb = payQ.data?.booking;
  const head = { ...(pb ?? {}), ...(b ?? {}) };
  const customer = bookingQ.data?.customer;
  const milestones = payQ.data?.milestones ?? bookingQ.data?.milestones ?? [];
  const sum = payQ.data?.summary ?? bookingQ.data?.paymentSummary;
  const moneyInfo = payQ.data?.money;
  const overdue = Number(payQ.data?.summary?.overdue) || 0;
  const loading = (seesBooking && bookingQ.isLoading) || (seesMoney && payQ.isLoading);
  const error = (bookingQ.error || payQ.error) as Error | null;
  const status = head.Status || head.BookingStatus;
  const live = !CLOSED.includes(status);
  const price = Number(head.GrandTotal ?? sum?.totalDue) || 0;
  const title = head.BookingNo || params.title || "Booking";
  const canPay = live && canDoAction("crm-payments", "edit");
  const canDeposit = live && canDoAction("crm-payments", "create");
  const canCall = live && canDoAction("crm-welcome-calls", "create");
  const canTicket = live && canDoAction("crm-service-tickets", "create");
  const nextOpenId = nextOpenMilestone(milestones)?.Id;
  const receipts = receiptsQ.data ?? [];
  const invoices = invoicesQ.data ?? [];
  const docs = docsQ.data ?? [];
  const tickets = ticketsQ.data ?? [];

  if (!seesBooking && !seesMoney) {
    return <View style={{ flex: 1, backgroundColor: colors.background, padding: 16 }}><Empty text="You don't have a right on Bookings or Payment Milestones." /></View>;
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: 16, paddingBottom: 96 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={CRM} />}
    >
      {loading ? (
        <ActivityIndicator color={colors.mutedForeground} style={{ paddingVertical: 60 }} />
      ) : error && !b && !pb ? (
        <Text style={{ color: colors.destructive, fontSize: 12, fontFamily: fonts.body.regular }}>{error.message}</Text>
      ) : (
        <>
          {/* Who, what, and the money — the booking number is the header's, so it isn't repeated here */}
          <View style={{ marginBottom: 12 }}>
            <HeroSurface padding={20}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                {status ? (
                  <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: ON_HERO.glass }}>
                    <Text style={{ fontSize: 12, fontFamily: fonts.heading.semibold, color: ON_HERO.primary }}>{words(status)}</Text>
                  </View>
                ) : null}
                {overdue > 0 ? (
                  <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: "rgba(248,113,113,0.24)" }}>
                    <Text style={{ fontSize: 12, fontFamily: fonts.heading.semibold, color: "#FECACA" }}>{overdue} overdue</Text>
                  </View>
                ) : null}
              </View>
              <Text numberOfLines={1} style={{ fontSize: 22, fontFamily: fonts.heading.semibold, color: ON_HERO.primary, letterSpacing: -0.3, marginTop: 14 }}>
                {customer?.CustomerName || head.ApplicantName || "—"}
              </Text>
              <Text style={{ fontSize: 13, lineHeight: 18, fontFamily: fonts.body.regular, color: ON_HERO.secondary, marginTop: 3 }}>
                {joinDot(head.ProjectName, [head.BlockName, head.FloorName, head.UnitNo].filter(Boolean).join(" / "), head.UnitType, head.BookingDate && `Booked ${fmtDate(head.BookingDate)}`)}
              </Text>
              {sum ? (
                <View style={{ marginTop: 18, gap: 8 }}>
                  <Text style={{ fontSize: 12.5, fontFamily: fonts.body.medium, color: ON_HERO.secondary }}>Balance</Text>
                  <Text style={{ fontSize: 30, fontFamily: fonts.heading.semibold, color: ON_HERO.primary, letterSpacing: -0.6, marginTop: -4 }}>{money(sum.balance)}</Text>
                  <View style={{ height: 6, borderRadius: 3, backgroundColor: ON_HERO.glass, overflow: "hidden" }}>
                    <View style={{ height: 6, borderRadius: 3, width: `${price ? Math.min(100, (Number(sum.totalPaid) / price) * 100) : 0}%`, backgroundColor: "#34D399" }} />
                  </View>
                  <Text style={{ fontSize: 12.5, fontFamily: fonts.body.medium, color: ON_HERO.secondary }}>Paid {money(sum.totalPaid)} of {money(price)}</Text>
                </View>
              ) : null}
              <View style={{ marginTop: 16 }}><ContactKeys mobile={customer?.Mobile || head.Mobile} /></View>
            </HeroSurface>
          </View>

          {canCall || canDeposit || canTicket ? (
            <View style={{ flexDirection: "row", gap: 10, marginBottom: 12 }}>
              {[
                canCall && { key: "call", label: "Log welcome call", icon: PhoneCall, go: () => nav.navigate("CrmWelcomeCall", { bookingId: id, title }) },
                canDeposit && { key: "deposit", label: "Deposit on account", icon: Wallet, go: () => nav.navigate("CrmPayment", { bookingId: id, title }) },
                canTicket && { key: "ticket", label: "Raise ticket", icon: Ticket, go: () => nav.navigate("CrmTicketNew", { bookingId: id, title }) },
              ].filter((a): a is { key: string; label: string; icon: typeof Ticket; go: () => void } => !!a).map((a) => (
                <Tap key={a.key} onPress={a.go} accessibilityRole="button" accessibilityLabel={a.label}
                  style={({ pressed }) => ({ ...card, flex: 1, alignItems: "center", gap: 8, paddingVertical: 14, paddingHorizontal: 6, opacity: pressed ? 0.75 : 1 })}>
                  <View style={{ width: 40, height: 40, borderRadius: 13, backgroundColor: `${CRM}24`, alignItems: "center", justifyContent: "center" }}>
                    <a.icon size={19} color={CRM} />
                  </View>
                  <Text numberOfLines={2} style={{ fontSize: 12.5, lineHeight: 16, textAlign: "center", fontFamily: fonts.heading.semibold, color: colors.foreground }}>{a.label}</Text>
                </Tap>
              ))}
            </View>
          ) : null}

          {moneyInfo ? (
            <Section title="Money">
              <Kv label="On account (available)" value={money(pb?.OnAccountAvailable)} />
              <Kv label="With Finance for approval" value={Number(moneyInfo.inVerification) > 0 ? `${money(moneyInfo.inVerification)} (${moneyInfo.inVerificationCount})` : money(0)} />
              <Kv label="Still to collect" value={money(moneyInfo.toCollect)} strong />
              {Number(moneyInfo.excess) > 0 ? <Kv label="Paid over the price" value={money(moneyInfo.excess)} tone="#f59e0b" /> : null}
              {Number(payQ.data?.summary?.waivedDue) > 0 ? <Kv label={`Waived (${payQ.data?.summary?.waivedCount})`} value={money(payQ.data?.summary?.waivedDue)} /> : null}
            </Section>
          ) : null}

          {/* The journey */}
          {lifeQ.data?.steps?.length ? (
            <Section title="Journey">
              {lifeQ.data.steps.map((s) => {
                const Icon = STEP_ICON[s.status as keyof typeof STEP_ICON] ?? Circle;
                const tone = STEP_TONE[s.status] ?? colors.mutedForeground;
                return (
                  <View key={s.key} style={{ flexDirection: "row", alignItems: "flex-start", gap: 10, paddingVertical: 7 }}>
                    <Icon size={15} color={tone} style={{ marginTop: 1 }} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 12.5, fontFamily: s.status === "active" ? fonts.heading.semibold : fonts.body.medium, color: s.status === "locked" ? colors.mutedForeground : colors.foreground }}>{s.label}</Text>
                      {s.blockedBy ? <Text style={{ fontSize: 10.5, fontFamily: fonts.body.regular, color: colors.mutedForeground, marginTop: 1 }}>{s.blockedBy}</Text> : null}
                    </View>
                    {s.date ? <Text style={{ fontSize: 10.5, fontFamily: fonts.body.regular, color: colors.mutedForeground }}>{fmtDate(s.date)}</Text> : null}
                  </View>
                );
              })}
            </Section>
          ) : null}

          {/* Milestones */}
          <Section title={`Payment Milestones (${milestones.length})`}>
            {milestones.length === 0 ? <Empty text="No milestones." /> : milestones.map((m) => {
              const status = m.IsOverdue ? "Overdue" : m.DemandStatus || m.Status;
              return (
                <View key={m.Id} style={{ paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Text numberOfLines={2} style={{ flex: 1, fontSize: 12.5, fontFamily: fonts.heading.semibold, color: colors.foreground }}>{`${m.MilestoneNo}. ${m.MilestoneName}`}</Text>
                    {status ? <Pill label={status} /> : null}
                  </View>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 4 }}>
                    <Text style={{ fontSize: 11, fontFamily: fonts.body.regular, color: colors.mutedForeground }}>
                      {joinDot(m.Percent && `${m.Percent}%`, m.DueDate && `Due ${fmtDate(m.DueDate)}`, m.DemandNo)}
                    </Text>
                    <Text style={{ fontSize: 11.5, fontFamily: fonts.body.medium, color: colors.foreground, fontVariant: ["tabular-nums"] }}>
                      {money(m.AmountPaid)} / {money(m.AmountDue)}
                    </Text>
                  </View>
                  {Number(m.PendingVerificationAmount) > 0 ? (
                    <Text style={{ fontSize: 10.5, fontFamily: fonts.body.regular, color: "#f59e0b", marginTop: 2 }}>{money(m.PendingVerificationAmount)} with Finance for approval</Text>
                  ) : null}
                  {canPay && payQ.data && m.Status !== "Waived" && m.Status !== "Paid" && milestoneMissing(m) > 0 ? (
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 8 }}>
                      <Text style={{ fontSize: 11, fontFamily: fonts.body.medium, color: colors.mutedForeground }}>Balance {money(milestoneMissing(m))}</Text>
                      <View style={{ width: 96, flexDirection: "row" }}>
                        <ActionKey label="Pay" outline={m.Id !== nextOpenId} onPress={() => nav.navigate("CrmPayment", { bookingId: id, milestoneId: m.Id, title })} />
                      </View>
                    </View>
                  ) : null}
                </View>
              );
            })}
          </Section>

          {/* Papers */}
          {seesReceipts || seesInvoices || seesBooking ? (
            <Section title="Papers">
              {seesReceipts ? receipts.map((r) => (
                <LinkRow key={`r${r.Id}`} icon={FileText} title={`Money receipt ${r.ReceiptNo}`} sub={joinDot(money(r.Amount), fmtDate(r.ReceivedDate), r.PaymentMode, r.Status)}
                  onPress={() => open({ to: "document", path: `/api/crm/money-receipts/${r.Id}/pdf`, name: r.ReceiptNo || "Money Receipt" })} />
              )) : null}
              {seesInvoices ? invoices.map((v) => (
                <LinkRow key={`i${v.Id}`} icon={FileText} tone="#3b82f6" title={`Invoice ${v.InvoiceNo ?? v.Id}`}
                  sub={joinDot(v.InvoiceType, money(v.TotalAmount ?? v.GrandTotal ?? v.Amount), fmtDate(v.InvoiceDate ?? v.CreatedAt), v.Status)}
                  onPress={() => open({ to: "document", path: `/api/crm/bookings/${id}/invoices/${v.Id}/pdf`, name: v.InvoiceNo || "Invoice" })} />
              )) : null}
              {seesBooking ? docs.map((d) => (
                <LinkRow key={`${d.Source}${d.Id}`} icon={FileText} tone="#8b5cf6" title={d.Label || d.FileName}
                  sub={joinDot(d.FileName !== d.Label && d.FileName, kb(d.FileSize), fmtDate(d.CreatedAt), d.UploaderName)}
                  onPress={() => open({ to: "document", name: d.FileName || "Document",
                    path: d.Source === "booking" ? `/api/crm/bookings/${id}/attachments/file/${d.Id}` : `/api/crm/booking-documents/file/${d.Id}` })} />
              )) : null}
              {receiptsQ.isLoading || invoicesQ.isLoading || docsQ.isLoading ? <ActivityIndicator color={colors.mutedForeground} style={{ paddingVertical: 10 }} />
                : !receipts.length && !invoices.length && !docs.length ? <Empty text="No receipts, invoices or documents yet." /> : null}
            </Section>
          ) : null}

          {/* Service tickets */}
          {seesTickets && (tickets.length || canTicket) ? (
            <Section title={`Service Tickets (${tickets.length})`}>
              {tickets.length === 0 ? <Empty text="No service tickets." /> : tickets.map((t) => (
                <LinkRow key={t.Id} title={t.Subject || t.TicketNo} sub={joinDot(t.TicketNo, t.Category, fmtDate(t.CreatedAt), t.AssigneeName)}
                  right={<Pill label={t.Status} />} onPress={() => open({ to: "ticket", ticketId: t.Id })} />
              ))}
            </Section>
          ) : null}

          {/* Buyer */}
          {customer ? (
            <Section title="Buyer">
              <LinkRow
                title={customer.CustomerNo || customer.CustomerName}
                sub={joinDot(customer.Mobile, customer.Email)}
                onPress={canAccessPage("crm-customer-360") ? () => open({ to: "customer", customerId: Number(customer.Id), title: customer.CustomerName }) : undefined}
              />
              <Kv label="PAN" value={customer.PanNo} />
              <Kv label="Address" value={joinDot(customer.Address, customer.City, customer.State, customer.Pincode)} />
              {customer.CoApplicantName ? <Kv label="Co-applicant" value={joinDot(customer.CoApplicantName, customer.CoApplicantRelation)} /> : null}
            </Section>
          ) : null}

          {/* Unit and price */}
          {b ? (
            <Section title="Unit & Price">
              <Kv label="Area" value={b.AreaSqFt ? `${b.AreaSqFt} sq ft` : null} />
              <Kv label="Carpet area" value={b.CarpetAreaSqFt ? `${b.CarpetAreaSqFt} sq ft` : null} />
              <Kv label="Rate" value={b.RatePerSqFt ? `${money(b.RatePerSqFt)} / sq ft` : null} />
              <Kv label="Unit value" value={money(b.TotalValue)} />
              {pb ? <Kv label="Parking" value={money(pb.ParkingTotal)} /> : null}
              {pb ? <Kv label="Extra charges" value={money(pb.ExtraChargesTotal)} /> : null}
              <Kv label="Booking amount" value={money(b.BookingAmount)} />
            </Section>
          ) : null}

          {/* Welcome call and agreement */}
          {bookingQ.data ? (
            <Section title="Welcome Call & Agreement">
              {bookingQ.data.welcomeCalls?.[0] ? (
                <Kv label="Welcome call" value={joinDot(bookingQ.data.welcomeCalls[0].Outcome, fmtDate(bookingQ.data.welcomeCalls[0].CallDate))} />
              ) : <Kv label="Welcome call" value="Not done yet" />}
              {bookingQ.data.agreement ? (
                <>
                  <Kv label="Agreement" value={joinDot(bookingQ.data.agreement.AgreementNo, bookingQ.data.agreement.Status)} />
                  <Kv label="Agreement date" value={fmtDate(bookingQ.data.agreement.AgreementDate)} />
                </>
              ) : <Kv label="Agreement" value="Not drafted yet" />}
            </Section>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}
