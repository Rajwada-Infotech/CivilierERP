import React, { useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard, Building2, FileText, CreditCard, HardHat, LifeBuoy, User,
  LogOut, Menu, X,
} from "lucide-react";
import { fetchMe, fetchTimeline } from "./portalApi";

const NAV_ITEMS = [
  { to: "/crm-client-portal/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/crm-client-portal/booking", label: "My Booking", icon: Building2 },
  { to: "/crm-client-portal/agreement", label: "Agreement", icon: FileText },
  { to: "/crm-client-portal/payments", label: "Payments", icon: CreditCard },
  { to: "/crm-client-portal/construction", label: "Construction", icon: HardHat },
  { to: "/crm-client-portal/tickets", label: "Support", icon: LifeBuoy },
  { to: "/crm-client-portal/profile", label: "Profile", icon: User },
];

function initials(name: string | null | undefined) {
  if (!name) return "?";
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

const PortalLayout: React.FC = () => {
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { data: me, error: meError } = useQuery({ queryKey: ["portal-me"], queryFn: fetchMe, retry: false, staleTime: 60_000 });
  const { data: timeline, error: tlError } = useQuery({ queryKey: ["portal-timeline"], queryFn: fetchTimeline, retry: false, staleTime: 30_000 });

  useEffect(() => {
    if ((meError as any)?.message === "unauthorized" || (tlError as any)?.message === "unauthorized") {
      localStorage.removeItem("crm_portal_token");
      navigate("/crm-client-portal/login");
    }
  }, [meError, tlError, navigate]);

  const handleLogout = () => {
    localStorage.removeItem("crm_portal_token");
    navigate("/crm-client-portal/login");
  };

  // Small live badges next to nav items so the customer notices something
  // needs their attention without having to click into every page.
  const badges = useMemo(() => {
    const b: Record<string, number> = {};
    if (timeline?.agreement?.CustomerApprovalStatus === "Pending" && timeline?.agreement?.SentToCustomerAt) b.agreement = 1;
    if (timeline?.salesDeed?.CustomerApprovalStatus === "Pending" && timeline?.salesDeed?.SentToCustomerAt) b.agreement = (b.agreement || 0) + 1;
    const pendingMilestones = (timeline?.paymentMilestones || []).filter((m: any) => m.Status === "Pending").length;
    if (pendingMilestones) b.payments = pendingMilestones;
    return b;
  }, [timeline]);

  const badgeKeyFor = (to: string) => {
    if (to.endsWith("/agreement")) return "agreement";
    if (to.endsWith("/payments")) return "payments";
    return null;
  };

  return (
    <div className="min-h-screen flex" style={{ background: "linear-gradient(160deg, #faf5ff 0%, #f5f3ff 15%, #fafafa 100%)" }}>
      {/* ── Sidebar (desktop) ── */}
      <aside className="hidden lg:flex flex-col w-64 shrink-0 relative overflow-hidden"
        style={{ background: "linear-gradient(180deg, #2e1065 0%, #4c1d95 60%, #5b21b6 100%)" }}>
        <div className="absolute inset-0 pointer-events-none"
          style={{ backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.06) 1px, transparent 1px)", backgroundSize: "20px 20px" }} />

        <div className="relative z-10 flex items-center gap-2.5 px-5 py-5 border-b border-white/10">
          <div className="w-9 h-9 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center overflow-hidden shrink-0">
            <img src="/Civilier.png" alt="" className="w-6 h-6 object-contain" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold text-white leading-tight truncate">CivilierERP</p>
            <p className="text-[10px] text-violet-300/70 leading-tight">Customer Portal</p>
          </div>
        </div>

        <nav className="relative z-10 flex-1 px-3 py-4 space-y-1">
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => {
            const key = badgeKeyFor(to);
            const count = key ? badges[key] : 0;
            return (
              <NavLink key={to} to={to}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                    isActive ? "bg-white/15 text-white" : "text-violet-200/70 hover:bg-white/8 hover:text-white"
                  }`
                }>
                <Icon size={17} className="shrink-0" />
                <span className="flex-1">{label}</span>
                {!!count && (
                  <span className="text-[10px] font-bold bg-amber-400 text-amber-950 rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                    {count}
                  </span>
                )}
              </NavLink>
            );
          })}
        </nav>

        <div className="relative z-10 px-3 py-4 border-t border-white/10">
          <div className="flex items-center gap-2.5 px-2 py-2">
            <div className="w-9 h-9 rounded-full bg-violet-400/20 border border-violet-300/30 flex items-center justify-center text-xs font-bold text-violet-100 shrink-0">
              {initials(me?.ApplicantName)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-white truncate">{me?.ApplicantName || "…"}</p>
              <p className="text-[10px] text-violet-300/60 truncate">{me?.ApplicationNo}</p>
            </div>
          </div>
          <button onClick={handleLogout}
            className="w-full mt-2 flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium text-violet-200/70 hover:bg-white/8 hover:text-white transition-colors">
            <LogOut size={14} /> Logout
          </button>
        </div>
      </aside>

      {/* ── Mobile top bar + drawer ── */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-40 flex items-center justify-between px-4 py-3 border-b border-violet-900/10"
        style={{ background: "linear-gradient(135deg, #4c1d95, #5b21b6)" }}>
        <button onClick={() => setMobileOpen(true)} className="text-white p-1"><Menu size={20} /></button>
        <span className="text-sm font-bold text-white">CivilierERP Portal</span>
        <div className="w-8 h-8 rounded-full bg-violet-400/20 border border-violet-300/30 flex items-center justify-center text-[10px] font-bold text-violet-100">
          {initials(me?.ApplicantName)}
        </div>
      </div>
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="w-72 flex flex-col relative overflow-hidden" style={{ background: "linear-gradient(180deg, #2e1065, #5b21b6)" }}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
              <span className="text-sm font-bold text-white">Menu</span>
              <button onClick={() => setMobileOpen(false)} className="text-white/70 p-1"><X size={18} /></button>
            </div>
            <nav className="flex-1 px-3 py-4 space-y-1">
              {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
                <NavLink key={to} to={to} onClick={() => setMobileOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium ${
                      isActive ? "bg-white/15 text-white" : "text-violet-200/70"
                    }`
                  }>
                  <Icon size={17} /> {label}
                </NavLink>
              ))}
              <button onClick={handleLogout}
                className="w-full mt-3 flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium text-violet-200/70">
                <LogOut size={16} /> Logout
              </button>
            </nav>
          </div>
          <div className="flex-1 bg-black/40" onClick={() => setMobileOpen(false)} />
        </div>
      )}

      {/* ── Main content ── */}
      <main className="flex-1 min-w-0 pt-14 lg:pt-0">
        <div className="max-w-5xl mx-auto p-5 lg:p-8">
          {!me || !timeline ? (
            <div className="min-h-[60vh] flex items-center justify-center text-sm text-muted-foreground">Loading your portal…</div>
          ) : (
            <Outlet context={{ me, timeline }} />
          )}
        </div>
      </main>
    </div>
  );
};

export default PortalLayout;
