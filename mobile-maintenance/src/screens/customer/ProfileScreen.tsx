// Profile — premium redesign. Same logic as before.
import { Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Building2, CalendarClock, History, Settings, UserRound } from "lucide-react-native";
import { useBrand } from "@/theme/ThemeContext";
import { fonts } from "@/theme/fonts";
import { useAuth } from "@/auth/AuthContext";
import { portal, moneyView } from "@/api/customerPortalApi";
import { useCustomer } from "@/customer/CustomerContext";
import { useNavigation } from "@react-navigation/native";
import { Bar, Button, ErrorText, Loading, MenuGroup, Muted, Page, Panel, Row, Section, StatRow, fmtDate, money, AccentAvatar } from "@/customer/ui";
import { openCustomerScreen } from "@/navigation/navigationRef";

export default function CustomerProfileScreen() {
  const brand = useBrand();
  const { me, app, appId, setAppId, homes, past, timeline, money: statement } = useCustomer();
  const navigation = useNavigation();
  const tickets  = useQuery({ queryKey: ["portal-tickets", appId], queryFn: () => portal.tickets(appId as number), enabled: appId != null });
  const m = me.data;
  const t = timeline.data;

  // The same figures as Home and Payments (moneyView over the money statement).
  const st = statement.data;
  const { total: totalDue, paid: totalPaid, pct } = moneyView(st);
  const openTickets = (tickets.data || []).filter((x) => x.Status !== "Resolved" && x.Status !== "Closed").length;

  const keyDates = [
    { label: "Booking Date",    value: t?.booking?.BookingDate },
    { label: "Welcome Call",    value: t?.welcomeCall?.CallDate },
    { label: "Agreement Sent",  value: t?.agreement?.SentToCustomerAt },
    { label: "Agreement Date",  value: t?.agreement?.AgreementDate },
    { label: "Sales Deed",      value: t?.salesDeed?.DeedDate },
    { label: "Handover",        value: t?.handover?.ActualHandoverDate },
  ];

  const initials = (name?: string) =>
    (name ?? "?").split(" ").filter(Boolean).map((n) => n[0]).join("").toUpperCase().slice(0, 2);

  return (
    <Page onRefresh={() => Promise.all([me.refetch(), timeline.refetch(), statement.refetch(), tickets.refetch()])}>

      {/* Avatar hero */}
      <View style={{ alignItems: "center", paddingVertical: 24, gap: 10 }}>
        <View style={{ borderRadius: 40, shadowColor: brand.gold, shadowOpacity: 0.4, shadowRadius: 16, elevation: 8 }}>
          <AccentAvatar text={initials(m?.Name)} size={80} />
        </View>
        <Text style={{ fontSize: 20, fontFamily: fonts.heading.semibold, color: brand.textPrimary }}>{m?.Name || "—"}</Text>
        {m?.CustomerNo ? <Text style={{ fontSize: 12, fontFamily: fonts.body.regular, color: brand.textSecondary }}>Customer #{m.CustomerNo}</Text> : null}
        {t?.booking ? (
          <View style={{ flexDirection: "row", gap: 16, marginTop: 4 }}>
            <StatRow items={[
              { label: "Paid", value: `${pct}%`, gold: true },
              { label: "Open requests", value: String(openTickets), sub: openTickets > 0 ? "Need attention" : "All clear" },
            ]} />
          </View>
        ) : null}
      </View>

      {/* Payment progress */}
      {t?.booking && !st?.booking?.Closed ? (
        <Panel title="Payment Progress">
          <Bar pct={pct} />
          <Text style={{ fontSize: 12, fontFamily: fonts.body.regular, color: brand.textSecondary }}>
            {money(totalPaid)} paid of {money(totalDue)} total
          </Text>
        </Panel>
      ) : null}

      {/* My details */}
      <Panel title="My Details" icon={UserRound}>
        {me.isLoading ? <Loading /> : me.error ? <ErrorText error={me.error} /> : (
          <>
            <Row label="Name"   value={m?.Name   || "—"} />
            <Row label="Mobile" value={m?.Mobile || "—"} />
            <Row label="Email"  value={m?.Email  || "—"} />
            {app?.InterestedProject ? <Row label="Interested Project" value={app.InterestedProject} /> : null}
            {m?.Address ? <Row label="Address" value={[m.Address, m.City, m.State].filter(Boolean).join(", ")} /> : null}
            <Muted>To change these details, please contact the sales office.</Muted>
          </>
        )}
      </Panel>

      {/* Key dates */}
      {t?.booking ? (
        <Panel title="Key Dates" icon={CalendarClock}>
          {keyDates.map((d) => <Row key={d.label} label={d.label} value={d.value ? fmtDate(d.value) : "—"} />)}
        </Panel>
      ) : null}

      {/* Every property on this account: live homes (open on Home), then past ones (read-only — their payments and papers) */}
      {homes.length > 1 || past.length ? (
        <Section title="My properties">
          <MenuGroup items={homes.map((a) => ({
            key: `h${a.ApplicationId}`, icon: Building2,
            label: a.UnitNo || a.ApplicationNo,
            sub: [a.ProjectName || a.InterestedProject, a.Lifecycle === "InProgress" ? a.StateLabel : a.ApplicationId === appId ? "Showing now" : null].filter(Boolean).join(" · "),
            onPress: () => { setAppId(a.ApplicationId); openCustomerScreen("CustomerHome", undefined, navigation.navigate as never); },
          }))} />
        </Section>
      ) : null}
      {past.length ? (
        <Section title="Past properties">
          <Muted>Cancelled, sold or moved. You can still open their payments, receipts and papers.</Muted>
          <MenuGroup items={past.map((a) => ({
            key: `p${a.ApplicationId}`, icon: History, tint: brand.textSecondary,
            label: a.UnitNo || a.ApplicationNo,
            sub: [a.StateLabel, a.ProjectName || a.InterestedProject].filter(Boolean).join(" · "),
            onPress: () => { setAppId(a.ApplicationId); openCustomerScreen("CustomerPayments", undefined, navigation.navigate as never); },
          }))} />
        </Section>
      ) : null}

      {/* Settings — opens Settings screen (theme switcher, password, sign out) */}
      <Button
        label="Settings & Theme"
        kind="line"
        icon={Settings}
        onPress={() => navigation.navigate("CustomerSettings" as never)}
      />
    </Page>
  );
}