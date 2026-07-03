import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { useAuth } from "@/contexts/AuthContext";
import {
  FileText, Bell, CheckCircle, Package,
  Clock, ShieldCheck, ArrowRight, IndianRupee,
  Building2, LogOut, ChevronRight, TrendingUp,
  BarChart2, Zap,
} from "lucide-react";

const fade = (delay = 0) => ({
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  // `as const` keeps this a fixed-length tuple instead of widening to
  // number[] — framer-motion's cubic-bezier easing type requires the tuple
  // shape, which TS only infers automatically for literals written directly
  // inline in a `transition={{...}}` prop, not ones returned from a helper.
  transition: { duration: 0.5, delay, ease: [0.16, 1, 0.3, 1] as const },
});

// ── Portal header ─────────────────────────────────────────────────────────────
function PortalHeader() {
  const { currentUser, logout } = useAuth();
  const navigate = useNavigate();
  const firstName = currentUser?.name?.trim().split(/\s+/)[0] || "Supplier";

  return (
    <header className="sticky top-0 z-50 flex items-center justify-between px-6 sm:px-10 py-3.5"
      style={{ background: "rgba(255,255,255,0.95)", borderBottom: "1px solid rgba(0,0,0,0.07)", backdropFilter: "blur(12px)" }}>
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg border border-slate-200 shadow-sm overflow-hidden">
          <img src="/Civilier.png" alt="" className="w-full h-full object-cover" />
        </div>
        <span className="font-bold text-slate-800 tracking-tight text-sm">CivilierERP</span>
        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">Supplier</span>
      </div>

      <div className="flex items-center gap-3">
        <div className="hidden sm:flex items-center gap-2 text-sm text-slate-600">
          <div className="w-7 h-7 rounded-full bg-emerald-100 flex items-center justify-center text-xs font-bold text-emerald-700">
            {firstName[0]?.toUpperCase()}
          </div>
          <span className="font-medium">{currentUser?.name ?? firstName}</span>
        </div>
        <button onClick={() => { logout(); navigate("/supplier-login"); }}
          className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-red-500 transition-colors px-3 py-1.5 rounded-lg hover:bg-red-50">
          <LogOut size={13} /> Sign out
        </button>
      </div>
    </header>
  );
}

// ── Welcome hero ──────────────────────────────────────────────────────────────
function WelcomeHero() {
  const { currentUser } = useAuth();
  const firstName = currentUser?.name?.trim().split(/\s+/)[0] || "Supplier";
  const navigate = useNavigate();

  return (
    <section className="relative overflow-hidden px-6 sm:px-10 py-10 sm:py-14"
      style={{ background: "linear-gradient(160deg, #f0fdf4 0%, #ecfdf5 40%, #ffffff 100%)" }}>
      {/* subtle dot grid */}
      <div className="absolute inset-0 pointer-events-none"
        style={{ backgroundImage: "radial-gradient(circle, rgba(5,150,105,0.08) 1px, transparent 1px)", backgroundSize: "20px 20px" }} />

      <div className="relative max-w-6xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
        <div>
          <motion.p className="text-sm font-medium text-emerald-600 mb-1 flex items-center gap-1.5" {...fade(0)}>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse inline-block" />
            Supplier Portal
          </motion.p>
          <motion.h1 className="text-3xl sm:text-4xl font-bold text-slate-900 leading-tight" {...fade(0.1)}>
            Welcome back, {firstName}
          </motion.h1>
          <motion.p className="text-slate-500 text-sm mt-2 max-w-md" {...fade(0.2)}>
            Respond to open RFQs, manage your price catalog and track your submission status.
          </motion.p>
        </div>

        {/* Quick stats */}
        <motion.div className="flex items-center gap-4 sm:gap-6 shrink-0" {...fade(0.25)}>
          {[
            { icon: FileText, label: "Open RFQs", val: "—", col: "text-blue-600", bg: "bg-blue-50" },
            { icon: CheckCircle, label: "Submitted", val: "—", col: "text-emerald-600", bg: "bg-emerald-50" },
            { icon: Clock, label: "Pending", val: "—", col: "text-amber-600", bg: "bg-amber-50" },
          ].map((s) => (
            <div key={s.label} className="flex flex-col items-center text-center">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center mb-1.5 ${s.bg}`}>
                <s.icon size={16} className={s.col} />
              </div>
              <span className="text-xl font-bold text-slate-800">{s.val}</span>
              <span className="text-[10px] text-slate-400 mt-0.5">{s.label}</span>
            </div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

// ── Quotations section ────────────────────────────────────────────────────────
function QuotationsSection() {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const uid = currentUser?.id ?? "";

  const mockQuotations = [
    { id: "QT-2026-041", item: "TMT Steel Bars – 10mm", deadline: "Jul 8, 2026", status: "Open", priority: "High" },
    { id: "QT-2026-038", item: "Cement OPC 53 Grade – 500 Bags", deadline: "Jul 6, 2026", status: "Submitted", priority: "Medium" },
    { id: "QT-2026-035", item: "River Sand – 50 Tons", deadline: "Jul 10, 2026", status: "Open", priority: "Low" },
    { id: "QT-2026-029", item: "Electrical Conduit Pipes – PVC", deadline: "Jul 5, 2026", status: "L1", priority: "High" },
    { id: "QT-2026-024", item: "Binding Wire – 20 Gauge", deadline: "Jul 12, 2026", status: "Open", priority: "Medium" },
  ];

  const statusStyle: Record<string, string> = {
    "Open": "bg-blue-50 text-blue-600",
    "Submitted": "bg-emerald-50 text-emerald-700",
    "L1": "bg-violet-50 text-violet-700",
  };
  const priorityDot: Record<string, string> = {
    "High": "bg-red-400",
    "Medium": "bg-amber-400",
    "Low": "bg-slate-300",
  };

  return (
    <section className="px-6 sm:px-10 py-10">
      <div className="max-w-6xl mx-auto">
        <motion.div className="flex items-center justify-between mb-5" {...fade(0)}>
          <div>
            <h2 className="text-lg font-bold text-slate-900">Active Quotations</h2>
            <p className="text-xs text-slate-400 mt-0.5">RFQs waiting for your response</p>
          </div>
          <button onClick={() => navigate(`/supplier-portal/${uid}`)}
            className="flex items-center gap-1.5 text-sm font-semibold text-emerald-600 hover:text-emerald-700 transition-colors">
            View all <ChevronRight size={14} />
          </button>
        </motion.div>

        <motion.div className="rounded-2xl border border-slate-100 overflow-hidden shadow-sm" {...fade(0.1)}>
          {/* Table header */}
          <div className="grid grid-cols-[2fr_2fr_1fr_1fr] gap-4 px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400"
            style={{ background: "#f8fafc", borderBottom: "1px solid #f1f5f9" }}>
            <span>RFQ / Item</span>
            <span className="hidden sm:block">Description</span>
            <span>Deadline</span>
            <span>Status</span>
          </div>

          {mockQuotations.map((q, i) => (
            <motion.div key={q.id}
              className="grid grid-cols-[2fr_2fr_1fr_1fr] gap-4 px-5 py-3.5 items-center hover:bg-slate-50 transition-colors cursor-pointer border-b border-slate-50 last:border-0"
              initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.15 + i * 0.06, duration: 0.4 }}
              onClick={() => navigate(`/supplier-portal/${uid}`)}>
              <div className="flex items-center gap-2.5 min-w-0">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${priorityDot[q.priority]}`} />
                <span className="text-xs font-mono font-semibold text-slate-700 truncate">{q.id}</span>
              </div>
              <span className="hidden sm:block text-xs text-slate-500 truncate">{q.item}</span>
              <span className="text-xs text-slate-500">{q.deadline}</span>
              <span className={`text-[11px] font-semibold px-2 py-1 rounded-full w-fit ${statusStyle[q.status] ?? "bg-slate-100 text-slate-600"}`}>
                {q.status}
              </span>
            </motion.div>
          ))}
        </motion.div>

        <motion.p className="text-[11px] text-slate-400 mt-2.5 text-center" {...fade(0.4)}>
          Sample data shown — connect to your account to see live RFQs
        </motion.p>
      </div>
    </section>
  );
}

// ── Price catalog section ─────────────────────────────────────────────────────
function PriceCatalogSection() {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const uid = currentUser?.id ?? "";

  const categories = [
    { name: "Structural Steel", items: 18, priced: 14, col: "#059669", bg: "#ecfdf5" },
    { name: "Cement & Sand", items: 9, priced: 9, col: "#3b82f6", bg: "#eff6ff" },
    { name: "Electrical", items: 24, priced: 11, col: "#8b5cf6", bg: "#f5f3ff" },
    { name: "Plumbing", items: 15, priced: 8, col: "#f59e0b", bg: "#fffbeb" },
  ];

  return (
    <section className="px-6 sm:px-10 pb-10">
      <div className="max-w-6xl mx-auto">
        <motion.div className="flex items-center justify-between mb-5" {...fade(0)}>
          <div>
            <h2 className="text-lg font-bold text-slate-900">Price Catalog</h2>
            <p className="text-xs text-slate-400 mt-0.5">Your rate coverage by material category</p>
          </div>
          <button onClick={() => navigate(`/supplier-portal/${uid}/catalog`)}
            className="flex items-center gap-1.5 text-sm font-semibold text-emerald-600 hover:text-emerald-700 transition-colors">
            Manage <ChevronRight size={14} />
          </button>
        </motion.div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {categories.map((cat, i) => {
            const pct = Math.round((cat.priced / cat.items) * 100);
            return (
              <motion.div key={cat.name}
                className="rounded-2xl border border-slate-100 p-5 bg-white hover:shadow-md transition-shadow cursor-pointer"
                initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 + i * 0.08, duration: 0.5 }}
                onClick={() => navigate(`/supplier-portal/${uid}/catalog`)}>
                <div className="flex items-center justify-between mb-3">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center"
                    style={{ background: cat.bg }}>
                    <IndianRupee size={15} style={{ color: cat.col }} />
                  </div>
                  <span className="text-xs font-bold" style={{ color: cat.col }}>{pct}%</span>
                </div>
                <p className="text-sm font-semibold text-slate-800 mb-1">{cat.name}</p>
                <p className="text-[11px] text-slate-400 mb-3">{cat.priced} of {cat.items} items priced</p>
                <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                  <motion.div className="h-full rounded-full"
                    style={{ background: cat.col }}
                    initial={{ width: 0 }}
                    animate={{ width: `${pct}%` }}
                    transition={{ duration: 0.8, delay: 0.3 + i * 0.1 }} />
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ── Quick actions ─────────────────────────────────────────────────────────────
function QuickActions() {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const uid = currentUser?.id ?? "";

  const actions = [
    { icon: FileText, label: "My Quotations", desc: "View & respond to RFQs", href: `/supplier-portal/${uid}`, col: "text-blue-600", bg: "bg-blue-50" },
    { icon: IndianRupee, label: "Price Catalog", desc: "Update your rates", href: `/supplier-portal/${uid}/catalog`, col: "text-emerald-600", bg: "bg-emerald-50" },
    { icon: Building2, label: "Company Profile", desc: "Contact & address details", href: `/supplier-portal/${uid}`, col: "text-violet-600", bg: "bg-violet-50" },
    { icon: Bell, label: "Notifications", desc: "Alerts & reminders", href: `/supplier-portal/${uid}`, col: "text-amber-600", bg: "bg-amber-50" },
  ];

  return (
    <section className="px-6 sm:px-10 pb-10 bg-white">
      <div className="max-w-6xl mx-auto">
        <motion.h2 className="text-lg font-bold text-slate-900 mb-5" {...fade(0)}>Quick Actions</motion.h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {actions.map((a, i) => (
            <motion.button key={a.label} onClick={() => navigate(a.href)}
              className="flex flex-col items-start p-5 rounded-2xl border border-slate-100 bg-white hover:shadow-md hover:-translate-y-0.5 transition-all text-left"
              initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 + i * 0.07, duration: 0.4 }}>
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center mb-3 ${a.bg}`}>
                <a.icon size={16} className={a.col} />
              </div>
              <p className="text-sm font-semibold text-slate-800">{a.label}</p>
              <p className="text-[11px] text-slate-400 mt-0.5">{a.desc}</p>
            </motion.button>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Platform capabilities (replaces Integration dark section) ─────────────────
function PlatformFeatures() {
  const tiles = [
    "📊 L1 Chart", "📋 Material Requests", "🏗️ Purchase Orders",
    "📦 GRN Tracking", "💰 Invoicing", "🔔 Live Alerts",
    "📁 Document Store", "✅ Approval Flows", "🔐 Role-based Access",
    "📱 Mobile Friendly", "🤝 Vendor Portal", "📈 Analytics",
  ];

  return (
    <section className="px-6 sm:px-10 py-10">
      <div className="max-w-6xl mx-auto rounded-2xl px-8 py-10"
        style={{ background: "linear-gradient(135deg, #064e3b 0%, #065f46 50%, #047857 100%)" }}>
        <motion.div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8" {...fade(0)}>
          <div>
            <div className="flex items-center gap-1.5 text-[11px] font-bold tracking-widest text-emerald-300 mb-2 uppercase">
              <ShieldCheck size={11} /> Platform Capabilities
            </div>
            <h2 className="text-2xl font-bold text-white">Everything available to you</h2>
            <p className="text-emerald-200/60 text-sm mt-1">All modules connected to your supplier account</p>
          </div>
          <button className="flex items-center gap-1.5 text-sm font-semibold text-white/80 hover:text-white transition-colors">
            Explore all <ArrowRight size={14} />
          </button>
        </motion.div>

        <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-3">
          {tiles.map((item, i) => (
            <motion.div key={item}
              className="flex flex-col items-center gap-1.5 px-3 py-3.5 rounded-xl cursor-pointer transition-all hover:-translate-y-0.5"
              style={{ background: "rgba(255,255,255,0.10)", border: "1px solid rgba(255,255,255,0.12)" }}
              initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: i * 0.04, duration: 0.4 }}>
              <span className="text-xl">{item.split(" ")[0]}</span>
              <span className="text-[10px] text-white/60 text-center leading-tight font-medium">{item.split(" ").slice(1).join(" ")}</span>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function SupplierLanding() {
  return (
    <div className="min-h-screen font-sans" style={{ background: "#f8fafc" }}>
      <PortalHeader />
      <WelcomeHero />
      <div className="bg-white">
        <QuotationsSection />
        <PriceCatalogSection />
        <QuickActions />
      </div>
      <PlatformFeatures />
    </div>
  );
}
