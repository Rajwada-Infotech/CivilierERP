import React, { useEffect, useRef, useState, useCallback } from "react";
import { motion, useInView, useAnimation } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import {
  HardHat,
  Building2,
  Layers,
  TrendingUp,
  ClipboardList,
  Hammer,
  ArrowRight,
  Ruler,
  Cpu,
  ShieldCheck,
  BarChart3,
  CircleDot,
  RefreshCw,
  AlertCircle,
  IndianRupee,
  Package,
  FileCheck,
  Users,
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
  duration = 1.8,
  prefix = "",
  suffix = "",
}: {
  target: number;
  duration?: number;
  prefix?: string;
  suffix?: string;
}) {
  const [count, setCount] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const prevTarget = useRef(0);

  useEffect(() => {
    if (!inView) return;
    const from = prevTarget.current;
    prevTarget.current = target;
    const start = Date.now();
    const tick = () => {
      const elapsed = (Date.now() - start) / 1000;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setCount(Math.round(from + eased * (target - from)));
      if (progress < 1) requestAnimationFrame(tick);
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

// ─── Blueprint Grid Background ────────────────────────────────────────────────

function BlueprintGrid() {
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      <svg
        className="absolute inset-0 w-full h-full opacity-[0.025]"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <pattern
            id="bp-sm"
            width="40"
            height="40"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M 40 0 L 0 0 0 40"
              fill="none"
              stroke="currentColor"
              strokeWidth="0.6"
            />
          </pattern>
          <pattern
            id="bp-lg"
            width="200"
            height="200"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M 200 0 L 0 0 0 200"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.2"
            />
          </pattern>
        </defs>
        <rect
          width="100%"
          height="100%"
          fill="url(#bp-sm)"
          className="text-primary"
        />
        <rect
          width="100%"
          height="100%"
          fill="url(#bp-lg)"
          className="text-primary"
        />
      </svg>
      <div className="absolute top-[-15%] left-[-5%] w-[45%] h-[55%] bg-primary/8 blur-[160px] rounded-full" />
      <div className="absolute bottom-[-10%] right-[-5%] w-[40%] h-[45%] bg-violet-500/6 blur-[140px] rounded-full" />
      <div className="absolute top-[40%] left-[30%] w-[30%] h-[35%] bg-emerald-500/4 blur-[130px] rounded-full" />
    </div>
  );
}

// ─── Crane / Building SVG ─────────────────────────────────────────────────────

function StructureSVG() {
  const controls = useAnimation();
  useEffect(() => {
    controls.start({ pathLength: 1, opacity: 1 });
  }, [controls]);

  const draw = (delay: number, dur = 1.8) => ({
    initial: { pathLength: 0, opacity: 0 },
    animate: controls,
    transition: {
      pathLength: { delay, duration: dur, ease: "easeInOut" },
      opacity: { delay, duration: 0.3 },
    },
  });

  return (
    <div className="absolute right-0 top-0 w-[42%] h-full pointer-events-none overflow-hidden opacity-[0.055]">
      <svg
        viewBox="0 0 500 900"
        className="absolute right-0 top-0 h-full"
        fill="none"
      >
        <motion.line
          x1="260"
          y1="60"
          x2="460"
          y2="60"
          stroke="hsl(var(--primary))"
          strokeWidth="3"
          {...draw(0)}
        />
        <motion.line
          x1="260"
          y1="60"
          x2="80"
          y2="60"
          stroke="hsl(var(--primary))"
          strokeWidth="2"
          {...draw(0.3)}
        />
        <motion.line
          x1="260"
          y1="60"
          x2="260"
          y2="820"
          stroke="hsl(var(--primary))"
          strokeWidth="3.5"
          {...draw(0.5, 2.2)}
        />
        <motion.line
          x1="260"
          y1="60"
          x2="420"
          y2="220"
          stroke="hsl(var(--primary))"
          strokeWidth="1.5"
          {...draw(0.9)}
        />
        <motion.line
          x1="260"
          y1="60"
          x2="100"
          y2="220"
          stroke="hsl(var(--primary))"
          strokeWidth="1.5"
          {...draw(1.1)}
        />
        <motion.line
          x1="380"
          y1="60"
          x2="380"
          y2="300"
          stroke="hsl(var(--primary))"
          strokeWidth="1"
          strokeDasharray="4 4"
          {...draw(1.5)}
        />
        <motion.rect
          x="340"
          y="420"
          width="120"
          height="400"
          stroke="hsl(var(--primary))"
          strokeWidth="2"
          {...draw(1.3, 1.5)}
        />
        <motion.rect
          x="100"
          y="540"
          width="100"
          height="280"
          stroke="hsl(var(--primary))"
          strokeWidth="1.5"
          {...draw(1.5, 1.4)}
        />
        <motion.rect
          x="40"
          y="620"
          width="55"
          height="200"
          stroke="hsl(var(--primary))"
          strokeWidth="1"
          {...draw(1.7, 1.2)}
        />
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <motion.line
            key={i}
            x1="340"
            y1={420 + i * 56}
            x2="460"
            y2={420 + i * 56}
            stroke="hsl(var(--primary))"
            strokeWidth="0.7"
            {...draw(1.9 + i * 0.07, 0.7)}
          />
        ))}
        {[0, 1, 2, 3].map((i) => (
          <motion.line
            key={i}
            x1="100"
            y1={540 + i * 68}
            x2="200"
            y2={540 + i * 68}
            stroke="hsl(var(--primary))"
            strokeWidth="0.6"
            {...draw(2.0 + i * 0.07, 0.7)}
          />
        ))}
        <motion.line
          x1="0"
          y1="820"
          x2="500"
          y2="820"
          stroke="hsl(var(--primary))"
          strokeWidth="2.5"
          {...draw(2.2, 1)}
        />
      </svg>
    </div>
  );
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

interface StatDef {
  label: string;
  numericValue: number;
  unitSuffix?: string;
  prefix?: string;
  icon: React.ElementType;
  color: string;
  glow: string;
  description: string;
  delay: number;
  loading?: boolean;
}

function StatCard({ s }: { s: StatDef }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });

  return (
    <motion.div
      ref={ref}
      initial={{ y: 55, opacity: 0, scale: 0.93 }}
      animate={inView ? { y: 0, opacity: 1, scale: 1 } : {}}
      transition={{ duration: 0.85, delay: s.delay, ease: [0.16, 1, 0.3, 1] }}
      whileHover={{ y: -5, scale: 1.025, transition: { duration: 0.25 } }}
      className="relative group overflow-hidden rounded-2xl border border-border/60 bg-card/60 backdrop-blur-md p-5 cursor-default"
    >
      <motion.div
        className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500"
        style={{
          background: `radial-gradient(ellipse at 50% 0%, ${s.glow}14 0%, transparent 65%)`,
        }}
      />

      <div className="flex items-center justify-between mb-4">
        <div className="p-2.5 rounded-xl" style={{ background: `${s.glow}18` }}>
          <s.icon size={18} style={{ color: s.color }} />
        </div>
        <div className="flex items-end gap-[2px] opacity-25">
          {[4, 6, 9, 7, 11].map((h, i) => (
            <div
              key={i}
              className="w-[2px] bg-current rounded-full"
              style={{ height: `${h}px`, color: s.color }}
            />
          ))}
        </div>
      </div>

      <div className="mb-2 min-h-[52px] flex flex-col justify-center">
        {s.loading ? (
          <div className="space-y-2 animate-pulse">
            <div className="h-8 w-20 bg-muted rounded-lg" />
            <div className="h-2.5 w-28 bg-muted rounded" />
          </div>
        ) : (
          <>
            <div className="flex items-baseline gap-0.5">
              <span className="text-3xl font-bold tracking-tighter text-foreground font-mono tabular-nums">
                <AnimatedCounter
                  target={s.numericValue}
                  prefix={s.prefix}
                  suffix={s.unitSuffix}
                />
              </span>
            </div>
            <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground mt-0.5">
              {s.label}
            </p>
          </>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground/60 leading-relaxed">
        {s.description}
      </p>

      <div className="absolute -right-2 -bottom-2 opacity-[0.04] group-hover:opacity-[0.07] transition-opacity duration-500">
        <s.icon size={80} />
      </div>
    </motion.div>
  );
}

// ─── Module Button ────────────────────────────────────────────────────────────

function ModuleBtn({
  label,
  desc,
  icon: Icon,
  href,
  accent,
  badge,
  index,
}: {
  label: string;
  desc: string;
  icon: React.ElementType;
  href: string;
  accent: string;
  badge?: number;
  index: number;
}) {
  const navigate = useNavigate();
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-20px" });

  return (
    <motion.button
      ref={ref}
      onClick={() => navigate(href)}
      initial={{ x: -25, opacity: 0 }}
      animate={inView ? { x: 0, opacity: 1 } : {}}
      transition={{
        duration: 0.55,
        delay: 0.06 * index,
        ease: [0.16, 1, 0.3, 1],
      }}
      whileHover={{ x: 5, transition: { duration: 0.18 } }}
      className="group flex items-center gap-3.5 w-full p-4 rounded-xl border border-border/50 bg-card/40 hover:bg-card/75 hover:border-border/80 transition-all text-left"
    >
      <div
        className="p-2 rounded-lg shrink-0"
        style={{ background: `${accent}15` }}
      >
        <Icon size={17} style={{ color: accent }} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-foreground flex items-center gap-2">
          {label}
          {badge != null && badge > 0 && (
            <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-amber-500/15 text-amber-500">
              {badge}
            </span>
          )}
        </p>
        <p className="text-[11px] text-muted-foreground/60 truncate">{desc}</p>
      </div>
      <ArrowRight
        size={14}
        className="shrink-0 text-muted-foreground/25 group-hover:text-muted-foreground/60 transition-colors"
      />
    </motion.button>
  );
}

// ─── Activity Timeline ────────────────────────────────────────────────────────

interface ActivityItem {
  time: string;
  action: string;
  sub: string;
  icon: React.ElementType;
  color: string;
}

function buildActivityFeed(data: HomeDashboardData): ActivityItem[] {
  const items: ActivityItem[] = [];

  // Recent GRNs
  (data.material?.recentGRNs ?? []).slice(0, 2).forEach((g: RecentGRN) => {
    items.push({
      time: g.GRNDate
        ? new Date(g.GRNDate).toLocaleDateString("en-IN", {
            day: "2-digit",
            month: "short",
          })
        : "—",
      action: `GRN ${g.GRNNo} — ${g.Status ?? "received"}`,
      sub: g.SupplierName ?? "Supplier",
      icon: Package,
      color: "#10b981",
    });
  });

  // Recent Payments
  (data.finance?.recentPayments ?? [])
    .slice(0, 2)
    .forEach((p: RecentPayment) => {
      items.push({
        time: p.PDate
          ? new Date(p.PDate).toLocaleDateString("en-IN", {
              day: "2-digit",
              month: "short",
            })
          : "—",
        action: `Payment ${formatINR(Number(p.PAmount ?? 0))} via ${p.PMode ?? "—"}`,
        sub: p.PProject ?? p.PPaymentName ?? "—",
        icon: IndianRupee,
        color: "#f59e0b",
      });
    });

  // Pending approvals
  (data.pendingApprovals ?? []).slice(0, 2).forEach((a: ApprovalInboxItem) => {
    items.push({
      time: a.RecordDate
        ? new Date(a.RecordDate).toLocaleDateString("en-IN", {
            day: "2-digit",
            month: "short",
          })
        : "—",
      action: `${a.ModuleLabel} ${a.Reference} pending approval`,
      sub: a.Module,
      icon: FileCheck,
      color: "#ef4444",
    });
  });

  // Recent tasks
  (data.recentTasks ?? []).slice(0, 2).forEach((t: TaskSummary) => {
    items.push({
      time: t.dueDate
        ? new Date(t.dueDate).toLocaleDateString("en-IN", {
            day: "2-digit",
            month: "short",
          })
        : "—",
      action: t.title,
      sub: `Assigned to ${t.assignedToName || "—"} · ${t.priority}`,
      icon: ClipboardList,
      color: "#8b5cf6",
    });
  });

  // Recent POs
  (data.finance?.recentPOs ?? []).slice(0, 1).forEach((p: RecentPO) => {
    items.push({
      time: p.PODate
        ? new Date(p.PODate).toLocaleDateString("en-IN", {
            day: "2-digit",
            month: "short",
          })
        : "—",
      action: `PO ${p.PurchaseOrderNo} — ${p.Status ?? "open"}`,
      sub: p.SupplierName ?? "Supplier",
      icon: Layers,
      color: "#3b82f6",
    });
  });

  return items.slice(0, 6);
}

// ─── Home Page ────────────────────────────────────────────────────────────────

export default function Home() {
  const { currentUser } = useAuth();
  const navigate = useNavigate();

  const firstName = currentUser?.name?.split(" ")[0] ?? "User";
  const role = currentUser?.role;
  const isSuperAdmin = role === "super_admin";
  const isDba = role === "dba";
  const isAdmin = role === "admin" || isSuperAdmin || isDba;
  const roleLabel = isSuperAdmin
    ? "Super Admin"
    : isDba
      ? "DBA"
      : isAdmin
        ? "Admin"
        : "Site Engineer";

  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  // ── Data fetching ──
  const { data, isLoading, isError, refetch, isFetching, dataUpdatedAt } =
    useQuery<HomeDashboardData>({
      queryKey: ["home-dashboard", isAdmin],
      queryFn: () => fetchHomeDashboard(isAdmin),
      staleTime: 2 * 60 * 1000, // 2 min
      refetchInterval: 5 * 60 * 1000, // auto-refresh every 5 min
      retry: 2,
    });

  // ── Derived stats ──
  const finance = data?.finance;
  const material = data?.material;
  const admin = data?.admin;
  const pendingApprovalCount = data?.pendingApprovals?.length ?? 0;

  const stats: StatDef[] = [
    {
      label: "Work Orders",
      numericValue: material?.workOrders?.total ?? 0,
      icon: Hammer,
      color: "hsl(var(--primary))",
      glow: "hsl(var(--primary))",
      description: "Total work orders raised across all projects",
      delay: 0.08,
      loading: isLoading,
    },
    {
      label: "Open POs",
      numericValue:
        material?.purchaseOrders?.open ??
        finance?.purchaseOrders?.openCount ??
        0,
      icon: Layers,
      color: "#8b5cf6",
      glow: "#8b5cf6",
      description: "Purchase orders awaiting fulfilment",
      delay: 0.15,
      loading: isLoading,
    },
    {
      label: "GRNs This Month",
      numericValue:
        material?.grns?.thisMonth ?? finance?.grns?.thisMonthCount ?? 0,
      icon: Package,
      color: "#06b6d4",
      glow: "#06b6d4",
      description: "Goods received notes this month",
      delay: 0.22,
      loading: isLoading,
    },
    {
      label: "Pending Approvals",
      numericValue: pendingApprovalCount,
      icon: ShieldCheck,
      color: "#f59e0b",
      glow: "#f59e0b",
      description: "Records awaiting approval across all modules",
      delay: 0.29,
      loading: isLoading,
    },
    {
      label: "Total Payments (₹)",
      numericValue: Math.round(
        (finance?.payments?.totalAmount ?? 0) / 1_00_000,
      ),
      unitSuffix: "L",
      prefix: "₹",
      icon: IndianRupee,
      color: "#10b981",
      glow: "#10b981",
      description: "Total payments processed (in lakhs)",
      delay: 0.36,
      loading: isLoading,
    },
    ...(isAdmin
      ? [
          {
            label: "Active Users",
            numericValue: admin?.stats?.activeUsers ?? 0,
            icon: Users,
            color: "#3b82f6",
            glow: "#3b82f6",
            description: "Registered active users in the system",
            delay: 0.43,
            loading: isLoading,
          } as StatDef,
        ]
      : [
          {
            label: "Suppliers",
            numericValue: finance?.parties?.supplierCount ?? 0,
            icon: Building2,
            color: "#3b82f6",
            glow: "#3b82f6",
            description: "Total registered suppliers",
            delay: 0.43,
            loading: isLoading,
          } as StatDef,
        ]),
  ];

  const modules = [
    {
      label: "Finance Dashboard",
      desc: `${finance?.payments?.totalCount ?? "—"} payments · ${finance?.purchaseOrders?.openCount ?? "—"} open POs`,
      icon: BarChart3,
      href: "/finance",
      accent: "#3b82f6",
      badge: undefined,
    },
    {
      label: "Material & GRN",
      desc: `${material?.grns?.total ?? "—"} GRNs · ${material?.workOrders?.total ?? "—"} work orders`,
      icon: Hammer,
      href: "/material",
      accent: "#8b5cf6",
      badge: undefined,
    },
    {
      label: "Approval Inbox",
      desc: "Pending across all modules",
      icon: FileCheck,
      href: "/admin/approval/inbox",
      accent: "#ef4444",
      badge: pendingApprovalCount || undefined,
    },
    {
      label: "Tasks",
      desc: `${data?.recentTasks?.length ?? "—"} recent tasks`,
      icon: Cpu,
      href: "/tasks",
      accent: "#f59e0b",
      badge: undefined,
    },
    {
      label: "Follow-Up",
      desc: "Scheduled site follow-ups",
      icon: ClipboardList,
      href: "/followup",
      accent: "#10b981",
      badge: undefined,
    },
    ...(isAdmin
      ? [
          {
            label: "Admin Panel",
            desc: `${admin?.stats?.totalUsers ?? "—"} users · ${admin?.stats?.totalRoles ?? "—"} roles`,
            icon: ShieldCheck,
            href: "/admin",
            accent: "#a855f7",
            badge: undefined,
          },
        ]
      : []),
  ];

  const activityFeed = data ? buildActivityFeed(data) : [];

  const lastUpdated = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  return (
    <div className="relative min-h-[calc(100vh-3.5rem)] bg-background overflow-hidden">
      <BlueprintGrid />
      <StructureSVG />

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        {/* ── Hero ── */}
        <div className="mb-12">
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="flex items-center gap-3 mb-5"
          >
            <motion.div
              animate={{ rotate: [0, 10, -5, 0] }}
              transition={{ duration: 3, repeat: Infinity, repeatDelay: 6 }}
            >
              <HardHat size={16} className="text-primary" />
            </motion.div>
            <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-primary/65">
              {roleLabel} · CivilierERP
            </span>
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
            </span>

            {/* Refresh control */}
            <div className="ml-auto flex items-center gap-2">
              {lastUpdated && (
                <span className="text-[10px] text-muted-foreground/40 font-mono">
                  Updated {lastUpdated}
                </span>
              )}
              <button
                onClick={() => refetch()}
                disabled={isFetching}
                className="p-1.5 rounded-lg hover:bg-muted/60 transition-colors disabled:opacity-40"
                title="Refresh dashboard"
              >
                <RefreshCw
                  size={13}
                  className={`text-muted-foreground/50 ${isFetching ? "animate-spin" : ""}`}
                />
              </button>
            </div>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 22 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: 0.95,
              delay: 0.08,
              ease: [0.16, 1, 0.3, 1],
            }}
            className="text-5xl md:text-[4.25rem] font-heading font-bold tracking-tight leading-[1.07] text-foreground mb-4"
          >
            {greeting},{" "}
            <motion.span
              className="inline-block bg-gradient-to-r from-primary via-violet-400 to-cyan-400 bg-clip-text text-transparent"
              initial={{ opacity: 0, x: -18 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{
                duration: 0.9,
                delay: 0.22,
                ease: [0.16, 1, 0.3, 1],
              }}
            >
              {firstName}.
            </motion.span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.35 }}
            className="text-muted-foreground text-base md:text-lg max-w-lg leading-relaxed"
          >
            Your civil operations command centre — site data, procurement,
            finance and approvals, live and in sync.
          </motion.p>

          {/* Error banner */}
          {isError && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-4 flex items-center gap-2 px-4 py-2.5 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-sm max-w-md"
            >
              <AlertCircle size={14} className="shrink-0" />
              <span>Could not reach the server. Showing cached data.</span>
            </motion.div>
          )}

          {/* Engineering ruler divider */}
          <motion.div
            initial={{ scaleX: 0, opacity: 0 }}
            animate={{ scaleX: 1, opacity: 1 }}
            transition={{ duration: 1.3, delay: 0.5, ease: [0.16, 1, 0.3, 1] }}
            style={{ originX: 0 }}
            className="mt-8 flex items-center gap-3"
          >
            <div className="flex-1 max-w-xs h-px bg-gradient-to-r from-primary/50 via-primary/20 to-transparent" />
            <div className="flex items-center gap-[3px]">
              {Array.from({ length: 10 }).map((_, i) => (
                <div
                  key={i}
                  className="w-px bg-primary/35 rounded-full"
                  style={{
                    height: i % 5 === 0 ? "11px" : i % 2 === 0 ? "7px" : "4px",
                  }}
                />
              ))}
            </div>
            <Ruler size={13} className="text-primary/35" />
          </motion.div>
        </div>

        {/* ── Stats Grid ── */}
        <section className="mb-12">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.45 }}
            className="flex items-center gap-2 mb-5"
          >
            <CircleDot size={11} className="text-primary/55" />
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
              Operational Metrics
            </span>
          </motion.div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {stats.map((s, i) => (
              <StatCard key={i} s={s} />
            ))}
          </div>
        </section>

        {/* ── Quick Access + Activity Feed ── */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Module shortcuts */}
          <div className="lg:col-span-3">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.65 }}
              className="flex items-center gap-2 mb-4"
            >
              <CircleDot size={11} className="text-primary/55" />
              <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
                Quick Access
              </span>
            </motion.div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {modules.map((m, i) => (
                <ModuleBtn key={m.label} {...m} index={i} />
              ))}
            </div>
          </div>

          {/* Live activity timeline */}
          <div className="lg:col-span-2">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.75 }}
              className="flex items-center gap-2 mb-4"
            >
              <CircleDot size={11} className="text-primary/55" />
              <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
                Recent Activity
              </span>
            </motion.div>

            <div className="rounded-2xl border border-border/60 bg-card/50 backdrop-blur-md px-5 py-2">
              {isLoading ? (
                // Skeleton feed
                Array.from({ length: 5 }).map((_, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-3 py-3.5 border-b border-border/35 last:border-0 animate-pulse"
                  >
                    <div className="w-5 h-5 rounded-full bg-muted shrink-0 mt-0.5" />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-3 bg-muted rounded w-3/4" />
                      <div className="h-2.5 bg-muted rounded w-1/2" />
                    </div>
                    <div className="h-2.5 w-8 bg-muted rounded shrink-0" />
                  </div>
                ))
              ) : activityFeed.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground/50">
                  No recent activity
                </div>
              ) : (
                activityFeed.map((item, i) => (
                  <motion.div
                    key={i}
                    initial={{ x: 18, opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    transition={{
                      duration: 0.5,
                      delay: 0.85 + i * 0.09,
                      ease: "easeOut",
                    }}
                    className="flex items-start gap-3 py-3.5 border-b border-border/35 last:border-0"
                  >
                    <div className="flex flex-col items-center shrink-0 mt-0.5">
                      <div
                        className="w-[22px] h-[22px] rounded-full flex items-center justify-center shrink-0"
                        style={{ background: `${item.color}18` }}
                      >
                        <item.icon size={11} style={{ color: item.color }} />
                      </div>
                      {i < activityFeed.length - 1 && (
                        <div
                          className="w-px bg-border/40 flex-1 mt-1"
                          style={{ minHeight: "10px" }}
                        />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-foreground leading-snug">
                        {item.action}
                      </p>
                      <p className="text-[11px] text-muted-foreground/55 mt-0.5 truncate">
                        {item.sub}
                      </p>
                    </div>
                    <span className="text-[10px] text-muted-foreground/35 shrink-0 font-mono mt-0.5">
                      {item.time}
                    </span>
                  </motion.div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* ── Footer ── */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.5 }}
          className="mt-10 flex items-center justify-center gap-3 text-muted-foreground/30 text-xs"
        >
          <div className="w-12 h-px bg-border/50" />
          <span>Use the module switcher to navigate modules</span>
          <div className="w-12 h-px bg-border/50" />
        </motion.div>
      </div>
    </div>
  );
}
