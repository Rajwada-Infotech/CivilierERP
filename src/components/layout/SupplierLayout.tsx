import React, { useCallback, useRef, useEffect, useState } from "react";
import { useGracefulLogout } from "@/hooks/useGracefulLogout";
import { useAuth } from "@/contexts/AuthContext";
import { LogoFull } from "@/components/Logo";
import { ThemeSwitcher } from "@/components/navbar/ThemeSwitcher";
import { useTheme } from "@/contexts/ThemeContext";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { FileSpreadsheet, ListChecks, Building2, Bell, ReceiptText } from "lucide-react";
import { Logout } from "iconsax-react";
import { useQuery } from "@tanstack/react-query";
import * as spApi from "@/api/supplierPortalApi";

// ── click-outside helper ───────────────────────────────────────────────────────
function useClickOutside(ref: React.RefObject<HTMLElement>, onClose: () => void, open: boolean) {
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [ref, open, onClose]);
}

// ── User dropdown ─────────────────────────────────────────────────────────────
function UserDropdown({ open, onClose, onToggle, handleLogout }: {
  open: boolean; onClose: () => void; onToggle: () => void; handleLogout: () => void;
}) {
  const { currentUser } = useAuth();
  const wrapRef = useRef<HTMLDivElement>(null);
  useClickOutside(wrapRef, onClose, open);

  const cascade = (i: number): React.CSSProperties => ({
    opacity: open ? 1 : 0,
    transform: open ? "translateY(0)" : "translateY(-6px)",
    transition: `opacity 240ms ease ${i * 55}ms, transform 240ms cubic-bezier(0.16,1,0.3,1) ${i * 55}ms`,
  });

  return (
    <div className="relative shrink-0" ref={wrapRef}>
      <button
        onClick={onToggle}
        className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-primary-foreground gradient-accent overflow-hidden ring-2 ring-border hover:ring-emerald-500/40 transition-all hover:opacity-90"
      >
        {currentUser?.initials || "S"}
      </button>

      <div className={`absolute top-full right-0 mt-2.5 z-50 w-56 p-1 rounded-2xl border border-border/60 bg-card/95 backdrop-blur-2xl shadow-2xl transition-all duration-200 origin-top-right ${open ? "opacity-100 scale-100 pointer-events-auto" : "opacity-0 scale-95 pointer-events-none"}`}>
        {/* Identity banner */}
        <div className="relative px-4 pt-4 pb-3.5 rounded-t-xl overflow-hidden mb-1" style={cascade(0)}>
          <div className="absolute inset-0 pointer-events-none" style={{ background: "linear-gradient(135deg, hsl(160 84% 39% / 0.12) 0%, transparent 70%)" }} />
          <div className="relative flex items-center gap-3">
            <div className="w-10 h-10 rounded-full gradient-accent flex items-center justify-center text-sm font-bold text-primary-foreground shrink-0">
              {currentUser?.initials || "S"}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground truncate">{currentUser?.name}</p>
              <p className="text-xs text-muted-foreground truncate">{currentUser?.email}</p>
            </div>
          </div>
          <div className="relative mt-2">
            <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <Building2 size={9} /> Supplier Portal
            </span>
          </div>
        </div>

        <div className="border-t border-border/60 mx-1" style={cascade(1)} />

        <button
          onMouseDown={handleLogout}
          style={cascade(2)}
          className="w-full flex items-center gap-2 px-3 py-2 mt-1 text-sm rounded-lg hover:bg-destructive/10 transition-colors text-destructive"
        >
          <Logout size={14} /> Sign Out
        </button>
      </div>
    </div>
  );
}

// ── Supplier notification bell ────────────────────────────────────────────────
function SupplierBell() {
  const navigate = useNavigate();
  const { data: quotations = [] } = useQuery({
    queryKey: ["supplier-quotations"],
    queryFn: spApi.getSupplierQuotations,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const { data: grnOrders = [] } = useQuery({
    queryKey: ["supplier-grns"],
    queryFn: spApi.getSupplierGrnSummary,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const now = Date.now();
  const THREE_DAYS = 3 * 86_400_000;
  const urgentQuotations = quotations.filter((q) => {
    if (q.MySubmissionStatus !== "Pending") return false;
    const due = q.DueDate ? new Date(q.DueDate).getTime() : null;
    return due !== null && due - now <= THREE_DAYS;
  }).length;
  const pendingReceipts = grnOrders.filter((o) => !o.isFullyReceived).length;
  const urgentCount = urgentQuotations + pendingReceipts;

  return (
    <button
      onClick={() => navigate("/supplier/notifications")}
      className="relative w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-all"
      aria-label="Notifications"
    >
      <Bell size={16} />
      {urgentCount > 0 && (
        <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-red-500 text-[9px] font-bold text-white flex items-center justify-center leading-none">
          {urgentCount > 9 ? "9+" : urgentCount}
        </span>
      )}
    </button>
  );
}

// ── SupplierLayout ─────────────────────────────────────────────────────────────
export function SupplierLayout({ children }: { children: React.ReactNode }) {
  const { handleLogout, overlay } = useGracefulLogout();
  const location = useLocation();
  const { theme } = useTheme();
  const isDark = theme !== "light";
  const [userOpen, setUserOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);

  const toggleUser = useCallback(() => { setUserOpen((p) => !p); setThemeOpen(false); }, []);
  const closeUser = useCallback(() => setUserOpen(false), []);
  const toggleTheme = useCallback(() => { setThemeOpen((p) => !p); setUserOpen(false); }, []);
  const closeTheme = useCallback(() => setThemeOpen(false), []);

  const navItems = [
    { label: "Quotations", to: "/supplier", icon: FileSpreadsheet, exact: true },
    { label: "Price Catalog", to: "/supplier/catalog", icon: ListChecks, exact: false },
    { label: "Credit Notes", to: "/supplier/credit-notes", icon: ReceiptText, exact: false },
  ];

  const isActive = (item: (typeof navItems)[0]) =>
    item.exact ? location.pathname === item.to : location.pathname.startsWith(item.to);

  // Emerald glow for the supplier portal pill
  const glowRgb = "16,185,129";

  const pillStyle: React.CSSProperties = isDark
    ? {
        borderRadius: "9999px",
        padding: "0.25rem",
        background: "rgba(15, 17, 26, 0.52)",
        border: "1px solid rgba(255,255,255,0.13)",
        boxShadow: "0 2px 20px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.10)",
        backdropFilter: "blur(22px) saturate(160%)",
        WebkitBackdropFilter: "blur(22px) saturate(160%)",
      }
    : {
        borderRadius: "9999px",
        padding: "0.25rem",
        background: "rgba(255,255,255,0.42)",
        border: "1px solid rgba(255,255,255,0.65)",
        boxShadow: "0 2px 16px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.85)",
        backdropFilter: "blur(22px) saturate(180%)",
        WebkitBackdropFilter: "blur(22px) saturate(180%)",
      };

  return (
    <div className="min-h-screen bg-background">
      <style>{`
        .sup-nav-pill {
          display: inline-flex;
          align-items: center;
          gap: 0.375rem;
          padding: 0.375rem 0.75rem;
          border-radius: 9999px;
          font-size: 0.8125rem;
          font-weight: 500;
          color: hsl(var(--foreground) / 0.70);
          background: transparent;
          border: 1px solid transparent;
          transition: background 150ms, border-color 150ms, color 150ms;
          white-space: nowrap;
          text-decoration: none;
        }
        .sup-nav-pill:hover {
          background: rgba(128,128,128,0.15);
          border-color: rgba(128,128,128,0.20);
          color: hsl(var(--foreground));
        }
        .sup-nav-pill--active {
          background: rgba(16,185,129,0.12);
          border-color: rgba(16,185,129,0.35);
          color: hsl(160 84% 39%);
          box-shadow: 0 2px 16px rgba(16,185,129,0.18), inset 0 1px 0 rgba(255,255,255,0.08);
        }
      `}</style>

      <header className="fixed top-0 left-0 right-0 h-14 z-50 flex items-center px-3 sm:px-4 gap-3 border-b border-border bg-card/90 backdrop-blur-xl">
        {/* Logo */}
        <Link to="/supplier" className="flex items-center hover:opacity-80 transition-opacity shrink-0">
          <LogoFull />
        </Link>

        {/* Spacer to push pill to true center */}
        <div className="flex-1 min-w-0" />

        {/* Center pill nav — absolutely centered */}
        <nav
          className="flex items-center gap-0.5 absolute left-1/2 -translate-x-1/2"
          style={pillStyle}
        >
          {/* Dot grid + emerald glow */}
          <div className="absolute inset-0 rounded-full overflow-hidden pointer-events-none z-0">
            <div style={{
              position: "absolute", inset: 0,
              backgroundImage: "radial-gradient(circle, hsl(var(--foreground) / 0.10) 1px, transparent 1px)",
              backgroundSize: "14px 14px",
            }} />
            <div style={{
              position: "absolute", inset: 0,
              background: `radial-gradient(ellipse at 50% 0%, rgba(${glowRgb},0.38) 0%, rgba(${glowRgb},0.12) 50%, transparent 80%)`,
            }} />
          </div>

          {/* Nav items */}
          <div className="relative z-10 flex items-center gap-0.5">
            {navItems.map((item) => {
              const active = isActive(item);
              const Icon = item.icon;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={`sup-nav-pill ${active ? "sup-nav-pill--active" : ""}`}
                >
                  <Icon size={13} />
                  {item.label}
                </Link>
              );
            })}
          </div>
        </nav>

        {/* Right side */}
        <div className="flex-1 min-w-0" />
        <div className="flex items-center gap-1.5 shrink-0">
          <SupplierBell />
          <ThemeSwitcher open={themeOpen} onToggle={toggleTheme} onClose={closeTheme} />
          <UserDropdown open={userOpen} onClose={closeUser} onToggle={toggleUser} handleLogout={handleLogout} />
        </div>
      </header>

      <main className="pt-14">{children}</main>
      {overlay}
    </div>
  );
}
