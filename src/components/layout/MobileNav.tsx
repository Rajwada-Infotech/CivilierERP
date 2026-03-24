import React, { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  BarChart3,
  CheckCircle2,
  Menu,
  X,
  Scale,
  ChevronDown,
  ChevronUp,
  FileText,
  Palette,
  ShieldCheck,
  Receipt,
  Truck,
  Users,
  HardHat,
  Landmark,
  Package,
  Layers,
} from "lucide-react";

import { useModule } from "@/contexts/ModuleContext";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme, THEME_DOTS, Theme } from "@/contexts/ThemeContext";

const masterItems = [
  {
    icon: Receipt,
    label: "Expenses",
    path: "/masters/expenses",
    color: "text-orange-400",
  },
  {
    icon: Truck,
    label: "Suppliers",
    path: "/masters/suppliers",
    color: "text-blue-400",
  },
  {
    icon: Users,
    label: "Customers",
    path: "/masters/customers",
    color: "text-purple-400",
  },
  {
    icon: HardHat,
    label: "Contractors",
    path: "/masters/contractors",
    color: "text-yellow-400",
  },
  {
    icon: Landmark,
    label: "Banks",
    path: "/masters/banks",
    color: "text-green-400",
  },
  {
    icon: Package,
    label: "Items",
    path: "/masters/items",
    color: "text-teal-400",
  },
  {
    icon: Layers,
    label: "Item Groups",
    path: "/masters/item-groups",
    color: "text-indigo-400",
  },
];

export const MobileNav: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [queryOpen, setQueryOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);

  const navigate = useNavigate();
  const location = useLocation();

  const { moduleLabel } = useModule();
  const { currentUser } = useAuth();
  const { theme, setTheme } = useTheme();

  const isAdminPage = location.pathname.startsWith("/admin");
  const isAdmin =
    currentUser?.role === "admin" || currentUser?.role === "super_admin";

  const go = (path: string) => {
    navigate(path);
    setOpen(false);
  };

  return (
    <>
      {/* FAB */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-50 w-12 h-12 rounded-full gradient-accent text-primary-foreground flex items-center justify-center shadow-lg md:hidden"
      >
        <Menu size={20} />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 md:hidden">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-background/80 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />

          {/* Bottom Sheet */}
          <div className="absolute bottom-0 left-0 right-0 rounded-t-2xl bg-card border-t border-border animate-slide-up max-h-[85vh] overflow-y-auto">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border sticky top-0 bg-card z-10">
              <span className="font-heading text-sm font-semibold text-foreground">
                Menu
              </span>
              <button
                onClick={() => setOpen(false)}
                className="p-1 rounded-md hover:bg-muted text-muted-foreground"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-3 space-y-0.5">
              {isAdminPage ? (
                <p className="text-xs text-muted-foreground text-center py-6 font-heading">
                  Admin Module — no sub-navigation
                </p>
              ) : (
                <>
                  {/* Dashboard */}
                  <button
                    onClick={() => go("/")}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-heading transition-colors ${
                      location.pathname === "/"
                        ? "bg-primary/15 text-primary font-medium"
                        : "text-foreground hover:bg-muted"
                    }`}
                  >
                    <BarChart3 size={18} /> Dashboard
                  </button>

                  {/* Query Group */}
                  <div>
                    <button
                      onClick={() => setQueryOpen((p) => !p)}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-heading transition-colors ${
                        location.pathname === "/transactions"
                          ? "text-primary"
                          : "text-foreground hover:bg-muted"
                      }`}
                    >
                      <Scale size={18} />
                      <span className="flex-1 text-left">Query</span>
                      {queryOpen ? (
                        <ChevronUp
                          size={14}
                          className="text-muted-foreground"
                        />
                      ) : (
                        <ChevronDown
                          size={14}
                          className="text-muted-foreground"
                        />
                      )}
                    </button>

                    <div
                      className={`overflow-hidden transition-all duration-200 ${queryOpen ? "max-h-20 opacity-100" : "max-h-0 opacity-0"}`}
                    >
                      <div className="ml-4 pl-3 border-l border-border py-0.5">
                        <button
                          onClick={() => go("/transactions")}
                          className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-heading transition-colors ${
                            location.pathname === "/transactions"
                              ? "bg-primary/15 text-primary font-medium"
                              : "text-foreground hover:bg-muted"
                          }`}
                        >
                          <FileText size={15} /> Trial Balance
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Tasks */}
                  <button
                    onClick={() => go("/tasks")}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-heading transition-colors ${
                      location.pathname.startsWith("/tasks")
                        ? "bg-primary/15 text-primary font-medium"
                        : "text-foreground hover:bg-muted"
                    }`}
                  >
                    <CheckCircle2 size={18} /> Tasks
                  </button>

                  {/* Admin Module */}
                  {isAdmin && (
                    <button
                      onClick={() => go("/admin")}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-heading transition-colors ${
                        location.pathname.startsWith("/admin")
                          ? "bg-primary/15 text-primary font-medium"
                          : "text-foreground hover:bg-muted"
                      }`}
                    >
                      <ShieldCheck size={18} /> Admin Module
                    </button>
                  )}

                  {/* Masters - Horizontal Swipeable */}
                  <div className="border-t border-border pt-2 mt-1">
                    <p className="px-3 text-[10px] uppercase tracking-widest text-muted-foreground font-heading py-1.5">
                      Masters
                    </p>

                    <div className="overflow-x-auto pb-6 -mx-1 scrollbar-hide snap-x snap-mandatory">
                      <div className="flex gap-3 px-3 flex-nowrap">
                        {masterItems.map(
                          ({ icon: Icon, label, path, color }) => (
                            <button
                              key={label}
                              onClick={() => go(path)}
                              className={`flex-shrink-0 flex flex-col items-center gap-2 w-[86px] py-3.5 px-2 rounded-2xl border transition-all active:scale-95 snap-start ${
                                location.pathname === path
                                  ? "border-primary/60 bg-primary/10"
                                  : "border-border/40 hover:bg-muted"
                              }`}
                            >
                              <div className="w-12 h-12 rounded-2xl bg-card flex items-center justify-center shadow-sm border border-border/60">
                                <Icon size={26} className={color} />
                              </div>
                              <span className="text-[10px] font-heading text-muted-foreground text-center leading-tight px-1">
                                {label}
                              </span>
                            </button>
                          ),
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Theme Selector */}
                  <div className="border-t border-border pt-2 mt-1">
                    <button
                      onClick={() => setThemeOpen((p) => !p)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-heading text-foreground hover:bg-muted transition-colors"
                    >
                      <Palette size={18} className="text-primary" />
                      <span className="flex-1 text-left">Theme</span>
                      <span
                        className="w-3.5 h-3.5 rounded-full border border-border/50 shrink-0"
                        style={{ background: THEME_DOTS[theme].bg }}
                      />
                      {themeOpen ? (
                        <ChevronUp
                          size={14}
                          className="text-muted-foreground"
                        />
                      ) : (
                        <ChevronDown
                          size={14}
                          className="text-muted-foreground"
                        />
                      )}
                    </button>

                    <div
                      className={`overflow-hidden transition-all duration-200 ${
                        themeOpen ? "max-h-64 opacity-100" : "max-h-0 opacity-0"
                      }`}
                    >
                      <div className="ml-4 pl-3 border-l border-border py-0.5 space-y-0.5">
                        {(
                          Object.entries(THEME_DOTS) as [
                            Theme,
                            { bg: string; label: string },
                          ][]
                        ).map(([t, { bg, label }]) => (
                          <button
                            key={t}
                            onClick={() => {
                              setTheme(t);
                              setThemeOpen(false);
                            }}
                            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-heading transition-colors ${
                              theme === t
                                ? "bg-primary/10 text-primary"
                                : "text-foreground hover:bg-muted"
                            }`}
                          >
                            <span
                              className="w-3.5 h-3.5 rounded-full shrink-0 border border-border/50"
                              style={{ background: bg }}
                            />
                            {label}
                            {theme === t && (
                              <span className="ml-auto text-xs">✓</span>
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Module Label */}
                  <div className="px-2 py-2 rounded-md bg-muted text-xs font-heading text-muted-foreground text-center mt-1">
                    {isAdminPage ? "Admin Module" : moduleLabel}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};
