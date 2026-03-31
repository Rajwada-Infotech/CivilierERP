import React, { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { LogoFull } from "../Logo";
import { useTheme, THEME_DOTS, Theme } from "@/contexts/ThemeContext";
import { useModule } from "@/contexts/ModuleContext";
import { useAuth } from "@/contexts/AuthContext";
import { useNavbarCollapse } from "./AppLayout";
import {
  Calendar,
  Settings,
  BarChart3,
  LogOut,
  User,
  Palette,
  LayoutGrid,
  Puzzle,
  ShieldCheck,
  Crown,
  Shield,
  Receipt,
  Truck,
  Users,
  HardHat,
  Landmark,
  ChevronsLeft,
  ChevronsRight,
  Package,
  Layers,
  Hash,
  CreditCard,
  BookOpen,
  Tag,
  FileType2,
  Activity,
  FileWarning,
  FileText,
} from "lucide-react";

const Dropdown = ({ open, onClose, children, className }: any) => {
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
      className={`absolute top-full mt-2 z-50 rounded-lg border border-border bg-card shadow-xl transition-all duration-200 origin-top-right ${
        open
          ? "opacity-100 scale-100 pointer-events-auto"
          : "opacity-0 scale-95 pointer-events-none"
      } ${className || ""}`}
    >
      {children}
    </div>
  );
};

const masterItems = [
  { icon: Layers, label: "Account Group", path: "/masters/account-group", color: "text-indigo-500" },
  { icon: Receipt, label: "General Ledger", path: "/masters/expenses", color: "text-orange-400" },
  { icon: Truck, label: "Suppliers", path: "/masters/suppliers", color: "text-blue-400" },
  { icon: Users, label: "Customers", path: "/masters/customers", color: "text-purple-400" },
  { icon: HardHat, label: "Contractors", path: "/masters/contractors", color: "text-yellow-400" },
  { icon: Landmark, label: "Banks", path: "/masters/banks", color: "text-green-400" },
  { icon: Package, label: "Items", path: "/masters/items", color: "text-teal-400" },
  { icon: Layers, label: "Item Groups", path: "/masters/item-groups", color: "text-indigo-400" },
  { icon: Hash, label: "HSN", path: "/masters/hsn", color: "text-pink-400" },
  { icon: Calendar, label: "Financial Year", path: "/masters/financial-year", color: "text-amber-500" },
  { icon: BookOpen, label: "Cheque", path: "/masters/cheque", color: "text-cyan-500" },
  { icon: CreditCard, label: "Cards", path: "/masters/card", color: "text-rose-500" },
  { icon: Tag, label: "Named Entry Type", path: "/masters/named-entry-type", color: "text-purple-400" },
  { icon: FileType2, label: "Type of Doc", path: "/masters/type-of-doc", color: "text-sky-500" },
  { icon: FileText, label: "TDS", path: "/masters/tds", color: "text-emerald-500" },
  { icon: Activity, label: "Activity", path: "/masters/activity", color: "text-green-400" },
  { icon: FileWarning, label: "Debit Note", path: "/masters/debit-note", color: "text-orange-500" },
];

export const TopNavbar = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { theme, setTheme } = useTheme();
  const { activeModule, setActiveModule } = useModule();
  const { currentUser, logout } = useAuth();
  const { navCollapsed, setNavCollapsed } = useNavbarCollapse();

  const [setupOpen, setSetupOpen] = useState(false);
  const [moduleOpen, setModuleOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);

  const isModuleActive = activeModule !== null;
  const isSuperAdmin = currentUser?.role === "super_admin";
  const isAdmin = currentUser?.role === "admin" || isSuperAdmin;

  const RoleIcon = isSuperAdmin ? Crown : isAdmin ? Shield : null;
  const roleBadgeClassName = isSuperAdmin ? "bg-violet-600" : "bg-blue-600";

  const toggleSetup = useCallback(() => {
    if (!isModuleActive) return;
    setSetupOpen((prev) => !prev);
    setModuleOpen(false);
    setUserOpen(false);
    setThemeOpen(false);
  }, [isModuleActive]);

  const toggleModule = useCallback(() => {
    setModuleOpen((prev) => !prev);
    setSetupOpen(false);
    setUserOpen(false);
    setThemeOpen(false);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeOpen((prev) => !prev);
    setSetupOpen(false);
    setModuleOpen(false);
    setUserOpen(false);
  }, []);

  const toggleUser = useCallback(() => {
    setUserOpen((prev) => !prev);
    setSetupOpen(false);
    setModuleOpen(false);
    setThemeOpen(false);
  }, []);

  const closeAll = useCallback(() => {
    setSetupOpen(false);
    setModuleOpen(false);
    setUserOpen(false);
    setThemeOpen(false);
  }, []);

  return (
    <header className="fixed top-0 left-0 right-0 h-14 z-50 flex items-center justify-between px-4 border-b border-border bg-card/80 backdrop-blur-lg">
      <button onClick={() => navigate("/")} className="flex items-center gap-2">
        <LogoFull />
      </button>

      <div className="hidden md:flex items-center gap-1">
        <button
          onClick={() => setNavCollapsed(!navCollapsed)}
          className="p-1.5 rounded-md bg-muted border border-border"
        >
          {navCollapsed ? <ChevronsRight size={15} /> : <ChevronsLeft size={15} />}
        </button>

        <div className={`flex items-center gap-1 ${navCollapsed ? "hidden" : ""}`}>
          <div className="relative">
            <button onClick={toggleSetup} className="flex items-center gap-1.5 px-3 py-1.5">
              <Settings size={16} /> Setup
            </button>

            <Dropdown open={setupOpen} onClose={() => setSetupOpen(false)} className="right-0 w-80 p-4">
              <div className="grid grid-cols-4 gap-3">
                {masterItems.map(({ icon: Icon, label, path, color }) => (
                  <button
                    key={label}
                    onClick={() => {
                      navigate(path);
                      closeAll();
                    }}
                    className="flex flex-col items-center gap-2 p-3"
                  >
                    <Icon size={20} className={color} />
                    <span className="text-[11px]">{label}</span>
                  </button>
                ))}
              </div>
            </Dropdown>
          </div>

          <button onClick={() => navigate("/reports")} className="flex items-center gap-1.5 px-3 py-1.5">
            <BarChart3 size={16} /> Reports
          </button>

          <button onClick={() => navigate("/widgets")} className="flex items-center gap-1.5 px-3 py-1.5">
            <Puzzle size={16} /> Widgets
          </button>

          <div className="relative">
            <button onClick={toggleModule} className="flex items-center gap-1.5 px-3 py-1.5">
              <LayoutGrid size={16} /> Module
            </button>

            <Dropdown open={moduleOpen} onClose={() => setModuleOpen(false)} className="right-0 w-80 p-3">
              <div className="grid gap-3">
                <button
                  onClick={() => {
                    setActiveModule("finance");
                    setModuleOpen(false);
                    navigate("/");
                  }}
                  className="p-4 border"
                >
                  Finance
                </button>
              </div>
            </Dropdown>
          </div>
        </div>

        <div className="relative">
          <button onClick={toggleTheme} className="p-2">
            <Palette size={17} />
          </button>

          <Dropdown open={themeOpen} onClose={() => setThemeOpen(false)} className="right-0 w-48 p-1.5">
            {(Object.entries(THEME_DOTS) as [Theme, any][]).map(([t, { label }]) => (
              <button
                key={t}
                onClick={() => {
                  setTheme(t);
                  setThemeOpen(false);
                }}
                className="w-full px-3 py-2 text-sm"
              >
                {label}
              </button>
            ))}
          </Dropdown>
        </div>

        <div className="relative">
          <button onClick={toggleUser} className="w-8 h-8 rounded-full bg-primary text-white">
            {currentUser?.initials || "?"}
          </button>

          <Dropdown open={userOpen} onClose={() => setUserOpen(false)} className="right-0 w-56 p-1">
            <div className="px-3 py-2 border-b">
              <p>{currentUser?.name}</p>
              <p className="text-xs">{currentUser?.email}</p>
            </div>
            <button className="w-full px-3 py-2 flex items-center gap-2">
              <User size={14} /> Profile
            </button>
            <button
              onMouseDown={() => {
                logout();
                navigate("/login");
              }}
              className="w-full px-3 py-2 flex items-center gap-2 text-red-500"
            >
              <LogOut size={14} /> Sign Out
            </button>
          </Dropdown>
        </div>
      </div>
    </header>
  );
};