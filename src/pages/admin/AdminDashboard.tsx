import { useQuery } from "@tanstack/react-query";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { SHEET_CSS, Detail, Dimension, Skel, SheetMark } from "@/components/sheet/Sheet";

// ─── TYPES ────────────────────────────────────────────────────────────────────
interface AdminUser {
  id: number;
  name: string;
  email: string;
  created_datetime: string;
  discontinue: number;
}

interface ActivityRow {
  id: string;
  userName: string;
  userEmail: string;
  userRole: string;
  event: string;
  actionType: string;
  resource: string;
  details: string;
  timestamp: string;
}

interface DashboardPayload {
  stats: { totalUsers: number; totalRoles: number; activeUsers: number };
  recentUsers: AdminUser[];
}

interface ActivityPayload {
  data: ActivityRow[];
  total: number;
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const getRelativeTime = (timestamp: string) => {
  const diffMinutes = Math.floor(
    (Date.now() - new Date(timestamp).getTime()) / 1000 / 60,
  );
  if (diffMinutes < 1) return "Just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const hours = Math.floor(diffMinutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
};

const getInitials = (name: string) =>
  name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("") || "?";

const PAGE_NAME_MAP: Record<string, string> = {
  login: "Login",
  logout: "Logout",
  payments: "Payment",
  "received-payments": "Received Payment",
  transactions: "Transactions",
  brs: "BRS",
  reports: "Reports",
  "finance-dashboard": "Finance Dashboard",
  "material/purchase-order": "Purchase Order",
  "material/grn": "GRN",
  "material/material-request": "Material Request",
  "material/issues": "Material Issues",
  "material/stock": "Stock",
  "material/stock-transfer": "Stock Transfer",
  "material/expense-booking": "Expense Booking",
  "material-dashboard": "Material Dashboard",
  "engineering/work-order": "Work Order",
  "engineering/boq": "BOQ",
  "engineering/work-done": "Work Done",
  "masters/contractors": "Contractors",
  "masters/suppliers": "Suppliers",
  "masters/customers": "Customers",
  "masters/banks": "Bank Master",
  "masters/expenses": "Expense Master",
  "masters/items": "Item Master",
  "masters/item-groups": "Item Groups",
  "masters/hsn": "HSN Master",
  "masters/account-group": "Account Group",
  "masters/billing-terms": "Billing Terms",
  "masters/general-ledger": "General Ledger",
  "masters/financial-year": "Financial Year",
  "masters/role-master": "Role Master",
  "masters/type-of-doc": "Type of Doc",
  "admin/rights/menu": "Menu Rights",
  "admin/rights/widgets": "Widgets Rights",
  "admin/rights/fin-year": "Fin Year Rights",
  "admin/approval/setup": "Approval Setup",
  "admin/masters/company": "Company Master",
  "admin/masters/project": "Project Master",
  "admin/masters/enterprise": "Enterprise",
  "admin/masters/menu-types": "Menu Types",
  "admin/masters/page-definitions": "Page Definitions",
  "followup/applicants": "Applicants",
  "followup/bookings": "Bookings",
  "followup/agreements": "Agreements",
  "followup/noc": "NOC",
  "followup/sales-deed": "Sales Deed",
  "followup/handover": "Handover",
  "followup/log": "Followup Log",
  tasks: "Tasks",
  "ticket/my-tickets": "My Tickets",
  "ticket/all-tickets": "All Tickets",
  "ticket/pending": "Pending Tickets",
  widgets: "Widgets",
  "approval-inbox": "Approval Inbox",
};

const getPageName = (resource?: string): string => {
  if (!resource) return "System";
  const clean = resource.replace(/^\//, "").split("?")[0];
  if (PAGE_NAME_MAP[clean]) return PAGE_NAME_MAP[clean];
  const match = Object.keys(PAGE_NAME_MAP)
    .sort((a, b) => b.length - a.length)
    .find((k) => clean.startsWith(k));
  if (match) return PAGE_NAME_MAP[match];
  const segments = clean.split("/").filter(Boolean);
  const last = segments[segments.length - 1] ?? clean;
  return last.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
};

// ─── COMPONENT ────────────────────────────────────────────────────────────────
const fmtNum = (n: number) => new Intl.NumberFormat("en-IN").format(n);
const share = (part: number, whole: number) => (whole > 0 ? Math.min(100, Math.max(0, (part / whole) * 100)) : 0);

export default function AdminDashboard() {
  usePageRights("admin-dashboard");
  const {
    data: dashData,
    isLoading: dashLoading,
    isError: dashError,
    refetch,
    isFetching,
    dataUpdatedAt,
  } = useQuery<DashboardPayload>({
    queryKey: ["adminDashboard"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/admin-dashboard");
      if (!res.ok) throw new Error("Failed to fetch dashboard");
      return res.json().catch(() => ({}));
    },
    staleTime: 60_000,
    refetchInterval: 2 * 60_000,
    refetchOnWindowFocus: true,
  });

  const { data: activityData, isLoading: activityLoading } =
    useQuery<ActivityPayload>({
      queryKey: ["adminActivity"],
      queryFn: async () => {
        const res = await fetchWithAuth("/api/user-activity?limit=6&page=1");
        if (!res.ok) throw new Error("Failed to fetch activity log");
        return res.json().catch(() => ({}));
      },
      staleTime: 60_000,
      refetchInterval: 90_000,
      refetchOnWindowFocus: true,
    });

  const loading = dashLoading || activityLoading;

  const stats = dashData?.stats
    ? {
        totalUsers: dashData.stats.totalUsers,
        activeUsers: dashData.stats.activeUsers,
        inactiveUsers: dashData.stats.totalUsers - dashData.stats.activeUsers,
        totalRoles: dashData.stats.totalRoles ?? 0,
        recentActions: activityData?.total ?? 0,
      }
    : { totalUsers: 0, activeUsers: 0, inactiveUsers: 0, totalRoles: 0, recentActions: 0 };

  const recentUsers = dashData?.recentUsers ?? [];
  const recentActivities = activityData?.data ?? [];
  const activePct = share(stats.activeUsers, stats.totalUsers);
  const readAt = dataUpdatedAt ? new Date(dataUpdatedAt) : new Date();

  return (
    <div>
      <style>{SHEET_CSS}</style>
      <Breadcrumbs items={["Admin", "Dashboard"]} />

      <div className="crm-sheet sheet-in">
        {/* Title block */}
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "stretch" }}>
          <div style={{ flex: "1 1 320px", padding: "22px 22px 20px", minWidth: 0 }}>
            <p className="label">CivilierERP · Admin</p>
            <h1 className="title" style={{ fontSize: "clamp(28px, 3.4vw, 44px)", margin: "8px 0 0", lineHeight: 1.05 }}>Control center</h1>
            <p style={{ margin: "8px 0 0", fontSize: 13, color: "var(--ink-2)", maxWidth: "60ch" }}>
              Who has an account, who can still sign in, and what was last done in the system.
            </p>
          </div>
          <div className="mono titleblock" style={{ flex: "1 1 280px", maxWidth: 380, minWidth: 240, display: "grid", gridTemplateColumns: "1fr 1fr", borderLeft: "1px solid var(--ink)", fontSize: 13 }}>
            <div style={{ gridColumn: "1 / -1", padding: "10px 14px", borderBottom: "1px solid var(--ink)" }}>
              <span className="label" style={{ display: "block", marginBottom: 3 }}>Date</span>
              {readAt.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
            </div>
            <div style={{ padding: "10px 14px", borderRight: "1px solid var(--ink)" }}>
              <span className="label" style={{ display: "block", marginBottom: 3 }}>Read at</span>
              {readAt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
            </div>
            <div style={{ padding: "10px 14px", display: "flex", alignItems: "flex-end" }}>
              <button onClick={() => refetch()} disabled={isFetching} className="label link" style={{ color: "var(--blue)" }}>
                {isFetching ? "Reading…" : "Re-read"}
              </button>
            </div>
          </div>
        </div>

        {dashError && <div className="cell" style={{ color: "var(--red)", fontSize: 13 }}>Could not load the dashboard. Use Re-read to try again.</div>}

        {/* A + B */}
        <div className="grid2">
          <Detail tag="A" title="Accounts" note="All time">
            {loading ? (<><Skel h={54} w="60%" /><Skel h={28} /><Skel w="70%" /></>) : (
              <>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "14px 36px", alignItems: "flex-end" }}>
                  <div>
                    <span className="label" style={{ display: "block", marginBottom: 8 }}>Users</span>
                    <span className="figure" style={{ display: "block", fontSize: "clamp(36px, 4.6vw, 62px)" }}>{fmtNum(stats.totalUsers)}</span>
                  </div>
                  <div>
                    <span className="label" style={{ display: "block", marginBottom: 8 }}>Can sign in</span>
                    <span className="figure" style={{ display: "block", fontSize: "clamp(36px, 4.6vw, 62px)", color: "var(--ink-2)" }}>{fmtNum(stats.activeUsers)}</span>
                  </div>
                  <div style={{ marginLeft: "auto", textAlign: "right" }}>
                    <span className="label" style={{ display: "block", marginBottom: 8 }}>Active</span>
                    <span className="figure" style={{ fontSize: "clamp(24px, 2.8vw, 36px)", color: "var(--blue)" }}>
                      {Math.round(activePct)}<span style={{ fontSize: "0.5em", fontWeight: 500, marginLeft: 3 }}>%</span>
                    </span>
                  </div>
                </div>

                {/* every account, measured out: active solid, discontinued hatched */}
                <div style={{ marginTop: 22 }}>
                  <div className="hatch" style={{ display: "flex", height: 30, border: "1.5px solid var(--ink)", backgroundColor: "var(--sheet)" }} role="img"
                    aria-label={`${stats.activeUsers} active, ${stats.inactiveUsers} discontinued`}>
                    <div className="grow" style={{ width: `${activePct}%`, background: "var(--blue)" }} title={`Active: ${fmtNum(stats.activeUsers)}`} />
                  </div>
                  <div style={{ display: "flex" }}>
                    <div style={{ width: `${Math.min(Math.max(activePct, 24), 76)}%`, minWidth: 0, overflow: "hidden" }}>
                      <Dimension from={0} to={100} text={`${fmtNum(stats.activeUsers)} active`} color="var(--blue)" />
                    </div>
                    <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
                      <Dimension from={0} to={100} text={`${fmtNum(stats.inactiveUsers)} discontinued`} />
                    </div>
                  </div>
                </div>
              </>
            )}
          </Detail>

          <Detail tag="B" title="On record">
            {loading ? (<><Skel h={40} /><Skel h={40} /><Skel h={40} /></>) : (
              <div>
                {[
                  { label: "Roles", value: stats.totalRoles, sub: "that rights are granted to" },
                  { label: "Discontinued", value: stats.inactiveUsers, sub: stats.inactiveUsers ? "accounts that can no longer sign in" : "every account can sign in" },
                  { label: "Activity logged", value: stats.recentActions, sub: "entries in the activity log" },
                ].map((s, i) => (
                  <div key={s.label} style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, padding: "13px 0", borderTop: i ? "1px solid var(--rule-soft)" : 0 }}>
                    <span style={{ minWidth: 0 }}>
                      <span className="label" style={{ color: "var(--ink)" }}>{s.label}</span>
                      <span style={{ display: "block", fontSize: 12, color: "var(--graphite)", marginTop: 4 }}>{s.sub}</span>
                    </span>
                    <span className="figure" style={{ fontSize: 28, whiteSpace: "nowrap" }}>{fmtNum(s.value)}</span>
                  </div>
                ))}
              </div>
            )}
          </Detail>
        </div>

        {/* C + D */}
        <div className="grid2">
          <Detail tag="C" title="Latest activity" note={`${fmtNum(stats.recentActions)} in all`}>
            {loading ? (<><Skel h={26} /><Skel h={26} /><Skel h={26} /></>) : recentActivities.length === 0 ? (
              <p style={{ fontSize: 13, color: "var(--graphite)", margin: 0 }}>Nothing has been logged yet.</p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ minWidth: 520 }}>
                  <thead><tr><th>Page</th><th>By</th><th className="num">When</th></tr></thead>
                  <tbody>
                    {recentActivities.map((a, i) => {
                      const sub = a.details || (a.actionType ? a.actionType.replace(/_/g, " ") : a.event);
                      return (
                        <tr key={a.id || i}>
                          <td style={{ maxWidth: 300 }}>
                            <span style={{ display: "block", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{getPageName(a.resource)}</span>
                            {sub && <span style={{ display: "block", fontSize: 11.5, color: "var(--graphite)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub}</span>}
                          </td>
                          <td style={{ color: "var(--ink-2)", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.userName || a.userEmail || "—"}</td>
                          <td className="num" style={{ whiteSpace: "nowrap" }}>
                            <span style={{ display: "block" }}>{getRelativeTime(a.timestamp)}</span>
                            <span style={{ display: "block", fontSize: 11, color: "var(--graphite)" }}>
                              {new Date(a.timestamp).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Detail>

          <Detail tag="D" title="Newest accounts">
            {loading ? (<><Skel h={26} /><Skel h={26} /><Skel h={26} /></>) : recentUsers.length === 0 ? (
              <p style={{ fontSize: 13, color: "var(--graphite)", margin: 0 }}>No users found.</p>
            ) : (
              <div>
                {recentUsers.map((u, i) => (
                  <div key={u.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderTop: i ? "1px solid var(--rule-soft)" : 0 }}>
                    <span className="mono" style={{ width: 28, height: 28, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid var(--ink)", fontSize: 10, fontWeight: 700 }}>
                      {getInitials(u.name)}
                    </span>
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span style={{ display: "block", fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.name}</span>
                      <span style={{ display: "block", fontSize: 11.5, color: "var(--graphite)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.email}</span>
                    </span>
                    {u.discontinue ? <span className="label">Discontinued</span> : <SheetMark text="Active" tone="done" />}
                  </div>
                ))}
              </div>
            )}
          </Detail>
        </div>
      </div>
    </div>
  );
}
