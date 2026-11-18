// Frame for the Employee Portal. A soft warm-grey page with frosted glass cards, a pill nav along the top (dark active pill) and
// a bottom tab bar on phones. The dark-gold + charcoal palette and the rounded glass look live in the .ep-* classes below,
// shared by every portal page.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { CalendarCheck, CalendarDays, CalendarRange, Eye, FileText, History, Home, Megaphone, UserRound, Wallet } from "lucide-react";
import { Logout } from "iconsax-react";
import { useAuth } from "@/contexts/AuthContext";
import { useGracefulLogout } from "@/hooks/useGracefulLogout";
import { LogoFull } from "@/components/Logo";
import { ThemeSwitcher } from "@/components/navbar/ThemeSwitcher";
import { EmployeeAvatar } from "@/pages/employee/EmployeeAvatar";
import { viewOnlyInfo } from "@/pages/employee/employeeUi";

const NAV = [
  { label: "Dashboard", short: "Home", to: "/employee", icon: Home, exact: true, mobile: true },
  { label: "Salary", short: "Salary", to: "/employee/salary", icon: Wallet, mobile: false },
  { label: "Payslips", short: "Payslips", to: "/employee/payslips", icon: FileText, mobile: true },
  { label: "Attendance", short: "Attendance", to: "/employee/attendance", icon: CalendarCheck, mobile: true },
  { label: "Leave", short: "Leave", to: "/employee/leave", icon: CalendarRange, mobile: true },
  { label: "Notices", short: "Notices", to: "/employee/notices", icon: Megaphone, mobile: false },
  { label: "Holidays", short: "Holidays", to: "/employee/holidays", icon: CalendarDays, mobile: false },
  { label: "History", short: "History", to: "/employee/login-history", icon: History, mobile: false },
];

// Palette and component classes for every Employee Portal page. The gold is a deep mustard (not bright yellow) with dark text.
const STYLE = `
:root { --ep-gold: 43 89% 38%; --ep-gold-2: 38 90% 31%; --ep-ink: 0 0% 13%; --ep-ink-2: 0 0% 21%; }
.ep-root { min-height: 100vh; background: linear-gradient(135deg, hsl(var(--background)) 0%, hsl(var(--background)) 40%, hsl(var(--ep-gold) / .20) 100%); background-attachment: fixed; }
.ep-gold { background: linear-gradient(135deg, hsl(var(--ep-gold)), hsl(var(--ep-gold-2))); color: #1a1405; }
.ep-ink { background: linear-gradient(135deg, hsl(var(--ep-ink)), hsl(var(--ep-ink-2))); color: #fff; }
.ep-tile { border-radius: 1.5rem; box-shadow: 0 10px 26px -14px rgb(0 0 0 / .45); transition: transform .15s ease, box-shadow .15s ease; }
a.ep-tile:hover, button.ep-tile:hover { transform: translateY(-2px); box-shadow: 0 14px 30px -12px rgb(0 0 0 / .5); }
.ep-card { border-radius: 1.5rem; background: hsl(var(--card) / .78); -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px); border: 1px solid hsl(var(--card) / .9); box-shadow: 0 10px 28px -18px rgb(0 0 0 / .35), inset 0 1px 0 hsl(0 0% 100% / .5); overflow: hidden; }
.ep-pill-nav { border-radius: 9999px; background: hsl(var(--card) / .8); -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px); border: 1px solid hsl(var(--border) / .8); padding: .25rem; box-shadow: 0 6px 18px -12px rgb(0 0 0 / .35); }
.ep-btn { display: inline-flex; align-items: center; justify-content: center; gap: .375rem; height: 2.5rem; padding: 0 1.1rem; border-radius: 9999px; font-size: .8125rem; font-weight: 700; transition: opacity .15s, background .15s; white-space: nowrap; }
.ep-btn:disabled { opacity: .45; cursor: not-allowed; }
.ep-btn-gold { background: linear-gradient(135deg, hsl(var(--ep-gold)), hsl(var(--ep-gold-2))); color: #1a1405; }
.ep-btn-gold:hover:not(:disabled) { opacity: .9; }
.ep-btn-ink { background: hsl(var(--ep-ink)); color: #fff; }
.ep-btn-ink:hover:not(:disabled) { opacity: .88; }
.ep-btn-line { border: 1px solid hsl(var(--border)); background: hsl(var(--card) / .85); color: hsl(var(--foreground)); }
.ep-btn-line:hover:not(:disabled) { background: hsl(var(--muted) / .7); }
.ep-btn-light { background: #fff; color: hsl(var(--ep-ink)); }
.ep-btn-light:hover:not(:disabled) { opacity: .92; }
.ep-field { width: 100%; height: 2.75rem; padding: 0 .95rem; border-radius: 1rem; border: 1px solid hsl(var(--border)); background: hsl(var(--background) / .9); color: hsl(var(--foreground)); font-size: .875rem; outline: none; }
textarea.ep-field { height: auto; padding: .6rem .95rem; }
.ep-field:focus { border-color: hsl(var(--ep-gold)); box-shadow: 0 0 0 3px hsl(var(--ep-gold) / .25); }
.ep-field:disabled { opacity: .6; }
.ep-icon-btn { width: 2.75rem; height: 2.75rem; border-radius: 9999px; border: 1px solid hsl(var(--border)); background: hsl(var(--card) / .85); display: flex; align-items: center; justify-content: center; transition: background .15s, transform .15s; }
.ep-icon-btn:hover { background: hsl(var(--ep-gold) / .18); transform: translateY(-1px); }
.ep-round { width: 3rem; height: 3rem; border-radius: 9999px; display: inline-flex; align-items: center; justify-content: center; transition: transform .15s, opacity .15s; }
.ep-round:hover:not(:disabled) { transform: scale(1.06); }
.ep-round:disabled { opacity: .4; cursor: not-allowed; }
`;

/** The portal's palette and component classes -- also used by the portal sign-in page, which has no layout around it. */
export function EmployeeStyles() {
  return <style>{STYLE}</style>;
}

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
      <button onClick={() => setOpen((o) => !o)} aria-label="Account menu" className="rounded-xl overflow-hidden ring-2 ring-border hover:opacity-90 block">
        <EmployeeAvatar initials={currentUser?.initials} size={36} className="rounded-xl" />
      </button>
      <div className={`absolute top-full right-0 mt-2.5 z-50 w-64 p-1 rounded-2xl border border-border bg-card shadow-2xl transition-all duration-150 origin-top-right ${open ? "opacity-100 scale-100 pointer-events-auto" : "opacity-0 scale-95 pointer-events-none"}`}>
        <div className="px-4 py-3">
          <EmployeeAvatar initials={currentUser?.initials} size={56} className="mb-2 rounded-xl" />
          <p className="text-sm font-semibold truncate">{currentUser?.name}</p>
          <p className="text-xs text-muted-foreground truncate">{currentUser?.email}</p>
          <span className="inline-flex items-center gap-1 mt-2 text-[0.625rem] px-2 py-0.5 rounded-full font-semibold ep-gold"><UserRound size={9} /> Employee Portal</span>
        </div>
        <div className="border-t border-border" />
        <Link to="/employee/holidays" onClick={() => setOpen(false)} className="flex items-center gap-2 px-3 py-2 mt-1 text-sm rounded-lg hover:bg-muted/60"><CalendarDays size={14} /> Holidays</Link>
        <Link to="/employee/salary" onClick={() => setOpen(false)} className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg hover:bg-muted/60"><Wallet size={14} /> Salary details</Link>
        <Link to="/employee/login-history" onClick={() => setOpen(false)} className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg hover:bg-muted/60"><History size={14} /> Login history</Link>
        <div className="border-t border-border mt-1" />
        <button onMouseDown={onSignOut} className="w-full flex items-center gap-2 px-3 py-2 mt-1 text-sm rounded-lg hover:bg-destructive/10 text-destructive">
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
  const preview = viewOnlyInfo();
  const closePreview = () => {
    sessionStorage.clear();
    window.close();
    // A tab the browser will not close (opened another way) goes to the sign-in page instead.
    setTimeout(() => { window.location.href = "/employee-login"; }, 300);
  };
  const active = (n: (typeof NAV)[number]) => (n.exact ? location.pathname === n.to : location.pathname.startsWith(n.to));

  return (
    <div className="ep-root">
      <EmployeeStyles />
      <header className="fixed top-0 left-0 right-0 z-50 bg-background/40 backdrop-blur-xl">
        <div className="h-16 flex items-center gap-3 px-3 sm:px-6">
          <Link to="/employee" className="flex items-center hover:opacity-80 shrink-0"><LogoFull /></Link>
          <nav className="hidden lg:flex items-center gap-1 ep-pill-nav mx-auto" aria-label="Employee Portal">
            {NAV.map((n) => (
              <Link key={n.to} to={n.to} aria-current={active(n) ? "page" : undefined}
                className={`inline-flex items-center px-4 h-9 rounded-full text-[0.8125rem] font-semibold transition-colors ${active(n) ? "ep-ink shadow" : "text-foreground/70 hover:text-foreground hover:bg-muted/60"}`}>
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="flex-1 lg:hidden" />
          <div className="flex items-center gap-2 shrink-0">
            <ThemeSwitcher open={themeOpen} onToggle={toggleTheme} onClose={closeTheme} />
            <UserMenu onSignOut={handleLogout} />
          </div>
        </div>
      </header>

      {preview && (
        <div className="fixed top-16 left-0 right-0 z-40 flex items-center justify-center gap-3 px-3 py-1.5 text-xs font-semibold ep-ink" role="status">
          <Eye size={14} className="shrink-0" />
          <span className="truncate">Viewing {preview.employeeName}'s portal — view only, nothing can be changed.</span>
          <button onClick={closePreview} className="ep-btn ep-btn-light !h-6 !px-3 !text-[0.6875rem] shrink-0">Close preview</button>
        </div>
      )}
      <main className={`${preview ? "pt-[6.25rem]" : "pt-16"} pb-24 lg:pb-8`}>
        <div className="max-w-7xl mx-auto px-3 sm:px-6 py-4">{children}</div>
      </main>

      {/* Phone: bottom tab bar */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-card/90 backdrop-blur-xl" aria-label="Employee Portal">
        <div className="max-w-md mx-auto px-2 pt-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))]" style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}>
          {NAV.filter((n) => n.mobile).map((n) => {
            const Icon = n.icon;
            const on = active(n);
            return (
              <Link key={n.to} to={n.to} aria-current={on ? "page" : undefined} className="flex flex-col items-center gap-0.5 py-1 text-[0.625rem] font-semibold">
                <span className={`w-11 h-7 rounded-full flex items-center justify-center transition-colors ${on ? "ep-ink" : "text-muted-foreground"}`}><Icon size={17} /></span>
                <span className={on ? "text-foreground" : "text-muted-foreground"}>{n.short}</span>
              </Link>
            );
          })}
        </div>
      </nav>
      {overlay}
    </div>
  );
}
