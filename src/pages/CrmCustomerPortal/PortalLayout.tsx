import React, { Suspense, useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard, Building2, FileText, CreditCard, HardHat, LifeBuoy, IdCard,
  LogOut, Menu, X, Bell, ChevronRight, Radio, ChevronLeft, Layers,
} from "lucide-react";
import { fetchMe, fetchApplications, fetchTimeline } from "./portalApi";
import {
  INK, VIOLET_DEEP, VIOLET, VIOLET_LIGHT, GOLD, GOLD_SOFT, PORCELAIN, SURFACE_ALT, HAIRLINE, TEXT, TEXT_MUTED, TEXT_FAINT, serif, mono,
  applyPortalAccent, getStoredPortalAccent, applyPortalMode, getStoredPortalMode,
} from "./portalTheme";

const NAV_GROUPS: { label: string; items: { to: string; label: string; icon: any }[] }[] = [
  { label: "Overview", items: [
    { to: "/crm-client-portal/dashboard", label: "Dashboard", icon: LayoutDashboard },
  ]},
  { label: "My Property", items: [
    { to: "/crm-client-portal/booking", label: "My Booking", icon: Building2 },
    { to: "/crm-client-portal/construction", label: "Construction", icon: HardHat },
  ]},
  { label: "Finance", items: [
    { to: "/crm-client-portal/agreement", label: "Agreement", icon: FileText },
    { to: "/crm-client-portal/payments", label: "Payments", icon: CreditCard },
  ]},
  { label: "Support", items: [
    { to: "/crm-client-portal/tickets", label: "Support Tickets", icon: LifeBuoy },
  ]},
  { label: "Updates", items: [
    { to: "/crm-client-portal/activity", label: "Updates & Approvals", icon: Radio },
  ]},
  { label: "Account", items: [
    { to: "/crm-client-portal/profile", label: "Customer 360", icon: IdCard },
  ]},
];
const NAV_ITEMS = NAV_GROUPS.flatMap((g) => g.items);

function initials(name: string | null | undefined) {
  if (!name) return "?";
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

const SIDEBAR_BG = `linear-gradient(180deg, ${INK} 0%, ${VIOLET_DEEP} 55%, ${VIOLET} 100%)`;

// ── Application Selector — shown when the customer has multiple applications ──
function ApplicationSelector({
  applications,
  onSelect,
  me,
}: {
  applications: any[];
  onSelect: (id: number) => void;
  me: any;
}) {
  const stageColor: Record<string, string> = {
    Draft: "text-slate-500 bg-slate-100",
    Pending: "text-blue-600 bg-blue-50",
    Approved: "text-green-600 bg-green-50",
    Rejected: "text-red-600 bg-red-50",
    Cancelled: "text-orange-600 bg-orange-50",
    Expired: "text-slate-400 bg-slate-50",
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: PORCELAIN }}>
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-white border shadow-sm flex items-center justify-center mx-auto mb-4 overflow-hidden"
            style={{ borderColor: `${GOLD}40` }}>
            <Layers size={24} style={{ color: GOLD }} />
          </div>
          <h1 className="text-2xl font-semibold mb-1" style={{ ...serif, color: INK }}>
            Select an Application
          </h1>
          <p className="text-sm" style={{ color: TEXT_MUTED }}>
            Welcome back, <strong>{me?.Name || "Customer"}</strong>. You have {applications.length} applications — pick one to view its details.
          </p>
        </div>

        {/* Application cards */}
        <div className="space-y-3">
          {applications.map((app: any) => {
            const statusCls = stageColor[app.BookingStatus || app.ApplicationStatus] || "text-slate-500 bg-slate-100";
            const stage = app.BookingStatus
              ? `Booking · ${app.BookingStatus}`
              : `Application · ${app.ApplicationStatus || "Draft"}`;
            return (
              <button
                key={app.ApplicationId}
                onClick={() => onSelect(app.ApplicationId)}
                className="w-full text-left rounded-xl p-5 border transition-all hover:shadow-md active:scale-[0.99]"
                style={{
                  background: "white",
                  borderColor: HAIRLINE,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = `${GOLD}80`; e.currentTarget.style.boxShadow = `0 4px 20px ${GOLD}15`; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = HAIRLINE; e.currentTarget.style.boxShadow = ""; }}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-semibold tracking-wide" style={{ ...mono, color: GOLD }}>
                        {app.ApplicationNo}
                      </span>
                      {app.BookingNo && (
                        <span className="text-xs" style={{ color: TEXT_MUTED }}>→ {app.BookingNo}</span>
                      )}
                    </div>
                    <p className="text-sm font-semibold truncate" style={{ color: INK }}>
                      {app.ProjectName || "Project"}{app.UnitNo ? ` · Unit ${app.UnitNo}` : ""}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: TEXT_MUTED }}>
                      {app.ApplicantName}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${statusCls}`}>
                      {stage}
                    </span>
                    <ChevronRight size={16} style={{ color: TEXT_FAINT }} />
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        <p className="text-center text-xs mt-6" style={{ color: TEXT_FAINT }}>
          You can switch between applications at any time from the sidebar.
        </p>
      </div>
    </div>
  );
}

const PortalLayout: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [selectedApplicationId, setSelectedApplicationId] = useState<number | null>(null);

  const { data: me, error: meError } = useQuery({ queryKey: ["portal-me"], queryFn: fetchMe, retry: false, staleTime: 60_000 });
  const { data: applications, error: appsError } = useQuery({ queryKey: ["portal-applications"], queryFn: fetchApplications, retry: false, staleTime: 60_000 });

  // Auto-select if the customer has exactly one application — invisible to them
  useEffect(() => {
    if (!applications) return;
    if (applications.length === 1 && !selectedApplicationId) {
      setSelectedApplicationId(applications[0].ApplicationId);
    }
  }, [applications, selectedApplicationId]);

  const { data: timeline, error: tlError } = useQuery({
    queryKey: ["portal-timeline", selectedApplicationId],
    queryFn: () => fetchTimeline(selectedApplicationId!),
    enabled: !!selectedApplicationId,
    retry: false,
    staleTime: 30_000,
  });

  useEffect(() => {
    applyPortalAccent(getStoredPortalAccent());
    applyPortalMode(getStoredPortalMode());
  }, []);

  useEffect(() => {
    const isUnauthorized = [meError, appsError, tlError].some((e: any) => e?.message === "unauthorized");
    const needsPasswordChange = [meError, appsError, tlError].some((e: any) => e?.message === "password_change_required");
    if (isUnauthorized) {
      localStorage.removeItem("crm_portal_token");
      navigate("/crm-client-portal/login");
    }
    if (needsPasswordChange) navigate("/crm-client-portal/change-password");
  }, [meError, appsError, tlError, navigate]);

  const handleLogout = () => {
    localStorage.removeItem("crm_portal_token");
    navigate("/crm-client-portal/login");
  };

  const handleBackToSelector = () => setSelectedApplicationId(null);

  const hasMultipleApps = (applications?.length ?? 0) > 1;

  const badges = useMemo(() => {
    const b: Record<string, number> = {};
    if (timeline?.agreement?.CustomerApprovalStatus === "Pending" && timeline?.agreement?.SentToCustomerAt) b.agreement = (b.agreement || 0) + 1;
    if (timeline?.salesDeed?.CustomerApprovalStatus === "Pending" && timeline?.salesDeed?.SentToCustomerAt) b.agreement = (b.agreement || 0) + 1;
    const pendingMilestones = (timeline?.paymentMilestones || []).filter((m: any) => m.Status === "Pending").length;
    if (pendingMilestones) b.payments = pendingMilestones;
    return b;
  }, [timeline]);
  const totalAlerts = Object.values(badges).reduce((a, b) => a + b, 0);

  const badgeKeyFor = (to: string) => {
    if (to.endsWith("/agreement")) return "agreement";
    if (to.endsWith("/payments")) return "payments";
    return null;
  };

  const activeItem = NAV_ITEMS.find((n) => location.pathname.startsWith(n.to));
  const activeGroup = NAV_GROUPS.find((g) => g.items.some((i) => i === activeItem));

  // Selected application metadata for sidebar display
  const selectedApp = applications?.find((a: any) => a.ApplicationId === selectedApplicationId);

  const navLinkContent = (to: string, label: string, Icon: any, active: boolean) => {
    const key = badgeKeyFor(to);
    const count = key ? badges[key] : 0;
    return (
      <div className="relative flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors"
        style={{
          color: active ? "#fff" : "rgba(233,225,250,0.68)",
          background: active ? "rgba(255,255,255,0.08)" : "transparent",
        }}>
        {active && <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full" style={{ background: GOLD }} />}
        <Icon size={16} className="shrink-0" />
        <span className="flex-1">{label}</span>
        {!!count && (
          <span className="text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1"
            style={{ background: GOLD, color: INK }}>
            {count}
          </span>
        )}
      </div>
    );
  };

  // Loading state: waiting for me or applications list
  const isLoading = !me || !applications;

  // Show application selector if customer has multiple apps and none selected yet
  const showSelector = !isLoading && hasMultipleApps && !selectedApplicationId;

  return (
    <div className="min-h-screen flex" style={{ background: PORCELAIN }}>
      {/* ── Sidebar (desktop) ── */}
      <aside className="hidden lg:flex flex-col w-72 shrink-0 relative overflow-hidden" style={{ background: SIDEBAR_BG }}>
        <div className="absolute inset-0 pointer-events-none"
          style={{ backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.05) 1px, transparent 1px)", backgroundSize: "22px 22px" }} />

        <div className="relative z-10 flex items-center gap-2.5 px-5 py-5 border-b border-white/10">
          <div className="w-9 h-9 rounded-lg bg-white/10 border flex items-center justify-center overflow-hidden shrink-0" style={{ borderColor: "rgba(201,162,39,0.35)" }}>
            <img src="/Civilier.png" alt="" className="w-6 h-6 object-contain" />
          </div>
          <div className="min-w-0">
            <p className="text-base font-semibold text-white leading-tight truncate" style={serif}>CivilierERP</p>
            <p className="text-[10px] tracking-[0.12em] uppercase leading-tight" style={{ color: GOLD }}>Customer Record</p>
          </div>
        </div>

        {/* Back to applications button — only shown for multi-app customers */}
        {hasMultipleApps && selectedApplicationId && (
          <div className="relative z-10 px-3 pt-3">
            <button
              onClick={handleBackToSelector}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors"
              style={{ color: "rgba(233,225,250,0.75)", border: "1px solid rgba(255,255,255,0.12)" }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "#fff"; e.currentTarget.style.background = "rgba(255,255,255,0.08)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "rgba(233,225,250,0.75)"; e.currentTarget.style.background = ""; }}
            >
              <ChevronLeft size={13} />
              My Applications ({applications?.length})
            </button>
          </div>
        )}

        <nav className="relative z-10 flex-1 px-3 py-5 space-y-5 overflow-y-auto">
          {NAV_GROUPS.map((group) => (
            <div key={group.label}>
              <p className="px-3 mb-1.5 text-[10px] font-semibold tracking-[0.16em] uppercase" style={{ color: "rgba(201,162,39,0.65)" }}>
                {group.label}
              </p>
              <div className="space-y-0.5">
                {group.items.map(({ to, label, icon: Icon }) => (
                  <NavLink key={to} to={to}>
                    {({ isActive }) => navLinkContent(to, label, Icon, isActive)}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        {/* Record Card */}
        <div className="relative z-10 px-3 pb-4">
          <div className="rounded-xl p-3.5" style={{ background: "rgba(255,255,255,0.05)", border: `1px solid ${GOLD}55` }}>
            <p className="text-[9px] font-semibold tracking-[0.18em] uppercase mb-2" style={{ color: GOLD }}>Record Holder</p>
            <div className="flex items-center gap-2.5 mb-2">
              <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                style={{ background: GOLD_SOFT, color: GOLD, border: `1px solid ${GOLD}55` }}>
                {initials(me?.Name)}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-white truncate" style={serif}>{me?.Name || "…"}</p>
                {selectedApp && (
                  <p className="text-[10px] truncate" style={{ ...mono, color: "rgba(233,225,250,0.55)" }}>
                    {selectedApp.ApplicationNo}
                  </p>
                )}
              </div>
            </div>
            <button onClick={handleLogout}
              className="w-full flex items-center justify-center gap-2 py-1.5 rounded-lg text-xs font-medium transition-colors"
              style={{ border: "1px solid rgba(255,255,255,0.15)", color: "rgba(233,225,250,0.75)" }}>
              <LogOut size={13} /> Sign Out
            </button>
          </div>
        </div>
      </aside>

      {/* ── Mobile top bar + drawer ── */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-40 flex items-center justify-between px-4 py-3" style={{ background: SIDEBAR_BG }}>
        <button onClick={() => setMobileOpen(true)} className="text-white p-1"><Menu size={20} /></button>
        <span className="text-sm font-semibold text-white" style={serif}>CivilierERP</span>
        <div className="w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold"
          style={{ background: GOLD_SOFT, color: GOLD, border: `1px solid ${GOLD}55` }}>
          {initials(me?.Name)}
        </div>
      </div>
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="w-72 flex flex-col relative overflow-hidden" style={{ background: SIDEBAR_BG }}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
              <span className="text-sm font-semibold text-white" style={serif}>Menu</span>
              <button onClick={() => setMobileOpen(false)} className="text-white/70 p-1"><X size={18} /></button>
            </div>
            {hasMultipleApps && selectedApplicationId && (
              <div className="px-3 pt-3">
                <button
                  onClick={() => { setSelectedApplicationId(null); setMobileOpen(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium"
                  style={{ color: "rgba(233,225,250,0.75)", border: "1px solid rgba(255,255,255,0.12)" }}
                >
                  <ChevronLeft size={13} /> My Applications ({applications?.length})
                </button>
              </div>
            )}
            <nav className="flex-1 px-3 py-4 space-y-4 overflow-y-auto">
              {NAV_GROUPS.map((group) => (
                <div key={group.label}>
                  <p className="px-3 mb-1 text-[10px] font-semibold tracking-[0.16em] uppercase" style={{ color: "rgba(201,162,39,0.65)" }}>{group.label}</p>
                  {group.items.map(({ to, label, icon: Icon }) => (
                    <NavLink key={to} to={to} onClick={() => setMobileOpen(false)}>
                      {({ isActive }) => navLinkContent(to, label, Icon, isActive)}
                    </NavLink>
                  ))}
                </div>
              ))}
              <button onClick={handleLogout}
                className="w-full mt-3 flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium" style={{ color: "rgba(233,225,250,0.75)" }}>
                <LogOut size={16} /> Sign Out
              </button>
            </nav>
          </div>
          <div className="flex-1 bg-black/40" onClick={() => setMobileOpen(false)} />
        </div>
      )}

      {/* ── Main content ── */}
      <main className="flex-1 min-w-0 pt-14 lg:pt-0 flex flex-col">
        {/* Desktop topbar */}
        <div className="hidden lg:flex items-center justify-between px-8 py-3.5" style={{ background: SURFACE_ALT, borderBottom: `1px solid ${HAIRLINE}` }}>
          <div className="flex items-center gap-1.5 text-xs" style={{ color: TEXT_MUTED }}>
            <span>{activeGroup?.label || "Portal"}</span>
            <ChevronRight size={12} />
            <span className="font-semibold" style={{ color: TEXT }}>{activeItem?.label || "Dashboard"}</span>
          </div>
          <div className="relative">
            <Bell size={17} style={{ color: VIOLET_LIGHT }} />
            {totalAlerts > 0 && (
              <span className="absolute -top-1.5 -right-1.5 text-[9px] font-bold rounded-full min-w-[15px] h-[15px] flex items-center justify-center px-0.5"
                style={{ background: GOLD, color: INK }}>
                {totalAlerts}
              </span>
            )}
          </div>
        </div>

        <div className="flex-1 max-w-5xl w-full mx-auto p-5 lg:p-8">
          {isLoading ? (
            <div className="min-h-[60vh] flex items-center justify-center text-sm" style={{ color: TEXT_FAINT }}>
              Loading your portal…
            </div>
          ) : showSelector ? (
            <ApplicationSelector
              applications={applications!}
              onSelect={setSelectedApplicationId}
              me={me}
            />
          ) : !selectedApplicationId ? (
            <div className="min-h-[60vh] flex items-center justify-center text-sm" style={{ color: TEXT_FAINT }}>
              No active applications found.
            </div>
          ) : (
            <Suspense fallback={<div className="min-h-[40vh] flex items-center justify-center text-sm" style={{ color: TEXT_FAINT }}>Loading…</div>}>
              <Outlet context={{ me, timeline, applicationId: selectedApplicationId, applications }} />
            </Suspense>
          )}
        </div>
      </main>
    </div>
  );
};

export default PortalLayout;
