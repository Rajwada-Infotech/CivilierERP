// The CRM tab — every CRM list in one place, the web CRM menu's groups (crmRegisters.ts), each only for staff with a
// right on its page. The figures live on Home (the dashboard); here: a search over the lists, the lists that need
// attention now (crmDashboard.js alerts, ATTENTION) with their counts, then each group as a grid of tiles with a live
// line and a badge. Setup (the web's Setup menu) is the header's drawer (TopHeader.tsx SetupDrawer).
import { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useNavigation } from "@react-navigation/native";
import { crmGet } from "@/api/crmApi";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { ChevronRight, PlusCircle, Search, SlidersHorizontal, Undo2, X, type LucideIcon } from "lucide-react-native";
import { ScrollView as HScroll } from "react-native";
import { useAuth } from "@/auth/AuthContext";
import type { MainStackParamList } from "@/navigation/MainStack";
import { TAB_LISTS } from "@/navigation/navigationRef";
import { useSetupSections, useShellMenus } from "@/navigation/TopHeader";
import { useBrand } from "@/theme/ThemeContext";
import { fonts } from "@/theme/fonts";
import { CRM_GROUPS, CRM_REGISTERS, MENU_LISTS, isListedRegister, registerByKey, webPathOf, type CrmRegister } from "./crmRegisters";
import { useCrmCanOpen, useCrmOpen } from "./CrmRegisterScreen";
import { ATTENTION, AttentionList, CollectionPerProject, MoneyFigures, Pipeline, ProjectChips, ThisMonthCard, WeekAhead, useCrmDashboard } from "./CrmDashboardScreen";
import { Empty, Page, Tap, useCardStyle } from "./ui";

const n0 = (v: unknown) => Number(v) || 0;
/** "12 pending · 2 draft" from a server status list ([{ Status, Count }]), the statuses given, in that order. */
const statusLine = (rows: { Status: string; Count: number }[] | undefined, statuses: string[]) =>
  statuses.map((st) => ({ st, c: n0((rows ?? []).find((r) => r.Status === st)?.Count) })).filter((x) => x.c > 0)
    .map((x) => `${x.c} ${x.st.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()}`).join(" · ");

type Badge = { n: number; hot: boolean };
/** How many people / bookings the search shows before "Open … for all". */
const FOUND = 5;

/** One CRM list read the way its own page reads it (same query key, so they share the cache), only while searching. */
function useRegisterRows(key: string, enabled: boolean) {
  const reg = registerByKey(key)!;
  return useQuery({ queryKey: ["crm", key, ""], queryFn: async () => reg.rows(await crmGet(reg.path)), enabled });
}

export default function CrmHubScreen() {
  const b = useBrand();
  const card = useCardStyle();
  const nav = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const { canAccessPage, canDoAction } = useAuth();
  const menus = useShellMenus();
  const setupSections = useSetupSections();
  const [query, setQuery] = useState("");
  const [projectId, setProjectId] = useState<number | null>(null);
  const q = useCrmDashboard(projectId, canAccessPage("crm-dashboard"));
  const d = q.data;
  // Entries sent back for an update or resubmitted for a recheck, per web page (the web menu's badges).
  const sbQ = useQuery({
    queryKey: ["crm-sent-back"],
    queryFn: () => crmGet<{ byPath: Record<string, { SentBack: number; Resubmitted: number }>; sentBack: number; resubmitted: number; count: number }>("/api/crm/dashboard/sent-back"),
    enabled: ["crm-dashboard", "crm-bookings", "crm-applications", "crm-payments"].some((p) => canAccessPage(p)),
  });
  const sentBackLine = (r: CrmRegister) => {
    const s = sbQ.data?.byPath?.[webPathOf(r)];
    if (!s) return "";
    return [s.SentBack && `${s.SentBack} sent back`, s.Resubmitted && `${s.Resubmitted} to recheck`].filter(Boolean).join(" · ");
  };

  // Bookings has its own tab and the Menu has Customer 360, Service Tickets and Construction Updates.
  // Sent back & rechecks shows in "Needs attention" (with its count), not as a tile.
  const lists = CRM_REGISTERS.filter((r) => isListedRegister(r) && r.key !== "sent-back" && !TAB_LISTS.includes(r.key) && !MENU_LISTS.includes(r.key) && r.pages.some((p) => canAccessPage(p)));
  const setupItems = CRM_REGISTERS.filter((r) => r.group === "Setup" && r.pages.some((p) => canAccessPage(p)));

  // Each list's badge: what "Needs attention" counts in it (a hot one red).
  const badges = new Map<string, Badge>();
  for (const a of ATTENTION) {
    const n = n0(d?.alerts?.[a.key]);
    if (!a.register || !n) continue;
    const cur = badges.get(a.register) ?? { n: 0, hot: false };
    badges.set(a.register, { n: cur.n + n, hot: cur.hot || a.hot });
  }
  const lineOf = (r: CrmRegister): string => {
    if (r.key === "applications") return statusLine(d?.applications, ["Pending", "Draft"]) || r.about;
    if (r.key === "possession") return statusLine(d?.handovers, ["Scheduled", "InProgress", "Completed"]) || r.about;
    return r.about;
  };
  const open = (r: CrmRegister) => {
    if (r.key === "unit-matrix") { nav.navigate("CrmUnitMatrix"); return; }
    if (r.key === "parking-matrix") { nav.navigate("CrmParkingMatrix"); return; }
    nav.navigate("CrmRegister", { register: r.key });
  };

  const needle = query.trim().toLowerCase();
  const matchingSetup = needle ? setupItems.filter((r) => `${r.label} ${r.about} ${r.group}`.toLowerCase().includes(needle)) : [];
  // The search also finds buyers and bookings (from their lists), from two letters on.
  const openItem = useCrmOpen();
  const canOpen = useCrmCanOpen();
  const finding = needle.length >= 2;
  const people = useRegisterRows("customers", finding && canAccessPage("crm-customers"));
  const bookings = useRegisterRows("bookings", finding && canAccessPage("crm-bookings"));
  const found = (["customers", "bookings"] as const).map((key) => {
    const reg = registerByKey(key)!;
    const rows = (key === "customers" ? people : bookings).data ?? [];
    const hits = finding ? rows.filter((r) => (reg.searchIn?.(r) ?? []).some((v) => v != null && String(v).toLowerCase().includes(needle))) : [];
    return { reg, hits, loading: (key === "customers" ? people : bookings).isFetching && !rows.length };
  }).filter((f) => f.hits.length || f.loading);
  const shown = needle ? lists.filter((r) => `${r.label} ${r.about} ${r.group}`.toLowerCase().includes(needle)) : lists;
  const urgent = lists.filter((r) => badges.has(r.key)).sort((x, y) => Number(badges.get(y.key)!.hot) - Number(badges.get(x.key)!.hot) || badges.get(y.key)!.n - badges.get(x.key)!.n);

  const tile = (r: CrmRegister) => {
    const bd = badges.get(r.key);
    return (
      <Tap key={r.key} onPress={() => open(r)} accessibilityRole="button" accessibilityLabel={bd ? `${r.label}, ${bd.n} need attention` : r.label}
        style={({ pressed }) => ({ ...card, flexGrow: 1, flexBasis: "45%", padding: 14, gap: 10, borderRadius: 20, opacity: pressed ? 0.8 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" }}>
          <View style={{ width: 40, height: 40, borderRadius: 13, backgroundColor: b.accentSoft, alignItems: "center", justifyContent: "center" }}>
            <r.icon size={19} color={b.accent} />
          </View>
          {bd ? (
            <View style={{ minWidth: 24, height: 24, borderRadius: 12, paddingHorizontal: 7, backgroundColor: bd.hot ? b.danger : b.accent, alignItems: "center", justifyContent: "center" }}>
              <Text style={{ color: "#fff", fontSize: 11.5, fontFamily: fonts.heading.semibold }}>{bd.n > 99 ? "99+" : bd.n}</Text>
            </View>
          ) : null}
        </View>
        <View style={{ gap: 3 }}>
          <Text numberOfLines={1} style={{ fontSize: 14.5, fontFamily: fonts.heading.semibold, color: b.textPrimary, letterSpacing: -0.1 }}>{r.label}</Text>
          <Text numberOfLines={2} style={{ fontSize: 12, lineHeight: 16, fontFamily: fonts.body.regular, color: b.textSecondary }}>{lineOf(r)}</Text>
        </View>
        {sentBackLine(r) ? (
          <View style={{ alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: b.warningSoft }}>
            <Undo2 size={11} color={b.warning} />
            <Text numberOfLines={1} style={{ fontSize: 11, fontFamily: fonts.heading.semibold, color: b.warning }}>{sentBackLine(r)}</Text>
          </View>
        ) : null}
      </Tap>
    );
  };

  return (
    <Page tab gap={20} onRefresh={() => Promise.all([q.refetch(), sbQ.refetch()])}>
      {/* CRM Dashboard widgets — shown above the tile groups for users with the crm-dashboard right */}
      {canAccessPage("crm-dashboard") && d ? (
        <View style={{ gap: 16 }}>
          <ProjectChips projects={d.projects ?? []} value={projectId} onChange={setProjectId} />
          <ThisMonthCard d={d} />
          <MoneyFigures d={d} />
          <AttentionList d={d} links={false} />
          <Pipeline d={d} />
          <CollectionPerProject d={d} />
          <WeekAhead d={d} />
        </View>
      ) : null}

      {canAccessPage("crm-dashboard") && d ? (
        <View style={{ height: 1, backgroundColor: b.border }} />
      ) : null}

      {/* Search the lists */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, height: 48, paddingHorizontal: 14, borderRadius: 16, backgroundColor: b.surfaceCard, borderWidth: 1, borderColor: b.border }}>
        <Search size={18} color={b.textFaint} />
        <TextInput value={query} onChangeText={setQuery} placeholder="Search lists, buyers, bookings" placeholderTextColor={b.textFaint}
          style={{ flex: 1, fontSize: 15, fontFamily: fonts.body.regular, color: b.textPrimary }} returnKeyType="search" autoCorrect={false} />
        {query ? (
          <Tap onPress={() => setQuery("")} hitSlop={10} accessibilityLabel="Clear search">
            <X size={17} color={b.textSecondary} />
          </Tap>
        ) : null}
      </View>

      {/* Quick actions — New Customer / Application / Refund, shown when not searching */}
      {!needle ? (() => {
        const qas: { label: string; icon?: LucideIcon; onPress: () => void }[] = [];
        if (canDoAction("crm-customers", "create"))
          qas.push({ label: "New Customer", onPress: () => nav.navigate("CrmCustomerForm", {}) });
        if (canDoAction("crm-applications", "create"))
          qas.push({ label: "New Application", onPress: () => nav.navigate("CrmApplicationForm", {}) });
        if (canDoAction("crm-bookings", "create"))
          qas.push({ label: "New Booking", onPress: () => nav.navigate("CrmBookingNew") });
        if (canDoAction("crm-refunds", "create"))
          qas.push({ label: "New Refund", onPress: () => nav.navigate("CrmRefundNew") });
        if (canDoAction("crm-parking-booking", "create"))
          qas.push({ label: "New Parking Sale", onPress: () => nav.navigate("CrmParkingSale") });
        if (setupSections.length > 0)
          qas.push({ label: "CRM Setup", icon: SlidersHorizontal, onPress: () => menus.setup() });
        if (!qas.length) return null;
        return (
          <HScroll horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 2 }}>
            {qas.map((qa) => {
              const Icon = qa.icon ?? PlusCircle;
              return (
                <Tap key={qa.label} onPress={qa.onPress} accessibilityRole="button"
                  style={({ pressed }) => ({
                    flexDirection: "row", alignItems: "center", gap: 6,
                    paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20,
                    borderWidth: 1, borderColor: b.accent,
                    backgroundColor: pressed ? b.accentSoft : "transparent",
                    opacity: pressed ? 0.8 : 1,
                  })}>
                  <Icon size={14} color={b.accent} />
                  <Text style={{ fontSize: 13.5, fontFamily: fonts.heading.semibold, color: b.accent }}>{qa.label}</Text>
                </Tap>
              );
            })}
          </HScroll>
        );
      })() : null}

      {/* What needs attention now, list by list — hidden for crm-dashboard users since AttentionList above covers it */}
      {!canAccessPage("crm-dashboard") && !needle && (urgent.length || n0(sbQ.data?.count)) ? (
        <View style={{ gap: 10 }}>
          <Text style={{ fontSize: 12, fontFamily: fonts.heading.semibold, color: b.textFaint, letterSpacing: 0.8, textTransform: "uppercase", paddingHorizontal: 4 }}>Needs attention</Text>
          <View style={{ ...card, paddingVertical: 4 }}>
            {n0(sbQ.data?.count) ? (
              <Tap onPress={() => nav.navigate("CrmRegister", { register: "sent-back" })} accessibilityRole="button"
                style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 11, backgroundColor: pressed ? b.surfaceGlass : "transparent" })}>
                <View style={{ width: 4, alignSelf: "stretch", borderRadius: 2, backgroundColor: b.warning }} />
                <Undo2 size={18} color={b.warning} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ fontSize: 14.5, fontFamily: fonts.heading.semibold, color: b.textPrimary }}>Sent back & rechecks</Text>
                  <Text numberOfLines={1} style={{ fontSize: 12, fontFamily: fonts.body.regular, color: b.textSecondary }}>
                    {[n0(sbQ.data?.sentBack) && `${sbQ.data!.sentBack} sent back`, n0(sbQ.data?.resubmitted) && `${sbQ.data!.resubmitted} to recheck`].filter(Boolean).join(" · ")}
                  </Text>
                </View>
                <Text style={{ fontSize: 17, fontFamily: fonts.heading.semibold, color: b.warning, fontVariant: ["tabular-nums"] }}>{sbQ.data!.count}</Text>
              </Tap>
            ) : null}
            {urgent.map((r, i) => {
              const bd = badges.get(r.key)!;
              const tone = bd.hot ? b.danger : b.accent;
              return (
                <Tap key={r.key} onPress={() => open(r)} accessibilityRole="button"
                  style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 11,
                    borderTopWidth: i || n0(sbQ.data?.count) ? 1 : 0, borderTopColor: b.border, backgroundColor: pressed ? b.surfaceGlass : "transparent" })}>
                  <View style={{ width: 4, alignSelf: "stretch", borderRadius: 2, backgroundColor: tone }} />
                  <r.icon size={18} color={tone} />
                  <Text numberOfLines={1} style={{ flex: 1, fontSize: 14.5, fontFamily: fonts.heading.semibold, color: b.textPrimary }}>{r.label}</Text>
                  <Text style={{ fontSize: 17, fontFamily: fonts.heading.semibold, color: tone, fontVariant: ["tabular-nums"] }}>{bd.n}</Text>
                </Tap>
              );
            })}
          </View>
        </View>
      ) : null}

      {/* Buyers and bookings the search finds */}
      {found.map(({ reg, hits, loading }) => (
        <View key={reg.key} style={{ gap: 10 }}>
          <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8, paddingHorizontal: 4 }}>
            <Text style={{ flex: 1, fontSize: 17, fontFamily: fonts.heading.semibold, color: b.textPrimary, letterSpacing: -0.2 }}>{reg.label}</Text>
            <Text style={{ fontSize: 12.5, fontFamily: fonts.body.medium, color: b.textFaint }}>{loading ? "Searching…" : hits.length}</Text>
          </View>
          {hits.length ? (
            <View style={{ ...card, paddingVertical: 4, overflow: "hidden" }}>
              {hits.slice(0, FOUND).map((r, i) => {
                const t = reg.open?.(r);
                const target = canOpen(t) ? t : null;
                return (
                  <Tap key={reg.id(r)} disabled={!target} onPress={() => openItem(target)} accessibilityRole="button"
                    style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 11,
                      borderTopWidth: i ? 1 : 0, borderTopColor: b.border, backgroundColor: pressed ? b.surfaceGlass : "transparent" })}>
                    <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: b.accentSoft, alignItems: "center", justifyContent: "center" }}>
                      <reg.icon size={17} color={b.accent} />
                    </View>
                    <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
                      <Text numberOfLines={1} style={{ fontSize: 14.5, fontFamily: fonts.heading.semibold, color: b.textPrimary }}>{reg.title(r) || "—"}</Text>
                      <Text numberOfLines={1} style={{ fontSize: 12, fontFamily: fonts.body.regular, color: b.textSecondary }}>{reg.sub(r)}</Text>
                    </View>
                    {reg.status?.(r) ? <Text numberOfLines={1} style={{ fontSize: 11.5, fontFamily: fonts.heading.semibold, color: b.textSecondary }}>{reg.status(r)}</Text> : null}
                  </Tap>
                );
              })}
              {hits.length > FOUND ? (
                <Tap onPress={() => nav.navigate("CrmRegister", { register: reg.key })} accessibilityRole="button"
                  style={({ pressed }) => ({ paddingVertical: 12, alignItems: "center", borderTopWidth: 1, borderTopColor: b.border, backgroundColor: pressed ? b.surfaceGlass : "transparent" })}>
                  <Text style={{ fontSize: 13.5, fontFamily: fonts.heading.semibold, color: b.accent }}>{hits.length - FOUND} more — open {reg.label}</Text>
                </Tap>
              ) : null}
            </View>
          ) : null}
        </View>
      ))}

      {/* Every list, by the web menu's groups */}
      {CRM_GROUPS.map((g) => {
        const items = shown.filter((r) => r.group === g);
        if (!items.length) return null;
        return (
          <View key={g} style={{ gap: 10 }}>
            <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8, paddingHorizontal: 4 }}>
              <Text style={{ flex: 1, fontSize: 17, fontFamily: fonts.heading.semibold, color: b.textPrimary, letterSpacing: -0.2 }}>{g}</Text>
              <Text style={{ fontSize: 12.5, fontFamily: fonts.body.medium, color: b.textFaint }}>{items.length}</Text>
            </View>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>{items.map(tile)}</View>
          </View>
        );
      })}

      {/* Setup & Configuration matched by search */}
      {needle && matchingSetup.length > 0 ? (
        <View style={{ gap: 10 }}>
          <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8, paddingHorizontal: 4 }}>
            <Text style={{ flex: 1, fontSize: 17, fontFamily: fonts.heading.semibold, color: b.textPrimary, letterSpacing: -0.2 }}>Setup & Configuration</Text>
            <Text style={{ fontSize: 12.5, fontFamily: fonts.body.medium, color: b.textFaint }}>{matchingSetup.length}</Text>
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>{matchingSetup.map(tile)}</View>
        </View>
      ) : null}

      {/* Setup & Configuration card at bottom when browsing */}
      {!needle && setupSections.length > 0 ? (
        <View style={{ gap: 10, marginTop: 4 }}>
          <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8, paddingHorizontal: 4 }}>
            <Text style={{ flex: 1, fontSize: 17, fontFamily: fonts.heading.semibold, color: b.textPrimary, letterSpacing: -0.2 }}>
              Setup & Configuration
            </Text>
            <Text style={{ fontSize: 12.5, fontFamily: fonts.body.medium, color: b.textFaint }}>
              {setupSections.reduce((n, s) => n + s.rows.length, 0)} masters
            </Text>
          </View>

          <View style={{ ...card, padding: 16, gap: 14, borderRadius: 22 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: b.accentSoft, alignItems: "center", justifyContent: "center" }}>
                <SlidersHorizontal size={20} color={b.accent} />
              </View>
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <Text style={{ fontSize: 15.5, fontFamily: fonts.heading.semibold, color: b.textPrimary }}>
                  CRM Masters & Rates
                </Text>
                <Text numberOfLines={1} style={{ fontSize: 12.5, fontFamily: fonts.body.regular, color: b.textSecondary }}>
                  Configure projects, units, payment plans, milestones, GST & parking
                </Text>
              </View>
              <Tap
                onPress={menus.setup}
                accessibilityRole="button"
                style={({ pressed }) => ({
                  flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingVertical: 8,
                  borderRadius: 14, backgroundColor: b.accent, opacity: pressed ? 0.8 : 1,
                })}
              >
                <Text style={{ fontSize: 12.5, fontFamily: fonts.heading.semibold, color: "#FFFFFF" }}>Open Menu</Text>
                <ChevronRight size={14} color="#FFFFFF" />
              </Tap>
            </View>

            {/* Category chips */}
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, paddingTop: 4, borderTopWidth: 1, borderTopColor: b.border }}>
              {setupSections.map((sec) => (
                <Tap
                  key={sec.title}
                  onPress={menus.setup}
                  style={({ pressed }) => ({
                    flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 6,
                    borderRadius: 10, backgroundColor: b.isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.03)",
                    borderWidth: 1, borderColor: b.border, opacity: pressed ? 0.75 : 1,
                  })}
                >
                  <Text style={{ fontSize: 12, fontFamily: fonts.heading.semibold, color: b.textPrimary }}>{sec.title}</Text>
                  <View style={{ minWidth: 18, height: 18, borderRadius: 9, backgroundColor: b.accentSoft, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 }}>
                    <Text style={{ fontSize: 10.5, fontFamily: fonts.heading.semibold, color: b.accent }}>{sec.rows.length}</Text>
                  </View>
                </Tap>
              ))}
            </View>
          </View>
        </View>
      ) : null}

      {needle && !shown.length && !found.length && !matchingSetup.length ? <Empty text={`Nothing matches "${query.trim()}".`} /> : null}
      {!lists.length ? <Empty text="You don't have a right on any CRM page. Ask your admin for Menu Rights." /> : null}
    </Page>
  );
}
