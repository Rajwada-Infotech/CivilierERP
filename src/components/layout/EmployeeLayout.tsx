// Frame for the Employee Portal: logo, the portal's pages as a scrolling tab strip, theme switcher and the signed-in
// employee's sign-out menu. Mirrors SupplierLayout's role as the portal shell.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { CalendarCheck, CalendarDays, CalendarRange, FileText, History, LayoutDashboard, UserRound, Wallet } from "lucide-react";
import { Logout } from "iconsax-react";
import { useAuth } from "@/contexts/AuthContext";
import { useGracefulLogout } from "@/hooks/useGracefulLogout";
import { LogoFull } from "@/components/Logo";
import { EmployeeAvatar } from "@/pages/employee/EmployeeAvatar";
import { ThemeSwitcher } from "@/components/navbar/ThemeSwitcher";

const NAV = [
  { label: "Dashboard", to: "/employee", icon: LayoutDashboard, exact: true },
  { label: "Salary", to: "/employee/salary", icon: Wallet },
  { label: "Payslips", to: "/employee/payslips", icon: FileText },
  { label: "Attendance", to: "/employee/attendance", icon: CalendarCheck },
  { label: "Leave", to: "/employee/leave", icon: CalendarRange },
  { label: "Holidays", to: "/employee/holidays", icon: CalendarDays },
  { label: "Login History", to: "/employee/login-history", icon: History },
];

function UserMenu({ onSignOut }: { onSignOut: () => void }) {
  const { currentUser } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  return (
    <div className="relative shrink-0" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} aria-label="Account menu" className="rounded-full ring-2 ring-border hover:opacity-90">
        <EmployeeAvatar initials={currentUser?.initials} size={32} />
      </button>
      <div className={`absolute top-full right-0 mt-2.5 z-50 w-60 p-1 border border-border bg-card shadow-2xl transition-all duration-150 origin-top-right ${open ? "opacity-100 scale-100 pointer-events-auto" : "opacity-0 scale-95 pointer-events-none"}`}>
        <div className="px-4 py-3">
          <EmployeeAvatar initials={currentUser?.initials} size={56} className="mb-2" />
          <p className="text-sm font-semibold truncate">{currentUser?.name}</p>
          <p className="text-xs text-muted-foreground truncate">{currentUser?.email}</p>
          <span className="inline-flex items-center gap-1 mt-2 text-[0.625rem] px-2 py-0.5 font-semibold border border-foreground/30"><UserRound size={9} /> Employee Portal</span>
        </div>
        <div className="border-t border-border" />
        <button onMouseDown={onSignOut} className="w-full flex items-center gap-2 px-3 py-2 mt-1 text-sm hover:bg-destructive/10 text-destructive">
          <Logout size={14} /> Sign Out
        </button>
      </div>
    </div>
  );
}

export function EmployeeLayout({ children }: { children: React.ReactNode }) {
  const { handleLogout, overlay } = useGracefulLogout();
  const location = useLocation();
  const [themeOpen, setThemeOpen] = useState(false);
  const toggleTheme = useCallback(() => setThemeOpen((p) => !p), []);
  const closeTheme = useCallback(() => setThemeOpen(false), []);
  const active = (n: (typeof NAV)[number]) => (n.exact ? location.pathname === n.to : location.pathname.startsWith(n.to));

  return (
    <div className="min-h-screen bg-background">
      <header className="fixed top-0 left-0 right-0 z-50 border-b border-border bg-card/95 backdrop-blur-xl">
        <div className="h-14 flex items-center gap-3 px-3 sm:px-4">
          <Link to="/employee" className="flex items-center hover:opacity-80 shrink-0"><LogoFull /></Link>
          <nav className="hidden lg:flex items-center gap-1 mx-auto" aria-label="Employee Portal">
            {NAV.map((n) => {
              const Icon = n.icon;
              return (
                <Link key={n.to} to={n.to} aria-current={active(n) ? "page" : undefined}
                  className={`inline-flex items-center gap-1.5 px-3 h-8 text-[0.8125rem] font-medium border transition-colors ${active(n) ? "border-foreground bg-foreground text-background" : "border-transparent text-foreground/70 hover:text-foreground hover:bg-muted/60"}`}>
                  <Icon size={13} /> {n.label}
                </Link>
              );
            })}
          </nav>
          <div className="flex-1 lg:hidden" />
          <div className="flex items-center gap-1.5 shrink-0 lg:ml-0">
            <ThemeSwitcher open={themeOpen} onToggle={toggleTheme} onClose={closeTheme} />
            <UserMenu onSignOut={handleLogout} />
          </div>
        </div>
        <nav className="lg:hidden flex overflow-x-auto gap-1 px-3 pb-2" aria-label="Employee Portal">
          {NAV.map((n) => {
            const Icon = n.icon;
            return (
              <Link key={n.to} to={n.to} aria-current={active(n) ? "page" : undefined}
                className={`inline-flex shrink-0 items-center gap-1.5 px-3 h-8 text-xs font-medium border ${active(n) ? "border-foreground bg-foreground text-background" : "border-foreground/20 text-foreground/70"}`}>
                <Icon size={12} /> {n.label}
              </Link>
            );
          })}
        </nav>
      </header>
      <main className="pt-[6.25rem] lg:pt-14">
        <div className="max-w-6xl mx-auto px-3 sm:px-6 py-6">{children}</div>
      </main>
      {overlay}
    </div>
  );
}
