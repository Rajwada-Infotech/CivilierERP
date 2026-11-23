// Home — the person's day, not a second dashboard (the CRM tab has the figures):
//   • the greeting, on the page itself;
//   • "Next up": the single most urgent job — who, how much, how late — with Call / WhatsApp and the key that does it;
//   • filter chips (All · Calls · Payments · Tickets) over the agenda;
//   • the agenda as a timeline: Overdue, Today, This week.
// The jobs are welcome calls to make, buyers' payments falling due and service tickets due, from the same lists the CRM
// pages read (crmRegisters.ts — one query each, shared with those pages). A tap goes straight to the job (log the call,
// open the booking or the ticket). Each kind shows only to staff with a right on its page.
import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { ArrowRight, CheckCircle2, ChevronRight, PhoneCall, ReceiptIndianRupee, Ticket, type LucideIcon } from "lucide-react-native";
import { useAuth } from "@/auth/AuthContext";
import { crmGet, type Row } from "@/api/crmApi";
import type { MainStackParamList } from "@/navigation/MainStack";
import { roleText } from "@/navigation/TopHeader";
import { useBrand } from "@/theme/ThemeContext";
import { fonts } from "@/theme/fonts";
import { registerByKey } from "@/screens/crm/crmRegisters";
import { ContactKeys, ErrorText, HeroSurface, Loading, ON_HERO, Page, Tap, joinDot, money, useCardStyle } from "@/screens/crm/ui";

type Nav = NativeStackNavigationProp<MainStackParamList>;
type Kind = "call" | "payment" | "ticket";
type Bucket = "overdue" | "today" | "week";
interface Task {
  key: string; kind: Kind; when: number; bucket: Bucket; title: string; sub: string; amount?: string;
  mobile?: string | null; action: string; open: () => void;
}

const KIND: Record<Kind, { icon: LucideIcon; label: string }> = {
  call: { icon: PhoneCall, label: "Calls" },
  payment: { icon: ReceiptIndianRupee, label: "Payments" },
  ticket: { icon: Ticket, label: "Tickets" },
};
const BUCKETS: { key: Bucket; title: string }[] = [
  { key: "overdue", title: "Overdue" },
  { key: "today", title: "Today" },
  { key: "week", title: "This week" },
];
/** How many of each group show before "and N more". */
const SHOWN = 6;

const DAY = 86_400_000;
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };
/** Which group a date falls in: before today, today, or the next 7 days (null — later, left off Home). */
const bucketOf = (t: number): Bucket | null => {
  const s = startOfToday();
  return t < s ? "overdue" : t < s + DAY ? "today" : t < s + 8 * DAY ? "week" : null;
};
const dayLabel = (t: number) => {
  const s = startOfToday();
  if (t >= s && t < s + DAY) return "Today";
  if (t >= s + DAY && t < s + 2 * DAY) return "Tomorrow";
  return new Date(t).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
};
/** "Overdue · 47 days", "Due today", "Due tomorrow", "Due 26 Nov". */
const dueText = (t: number) => {
  const s = startOfToday();
  if (t < s) { const days = Math.round((s - t) / DAY); return `Overdue · ${days} day${days === 1 ? "" : "s"}`; }
  return `Due ${dayLabel(t).toLowerCase() === "today" || dayLabel(t) === "Tomorrow" ? dayLabel(t).toLowerCase() : dayLabel(t)}`;
};
const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
};
const initials = (name?: string | null) => (name || "?").split(" ").filter(Boolean).map((n) => n[0]).join("").toUpperCase().slice(0, 2);

/** One CRM list, read the way its page reads it (same query key, so they share the cache). */
function useList(key: string, enabled: boolean) {
  const reg = registerByKey(key)!;
  return useQuery({ queryKey: ["crm", key, ""], queryFn: async () => reg.rows(await crmGet(reg.path)), enabled });
}

/** The most urgent job, large: who, how much, how late, and the keys that act on it. */
function NextUp({ t, more }: { t: Task; more: number }) {
  const K = KIND[t.kind];
  const late = t.bucket === "overdue";
  return (
    <HeroSurface padding={20}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text style={{ fontSize: 12.5, fontFamily: fonts.heading.semibold, color: ON_HERO.secondary, letterSpacing: 0.4 }}>NEXT UP</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999,
          backgroundColor: late ? "rgba(248,113,113,0.24)" : ON_HERO.glass }}>
          <K.icon size={12} color={late ? "#FECACA" : ON_HERO.primary} />
          <Text style={{ fontSize: 12, fontFamily: fonts.heading.semibold, color: late ? "#FECACA" : ON_HERO.primary }}>{dueText(t.when)}</Text>
        </View>
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 14, marginTop: 16 }}>
        <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: ON_HERO.glass, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ fontSize: 18, fontFamily: fonts.heading.semibold, color: ON_HERO.primary }}>{initials(t.title)}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ fontSize: 21, fontFamily: fonts.heading.semibold, color: ON_HERO.primary, letterSpacing: -0.3 }}>{t.title}</Text>
          <Text numberOfLines={2} style={{ fontSize: 13, lineHeight: 18, fontFamily: fonts.body.regular, color: ON_HERO.secondary, marginTop: 2 }}>{t.sub}</Text>
        </View>
      </View>
      {t.amount ? (
        <Text style={{ fontSize: 30, fontFamily: fonts.heading.semibold, color: ON_HERO.primary, letterSpacing: -0.6, marginTop: 14 }}>{t.amount}</Text>
      ) : null}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 16 }}>
        <ContactKeys mobile={t.mobile} compact />
        <Tap onPress={t.open} accessibilityRole="button" accessibilityLabel={t.action}
          style={({ pressed }) => ({ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 44, borderRadius: 14,
            backgroundColor: "#FFFFFF", opacity: pressed ? 0.85 : 1 })}>
          <Text style={{ fontSize: 14.5, fontFamily: fonts.heading.semibold, color: "#14112B" }}>{t.action}</Text>
          <ArrowRight size={16} color="#14112B" />
        </Tap>
      </View>
      {more > 0 ? (
        <Text style={{ fontSize: 12.5, fontFamily: fonts.body.medium, color: ON_HERO.secondary, marginTop: 12 }}>{more} more on your list below</Text>
      ) : null}
    </HeroSurface>
  );
}

/** One job in the timeline: its dot on the line, the person or ticket, what it is, when. */
function TimelineRow({ t, last, tone }: { t: Task; last: boolean; tone: string }) {
  const b = useBrand();
  const K = KIND[t.kind];
  return (
    <Tap onPress={t.open} accessibilityRole="button" accessibilityLabel={`${t.title}, ${t.sub}`}
      style={({ pressed }) => ({ flexDirection: "row", gap: 14, opacity: pressed ? 0.7 : 1 })}>
      <View style={{ width: 16, alignItems: "center" }}>
        <View style={{ width: 12, height: 12, borderRadius: 6, marginTop: 17, borderWidth: 3, borderColor: tone, backgroundColor: b.surface }} />
        {!last ? <View style={{ flex: 1, width: 2, backgroundColor: b.border, marginTop: 2 }} /> : null}
      </View>
      <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, marginBottom: last ? 0 : 2 }}>
        <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: `${tone}22`, alignItems: "center", justifyContent: "center" }}>
          <K.icon size={17} color={tone} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ fontSize: 15, fontFamily: fonts.heading.semibold, color: b.textPrimary }}>{t.title}</Text>
          <Text numberOfLines={1} style={{ fontSize: 12.5, fontFamily: fonts.body.regular, color: b.textSecondary, marginTop: 2 }}>{t.sub}</Text>
        </View>
        <View style={{ alignItems: "flex-end", gap: 2 }}>
          {t.amount ? <Text style={{ fontSize: 13.5, fontFamily: fonts.heading.semibold, color: b.textPrimary, fontVariant: ["tabular-nums"] }}>{t.amount}</Text> : null}
          <Text style={{ fontSize: 12, fontFamily: fonts.body.medium, color: t.bucket === "overdue" ? b.danger : b.textSecondary }}>{dayLabel(t.when)}</Text>
        </View>
        <ChevronRight size={16} color={b.textFaint} />
      </View>
    </Tap>
  );
}

export default function HomeScreen() {
  const b = useBrand();
  const card = useCardStyle();
  const nav = useNavigation<Nav>();
  const { currentUser, canAccessPage, canDoAction } = useAuth();
  const [filter, setFilter] = useState<Kind | "all">("all");
  const seesCalls = canAccessPage("crm-welcome-calls");
  const seesPayments = canAccessPage("crm-payments");
  const seesTickets = canAccessPage("crm-service-tickets");
  const callsQ = useList("welcome-calls", seesCalls);
  const demandsQ = useList("demands", seesPayments);
  const ticketsQ = useList("service-tickets", seesTickets);
  const canLogCall = canDoAction("crm-welcome-calls", "create");
  const today = startOfToday();

  const tasks: Task[] = [];
  // Welcome calls: the call's next date, or now for a booking never called.
  for (const r of callsQ.data ?? []) {
    const when = r.NextCallDate ? new Date(r.NextCallDate).getTime() : today;
    const bucket = bucketOf(when);
    if (!bucket) continue;
    tasks.push({
      key: `c${r.BookingId}`, kind: "call", when, bucket, title: r.ApplicantName, mobile: r.Mobile,
      sub: joinDot(r.LastOutcome ? "Welcome call again" : "Welcome call", r.BookingNo, r.ProjectName),
      action: canLogCall ? "Log call" : "Open booking",
      open: canLogCall ? () => nav.navigate("CrmWelcomeCall", { bookingId: Number(r.BookingId), title: r.ApplicantName })
        : () => nav.navigate("CrmBooking", { bookingId: Number(r.BookingId), title: r.BookingNo }),
    });
  }
  // Buyers' payments: a demanded milestone still short of money, due within a week or past due.
  for (const r of (demandsQ.data ?? []) as Row[]) {
    if (r.DemandStatus === "Paid" || !(Number(r.Missing) > 0) || !r.DueDate) continue;
    const when = new Date(r.DueDate).getTime();
    const bucket = r.IsOverdue ? "overdue" : bucketOf(when);
    if (!bucket) continue;
    tasks.push({
      key: `p${r.Id}`, kind: "payment", when, bucket, title: r.ApplicantName, mobile: r.Mobile, amount: money(r.Missing),
      sub: joinDot(r.MilestoneName, r.BookingNo), action: "Open booking",
      open: () => nav.navigate("CrmBooking", { bookingId: Number(r.BookingId), title: r.BookingNo }),
    });
  }
  // Service tickets: not resolved, due within a week or past due.
  for (const r of (ticketsQ.data ?? []) as Row[]) {
    if (["Resolved", "Closed"].includes(r.Status) || !r.SlaDueDate) continue;
    const when = new Date(r.SlaDueDate).getTime();
    const bucket = bucketOf(when);
    if (!bucket) continue;
    tasks.push({
      key: `t${r.Id}`, kind: "ticket", when, bucket, title: r.Subject || r.TicketNo, mobile: r.Mobile,
      sub: joinDot(r.TicketNo, r.ApplicantName, r.Priority && `${r.Priority} priority`), action: "Open ticket",
      open: () => nav.navigate("CrmTicket", { ticketId: Number(r.Id) }),
    });
  }
  tasks.sort((a, c) => a.when - c.when);

  const loading = (seesCalls && callsQ.isLoading) || (seesPayments && demandsQ.isLoading) || (seesTickets && ticketsQ.isLoading);
  const error = callsQ.error || demandsQ.error || ticketsQ.error;
  const seesAny = seesCalls || seesPayments || seesTickets;
  const next = tasks[0];
  const rest = tasks.slice(1);
  const kinds = (["call", "payment", "ticket"] as Kind[]).filter((k) => rest.some((t) => t.kind === k));
  const shown = rest.filter((t) => filter === "all" || t.kind === filter);
  const firstName = (currentUser?.name || "").split(" ")[0];
  const toneOf = (bk: Bucket) => (bk === "overdue" ? b.danger : bk === "today" ? b.accent : b.isDark ? "#60A5FA" : "#2563EB");

  return (
    <Page tab gap={18} onRefresh={() => Promise.all([seesCalls && callsQ.refetch(), seesPayments && demandsQ.refetch(), seesTickets && ticketsQ.refetch()])}>
      {/* Greeting */}
      <View style={{ paddingHorizontal: 4, paddingTop: 4 }}>
        <Text style={{ fontSize: 13, fontFamily: fonts.body.medium, color: b.textSecondary }}>
          {new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}
        </Text>
        <Text style={{ fontSize: 30, lineHeight: 36, fontFamily: fonts.heading.semibold, color: b.textPrimary, letterSpacing: -0.8, marginTop: 4 }}>
          {greeting()}{firstName ? `, ${firstName}` : ""}
        </Text>
        <Text style={{ fontSize: 13.5, fontFamily: fonts.body.regular, color: b.textSecondary, marginTop: 2 }}>{roleText(currentUser?.role)}</Text>
      </View>

      {error ? <ErrorText error={error} /> : null}
      {!seesAny ? null : loading ? <Loading /> : !next ? (
        <View style={{ ...card, alignItems: "center", paddingVertical: 40, paddingHorizontal: 24, gap: 10 }}>
          <View style={{ width: 60, height: 60, borderRadius: 30, backgroundColor: b.successSoft, alignItems: "center", justifyContent: "center" }}>
            <CheckCircle2 size={28} color={b.success} />
          </View>
          <Text style={{ fontSize: 18, fontFamily: fonts.heading.semibold, color: b.textPrimary }}>You're all caught up</Text>
          <Text style={{ fontSize: 13.5, lineHeight: 19, textAlign: "center", fontFamily: fonts.body.regular, color: b.textSecondary }}>
            No calls, payments or tickets are due in the next 7 days.
          </Text>
        </View>
      ) : (
        <>
          <NextUp t={next} more={rest.length} />

          {rest.length ? (
            <>
              {/* Filter chips: what the timeline shows */}
              {kinds.length > 1 ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 2 }}>
                  {(["all", ...kinds] as (Kind | "all")[]).map((k) => {
                    const on = filter === k;
                    const n = k === "all" ? rest.length : rest.filter((t) => t.kind === k).length;
                    const Icon = k === "all" ? null : KIND[k].icon;
                    return (
                      <Tap key={k} onPress={() => setFilter(k)} accessibilityRole="button" accessibilityState={{ selected: on }}
                        style={{ flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 14, height: 38, borderRadius: 999,
                          backgroundColor: on ? b.textPrimary : b.surfaceCard, borderWidth: on ? 0 : 1, borderColor: b.border }}>
                        {Icon ? <Icon size={14} color={on ? b.surface : b.textSecondary} /> : null}
                        <Text style={{ fontSize: 13.5, fontFamily: fonts.heading.semibold, color: on ? b.surface : b.textPrimary }}>{k === "all" ? "All" : KIND[k].label}</Text>
                        <Text style={{ fontSize: 12.5, fontFamily: fonts.body.medium, color: on ? b.surface : b.textSecondary }}>{n}</Text>
                      </Tap>
                    );
                  })}
                </ScrollView>
              ) : null}

              {/* The timeline */}
              <View style={{ ...card, paddingHorizontal: 14, paddingVertical: 8 }}>
                {BUCKETS.map(({ key, title }, gi) => {
                  const group = shown.filter((t) => t.bucket === key);
                  if (!group.length) return null;
                  const list = group.slice(0, SHOWN);
                  const tone = toneOf(key);
                  return (
                    <View key={key} style={{ paddingTop: gi ? 10 : 6 }}>
                      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8, paddingLeft: 30, paddingBottom: 2 }}>
                        <Text style={{ fontSize: 13, fontFamily: fonts.heading.semibold, color: key === "overdue" ? b.danger : b.textPrimary, letterSpacing: 0.2 }}>{title}</Text>
                        <Text style={{ fontSize: 12.5, fontFamily: fonts.body.medium, color: b.textSecondary }}>{group.length}</Text>
                      </View>
                      {list.map((t, i) => <TimelineRow key={t.key} t={t} tone={tone} last={i === list.length - 1} />)}
                      {group.length > SHOWN ? (
                        <Text style={{ fontSize: 12.5, fontFamily: fonts.body.regular, color: b.textSecondary, paddingLeft: 30, paddingVertical: 6 }}>
                          and {group.length - SHOWN} more
                        </Text>
                      ) : null}
                    </View>
                  );
                })}
                {shown.length === 0 ? (
                  <Text style={{ fontSize: 13.5, fontFamily: fonts.body.regular, color: b.textSecondary, paddingVertical: 12, textAlign: "center" }}>Nothing else here.</Text>
                ) : null}
              </View>
            </>
          ) : null}
        </>
      )}
    </Page>
  );
}
