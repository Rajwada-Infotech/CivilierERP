import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Eye, EyeOff } from "lucide-react";
import {
  motion,
  AnimatePresence,
  useMotionValue,
  useTransform,
  useSpring,
} from "framer-motion";
import { toast } from "sonner";

// ── Role hints (kept for potential future use) ────────────────────────────────
const ROLE_HINTS = [
  { role: "Super Admin", email: "superadmin@civilier.com", password: "super123", color: "#7c3aed" },
  { role: "Admin", email: "admin@civilier.com", password: "admin123", color: "#2563eb" },
  { role: "Engineer", email: "engineer@civilier.com", password: "engineer123", color: "#14b8a6" },
];

// ── Typewriter ────────────────────────────────────────────────────────────────
function useTypewriter(words: string[], speed = 80, pause = 2400) {
  const [display, setDisplay] = useState("");
  const [wordIdx, setWordIdx] = useState(0);
  const [charIdx, setCharIdx] = useState(0);
  const [deleting, setDeleting] = useState(false);
  useEffect(() => {
    const word = words[wordIdx % words.length];
    let t: ReturnType<typeof setTimeout>;
    if (!deleting && charIdx < word.length) t = setTimeout(() => setCharIdx((c) => c + 1), speed);
    else if (!deleting && charIdx === word.length) t = setTimeout(() => setDeleting(true), pause);
    else if (deleting && charIdx > 0) t = setTimeout(() => setCharIdx((c) => c - 1), speed / 2);
    else { setDeleting(false); setWordIdx((i) => i + 1); }
    return () => clearTimeout(t);
  }, [charIdx, deleting, wordIdx, words, speed, pause]);
  return words[wordIdx % words.length].slice(0, charIdx);
}

// ── Welcome overlay ───────────────────────────────────────────────────────────
function WelcomeBackCard({ name }: { name?: string }) {
  const firstName = name?.trim().split(/\s+/)[0] || "";
  return (
    <motion.div
      className="fixed inset-0 z-[200] flex flex-col items-center justify-center"
      style={{ background: "rgba(2,8,4,0.88)", backdropFilter: "blur(20px)" }}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.4 } }}
    >
      <motion.div
        className="absolute rounded-full pointer-events-none"
        style={{ width: 500, height: 500, background: "radial-gradient(circle, rgba(16,185,129,0.22) 0%, transparent 70%)", filter: "blur(40px)" }}
        initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.8 }}
      />
      <motion.div
        className="relative z-10 flex flex-col items-center gap-5 px-12 py-10 rounded-3xl text-center"
        style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(16,185,129,0.25)", boxShadow: "0 32px 80px -16px rgba(16,185,129,0.35), inset 0 1px 0 rgba(255,255,255,0.06)", backdropFilter: "blur(24px)" }}
        initial={{ y: 40, opacity: 0, scale: 0.92 }} animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: -20, opacity: 0, scale: 0.96, transition: { duration: 0.3 } }}
        transition={{ type: "spring", stiffness: 300, damping: 24, delay: 0.05 }}
      >
        <motion.img src="/CivilierERP.png" alt="CivilierERP" width={56} height={56} className="object-contain"
          initial={{ scale: 0, rotate: -180 }} animate={{ scale: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 360, damping: 20, delay: 0.1 }}
        />
        <motion.div className="relative w-14 h-14 flex items-center justify-center"
          initial={{ scale: 0 }} animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 400, damping: 18, delay: 0.22 }}
        >
          <div className="w-14 h-14 rounded-full flex items-center justify-center"
            style={{ background: "linear-gradient(135deg, #10b981, #0d9488)" }}>
            <motion.svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
              <motion.path d="M5 13l4 4L19 7" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.4, delay: 0.38 }} />
            </motion.svg>
          </div>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.45 }}>
          <p className="text-2xl font-bold tracking-tight"
            style={{ background: "linear-gradient(135deg,#6ee7b7,#34d399,#10b981)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
            Welcome back{firstName ? `, ${firstName}` : ""}!
          </p>
          <p className="text-sm text-white/40 mt-1 font-mono">Taking you to your dashboard…</p>
        </motion.div>
        <div className="w-48 h-0.5 rounded-full bg-white/10 overflow-hidden">
          <motion.div className="h-full rounded-full"
            style={{ background: "linear-gradient(90deg, #10b981, #34d399)" }}
            initial={{ width: "0%" }} animate={{ width: "100%" }}
            transition={{ duration: 1.1, delay: 0.5, ease: "easeInOut" }}
          />
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── Floating dashboard preview cards ─────────────────────────────────────────
function FloatingCard({ children, className, delay = 0, style }: { children: React.ReactNode; className?: string; delay?: number; style?: React.CSSProperties }) {
  return (
    <motion.div
      className={`absolute rounded-2xl backdrop-blur-md ${className}`}
      style={{
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.08)",
        boxShadow: "0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.06)",
        ...style,
      }}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: [0, -6, 0] }}
      transition={{ opacity: { delay, duration: 0.5 }, y: { delay: delay + 0.5, duration: 4 + delay, repeat: Infinity, ease: "easeInOut" } }}
    >
      {children}
    </motion.div>
  );
}

function HeroCards() {
  return (
    <div className="relative w-full h-full">
      {/* Project progress card */}
      <FloatingCard delay={0.3} className="top-[8%] left-[5%] w-56 p-4" style={{ zIndex: 2 }}>
        <div className="flex items-center gap-2 mb-3">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "rgba(16,185,129,0.15)" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2"><path d="M3 3h18v18H3z"/><path d="M3 9h18M9 21V9"/></svg>
          </div>
          <span className="text-xs font-semibold text-white/80">Project Overview</span>
        </div>
        {[{ label: "Site A", pct: 78, col: "#10b981" }, { label: "Site B", pct: 45, col: "#34d399" }, { label: "Site C", pct: 91, col: "#6ee7b7" }].map((p) => (
          <div key={p.label} className="mb-2 last:mb-0">
            <div className="flex justify-between text-[10px] text-white/50 mb-1"><span>{p.label}</span><span style={{ color: p.col }}>{p.pct}%</span></div>
            <div className="h-1 rounded-full bg-white/10"><div className="h-full rounded-full" style={{ width: `${p.pct}%`, background: p.col }} /></div>
          </div>
        ))}
      </FloatingCard>

      {/* Invoice stat */}
      <FloatingCard delay={0.6} className="top-[32%] right-[2%] w-44 p-4" style={{ zIndex: 2 }}>
        <p className="text-[10px] text-white/40 mb-1 uppercase tracking-widest">Monthly Revenue</p>
        <p className="text-xl font-bold text-white">₹12.4L</p>
        <p className="text-[10px] text-emerald-400 mt-1 flex items-center gap-1">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="18 15 12 9 6 15"/></svg>
          +18.2% vs last month
        </p>
        <div className="flex gap-1 mt-3">
          {[40, 60, 45, 75, 55, 80, 65].map((h, i) => (
            <div key={i} className="flex-1 rounded-sm" style={{ height: h * 0.4, background: i === 5 ? "#10b981" : "rgba(16,185,129,0.25)", alignSelf: "flex-end" }} />
          ))}
        </div>
      </FloatingCard>

      {/* Material request badge */}
      <FloatingCard delay={0.9} className="bottom-[22%] left-[8%] w-52 p-3.5" style={{ zIndex: 2 }}>
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0" style={{ background: "linear-gradient(135deg, #10b981, #0d9488)" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg>
          </div>
          <div>
            <p className="text-xs font-semibold text-white">MR Approved</p>
            <p className="text-[10px] text-white/40">Steel – 2.5 MT · Site A</p>
          </div>
        </div>
      </FloatingCard>

      {/* GRN notification */}
      <FloatingCard delay={1.2} className="bottom-[8%] right-[4%] w-48 p-3.5" style={{ zIndex: 2 }}>
        <div className="flex items-center gap-2 mb-2">
          <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-[10px] text-emerald-400 font-semibold uppercase tracking-widest">Live GRN</span>
        </div>
        <p className="text-xs text-white/70">Cement · 150 bags received</p>
        <p className="text-[10px] text-white/30 mt-1">Royal Garden · Just now</p>
      </FloatingCard>
    </div>
  );
}

// ── Tilt card ─────────────────────────────────────────────────────────────────
function TiltCard({ children }: { children: React.ReactNode }) {
  const cardRef = useRef<HTMLDivElement>(null);
  const rawX = useMotionValue(0);
  const rawY = useMotionValue(0);
  const cfg = { stiffness: 200, damping: 30 };
  const rotateX = useSpring(useTransform(rawY, [-0.5, 0.5], [3, -3]), cfg);
  const rotateY = useSpring(useTransform(rawX, [-0.5, 0.5], [-3, 3]), cfg);

  const onMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const r = cardRef.current?.getBoundingClientRect();
    if (!r) return;
    rawX.set((e.clientX - r.left) / r.width - 0.5);
    rawY.set((e.clientY - r.top) / r.height - 0.5);
  }, [rawX, rawY]);

  return (
    <motion.div ref={cardRef} onMouseMove={onMove} onMouseLeave={() => { rawX.set(0); rawY.set(0); }}
      style={{ rotateX, rotateY, transformStyle: "preserve-3d", perspective: 1200 }}
      className="w-full">
      {children}
    </motion.div>
  );
}

// ── Input ──────────────────────────────────────────────────────────────────────
function DarkInput({ label, type, value, onChange, placeholder, children }: {
  label: string; type: string; value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder: string; children?: React.ReactNode;
}) {
  const [focused, setFocused] = useState(false);
  const has = value.length > 0;
  return (
    <div className="relative group">
      <motion.label className="absolute left-4 pointer-events-none font-medium z-10 origin-left"
        style={{ color: focused ? "#10b981" : "rgba(255,255,255,0.35)" }}
        animate={{
          top: focused || has ? "6px" : "50%",
          y: focused || has ? "0%" : "-50%",
          fontSize: focused || has ? "9px" : "13px",
          letterSpacing: focused || has ? "0.08em" : "0",
          textTransform: focused || has ? "uppercase" as const : "none" as const,
        }}
        transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
      >
        {label}
      </motion.label>
      <motion.div className="absolute inset-0 rounded-xl pointer-events-none"
        animate={{ boxShadow: focused ? "0 0 0 1.5px rgba(16,185,129,0.5), 0 0 20px rgba(16,185,129,0.10)" : "0 0 0 1px rgba(255,255,255,0.10)" }}
        transition={{ duration: 0.2 }} />
      <input
        type={type} value={value} onChange={onChange}
        placeholder={focused ? placeholder : ""}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        className="w-full rounded-xl px-4 pt-6 pb-2.5 text-sm outline-none transition-colors"
        style={{ background: focused ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.04)", border: "none", color: "rgba(255,255,255,0.9)" }}
      />
      {children}
    </div>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────────
export default function Login() {
  const [showPass, setShowPass] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [loginSuccess, setLoginSuccess] = useState(false);
  const [loginName, setLoginName] = useState("");

  const { login } = useAuth();
  const navigate = useNavigate();
  const tagline = useTypewriter(["Built for Civil Contractors", "Project Insights at a Glance", "One Platform. Total Control."], 60, 2400);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;
    setError("");
    setIsLoading(true);
    try {
      const result = await login(email, password);
      if (result.success) {
        setLoginName(result.name || "");
        setLoginSuccess(true);
        setTimeout(() => {
          const role = result.role;
          const uid = result.userId ?? "";
          if (role === "customer") navigate(`/customer-portal/${uid}`, { replace: true });
          else if (role === "supplier") navigate(`/supplier-portal/${uid}`, { replace: true });
          else if (role === "dba") navigate(`/dba/${uid}`, { replace: true });
          else navigate(`/home/${uid}`, { replace: true });
        }, 1800);
      } else {
        setError(result.error || "Invalid email or password.");
        setIsLoading(false);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
      setError("Unable to connect. Please check your connection and try again.");
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full overflow-hidden relative flex flex-col"
      style={{ background: "#040a06" }}>

      {/* ── Aurora background ──────────────────────────────────────────── */}
      <div className="fixed inset-0 pointer-events-none z-0">
        {/* Main emerald glow */}
        <div style={{
          position: "absolute", top: "10%", left: "30%",
          width: "60vw", height: "70vh",
          background: "radial-gradient(ellipse at 40% 40%, rgba(16,185,129,0.22) 0%, rgba(5,150,105,0.10) 40%, transparent 70%)",
          filter: "blur(40px)",
        }} />
        {/* Top accent */}
        <div style={{
          position: "absolute", top: "-5%", right: "10%",
          width: "30vw", height: "40vh",
          background: "radial-gradient(ellipse at 50% 0%, rgba(16,185,129,0.10) 0%, transparent 70%)",
          filter: "blur(60px)",
        }} />
        {/* Dot grid */}
        <div style={{
          position: "absolute", inset: 0,
          backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.055) 1px, transparent 1px)",
          backgroundSize: "28px 28px",
        }} />
        {/* Vignette */}
        <div style={{
          position: "absolute", inset: 0,
          background: "radial-gradient(ellipse at 50% 50%, transparent 20%, rgba(4,10,6,0.65) 100%)",
        }} />
      </div>

      {/* ── Top nav ────────────────────────────────────────────────────── */}
      <motion.nav
        className="relative z-20 flex items-center justify-between px-6 sm:px-10 pt-6 pb-2"
        initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
      >
        {/* Logo */}
        <div className="flex items-center gap-2.5">
          <img src="/CivilierERP.png" alt="" className="w-8 h-8 rounded-lg object-contain" />
          <span className="text-base font-bold text-white tracking-tight">CivilierERP</span>
        </div>

        {/* Nav pills */}
        <div className="hidden md:flex items-center gap-1 px-3 py-1.5 rounded-full"
          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
          {["Home", "Features", "Modules", "Contact"].map((item) => (
            <span key={item} className="px-4 py-1.5 rounded-full text-sm cursor-pointer transition-colors text-white/50 hover:text-white/80">
              {item}
            </span>
          ))}
        </div>

        {/* Right: supplier portal link */}
        <div className="flex items-center gap-3">
          <span className="hidden sm:block text-xs text-white/40">Supplier Portal</span>
          <div className="w-px h-4 bg-white/10 hidden sm:block" />
          <span className="text-xs text-emerald-400 font-medium cursor-pointer hover:text-emerald-300 transition-colors">
            v1.0.0
          </span>
        </div>
      </motion.nav>

      {/* ── Main content ───────────────────────────────────────────────── */}
      <div className="relative z-10 flex-1 flex items-center px-6 sm:px-10 lg:px-16 py-8">
        <div className="w-full max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">

          {/* LEFT: Hero copy + floating cards ────────────────────────── */}
          <motion.div className="flex flex-col gap-6"
            initial={{ opacity: 0, x: -40 }} animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          >
            {/* Badge */}
            <motion.div className="inline-flex items-center gap-2 self-start px-3 py-1.5 rounded-full text-xs font-medium"
              style={{ background: "rgba(16,185,129,0.10)", border: "1px solid rgba(16,185,129,0.22)", color: "#34d399" }}
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              New: L1 Chart &amp; Supplier Portal just launched
            </motion.div>

            {/* Headline */}
            <div>
              <motion.h1
                className="text-4xl sm:text-5xl lg:text-[3.25rem] font-bold leading-[1.12] tracking-tight text-white"
                initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.25, duration: 0.7 }}
              >
                CivilierERP —{" "}
                <span style={{ background: "linear-gradient(135deg, #34d399, #10b981, #059669)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                  Manage Smarter,
                </span>
                <br />Build Better.
              </motion.h1>
              {/* Typewriter subtitle */}
              <motion.div className="mt-3 flex items-center gap-2 text-sm text-white/45"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}>
                <span className="w-1 h-1 rounded-full bg-emerald-500 inline-block" />
                <span>{tagline}</span>
                <motion.span className="inline-block w-0.5 h-3.5 bg-emerald-500 ml-0.5"
                  animate={{ opacity: [1, 0] }} transition={{ duration: 0.5, repeat: Infinity }} />
              </motion.div>
            </div>

            {/* Desc */}
            <motion.p className="text-sm text-white/40 max-w-md leading-relaxed"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }}>
              From procurement and material tracking to contractor management and live project dashboards — CivilierERP gives your team total visibility and control.
            </motion.p>

            {/* Stat row */}
            <motion.div className="flex items-center gap-6"
              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.55 }}>
              {[["12+", "Modules"], ["99.9%", "Uptime"], ["500+", "Projects"]].map(([val, label]) => (
                <div key={label} className="flex flex-col">
                  <span className="text-2xl font-bold text-white">{val}</span>
                  <span className="text-[11px] text-white/35">{label}</span>
                </div>
              ))}
            </motion.div>

            {/* Floating cards (desktop only) */}
            <div className="hidden lg:block relative h-64 mt-2">
              <HeroCards />
            </div>
          </motion.div>

          {/* RIGHT: Login card ────────────────────────────────────────── */}
          <motion.div
            className="flex justify-center lg:justify-end"
            initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
          >
            <div className="w-full max-w-sm">
              <TiltCard>
                <div className="rounded-2xl p-7"
                  style={{
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.10)",
                    boxShadow: "0 24px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(16,185,129,0.08) inset, inset 0 1px 0 rgba(255,255,255,0.07)",
                    backdropFilter: "blur(28px) saturate(150%)",
                  }}>

                  {/* Card header */}
                  <div className="mb-6">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-10 h-10 rounded-xl overflow-hidden flex items-center justify-center"
                        style={{ background: "linear-gradient(135deg, rgba(16,185,129,0.25), rgba(5,150,105,0.15))", border: "1px solid rgba(16,185,129,0.25)" }}>
                        <img src="/CivilierERP.png" alt="" className="w-7 h-7 object-contain" />
                      </div>
                      <div>
                        <h2 className="text-sm font-bold text-white leading-tight">Sign In</h2>
                        <p className="text-[10px] text-white/35">CivilierERP Platform</p>
                      </div>
                    </div>
                    <p className="text-[11px] text-white/30 leading-relaxed">
                      Enter your credentials to access your dashboard and projects.
                    </p>
                  </div>

                  {/* Form */}
                  <form className="space-y-3" onSubmit={handleSubmit}>
                    <DarkInput label="Email Address" type="email" value={email}
                      onChange={(e) => { setEmail(e.target.value); setError(""); }}
                      placeholder="name@company.com" />

                    <DarkInput label="Password" type={showPass ? "text" : "password"} value={password}
                      onChange={(e) => { setPassword(e.target.value); setError(""); }}
                      placeholder="••••••••">
                      <motion.button type="button" onClick={() => setShowPass(!showPass)}
                        className="absolute right-3 bottom-2.5 p-1 transition-colors"
                        style={{ color: "rgba(255,255,255,0.3)" }}
                        whileTap={{ scale: 0.85 }}>
                        <AnimatePresence mode="wait">
                          <motion.span key={showPass ? "off" : "on"}
                            initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.8 }} transition={{ duration: 0.12 }}>
                            {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
                          </motion.span>
                        </AnimatePresence>
                      </motion.button>
                    </DarkInput>

                    {/* Error */}
                    <AnimatePresence>
                      {error && (
                        <motion.div
                          initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -6 }}
                          className="px-3 py-2.5 rounded-xl text-xs flex items-center gap-2"
                          style={{ background: "rgba(239,68,68,0.10)", border: "1px solid rgba(239,68,68,0.20)", color: "#fca5a5" }}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                          </svg>
                          {error}
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {/* Submit */}
                    <motion.button
                      type="submit"
                      disabled={isLoading || loginSuccess}
                      whileHover={!isLoading ? { scale: 1.015, y: -1 } : {}}
                      whileTap={!isLoading ? { scale: 0.97 } : {}}
                      className="relative w-full overflow-hidden rounded-xl py-3 font-semibold text-sm text-white disabled:opacity-60 disabled:cursor-not-allowed mt-1"
                      style={{
                        background: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
                        boxShadow: "0 4px 20px rgba(16,185,129,0.35)",
                      }}
                    >
                      <span className="relative z-10 flex items-center justify-center gap-2">
                        {isLoading ? (
                          <>
                            <motion.div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white"
                              animate={{ rotate: 360 }} transition={{ duration: 0.7, repeat: Infinity, ease: "linear" }} />
                            Signing in…
                          </>
                        ) : "Sign In →"}
                      </span>
                    </motion.button>
                  </form>

                  {/* Footer note */}
                  <p className="text-center text-[10px] text-white/20 mt-5 leading-relaxed">
                    Secure access · Role-based permissions · v1.0.0
                  </p>
                </div>
              </TiltCard>
            </div>
          </motion.div>

        </div>
      </div>

      {/* Welcome overlay */}
      <AnimatePresence>
        {loginSuccess && <WelcomeBackCard name={loginName} />}
      </AnimatePresence>
    </div>
  );
}
