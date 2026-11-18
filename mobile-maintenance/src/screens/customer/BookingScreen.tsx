// My bookings — every booking the customer has (one per application, always), grouped Current / Being prepared /
// Past, each with its key facts; tap one to open its full details (token, welcome call, details on file, charges).
// The one open first is the property chosen elsewhere in the app. Customer-wide, so the header has no property picker.
import { useState } from "react";
import { Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Building2, CheckCircle2, ChevronDown, ChevronUp, Landmark, Phone, User } from "lucide-react-native";
import { portal, type PortalApplication } from "@/api/customerPortalApi";
import { useCustomer } from "@/customer/CustomerContext";
import { ActionBanner, Divider, ErrorText, Loading, Muted, Page, Panel, Pill, Row, Section, Tap, displayName, fmtDate, money, useCardStyle } from "@/customer/ui";
import { useBrand } from "@/theme/ThemeContext";
import { fonts } from "@/theme/fonts";

const GROUPS: { key: PortalApplication["Lifecycle"]; title: string }[] = [
  { key: "Home", title: "Current" },
  { key: "InProgress", title: "Being prepared" },
  { key: "Past", title: "Past" },
];

/** One booking's full details — the timeline the rest of the app reads (same query, so it is shared and cached). */
function BookingDetails({ appId }: { appId: number }) {
  const brand = useBrand();
  const timeline = useQuery({ queryKey: ["portal-timeline", appId], queryFn: () => portal.timeline(appId) });
  const t = timeline.data;
  if (timeline.isLoading) return <Loading />;
  if (timeline.error) return <ErrorText error={timeline.error} />;
  const b = t?.booking;
  if (!b) return <Muted>Your booking is being prepared. Its details will appear here once it is confirmed.</Muted>;
  const callDone = t?.welcomeCall?.Outcome === "Welcomed";
  const detailsDone = !!t?.customerDetails?.IsComplete;
  return (
    <View style={{ gap: 14 }}>
      {!t?.welcomeCall ? <ActionBanner title="Welcome call pending" sub="Our team will reach out to you shortly for your welcome call." tone="gold" /> : null}
      <Row label="Token" value={b.TokenType === "Amount" ? money(b.TokenValue) : b.TokenValue != null ? `${b.TokenValue}%` : "—"} />
      <Row label="Booking amount" value={money(b.BookingAmount)} />
      <Divider />
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Phone size={15} color={brand.gold} />
        <Text style={{ fontSize: 14, fontFamily: fonts.heading.semibold, color: brand.textPrimary }}>Welcome call</Text>
      </View>
      {t?.welcomeCall ? (
        <Row label={t.welcomeCall.CallDate ? fmtDate(t.welcomeCall.CallDate) : "Status"} value={t.welcomeCall.Outcome || "Pending"} tone={callDone ? brand.success : undefined} />
      ) : <Muted>Not done yet.</Muted>}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <User size={15} color={brand.gold} />
        <Text style={{ flex: 1, fontSize: 14, fontFamily: fonts.heading.semibold, color: brand.textPrimary }}>Your details on file</Text>
        {detailsDone ? <CheckCircle2 size={16} color={brand.success} /> : null}
      </View>
      <Row label="Status" value={detailsDone ? "Completed. Thank you." : "Being completed by our team"} tone={detailsDone ? brand.success : undefined} />
      {!detailsDone ? <Muted>Bank account, PAN and Aadhaar details are collected by our sales team before the agreement is prepared. Please have them ready when they call.</Muted> : null}
      {Number(b.ParkingTotal) > 0 || Number(b.ExtraChargesTotal) > 0 ? (
        <>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Landmark size={15} color={brand.gold} />
            <Text style={{ fontSize: 14, fontFamily: fonts.heading.semibold, color: brand.textPrimary }}>Charges</Text>
          </View>
          <Row label={b.IsPlotSale ? "Land value" : "Unit value"} value={money(b.TotalValue)} />
          {Number(b.ParkingTotal) > 0 ? <Row label="Parking" value={money(b.ParkingTotal)} /> : null}
          {Number(b.ExtraChargesTotal) > 0 ? <Row label="Extra charges" value={money(b.ExtraChargesTotal)} /> : null}
          <Row label="Total price" value={money(b.GrandTotal)} strong />
        </>
      ) : null}
    </View>
  );
}

export default function CustomerBookingScreen() {
  const brand = useBrand();
  const card = useCardStyle();
  const { apps, appId } = useCustomer();
  const [openId, setOpenId] = useState<number | null>(appId);

  if (apps.isLoading) return <Page><Loading /></Page>;
  if (apps.error) return <Page><ErrorText error={apps.error} /></Page>;
  const list = apps.data || [];
  const booked = list.filter((a) => a.BookingId).length;
  if (!list.length) return <Page><Panel><Muted>You don't have a booking yet. Once your home is confirmed, it'll show up here.</Muted></Panel></Page>;

  return (
    <Page onRefresh={() => apps.refetch()}>
      <Muted>{booked <= 1 ? "Everything about your booking, in one place." : `All your ${booked} bookings, in one place. Tap one to see its details.`}</Muted>
      {GROUPS.map((g) => {
        const rows = list.filter((a) => a.Lifecycle === g.key);
        if (!rows.length) return null;
        return (
          <Section key={g.key} title={`${g.title} (${rows.length})`}>
            {rows.map((a) => {
              const open = openId === a.ApplicationId;
              const project = displayName(a.ProjectName || a.InterestedProject) || (a.BookingId ? "Your home" : "Application");
              return (
                <View key={a.ApplicationId} style={{ ...card, opacity: a.Lifecycle === "Past" && !open ? 0.75 : 1 }}>
                  <Tap onPress={() => setOpenId(open ? null : a.ApplicationId)} accessibilityRole="button" accessibilityState={{ expanded: open }}
                    style={({ pressed }) => ({ padding: 16, gap: 12, opacity: pressed ? 0.7 : 1 })}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                      <View style={{ width: 42, height: 42, borderRadius: 13, backgroundColor: brand.goldSoft, alignItems: "center", justifyContent: "center" }}>
                        <Building2 size={20} color={brand.gold} />
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text numberOfLines={1} style={{ fontSize: 16, fontFamily: fonts.heading.semibold, color: brand.textPrimary }}>{project}</Text>
                        <Text numberOfLines={1} style={{ fontSize: 13, fontFamily: fonts.body.regular, color: brand.textSecondary }}>
                          {a.UnitNo ? `Unit / plot ${a.UnitNo}` : `Application ${a.ApplicationNo}`}
                        </Text>
                      </View>
                      {a.IsCoApplicant ? <Pill label="Joint applicant" /> : a.StateLabel ? <Pill label={a.StateLabel} /> : null}
                      {open ? <ChevronUp size={18} color={brand.textFaint} /> : <ChevronDown size={18} color={brand.textFaint} />}
                    </View>
                    {a.BookingNo ? (
                      <View style={{ gap: 8 }}>
                        <Row label="Booking no." value={a.BookingNo} />
                        <Row label="Total price" value={money(a.GrandTotal)} />
                        <Row label="Booked on" value={fmtDate(a.BookingDate)} />
                        {a.CoApplicantNames ? <Row label="With" value={a.CoApplicantNames.split("|").map(displayName).join(", ")} /> : null}
                      </View>
                    ) : null}
                  </Tap>
                  {open ? (
                    <View style={{ paddingHorizontal: 16, paddingBottom: 16, gap: 14 }}>
                      <Divider />
                      <BookingDetails appId={a.ApplicationId} />
                    </View>
                  ) : null}
                </View>
              );
            })}
          </Section>
        );
      })}
    </Page>
  );
}
