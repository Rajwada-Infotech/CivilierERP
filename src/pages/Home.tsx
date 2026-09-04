import { useEffect, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { motion, useInView } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import {
  HardHat,
  Building2,
  Layers,
  ClipboardList,
  Hammer,
  ArrowRight,
  ShieldCheck,
  BarChart3,
  RefreshCw,
  AlertCircle,
  IndianRupee,
  Package,
  FileCheck,
  Users,
  Database,
  Ticket,
  TriangleAlert,
  CheckCircle2,
  TrendingUp,
  Warehouse,
  FileText,
  CreditCard,
  Wrench,
  LineChart,
  ShoppingCart,
  Pickaxe,
  Receipt,
  HeartHandshake,
  CalendarClock,
  Activity,
  Bell,
  Cpu,
  ArrowUpRight,
} from "lucide-react";
import {
  fetchHomeDashboard,
  type HomeDashboardData,
  type RecentPayment,
  type RecentGRN,
  type RecentExpense,
  type ApprovalInboxItem,
  type TaskSummary,
  type SalesSummaryData,
} from "@/api/homeDashboardApi";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

// ─── Role helpers ─────────────────────────────────────────────────────────────
// These mirror the logic in TopNavbar / auth.utils so the home page
// shows exactly the same modules a user can actually navigate to.

type UserRoleStr = string;

function isPrivileged(role: UserRoleStr) {
  return ["super_admin", "admin", "dba"].includes(role);
}

// ─── Universal activity feed ──────────────────────────────────────────────────
interface LiveActivityItem {
  Kind: string;
  Module: string;
  DocNo: string | null;
  Title: string;
  Subtitle: string | null;
  Actor: string | null;
  Amount: number | null;
  Status: string | null;
  At: string;
  Href: string;
}

const MODULE_META: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  finance:     { label: "Finance",     color: "#3b82f6", icon: IndianRupee },
  material:    { label: "Material",    color: "#8b5cf6", icon: Package },
  engineering: { label: "Engineering", color: "#ec4899", icon: Wrench },
  sales:       { label: "Sales",       color: "#7c3aed", icon: ShoppingCart },
  crm:         { label: "CRM",         color: "#e11d48", icon: HeartHandshake },
  ticket:      { label: "Tickets",     color: "#ef4444", icon: Ticket },
  followup:    { label: "Follow-Up",   color: "#0d9488", icon: CalendarClock },
  fixedasset:  { label: "Fixed Asset", color: "#eab308", icon: Cpu },
  admin:       { label: "Admin",       color: "#a855f7", icon: ShieldCheck },
};
const moduleMeta = (m: string) => MODULE_META[m] ?? { label: m, color: "#64748b", icon: Activity };

function relTime(iso: string): string {
  const d = new Date(iso).getTime();
  if (!d || d < 946684800000) return ""; // pre-2000 sentinel = unknown
  const s = Math.floor((Date.now() - d) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

const compactINR = (n: number) =>
  n >= 1e7 ? `₹${(n / 1e7).toFixed(2)}Cr`
  : n >= 1e5 ? `₹${(n / 1e5).toFixed(1)}L`
  : n >= 1e3 ? `₹${(n / 1e3).toFixed(1)}K`
  : `₹${Math.round(n)}`;


// ─── Animated Counter ─────────────────────────────────────────────────────────
function AnimatedCounter({
  target,
  prefix = "",
  suffix = "",
  duration = 1.6,
}: {
  target: number;
  prefix?: string;
  suffix?: string;
  duration?: number;
}) {
  const [count, setCount] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });

  useEffect(() => {
    if (!inView) return;
    const start = Date.now();
    const tick = () => {
      const t = Math.min((Date.now() - start) / 1000 / duration, 1);
      const eased = 1 - Math.pow(1 - t, 4);
      setCount(Math.round(eased * target));
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [inView, target, duration]);

  return (
    <span ref={ref}>
      {prefix}
      {count.toLocaleString("en-IN")}
      {suffix}
    </span>
  );
}

// ─── Section label ────────────────────────────────────────────────────────────
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 mb-5">
      <motion.div
        className="w-1 h-3.5 rounded-full bg-primary/70"
        animate={{ scaleY: [1, 1.3, 1] }}
        transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
        style={{ originY: 0.5 }}
      />
      <span className="font-heading text-[10px] font-bold uppercase tracking-[0.22em] text-muted-foreground">
        {children}
      </span>
      {/* level-bubble accent */}
      <div className="flex-1 h-px bg-border/40 ml-2 relative max-w-[120px] hidden sm:block">
        <motion.div
          className="absolute top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-primary/40"
          animate={{ left: ["0%", "100%", "0%"] }}
          transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
          style={{ marginLeft: -3 }}
        />
      </div>
    </div>
  );
}

// ─── Bento primitives ─────────────────────────────────────────────────────────
function Bento({
  children, className = "", title, icon: Icon, accent = "#6366f1", action,
}: {
  children: React.ReactNode;
  className?: string;
  title?: string;
  icon?: React.ElementType;
  accent?: string;
  action?: React.ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className={`relative rounded-2xl border border-border/50 bg-card/60 backdrop-blur-sm overflow-hidden flex flex-col ${className}`}
    >
      <div
        className="absolute inset-x-0 top-0 h-px opacity-60"
        style={{ background: `linear-gradient(90deg, transparent, ${accent}, transparent)` }}
      />
      {title && (
        <div className="flex items-center gap-2 px-4 pt-3.5 pb-2.5">
          {Icon && (
            <span
              className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0"
              style={{ background: `${accent}18`, border: `1px solid ${accent}30` }}
            >
              <Icon size={12} style={{ color: accent }} />
            </span>
          )}
          <span className="font-heading text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
            {title}
          </span>
          {action && <span className="ml-auto">{action}</span>}
        </div>
      )}
      <div className="flex-1 min-h-0">{children}</div>
    </motion.div>
  );
}

interface Attention {
  severity: "high" | "med" | "low";
  label: string;
  count: number;
  hint: string;
  href: string;
  icon: React.ElementType;
}
const SEV_COLOR: Record<Attention["severity"], string> = {
  high: "#ef4444",
  med: "#f59e0b",
  low: "#3b82f6",
};

function AttentionRow({ a, i, onGo }: { a: Attention; i: number; onGo: (h: string) => void }) {
  const c = SEV_COLOR[a.severity];
  return (
    <motion.button
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.4, delay: 0.05 + i * 0.05 }}
      onClick={() => onGo(a.href)}
      className="group w-full flex items-center gap-3 px-4 py-2.5 border-b border-border/25 last:border-0 hover:bg-muted/30 transition-colors text-left"
    >
      <span className="relative flex h-2 w-2 shrink-0">
        {a.severity === "high" && (
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-60" style={{ background: c }} />
        )}
        <span className="relative inline-flex rounded-full h-2 w-2" style={{ background: c }} />
      </span>
      <span
        className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
        style={{ background: `${c}14` }}
      >
        <a.icon size={13} style={{ color: c }} />
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-semibold text-foreground leading-tight truncate">{a.label}</p>
        <p className="text-[10px] text-muted-foreground/55 mt-0.5 truncate">{a.hint}</p>
      </div>
      <span className="font-heading font-bold text-lg tabular-nums shrink-0" style={{ color: c }}>
        {a.count.toLocaleString("en-IN")}
      </span>
      <ArrowUpRight size={13} className="text-muted-foreground/20 group-hover:text-muted-foreground/60 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all shrink-0" />
    </motion.button>
  );
}

function KpiPill({
  label, value, prefix = "", suffix = "", color, icon: Icon, i,
}: {
  label: string;
  value: number | string | null;
  prefix?: string;
  suffix?: string;
  color: string;
  icon: React.ElementType;
  i: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.94 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.4, delay: 0.1 + i * 0.04 }}
      className="rounded-xl border border-border/45 bg-card/50 backdrop-blur-sm px-3.5 py-3 flex flex-col gap-1"
    >
      <div className="flex items-center gap-1.5">
        <Icon size={11} style={{ color }} />
        <span className="text-[9.5px] font-medium uppercase tracking-wide text-muted-foreground/55 truncate">{label}</span>
      </div>
      <span className="font-heading font-bold text-[1.35rem] leading-none tabular-nums" style={{ color }}>
        {value == null ? (
          <span className="animate-pulse inline-block h-5 w-14 bg-muted rounded" />
        ) : typeof value === "number" ? (
          <AnimatedCounter target={value} prefix={prefix} suffix={suffix} duration={1.1} />
        ) : (
          `${prefix}${value}${suffix}`
        )}
      </span>
    </motion.div>
  );
}

function LiveRow({ item, onGo }: { item: LiveActivityItem; onGo: (h: string) => void }) {
  const m = moduleMeta(item.Module);
  const t = relTime(item.At);
  return (
    <button
      onClick={() => onGo(item.Href)}
      className="group w-full flex items-start gap-2.5 px-4 py-2.5 border-b border-border/20 last:border-0 hover:bg-muted/25 transition-colors text-left"
    >
      <span className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0 mt-0.5" style={{ background: `${m.color}16` }}>
        <m.icon size={11} style={{ color: m.color }} />
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-[11.5px] font-semibold text-foreground leading-snug truncate">{item.Title}</p>
        <p className="text-[10px] text-muted-foreground/50 mt-0.5 truncate">
          <span style={{ color: m.color }}>{m.label}</span>
          {item.Subtitle ? ` · ${item.Subtitle}` : ""}
          {item.Actor ? ` · ${item.Actor}` : ""}
        </p>
      </div>
      <div className="flex flex-col items-end shrink-0 gap-0.5">
        {item.Amount != null && item.Amount > 0 && (
          <span className="text-[10.5px] font-heading font-bold tabular-nums" style={{ color: m.color }}>
            {compactINR(item.Amount)}
          </span>
        )}
        {t && <span className="text-[9.5px] text-muted-foreground/35 font-mono tabular-nums">{t}</span>}
      </div>
    </button>
  );
}

// ─── Blueprint BG ─────────────────────────────────────────────────────────────
function BgGrid() {
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      <svg
        className="absolute inset-0 w-full h-full opacity-[0.02]"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <pattern id="g1" width="48" height="48" patternUnits="userSpaceOnUse">
            <path
              d="M 48 0 L 0 0 0 48"
              fill="none"
              stroke="currentColor"
              strokeWidth="0.5"
            />
          </pattern>
          <pattern
            id="g2"
            width="240"
            height="240"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M 240 0 L 0 0 0 240"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
            />
          </pattern>
        </defs>
        <rect
          width="100%"
          height="100%"
          fill="url(#g1)"
          className="text-primary"
        />
        <rect
          width="100%"
          height="100%"
          fill="url(#g2)"
          className="text-primary"
        />
      </svg>
      <div className="absolute -top-32 -left-24 w-[50%] h-[50%] bg-primary/6 blur-[180px] rounded-full" />
      <div className="absolute bottom-0 right-0 w-[35%] h-[40%] bg-violet-500/5 blur-[150px] rounded-full" />

      {/* ── Drafting compass — far bottom-right corner, out of content flow ── */}
      <motion.svg
        className="absolute opacity-[0.07] hidden xl:block"
        style={{ bottom: "4%", right: "3%" }}
        width="110"
        height="110"
        viewBox="0 0 90 90"
        fill="none"
        animate={{ rotate: 360 }}
        transition={{ duration: 70, repeat: Infinity, ease: "linear" }}
      >
        <circle
          cx="45"
          cy="45"
          r="3"
          fill="currentColor"
          className="text-primary"
        />
        <line
          x1="45"
          y1="45"
          x2="78"
          y2="20"
          stroke="currentColor"
          className="text-primary"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <line
          x1="45"
          y1="45"
          x2="20"
          y2="80"
          stroke="currentColor"
          className="text-primary"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <circle
          cx="20"
          cy="80"
          r="2"
          fill="currentColor"
          className="text-primary"
        />
      </motion.svg>

      {/* ── Small crane silhouette — far bottom-left corner ── */}
      <div
        className="absolute opacity-[0.07] hidden xl:block"
        style={{ bottom: "2%", left: "2%", width: 170, height: 110 }}
      >
        <svg width="170" height="110" viewBox="0 0 170 110" fill="none">
          <line
            x1="20"
            y1="8"
            x2="20"
            y2="105"
            stroke="currentColor"
            className="text-primary"
            strokeWidth="2"
          />
          <line
            x1="20"
            y1="12"
            x2="160"
            y2="12"
            stroke="currentColor"
            className="text-primary"
            strokeWidth="2"
          />
          <line
            x1="20"
            y1="12"
            x2="4"
            y2="20"
            stroke="currentColor"
            className="text-primary"
            strokeWidth="2"
          />
          <line
            x1="20"
            y1="30"
            x2="120"
            y2="12"
            stroke="currentColor"
            className="text-primary"
            strokeWidth="1"
          />
          <motion.g
            initial={{ x: 145 }}
            animate={{ x: [145, 75, 145] }}
            transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
          >
            <line
              x1="0"
              y1="12"
              x2="0"
              y2="58"
              stroke="currentColor"
              className="text-primary"
              strokeWidth="1.5"
            />
            <motion.rect
              x="-8"
              y="58"
              width="16"
              height="16"
              rx="3"
              fill="currentColor"
              className="text-primary"
              animate={{ y: [58, 64, 58] }}
              transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
            />
          </motion.g>
        </svg>
      </div>

      {/* ── Subtle blueprint scan line, full width, slow ── */}
      <motion.div
        className="absolute left-0 right-0 h-48"
        style={{
          background:
            "linear-gradient(to bottom, transparent, hsl(var(--primary) / 0.025), transparent)",
        }}
        initial={{ top: "-20%" }}
        animate={{ top: "120%" }}
        transition={{
          duration: 18,
          repeat: Infinity,
          ease: "linear",
          repeatDelay: 6,
        }}
      />
    </div>
  );
}

// ─── HomePage ─────────────────────────────────────────────────────────────────
export default function HomePage() {
  const { currentUser, canAccessPage } = useAuth();
  const navigate = useNavigate();

  const role: UserRoleStr = currentUser?.role ?? "";
  const firstName = currentUser?.name?.split(" ")[0] ?? "there";

  // Customer portal redirect
  if (role === "customer") return <Navigate to="/customer-portal" replace />;

  const privileged = isPrivileged(role);
  const isDba = role === "dba";
  const isAdmin = privileged;

  // Compute which modules this user can see.
  // Uses canAccessPage (same source as ModuleStrip) so all roles — including
  // "engineer", custom roles, etc. — get the correct tile set based on their
  // actual DB-assigned pagePermissions rather than hardcoded role strings.
  const MODULE_PAGES: Record<string, string[]> = {
    finance: [
      "finance-dashboard",
      "new-payment",
      "received-payment",
      "brs",
      "transactions",
    ],
    material: [
      "material-dashboard",
      "purchase-orders",
      "grn-master",
      "material-request",
      "material-issues",
      "stock-ledger",
    ],
    followup: [
      "followup-dashboard",
      "followup-applications",
      "followup-bookings",
      "followup-agreements",
      "followup-demands",
    ],
    engineering: [
      "engineering-dashboard",
      "boq",
      "engineering-work-order",
      "work-done",
      "dpr",
    ],
    ticket: ["ticket-dashboard", "tickets"],
    sales: ["sale-order", "sale-invoice", "sales-payment"],
    salesAutomation: ["sa-leads", "sa-inquiry", "sa-site-visits", "sa-campaigns", "sa-ads"],
    civilworkdpr: [
      "civilworkdpr-dashboard",
      "civilworkdpr-dependency",
      "civilworkdpr-worker-attendance",
    ],
    crm: [
      "crm-dashboard",
      "crm-customers",
      "crm-applications",
      "crm-bookings",
      "crm-payments",
    ],
    fixedasset: [
      "fixed-asset-record",
      "fixed-asset-tagging",
      "fixed-asset-assignment",
      "asset-transfer",
      "fixed-asset-quality-check",
      "fixed-asset-maintenance",
    ],
  };

  const hasModuleAccess = (moduleId: string): boolean => {
    if (privileged) return true;
    return (MODULE_PAGES[moduleId] ?? []).some((pk) =>
      canAccessPage(pk as any),
    );
  };

  const access = {
    finance: hasModuleAccess("finance"),
    material: hasModuleAccess("material"),
    engineering: hasModuleAccess("engineering"),
    followup: hasModuleAccess("followup"),
    ticket: hasModuleAccess("ticket"),
    sales: hasModuleAccess("sales"),
    salesAutomation: hasModuleAccess("salesAutomation"),
    civilworkdpr: hasModuleAccess("civilworkdpr"),
    crm: hasModuleAccess("crm"),
    fixedasset: hasModuleAccess("fixedasset"),
    approvals: privileged,
    admin: privileged && !isDba,
    dba: isDba,
  };

  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  const { data, isLoading, isError, refetch, isFetching, dataUpdatedAt } =
    useQuery<HomeDashboardData>({
      // Include access flags in key so the query refires when permissions change
      queryKey: [
        "home-dashboard",
        role,
        access.finance,
        access.material,
        access.engineering,
      ],
      queryFn: () => fetchHomeDashboard(isAdmin, access),
      staleTime: 2 * 60 * 1000,
      refetchInterval: 5 * 60 * 1000,
      retry: 2,
    });

  // Civil Work DPR isn't part of the main home-dashboard aggregator yet —
  // it has its own lightweight stats endpoint, so the tile queries that
  // directly instead of growing the shared backend aggregation.
  const { data: civilDpr } = useQuery({
    queryKey: ["home-civilworkdpr"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/civilworkdpr-dashboard");
      if (!res.ok) throw new Error("Failed to fetch Civil Work DPR stats");
      return res.json().catch(() => ({}));
    },
    enabled: access.civilworkdpr,
    staleTime: 2 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
    retry: 1,
  });

  // CRM dashboard stats
  const { data: crmData } = useQuery({
    queryKey: ["home-crm"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/crm/dashboard");
      if (!res.ok) throw new Error("CRM stats unavailable");
      return res.json().catch(() => ({}));
    },
    enabled: access.crm,
    staleTime: 2 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
    retry: 1,
  });

  // ── Universal recent-activity feed (server-side UNION across every module) ──
  const feedModules = privileged
    ? ""
    : Object.entries(access)
        .filter(([, v]) => v)
        .map(([k]) => (k === "approvals" ? "" : k))
        .filter(Boolean)
        .join(",");
  const { data: liveFeed } = useQuery<{ items: LiveActivityItem[] }>({
    queryKey: ["home-activity-feed", feedModules],
    queryFn: async () => {
      const qs = feedModules ? `?modules=${encodeURIComponent(feedModules)}&limit=50` : "?limit=50";
      const res = await fetchWithAuth(`/api/home/activity-feed${qs}`);
      if (!res.ok) throw new Error("activity feed unavailable");
      return res.json();
    },
    staleTime: 60 * 1000,
    refetchInterval: 90 * 1000,
    retry: 1,
  });

  const fin  = data?.finance;
  const mat  = data?.material;
  const adm  = data?.admin;
  const tick = data?.tickets;
  const eng  = data?.engineering;
  const fol  = data?.followup;
  const sal  = data?.sales;
  const pendingApprovals = data?.pendingApprovals ?? [];

  // Derive handy CRM scalars from the grouped recordsets
  const crmBookings     = (crmData?.bookings     ?? []) as { Status: string; Count: number; TotalValue: number }[];
  const crmApps         = (crmData?.applications ?? []) as { Status: string; Count: number }[];
  const crmTickets      = (crmData?.serviceTickets ?? []) as { Status: string; Count: number }[];
  const crmConfirmed    = crmBookings.find(b => b.Status === "Confirmed")?.Count ?? 0;
  const crmTotalBookings = crmBookings.reduce((s, b) => s + b.Count, 0);
  const crmPendingApps  = crmApps.find(a => a.Status === "Pending")?.Count ?? 0;
  const crmOpenTickets  = crmTickets.filter(t => t.Status !== "Closed" && t.Status !== "Resolved").reduce((s, t) => s + t.Count, 0);
  const crmOverdue      = crmData?.payments?.OverdueCount ?? 0;

  const lastUpdated = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  // ── Actionable insights — "needs your attention" ─────────────────────────
  type Sev = "high" | "med" | "low";
  const rawAttn: Array<Attention | false> = [
    access.approvals && { severity: "high" as Sev, label: "Approvals awaiting you", count: pendingApprovals.length, hint: `${new Set(pendingApprovals.map((a: ApprovalInboxItem) => a.Module)).size} module(s) affected`, href: "/admin/approval/inbox", icon: FileCheck },
    access.followup && { severity: "high" as Sev, label: "Follow-ups overdue", count: fol?.overdue ?? 0, hint: "Past their due date", href: "/followup", icon: CalendarClock },
    access.ticket && { severity: "high" as Sev, label: "Urgent tickets open", count: tick?.urgent ?? 0, hint: "High-priority, unresolved", href: "/ticket", icon: TriangleAlert },
    access.crm && { severity: "high" as Sev, label: "CRM payments overdue", count: crmOverdue, hint: "Milestones past due", href: "/crm/dashboard", icon: IndianRupee },
    access.sales && { severity: "med" as Sev, label: "Sale orders pending approval", count: sal?.pendingApproval ?? 0, hint: "Waiting in the approval queue", href: "/sales/sale-order", icon: ShoppingCart },
    access.engineering && { severity: "med" as Sev, label: "Work done pending certification", count: eng?.workDone?.pending ?? 0, hint: "Awaiting engineer sign-off", href: "/engineering", icon: Hammer },
    access.civilworkdpr && { severity: "med" as Sev, label: "DPR entries pending review", count: civilDpr?.progress?.pendingReviewCount ?? 0, hint: "Daily progress awaiting review", href: "/civilworkdpr", icon: Pickaxe },
    access.followup && { severity: "med" as Sev, label: "Follow-ups due today", count: fol?.dueToday ?? 0, hint: "Scheduled for today", href: "/followup", icon: CalendarClock },
    access.crm && { severity: "med" as Sev, label: "CRM applications pending", count: crmPendingApps, hint: "Not yet processed", href: "/crm/dashboard", icon: HeartHandshake },
    access.ticket && { severity: "low" as Sev, label: "Tickets open", count: (tick?.pending ?? 0) + (tick?.inProgress ?? 0), hint: "Pending + in progress", href: "/ticket", icon: Ticket },
    access.material && { severity: "low" as Sev, label: "Purchase orders open", count: mat?.purchaseOrders?.open ?? 0, hint: "Not yet closed / cancelled", href: "/material/purchase-order", icon: Package },
  ];
  const sevRank: Record<Sev, number> = { high: 0, med: 1, low: 2 };
  const attention: Attention[] = (rawAttn.filter(Boolean) as Attention[])
    .filter((a) => a.count > 0)
    .sort((a, b) => sevRank[a.severity] - sevRank[b.severity] || b.count - a.count);

  // ── KPI pills (wrap → scale with module count) ───────────────────────────
  const kpis = [
    access.finance && { label: "Transferred all-time", value: isLoading ? null : Math.round((fin?.payments?.totalAmount ?? 0) / 100000), prefix: "₹", suffix: "L", color: "#10b981", icon: IndianRupee },
    (access.material || access.finance) && { label: "Open PO value", value: isLoading ? null : Math.round((mat?.purchaseOrders?.openValue ?? fin?.purchaseOrders?.openValue ?? 0) / 100000), prefix: "₹", suffix: "L", color: "#f59e0b", icon: Layers },
    access.material && { label: "GRNs this month", value: isLoading ? null : (mat?.grns?.thisMonth ?? 0), color: "#8b5cf6", icon: Warehouse },
    { label: "Active projects", value: isLoading ? null : (eng?.projects?.active ?? 0), color: "#06b6d4", icon: Building2 },
    access.finance && { label: "Active suppliers", value: isLoading ? null : (fin?.parties?.activeSupplierCount ?? 0), color: "#3b82f6", icon: Building2 },
    access.sales && { label: "Sales this month", value: isLoading ? null : (() => { const a = sal?.thisMonthAmount ?? 0; return a >= 1e5 ? Math.round(a / 1e5) : a; })(), prefix: "₹", suffix: (sal?.thisMonthAmount ?? 0) >= 1e5 ? "L" : "", color: "#7c3aed", icon: TrendingUp },
    access.crm && { label: "Total bookings", value: isLoading ? null : crmTotalBookings, color: "#e11d48", icon: HeartHandshake },
    access.ticket && { label: "Resolution rate", value: isLoading ? null : `${tick?.resolvedPct ?? 0}%`, color: "#0d9488", icon: CheckCircle2 },
    (access.admin || access.dba) && { label: "Active users", value: isLoading ? null : (adm?.stats?.activeUsers ?? 0), color: "#a855f7", icon: Users },
    access.engineering && { label: "Open work orders", value: isLoading ? null : (eng?.workOrders?.open ?? 0), color: "#ec4899", icon: Hammer },
  ].filter(Boolean) as Array<{ label: string; value: number | string | null; prefix?: string; suffix?: string; color: string; icon: React.ElementType }>;

  const feedItems: LiveActivityItem[] = liveFeed?.items ?? [];

  // Always show at least something
  const hasAnyAccess = Object.values(access).some(Boolean);

  return (
    <div className="relative min-h-[calc(100vh-3.5rem)] bg-background overflow-hidden font-body">
      <BgGrid />

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        {/* ── Hero ── */}
        <div className="mb-11">
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45 }}
            className="flex items-center gap-3 mb-5"
          >
            <motion.div
              animate={{ rotate: [0, 12, -6, 0] }}
              transition={{ duration: 3.5, repeat: Infinity, repeatDelay: 7 }}
            >
              <HardHat size={14} className="text-primary/70" />
            </motion.div>
            <span className="font-heading text-[10px] font-bold uppercase tracking-[0.24em] text-primary/55">
              CivilierERP
            </span>
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
            </span>
            <div className="ml-auto flex items-center gap-2">
              {lastUpdated && (
                <span className="text-[10px] text-muted-foreground/35 font-mono tabular-nums">
                  {lastUpdated}
                </span>
              )}
              <button
                onClick={() => refetch()}
                disabled={isFetching}
                className="group p-1.5 rounded-lg hover:bg-muted/50 transition-all duration-200 active:scale-90 disabled:opacity-40"
                title="Refresh"
              >
                <RefreshCw
                  size={12}
                  className={`text-muted-foreground/40 transition-transform duration-500 ${isFetching ? "animate-spin" : "group-hover:rotate-180"}`}
                />
              </button>
            </div>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, delay: 0.07, ease: [0.16, 1, 0.3, 1] }}
            className="font-heading font-bold text-5xl md:text-[4rem] tracking-tight leading-[1.06] text-foreground mb-3"
          >
            {greeting},{" "}
            <motion.span
              className="inline-block bg-gradient-to-r from-primary via-violet-400 to-cyan-400 bg-clip-text text-transparent"
              initial={{ opacity: 0, x: -14 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{
                duration: 0.85,
                delay: 0.2,
                ease: [0.16, 1, 0.3, 1],
              }}
            >
              {firstName}.
            </motion.span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.32 }}
            className="text-muted-foreground text-base max-w-md leading-relaxed"
          >
            {privileged
              ? "Everything live across procurement, finance, engineering and sales — in one place."
              : role === "engineer"
                ? "Your engineering, follow-up and ticket workspace — live and in one place."
                : "Your workspace overview — all your accessible modules in one place."}
          </motion.p>

          {/* Role badge */}
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.4 }}
            className="mt-3"
          >
            <span
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-heading font-semibold uppercase tracking-wider border"
              style={{
                background: privileged
                  ? "hsl(var(--primary)/0.08)"
                  : "hsl(var(--muted)/0.5)",
                borderColor: privileged
                  ? "hsl(var(--primary)/0.25)"
                  : "hsl(var(--border))",
                color: privileged
                  ? "hsl(var(--primary))"
                  : "hsl(var(--muted-foreground))",
              }}
            >
              {privileged ? <ShieldCheck size={10} /> : <Users size={10} />}
              {role.replace(/_/g, " ")}
            </span>
          </motion.div>

          <motion.div
            initial={{ scaleX: 0, opacity: 0 }}
            animate={{ scaleX: 1, opacity: 1 }}
            transition={{ duration: 1.1, delay: 0.5, ease: [0.16, 1, 0.3, 1] }}
            style={{ originX: 0 }}
            className="mt-7 flex items-center gap-3"
          >
            <div className="flex-1 max-w-[280px] h-px bg-gradient-to-r from-primary/40 via-primary/15 to-transparent" />
            <div className="flex items-center gap-[3px]">
              {Array.from({ length: 12 }).map((_, i) => (
                <div
                  key={i}
                  className="w-px bg-primary/30 rounded-full"
                  style={{
                    height: i % 4 === 0 ? "10px" : i % 2 === 0 ? "6px" : "4px",
                  }}
                />
              ))}
            </div>
          </motion.div>

          {isError && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-4 flex items-center gap-2 px-4 py-2.5 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive max-w-sm"
            >
              <AlertCircle size={13} className="shrink-0" />
              <span className="text-xs">
                Could not reach the server — showing cached data.
              </span>
            </motion.div>
          )}
        </div>

        <section className="mb-10">
        {!hasAnyAccess ? (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="rounded-2xl border border-border/40 bg-card/40 p-10 text-center max-w-lg mx-auto"
          >
            <ShieldCheck size={28} className="text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm font-medium text-muted-foreground/60">No module access assigned.</p>
            <p className="text-xs text-muted-foreground/40 mt-1">Contact your administrator to get module permissions.</p>
          </motion.div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
            {/* Left column: attention + KPIs */}
            <div className="lg:col-span-2 space-y-4">
              <Bento title={`Needs your attention${attention.length ? ` · ${attention.length}` : ""}`} icon={Bell} accent="#ef4444">
                {isLoading ? (
                  <div className="px-4 py-6 space-y-3">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <div key={i} className="flex items-center gap-3 animate-pulse">
                        <div className="w-7 h-7 rounded-lg bg-muted shrink-0" />
                        <div className="flex-1 space-y-1.5"><div className="h-3 bg-muted rounded w-2/3" /><div className="h-2 bg-muted rounded w-1/3" /></div>
                      </div>
                    ))}
                  </div>
                ) : attention.length === 0 ? (
                  <div className="px-4 py-10 flex flex-col items-center gap-2 text-center">
                    <div className="w-10 h-10 rounded-full bg-emerald-500/12 flex items-center justify-center">
                      <CheckCircle2 size={18} className="text-emerald-500" />
                    </div>
                    <p className="text-sm font-semibold text-foreground">All clear</p>
                    <p className="text-[11px] text-muted-foreground/50">Nothing needs your action right now.</p>
                  </div>
                ) : (
                  <div className="max-h-[420px] overflow-y-auto">
                    {attention.slice(0, 10).map((a, i) => (
                      <AttentionRow key={a.label} a={a} i={i} onGo={navigate} />
                    ))}
                  </div>
                )}
              </Bento>

              <div>
                <SectionLabel>Key numbers</SectionLabel>
                <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
                  {kpis.map((k, i) => (
                    <KpiPill key={k.label} label={k.label} value={k.value} prefix={k.prefix} suffix={k.suffix} color={k.color} icon={k.icon} i={i} />
                  ))}
                </div>
              </div>
            </div>

            {/* Right column: live activity */}
            <Bento
              title="Live activity"
              icon={Activity}
              accent="#6366f1"
              className="lg:sticky lg:top-4"
              action={
                <div className="flex items-center gap-1.5">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                  </span>
                  <button onClick={() => refetch()} disabled={isFetching} className="p-1 rounded hover:bg-muted/50 disabled:opacity-40">
                    <RefreshCw size={11} className={`text-muted-foreground/40 ${isFetching ? "animate-spin" : ""}`} />
                  </button>
                </div>
              }
            >
              {feedItems.length === 0 ? (
                <div className="px-4 py-12 text-center text-xs text-muted-foreground/40">
                  {isLoading ? "Loading activity…" : "No recent activity."}
                </div>
              ) : (
                <div className="max-h-[calc(100vh-11rem)] min-h-[300px] overflow-y-auto">
                  {feedItems.map((it, i) => (
                    <LiveRow key={`${it.Kind}-${it.DocNo ?? i}-${it.At}`} item={it} onGo={navigate} />
                  ))}
                </div>
              )}
            </Bento>
          </div>
        )}
        </section>

        {/* Footer */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.4 }}
          className="mt-10 flex flex-col items-center gap-1.5"
        >
          <div className="flex items-center gap-3 text-muted-foreground/25 text-[10px] font-heading tracking-widest uppercase">
            <div className="w-10 h-px bg-border/40" />
            <span>Civilier ERP · {new Date().getFullYear()}</span>
            <div className="w-10 h-px bg-border/40" />
          </div>
          <span className="text-[9px] font-heading tracking-[0.2em] uppercase text-muted-foreground/20">
            crafted by Rajwada Infotech
          </span>
        </motion.div>
      </div>
    </div>
  );
}
