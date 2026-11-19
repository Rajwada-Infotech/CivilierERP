// My bookings — every booking the customer has (one per application, always), grouped Current / Being prepared /
// Past. Each card shows its key facts; tap one to open it, section by section:
//   Money      — paid of total, still to pay, the next instalment (the money statement: the same figures as Payments);
//   Project    — the project: type, developer, address, a map (server-built, same as the web portal);
//   Your home  — what was bought (server-built facts, same as the web portal), every plot on a plot sale;
//   Price      — what the price is made of, the token and the booking amount;
//   Getting started — booking confirmed, welcome call, details on file, each done or what happens next;
//   then shortcuts to that property's Payments, Documents and Construction.
// The one open first is the property chosen elsewhere in the app. Customer-wide, so the header has no property picker.
import { useState, type ReactNode } from "react";
import { Linking, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";
import {
  Building2, CheckCircle2, ChevronDown, ChevronUp, Circle, CreditCard, FileText, HardHat, Landmark, ListChecks,
  Map as MapIcon, MapPin, Ruler, Users, Wallet, type LucideIcon,
} from "lucide-react-native";
import { moneyView, portal, type MoneyStatement, type PortalApplication, type Timeline } from "@/api/customerPortalApi";
import { useCustomer } from "@/customer/CustomerContext";
import { ActionBanner, Bar, Button, Divider, ErrorText, Loading, Muted, Page, Panel, Pill, Row, Section, Tap, displayName, fmtDate, money, useCardStyle } from "@/customer/ui";
import { useBrand } from "@/theme/ThemeContext";
import { fonts } from "@/theme/fonts";

type GroupKey = "current" | "preparing" | "past" | "notAhead";
const GROUPS: { key: GroupKey; title: string; note: string; folded?: boolean }[] = [
  { key: "current", title: "Current", note: "" },
  { key: "preparing", title: "Being prepared", note: "Our sales team is still preparing these. They become bookings once confirmed." },
  { key: "past", title: "Past bookings", note: "Cancelled, sold or moved. Their payments and papers are kept here for you." },
  { key: "notAhead", title: "Applications that didn't go ahead", note: "These never became bookings. Kept here for your records.", folded: true },
];
/** Which group a property sits in: by its state (server: propertyState), and whether it ever became a booking. */
const groupOf = (a: PortalApplication): GroupKey =>
  a.Lifecycle === "Home" ? "current" : a.Lifecycle === "InProgress" ? "preparing" : a.BookingId ? "past" : "notAhead";

/** A titled section inside an open booking. */
function Block({ icon: Icon, title, right, children }: { icon: LucideIcon; title: string; right?: ReactNode; children: ReactNode }) {
  const brand = useBrand();
  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View style={{ width: 26, height: 26, borderRadius: 8, backgroundColor: brand.goldSoft, alignItems: "center", justifyContent: "center" }}>
          <Icon size={14} color={brand.gold} />
        </View>
        <Text style={{ flex: 1, fontSize: 14.5, fontFamily: fonts.heading.semibold, color: brand.textPrimary }}>{title}</Text>
        {right}
      </View>
      {children}
    </View>
  );
}

/** One step of getting started: done (with when), or what happens next. */
function Step({ done, title, sub }: { done: boolean; title: string; sub?: string | null }) {
  const brand = useBrand();
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
      {done ? <CheckCircle2 size={18} color={brand.success} style={{ marginTop: 1 }} /> : <Circle size={18} color={brand.textFaint} style={{ marginTop: 1 }} />}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontSize: 14, fontFamily: fonts.body.medium, color: done ? brand.textPrimary : brand.textSecondary }}>{title}</Text>
        {sub ? <Text style={{ fontSize: 12.5, lineHeight: 18, fontFamily: fonts.body.regular, color: brand.textSecondary }}>{sub}</Text> : null}
      </View>
    </View>
  );
}

/** One booking, opened: its money, home, price, first steps and shortcuts. Same queries as the rest of the app (shared cache). */
function BookingDetails({ a }: { a: PortalApplication }) {
  const brand = useBrand();
  const nav = useNavigation();
  const { appId, setAppId } = useCustomer();
  const appIdHere = a.ApplicationId;
  const timeline = useQuery({ queryKey: ["portal-timeline", appIdHere], queryFn: () => portal.timeline(appIdHere) });
  const statement = useQuery({ queryKey: ["portal-money", appIdHere], queryFn: () => portal.money(appIdHere), enabled: !!a.BookingId });
  const t = timeline.data;
  /** Open one of this property's pages (switching the app to it first if another is chosen). */
  const go = (route: string) => { if (appId !== appIdHere) setAppId(appIdHere); nav.navigate(route as never); };

  if (timeline.isLoading) return <Loading />;
  if (timeline.error) return <ErrorText error={timeline.error} />;
  const b = t?.booking;

  if (!b) {
    // Before the booking: what we hold for the customer (a unit, a parking slot) and until when, then what happens next.
    const holds = t?.holds || [];
    return (
      <View style={{ gap: 12 }}>
        {holds.map((h) => (
          <ActionBanner key={h.Id} tone="gold"
            title={`${h.EntityType === "Parking" ? `Parking slot ${h.SlotNo || ""}` : `Unit ${h.UnitName || ""}`.trim()} is held for you`}
            sub={`Until ${fmtDate(h.HoldUntil)}. Complete your booking before then to keep it.`} />
        ))}
        <Row label="Application no." value={a.ApplicationNo} />
        {a.InterestedProject ? <Row label="Project" value={displayName(a.InterestedProject)} /> : null}
        <Muted>Once our sales team confirms your unit, this becomes a booking and its price, payments and papers appear here.</Muted>
      </View>
    );
  }

  const past = a.Lifecycle === "Past";
  return (
    <View style={{ gap: 18 }}>
      {statement.isLoading ? <Loading /> : statement.data?.booking ? <MoneyBlock s={statement.data} onOpen={() => go("CustomerPayments")} /> : null}

      <ProjectBlock t={t} />

      <HomeBlock t={t} />

      <Divider />
      <Block icon={Landmark} title="Price and GST breakdown">
        {/* The same price lines as Payments — they add up to the total (GST, parking, extras, credit notes) */}
        {statement.data?.price.lines.length
          ? statement.data.price.lines.map((l, i) => (
            <View key={`${l.key}-${i}`} style={{ gap: 8 }}>
              <Row label={l.title} sub={l.note} value={money(l.amount)} tone={l.amount < 0 ? brand.success : undefined} />
              {(l.parts || []).map((p) => <Row key={p.title} indent label={p.title} sub={p.note} value={money(p.amount)} />)}
            </View>
          ))
          : <Row label={b.IsPlotSale ? "Plot price" : "Home price"} value={money(b.TotalValue)} />}
        <Divider />
        <Row label="Total price" value={money(statement.data?.price.total ?? b.GrandTotal)} strong />
        {statement.data ? <Row label="GST in this price" value={money(statement.data.price.gstIncluded)} /> : null}
        {Number(b.TokenValue) > 0 || Number(b.BookingAmount) > 0 ? <Divider /> : null}
        {Number(b.TokenValue) > 0 ? <Row label="Token paid at booking" value={b.TokenType === "Amount" ? money(b.TokenValue) : `${b.TokenValue}% of the price`} /> : null}
        {Number(b.BookingAmount) > 0 ? <Row label="Booking amount" value={money(b.BookingAmount)} /> : null}
      </Block>

      {past ? null : (
        <>
          <Divider />
          <StartBlock a={a} t={t} />
        </>
      )}

      <Divider />
      <View style={{ gap: 8 }}>
        <Button label="Payments and receipts" kind="line" icon={CreditCard} onPress={() => go("CustomerPayments")} />
        <Button label="Agreement and papers" kind="line" icon={FileText} onPress={() => go("CustomerDocuments")} />
        {past ? null : <Button label="Construction progress" kind="line" icon={HardHat} onPress={() => go("CustomerConstruction")} />}
      </View>
    </View>
  );
}

/** Paid of total, still to pay and the next instalment — or, for a booking that ended, what was paid and where it went. */
function MoneyBlock({ s, onOpen }: { s: MoneyStatement; onOpen: () => void }) {
  const brand = useBrand();
  const { totals, plan } = s;
  const v = moneyView(s);
  if (v.closed) {
    return (
      <Block icon={Wallet} title="Your money">
        <Row label="You paid in total" value={money(totals.received)} strong />
        {totals.refunded > 0 ? <Row label="Refunded to you" value={money(totals.refunded)} tone={brand.success} /> : null}
        {totals.movedOut > 0 ? <Row label="Moved on (e.g. to a new unit)" value={money(totals.movedOut)} /> : null}
        <Row label="Still held with us" value={money(totals.held)} />
        <Tap onPress={onOpen} style={{ alignSelf: "flex-start", paddingVertical: 2 }}>
          <Text style={{ fontSize: 13.5, fontFamily: fonts.heading.semibold, color: brand.gold }}>See every payment ›</Text>
        </Tap>
      </Block>
    );
  }
  return (
    <Block icon={Wallet} title="Your money" right={<Text style={{ fontSize: 13, fontFamily: fonts.heading.semibold, color: brand.gold }}>{v.pct}% paid</Text>}>
      <Bar pct={v.pct} />
      <Row label="Payment plan" value={money(plan.total)} />
      <Row label="Paid so far" value={money(v.paid)} tone={brand.success} />
      <Row label="Still to pay" value={money(v.balance)} strong />
      {v.next ? (
        <Row label={`Next: ${v.next.name}${v.next.dueDate ? ` · due ${fmtDate(v.next.dueDate)}` : ""}`} value={money(v.nextAmount)} tone={brand.gold} />
      ) : v.balance <= 0 ? <Muted>Fully paid. Thank you!</Muted> : null}
      {v.verifying > 0 ? <Muted>{money(v.verifying)} more is being verified and will count once confirmed.</Muted> : null}
      {v.overPrice > 0 ? <Muted>You have paid {money(v.overPrice)} more than your price. Please contact us about it.</Muted> : null}
      <Tap onPress={onOpen} style={{ alignSelf: "flex-start", paddingVertical: 2 }}>
        <Text style={{ fontSize: 13.5, fontFamily: fonts.heading.semibold, color: brand.gold }}>See instalments and payments ›</Text>
      </Tap>
    </Block>
  );
}

/** The project: its facts (server-built, same as the web portal), what it is, and where it is on a map. */
function ProjectBlock({ t }: { t: Timeline | undefined }) {
  const p = t?.project;
  if (!p || (!p.facts.length && !p.description)) return null;
  const mapUrl = p.location
    ? `https://www.google.com/maps/search/?api=1&query=${p.location.lat},${p.location.lng}`
    : p.mapQuery ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.mapQuery)}` : null;
  return (
    <>
      <Divider />
      <Block icon={Building2} title="Project">
        {p.facts.map((f) => <Row key={f.label} label={f.label} value={f.value} />)}
        {p.description ? <Muted>{p.description}</Muted> : null}
        {mapUrl ? <Button label="Open in Maps" kind="line" icon={MapPin} onPress={() => { Linking.openURL(mapUrl).catch(() => undefined); }} /> : null}
      </Block>
    </>
  );
}

/** What was bought: the home's facts and every plot (server-built, same as the web portal). */
function HomeBlock({ t }: { t: Timeline | undefined }) {
  if (!t?.homeFacts?.length && !t?.plots?.length) return null;
  return (
    <>
      <Divider />
      {t?.homeFacts?.length ? (
        <Block icon={Ruler} title="Your home">
          {t.homeFacts.map((f) => <Row key={f.label} label={f.label} value={f.value} />)}
        </Block>
      ) : null}
      {t?.plots?.length ? (
        <Block icon={MapIcon} title={t.plots.length > 1 ? `Your plots (${t.plots.length})` : "Your plot"}>
          {t.plots.map((p, i) => (
            <View key={`${p.PlotNo}-${i}`} style={{ gap: 6 }}>
              {i ? <Divider /> : null}
              <Row label="Plot" value={p.PlotName || p.PlotNo || "—"} strong />
              {p.facts.map((f) => <Row key={f.label} label={f.label} value={f.value} />)}
            </View>
          ))}
        </Block>
      ) : null}
    </>
  );
}

/** The first steps after booking: each done (and when), or what happens next. */
function StartBlock({ a, t }: { a: PortalApplication; t: Timeline | undefined }) {
  const call = t?.welcomeCall;
  const callDone = call?.Outcome === "Welcomed";
  const detailsDone = !!t?.customerDetails?.IsComplete;
  const done = 1 + (callDone ? 1 : 0) + (detailsDone ? 1 : 0);
  const brand = useBrand();
  return (
    <Block icon={ListChecks} title="Getting started" right={<Text style={{ fontSize: 13, fontFamily: fonts.body.medium, color: brand.textSecondary }}>{done} of 3 done</Text>}>
      <Step done title="Booking confirmed" sub={a.BookingDate ? `On ${fmtDate(a.BookingDate)}` : null} />
      <Step done={callDone} title="Welcome call"
        sub={callDone ? (call?.CallDate ? `Done on ${fmtDate(call.CallDate)}` : "Done")
          : call ? `${call.Outcome || "Arranged"}${call.CallDate ? ` · ${fmtDate(call.CallDate)}` : ""}. Our team will complete it with you.`
          : "Our team will call you shortly to welcome you and walk you through what happens next."} />
      <Step done={detailsDone} title="Your details on file"
        sub={detailsDone ? "Complete. Thank you." : "Our sales team collects your bank account, PAN and Aadhaar before the agreement is prepared. Please keep them ready."} />
    </Block>
  );
}

export default function CustomerBookingScreen() {
  const brand = useBrand();
  const card = useCardStyle();
  const { apps, appId } = useCustomer();
  const [openId, setOpenId] = useState<number | null>(appId);
  const [unfolded, setUnfolded] = useState<GroupKey[]>([]);

  if (apps.isLoading) return <Page><Loading /></Page>;
  if (apps.error) return <Page><ErrorText error={apps.error} /></Page>;
  const list = apps.data || [];
  const booked = list.filter((a) => a.BookingId).length;
  if (!list.length) return <Page><Panel><Muted>You don't have a booking yet. Once your home is confirmed, it'll show up here.</Muted></Panel></Page>;
  const countOf = (k: GroupKey) => list.filter((a) => groupOf(a) === k).length;
  const summary = [
    countOf("current") ? `${countOf("current")} current` : null,
    countOf("preparing") ? `${countOf("preparing")} being prepared` : null,
    countOf("past") ? `${countOf("past")} past` : null,
  ].filter(Boolean).join(" · ");

  return (
    <Page onRefresh={() => apps.refetch()}>
      <View style={{ gap: 4, paddingHorizontal: 4 }}>
        <Text style={{ fontSize: 15, fontFamily: fonts.body.medium, color: brand.textPrimary }}>
          {booked <= 1 ? "Everything about your booking, in one place." : `All your ${booked} bookings, in one place.`}
        </Text>
        <Text style={{ fontSize: 13, fontFamily: fonts.body.regular, color: brand.textSecondary }}>
          {booked > 1 || countOf("preparing") ? `${summary}. Tap one to open it.` : "Tap it to see your money, the project, your home and your first steps."}
        </Text>
      </View>

      {GROUPS.map((g) => {
        const rows = list.filter((a) => groupOf(a) === g.key);
        if (!rows.length) return null;
        const folded = g.folded && !unfolded.includes(g.key);
        return (
          <Section key={g.key} title={`${g.title} (${rows.length})`}
            right={g.folded ? (
              <Tap onPress={() => setUnfolded((u) => (u.includes(g.key) ? u.filter((k) => k !== g.key) : [...u, g.key]))} hitSlop={8}>
                <Text style={{ fontSize: 13.5, fontFamily: fonts.heading.semibold, color: brand.gold }}>{folded ? "Show" : "Hide"}</Text>
              </Tap>
            ) : undefined}>
            {g.note && list.length > 1 ? <Muted>{g.note}</Muted> : null}
            {folded ? null : rows.map((a) => {
              const open = openId === a.ApplicationId;
              const named = displayName(a.ProjectName || a.InterestedProject);
              const project = named || (a.BookingId ? "Your home" : `Application ${a.ApplicationNo}`);
              const codeLine = a.BookingNo
                ? [a.UnitNo, `Booking ${a.BookingNo}`].filter(Boolean).join(" · ")
                : named ? `Application ${a.ApplicationNo}` : "Project not chosen yet";
              const withNames = a.CoApplicantNames ? a.CoApplicantNames.split("|").map(displayName).filter(Boolean).join(", ") : "";
              return (
                <View key={a.ApplicationId} style={{ ...card, opacity: a.Lifecycle === "Past" && !open ? 0.8 : 1 }}>
                  <Tap onPress={() => setOpenId(open ? null : a.ApplicationId)} accessibilityRole="button" accessibilityState={{ expanded: open }}
                    accessibilityLabel={`${project}, ${codeLine}`}
                    style={({ pressed }) => ({ padding: 16, gap: 14, opacity: pressed ? 0.7 : 1 })}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                      <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: brand.goldSoft, alignItems: "center", justifyContent: "center" }}>
                        <Building2 size={21} color={brand.gold} />
                      </View>
                      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                        <Text numberOfLines={1} style={{ fontSize: 16.5, fontFamily: fonts.heading.semibold, color: brand.textPrimary }}>{project}</Text>
                        <Text numberOfLines={2} style={{ fontSize: 13, fontFamily: fonts.body.regular, color: brand.textSecondary }}>{codeLine}</Text>
                      </View>
                      {open ? <ChevronUp size={18} color={brand.textFaint} /> : <ChevronDown size={18} color={brand.textFaint} />}
                    </View>
                    {/* Who it's for and where it stands */}
                    {a.IsCoApplicant || a.StateLabel ? (
                      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                        {a.StateLabel ? <Pill label={a.StateLabel} /> : null}
                        {a.IsCoApplicant ? <Pill label="You're a joint applicant" /> : null}
                      </View>
                    ) : null}
                    {a.BookingNo ? (
                      <View style={{ flexDirection: "row", gap: 10 }}>
                        <View style={{ flex: 1, gap: 2 }}>
                          <Text style={{ fontSize: 12, fontFamily: fonts.body.medium, color: brand.textSecondary }}>Total price</Text>
                          <Text style={{ fontSize: 15.5, fontFamily: fonts.heading.semibold, color: brand.textPrimary, fontVariant: ["tabular-nums"] }}>{money(a.GrandTotal)}</Text>
                        </View>
                        <View style={{ flex: 1, gap: 2 }}>
                          <Text style={{ fontSize: 12, fontFamily: fonts.body.medium, color: brand.textSecondary }}>Booked on</Text>
                          <Text style={{ fontSize: 15.5, fontFamily: fonts.heading.semibold, color: brand.textPrimary }}>{fmtDate(a.BookingDate)}</Text>
                        </View>
                      </View>
                    ) : null}
                    {withNames ? (
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                        <Users size={14} color={brand.textSecondary} />
                        <Text style={{ flex: 1, fontSize: 13, fontFamily: fonts.body.regular, color: brand.textSecondary }}>With {withNames}</Text>
                      </View>
                    ) : null}
                  </Tap>
                  {open ? (
                    <View style={{ paddingHorizontal: 16, paddingBottom: 16, gap: 14 }}>
                      <Divider />
                      <BookingDetails a={a} />
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
