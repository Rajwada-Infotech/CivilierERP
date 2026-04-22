import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useModule } from "@/contexts/ModuleContext";
import {
  TrendingUp,
  Package,
  Calendar,
  ShieldCheck,
  Crown,
  Database,
  ArrowRight,
  BarChart3,
  Puzzle,
  CheckCircle2,
  Layers,
} from "lucide-react";

// ─── Module card data ────────────────────────────────────────────────────────

const MODULES = [
  {
    id: "finance" as const,
    label: "Finance",
    description: "Payments, ledger, BRS & trial balance",
    icon: TrendingUp,
    route: "/",
    gradient: "from-violet-500/20 via-primary/10 to-indigo-500/10",
    border: "border-primary/30 hover:border-primary/60",
    iconBg: "bg-primary/15",
    iconColor: "text-primary",
    activeDot: "bg-primary",
    activeBg: "bg-primary/10",
    activeBorder: "border-primary/50",
    pills: ["Payments", "BRS", "Ledger", "TDS"],
  },
  {
    id: "material" as const,
    label: "Material",
    description: "GRN, purchase orders & work orders",
    icon: Package,
    route: "/material",
    gradient: "from-emerald-500/20 via-teal-500/10 to-green-500/10",
    border: "border-emerald-500/30 hover:border-emerald-500/60",
    iconBg: "bg-emerald-500/15",
    iconColor: "text-emerald-500",
    activeDot: "bg-emerald-500",
    activeBg: "bg-emerald-500/10",
    activeBorder: "border-emerald-500/50",
    pills: ["GRN", "Purchase Orders", "Work Orders", "Expenses"],
  },
  {
    id: "followup" as const,
    label: "Follow-Up",
    description: "Sales, agreements, CRM & reminders",
    icon: Calendar,
    route: "/followup",
    gradient: "from-indigo-500/20 via-blue-500/10 to-sky-500/10",
    border: "border-indigo-500/30 hover:border-indigo-500/60",
    iconBg: "bg-indigo-500/15",
    iconColor: "text-indigo-500",
    activeDot: "bg-indigo-500",
    activeBg: "bg-indigo-500/10",
    activeBorder: "border-indigo-500/50",
    pills: ["Sales", "Agreements", "Reminders", "Reports"],
  },
];

const ADMIN_MODULE = {
  id: "admin" as const,
  label: "Admin",
  description: "Users, rights, approvals & config",
  icon: ShieldCheck,
  route: "/admin/dashboard",
  gradient: "from-blue-500/20 via-sky-500/10 to-cyan-500/10",
  border: "border-blue-500/30 hover:border-blue-500/60",
  iconBg: "bg-blue-500/15",
  iconColor: "text-blue-500",
  activeDot: "bg-blue-500",
  activeBg: "bg-blue-500/10",
  activeBorder: "border-blue-500/50",
  pills: ["Users", "Menu Rights", "Approvals", "Activity"],
};

// ─── Greeting ─────────────────────────────────────────────────────────────────
function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function Home() {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { setActiveModule, setModuleSwitching } = useModule();
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const isSuperAdmin = currentUser?.role === "super_admin";
  const isDba = currentUser?.role === "dba";
  const isAdmin = currentUser?.role === "admin" || isSuperAdmin || isDba;

  const modules = isAdmin ? [...MODULES, ADMIN_MODULE] : MODULES;

  const RoleIcon = isSuperAdmin
    ? Crown
    : isDba
      ? Database
      : isAdmin
        ? ShieldCheck
        : null;
  const roleBadgeClass = isSuperAdmin
    ? "bg-violet-500/15 text-violet-500 border-violet-400/30"
    : isDba
      ? "bg-emerald-500/15 text-emerald-500 border-emerald-400/30"
      : isAdmin
        ? "bg-blue-500/15 text-blue-500 border-blue-400/30"
        : "bg-muted text-muted-foreground border-border";
  const roleLabel = isSuperAdmin
    ? "Super Admin"
    : isDba
      ? "DBA"
      : isAdmin
        ? "Admin"
        : "User";

  const handleSelect = async (
    mod: (typeof MODULES)[0] | typeof ADMIN_MODULE,
  ) => {
    setModuleSwitching(true);
    setActiveModule(mod.id);
    // Small delay for visual feedback
    await new Promise((r) => setTimeout(r, 220));
    setModuleSwitching(false);
    navigate(mod.route);
  };

  return (
    <div className="min-h-[calc(100vh-3.5rem)] flex flex-col">
      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <div className="px-6 pt-10 pb-8 border-b border-border">
        <div className="max-w-4xl">
          {/* Role pill */}
          {RoleIcon && (
            <div
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-heading font-semibold border mb-3 ${roleBadgeClass}`}
            >
              <RoleIcon size={11} />
              {roleLabel}
            </div>
          )}

          <h1 className="text-3xl sm:text-4xl font-heading font-bold text-foreground tracking-tight">
            {getGreeting()},{" "}
            <span className="gradient-text">
              {currentUser?.name?.split(" ")[0] ?? "there"}
            </span>
          </h1>
          <p className="mt-2 text-base text-muted-foreground max-w-xl">
            Select a module to get started. Each module gives you a focused
            workspace for that area of operations.
          </p>
        </div>
      </div>

      {/* ── Module grid ───────────────────────────────────────────────────── */}
      <div className="flex-1 px-6 py-8">
        <p className="text-[11px] font-heading font-semibold uppercase tracking-widest text-muted-foreground mb-4">
          Available Modules
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-5xl">
          {modules.map((mod) => {
            const Icon = mod.icon;
            const isHovered = hoveredId === mod.id;
            return (
              <button
                key={mod.id}
                onClick={() => handleSelect(mod)}
                onMouseEnter={() => setHoveredId(mod.id)}
                onMouseLeave={() => setHoveredId(null)}
                className={`group relative flex flex-col text-left p-5 rounded-2xl border bg-gradient-to-br transition-all duration-200 active:scale-[0.98] ${mod.gradient} ${mod.border}`}
              >
                {/* Icon */}
                <div
                  className={`w-11 h-11 rounded-xl flex items-center justify-center mb-4 transition-transform duration-200 ${mod.iconBg} ${isHovered ? "scale-110" : ""}`}
                >
                  <Icon size={22} className={mod.iconColor} />
                </div>

                {/* Label + desc */}
                <div className="flex-1">
                  <h2 className="text-base font-heading font-semibold text-foreground mb-1">
                    {mod.label}
                  </h2>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {mod.description}
                  </p>
                </div>

                {/* Pills */}
                <div className="flex flex-wrap gap-1.5 mt-4">
                  {mod.pills.map((p) => (
                    <span
                      key={p}
                      className="text-[10px] font-heading px-2 py-0.5 rounded-full bg-background/60 border border-border text-muted-foreground"
                    >
                      {p}
                    </span>
                  ))}
                </div>

                {/* Arrow */}
                <div
                  className={`absolute top-5 right-5 w-7 h-7 rounded-full border border-border flex items-center justify-center transition-all duration-200 ${isHovered ? "bg-foreground text-background border-foreground translate-x-0.5" : "bg-transparent text-muted-foreground"}`}
                >
                  <ArrowRight size={13} />
                </div>
              </button>
            );
          })}
        </div>

        {/* ── Quick links ────────────────────────────────────────────────── */}
        <div className="mt-10 max-w-5xl">
          <p className="text-[11px] font-heading font-semibold uppercase tracking-widest text-muted-foreground mb-3">
            Quick Access
          </p>
          <div className="flex flex-wrap gap-2">
            {[
              { icon: BarChart3, label: "Reports", path: "/reports" },
              { icon: Puzzle, label: "Widgets", path: "/widgets" },
              { icon: CheckCircle2, label: "Tasks", path: "/tasks" },
              { icon: Layers, label: "Records", path: "/records" },
            ].map(({ icon: Icon, label, path }) => (
              <button
                key={path}
                onClick={() => navigate(path)}
                className="flex items-center gap-2 px-4 py-2 rounded-xl border border-border hover:bg-muted hover:border-border/80 transition-all text-sm font-heading text-muted-foreground hover:text-foreground"
              >
                <Icon size={14} />
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
