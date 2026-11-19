// Customer Home. Built like a modern banking home: the one figure that matters is the biggest thing on screen (a
// wallet-style home card with a payment ring), the four things people do most sit under the thumb as quick actions,
// then the single next task, where the purchase stands, and a short grouped menu for the rest.
// One booking: its home card, then quick actions and the journey. Several bookings (current or past): a portfolio
// view — one figure across the current homes (paid, still to pay, the next payment due anywhere), then every booking
// as a slim row with its progress, grouped Current / Being prepared / Past; a row opens that home in My bookings.
// What needs the customer lives in the header's bell (TopHeader.tsx NotificationsMenu), not here.
import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Text, View, useWindowDimensions } from "react-native";
import { GradientText } from "@/components/GradientText";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQueries, useQuery } from "@tanstack/react-query";
import {
  ArrowUpRight, Building2, Check, CheckCircle2, ChevronRight, CreditCard, FileSignature, FileText, HardHat, LifeBuoy, Moon, Radio, Sun, Sunrise, type LucideIcon,
} from "lucide-react-native";
import { useBrand } from "@/theme/ThemeContext";
import { fonts } from "@/theme/fonts";
import { portal, type PortalApplication, type Timeline, moneyView } from "@/api/customerPortalApi";
import { useCustomer } from "@/customer/CustomerContext";
import {
  Bar, ErrorText, HeroSurface, Loading, Muted, displayName, ON_HERO, Page, Panel, Ring, Section, fmtDate, money, useCardStyle, Tap, ago } from "@/customer/ui";
import type { CustomerStackParamList } from "@/navigation/CustomerStack";
import { openCustomerScreen } from "@/navigation/navigationRef";

type Nav = NativeStackNavigationProp<CustomerStackParamList>;
type RouteName = keyof CustomerStackParamList;

const QUICK: { route: RouteName; label: string; icon: LucideIcon }[] = [
  { route: "CustomerPayments",     label: "Payments",  icon: CreditCard },
  { route: "CustomerDocuments",    label: "Documents", icon: FileText },
  { route: "CustomerConstruction", label: "Progress",  icon: HardHat },
  { route: "CustomerRequests",     label: "Help",      icon: LifeBuoy },
];

type StepState = "done" | "current" | "upcoming";
interface Step { label: string; hint: string; state: StepState }

/** The purchase journey in plain words. `hint` is the one-line answer to "what is this step?". */
function journey(t: Timeline): Step[] {
  const ms = t.paymentMilestones || [];
  const agreementApproved = t.agreement?.CustomerApprovalStatus === "Approved";
  const detailsDone       = !!t.customerDetails?.IsComplete;
  // Judged by money stage (Covered), not Status — paid money held On Account leaves Status "Pending" (crmPortal.js loadTimeline).
  const paymentsDone      = ms.length > 0 && ms.every((m) => m.Covered);
  const salesDeedDone     = !!t.salesDeed;
  const qpDone            = t.queryPayment?.Status === "Confirmed";
  const registryDone      = t.registry?.Status === "Completed";
  const raw: { label: string; hint: string; done: boolean }[] = [
    { label: "Booking confirmed", hint: "Your home is reserved in your name.",                 done: !!t.booking },
    { label: "Welcome call",      hint: "Our team calls to welcome you and answer questions.", done: !!t.welcomeCall },
    { label: "Your details",      hint: "We collect your PAN, Aadhaar and bank details.",      done: detailsDone },
    { label: "Agreement",         hint: "You read and approve the agreement for sale.",        done: agreementApproved },
    { label: "Payments",          hint: "You pay the instalments as they fall due.",           done: paymentsDone },
    { label: "Sale deed",         hint: "The final legal document for your home.",             done: salesDeedDone },
    { label: "Government fees",   hint: "Stamp duty and registration fees are paid.",          done: qpDone },
    { label: "Registration",      hint: "The home is registered in your name.",                done: registryDone },
    { label: "Key handover",      hint: "You receive the keys and move in.",                   done: !!t.handover },
  ];
  const cur = raw.findIndex((r) => !r.done);
  return raw.map((r, i) => ({ label: r.label, hint: r.hint, state: r.done ? "done" : i === cur ? "current" : "upcoming" }));
}

/** One live card in "At a glance": what it is, the current value, one line of context, and a tap target. */
function GlanceTile({ icon: Icon, label, value, sub, subTone, dot, wide, onPress }: {
  icon: LucideIcon; label: string; value: string; sub: string; subTone?: string; dot?: boolean; wide?: boolean; onPress: () => void;
}) {
  const b = useBrand();
  const card = useCardStyle();
  const icon = (
    <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: b.goldSoft, alignItems: "center", justifyContent: "center" }}>
      <Icon size={19} color={b.gold} />
    </View>
  );
  if (wide)
    return (
      <Tap onPress={onPress} accessibilityRole="button" accessibilityLabel={`${label}: ${value}`}
        style={({ pressed }) => ({ ...card, padding: 16, flexDirection: "row", alignItems: "center", gap: 14, opacity: pressed ? 0.85 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
        {icon}
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ fontSize: 12.5, fontFamily: fonts.body.medium, color: b.textSecondary }}>{label}</Text>
          <Text numberOfLines={1} style={{ fontSize: 15.5, letterSpacing: -0.2, fontFamily: fonts.heading.semibold, color: b.textPrimary }}>{value}</Text>
          <Text numberOfLines={1} style={{ fontSize: 12.5, fontFamily: subTone ? fonts.heading.semibold : fonts.body.regular, color: subTone || b.textSecondary }}>{sub}</Text>
        </View>
        <ArrowUpRight size={17} color={b.textFaint} />
      </Tap>
    );
  return (
    <Tap onPress={onPress} accessibilityRole="button" accessibilityLabel={`${label}: ${value}`}
      style={({ pressed }) => ({ ...card, flex: 1, padding: 16, gap: 12,
        opacity: pressed ? 0.85 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        {icon}
        <View style={{ flex: 1 }} />
        {dot ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: b.gold }} /> : null}
        <ArrowUpRight size={17} color={b.textFaint} />
      </View>
      <View style={{ gap: 3 }}>
        <Text style={{ fontSize: 12.5, fontFamily: fonts.body.medium, color: b.textSecondary }}>{label}</Text>
        <Text numberOfLines={2} style={{ fontSize: 15.5, lineHeight: 20, letterSpacing: -0.2, fontFamily: fonts.heading.semibold, color: b.textPrimary }}>{value}</Text>
        <Text numberOfLines={1} style={{ fontSize: 12.5, fontFamily: subTone ? fonts.heading.semibold : fonts.body.regular, color: subTone || b.textSecondary }}>{sub}</Text>
      </View>
    </Tap>
  );
}

/** The time of day, in words and as an icon. */
function greeting(): { text: string; icon: LucideIcon } {
  const h = new Date().getHours();
  return h < 12 ? { text: "Good morning", icon: Sunrise } : h < 17 ? { text: "Good afternoon", icon: Sun } : { text: "Good evening", icon: Moon };
}

/** The greeting — type only, no boxes: the time of day and today's date as one accent line, the customer's name
 * large in the accent gradient (the same one as the buttons and avatar), and a live line on where this home stands. */
function Greeting({ name, where }: { name: string; where: string | null }) {
  const brand = useBrand();
  const g = greeting();
  const today = new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });
  // The status dot breathes gently, so the line reads as live.
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 1100, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 900, easing: Easing.in(Easing.quad), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  const nameStyle = { fontSize: 40, lineHeight: 46, fontFamily: fonts.heading.semibold, letterSpacing: -1.4 } as const;
  return (
    <View style={{ gap: 6, paddingHorizontal: 4, paddingTop: 4, paddingBottom: 2 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
        <g.icon size={14} color={brand.gold} />
        <Text style={{ fontSize: 12, fontFamily: fonts.heading.semibold, letterSpacing: 1.6, textTransform: "uppercase", color: brand.gold }}>{g.text}</Text>
        <Text style={{ fontSize: 12, fontFamily: fonts.body.medium, letterSpacing: 0.4, color: brand.textFaint }}>·  {today}</Text>
      </View>
      <GradientText style={nameStyle} colors={[...brand.accentGradient]}>{name}</GradientText>
      {where ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <View style={{ width: 10, height: 10, alignItems: "center", justifyContent: "center" }}>
            <Animated.View style={{ position: "absolute", width: 10, height: 10, borderRadius: 5, backgroundColor: brand.gold,
              opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0] }), transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 2.2] }) }] }} />
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: brand.gold }} />
          </View>
          <Text numberOfLines={1} style={{ flex: 1, fontSize: 15, fontFamily: fonts.body.medium, color: brand.textSecondary }}>{where}</Text>
        </View>
      ) : null}
    </View>
  );
}

/** Every booking, in order: current homes, then being prepared, then past bookings. Applications that never
 * became a booking and ended are left out (they are in My bookings → Applications that didn't go ahead). */
function cardList(homes: PortalApplication[], past: PortalApplication[]) {
  const order = (a: PortalApplication) => (a.Lifecycle === "Home" ? 0 : 1);
  return [...[...homes].sort((a, b) => order(a) - order(b)), ...past.filter((a) => a.BookingId)];
}

/** One booking's card: what it is, where it stands, its money (the money statement — the same figures as Payments). */
function HomeCard({ a, width, onOpenPayments }: { a: PortalApplication; width: number; onOpenPayments: () => void }) {
  const brand = useBrand();
  const id = a.ApplicationId;
  const statement = useQuery({ queryKey: ["portal-money", id], queryFn: () => portal.money(id), enabled: !!a.BookingId });
  // Only a card without a booking needs the timeline (for what is held for the customer).
  const timeline = useQuery({ queryKey: ["portal-timeline", id], queryFn: () => portal.timeline(id), enabled: !a.BookingId });
  const v = moneyView(statement.data);
  const past = a.Lifecycle === "Past";
  const project = displayName(a.ProjectName || a.InterestedProject) || (a.BookingId ? "Your home" : "Your application");
  const kind = statement.data?.booking?.IsPlotSale ? "Plot" : "Unit";
  const line = a.BookingNo
    ? [a.UnitNo ? `${kind} ${a.UnitNo}` : null, `Booking ${a.BookingNo}`].filter(Boolean).join(" · ")
    : `Application ${a.ApplicationNo}`;
  const tag = a.IsCoApplicant ? "Joint applicant" : a.StateLabel;
  const t = timeline.data;
  return (
    <View style={{ width }}>
      <HeroSurface>
        <View style={{ gap: 18, minHeight: 236 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <View style={{ width: 40, height: 40, borderRadius: 13, backgroundColor: ON_HERO.glass, alignItems: "center", justifyContent: "center" }}>
              <Building2 size={20} color={ON_HERO.primary} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ fontSize: 16, fontFamily: fonts.heading.semibold, color: ON_HERO.primary }}>{project}</Text>
              <Text numberOfLines={2} style={{ fontSize: 13, fontFamily: fonts.body.regular, color: ON_HERO.secondary }}>{line}</Text>
            </View>
            {tag ? (
              <View style={{ borderRadius: 100, paddingHorizontal: 11, paddingVertical: 5, backgroundColor: ON_HERO.glass }}>
                <Text style={{ fontSize: 12, fontFamily: fonts.heading.semibold, color: ON_HERO.primary }}>{tag}</Text>
              </View>
            ) : null}
          </View>

          {a.BookingId ? (
            statement.isLoading ? <View style={{ height: 108 }} /> : (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 18 }}>
                {v.closed ? null : (
                  <Ring pct={v.pct} size={104} stroke={10} track={ON_HERO.glass}>
                    <Text style={{ fontSize: 23, fontFamily: fonts.heading.semibold, color: ON_HERO.primary, letterSpacing: -0.5 }}>{v.pct}%</Text>
                    <Text style={{ fontSize: 11.5, fontFamily: fonts.body.medium, color: ON_HERO.secondary }}>paid</Text>
                  </Ring>
                )}
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ fontSize: 13, fontFamily: fonts.body.medium, color: ON_HERO.secondary }}>{v.closed ? "You paid in total" : "You have paid"}</Text>
                  <Text adjustsFontSizeToFit numberOfLines={1} style={{ fontSize: 26, fontFamily: fonts.heading.semibold, letterSpacing: -0.6, color: ON_HERO.primary, fontVariant: ["tabular-nums"] }}>{money(v.paid)}</Text>
                  <Text style={{ fontSize: 13, fontFamily: fonts.body.regular, color: ON_HERO.secondary }}>
                    {v.closed
                      ? [statement.data && statement.data.totals.refunded > 0 ? `${money(statement.data.totals.refunded)} refunded` : null,
                        statement.data && statement.data.totals.movedOut > 0 ? `${money(statement.data.totals.movedOut)} moved on` : null,
                        statement.data && statement.data.totals.held > 0 ? `${money(statement.data.totals.held)} still held` : null].filter(Boolean).join(" · ") || "Nothing of yours is left on it"
                      : v.balance > 0 ? `of ${money(v.total)} · ${money(v.balance)} to go` : `of ${money(v.total)}`}
                  </Text>
                  {v.verifying > 0 && !v.closed ? (
                    <Text style={{ fontSize: 12.5, fontFamily: fonts.body.medium, color: brand.gold }}>+ {money(v.verifying)} being verified</Text>
                  ) : null}
                </View>
              </View>
            )
          ) : (
            <View style={{ gap: 10 }}>
              <Text style={{ fontSize: 14.5, lineHeight: 21, fontFamily: fonts.body.regular, color: ON_HERO.secondary }}>
                Your booking details and payments will appear here once your home is confirmed.
              </Text>
              {(t?.holds || []).map((h) => (
                <View key={h.Id} style={{ borderRadius: 14, padding: 12, backgroundColor: ON_HERO.glass, gap: 2 }}>
                  <Text style={{ fontSize: 14, fontFamily: fonts.heading.semibold, color: ON_HERO.primary }}>
                    {h.EntityType === "Parking" ? `Parking slot ${h.SlotNo || ""}`.trim() : `Unit ${h.UnitName || ""}`.trim()} is held for you
                  </Text>
                  <Text style={{ fontSize: 12.5, fontFamily: fonts.body.regular, color: ON_HERO.secondary }}>Until {fmtDate(h.HoldUntil)} · complete your booking before then to keep it</Text>
                </View>
              ))}
            </View>
          )}

          {a.BookingId && !statement.isLoading ? (
            <Tap onPress={onOpenPayments}
              style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 16, padding: 14, backgroundColor: ON_HERO.glass, opacity: pressed ? 0.75 : 1, marginTop: "auto" })}>
              {past || v.closed ? (
                <Text style={{ flex: 1, fontSize: 14.5, fontFamily: fonts.heading.semibold, color: ON_HERO.primary }}>See where your money went</Text>
              ) : v.next ? (
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 12.5, fontFamily: fonts.body.medium, color: ON_HERO.secondary }}>Next payment{v.next.dueDate ? ` · due ${fmtDate(v.next.dueDate)}` : ""}</Text>
                  <Text style={{ fontSize: 16, fontFamily: fonts.heading.semibold, color: ON_HERO.primary, fontVariant: ["tabular-nums"] }}>
                    {money(v.nextAmount)} <Text style={{ fontSize: 13, fontFamily: fonts.body.regular, color: ON_HERO.secondary }}>· {v.next.name}</Text>
                  </Text>
                </View>
              ) : (
                <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <CheckCircle2 size={18} color={brand.gold} />
                  <Text style={{ fontSize: 14.5, fontFamily: fonts.heading.semibold, color: ON_HERO.primary }}>No payment due right now</Text>
                </View>
              )}
              <ChevronRight size={18} color={ON_HERO.secondary} />
            </Tap>
          ) : null}
        </View>
      </HeroSurface>
    </View>
  );
}

/** Several bookings: one figure across the current homes — paid, still to pay, the next payment due anywhere — on the
 * purple hero. Each home's figures are its own money statement (the same as Payments). */
function PortfolioHero({ live, onOpenPayments }: { live: PortalApplication[]; onOpenPayments: (id: number) => void }) {
  const brand = useBrand();
  const results = useQueries({ queries: live.map((a) => ({ queryKey: ["portal-money", a.ApplicationId], queryFn: () => portal.money(a.ApplicationId) })) });
  const ready = results.every((r) => !!r.data);
  const views = results.map((r, i) => ({ a: live[i], v: moneyView(r.data) }));
  const paid = views.reduce((n, x) => n + x.v.paid, 0);
  const total = views.reduce((n, x) => n + x.v.total, 0);
  const toGo = views.reduce((n, x) => n + x.v.balance, 0);
  const verifying = views.reduce((n, x) => n + x.v.verifying, 0);
  const pct = total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 0;
  const soonest = views.filter((x) => x.v.next)
    .sort((x, y) => new Date(x.v.next?.dueDate || "9999-12-31").getTime() - new Date(y.v.next?.dueDate || "9999-12-31").getTime())[0];
  return (
    <HeroSurface>
      <View style={{ gap: 18 }}>
        <Text style={{ fontSize: 12, fontFamily: fonts.heading.semibold, letterSpacing: 1.6, textTransform: "uppercase", color: ON_HERO.secondary }}>
          {live.length ? `Your portfolio · ${live.length} home${live.length > 1 ? "s" : ""}` : "Your portfolio"}
        </Text>
        {!ready ? <View style={{ height: 104 }} /> : (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 18 }}>
            <Ring pct={pct} size={104} stroke={10} track={ON_HERO.glass}>
              <Text style={{ fontSize: 23, fontFamily: fonts.heading.semibold, color: ON_HERO.primary, letterSpacing: -0.5 }}>{pct}%</Text>
              <Text style={{ fontSize: 11.5, fontFamily: fonts.body.medium, color: ON_HERO.secondary }}>paid</Text>
            </Ring>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ fontSize: 13, fontFamily: fonts.body.medium, color: ON_HERO.secondary }}>Paid across your homes</Text>
              <Text adjustsFontSizeToFit numberOfLines={1} style={{ fontSize: 26, fontFamily: fonts.heading.semibold, letterSpacing: -0.6, color: ON_HERO.primary, fontVariant: ["tabular-nums"] }}>{money(paid)}</Text>
              <Text style={{ fontSize: 13, fontFamily: fonts.body.regular, color: ON_HERO.secondary }}>
                {toGo > 0 ? `${money(toGo)} still to pay` : "Nothing left to pay"}
              </Text>
              {verifying > 0 ? <Text style={{ fontSize: 12.5, fontFamily: fonts.body.medium, color: brand.gold }}>+ {money(verifying)} being verified</Text> : null}
            </View>
          </View>
        )}
        {ready && live.length ? (
          <Tap onPress={() => onOpenPayments((soonest?.a || live[0]).ApplicationId)}
            style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 16, padding: 14, backgroundColor: ON_HERO.glass, opacity: pressed ? 0.75 : 1 })}>
            {soonest?.v.next ? (
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 12.5, fontFamily: fonts.body.medium, color: ON_HERO.secondary }}>
                  Next payment · {soonest.a.UnitNo || soonest.a.ApplicationNo}{soonest.v.next.dueDate ? ` · due ${fmtDate(soonest.v.next.dueDate)}` : ""}
                </Text>
                <Text style={{ fontSize: 16, fontFamily: fonts.heading.semibold, color: ON_HERO.primary, fontVariant: ["tabular-nums"] }}>
                  {money(soonest.v.nextAmount)} <Text style={{ fontSize: 13, fontFamily: fonts.body.regular, color: ON_HERO.secondary }}>· {soonest.v.next.name}</Text>
                </Text>
              </View>
            ) : (
              <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 8 }}>
                <CheckCircle2 size={18} color={brand.gold} />
                <Text style={{ fontSize: 14.5, fontFamily: fonts.heading.semibold, color: ON_HERO.primary }}>All payments are up to date</Text>
              </View>
            )}
            <ChevronRight size={18} color={ON_HERO.secondary} />
          </Tap>
        ) : null}
      </View>
    </HeroSurface>
  );
}

/** One booking as a slim row: what it is, where it stands, and a thin progress line. Tapping opens it in My bookings. */
function BookingRow({ a, first, onOpen }: { a: PortalApplication; first: boolean; onOpen: () => void }) {
  const brand = useBrand();
  const id = a.ApplicationId;
  const statement = useQuery({ queryKey: ["portal-money", id], queryFn: () => portal.money(id), enabled: !!a.BookingId });
  // Only an application still being prepared needs its timeline here (what is held for the customer). The rows keep
  // to one request each — a customer with many bookings must not set off a burst (the portal limits requests).
  const timeline = useQuery({ queryKey: ["portal-timeline", id], queryFn: () => portal.timeline(id), enabled: !a.BookingId && a.Lifecycle !== "Past" });
  const v = moneyView(statement.data);
  const s = statement.data;
  const past = a.Lifecycle === "Past";
  const t = timeline.data;
  const kind = s?.booking?.IsPlotSale ? "Plot" : "Unit";
  const project = displayName(a.ProjectName || a.InterestedProject) || (a.BookingId ? "Your home" : `Application ${a.ApplicationNo}`);
  const code = a.BookingNo ? [a.UnitNo ? `${kind} ${a.UnitNo}` : null, a.BookingNo].filter(Boolean).join(" · ") : `Application ${a.ApplicationNo}`;
  const right = past ? a.StateLabel || "Ended" : !a.BookingId ? "Preparing" : statement.isLoading ? "" : `${v.pct}%`;
  const sub = past
    ? (s ? [`${money(v.paid)} paid`, s.totals.refunded > 0 ? `${money(s.totals.refunded)} refunded` : null, s.totals.movedOut > 0 ? `${money(s.totals.movedOut)} moved on` : null].filter(Boolean).join(" · ") : null)
    : !a.BookingId ? (t?.holds?.length ? `Held for you until ${fmtDate(t.holds[0].HoldUntil)}` : "Becomes a booking once confirmed")
    : s ? [v.balance > 0 ? `${money(v.balance)} to go` : "Fully paid",
      v.next ? `next ${money(v.nextAmount)}${v.next.dueDate ? ` by ${fmtDate(v.next.dueDate)}` : ""}` : null].filter(Boolean).join(" · ") : null;
  return (
    <Tap onPress={onOpen} accessibilityRole="button" accessibilityLabel={`${project}, ${code}, ${right}`}
      style={({ pressed }) => ({ paddingVertical: 14, gap: 8, borderTopWidth: first ? 0 : 1, borderTopColor: brand.border, opacity: pressed ? 0.6 : 1 })}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text numberOfLines={1} style={{ fontSize: 16, fontFamily: fonts.heading.semibold, letterSpacing: -0.2, color: past ? brand.textSecondary : brand.textPrimary }}>{project}</Text>
          <Text numberOfLines={1} style={{ fontSize: 12.5, fontFamily: fonts.body.regular, color: brand.textFaint }}>{code}</Text>
        </View>
        <Text style={{ fontSize: past || !a.BookingId ? 13 : 17, fontFamily: fonts.heading.semibold, fontVariant: ["tabular-nums"],
          color: past ? brand.textFaint : !a.BookingId ? brand.textSecondary : v.pct >= 100 ? brand.success : brand.gold }}>{right}</Text>
        <ChevronRight size={17} color={brand.textFaint} />
      </View>
      {a.BookingId && !past ? <Bar pct={v.pct} color={v.pct >= 100 ? brand.success : undefined} /> : null}
      {sub ? <Text numberOfLines={1} style={{ fontSize: 13, fontFamily: fonts.body.regular, color: brand.textSecondary }}>{sub}</Text> : null}
    </Tap>
  );
}

/** Every booking as rows, grouped: Current, Being prepared, Past. */
function BookingList({ list, onOpen }: { list: PortalApplication[]; onOpen: (id: number) => void }) {
  const groups: { title: string; rows: PortalApplication[] }[] = [
    { title: "Current", rows: list.filter((a) => a.Lifecycle === "Home") },
    { title: "Being prepared", rows: list.filter((a) => a.Lifecycle === "InProgress") },
    { title: "Past", rows: list.filter((a) => a.Lifecycle === "Past") },
  ];
  const brand = useBrand();
  return (
    <View style={{ gap: 14 }}>
      {groups.filter((g) => g.rows.length).map((g) => (
        <View key={g.title} style={{ paddingHorizontal: 4 }}>
          <Text style={{ fontSize: 12, fontFamily: fonts.heading.semibold, letterSpacing: 1.4, textTransform: "uppercase", color: brand.textFaint }}>
            {g.title} · {g.rows.length}
          </Text>
          {g.rows.map((a, i) => <BookingRow key={a.ApplicationId} a={a} first={i === 0} onOpen={() => onOpen(a.ApplicationId)} />)}
        </View>
      ))}
    </View>
  );
}

export default function CustomerHomeScreen() {
  const brand = useBrand();
  const card = useCardStyle();
  const nav = useNavigation<Nav>();
  const { me, apps, homes, past, app, appId, setAppId, timeline, money: statement } = useCustomer();
  const { width } = useWindowDimensions();
  const [allSteps, setAllSteps] = useState(false);
  const enabled = appId != null;
  const deeds = useQuery({ queryKey: ["portal-transfer-deeds"], queryFn: portal.transferDeeds });
  const feed = useQuery({ queryKey: ["portal-activity", appId], queryFn: () => portal.activity(appId as number), enabled });
  const t = timeline.data;
  const latest = [...(feed.data || [])].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())[0];

  if (apps.isLoading) return <Page><Loading /></Page>;
  if (apps.error)     return <Page><ErrorText error={apps.error} /></Page>;
  if (!apps.data?.length)
    return <Page><Muted>No application is linked to this account yet. Please contact the sales office.</Muted></Page>;

  const isPast = app?.Lifecycle === "Past";
  const cards = cardList(homes, past);
  const liveBooked = homes.filter((a) => a.Lifecycle === "Home" && a.BookingId);
  // Several bookings (current or past) → the portfolio view; one → that home's own card and journey.
  const multi = cards.length > 1;
  const booked = (apps.data || []).filter((a) => a.BookingId);
  const steps = t?.booking ? journey(t) : [];
  const doneCount = steps.filter((s) => s.state === "done").length;
  const current = steps.find((s) => s.state === "current");
  const after = current ? steps[steps.indexOf(current) + 1] : undefined;
  const deedTodo = (deeds.data || []).reduce((n, v) => n + v.todo, 0);
  const firstName = displayName(me.data?.Name || app?.ApplicantName).split(" ")[0];
  const loading = timeline.isLoading || statement.isLoading;
  const go = (r: RouteName) => openCustomerScreen(r, undefined, nav.navigate as never);

  return (
    <Page onRefresh={() => Promise.all([apps.refetch(), timeline.refetch(), statement.refetch(), me.refetch(), deeds.refetch(), feed.refetch()])}>
      {/* Greeting: the time of day and today's date, the customer's name, and where this home stands */}
      <Greeting name={firstName || "Welcome"}
        where={multi ? "Everything across your homes, at a glance"
          : loading ? null : isPast ? `${app?.StateLabel || "Past booking"} · kept for your records`
          : !t?.booking ? "Your booking is being prepared"
          : current ? `Next step · ${current.label}`
          : steps.length ? "Every step is done. Welcome home" : null} />

      {multi ? (
        <>
          {/* Several bookings: the portfolio, then every booking as a row (a row opens it in My bookings) */}
          <PortfolioHero live={liveBooked} onOpenPayments={(id) => { if (id !== appId) setAppId(id); go("CustomerPayments"); }} />
          <BookingList list={cards} onOpen={(id) => { if (id !== appId) setAppId(id); go("CustomerBooking"); }} />
        </>
      ) : app ? (
        <HomeCard a={app} width={width - 36} onOpenPayments={() => go("CustomerPayments")} />
      ) : null}

      {app?.IsCoApplicant && !multi ? (
        <Muted>You are a joint applicant. The main applicant completes the actions; you can see everything.</Muted>
      ) : null}

      {/* Quick actions */}
      <View style={{ flexDirection: "row", justifyContent: isPast ? "space-around" : "space-between", paddingHorizontal: 4 }}>
        {QUICK.filter((q) => !(isPast && q.route === "CustomerConstruction")).map((q) => (
          <Tap key={q.route} onPress={() => go(q.route)} style={({ pressed }) => ({ alignItems: "center", gap: 8, width: 72, opacity: pressed ? 0.6 : 1 })}>
            <View style={{ ...card, width: 60, height: 60, borderRadius: 20, alignItems: "center", justifyContent: "center" }}>
              <q.icon size={23} color={brand.gold} />
            </View>
            <Text style={{ fontSize: 12.5, fontFamily: fonts.body.medium, color: brand.textPrimary }}>{q.label}</Text>
          </Tap>
        ))}
      </View>

      {loading ? <Loading /> : timeline.error ? <ErrorText error={timeline.error} /> : (
        <>

          {/* Journey */}
          {steps.length && !isPast && !multi ? (
            <Panel title="Your journey" right={<Text style={{ fontSize: 13, fontFamily: fonts.body.medium, color: brand.textSecondary }}>{doneCount} of {steps.length} done</Text>}>
              <View style={{ flexDirection: "row", gap: 4 }}>
                {steps.map((s) => (
                  <View key={s.label} style={{ flex: 1, height: 6, borderRadius: 3,
                    backgroundColor: s.state === "done" ? brand.gold : s.state === "current" ? brand.borderGold : brand.surfaceGlass }} />
                ))}
              </View>
              {current ? (
                <View style={{ gap: 4 }}>
                  <Text style={{ fontSize: 12.5, fontFamily: fonts.body.medium, color: brand.gold }}>Now</Text>
                  <Text style={{ fontSize: 18, letterSpacing: -0.3, fontFamily: fonts.heading.semibold, color: brand.textPrimary }}>{current.label}</Text>
                  <Text style={{ fontSize: 14.5, lineHeight: 21, fontFamily: fonts.body.regular, color: brand.textSecondary }}>{current.hint}</Text>
                  {after ? (
                    <Text style={{ fontSize: 13, fontFamily: fonts.body.medium, color: brand.textFaint, marginTop: 4 }}>After this: {after.label}</Text>
                  ) : null}
                </View>
              ) : (
                <Text style={{ fontSize: 17, fontFamily: fonts.heading.semibold, color: brand.success }}>Every step is complete. Welcome home!</Text>
              )}
              {allSteps ? (
                <View>
                  {steps.map((s, i) => {
                    const done = s.state === "done";
                    const curr = s.state === "current";
                    return (
                      <View key={s.label} style={{ flexDirection: "row", gap: 14 }}>
                        <View style={{ alignItems: "center" }}>
                          <View style={{ width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center",
                            backgroundColor: done ? brand.gold : curr ? brand.goldSoft : brand.surfaceGlass, borderWidth: curr ? 1.5 : 0, borderColor: brand.gold }}>
                            {done ? <Check size={13} color="#14110A" strokeWidth={3} /> : curr ? <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: brand.gold }} /> : null}
                          </View>
                          {i < steps.length - 1 ? <View style={{ width: 2, flex: 1, minHeight: 14, backgroundColor: done ? brand.gold : brand.surfaceGlass }} /> : null}
                        </View>
                        <Text style={{ flex: 1, paddingBottom: 14, paddingTop: 2, fontSize: 14.5,
                          fontFamily: curr ? fonts.heading.semibold : fonts.body.regular, color: done || curr ? brand.textPrimary : brand.textFaint }}>{s.label}</Text>
                      </View>
                    );
                  })}
                </View>
              ) : null}
              <Tap onPress={() => setAllSteps((v) => !v)} style={({ pressed }) => ({ alignSelf: "flex-start", paddingVertical: 4, opacity: pressed ? 0.6 : 1 })}>
                <Text style={{ fontSize: 14, fontFamily: fonts.heading.semibold, color: brand.gold }}>{allSteps ? "Show less" : "See every step"}</Text>
              </Tap>
            </Panel>
          ) : null}
        </>
      )}

      {/* At a glance: live cards, not a menu of names */}
      <Section title="At a glance">
        <View style={{ flexDirection: "row", gap: 12 }}>
          {/* With one booking, a tile for it; with several, the list above already is every booking. */}
          {multi ? null : <GlanceTile icon={Building2} label="My bookings" onPress={() => go("CustomerBooking")}
            value={booked.length > 1 ? `${booked.length} bookings`
              : t?.booking ? `${t.booking.IsPlotSale ? "Plot" : "Unit"} ${t.booking.UnitNo || app?.UnitNo || ""}`.trim() : "Not booked yet"}
            sub={booked.length > 1
              ? [`${booked.filter((a) => a.Lifecycle === "Home").length} current`, booked.some((a) => a.Lifecycle === "Past") ? `${booked.filter((a) => a.Lifecycle === "Past").length} past` : null].filter(Boolean).join(" · ")
              : t?.booking ? `${money(t.booking.GrandTotal || t.booking.TotalValue)} total price` : "Details appear once booked"} />}
          <View style={{ flex: 1 }}>
            <GlanceTile icon={Radio} label="Updates" wide={multi} onPress={() => go("CustomerActivity")}
              value={latest ? latest.title : "Nothing yet"}
              sub={latest ? ago(latest.at) : "We'll post every step here"}
              dot={!!latest && Date.now() - new Date(latest.at).getTime() < 3 * 86400000} />
          </View>
        </View>
        {deeds.data?.length ? (
          <GlanceTile wide icon={FileSignature} label="Transfer deed" onPress={() => go("CustomerTransferDeed")}
            value={deeds.data.length === 1 ? `${deeds.data[0].deed.DeedNo} · ${deeds.data[0].deed.Property}` : `${deeds.data.length} deeds`}
            sub={deedTodo > 0 ? "Your action is needed" : deeds.data[0].deed.StatusLabel}
            subTone={deedTodo > 0 ? brand.gold : undefined} />
        ) : null}
      </Section>
    </Page>
  );
}
