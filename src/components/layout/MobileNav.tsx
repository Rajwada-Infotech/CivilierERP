import React, { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  BarChart3, CheckCircle2, Menu, X, Scale,
  ChevronDown, ChevronUp, FileText, Palette,
  Shield, Receipt, Truck, Users, HardHat, Landmark,
  Puzzle, Settings, LayoutGrid, LogOut, User, Crown, ShieldCheck
} from "lucide-react";
import { useModule } from "@/contexts/ModuleContext";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme, THEME_DOTS, Theme } from "@/contexts/ThemeContext";
import { useTask } from "@/contexts/TaskContext";

interface NavItemChild {
  label: string;
  path: string;
  icon?: React.ElementType;
}

interface NavItem {
  label: string;
  icon: React.ElementType;
  path?: string;
  children?: NavItemChild[];
  count?: number;
  disabled?: boolean;
}

const masterItems: NavItemChild[] = [
  { icon: Receipt,  label: "Expenses",    path: "/masters/expenses" },
  { icon: Truck,    label: "Suppliers",   path: "/masters/suppliers" },
  { icon: Users,    label: "Customers",   path: "/masters/customers" },
  { icon: HardHat,  label: "Contractors", path: "/masters/contractors" },
  { icon: Landmark, label: "Banks",       path: "/masters/banks" },
];

const ADMIN_NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", icon: BarChart3, path: "/admin" },
  {
    label: "User Control",
    icon: Users,
    children: [{ label: "Manage Users", path: "/users", icon: FileText }],
  },
  {
    label: "Rights",
    icon: Shield,
    children: [
      { label: "Menu", path: "/admin/rights/menu", icon: FileText },
      { label: "Widgets", path: "/admin/rights/widgets", icon: FileText },
      { label: "Financial Year", path: "/admin/rights/fin-year", icon: FileText },
    ],
  },
  {
    label: "Approval",
    icon: CheckCircle2,
    children: [
      { label: "Approval Setup", path: "/admin/approval/setup", icon: FileText },
      { label: "Post Approval Rights", path: "/admin/approval/post-rights", icon: FileText },
    ],
  },
];

export const MobileNav: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [groupStates, setGroupStates] = useState<Record<string, boolean>>({});
  const navigate = useNavigate();
  const location = useLocation();
  const { theme, setTheme } = useTheme();
  const { currentUser, logout } = useAuth();
  const { activeModule, setActiveModule } = useModule();
  const { getOverdueTasks } = useTask();

  const overdueCount = getOverdueTasks().length;
  const isAdminPage = location.pathname.startsWith("/admin");
  const isSuperAdmin = currentUser?.role === "super_admin";
  const isAdmin = currentUser?.role === "admin" || isSuperAdmin;
  const isModuleActive = activeModule !== null;
  const RoleIcon = isSuperAdmin ? Crown : isAdmin ? ShieldCheck : null;
  const roleColor = isSuperAdmin ? "#7c3aed" : "#2563eb";

  const NAV_ITEMS: NavItem[] = [
    { label: "Dashboard", icon: BarChart3, path: "/" },
    { label: "Setup", icon: Settings, children: masterItems, disabled: !isModuleActive },
    { label: "Reports", icon: BarChart3, path: "/reports" },
    { label: "Widgets", icon: Puzzle, path: "/widgets" },
{ label: "Tasks", icon: CheckCircle2, path: "/tasks", count: overdueCount },
  { label: "Payment", icon: Receipt, path: "/payments" },
  {
    label: "Query",
    icon: Scale,

      children: [{ label: "Trial Balance", path: "/transactions", icon: FileText }],
    },
  ];

  const itemsToRender = isAdminPage ? ADMIN_NAV_ITEMS : NAV_ITEMS;

  const go = (path: string) => { 
    navigate(path); 
    setOpen(false); 
  };

  const toggleGroup = (label: string) => {
    setGroupStates(prev => ({ 
      ...prev, 
      [label]: !(prev[label] ?? false) 
    }));
  };
  
  const isActive = (path?: string, children?: NavItemChild[]) => {
    if (path) return location.pathname === path;
    if (children) return children.some(child => location.pathname === child.path);
    return false;
  };

  const handleModuleChange = (module: 'finance' | 'admin') => {
    if (module === 'admin') {
      navigate('/admin');
    } else {
      setActiveModule(module);
      navigate('/');
    }
    setOpen(false);
  }

  return (
    <>
      {/* FAB */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-50 w-12 h-12 rounded-full gradient-accent text-primary-foreground flex items-center justify-center shadow-lg md:hidden"
        aria-label="Open menu"
      >
        <Menu size={20} />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 md:hidden">
          {/* Backdrop */}
          <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={() => setOpen(false)} />

          {/* Sheet */}
          <div className="absolute bottom-0 left-0 right-0 rounded-t-2xl bg-card border-t border-border animate-slide-up max-h-[85vh] overflow-y-auto">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border sticky top-0 bg-card z-10">
              <span className="font-heading text-sm font-semibold text-foreground">Menu</span>
              <button onClick={() => setOpen(false)} className="p-1 rounded-md hover:bg-muted text-muted-foreground" aria-label="Close menu">
                <X size={18} />
              </button>
            </div>

            {/* User Info */}
            <div className="p-3 border-b border-border">
              <div className="flex items-center gap-3">
                <div className="relative w-10 h-10 rounded-full gradient-accent flex items-center justify-center text-sm font-bold text-primary-foreground">
                  {currentUser?.initials || "?"}
                  {RoleIcon && (
                    <span className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center border-2 border-card" style={{ background: roleColor }}>
                      <RoleIcon size={10} className="text-white" />
                    </span>
                  )}
                </div>
                <div>
                  <p className="font-semibold font-heading text-sm text-foreground">{currentUser?.name}</p>
                  <p className="text-xs text-muted-foreground">{currentUser?.email}</p>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                  <button className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs rounded-md hover:bg-muted transition-colors text-foreground border border-border">
                      <User size={14} /> Profile
                  </button>
                  <button onClick={() => { logout(); setOpen(false); }} className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs rounded-md hover:bg-destructive/10 transition-colors text-destructive border border-border">
                      <LogOut size={14} /> Sign Out
                  </button>
              </div>
            </div>

            <div className="p-3 space-y-0.5">
              {itemsToRender.map((item) => {
                const groupKey = item.label;
                const isOpen = groupStates[groupKey] ?? false;
                const active = isActive(item.path, item.children);

                if (item.children) {
                  return (
                    <div key={groupKey}>
                      <button 
                        onClick={() => toggleGroup(groupKey)}
                        disabled={item.disabled}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-heading transition-colors ${active ? "bg-primary/10 text-primary" : "text-foreground hover:bg-muted"} ${item.disabled ? "opacity-50 cursor-not-allowed" : ""}`}
                      >
                        <item.icon size={18} />
                        <span className="flex-1 text-left">{item.label}</span>
                        {item.count !== undefined && item.count > 0 && <span className="text-xs font-semibold">{item.count}</span>}
                        <ChevronDown size={14} className={`text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                      </button>
                      <div className={`overflow-hidden transition-all duration-200 ${isOpen ? "max-h-96" : "max-h-0"}`}>
                        <div className="ml-4 pl-3 border-l border-border py-1 my-1 space-y-1">
                          {item.children.map((child) => {
                            const ChildIcon = child.icon || FileText;
                            return (
                              <button 
                                key={child.path}
                                onClick={() => go(child.path)}
                                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-heading transition-colors ${location.pathname === child.path ? "bg-primary/10 text-primary font-semibold" : "text-foreground hover:bg-muted"}`}
                              >
                                <ChildIcon size={14} className="text-muted-foreground" />
                                {child.label}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    </div>
                  );
                } else {
                  return (
                    <button 
                      key={item.path}
                      onClick={() => go(item.path!)}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-heading transition-colors ${active ? "bg-primary/10 text-primary font-semibold" : "text-foreground hover:bg-muted"}`}
                    >
                      <item.icon size={18} />
                      {item.label}
                      {item.count !== undefined && item.count > 0 && (
                        <span className="ml-auto w-5 h-5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
                          {item.count > 9 ? "9+" : item.count}
                        </span>
                      )}
                    </button>
                  );
                }
              })}
              
              <div className="pt-2" />

              {/* Module */}
              <div key="module" className="border-t border-border pt-3 mt-3">
                <button onClick={() => toggleGroup('Module')}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-heading text-foreground hover:bg-muted transition-colors">
                  <LayoutGrid size={18} className="text-primary"/>
                  <span className="flex-1 text-left">Module</span>
                  <ChevronDown size={14} className={`text-muted-foreground transition-transform ${groupStates['Module'] ? 'rotate-180' : ''}`} />
                </button>
                <div className={`overflow-hidden transition-all duration-200 ${groupStates['Module'] ? "max-h-96" : "max-h-0"}`}>
                  <div className="ml-4 pl-3 border-l border-border py-1 my-1 space-y-1">
                    <button onClick={() => handleModuleChange('finance')}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-heading transition-colors ${activeModule === 'finance' && !isAdminPage ? "bg-primary/10 text-primary font-semibold" : "text-foreground hover:bg-muted"}`}>
                      <BarChart3 size={14} className="text-muted-foreground"/> Finance
                    </button>
                    {isAdmin && <button onClick={() => handleModuleChange('admin')}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-heading transition-colors ${isAdminPage ? "bg-primary/10 text-primary font-semibold" : "text-foreground hover:bg-muted"}`}>
                      <ShieldCheck size={14} className="text-muted-foreground"/> Admin
                    </button>}
                  </div>
                </div>
              </div>

              {/* Theme */}
              <div key="theme" className="border-t border-border pt-3 mt-3">
                <button onClick={() => toggleGroup('Theme')}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-heading text-foreground hover:bg-muted transition-colors">
                  <Palette size={18} className="text-primary" />
                  <span className="flex-1 text-left">Theme</span>
                  <ChevronDown size={14} className={`text-muted-foreground transition-transform ${groupStates['Theme'] ? 'rotate-180' : ''}`} />
                </button>
                <div className={`overflow-hidden transition-all duration-200 ${groupStates['Theme'] ? "max-h-96" : "max-h-0"}`}>
                  <div className="ml-4 pl-3 border-l border-border py-1 my-1 space-y-1">
                    {(Object.entries(THEME_DOTS) as [Theme, { bg: string; label: string }][]).map(([t, { bg, label }]) => (
                      <button key={t} onClick={() => { setTheme(t); }}
                        className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-heading transition-colors ${theme === t ? "bg-primary/10 text-primary" : "text-foreground hover:bg-muted"}`}>
                        <span className="w-3.5 h-3.5 rounded-full shrink-0 border border-border/50" style={{ background: bg }} />
                        {label}
                        {theme === t && <span className="ml-auto text-xs">✓</span>}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};