import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Eye, EyeOff, ArrowLeft } from "lucide-react";
import { motion, AnimatePresence, useMotionValue, useTransform, useSpring } from "framer-motion";
import { toast } from "sonner";

// ── Tilt card ─────────────────────────────────────────────────────────────────
function TiltCard({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const rawX = useMotionValue(0);
  const rawY = useMotionValue(0);
  const cfg = { stiffness: 200, damping: 30 };
  const rotateX = useSpring(useTransform(rawY, [-0.5, 0.5], [4, -4]), cfg);
  const rotateY = useSpring(useTransform(rawX, [-0.5, 0.5], [-4, 4]), cfg);

  const onMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    rawX.set((e.clientX - r.left) / r.width - 0.5);
    rawY.set((e.clientY - r.top) / r.height - 0.5);
  }, [rawX, rawY]);

  return (
    <motion.div ref={ref} onMouseMove={onMove} onMouseLeave={() => { rawX.set(0); rawY.set(0); }}
      style={{ rotateX, rotateY, transformStyle: "preserve-3d", perspective: 1000 }}
      className="w-full">
      {children}
    </motion.div>
  );
}

// ── Animated input ────────────────────────────────────────────────────────────
function AnimatedInput({ label, type, value, onChange, placeholder, children }: {
  label: string; type: string; value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder: string; children?: React.ReactNode;
}) {
  const [focused, setFocused] = useState(false);
  const has = value.length > 0;
  return (
    <div className="relative">
      <motion.label className="absolute left-4 pointer-events-none font-medium z-10 origin-left text-slate-500"
        animate={{
          top: focused || has ? "6px" : "50%",
          y: focused || has ? "0%" : "-50%",
          fontSize: focused || has ? "9px" : "13px",
          letterSpacing: focused || has ? "0.08em" : "0",
          color: focused ? "#059669" : "rgba(100,116,139,0.8)",
          textTransform: focused || has ? "uppercase" as const : "none" as const,
        }}
        transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}>
        {label}
      </motion.label>
      <motion.div className="absolute inset-0 rounded-xl pointer-events-none"
        animate={{ boxShadow: focused ? "0 0 0 2px rgba(5,150,105,0.35), 0 0 16px rgba(5,150,105,0.10)" : "0 0 0 1.5px rgba(203,213,225,0.8)" }}
        transition={{ duration: 0.2 }} />
      <AnimatePresence>
        {focused && (
          <motion.div className="absolute bottom-0 left-4 right-4 h-px rounded-full pointer-events-none"
            style={{ background: "linear-gradient(90deg, transparent, rgba(5,150,105,0.8), transparent)" }}
            initial={{ scaleX: 0, opacity: 0 }} animate={{ scaleX: 1, opacity: 1 }}
            exit={{ scaleX: 0, opacity: 0 }} transition={{ duration: 0.3 }} />
        )}
      </AnimatePresence>
      <input type={type} value={value} onChange={onChange}
        placeholder={focused ? placeholder : ""}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        className="w-full rounded-xl px-4 pt-6 pb-2.5 text-sm text-slate-800 outline-none transition-colors"
        style={{ background: focused ? "rgba(255,255,255,0.98)" : "rgba(248,250,252,0.9)", border: "none" }} />
      {children}
    </div>
  );
}

// ── Shimmer button ────────────────────────────────────────────────────────────
function ShimmerButton({ children, disabled, type = "button" }: {
  children: React.ReactNode; disabled?: boolean; type?: "button" | "submit";
}) {
  const [shimmerX, setShimmerX] = useState(-100);
  const [hovered, setHovered] = useState(false);
  useEffect(() => {
    if (!hovered) return;
    let x = -100;
    const iv = setInterval(() => { x += 8; if (x > 200) x = -100; setShimmerX(x); }, 16);
    return () => clearInterval(iv);
  }, [hovered]);
  return (
    <motion.button type={type} disabled={disabled}
      onHoverStart={() => setHovered(true)}
      onHoverEnd={() => { setHovered(false); setShimmerX(-100); }}
      whileHover={disabled ? {} : { scale: 1.015, y: -1 }}
      whileTap={disabled ? {} : { scale: 0.97 }}
      className="relative w-full overflow-hidden rounded-xl py-3.5 font-semibold text-sm text-white disabled:opacity-60 disabled:cursor-not-allowed"
      style={{
        background: "linear-gradient(135deg, #059669 0%, #047857 100%)",
        boxShadow: hovered && !disabled ? "0 8px 30px rgba(5,150,105,0.45)" : "0 4px 16px rgba(5,150,105,0.30)",
        transition: "box-shadow 0.3s ease",
      }}>
      {hovered && !disabled && (
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: `linear-gradient(105deg, transparent ${shimmerX - 20}%, rgba(255,255,255,0.18) ${shimmerX}%, rgba(255,255,255,0.08) ${shimmerX + 10}%, transparent ${shimmerX + 30}%)` }} />
      )}
      <span className="relative z-10 flex items-center justify-center gap-2">{children}</span>
    </motion.button>
  );
}

// ── Welcome overlay ───────────────────────────────────────────────────────────
function WelcomeCard({ name }: { name?: string }) {
  const firstName = name?.trim().split(/\s+/)[0] || "";
  return (
    <motion.div className="fixed inset-0 z-[200] flex items-center justify-center"
      style={{ background: "rgba(255,255,255,0.85)", backdropFilter: "blur(16px)" }}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.3 } }}>
      <motion.div className="flex flex-col items-center gap-4 px-10 py-8 rounded-3xl text-center"
        style={{ background: "white", border: "1px solid rgba(5,150,105,0.15)", boxShadow: "0 24px 64px rgba(5,150,105,0.15), 0 4px 20px rgba(0,0,0,0.06)" }}
        initial={{ y: 40, scale: 0.92, opacity: 0 }} animate={{ y: 0, scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 300, damping: 24 }}>
        <motion.div className="w-14 h-14 rounded-full flex items-center justify-center"
          style={{ background: "linear-gradient(135deg, #059669, #047857)" }}
          initial={{ scale: 0 }} animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 420, damping: 18, delay: 0.1 }}>
          <motion.svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <motion.path d="M5 13l4 4L19 7" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.4, delay: 0.2 }} />
          </motion.svg>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
          <p className="text-xl font-bold text-slate-800">Welcome back{firstName ? `, ${firstName}` : ""}!</p>
          <p className="text-sm text-slate-400 mt-1">Taking you to your supplier portal…</p>
        </motion.div>
        <div className="w-48 h-1 rounded-full bg-slate-100 overflow-hidden">
          <motion.div className="h-full rounded-full bg-emerald-500"
            initial={{ width: "0%" }} animate={{ width: "100%" }}
            transition={{ duration: 1.2, delay: 0.3, ease: "easeInOut" }} />
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function SupplierLogin() {
  const [showPass, setShowPass] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [loginSuccess, setLoginSuccess] = useState(false);
  const [loginName, setLoginName] = useState("");

  const { login } = useAuth();
  const navigate = useNavigate();

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
          navigate("/supplier", { replace: true });
        }, 1800);
      } else {
        setError(result.error || "Invalid email or password.");
        setIsLoading(false);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
      setError("Unable to connect. Please check your connection.");
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex relative overflow-hidden"
      style={{ background: "linear-gradient(160deg, #f0fdf4 0%, #ecfdf5 30%, #ffffff 65%, #f8fff9 100%)" }}>

      {/* Left panel — brand */}
      <div className="hidden lg:flex flex-col justify-between w-[45%] p-12 relative overflow-hidden"
        style={{ background: "linear-gradient(160deg, #064e3b 0%, #065f46 50%, #047857 100%)" }}>
        {/* Dot grid */}
        <div className="absolute inset-0 pointer-events-none"
          style={{ backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.08) 1px, transparent 1px)", backgroundSize: "22px 22px" }} />
        {/* Glow */}
        <div className="absolute bottom-0 right-0 w-96 h-96 rounded-full pointer-events-none"
          style={{ background: "radial-gradient(circle, rgba(52,211,153,0.18) 0%, transparent 70%)", filter: "blur(40px)" }} />

        <motion.div initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
          <button onClick={() => navigate("/supplier")} className="flex items-center gap-2 text-white/60 hover:text-white text-sm transition-colors">
            <ArrowLeft size={14} />
            Back to home
          </button>
        </motion.div>

        <motion.div className="relative z-10" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.15 }}>
          <div className="w-14 h-14 rounded-2xl bg-white/10 border border-white/20 flex items-center justify-center mb-6 overflow-hidden">
            <img src="/Civilier.png" alt="" className="w-10 h-10 object-contain" />
          </div>
          <h1 className="text-3xl font-bold text-white leading-tight mb-3">
            Supplier Portal
          </h1>
          <p className="text-emerald-200/70 text-sm leading-relaxed max-w-xs">
            Respond to RFQs, manage your price catalog, and track submissions — all in one place.
          </p>

          <div className="mt-8 space-y-3">
            {[
              { icon: "📋", text: "Respond to RFQs instantly" },
              { icon: "💰", text: "Maintain your price catalog" },
              { icon: "📊", text: "Track submission status" },
              { icon: "🔔", text: "Get real-time notifications" },
            ].map((f, i) => (
              <motion.div key={f.text} className="flex items-center gap-3 text-sm text-white/70"
                initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.4 + i * 0.1 }}>
                <span className="text-base">{f.icon}</span>
                {f.text}
              </motion.div>
            ))}
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.8 }}>
          <div className="flex items-center gap-3 px-4 py-3 rounded-xl"
            style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)" }}>
            <div className="w-9 h-9 rounded-full bg-emerald-400/20 flex items-center justify-center text-sm font-bold text-emerald-300">RG</div>
            <div>
              <p className="text-xs font-semibold text-white">"Reduced our quotation time by 60%"</p>
              <p className="text-[10px] text-white/40 mt-0.5">Rajwada Group · Procurement Head</p>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Right panel — login form */}
      <div className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-md">
          {/* Mobile back link */}
          <motion.button onClick={() => navigate("/supplier")} className="flex lg:hidden items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-8 transition-colors"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <ArrowLeft size={14} /> Back to home
          </motion.button>

          <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}>
            <TiltCard>
              {/* Corner accents */}
              {["top-0 left-0 border-t-2 border-l-2 rounded-tl-2xl", "top-0 right-0 border-t-2 border-r-2 rounded-tr-2xl", "bottom-0 left-0 border-b-2 border-l-2 rounded-bl-2xl", "bottom-0 right-0 border-b-2 border-r-2 rounded-br-2xl"].map((cls, i) => (
                <motion.div key={i} className={`absolute w-5 h-5 border-emerald-400/40 z-20 ${cls}`}
                  initial={{ opacity: 0, scale: 0.5 }} animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.4 + i * 0.08, ease: "backOut" }} />
              ))}

              <div className="p-7 sm:p-9 rounded-2xl"
                style={{
                  background: "rgba(255,255,255,0.92)",
                  border: "1px solid rgba(5,150,105,0.12)",
                  boxShadow: "0 20px 60px rgba(5,150,105,0.08), 0 4px 20px rgba(0,0,0,0.06), inset 0 1px 0 rgba(255,255,255,0.9)",
                  backdropFilter: "blur(24px)",
                }}>

                {/* Header */}
                <div className="text-center mb-7">
                  <motion.div className="flex flex-col items-center gap-3 mb-4"
                    initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                    transition={{ delay: 0.2, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}>
                    <div className="relative">
                      {/* Pulse rings */}
                      {[1, 2].map((i) => (
                        <motion.div key={i} className="absolute inset-0 rounded-full"
                          style={{ border: "1px solid rgba(5,150,105,0.25)" }}
                          animate={{ scale: [1, 1.4 + i * 0.2], opacity: [0.5, 0] }}
                          transition={{ duration: 2.5, delay: i * 0.7, repeat: Infinity, ease: "easeOut" }} />
                      ))}
                      <motion.div className="absolute inset-0 rounded-full"
                        style={{ border: "1.5px dashed rgba(5,150,105,0.25)" }}
                        animate={{ rotate: 360 }} transition={{ duration: 20, repeat: Infinity, ease: "linear" }} />
                      <div className="w-16 h-16 rounded-full bg-white border border-slate-100 shadow-md flex items-center justify-center overflow-hidden">
                        <img src="/Civilier.png" alt="CivilierERP" className="w-12 h-12 object-contain" />
                      </div>
                    </div>
                    <motion.h1 className="text-2xl font-bold tracking-tight"
                      style={{ background: "linear-gradient(135deg,#064e3b,#059669,#34d399)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}
                      initial={{ letterSpacing: "0.15em", opacity: 0 }} animate={{ letterSpacing: "-0.01em", opacity: 1 }}
                      transition={{ delay: 0.35, duration: 0.7 }}>
                      Supplier Portal
                    </motion.h1>
                  </motion.div>
                  <p className="text-xs text-slate-400">Sign in to your supplier account</p>
                </div>

                {/* Form */}
                <motion.form className="space-y-4" onSubmit={handleSubmit}
                  initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.4, duration: 0.5 }}>
                  <AnimatedInput label="Email Address" type="email" value={email}
                    onChange={(e) => { setEmail(e.target.value); setError(""); }}
                    placeholder="name@company.com" />

                  <AnimatedInput label="Password" type={showPass ? "text" : "password"} value={password}
                    onChange={(e) => { setPassword(e.target.value); setError(""); }}
                    placeholder="••••••••">
                    <motion.button type="button" onClick={() => setShowPass(!showPass)}
                      className="absolute right-3 bottom-2.5 text-slate-400 hover:text-emerald-600 transition-colors p-1"
                      whileTap={{ scale: 0.85 }}>
                      <AnimatePresence mode="wait">
                        <motion.span key={showPass ? "off" : "on"}
                          initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.8 }} transition={{ duration: 0.12 }}>
                          {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                        </motion.span>
                      </AnimatePresence>
                    </motion.button>
                  </AnimatedInput>

                  <AnimatePresence>
                    {error && (
                      <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -6 }}
                        className="px-4 py-2.5 rounded-xl text-sm text-red-600 flex items-center gap-2"
                        style={{ background: "rgba(254,226,226,0.8)", border: "1px solid rgba(252,165,165,0.5)" }}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                        </svg>
                        {error}
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <ShimmerButton type="submit" disabled={isLoading || loginSuccess}>
                    {isLoading ? (
                      <>
                        <motion.div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white"
                          animate={{ rotate: 360 }} transition={{ duration: 0.7, repeat: Infinity, ease: "linear" }} />
                        Signing in…
                      </>
                    ) : "Sign In →"}
                  </ShimmerButton>
                </motion.form>

                <div className="mt-5 text-center">
                  <p className="text-[11px] text-slate-400">
                    Not a supplier?{" "}
                    <button onClick={() => navigate("/login")} className="text-emerald-600 font-medium hover:text-emerald-700 transition-colors">
                      Go to main login
                    </button>
                  </p>
                </div>
              </div>
            </TiltCard>
          </motion.div>
        </div>
      </div>

      <AnimatePresence>
        {loginSuccess && <WelcomeCard name={loginName} />}
      </AnimatePresence>
    </div>
  );
}
