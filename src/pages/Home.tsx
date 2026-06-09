import { useEffect, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { motion, useInView, AnimatePresence } from "framer-motion";
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
  GitMerge,
  FileText,
  Banknote,
  Receipt,
  CreditCard,
  ClipboardCheck,
  Wrench,
  LineChart,
  Home,
} from "lucide-react";
import { formatINR } from "@/utils/formatCurrency";
import {
  fetchHomeDashboard,
  type HomeDashboardData,
  type RecentPayment,
  type RecentGRN,
  type RecentPO,
  type ApprovalInboxItem,
  type TaskSummary,
} from "@/api/homeDashboardApi";

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
      <div className="w-1 h-3.5 rounded-full bg-primary/70" />
      <span className="font-heading text-[10px] font-bold uppercase tracking-[0.22em] text-muted-foreground">
        {children}
      </span>
    </div>
  );
}

// ─── Module Group Card ────────────────────────────────────────────────────────
// Each module gets a card that shows its key stats in a tight grid,
// with a clickable header that navigates to the module.

interface StatRow {
  label: string;
  value: string | number;
  accent?: string;
  icon?: React.ElementType;
}
interface ModuleCardProps {
  title: string;
  href: string;
  icon: React.ElementType;
  accent: string;
  stats: StatRow[];
  badge?: number;
  badgeLabel?: string;
  delay?: number;
  loading?: boolean;
}

function ModuleCard({
  title,
  href,
  icon: Icon,
  accent,
  stats,
  badge,
  badgeLabel,
  delay = 0,
  loading,
}: ModuleCardProps) {
  const navigate = useNavigate();
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-30px" });

  return (
    <motion.div
      ref={ref}
      initial={{ y: 40, opacity: 0 }}
      animate={inView ? { y: 0, opacity: 1 } : {}}
      transition={{ duration: 0.7, delay, ease: [0.16, 1, 0.3, 1] }}
      className="group relative rounded-2xl border border-border/60 bg-card/60 backdrop-blur-sm overflow-hidden"
    >
      {/* Hover glow */}
      <div
        className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
        style={{
          background: `radial-gradient(ellipse at 50% -20%, ${accent}10 0%, transparent 60%)`,
        }}
      />

      {/* Top accent line */}
      <div
        className="h-[2px] w-full"
        style={{
          background: `linear-gradient(90deg, ${accent}60 0%, ${accent}10 100%)`,
        }}
      />

      {/* Header — clickable */}
      <button
        onClick={() => navigate(href)}
        className="w-full flex items-center justify-between px-5 pt-4 pb-3 hover:bg-muted/20 transition-colors group/btn"
      >
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl" style={{ background: `${accent}15` }}>
            <Icon size={15} style={{ color: accent }} />
          </div>
          <span className="font-heading font-bold text-sm text-foreground tracking-tight">
            {title}
          </span>
          {badge != null && badge > 0 && (
            <span
              className="px-1.5 py-0.5 text-[9px] font-black rounded-full"
              style={{ background: `${accent}20`, color: accent }}
            >
              {badge} {badgeLabel}
            </span>
          )}
        </div>
        <ArrowRight
          size={13}
          className="text-muted-foreground/25 group-hover/btn:text-muted-foreground/60 group-hover/btn:translate-x-0.5 transition-all"
        />
      </button>

      {/* Stats grid */}
      <div className="px-5 pb-4 grid grid-cols-2 gap-x-4 gap-y-3">
        {loading
          ? Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="animate-pulse space-y-1.5">
                <div className="h-5 w-12 bg-muted rounded" />
                <div className="h-2.5 w-16 bg-muted rounded" />
              </div>
            ))
          : stats.map((s, i) => (
              <div key={i} className="flex flex-col">
                <div className="flex items-baseline gap-1">
                  <span
                    className="font-heading font-bold text-xl tracking-tighter tabular-nums"
                    style={{ color: s.accent ?? "hsl(var(--foreground))" }}
                  >
                    {typeof s.value === "number" ? (
                      <AnimatedCounter target={s.value} />
                    ) : (
                      s.value
                    )}
                  </span>
                </div>
                <span className="text-[10px] font-medium text-muted-foreground/60 leading-tight mt-0.5 flex items-center gap-1">
                  {s.icon && <s.icon size={9} className="shrink-0" />}
                  {s.label}
                </span>
              </div>
            ))}
      </div>
    </motion.div>
  );
}

// ─── Approval & Task Feed ─────────────────────────────────────────────────────
function FeedItem({
  item,
  i,
  total,
}: {
  item: {
    label: string;
    sub: string;
    icon: React.ElementType;
    color: string;
    time?: string;
  };
  i: number;
  total: number;
}) {
  return (
    <motion.div
      initial={{ x: 16, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ duration: 0.45, delay: 0.8 + i * 0.07, ease: "easeOut" }}
      className="flex items-start gap-3 py-3 border-b border-border/30 last:border-0"
    >
      <div className="flex flex-col items-center shrink-0 mt-0.5">
        <div
          className="w-[22px] h-[22px] rounded-full flex items-center justify-center"
          style={{ background: `${item.color}18` }}
        >
          <item.icon size={11} style={{ color: item.color }} />
        </div>
        {i < total - 1 && (
          <div className="w-px bg-border/30 flex-1 mt-1 min-h-[10px]" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-foreground leading-snug">
          {item.label}
        </p>
        <p className="text-[10px] text-muted-foreground/50 mt-0.5 truncate">
          {item.sub}
        </p>
      </div>
      {item.time && (
        <span className="text-[10px] text-muted-foreground/30 shrink-0 font-mono tabular-nums mt-0.5">
          {item.time}
        </span>
      )}
    </motion.div>
  );
}

// ─── Blueprint background ─────────────────────────────────────────────────────
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
    </div>
  );
}

// ─── Home ─────────────────────────────────────────────────────────────────────
export default function HomePage() {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const firstName = currentUser?.name?.split(" ")[0] ?? "there";
  const role = currentUser?.role;

  if (role === "customer") return <Navigate to="/customer-portal" replace />;

  const isSuperAdmin = role === "super_admin";
  const isDba = role === "dba";
  const isAdmin = role === "admin" || isSuperAdmin || isDba;
  const isFinance = [
    "admin",
    "super_admin",
    "dba",
    "finance_manager",
    "branch_manager",
  ].includes(role ?? "");

  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  const { data, isLoading, isError, refetch, isFetching, dataUpdatedAt } =
    useQuery<HomeDashboardData>({
      queryKey: ["home-dashboard", isAdmin],
      queryFn: () => fetchHomeDashboard(isAdmin, role),
      staleTime: 2 * 60 * 1000,
      refetchInterval: 5 * 60 * 1000,
      retry: 2,
    });

  const fin = data?.finance;
  const mat = data?.material;
  const adm = data?.admin;
  const tick = data?.tickets;
  const eng = data?.engineering;
  const fol = data?.followup;
  const pendingApprovals = data?.pendingApprovals ?? [];

  const lastUpdated = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  // ── Activity feed ──
  const feed: {
    label: string;
    sub: string;
    icon: React.ElementType;
    color: string;
    time?: string;
  }[] = [];
  (data?.material?.recentGRNs ?? []).slice(0, 2).forEach((g: RecentGRN) => {
    feed.push({
      label: `GRN ${g.GRNNo}`,
      sub: g.SupplierName ?? "—",
      icon: Package,
      color: "#10b981",
      time: g.GRNDate
        ? new Date(g.GRNDate).toLocaleDateString("en-IN", {
            day: "2-digit",
            month: "short",
          })
        : undefined,
    });
  });
  (data?.finance?.recentPayments ?? [])
    .slice(0, 2)
    .forEach((p: RecentPayment) => {
      feed.push({
        label: `₹${Number(p.PAmount ?? 0).toLocaleString("en-IN")} via ${p.PMode ?? "—"}`,
        sub: p.PProject ?? p.PPaymentName ?? "—",
        icon: IndianRupee,
        color: "#f59e0b",
        time: p.PDate
          ? new Date(p.PDate).toLocaleDateString("en-IN", {
              day: "2-digit",
              month: "short",
            })
          : undefined,
      });
    });
  pendingApprovals.slice(0, 2).forEach((a: ApprovalInboxItem) => {
    feed.push({
      label: `${a.ModuleLabel} ${a.Reference}`,
      sub: "Pending approval",
      icon: FileCheck,
      color: "#ef4444",
      time: a.RecordDate
        ? new Date(a.RecordDate).toLocaleDateString("en-IN", {
            day: "2-digit",
            month: "short",
          })
        : undefined,
    });
  });
  (data?.recentTasks ?? []).slice(0, 2).forEach((t: TaskSummary) => {
    feed.push({
      label: t.title,
      sub: `${t.priority} · ${t.status}`,
      icon: ClipboardList,
      color: "#8b5cf6",
      time: t.dueDate
        ? new Date(t.dueDate).toLocaleDateString("en-IN", {
            day: "2-digit",
            month: "short",
          })
        : undefined,
    });
  });
  const activityFeed = feed.slice(0, 7);

  return (
    <div className="relative min-h-[calc(100vh-3.5rem)] bg-background overflow-hidden font-body">
      <BgGrid />

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        {/* ── Hero ── */}
        <div className="mb-11">
          {/* Eyebrow */}
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
                className="p-1.5 rounded-lg hover:bg-muted/50 transition-colors disabled:opacity-40"
                title="Refresh"
              >
                <RefreshCw
                  size={12}
                  className={`text-muted-foreground/40 ${isFetching ? "animate-spin" : ""}`}
                />
              </button>
            </div>
          </motion.div>

          {/* Greeting */}
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
            Everything live across procurement, finance, engineering and sales —
            in one place.
          </motion.p>

          {/* Divider */}
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
              className="mt-4 flex items-center gap-2 px-4 py-2.5 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-sm max-w-sm"
            >
              <AlertCircle size={13} className="shrink-0" />
              <span className="text-xs">
                Could not reach the server — showing cached data.
              </span>
            </motion.div>
          )}
        </div>

        {/* ── Module Cards Grid ── */}
        <section className="mb-10">
          <SectionLabel>Operations at a glance</SectionLabel>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {/* Finance */}
            <ModuleCard
              title="Finance"
              href="/finance"
              icon={BarChart3}
              accent="#3b82f6"
              delay={0.05}
              loading={isLoading}
              badge={fin?.cheques?.pendingCount}
              badgeLabel="cheques"
              stats={[
                {
                  label: "Total payments",
                  value: fin?.payments?.totalCount ?? 0,
                  accent: "#3b82f6",
                },
                {
                  label: "Paid this month (₹L)",
                  value: Math.round((fin?.payments?.totalAmount ?? 0) / 100000),
                  accent: "#10b981",
                  icon: TrendingUp,
                },
                {
                  label: "Open POs",
                  value: fin?.purchaseOrders?.openCount ?? 0,
                  accent: "#f59e0b",
                },
                {
                  label: "Pending cheques",
                  value: fin?.cheques?.pendingCount ?? 0,
                  accent: fin?.cheques?.pendingCount ? "#ef4444" : undefined,
                  icon: CreditCard,
                },
              ]}
            />

            {/* Material */}
            <ModuleCard
              title="Material"
              href="/material"
              icon={Package}
              accent="#8b5cf6"
              delay={0.1}
              loading={isLoading}
              stats={[
                {
                  label: "GRNs this month",
                  value: mat?.grns?.thisMonth ?? 0,
                  accent: "#8b5cf6",
                },
                {
                  label: "Open POs",
                  value: mat?.purchaseOrders?.open ?? 0,
                  accent: "#f59e0b",
                },
                {
                  label: "Total items",
                  value: mat?.items?.count ?? 0,
                  accent: "#06b6d4",
                  icon: Warehouse,
                },
                {
                  label: "Today's GRNs",
                  value: mat?.grns?.today ?? 0,
                  accent: mat?.grns?.today ? "#10b981" : undefined,
                },
              ]}
            />

            {/* Engineering */}
            <ModuleCard
              title="Engineering"
              href="/engineering"
              icon={Wrench}
              accent="#ec4899"
              delay={0.15}
              loading={isLoading}
              stats={[
                {
                  label: "Open work orders",
                  value: eng?.workOrders?.open ?? 0,
                  accent: "#ec4899",
                },
                {
                  label: "Active projects",
                  value: eng?.projects?.active ?? 0,
                  accent: "#10b981",
                  icon: Building2,
                },
                {
                  label: "Work done pending",
                  value: eng?.workDone?.pending ?? 0,
                  accent: eng?.workDone?.pending ? "#f59e0b" : undefined,
                },
                {
                  label: "BOQ approved",
                  value: eng?.boq?.approved ?? 0,
                  accent: "#06b6d4",
                  icon: FileText,
                },
              ]}
            />

            {/* Followup / CRM */}
            <ModuleCard
              title="Followup"
              href="/followup"
              icon={Users}
              accent="#6366f1"
              delay={0.2}
              loading={isLoading}
              badge={fol?.pendingNOCs}
              badgeLabel="NOCs"
              stats={[
                {
                  label: "Applications",
                  value: fol?.applications ?? 0,
                  accent: "#6366f1",
                },
                {
                  label: "Confirmed bookings",
                  value: fol?.confirmedBookings ?? 0,
                  accent: "#10b981",
                  icon: CheckCircle2,
                },
                {
                  label: "Active agreements",
                  value: fol?.activeAgreements ?? 0,
                  accent: "#f59e0b",
                },
                {
                  label: "Handovers due",
                  value: fol?.scheduledHandovers ?? 0,
                  accent: fol?.scheduledHandovers ? "#ef4444" : undefined,
                },
              ]}
            />

            {/* Approvals */}
            <ModuleCard
              title="Approval Inbox"
              href="/admin/approval/inbox"
              icon={FileCheck}
              accent="#f59e0b"
              delay={0.25}
              loading={isLoading}
              badge={pendingApprovals.length}
              badgeLabel="pending"
              stats={[
                {
                  label: "Awaiting action",
                  value: pendingApprovals.length,
                  accent: pendingApprovals.length ? "#f59e0b" : undefined,
                },
                {
                  label: "Modules affected",
                  value: new Set(
                    pendingApprovals.map((a: ApprovalInboxItem) => a.Module),
                  ).size,
                  accent: "#8b5cf6",
                },
                {
                  label: "PO approvals",
                  value: pendingApprovals.filter(
                    (a: ApprovalInboxItem) => a.Module === "PurchaseOrders",
                  ).length,
                },
                {
                  label: "GRN approvals",
                  value: pendingApprovals.filter(
                    (a: ApprovalInboxItem) => a.Module === "GoodsReceiptNotes",
                  ).length,
                },
              ]}
            />

            {/* Tickets */}
            <ModuleCard
              title="Tickets"
              href="/ticket"
              icon={Ticket}
              accent="#f97316"
              delay={0.3}
              loading={isLoading}
              badge={tick?.urgent}
              badgeLabel="urgent"
              stats={[
                {
                  label: "Open",
                  value: (tick?.pending ?? 0) + (tick?.inProgress ?? 0),
                  accent: "#f97316",
                },
                {
                  label: "Urgent",
                  value: tick?.urgent ?? 0,
                  accent: tick?.urgent ? "#ef4444" : undefined,
                  icon: TriangleAlert,
                },
                {
                  label: "Resolved",
                  value: tick?.resolved ?? 0,
                  accent: "#10b981",
                  icon: CheckCircle2,
                },
                {
                  label: "Resolution %",
                  value: `${tick?.resolvedPct ?? 0}%`,
                  accent: "#06b6d4",
                },
              ]}
            />

            {/* Admin — only for admins */}
            {isAdmin && (
              <ModuleCard
                title="Admin"
                href="/admin"
                icon={ShieldCheck}
                accent="#a855f7"
                delay={0.35}
                loading={isLoading}
                stats={[
                  {
                    label: "Total users",
                    value: adm?.stats?.totalUsers ?? 0,
                    accent: "#a855f7",
                  },
                  {
                    label: "Active users",
                    value: adm?.stats?.activeUsers ?? 0,
                    accent: "#10b981",
                    icon: Users,
                  },
                  {
                    label: "Roles",
                    value: adm?.stats?.totalRoles ?? 0,
                    accent: "#06b6d4",
                  },
                  {
                    label: "Work orders open",
                    value: eng?.workOrders?.open ?? 0,
                    accent: "#f59e0b",
                    icon: Hammer,
                  },
                ]}
              />
            )}

            {/* DBA */}
            {isDba && (
              <ModuleCard
                title="DBA Console"
                href="/dba"
                icon={Database}
                accent="#10b981"
                delay={0.4}
                loading={isLoading}
                stats={[
                  {
                    label: "Total users",
                    value: adm?.stats?.totalUsers ?? 0,
                    accent: "#10b981",
                  },
                  {
                    label: "Active users",
                    value: adm?.stats?.activeUsers ?? 0,
                    accent: "#3b82f6",
                  },
                  { label: "Roles", value: adm?.stats?.totalRoles ?? 0 },
                  {
                    label: "Open tickets",
                    value: (tick?.pending ?? 0) + (tick?.inProgress ?? 0),
                    accent: "#f97316",
                    icon: Ticket,
                  },
                ]}
              />
            )}
          </div>
        </section>

        {/* ── Bottom: Hero number + Activity feed ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Big summary numbers */}
          <div className="lg:col-span-1">
            <SectionLabel>Key numbers</SectionLabel>
            <div className="rounded-2xl border border-border/60 bg-card/50 backdrop-blur-sm p-5 space-y-5">
              {[
                {
                  label: "Total payments (₹)",
                  value: isLoading
                    ? null
                    : Math.round((fin?.payments?.totalAmount ?? 0) / 100000),
                  suffix: "L",
                  prefix: "₹",
                  color: "#10b981",
                  icon: IndianRupee,
                },
                {
                  label: "Open PO value (₹)",
                  value: isLoading
                    ? null
                    : Math.round(
                        (mat?.purchaseOrders?.openValue ??
                          fin?.purchaseOrders?.openValue ??
                          0) / 100000,
                      ),
                  suffix: "L",
                  prefix: "₹",
                  color: "#f59e0b",
                  icon: Layers,
                },
                {
                  label: "BOQ certified (₹)",
                  value: isLoading
                    ? null
                    : Math.round(
                        (eng?.workDone?.certifiedAmount ?? 0) / 100000,
                      ),
                  suffix: "L",
                  prefix: "₹",
                  color: "#8b5cf6",
                  icon: LineChart,
                },
                {
                  label: "Supplier count",
                  value: isLoading ? null : (fin?.parties?.supplierCount ?? 0),
                  color: "#06b6d4",
                  icon: Building2,
                },
              ].map((item, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{
                    duration: 0.55,
                    delay: 0.5 + i * 0.08,
                    ease: "easeOut",
                  }}
                  className="flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-2.5">
                    <div
                      className="p-1.5 rounded-lg shrink-0"
                      style={{ background: `${item.color}15` }}
                    >
                      <item.icon size={12} style={{ color: item.color }} />
                    </div>
                    <span className="text-[11px] text-muted-foreground/65 font-medium">
                      {item.label}
                    </span>
                  </div>
                  <span
                    className="font-heading font-bold text-base tabular-nums"
                    style={{ color: item.color }}
                  >
                    {item.value == null ? (
                      <span className="animate-pulse inline-block h-4 w-12 bg-muted rounded" />
                    ) : (
                      <AnimatedCounter
                        target={item.value}
                        prefix={item.prefix ?? ""}
                        suffix={item.suffix ?? ""}
                      />
                    )}
                  </span>
                </motion.div>
              ))}
            </div>
          </div>

          {/* Recent activity */}
          <div className="lg:col-span-2">
            <SectionLabel>Recent activity</SectionLabel>
            <div className="rounded-2xl border border-border/60 bg-card/50 backdrop-blur-sm px-5 py-1">
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-3 py-3.5 border-b border-border/30 last:border-0 animate-pulse"
                  >
                    <div className="w-5 h-5 rounded-full bg-muted shrink-0 mt-0.5" />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-3 bg-muted rounded w-3/4" />
                      <div className="h-2.5 bg-muted rounded w-1/2" />
                    </div>
                  </div>
                ))
              ) : activityFeed.length === 0 ? (
                <div className="py-10 text-center text-sm text-muted-foreground/40">
                  No recent activity.
                </div>
              ) : (
                activityFeed.map((item, i) => (
                  <FeedItem
                    key={i}
                    item={item}
                    i={i}
                    total={activityFeed.length}
                  />
                ))
              )}
            </div>
          </div>
        </div>

        {/* ── Footer ── */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.4 }}
          className="mt-10 flex items-center justify-center gap-3 text-muted-foreground/25 text-[10px] font-heading tracking-widest uppercase"
        >
          <div className="w-10 h-px bg-border/40" />
          <span>Civilier ERP · {new Date().getFullYear()}</span>
          <div className="w-10 h-px bg-border/40" />
        </motion.div>
      </div>
    </div>
  );
}
