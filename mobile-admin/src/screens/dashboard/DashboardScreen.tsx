// RN port of src/pages/admin/AdminDashboard.tsx — the Admin "Control center", on the drawing sheet as the web draws it.
// The sheet's title block: "CivilierERP · Admin", the title, a line on what the page is, and the drawing's corner box —
// the date, when it was read, and Re-read. Then four lettered details:
//   A Accounts         users, how many can sign in and the active share; a bar measuring every account out — active
//                      solid blue, discontinued hatched — with dimension lines under each part
//   B On record        roles, discontinued accounts, entries in the activity log
//   C Latest activity  the last six things done: the page (named as the web names it), what was done, by whom, when
//   D Newest accounts  the five latest accounts, with initials and an Active mark (or Discontinued)
// Numbers count up and parts rise in as on the web. Read from GET /api/admin-dashboard and /api/user-activity, every
// two minutes and on pull-down. Anyone who lands here without an admin role sees a plain access notice instead.
import { useState } from "react";
import { View, Text, ScrollView, RefreshControl } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useIsAdmin } from "@/auth/adminAccess";
import { fetchAdminDashboard, fetchRecentActivity, type AdminDashboardData } from "@/api/adminDashboardApi";
import { colors, sheet as S } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { Body, Detail, Dimension, Grow, Hatch, Label, Notice, Press, SheetFrame, SheetMark, Skel, Tick, TitleText } from "@/components/sheet/Sheet";

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

  const loading = dash.isLoading || activity.isLoading;
  const st = dash.data?.stats;
  const totalUsers = st?.totalUsers ?? 0;
  const activeUsers = st?.activeUsers ?? 0;
  const inactiveUsers = Math.max(0, totalUsers - activeUsers);
  const totalRoles = st?.totalRoles ?? 0;
  const actions = activity.data?.total ?? 0;
  const activePct = share(activeUsers, totalUsers);
  const recentUsers = dash.data?.recentUsers ?? [];
  const recent = activity.data?.data ?? [];
  const readAt = dash.dataUpdatedAt ? new Date(dash.dataUpdatedAt) : new Date();
  const reading = dash.isFetching || activity.isFetching;

  const reread = () => Promise.all([dash.refetch(), activity.refetch()]);
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
            <Body size={13} color={S.ink2}>Who has an account, who can still sign in, and what was last done in the system.</Body>
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
          <Detail tag="A" title="Accounts" note="All time">
            {loading ? (
              <>
                <Skel h={54} w="60%" />
                <Skel h={28} />
                <Skel w="70%" />
              </>
            ) : (
              <>
                <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "flex-end", columnGap: 30, rowGap: 14 }}>
                  <BigFigure label="Users" value={totalUsers} />
                  <BigFigure label="Can sign in" value={activeUsers} color={S.ink2} />
                  <View style={{ marginLeft: "auto", alignItems: "flex-end" }}>
                    <Label>Active</Label>
                    <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 30, letterSpacing: -0.9, color: S.blue, marginTop: 8, fontVariant: ["tabular-nums"] }}>
                      {Math.round(activePct)}
                      <Text style={{ fontSize: 15, fontFamily: fonts.heading.medium }}> %</Text>
                    </Text>
                  </View>
                </View>

                {/* Every account, measured out: active solid, discontinued hatched. */}
                <View style={{ marginTop: 22 }}>
                  <View style={{ height: 30, borderWidth: 1.5, borderColor: S.ink, backgroundColor: S.paper, overflow: "hidden" }}>
                    <Hatch id="admin-accounts" />
                    <Grow style={{ height: "100%", width: `${activePct}%`, backgroundColor: S.blue }} />
                  </View>
                  <View style={{ flexDirection: "row" }}>
                    <View style={{ width: `${Math.min(Math.max(activePct, 24), 76)}%`, overflow: "hidden" }}>
                      <Dimension text={`${fmtNum(activeUsers)} active`} color={S.blue} />
                    </View>
                    <View style={{ flex: 1, overflow: "hidden" }}>
                      <Dimension text={`${fmtNum(inactiveUsers)} discontinued`} />
                    </View>
                  </View>
                </View>
              </>
            )}
          </Detail>
        )}

        {isAdmin && (
          <Detail tag="B" title="On record">
            {loading ? (
              <>
                <Skel h={40} />
                <Skel h={40} />
                <Skel h={40} />
              </>
            ) : (
              <View>
                {[
                  { label: "Roles", value: totalRoles, sub: "that rights are granted to" },
                  { label: "Discontinued", value: inactiveUsers, sub: inactiveUsers ? "accounts that can no longer sign in" : "every account can sign in" },
                  { label: "Activity logged", value: actions, sub: "entries in the activity log" },
                ].map((s, i) => (
                  <View key={s.label} style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 12, paddingVertical: 13, borderTopWidth: i ? 1 : 0, borderTopColor: S.ruleSoft }}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Label color={S.ink}>{s.label}</Label>
                      <Body size={12} color={S.graphite} style={{ marginTop: 4 }}>{s.sub}</Body>
                    </View>
                    <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 28, letterSpacing: -0.8, color: S.ink, fontVariant: ["tabular-nums"] }}>
                      <Tick value={s.value} />
                    </Text>
                  </View>
                ))}
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
