// Customer Home. Built like a modern banking home: the one figure that matters is the biggest thing on screen (a
// wallet-style home card with a payment ring), the four things people do most sit under the thumb as quick actions,
// then the single next task, where the purchase stands, and a short grouped menu for the rest.
// Several properties: the switcher shows live homes and applications in progress (each with how much needs you),
// "Up next" covers every home (the server's one rule set, todo.ts), and a past property shows as read-only history.
import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowUpRight, BellRing, Building2, Check, CheckCircle2, ChevronRight, CreditCard, FileSignature, FileText, HardHat, LifeBuoy, Radio, type LucideIcon,
} from "lucide-react-native";
import { useBrand } from "@/theme/ThemeContext";
import { fonts } from "@/theme/fonts";
import { portal, type Timeline } from "@/api/customerPortalApi";
import { useCustomer } from "@/customer/CustomerContext";
import { useNeedsYou } from "@/customer/todo";
import {
  Button, ErrorText, HeroSurface, Loading, Muted, displayName, ON_HERO, Page, Panel, Ring, Section, fmtDate, money, useCardStyle, Tap} from "@/customer/ui";
import type { CustomerStackParamList } from "@/navigation/CustomerStack";

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

/** "Today", "Yesterday", "3 days ago", else the date. */
function ago(at: string) {
  const days = Math.floor((Date.now() - new Date(at).getTime()) / 86400000);
  return days <= 0 ? "Today" : days === 1 ? "Yesterday" : days < 7 ? `${days} days ago` : fmtDate(at);
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

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export default function CustomerHomeScreen() {
  const brand = useBrand();
  const card = useCardStyle();
  const nav = useNavigation<Nav>();
  const { me, apps, homes, app, appId, setAppId, timeline } = useCustomer();
  const [allSteps, setAllSteps] = useState(false);
  const enabled = appId != null;
  const needs = useNeedsYou();
  const deeds = useQuery({ queryKey: ["portal-transfer-deeds"], queryFn: portal.transferDeeds });
  const feed = useQuery({ queryKey: ["portal-activity", appId], queryFn: () => portal.activity(appId as number), enabled });
  const t = timeline.data;
  const latest = [...(feed.data || [])].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())[0];

  if (apps.isLoading) return <Page><Loading /></Page>;
  if (apps.error)     return <Page><ErrorText error={apps.error} /></Page>;
  if (!apps.data?.length)
    return <Page><Muted>No application is linked to this account yet. Please contact the sales office.</Muted></Page>;

  const milestones = t?.paymentMilestones || [];
  const total = milestones.reduce((s, m) => s + Number(m.AmountDue || 0), 0) || Number(t?.booking?.GrandTotal || 0);
  const paid = milestones.reduce((s, m) => s + Number(m.AmountPaid || 0), 0) + Number(t?.onAccountTotalReceived || 0);
  const pct = total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 0;
  // The next instalment genuinely still to pay — not one already covered by money held, nor one being verified.
  const next = milestones.find((m) => !m.Covered && !m.Verifying && m.Outstanding > 0);
  // This property's items first, then the other homes' (each labelled), then deeds with no home of theirs.
  const allTodo = needs.data || [];
  const todo = [...allTodo.filter((x) => x.applicationId === appId), ...allTodo.filter((x) => x.applicationId !== appId)];
  const countFor = (id: number) => allTodo.filter((x) => x.applicationId === id).length;
  const nameOf = (id: number | null) => {
    const a = id == null ? null : (apps.data || []).find((x) => x.ApplicationId === id);
    return a ? [displayName(a.ProjectName || a.InterestedProject), a.UnitNo || a.ApplicationNo].filter(Boolean).join(" · ") : "";
  };
  const isPast = app?.Lifecycle === "Past";
  const booked = (apps.data || []).filter((a) => a.BookingId);
  const steps = t?.booking ? journey(t) : [];
  const doneCount = steps.filter((s) => s.state === "done").length;
  const current = steps.find((s) => s.state === "current");
  const after = current ? steps[steps.indexOf(current) + 1] : undefined;
  const deedTodo = (deeds.data || []).reduce((n, v) => n + v.todo, 0);
  const firstName = displayName(me.data?.Name || app?.ApplicantName).split(" ")[0];
  const project = displayName(app?.ProjectName || app?.InterestedProject) || "Your home";
  // The card's second line says what each code is: "Plot P-120 · Booking BKG-…", or the application while it's prepared.
  const kind = t?.booking?.IsPlotSale ? "Plot" : "Unit";
  const homeLine = app?.BookingNo
    ? [app.UnitNo ? `${kind} ${app.UnitNo}` : null, `Booking ${app.BookingNo}`].filter(Boolean).join(" · ")
    : `Application ${app?.ApplicationNo || ""}`.trim();
  const first = todo[0];
  const loading = timeline.isLoading || needs.isLoading;
  const go = (r: RouteName) => nav.navigate(r as never);
  /** Open an item's page on the property it belongs to (switching to it first if it's another home). */
  const act = (x: (typeof todo)[number]) => { if (x.applicationId && x.applicationId !== appId) setAppId(x.applicationId); go(x.route); };

  return (
    <Page onRefresh={() => Promise.all([apps.refetch(), timeline.refetch(), me.refetch(), needs.refetch(), deeds.refetch(), feed.refetch()])}>
      {/* Greeting */}
      <View style={{ gap: 2, paddingHorizontal: 4 }}>
        <Text style={{ fontSize: 14.5, fontFamily: fonts.body.medium, color: brand.textSecondary }}>{greeting()},</Text>
        <Text style={{ fontSize: 28, fontFamily: fonts.heading.semibold, letterSpacing: -0.6, color: brand.textPrimary }}>{firstName}</Text>
        {!needs.isLoading ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: allTodo.length ? brand.gold : brand.success }} />
            <Text style={{ fontSize: 14, fontFamily: fonts.body.medium, color: brand.textSecondary }}>
              {allTodo.length ? `${allTodo.length} thing${allTodo.length > 1 ? "s" : ""} need${allTodo.length > 1 ? "" : "s"} you` : "You're all caught up"}
              {homes.length > 1 ? ` · ${homes.length} homes` : ""}
            </Text>
          </View>
        ) : null}
      </View>

      {/* Several homes: choose one. Only live homes and applications in progress — past ones live in Profile. */}
      {homes.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 2 }}>
          {homes.map((a) => {
            const on = a.ApplicationId === appId;
            const n = countFor(a.ApplicationId);
            return (
              <Tap key={a.ApplicationId} onPress={() => setAppId(a.ApplicationId)} accessibilityRole="tab" accessibilityState={{ selected: on }}
                style={{ flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 100, paddingLeft: 16, paddingRight: n ? 8 : 16, paddingVertical: 8,
                  backgroundColor: on ? brand.textPrimary : brand.surfaceCard, borderWidth: on ? 0 : 1, borderColor: brand.border }}>
                <View>
                  <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 13.5, color: on ? brand.surface : brand.textPrimary }}>{a.UnitNo || a.ApplicationNo}</Text>
                  <Text style={{ fontFamily: fonts.body.regular, fontSize: 11, color: on ? brand.surface : brand.textSecondary, opacity: on ? 0.7 : 1 }}>
                    {a.Lifecycle === "InProgress" ? a.StateLabel : displayName(a.ProjectName || a.InterestedProject)}
                  </Text>
                </View>
                {n ? (
                  <View style={{ minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, backgroundColor: brand.gold, alignItems: "center", justifyContent: "center" }}>
                    <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 11.5, color: "#14110A" }}>{n}</Text>
                  </View>
                ) : null}
              </Tap>
            );
          })}
        </ScrollView>
      ) : null}

      {/* Looking at a past property (from Profile): say so, and offer the way back */}
      {isPast ? (
        <View style={{ ...card, padding: 16, gap: 12 }}>
          <Text style={{ fontSize: 15, fontFamily: fonts.heading.semibold, color: brand.textPrimary }}>
            This is a past property · {app?.StateLabel}
          </Text>
          <Text style={{ fontSize: 13.5, lineHeight: 19, fontFamily: fonts.body.regular, color: brand.textSecondary }}>
            You can still see its payments and papers. Nothing here needs you.
          </Text>
          {homes[0] ? <Button label="Back to my home" kind="line" onPress={() => setAppId(homes[0].ApplicationId)} /> : null}
        </View>
      ) : null}

      {/* The home card */}
      <HeroSurface>
        <View style={{ gap: 18 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <View style={{ width: 40, height: 40, borderRadius: 13, backgroundColor: ON_HERO.glass, alignItems: "center", justifyContent: "center" }}>
              <Building2 size={20} color={ON_HERO.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={{ fontSize: 16, fontFamily: fonts.heading.semibold, color: ON_HERO.primary }}>{project}</Text>
              <Text numberOfLines={1} style={{ fontSize: 13, fontFamily: fonts.body.regular, color: ON_HERO.secondary }}>
                {homeLine}
              </Text>
            </View>
            {app?.IsCoApplicant || app?.StateLabel ? (
              <View style={{ borderRadius: 100, paddingHorizontal: 11, paddingVertical: 5, backgroundColor: ON_HERO.glass }}>
                <Text style={{ fontSize: 12, fontFamily: fonts.heading.semibold, color: ON_HERO.primary }}>{app?.IsCoApplicant ? "Joint applicant" : app?.StateLabel}</Text>
              </View>
            ) : null}
          </View>

          {loading ? (
            <View style={{ height: 108 }} />
          ) : t?.booking ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 18 }}>
              <Ring pct={pct} size={108} stroke={10} track={ON_HERO.glass}>
                <Text style={{ fontSize: 24, fontFamily: fonts.heading.semibold, color: ON_HERO.primary, letterSpacing: -0.5 }}>{pct}%</Text>
                <Text style={{ fontSize: 11.5, fontFamily: fonts.body.medium, color: ON_HERO.secondary }}>paid</Text>
              </Ring>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ fontSize: 13, fontFamily: fonts.body.medium, color: ON_HERO.secondary }}>You have paid</Text>
                <Text adjustsFontSizeToFit numberOfLines={1} style={{ fontSize: 26, fontFamily: fonts.heading.semibold, letterSpacing: -0.6, color: ON_HERO.primary, fontVariant: ["tabular-nums"] }}>{money(paid)}</Text>
                <Text style={{ fontSize: 13, fontFamily: fonts.body.regular, color: ON_HERO.secondary }}>of {money(total)}</Text>
              </View>
            </View>
          ) : (
            <Text style={{ fontSize: 14.5, lineHeight: 21, fontFamily: fonts.body.regular, color: ON_HERO.secondary }}>
              Your booking details and payments will appear here once your home is confirmed.
            </Text>
          )}

          {t?.booking && !loading ? (
            <Tap onPress={() => go("CustomerPayments")}
              style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 16, padding: 14, backgroundColor: ON_HERO.glass, opacity: pressed ? 0.75 : 1 })}>
              {next ? (
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 12.5, fontFamily: fonts.body.medium, color: ON_HERO.secondary }}>Next payment{next.DueDate ? ` · due ${fmtDate(next.DueDate)}` : ""}</Text>
                  <Text style={{ fontSize: 16, fontFamily: fonts.heading.semibold, color: ON_HERO.primary, fontVariant: ["tabular-nums"] }}>
                    {money(next.Outstanding)} <Text style={{ fontSize: 13, fontFamily: fonts.body.regular, color: ON_HERO.secondary }}>· {next.MilestoneName}</Text>
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

      {app?.IsCoApplicant ? (
        <Muted>You are a joint applicant. The main applicant completes the actions; you can see everything.</Muted>
      ) : null}

      {/* Quick actions */}
      <View style={{ flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 4 }}>
        {QUICK.map((q) => (
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
          {/* Up next */}
          {first ? (
            <View style={{ ...card, padding: 20, gap: 14, borderWidth: 1, borderColor: brand.accentBorder }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <View style={{ width: 34, height: 34, borderRadius: 11, backgroundColor: brand.goldSoft, alignItems: "center", justifyContent: "center" }}>
                  <BellRing size={17} color={brand.gold} />
                </View>
                <Text style={{ flex: 1, fontSize: 14, fontFamily: fonts.heading.semibold, color: brand.gold }}>Up next for you</Text>
                {todo.length > 1 ? (
                  <Text style={{ fontSize: 12.5, fontFamily: fonts.body.medium, color: brand.textSecondary }}>{todo.length} things waiting</Text>
                ) : null}
              </View>
              <View style={{ gap: 6 }}>
                {homes.length > 1 && nameOf(first.applicationId) ? (
                  <Text style={{ fontSize: 12.5, fontFamily: fonts.body.medium, color: brand.textSecondary }}>{nameOf(first.applicationId)}</Text>
                ) : null}
                <Text style={{ fontSize: 19, lineHeight: 25, letterSpacing: -0.3, fontFamily: fonts.heading.semibold, color: brand.textPrimary }}>{first.label}</Text>
                <Text style={{ fontSize: 14.5, lineHeight: 21, fontFamily: fonts.body.regular, color: brand.textSecondary }}>{first.sub}</Text>
              </View>
              <Button label="Do it now" onPress={() => act(first)} />
              {todo.slice(1).map((x) => (
                <Tap key={`${x.applicationId}-${x.kind}-${x.label}`} onPress={() => act(x)}
                  style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 10, paddingTop: 12, borderTopWidth: 1, borderTopColor: brand.border, opacity: pressed ? 0.6 : 1 })}>
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: x.urgent ? brand.danger : brand.gold }} />
                  <View style={{ flex: 1, gap: 1 }}>
                    <Text style={{ fontSize: 14.5, fontFamily: fonts.body.medium, color: brand.textPrimary }}>{x.label}</Text>
                    {homes.length > 1 && nameOf(x.applicationId) ? (
                      <Text style={{ fontSize: 12, fontFamily: fonts.body.regular, color: brand.textSecondary }}>{nameOf(x.applicationId)}</Text>
                    ) : null}
                  </View>
                  <ChevronRight size={18} color={brand.textFaint} />
                </Tap>
              ))}
            </View>
          ) : t?.booking && !isPast ? (
            <View style={{ ...card, padding: 18, flexDirection: "row", alignItems: "center", gap: 14 }}>
              <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: brand.successSoft, alignItems: "center", justifyContent: "center" }}>
                <CheckCircle2 size={24} color={brand.success} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ fontSize: 16, fontFamily: fonts.heading.semibold, color: brand.textPrimary }}>You're all caught up</Text>
                <Text style={{ fontSize: 13.5, fontFamily: fonts.body.regular, color: brand.textSecondary }}>Nothing needs you right now. We'll notify you when it does.</Text>
              </View>
            </View>
          ) : null}

          {/* Journey */}
          {steps.length ? (
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
          {/* All bookings, not just this one: with several, say how many (real bookings only — an application that never
              became one is not counted); with one, show it. */}
          <GlanceTile icon={Building2} label="My bookings" onPress={() => go("CustomerBooking")}
            value={booked.length > 1 ? `${booked.length} bookings`
              : t?.booking ? `${t.booking.IsPlotSale ? "Plot" : "Unit"} ${t.booking.UnitNo || app?.UnitNo || ""}`.trim() : "Not booked yet"}
            sub={booked.length > 1
              ? [`${booked.filter((a) => a.Lifecycle === "Home").length} current`, booked.some((a) => a.Lifecycle === "Past") ? `${booked.filter((a) => a.Lifecycle === "Past").length} past` : null].filter(Boolean).join(" · ")
              : t?.booking ? `${money(t.booking.GrandTotal || t.booking.TotalValue)} total price` : "Details appear once booked"} />
          <GlanceTile icon={Radio} label="Updates" onPress={() => go("CustomerActivity")}
            value={latest ? latest.title : "Nothing yet"}
            sub={latest ? ago(latest.at) : "We'll post every step here"}
            dot={!!latest && Date.now() - new Date(latest.at).getTime() < 3 * 86400000} />
        </View>
        {deeds.data?.length ? (
          <GlanceTile wide icon={FileSignature} label="Transfer deed" onPress={() => go("CustomerTransferDeed")}
            value={deeds.data.length === 1 ? `${deeds.data[0].deed.DeedNo} · ${deeds.data[0].deed.Property}` : `${deeds.data.length} deeds`}
            sub={deedTodo > 0 ? `${deedTodo} thing${deedTodo > 1 ? "s" : ""} need${deedTodo > 1 ? "" : "s"} you` : deeds.data[0].deed.StatusLabel}
            subTone={deedTodo > 0 ? brand.gold : undefined} />
        ) : null}
      </Section>
    </Page>
  );
}
