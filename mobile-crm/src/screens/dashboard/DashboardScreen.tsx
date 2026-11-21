// Home — the person's day, not a second dashboard (the CRM tab has the figures). A hero with the greeting and the day
// in one line, then the agenda: welcome calls to make, buyers' payments falling due and service tickets due, from the
// same lists the CRM pages read (crmRegisters.ts — one query each, shared with those pages), grouped Overdue / Today /
// This week. Each item is the buyer or ticket itself: Call / WhatsApp on it, and a tap goes straight to the job (log
// the call, open the booking or the ticket). Each kind shows only to staff with a right on its page.
import { Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { CheckCircle2, ChevronRight, PhoneCall, ReceiptIndianRupee, Ticket, type LucideIcon } from "lucide-react-native";
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
interface Task { key: string; kind: Kind; when: number; bucket: Bucket; title: string; sub: string; mobile?: string | null; open: () => void }

const KIND: Record<Kind, { icon: LucideIcon; one: string; many: string }> = {
  call: { icon: PhoneCall, one: "call to make", many: "calls to make" },
  payment: { icon: ReceiptIndianRupee, one: "payment due", many: "payments due" },
  ticket: { icon: Ticket, one: "ticket due", many: "tickets due" },
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
  return new Date(t).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
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

function TaskRow({ t, last }: { t: Task; last: boolean }) {
  const b = useBrand();
  const K = KIND[t.kind];
  const late = t.bucket === "overdue";
  return (
    <Tap onPress={t.open} accessibilityRole="button" accessibilityLabel={`${t.title}, ${t.sub}`}
      style={({ pressed }) => ({ flexDirection: "row", gap: 12, paddingVertical: 14, paddingHorizontal: 16, backgroundColor: pressed ? b.surfaceGlass : "transparent",
        borderBottomWidth: last ? 0 : 1, borderBottomColor: b.border })}>
      <View>
        <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: late ? b.dangerSoft : b.accentSoft, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ fontSize: 14, fontFamily: fonts.heading.semibold, color: late ? b.danger : b.accent }}>{initials(t.title)}</Text>
        </View>
        <View style={{ position: "absolute", right: -3, bottom: -3, width: 20, height: 20, borderRadius: 10, backgroundColor: b.surfaceCard, alignItems: "center", justifyContent: "center" }}>
          <K.icon size={11} color={late ? b.danger : b.accent} />
        </View>
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text numberOfLines={1} style={{ flex: 1, fontSize: 15, fontFamily: fonts.heading.semibold, color: b.textPrimary }}>{t.title}</Text>
          <Text style={{ fontSize: 12, fontFamily: fonts.body.medium, color: late ? b.danger : b.textSecondary }}>{dayLabel(t.when)}</Text>
        </View>
        <Text numberOfLines={2} style={{ fontSize: 13, lineHeight: 18, fontFamily: fonts.body.regular, color: b.textSecondary }}>{t.sub}</Text>
        {t.mobile ? <View style={{ marginTop: 6 }}><ContactKeys mobile={t.mobile} compact /></View> : null}
      </View>
      <ChevronRight size={18} color={b.textFaint} style={{ alignSelf: "center" }} />
    </Tap>
  );
}

export default function HomeScreen() {
  const b = useBrand();
  const card = useCardStyle();
  const nav = useNavigation<Nav>();
  const { currentUser, canAccessPage, canDoAction } = useAuth();
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
      key: `p${r.Id}`, kind: "payment", when, bucket, title: r.ApplicantName, mobile: r.Mobile,
      sub: joinDot(`${money(r.Missing)} · ${r.MilestoneName}`, r.BookingNo),
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
      sub: joinDot(r.TicketNo, r.ApplicantName, r.Priority && `${r.Priority} priority`),
      open: () => nav.navigate("CrmTicket", { ticketId: Number(r.Id) }),
    });
  }
  tasks.sort((a, c) => a.when - c.when);

  const loading = (seesCalls && callsQ.isLoading) || (seesPayments && demandsQ.isLoading) || (seesTickets && ticketsQ.isLoading);
  const error = callsQ.error || demandsQ.error || ticketsQ.error;
  const counts = (["call", "payment", "ticket"] as Kind[]).map((k) => ({ k, n: tasks.filter((t) => t.kind === k).length })).filter((x) => x.n > 0);
  const overdue = tasks.filter((t) => t.bucket === "overdue").length;
  const firstName = (currentUser?.name || "").split(" ")[0];
  const seesAny = seesCalls || seesPayments || seesTickets;

  return (
    <Page tab gap={16} onRefresh={() => Promise.all([seesCalls && callsQ.refetch(), seesPayments && demandsQ.refetch(), seesTickets && ticketsQ.refetch()])}>
      <HeroSurface padding={22}>
        <Text style={{ fontSize: 13, fontFamily: fonts.body.medium, color: ON_HERO.secondary, letterSpacing: 0.2 }}>
          {new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}
        </Text>
        <Text style={{ fontSize: 28, lineHeight: 34, fontFamily: fonts.heading.semibold, color: ON_HERO.primary, letterSpacing: -0.6, marginTop: 6 }}>
          {greeting()}{firstName ? `,\n${firstName}` : ""}
        </Text>
        <Text style={{ fontSize: 13.5, fontFamily: fonts.body.regular, color: ON_HERO.secondary, marginTop: 4 }}>{roleText(currentUser?.role)}</Text>
        {seesAny && !loading ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 18 }}>
            {counts.length === 0 ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: ON_HERO.glass }}>
                <CheckCircle2 size={14} color={ON_HERO.primary} />
                <Text style={{ fontSize: 13, fontFamily: fonts.heading.semibold, color: ON_HERO.primary }}>Nothing due this week</Text>
              </View>
            ) : counts.map(({ k, n }) => {
              const K = KIND[k];
              return (
                <View key={k} style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: ON_HERO.glass }}>
                  <K.icon size={14} color={ON_HERO.primary} />
                  <Text style={{ fontSize: 13, fontFamily: fonts.heading.semibold, color: ON_HERO.primary }}>{n} {n === 1 ? K.one : K.many}</Text>
                </View>
              );
            })}
            {overdue > 0 ? (
              <View style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: "rgba(248,113,113,0.22)" }}>
                <Text style={{ fontSize: 13, fontFamily: fonts.heading.semibold, color: "#FECACA" }}>{overdue} overdue</Text>
              </View>
            ) : null}
          </View>
        ) : null}
      </HeroSurface>

      {error ? <ErrorText error={error} /> : null}
      {!seesAny ? null : loading ? <Loading /> : tasks.length === 0 ? (
        <View style={{ ...card, alignItems: "center", paddingVertical: 36, paddingHorizontal: 24, gap: 10 }}>
          <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: b.successSoft, alignItems: "center", justifyContent: "center" }}>
            <CheckCircle2 size={26} color={b.success} />
          </View>
          <Text style={{ fontSize: 17, fontFamily: fonts.heading.semibold, color: b.textPrimary }}>You're all caught up</Text>
          <Text style={{ fontSize: 13.5, lineHeight: 19, textAlign: "center", fontFamily: fonts.body.regular, color: b.textSecondary }}>
            No calls, payments or tickets are due in the next 7 days.
          </Text>
        </View>
      ) : BUCKETS.map(({ key, title }) => {
        const group = tasks.filter((t) => t.bucket === key);
        if (!group.length) return null;
        const shown = group.slice(0, SHOWN);
        return (
          <View key={key} style={{ gap: 10 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 4 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: key === "overdue" ? b.danger : key === "today" ? b.accent : b.textFaint }} />
              <Text style={{ flex: 1, fontSize: 17, fontFamily: fonts.heading.semibold, letterSpacing: -0.2, color: b.textPrimary }}>{title}</Text>
              <Text style={{ fontSize: 13, fontFamily: fonts.body.medium, color: b.textSecondary }}>{group.length}</Text>
            </View>
            <View style={{ ...card, overflow: "hidden" }}>
              {shown.map((t, i) => <TaskRow key={t.key} t={t} last={i === shown.length - 1} />)}
            </View>
            {group.length > SHOWN ? (
              <Text style={{ fontSize: 12.5, fontFamily: fonts.body.regular, color: b.textSecondary, paddingHorizontal: 4 }}>
                and {group.length - SHOWN} more — see Welcome Calls, Demands and Service Tickets
              </Text>
            ) : null}
          </View>
        );
      })}
    </Page>
  );
}
