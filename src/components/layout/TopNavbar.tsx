import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { LogoFull } from "../Logo";
import { useTheme } from "@/contexts/ThemeContext";
import { useModule } from "@/contexts/ModuleContext";
import { useAuth } from "@/contexts/AuthContext";
import {
  Settings, BarChart3, Moon, Sun, CloudMoon, LogOut, User,
  LayoutGrid, Puzzle, FolderOpen, Landmark, ShieldCheck, Crown, Shield,
} from "lucide-react";

const Dropdown = ({ open, onClose, children, className }: {
  open: boolean; onClose: () => void; children: React.ReactNode; className?: string;
}) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, onClose]);

  return (
    <div
      ref={ref}
      className={`absolute top-full mt-2 z-50 rounded-lg border border-border bg-card shadow-xl transition-all duration-200 ${open ? "opacity-100 scale-100 pointer-events-auto" : "opacity-0 scale-95 pointer-events-none"} ${className || ""}`}
      style={{ transformOrigin: "top right" }}
    >
      {children}
    </div>
  );
};

const setupItems = [
  { icon: FolderOpen, label: "Account Group", path: "/setup/account-groups" },
  { icon: Landmark, label: "Account Head", path: "/setup/account-heads" },
];

export const TopNavbar = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { themeLabel, cycleTheme, theme } = useTheme();
  const { activeModule, setActiveModule } = useModule();
  const { currentUser, logout } = useAuth();
  const [setupOpen, setSetupOpen] = useState(false);
  const [moduleOpen, setModuleOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);

  const isModuleActive = activeModule !== null;
  const isSuperAdmin = currentUser?.role === "super_admin";
  const isAdmin = currentUser?.role === "admin" || isSuperAdmin;

  const ThemeIcon = useMemo(
    () => (theme === "dark" ? Moon : theme === "light" ? Sun : CloudMoon),
    [theme],
  );

  const handleSetupClick = useCallback(() => {
    if (!isModuleActive) return;
    setSetupOpen(p => !p);
    setModuleOpen(false);
    setUserOpen(false);
  }, [isModuleActive]);

  const RoleIcon = isSuperAdmin ? Crown : isAdmin ? Shield : null;
  const roleColor = isSuperAdmin ? "#7c3aed" : "#2563eb";

  return (
    <header className="fixed top-0 left-0 right-0 h-14 z-50 flex items-center justify-between px-4 border-b border-border bg-card/80 backdrop-blur-lg">
      <button onClick={() => navigate("/")} className="flex items-center gap-2 hover:opacity-80 transition-opacity">
        <LogoFull />
      </button>

      <div className="flex items-center gap-1">
        {/* Setup */}
        <div className="relative">
          <button
            onClick={handleSetupClick}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-heading transition-all duration-300 ${
              isModuleActive ? "hover:bg-muted text-foreground cursor-pointer opacity-100" : "text-muted-foreground cursor-not-allowed opacity-40"
            }`}
            title={isModuleActive ? "Setup" : "Please select a module first"}
          >
            <Settings size={16} /> Setup
          </button>
          <Dropdown open={setupOpen} onClose={() => setSetupOpen(false)} className="right-0 w-64 p-3">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-heading mb-2">Finance</p>
            <div className="space-y-1">
              {setupItems.map(({ icon: Icon, label, path }) => (
                <button
                  key={label}
                  onClick={() => { navigate(path); setSetupOpen(false); }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-md transition-colors ${location.pathname === path ? "bg-primary/10 text-foreground" : "hover:bg-muted text-foreground"}`}
                >
                  <Icon size={18} className="text-primary" />
                  <span className="text-sm font-heading">{label}</span>
                </button>
              ))}
            </div>
          </Dropdown>
        </div>

        {/* Reports */}
        <button
          onClick={() => navigate("/reports")}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-heading hover:bg-muted transition-colors text-foreground"
        >
          <BarChart3 size={16} /> Reports
        </button>

        {/* Widgets */}
        <button
          onClick={() => navigate("/widgets")}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-heading hover:bg-muted transition-colors text-foreground"
        >
          <Puzzle size={16} /> Widgets
        </button>

        {/* Module Selector */}
        <div className="relative">
          <button
            onClick={() => { setModuleOpen(p => !p); setSetupOpen(false); setUserOpen(false); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-heading hover:bg-muted transition-colors text-foreground"
          >
            <LayoutGrid size={16} /> Module
          </button>
          <Dropdown open={moduleOpen} onClose={() => setModuleOpen(false)} className="right-0 w-80 p-3">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-heading mb-3">Select Module</p>
            <div className={`grid gap-3 ${isAdmin ? "grid-cols-2" : "grid-cols-1"}`}>
              {/* Finance Module */}
              <button
                onClick={() => { setActiveModule("finance"); setModuleOpen(false); navigate("/"); }}
                className={`group flex flex-col items-center gap-2 p-4 rounded-lg border transition-all ${
                  activeModule === "finance" ? "border-primary bg-primary/10" : "border-border hover:border-primary hover:bg-muted"
                }`}
              >
                <svg width="32" height="32" viewBox="0 0 36 36" fill="none">
                  <circle cx="12" cy="22" r="7" stroke="currentColor" strokeWidth="2" className="text-primary" />
                  <circle cx="24" cy="22" r="7" stroke="currentColor" strokeWidth="2" className="text-secondary" />
                  <rect x="8" y="6" width="20" height="3" rx="1.5" fill="currentColor" className="text-primary" />
                </svg>
                <span className="text-xs font-heading text-muted-foreground group-hover:text-foreground transition-colors text-center leading-tight">Finance</span>
                {activeModule === "finance" && <span className="text-[10px] text-primary font-heading">Active</span>}
              </button>

              {/* Admin Module — only for admin/super_admin */}
              {isAdmin && (
                <button
                  onClick={() => { setModuleOpen(false); navigate("/admin"); }}
                  className={`group flex flex-col items-center gap-2 p-4 rounded-lg border transition-all ${
                    location.pathname.startsWith("/admin")
                      ? "border-primary bg-primary/10"
                      : "border-border hover:border-primary hover:bg-muted"
                  }`}
                >
                  <div className="relative">
                    <ShieldCheck size={32} className={`transition-colors ${location.pathname.startsWith("/admin") ? "text-primary" : "text-muted-foreground group-hover:text-primary"}`} />
                    {isSuperAdmin && (
                      <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center" style={{ background: "#7c3aed" }}>
                        <Crown size={8} className="text-white" />
                      </span>
                    )}
                  </div>
                  <span className="text-xs font-heading text-muted-foreground group-hover:text-foreground transition-colors text-center leading-tight">Admin</span>
                  {location.pathname.startsWith("/admin") && <span className="text-[10px] text-primary font-heading">Active</span>}
                </button>
              )}


            </div>
          </Dropdown>
        </div>

        {/* Theme */}
        <button
          onClick={cycleTheme}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-heading hover:bg-muted transition-colors text-foreground"
          title={themeLabel}
        >
          <ThemeIcon size={16} />
          <span className="hidden sm:inline">{themeLabel}</span>
        </button>

        {/* User */}
        <div className="relative">
          <button
            onClick={() => { setUserOpen(p => !p); setModuleOpen(false); setSetupOpen(false); }}
            className="relative w-8 h-8 rounded-full gradient-accent flex items-center justify-center text-xs font-heading text-primary-foreground font-bold"
          >
            {currentUser?.initials || "?"}
            {RoleIcon && (
              <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center" style={{ background: roleColor }}>
                <RoleIcon size={9} className="text-white" />
              </span>
            )}
          </button>
          <Dropdown open={userOpen} onClose={() => setUserOpen(false)} className="right-0 w-56 p-1">
            <div className="px-3 py-2 border-b border-border mb-1">
              <p className="text-sm font-heading font-semibold text-foreground">{currentUser?.name}</p>
              <p className="text-xs text-muted-foreground truncate">{currentUser?.email}</p>
              <div className="mt-1.5">
                {isSuperAdmin && <span className="text-[10px] px-2 py-0.5 rounded-full font-heading" style={{ background: "rgba(124,58,237,0.12)", color: "#7c3aed" }}>Super Admin</span>}
                {currentUser?.role === "admin" && <span className="text-[10px] px-2 py-0.5 rounded-full font-heading" style={{ background: "rgba(37,99,235,0.12)", color: "#2563eb" }}>Admin</span>}
                {currentUser?.role === "user" && <span className="text-[10px] px-2 py-0.5 rounded-full font-heading bg-muted text-muted-foreground">User · {currentUser.permissions.length} permissions</span>}
              </div>
            </div>
            <button className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md hover:bg-muted transition-colors text-foreground">
              <User size={14} /> Profile
            </button>
            <button
              onClick={() => { logout(); navigate("/login"); setUserOpen(false); }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md hover:bg-muted transition-colors text-destructive"
            >
              <LogOut size={14} /> Sign Out
            </button>
          </Dropdown>
        </div>
      </div>
    </header>
  );
};
