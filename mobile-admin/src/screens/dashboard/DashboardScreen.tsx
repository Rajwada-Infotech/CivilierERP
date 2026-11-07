// The Admin app's "Control center", on the drawing sheet as the web's AdminDashboard draws it: the title block with the
// drawing's corner box (the date, when it was read, Re-read), then four lettered details, the first two about what this
// app is for:
//   A Approvals        how many records are waiting, how many this admin can act on now, how many have waited over a
//                      week (red); a bar measuring them out by age — over a week red, this week ink, today blue — with
//                      dimension lines under it, and a key to the Approval Inbox
//   B Set-up           three small charts, each opening its page:
//                        Approval rules by area  a bar per area (Material, Engineering, Finance, Sales, CRM): the
//                                                approvable modules a switched-on rule covers, of the area's; red note
//                                                when a switched-on rule has a step no one can approve
//                        People by role          a bar per role, active people, longest first (past six fold into
//                                                Other); accounts, discontinued and unused roles under it
//                        Financial year          the current year as a timeline from its start to its end, filled to
//                                                today with a Today mark, % through and days left; Locked when locked
//   C Latest activity  the last six things done: the page (named as the web names it), what was done, by whom, when
//   D Newest accounts  the five latest accounts, with initials and an Active mark (or Discontinued)
// Numbers count up and parts rise in as on the web. Read from the approval inbox, the approval rules, the financial years,
// GET /api/admin-dashboard and /api/user-activity — every two minutes (the inbox every minute) and on pull-down. Anyone
// who lands here without an admin role sees a plain access notice instead.
import { useState } from "react";
import { View, Text, ScrollView, RefreshControl } from "react-native";
import { ChevronRight, Lock } from "lucide-react-native";
import { useQuery } from "@tanstack/react-query";
import { useIsAdmin } from "@/auth/adminAccess";
import { fetchAdminDashboard, fetchRecentActivity, type AdminDashboardData } from "@/api/adminDashboardApi";
import { fetchInbox } from "@/api/approvalInboxApi";
import { fetchWorkflows } from "@/api/approvalSetupApi";
import { getAllFinYears } from "@/api/finYearRightsApi";
import { getUsers } from "@/api/passwordResetApi";
import { MODULE_GROUPS, MODULE_OPTIONS } from "@/screens/admin/approvalSetupConfig";
import { ageOf } from "@/notifications/ApprovalBell";
import { navigate } from "@/navigation/navigationRef";
import { colors, sheet as S } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { Body, Detail, Grow, Label, Notice, Press, SheetFrame, SheetMark, Skel, Tick, TitleText } from "@/components/sheet/Sheet";

const fmtNum = (n: number) => new Intl.NumberFormat("en-IN").format(n);
const share = (part: number, whole: number) => (whole > 0 ? Math.min(100, Math.max(0, (part / whole) * 100)) : 0);

const relTime = (ts: string) => {
  const m = Math.floor((Date.now() - new Date(ts).getTime()) / 60_000);
  if (m < 1) return "Just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};

const initialsOf = (name: string) =>
  name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("") || "?";

// The web's page names for the activity log's resources (AdminDashboard.tsx PAGE_NAME_MAP).
const PAGE_NAME_MAP: Record<string, string> = {
  login: "Login", logout: "Logout", payments: "Payment", "received-payments": "Received Payment", transactions: "Transactions",
  brs: "BRS", reports: "Reports", "finance-dashboard": "Finance Dashboard", "material/purchase-order": "Purchase Order",
  "material/grn": "GRN", "material/material-request": "Material Request", "material/issues": "Material Issues", "material/stock": "Stock",
  "material/stock-transfer": "Stock Transfer", "material/expense-booking": "Expense Booking", "material-dashboard": "Material Dashboard",
  "engineering/work-order": "Work Order", "engineering/boq": "BOQ", "engineering/work-done": "Work Done", "masters/contractors": "Contractors",
  "masters/suppliers": "Suppliers", "masters/customers": "Customers", "masters/banks": "Bank Master", "masters/expenses": "Expense Master",
  "masters/items": "Item Master", "masters/item-groups": "Item Groups", "masters/hsn": "HSN Master", "masters/account-group": "Account Group",
  "masters/billing-terms": "Billing Terms", "masters/general-ledger": "General Ledger", "masters/financial-year": "Financial Year",
  "masters/role-master": "Role Master", "masters/type-of-doc": "Type of Doc", "admin/rights/menu": "Menu Rights",
  "admin/rights/widgets": "Widgets Rights", "admin/rights/fin-year": "Fin Year Rights", "admin/approval/setup": "Approval Setup",
  "admin/masters/company": "Company Master", "admin/masters/project": "Project Master", "admin/masters/enterprise": "Enterprise",
  "admin/masters/menu-types": "Menu Types", "admin/masters/page-definitions": "Page Definitions", "followup/applicants": "Applicants",
  "followup/bookings": "Bookings", "followup/agreements": "Agreements", "followup/noc": "NOC", "followup/sales-deed": "Sales Deed",
  "followup/handover": "Handover", "followup/log": "Followup Log", tasks: "Tasks", "ticket/my-tickets": "My Tickets",
  "ticket/all-tickets": "All Tickets", "ticket/pending": "Pending Tickets", widgets: "Widgets", "approval-inbox": "Approval Inbox",
};
const PAGE_KEYS_LONGEST = Object.keys(PAGE_NAME_MAP).sort((a, b) => b.length - a.length);
function pageName(resource?: string): string {
  if (!resource) return "System";
  const clean = resource.replace(/^\//, "").split("?")[0];
  if (PAGE_NAME_MAP[clean]) return PAGE_NAME_MAP[clean];
  const match = PAGE_KEYS_LONGEST.find((k) => clean.startsWith(k));
  if (match) return PAGE_NAME_MAP[match];
  const segs = clean.split("/").filter(Boolean);
  return (segs[segs.length - 1] ?? clean).replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** A big figure that counts up, with its capital label above. */
function BigFigure({ label, value, color = S.ink, size = 44 }: { label: string; value: number; color?: string; size?: number }) {
  return (
    <View>
      <Label>{label}</Label>
      <Text style={{ fontFamily: fonts.heading.semibold, fontSize: size, lineHeight: size * 1.05, letterSpacing: -size * 0.03, color, marginTop: 8, fontVariant: ["tabular-nums"] }}>
        <Tick value={value} />
      </Text>
    </View>
  );
}

/** One Set-up chart: a ruled block with its capital title and a chevron, the whole block opening its page. */
function ChartBlock({ title, note, onPress, children, first }: { title: string; note?: string; onPress: () => void; children: React.ReactNode; first?: boolean }) {
  return (
    <Press onPress={onPress} style={(pressed) => ({ paddingVertical: 14, gap: 12, borderTopWidth: first ? 0 : 1, borderTopColor: S.rule, backgroundColor: pressed ? S.blueWash : "transparent" })}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Label color={S.ink} style={{ flex: 1 }}>{title}</Label>
        {!!note && <Label>{note}</Label>}
        <ChevronRight size={13} color={S.graphite} />
      </View>
      {children}
    </Press>
  );
}

/** A horizontal bar: the name on the left, a track scaled to `max`, the filled part, and its value at the end. */
function BarRow({ name, value, max, label, color = S.ink }: { name: string; value: number; max: number; label: string; color?: string }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      <Text numberOfLines={1} style={{ width: 92, fontFamily: fonts.body.medium, fontSize: 12, color: S.ink }}>{name}</Text>
      <View style={{ flex: 1, height: 12, backgroundColor: S.line15 }}>
        <Grow style={{ height: "100%", width: `${pct}%`, backgroundColor: color }} />
      </View>
      <Text style={{ width: 44, textAlign: "right", fontFamily: fonts.heading.semibold, fontSize: 12, color: S.ink, fontVariant: ["tabular-nums"] }}>{label}</Text>
    </View>
  );
}

const fmtDay = (ms: number) => new Date(ms).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

export default function DashboardScreen() {
  const isAdmin = useIsAdmin();
  const [refreshing, setRefreshing] = useState(false);

  const dash = useQuery<AdminDashboardData>({
    queryKey: ["admin-dashboard"],
    queryFn: fetchAdminDashboard,
    enabled: isAdmin,
    staleTime: 60_000,
    refetchInterval: 2 * 60_000,
    retry: 2,
  });
  const activity = useQuery({
    queryKey: ["admin-activity"],
    queryFn: () => fetchRecentActivity(6),
    enabled: isAdmin,
    staleTime: 60_000,
    refetchInterval: 90_000,
    retry: 1,
  });

  // The same queries (and keys) the Approval Inbox, Approval Setup and Financial years pages use, so they share one cache.
  const inbox = useQuery({ queryKey: ["approval-inbox"], queryFn: fetchInbox, enabled: isAdmin, refetchInterval: 60_000, staleTime: 30_000 });
  const rules = useQuery({ queryKey: ["approval-workflows"], queryFn: fetchWorkflows, enabled: isAdmin, staleTime: 30_000, refetchInterval: 2 * 60_000 });
  const years = useQuery({ queryKey: ["fin-years"], queryFn: getAllFinYears, enabled: isAdmin, staleTime: 60_000, refetchInterval: 5 * 60_000 });
  const people = useQuery({ queryKey: ["reset-users"], queryFn: getUsers, enabled: isAdmin, staleTime: 60_000, refetchInterval: 5 * 60_000 });

  const loading = dash.isLoading || activity.isLoading;
  const waitingItems = Array.isArray(inbox.data) ? inbox.data : [];
  const waiting = waitingItems.length;
  const forYou = waitingItems.filter((it) => it._canAct !== false).length;
  const ages = waitingItems.map((it) => ageOf(it.RecordDate).age);
  const old = ages.filter((a) => a === "old").length;
  const today = ages.filter((a) => a === "today").length;
  const week = waiting - old - today;
  const ruleList = Array.isArray(rules.data) ? rules.data : [];
  const rulesOn = ruleList.filter((r) => r.active).length;
  const yearList = Array.isArray(years.data) ? years.data : [];
  const currentYear = yearList.find((y) => y.status === "Active") ?? null;

  // Approval rules: per area, how many approvable modules a switched-on rule covers; and any switched-on rule with a step
  // that no one (neither a named person nor a role) can approve — records on it would wait forever.
  const covered = new Set(ruleList.filter((r) => r.active).flatMap((r) => r.modules ?? []));
  const validIds = new Set(MODULE_OPTIONS.map((m) => m.id));
  const areas = MODULE_GROUPS.map((g) => {
    const mods = g.modules.filter((m) => validIds.has(m));
    return { label: g.label, total: mods.length, covered: mods.filter((m) => covered.has(m)).length };
  }).filter((a) => a.total > 0);
  const coveredCount = areas.reduce((n, a) => n + a.covered, 0);
  const coverableCount = areas.reduce((n, a) => n + a.total, 0);
  const stuckRules = ruleList.filter((r) => r.active && (r.levels ?? []).some((l) => !(l.userIds?.length) && !(l.roles?.length))).length;
  // Financial year: the current one as a timeline.
  const yearStart = currentYear ? new Date(currentYear.startDate).getTime() : NaN;
  const yearEnd = currentYear ? new Date(currentYear.endDate).getTime() : NaN;
  const yearOk = yearEnd > yearStart;
  const yearPct = yearOk ? share(Date.now() - yearStart, yearEnd - yearStart) : 0;
  const daysLeft = yearOk ? Math.max(0, Math.ceil((yearEnd - Date.now()) / 86_400_000)) : 0;
  // People by role, from the full user list (Password reset's): active people per role, longest first, past six as Other.
  const userList = Array.isArray(people.data) ? people.data : [];
  const roleCounts = new Map<string, number>();
  userList.filter((u) => u.isActive).forEach((u) => {
    const r = u.role || "No role";
    roleCounts.set(r, (roleCounts.get(r) ?? 0) + 1);
  });
  const roleRows = [...roleCounts.entries()].sort((x, y) => y[1] - x[1]);
  const roleBars = roleRows.length > 7 ? [...roleRows.slice(0, 6), ["Other", roleRows.slice(6).reduce((n, r) => n + r[1], 0)] as [string, number]] : roleRows;
  const roleMax = Math.max(1, ...roleBars.map((r) => r[1]));
  const rolesHeld = roleRows.filter(([r]) => r !== "No role").length;
  const roleName = (r: string) => (r === "Other" || r === "No role" ? r : r.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()));

  const st = dash.data?.stats;
  const totalUsers = st?.totalUsers ?? 0;
  const activeUsers = st?.activeUsers ?? 0;
  const inactiveUsers = Math.max(0, totalUsers - activeUsers);
  const totalRoles = st?.totalRoles ?? 0;
  const actions = activity.data?.total ?? 0;
  const recentUsers = dash.data?.recentUsers ?? [];
  const recent = activity.data?.data ?? [];
  const readAt = dash.dataUpdatedAt ? new Date(dash.dataUpdatedAt) : new Date();

  const reading = dash.isFetching || activity.isFetching || inbox.isFetching || rules.isFetching || years.isFetching || people.isFetching;

  const reread = () => Promise.all([dash.refetch(), activity.refetch(), inbox.refetch(), rules.refetch(), years.refetch(), people.refetch()]);
  const onRefresh = async () => {
    setRefreshing(true);
    await reread();
    setRefreshing(false);
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ paddingBottom: 96 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={S.ink} />}
    >
      <SheetFrame>
        {/* Title block, with the drawing's corner box: date, when read, Re-read. */}
        <View>
          <View style={{ paddingHorizontal: 16, paddingTop: 20, paddingBottom: 18, gap: 8 }}>
            <Label>CivilierERP · Admin</Label>
            <TitleText size={30}>Control center</TitleText>
            <Body size={13} color={S.ink2}>What is waiting for approval, how the approvals and rights are set up, and what was last done in the system.</Body>
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", borderTopWidth: 1, borderTopColor: S.ink }}>
            <View style={{ width: "100%", paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: S.ink, gap: 3 }}>
              <Label>Date</Label>
              <Body size={13}>{readAt.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</Body>
            </View>
            <View style={{ width: "50%", paddingHorizontal: 14, paddingVertical: 10, borderRightWidth: 1, borderRightColor: S.ink, gap: 3 }}>
              <Label>Read at</Label>
              <Body size={13}>{readAt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</Body>
            </View>
            <Press onPress={() => void reread()} disabled={reading} style={(pressed) => ({ width: "50%", paddingHorizontal: 14, paddingVertical: 10, justifyContent: "flex-end", backgroundColor: pressed ? S.blueWash : "transparent" })}>
              <Label color={S.blue}>{reading ? "Reading…" : "Re-read"}</Label>
            </Press>
          </View>
        </View>

        {!isAdmin ? (
          <View style={{ borderTopWidth: 1, borderTopColor: S.rule, padding: 14 }}>
            <Notice tone="ink">The Control center is for admins and super admins. Ask your administrator if you need access.</Notice>
          </View>
        ) : dash.isError ? (
          <View style={{ borderTopWidth: 1, borderTopColor: S.rule, padding: 14 }}>
            <Notice>Could not load the dashboard. Use Re-read or pull down to try again.</Notice>
          </View>
        ) : null}

        {isAdmin && (
          <Detail tag="A" title="Approvals" note="Waiting now">
            {inbox.isLoading ? (
              <>
                <Skel h={54} w="60%" />
                <Skel h={28} />
                <Skel w="70%" />
              </>
            ) : inbox.isError ? (
              <Body size={13} color={S.graphite}>Could not read the approval inbox. Use Re-read to try again.</Body>
            ) : (
              <>
                <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "flex-end", columnGap: 30, rowGap: 14 }}>
                  <BigFigure label="Waiting" value={waiting} />
                  <BigFigure label="For you" value={forYou} color={S.ink2} />
                  <View style={{ marginLeft: "auto", alignItems: "flex-end" }}>
                    <Label color={old ? S.red : S.graphite}>Over a week</Label>
                    <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 30, letterSpacing: -0.9, color: old ? S.red : S.ink, marginTop: 8, fontVariant: ["tabular-nums"] }}>
                      <Tick value={old} />
                    </Text>
                  </View>
                </View>

                {waiting === 0 ? (
                  <Body size={13} color={S.graphite} style={{ marginTop: 16 }}>Nothing is waiting for approval.</Body>
                ) : (
                  // Everything waiting, measured out by how long it has waited.
                  <View style={{ marginTop: 22 }}>
                    <View style={{ height: 30, flexDirection: "row", borderWidth: 1.5, borderColor: S.ink, backgroundColor: S.paper, overflow: "hidden" }}>
                      {old > 0 && <Grow style={{ height: "100%", width: `${share(old, waiting)}%`, backgroundColor: S.red }} />}
                      {week > 0 && <Grow delay={80} style={{ height: "100%", width: `${share(week, waiting)}%`, backgroundColor: S.ink }} />}
                      {today > 0 && <Grow delay={160} style={{ height: "100%", width: `${share(today, waiting)}%`, backgroundColor: S.blue }} />}
                    </View>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 14, rowGap: 4, marginTop: 8 }}>
                      {[
                        { label: "over a week", n: old, color: S.red },
                        { label: "this week", n: week, color: S.ink },
                        { label: "today", n: today, color: S.blue },
                      ].map((p) => (
                        <View key={p.label} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                          <View style={{ width: 9, height: 9, backgroundColor: p.color }} />
                          <Text style={{ fontFamily: fonts.body.regular, fontSize: 12, color: S.graphite }}>
                            <Text style={{ fontFamily: fonts.heading.semibold, color: S.ink }}>{fmtNum(p.n)}</Text>
                            {` ${p.label}`}
                          </Text>
                        </View>
                      ))}
                    </View>
                  </View>
                )}

                <Press
                  onPress={() => navigate("ApprovalInbox")}
                  style={(pressed) => ({ marginTop: 16, minHeight: 40, flexDirection: "row", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: S.ink, backgroundColor: pressed ? S.blueWash : "transparent" })}
                >
                  <Label color={S.ink}>Open the approval inbox</Label>
                </Press>
              </>
            )}
          </Detail>
        )}

        {isAdmin && (
          <Detail tag="B" title="Set-up" note="Tap a chart to open it">
            {loading || rules.isLoading || years.isLoading || people.isLoading ? (
              <>
                <Skel h={110} />
                <Skel h={110} />
                <Skel h={70} />
              </>
            ) : (
              <View style={{ marginTop: -14 }}>
                {/* Approval rules by area */}
                <ChartBlock first title="Approval rules by area" note={rules.isError ? undefined : `${coveredCount}/${coverableCount} modules`} onPress={() => navigate("ApprovalSetup")}>
                  {rules.isError ? (
                    <Body size={12.5} color={S.graphite}>Could not read the approval rules.</Body>
                  ) : (
                    <View style={{ gap: 9 }}>
                      {areas.map((ar) => (
                        <BarRow key={ar.label} name={ar.label} value={ar.covered} max={ar.total} label={`${ar.covered}/${ar.total}`} />
                      ))}
                      <Text style={{ fontFamily: fonts.body.regular, fontSize: 11.5, color: stuckRules || rulesOn === 0 ? S.red : S.graphite }}>
                        {stuckRules
                          ? `${stuckRules} switched-on rule${stuckRules === 1 ? " has" : "s have"} a step no one can approve.`
                          : rulesOn === 0
                            ? "No rule is switched on: nothing needs approval."
                            : `Modules covered by a switched-on rule · ${rulesOn} of ${ruleList.length} rule${ruleList.length === 1 ? "" : "s"} on`}
                      </Text>
                    </View>
                  )}
                </ChartBlock>

                {/* People by role */}
                <ChartBlock title="People by role" note={`${fmtNum(activeUsers)} active`} onPress={() => navigate("PasswordReset")}>
                  {people.isError ? (
                    <Body size={12.5} color={S.graphite}>Could not read the user list.</Body>
                  ) : roleBars.length === 0 ? (
                    <Body size={12.5} color={S.graphite}>No active accounts.</Body>
                  ) : (
                    <View style={{ gap: 9 }}>
                      {roleBars.map(([r, n]) => (
                        <BarRow key={r} name={roleName(r)} value={n} max={roleMax} label={fmtNum(n)} color={r === "Other" || r === "No role" ? S.graphite : S.ink} />
                      ))}
                      <Text style={{ fontFamily: fonts.body.regular, fontSize: 11.5, color: S.graphite }}>
                        {`${fmtNum(totalUsers)} accounts · ${fmtNum(inactiveUsers)} discontinued · ${Math.max(0, totalRoles - rolesHeld)} of ${fmtNum(totalRoles)} roles unused`}
                      </Text>
                    </View>
                  )}
                </ChartBlock>

                {/* Financial year, as a timeline */}
                <ChartBlock title="Financial year" note={currentYear?.year} onPress={() => navigate("FinYearRights")}>
                  {years.isError ? (
                    <Body size={12.5} color={S.graphite}>Could not read the financial years.</Body>
                  ) : !currentYear || !yearOk ? (
                    <Text style={{ fontFamily: fonts.body.regular, fontSize: 12.5, color: S.red }}>No active financial year is set up.</Text>
                  ) : (
                    <View style={{ gap: 6 }}>
                      <View style={{ height: 22, justifyContent: "center" }}>
                        <View style={{ height: 12, backgroundColor: S.line15 }}>
                          <Grow style={{ height: "100%", width: `${yearPct}%`, backgroundColor: currentYear.locked ? S.red : S.blue }} />
                        </View>
                        {/* Today */}
                        <View style={{ position: "absolute", left: `${yearPct}%`, top: 0, bottom: 0, width: 2, marginLeft: -1, backgroundColor: S.ink }} />
                      </View>
                      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                        <Text style={{ fontFamily: fonts.body.regular, fontSize: 11, color: S.graphite }}>{fmtDay(yearStart)}</Text>
                        <Text style={{ fontFamily: fonts.body.regular, fontSize: 11, color: S.graphite }}>{fmtDay(yearEnd)}</Text>
                      </View>
                      <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8, marginTop: 2 }}>
                        <Text style={{ fontFamily: fonts.body.regular, fontSize: 12, color: S.graphite }}>
                          <Text style={{ fontFamily: fonts.heading.semibold, color: S.ink }}>{`${Math.round(yearPct)}%`}</Text>
                          {" through · "}
                          <Text style={{ fontFamily: fonts.heading.semibold, color: S.ink }}>{fmtNum(daysLeft)}</Text>
                          {` day${daysLeft === 1 ? "" : "s"} left`}
                        </Text>
                        {currentYear.locked && (
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 6, paddingVertical: 2, backgroundColor: S.red }}>
                            <Lock size={9} color="#ffffff" />
                            <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 9, letterSpacing: 0.9, textTransform: "uppercase", color: "#ffffff" }}>Locked</Text>
                          </View>
                        )}
                      </View>
                    </View>
                  )}
                </ChartBlock>
              </View>
            )}
          </Detail>
        )}

        {isAdmin && (
          <Detail tag="C" title="Latest activity" note={`${fmtNum(actions)} in all`}>
            {loading ? (
              <>
                <Skel h={26} />
                <Skel h={26} />
                <Skel h={26} />
              </>
            ) : activity.isError ? (
              <Body size={13} color={S.graphite}>Could not read the activity log.</Body>
            ) : recent.length === 0 ? (
              <Body size={13} color={S.graphite}>Nothing has been logged yet.</Body>
            ) : (
              <View>
                <View style={{ flexDirection: "row", paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: S.ink }}>
                  <Label style={{ flex: 1 }}>Page · by</Label>
                  <Label>When</Label>
                </View>
                {recent.map((a, i) => {
                  const sub = a.details || (a.actionType ? a.actionType.replace(/_/g, " ") : a.event);
                  return (
                    <View key={a.id || i} style={{ flexDirection: "row", alignItems: "flex-start", gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: S.ruleSoft }}>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text numberOfLines={1} style={{ fontFamily: fonts.body.semibold, fontSize: 13, color: S.ink }}>{pageName(a.resource)}</Text>
                        {!!sub && <Text numberOfLines={1} style={{ fontFamily: fonts.body.regular, fontSize: 11.5, color: S.graphite, marginTop: 1 }}>{sub}</Text>}
                        <Text numberOfLines={1} style={{ fontFamily: fonts.body.regular, fontSize: 11.5, color: S.ink2, marginTop: 2 }}>{a.userName || a.userEmail || "—"}</Text>
                      </View>
                      <View style={{ alignItems: "flex-end" }}>
                        <Text style={{ fontFamily: fonts.heading.medium, fontSize: 12, color: S.ink, fontVariant: ["tabular-nums"] }}>{relTime(a.timestamp)}</Text>
                        <Text style={{ fontFamily: fonts.body.regular, fontSize: 11, color: S.graphite, marginTop: 2, fontVariant: ["tabular-nums"] }}>
                          {new Date(a.timestamp).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </Detail>
        )}

        {isAdmin && (
          <Detail tag="D" title="Newest accounts">
            {loading ? (
              <>
                <Skel h={26} />
                <Skel h={26} />
                <Skel h={26} />
              </>
            ) : recentUsers.length === 0 ? (
              <Body size={13} color={S.graphite}>No users found.</Body>
            ) : (
              <View>
                {recentUsers.map((u, i) => (
                  <View key={u.id} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 9, borderTopWidth: i ? 1 : 0, borderTopColor: S.ruleSoft }}>
                    <View style={{ width: 28, height: 28, borderWidth: 1, borderColor: S.ink, alignItems: "center", justifyContent: "center" }}>
                      <Text style={{ fontFamily: fonts.heading.bold, fontSize: 10, color: S.ink }}>{initialsOf(u.name)}</Text>
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text numberOfLines={1} style={{ fontFamily: fonts.body.semibold, fontSize: 13, color: S.ink }}>{u.name}</Text>
                      <Text numberOfLines={1} style={{ fontFamily: fonts.body.regular, fontSize: 11.5, color: S.graphite }}>{u.email}</Text>
                    </View>
                    {u.discontinue ? <Label>Discontinued</Label> : <SheetMark text="Active" tone="done" />}
                  </View>
                ))}
              </View>
            )}
          </Detail>
        )}
      </SheetFrame>
    </ScrollView>
  );
}
