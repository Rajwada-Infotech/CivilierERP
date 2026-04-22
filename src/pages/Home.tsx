import React from "react";
import { motion } from "framer-motion";
import { useAuth } from "@/contexts/AuthContext";
import {
  TrendingUp,
  Crown,
  Database,
  ShieldCheck,
  Activity,
  ArrowUpRight,
  MousePointer2,
} from "lucide-react";

// ─── Animation Config ────────────────────────────────────────────────────────

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.15,
      delayChildren: 0.1,
    },
  },
};

const itemVariants = {
  hidden: { y: 30, opacity: 0 },
  visible: {
    y: 0,
    opacity: 1,
    transition: { duration: 0.8, ease: [0.16, 1, 0.3, 1] },
  },
};

const cardHover = {
  initial: { y: 0, scale: 1 },
  hover: {
    y: -5,
    scale: 1.01,
    transition: { duration: 0.3, ease: "easeOut" },
  },
};

export default function Home() {
  const { currentUser } = useAuth();

  const isSuperAdmin = currentUser?.role === "super_admin";
  const isDba = currentUser?.role === "dba";
  const isAdmin = currentUser?.role === "admin" || isSuperAdmin || isDba;

  const roleLabel = isSuperAdmin
    ? "Super Admin"
    : isDba
      ? "DBA"
      : isAdmin
        ? "Admin"
        : "User";

  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={containerVariants}
      className="min-h-[calc(100vh-3.5rem)] bg-background flex flex-col items-center justify-center p-6"
    >
      {/* ── Background Glow Effects ── */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-[10%] -left-[10%] w-[40%] h-[40%] bg-primary/5 blur-[120px] rounded-full" />
        <div className="absolute -bottom-[10%] -right-[10%] w-[40%] h-[40%] bg-violet-500/5 blur-[120px] rounded-full" />
      </div>

      <div className="w-full max-w-6xl z-10">
        {/* ── Hero Section ── */}
        <motion.div
          variants={itemVariants}
          className="text-center mb-16 space-y-4"
        >
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-primary/20 bg-primary/5 mb-2">
            <span className="flex h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary/80">
              {roleLabel} Console Active
            </span>
          </div>

          <h1 className="text-5xl md:text-7xl font-heading font-bold tracking-tight text-foreground">
            Welcome back, <br />
            <span className="bg-gradient-to-r from-primary via-violet-500 to-indigo-400 bg-clip-text text-transparent">
              {currentUser?.name?.split(" ")[0] ?? "Prithwijit"}
            </span>
          </h1>

          <p className="text-muted-foreground text-lg md:text-xl max-w-2xl mx-auto font-light leading-relaxed">
            Your workspace is synchronized and up to date. Here is a snapshot of
            the current operational health.
          </p>
        </motion.div>

        {/* ── Stats Section ── */}
        <motion.div
          variants={itemVariants}
          className="grid grid-cols-1 md:grid-cols-3 gap-6"
        >
          {[
            {
              label: "Pending Approvals",
              value: "12",
              trend: "+2 since yesterday",
              icon: ShieldCheck,
              color: "text-blue-500",
              bg: "bg-blue-500/10",
            },
            {
              label: "Active Orders",
              value: "148",
              trend: "Across all departments",
              icon: Activity,
              color: "text-primary",
              bg: "bg-primary/10",
            },
            {
              label: "Monthly Revenue",
              value: "$42.5k",
              trend: "12% increase this month",
              icon: TrendingUp,
              color: "text-emerald-500",
              bg: "bg-emerald-500/10",
            },
          ].map((stat, i) => (
            <motion.div
              key={i}
              variants={cardHover}
              initial="initial"
              whileHover="hover"
              className="relative overflow-hidden group p-8 rounded-[2rem] border border-border bg-card/50 backdrop-blur-sm shadow-sm hover:shadow-xl hover:shadow-primary/5 transition-all"
            >
              <div className="flex justify-between items-start mb-6">
                <div className={`p-3 rounded-2xl ${stat.bg} ${stat.color}`}>
                  <stat.icon size={24} />
                </div>
                <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                  <ArrowUpRight size={20} className="text-muted-foreground" />
                </div>
              </div>

              <div className="space-y-1">
                <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                  {stat.label}
                </p>
                <h3 className="text-4xl font-bold font-heading tracking-tighter tabular-nums text-foreground">
                  {stat.value}
                </h3>
                <p className="text-xs font-medium text-emerald-500 flex items-center gap-1 mt-2">
                  {stat.trend}
                </p>
              </div>

              {/* Subtle background pattern */}
              <div className="absolute -right-4 -bottom-4 opacity-[0.03] group-hover:opacity-[0.05] transition-opacity">
                <stat.icon size={120} />
              </div>
            </motion.div>
          ))}
        </motion.div>

        {/* ── Footer Interaction Hint ── */}
        <motion.div
          variants={itemVariants}
          className="mt-16 flex justify-center"
        >
          <div className="flex items-center gap-3 text-muted-foreground/60 text-sm font-medium">
            <MousePointer2 size={14} />
            <span>Use the module switcher to explore specific modules</span>
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}
