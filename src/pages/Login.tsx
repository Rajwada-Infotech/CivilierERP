import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Eye, EyeOff, Truck, Building2, ArrowUpRight, Smartphone } from "lucide-react";
import {
  motion,
  AnimatePresence,
  useMotionValue,
  useTransform,
  useSpring,
} from "framer-motion";
import { toast } from "sonner";
import { useAppVersion } from "@/hooks/useAppVersion";

// ── Typewriter ────────────────────────────────────────────────────────────────
function useTypewriter(words: string[], speed = 80, pause = 2400) {
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

// ── Blueprint SVG scene (crane) ───────────────────────────────────────────────
function CivilScene() {
  return (
    <svg viewBox="0 0 800 420" xmlns="http://www.w3.org/2000/svg" className="w-full h-full" style={{ overflow: "visible" }}>
      <defs>
        <pattern id="grid" width="30" height="30" patternUnits="userSpaceOnUse">
          <path d="M 30 0 L 0 0 0 30" fill="none" stroke="rgba(167,139,250,0.18)" strokeWidth="0.8" />
        </pattern>
        <pattern id="gridBig" width="90" height="90" patternUnits="userSpaceOnUse">
          <path d="M 90 0 L 0 0 0 90" fill="none" stroke="rgba(167,139,250,0.28)" strokeWidth="1.2" />
        </pattern>
        <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <filter id="softShadow">
          <feDropShadow dx="0" dy="4" stdDeviation="8" floodColor="rgba(124,58,237,0.2)" />
        </filter>
      </defs>
      <rect width="800" height="420" fill="url(#grid)" opacity="0.6" />
      <rect width="800" height="420" fill="url(#gridBig)" opacity="0.8" />
      <line x1="0" y1="370" x2="800" y2="370" stroke="rgba(167,139,250,0.3)" strokeWidth="1.5" strokeDasharray="8 4" />
      {/* Small building left */}
      <g opacity="0.55">
        <rect x="20" y="290" width="60" height="80" fill="none" stroke="rgba(167,139,250,0.5)" strokeWidth="1.2" />
        {[300, 320, 340, 360].map((y) => (
          <g key={y}>
            <rect x="28" y={y} width="10" height="12" fill="none" stroke="rgba(167,139,250,0.4)" strokeWidth="0.8" />
            <rect x="44" y={y} width="10" height="12" fill="none" stroke="rgba(167,139,250,0.4)" strokeWidth="0.8" />
            <rect x="60" y={y} width="10" height="12" fill="none" stroke="rgba(167,139,250,0.4)" strokeWidth="0.8" />
          </g>
        ))}
      </g>
      {/* Medium building */}
      <g opacity="0.6">
        <rect x="100" y="210" width="80" height="160" fill="none" stroke="rgba(167,139,250,0.55)" strokeWidth="1.4" />
        {[220, 240, 260, 280, 300, 320, 340, 360].map((y) => (
          <g key={y}>
            <rect x="108" y={y} width="12" height="14" fill="none" stroke="rgba(167,139,250,0.35)" strokeWidth="0.8" />
            <rect x="126" y={y} width="12" height="14" fill="none" stroke="rgba(167,139,250,0.35)" strokeWidth="0.8" />
            <rect x="144" y={y} width="12" height="14" fill="none" stroke="rgba(167,139,250,0.35)" strokeWidth="0.8" />
            <rect x="162" y={y} width="12" height="14" fill="none" stroke="rgba(167,139,250,0.35)" strokeWidth="0.8" />
          </g>
        ))}
        <line x1="100" y1="210" x2="180" y2="210" stroke="rgba(167,139,250,0.5)" strokeWidth="2" />
        <rect x="120" y="198" width="40" height="12" fill="none" stroke="rgba(167,139,250,0.4)" strokeWidth="1" />
      </g>
      {/* Right building */}
      <g opacity="0.5">
        <rect x="610" y="250" width="70" height="120" fill="none" stroke="rgba(167,139,250,0.5)" strokeWidth="1.2" />
        {[260, 278, 296, 314, 332, 350].map((y) => (
          <g key={y}>
            <rect x="618" y={y} width="10" height="13" fill="none" stroke="rgba(167,139,250,0.35)" strokeWidth="0.8" />
            <rect x="634" y={y} width="10" height="13" fill="none" stroke="rgba(167,139,250,0.35)" strokeWidth="0.8" />
            <rect x="650" y={y} width="10" height="13" fill="none" stroke="rgba(167,139,250,0.35)" strokeWidth="0.8" />
            <rect x="666" y={y} width="10" height="13" fill="none" stroke="rgba(167,139,250,0.35)" strokeWidth="0.8" />
          </g>
        ))}
      </g>
      {/* Far right tall building */}
      <g opacity="0.55">
        <rect x="700" y="200" width="85" height="170" fill="none" stroke="rgba(167,139,250,0.55)" strokeWidth="1.4" />
        {[210, 228, 246, 264, 282, 300, 318, 336, 354].map((y) => (
          <g key={y}>
            <rect x="708" y={y} width="11" height="13" fill="none" stroke="rgba(167,139,250,0.3)" strokeWidth="0.8" />
            <rect x="725" y={y} width="11" height="13" fill="none" stroke="rgba(167,139,250,0.3)" strokeWidth="0.8" />
            <rect x="742" y={y} width="11" height="13" fill="none" stroke="rgba(167,139,250,0.3)" strokeWidth="0.8" />
            <rect x="759" y={y} width="11" height="13" fill="none" stroke="rgba(167,139,250,0.3)" strokeWidth="0.8" />
            <rect x="776" y={y} width="11" height="13" fill="none" stroke="rgba(167,139,250,0.3)" strokeWidth="0.8" />
          </g>
        ))}
        <rect x="720" y="186" width="45" height="14" fill="none" stroke="rgba(167,139,250,0.45)" strokeWidth="1" />
      </g>
      {/* Crane */}
      <g filter="url(#softShadow)">
        <rect x="378" y="80" width="10" height="290" fill="none" stroke="rgba(167,139,250,0.8)" strokeWidth="2" />
        {[80, 120, 160, 200, 240, 280, 320].map((y, i) => (
          <line key={y} x1={i % 2 === 0 ? 378 : 388} y1={y} x2={i % 2 === 0 ? 388 : 378} y2={y + 40} stroke="rgba(167,139,250,0.5)" strokeWidth="1" />
        ))}
        <rect x="388" y="82" width="200" height="8" fill="none" stroke="rgba(167,139,250,0.8)" strokeWidth="1.8" />
        {[0, 40, 80, 120, 160].map((x) => (
          <line key={x} x1={388 + x} y1="82" x2={388 + x + 40} y2="90" stroke="rgba(167,139,250,0.45)" strokeWidth="1" />
        ))}
        <rect x="298" y="82" width="80" height="8" fill="none" stroke="rgba(167,139,250,0.7)" strokeWidth="1.8" />
        <rect x="288" y="78" width="20" height="20" fill="none" stroke="rgba(167,139,250,0.6)" strokeWidth="1.5" />
        <rect x="372" y="68" width="22" height="18" fill="none" stroke="rgba(167,139,250,0.9)" strokeWidth="1.8" />
        <rect x="376" y="72" width="6" height="8" fill="rgba(167,139,250,0.15)" stroke="rgba(167,139,250,0.5)" strokeWidth="0.8" />
        <rect x="384" y="72" width="6" height="8" fill="rgba(167,139,250,0.15)" stroke="rgba(167,139,250,0.5)" strokeWidth="0.8" />
        {/* Dangling wire + load */}
        <line x1="560" y1="90" x2="560" y2="200" stroke="rgba(167,139,250,0.7)" strokeWidth="1.5" strokeDasharray="4 3">
          <animate attributeName="y2" values="200;240;200" dur="4s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.6 1;0.4 0 0.6 1" />
        </line>
        <g>
          <animateTransform attributeName="transform" type="translate" values="0,0;0,40;0,0" dur="4s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.6 1;0.4 0 0.6 1" additive="sum" />
          <rect x="554" y="200" width="12" height="10" fill="none" stroke="rgba(167,139,250,0.8)" strokeWidth="1.5" />
          <path d="M 558 210 Q 560 218 562 210" fill="none" stroke="rgba(167,139,250,0.8)" strokeWidth="1.5" />
        </g>
        {/* Moving trolley */}
        <rect x="549" y="88" width="18" height="10" fill="rgba(167,139,250,0.1)" stroke="rgba(167,139,250,0.7)" strokeWidth="1.2">
          <animate attributeName="x" values="549;440;549" dur="8s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.6 1;0.4 0 0.6 1" />
        </rect>
        {/* Support cables */}
        <line x1="383" y1="82" x2="440" y2="140" stroke="rgba(167,139,250,0.35)" strokeWidth="1" />
        <line x1="383" y1="82" x2="500" y2="140" stroke="rgba(167,139,250,0.3)" strokeWidth="1" />
        <line x1="383" y1="82" x2="340" y2="140" stroke="rgba(167,139,250,0.3)" strokeWidth="1" />
        {/* Base */}
        <rect x="358" y="368" width="50" height="8" fill="none" stroke="rgba(167,139,250,0.7)" strokeWidth="2" />
        <rect x="350" y="374" width="66" height="6" fill="none" stroke="rgba(167,139,250,0.6)" strokeWidth="1.5" />
      </g>
      {/* Scaffold */}
      <g opacity="0.4">
        <line x1="695" y1="200" x2="695" y2="370" stroke="rgba(167,139,250,0.6)" strokeWidth="1.5" />
        <line x1="707" y1="200" x2="707" y2="370" stroke="rgba(167,139,250,0.6)" strokeWidth="1.5" />
        {[200, 230, 260, 290, 320, 350].map((y) => (
          <line key={y} x1="695" y1={y} x2="707" y2={y} stroke="rgba(167,139,250,0.5)" strokeWidth="1.2" />
        ))}
      </g>
      {/* Pulsing markers */}
      {[[220, 185], [560, 60], [650, 230], [80, 260]].map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r="3" fill="none" stroke="rgba(167,139,250,0.5)" strokeWidth="1">
          <animate attributeName="opacity" values="0.3;0.9;0.3" dur={`${2.5 + i * 0.7}s`} repeatCount="indefinite" />
        </circle>
      ))}
    </svg>
  );
}

// ── Scan line ─────────────────────────────────────────────────────────────────
function ScanLine() {
  return (
    <motion.div
      className="absolute left-0 right-0 h-px pointer-events-none z-0"
      style={{ background: "linear-gradient(90deg, transparent 0%, rgba(124,58,237,0.25) 30%, rgba(167,139,250,0.5) 50%, rgba(124,58,237,0.25) 70%, transparent 100%)" }}
      initial={{ top: "0%" }}
      animate={{ top: ["0%", "100%", "0%"] }}
      transition={{ duration: 14, repeat: Infinity, ease: "linear" }}
    />
  );
}

// ── Floating particles ────────────────────────────────────────────────────────
function FloatingParticles() {
  const particles = [
    { x: "8%", delay: 0, dur: 6, type: "brick" },
    { x: "18%", delay: 1.5, dur: 7, type: "bolt" },
    { x: "78%", delay: 0.8, dur: 5.5, type: "brick" },
    { x: "88%", delay: 2, dur: 8, type: "triangle" },
    { x: "50%", delay: 3, dur: 6.5, type: "bolt" },
    { x: "35%", delay: 1, dur: 7.5, type: "brick" },
    { x: "65%", delay: 2.5, dur: 5, type: "triangle" },
    { x: "28%", delay: 4, dur: 9, type: "brick" },
    { x: "72%", delay: 3.5, dur: 6, type: "bolt" },
    { x: "92%", delay: 0.5, dur: 7, type: "triangle" },
  ];
  const renderIcon = (type: string) => {
    if (type === "bolt") return (
      <svg width="12" height="12" viewBox="0 0 12 12">
        <polygon points="6,1 10.2,3.5 10.2,8.5 6,11 1.8,8.5 1.8,3.5" fill="none" stroke="rgba(167,139,250,0.55)" strokeWidth="1" />
        <circle cx="6" cy="6" r="2" fill="none" stroke="rgba(167,139,250,0.4)" strokeWidth="0.8" />
      </svg>
    );
    if (type === "triangle") return (
      <svg width="13" height="12" viewBox="0 0 13 12">
        <polygon points="6.5,1 12,11 1,11" fill="none" stroke="rgba(167,139,250,0.5)" strokeWidth="1" />
        <line x1="6.5" y1="6" x2="6.5" y2="11" stroke="rgba(167,139,250,0.35)" strokeWidth="0.7" />
      </svg>
    );
    return (
      <svg width="14" height="10" viewBox="0 0 14 10">
        <rect width="14" height="10" rx="1" fill="none" stroke="rgba(167,139,250,0.6)" strokeWidth="1.2" />
        <line x1="7" y1="0" x2="7" y2="10" stroke="rgba(167,139,250,0.4)" strokeWidth="0.8" />
        <line x1="0" y1="5" x2="14" y2="5" stroke="rgba(167,139,250,0.4)" strokeWidth="0.8" />
      </svg>
    );
  };
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {particles.map((p, i) => (
        <motion.div key={i} className="absolute bottom-0" style={{ left: p.x }}
          initial={{ y: 0, opacity: 0 }}
          animate={{ y: [0, -220, -440], opacity: [0, 0.5, 0] }}
          transition={{ duration: p.dur, delay: p.delay, repeat: Infinity, ease: "easeInOut" }}>
          {renderIcon(p.type)}
        </motion.div>
      ))}
    </div>
  );
}

// ── Pulsing logo ring ─────────────────────────────────────────────────────────
function LogoRing({ size }: { size: number }) {
  return (
    <div className="relative" style={{ width: size, height: size }}>
      {[1, 2, 3].map((i) => (
        <motion.div key={i} className="absolute inset-0 rounded-full"
          style={{ border: "1px solid rgba(124,58,237,0.3)" }}
          animate={{ scale: [1, 1.3 + i * 0.15], opacity: [0.5, 0] }}
          transition={{ duration: 2.5, delay: i * 0.6, repeat: Infinity, ease: "easeOut" }} />
      ))}
      <motion.div className="absolute inset-0 rounded-full"
        style={{ border: "1.5px dashed rgba(124,58,237,0.3)" }}
        animate={{ rotate: 360 }}
        transition={{ duration: 20, repeat: Infinity, ease: "linear" }} />
      <motion.div className="absolute inset-[-6px] rounded-full"
        style={{ border: "1px dotted rgba(167,139,250,0.4)" }}
        animate={{ rotate: -360 }}
        transition={{ duration: 15, repeat: Infinity, ease: "linear" }} />
      <img src="/Civilier.png" alt="CivilierERP" className="w-full h-full rounded-full object-cover"
        style={{ filter: "drop-shadow(0 8px 20px rgba(124,58,237,0.4))" }} />
    </div>
  );
}

// ── Floating preview cards (left hero) ───────────────────────────────────────
function FloatingCard({ children, className, delay = 0, style }: { children: React.ReactNode; className?: string; delay?: number; style?: React.CSSProperties }) {
  return (
    <motion.div className={`absolute rounded-2xl backdrop-blur-md ${className}`}
      style={{
        background: "rgba(255,255,255,0.05)",
        border: "1px solid rgba(167,139,250,0.20)",
        boxShadow: "0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.06)",
        ...style,
      }}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: [0, -6, 0] }}
      transition={{ opacity: { delay, duration: 0.5 }, y: { delay: delay + 0.5, duration: 4 + delay, repeat: Infinity, ease: "easeInOut" } }}>
      {children}
    </motion.div>
  );
}

function HeroCards({ stats }: { stats: PublicStats | null }) {
  const pct = stats?.workOrderCompletionPct ?? 0;
  return (
    <div className="relative w-full h-full">
      <FloatingCard delay={0.3} className="top-[8%] left-[5%] w-56 p-4" style={{ zIndex: 2 }}>
        <div className="flex items-center gap-2 mb-3">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "rgba(124,58,237,0.12)" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" strokeWidth="2"><path d="M3 3h18v18H3z"/><path d="M3 9h18M9 21V9"/></svg>
          </div>
          <span className="text-xs font-semibold text-white/80">Work Order Status</span>
        </div>
        {[
          { label: "Completed", pct: pct, col: "#7c3aed" },
          { label: "In Progress", pct: Math.min(100, Math.max(0, 100 - pct)), col: "#a78bfa" },
        ].map((p) => (
          <div key={p.label} className="mb-2 last:mb-0">
            <div className="flex justify-between text-[10px] text-white/45 mb-1"><span>{p.label}</span><span style={{ color: p.col }}>{p.pct}%</span></div>
            <div className="h-1 rounded-full bg-white/10"><div className="h-full rounded-full" style={{ width: `${p.pct}%`, background: p.col }} /></div>
          </div>
        ))}
        {stats && (
          <p className="text-[9px] text-white/25 mt-2">{(stats.workOrders ?? 0).toLocaleString("en-IN")} total work orders</p>
        )}
      </FloatingCard>

      <FloatingCard delay={0.6} className="top-[32%] right-[2%] w-44 p-4" style={{ zIndex: 2 }}>
        <p className="text-[10px] text-white/35 mb-1 uppercase tracking-widest">Active Projects</p>
        {stats ? (
          <p className="text-xl font-bold text-white">{(stats.projects ?? 0).toLocaleString("en-IN")}</p>
        ) : (
          <div className="h-6 w-10 rounded bg-white/10 animate-pulse mb-1" />
        )}
        <p className="text-[10px] mt-1 flex items-center gap-1 text-white/30">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="rgba(167,139,250,0.6)" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>
          Tracking live progress
        </p>
        <div className="flex gap-1 mt-3 items-end">
          {[30, 55, 40, 70, 50, 80, 60].map((h, i) => (
            <div key={i} className="flex-1 rounded-sm" style={{ height: h * 0.35, background: i >= 5 ? "#7c3aed" : "rgba(124,58,237,0.2)" }} />
          ))}
        </div>
      </FloatingCard>

      <FloatingCard delay={0.9} className="bottom-[22%] left-[8%] w-52 p-3.5" style={{ zIndex: 2 }}>
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0" style={{ background: "linear-gradient(135deg, #7c3aed, #5b21b6)" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><path d="M20 7H4a2 2 0 00-2 2v6a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2z"/><path d="M16 21V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v16"/></svg>
          </div>
          <div>
            <p className="text-xs font-semibold text-white/80">Supplier Network</p>
            {stats ? (
              <p className="text-[10px] text-white/35">{stats.activeSuppliers ?? 0} active · {stats.quotations ?? 0} quotations</p>
            ) : (
              <div className="h-2.5 w-24 rounded bg-white/10 animate-pulse mt-1" />
            )}
          </div>
        </div>
      </FloatingCard>

      <FloatingCard delay={1.2} className="bottom-[8%] right-[4%] w-48 p-3.5" style={{ zIndex: 2 }}>
        <div className="flex items-center gap-2 mb-2">
          <div className="w-2 h-2 rounded-full animate-pulse bg-emerald-400" />
          <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "rgba(167,139,250,0.8)" }}>GRN Module</span>
        </div>
        {stats ? (
          <p className="text-xs text-white/60">{(stats.grns ?? 0).toLocaleString("en-IN")} receipts recorded</p>
        ) : (
          <div className="h-3 w-32 rounded bg-white/10 animate-pulse" />
        )}
        <p className="text-[10px] text-white/35 mt-1">Goods receipt tracking</p>
      </FloatingCard>
    </div>
  );
}

// ── Tilt card with glare ──────────────────────────────────────────────────────
function TiltCard({ children }: { children: React.ReactNode }) {
  const cardRef = useRef<HTMLDivElement>(null);
  const rawX = useMotionValue(0);
  const rawY = useMotionValue(0);
  const cfg = { stiffness: 200, damping: 30 };
  const rotateX = useSpring(useTransform(rawY, [-0.5, 0.5], [4, -4]), cfg);
  const rotateY = useSpring(useTransform(rawX, [-0.5, 0.5], [-4, 4]), cfg);
  const glareX = useSpring(useTransform(rawX, [-0.5, 0.5], [0, 100]), cfg);
  const glareY = useSpring(useTransform(rawY, [-0.5, 0.5], [0, 100]), cfg);

  const onMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const r = cardRef.current?.getBoundingClientRect();
    if (!r) return;
    rawX.set((e.clientX - r.left) / r.width - 0.5);
    rawY.set((e.clientY - r.top) / r.height - 0.5);
  }, [rawX, rawY]);

  return (
    <motion.div ref={cardRef} onMouseMove={onMove} onMouseLeave={() => { rawX.set(0); rawY.set(0); }}
      style={{ rotateX, rotateY, transformStyle: "preserve-3d", perspective: 1000 }}
      className="relative w-full">
      <motion.div className="absolute inset-0 rounded-2xl pointer-events-none z-20 overflow-hidden" style={{ opacity: 0.06 }}>
        <motion.div className="absolute w-32 h-32 rounded-full blur-2xl"
          style={{
            background: "radial-gradient(circle, rgba(255,255,255,1), transparent)",
            left: useTransform(glareX, (v) => `${v}%`),
            top: useTransform(glareY, (v) => `${v}%`),
            transform: "translate(-50%, -50%)",
          }} />
      </motion.div>
      {children}
    </motion.div>
  );
}

// ── Animated input (light style) ──────────────────────────────────────────────
function AnimatedInput({ label, type, value, onChange, placeholder, children }: {
  label: string; type: string; value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder: string; children?: React.ReactNode;
}) {
  const [focused, setFocused] = useState(false);
  const has = value.length > 0;
  return (
    <div className="relative group">
      <motion.label className="absolute left-4 pointer-events-none font-medium z-10 origin-left"
        style={{ color: focused ? "#c4b5fd" : "rgba(255,255,255,0.35)" }}
        animate={{
          top: focused || has ? "6px" : "50%",
          y: focused || has ? "0%" : "-50%",
          fontSize: focused || has ? "9px" : "13px",
          letterSpacing: focused || has ? "0.08em" : "0",
          textTransform: focused || has ? "uppercase" as const : "none" as const,
        }}
        transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}>
        {label}
      </motion.label>
      <motion.div className="absolute inset-0 rounded-xl pointer-events-none"
        animate={{ boxShadow: focused ? "0 0 0 1.5px rgba(167,139,250,0.6), 0 0 20px rgba(124,58,237,0.15)" : "0 0 0 1px rgba(255,255,255,0.10)" }}
        transition={{ duration: 0.2 }} />
      <AnimatePresence>
        {focused && (
          <motion.div className="absolute bottom-0 left-4 right-4 h-px rounded-full pointer-events-none"
            style={{ background: "linear-gradient(90deg, transparent, rgba(124,58,237,0.8), transparent)" }}
            initial={{ scaleX: 0, opacity: 0 }} animate={{ scaleX: 1, opacity: 1 }}
            exit={{ scaleX: 0, opacity: 0 }} transition={{ duration: 0.35 }} />
        )}
      </AnimatePresence>
      <input type={type} value={value} onChange={onChange}
        placeholder={focused ? placeholder : ""}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        className="w-full rounded-xl px-4 pt-6 pb-2.5 text-sm text-white/90 outline-none transition-colors"
        style={{ background: focused ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.04)", border: "none" }} />
      {children}
    </div>
  );
}

// ── Password strength ─────────────────────────────────────────────────────────
function PasswordStrength({ password }: { password: string }) {
  const strength = !password ? 0 : password.length < 4 ? 1 : password.length < 7 ? 2 : /[A-Z]/.test(password) && /[0-9]/.test(password) ? 4 : 3;
  const colors = ["", "#ef4444", "#f97316", "#eab308", "#22c55e"];
  const labels = ["", "Weak", "Fair", "Good", "Strong"];
  if (!password) return null;
  return (
    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="px-1 pt-1.5">
      <div className="flex gap-1 mb-1">
        {[1, 2, 3, 4].map((i) => (
          <motion.div key={i} className="h-1 flex-1 rounded-full"
            animate={{ backgroundColor: i <= strength ? colors[strength] : "rgba(255,255,255,0.12)" }}
            transition={{ duration: 0.3, delay: i * 0.05 }} />
        ))}
      </div>
      <motion.p className="text-[10px] font-medium text-right" style={{ color: colors[strength] }}
        animate={{ opacity: [0, 1] }} key={strength}>
        {labels[strength]}
      </motion.p>
    </motion.div>
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
      whileHover={disabled ? {} : { scale: 1.015, y: -2 }}
      whileTap={disabled ? {} : { scale: 0.97, y: 0 }}
      className="relative w-full overflow-hidden rounded-xl py-3.5 font-semibold text-sm text-white disabled:opacity-70 disabled:cursor-not-allowed"
      style={{
        background: "linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%)",
        boxShadow: hovered && !disabled ? "0 8px 30px rgba(124,58,237,0.45), 0 2px 8px rgba(124,58,237,0.3)" : "0 4px 16px rgba(124,58,237,0.3)",
        transition: "box-shadow 0.3s ease",
      }}>
      {hovered && !disabled && (
        <motion.div className="absolute inset-0 pointer-events-none"
          style={{ background: `linear-gradient(105deg, transparent ${shimmerX - 20}%, rgba(255,255,255,0.18) ${shimmerX}%, rgba(255,255,255,0.08) ${shimmerX + 10}%, transparent ${shimmerX + 30}%)` }} />
      )}
      <span className="relative z-10 flex items-center justify-center gap-2">{children}</span>
    </motion.button>
  );
}

// ── Welcome back card ─────────────────────────────────────────────────────────
function WelcomeBackCard({ name }: { name?: string }) {
  const firstName = name?.trim().split(/\s+/)[0] || "";
  return (
    <motion.div className="absolute inset-0 z-[60] flex items-center justify-center pointer-events-none px-4"
      style={{ background: "rgba(13,10,26,0.70)", backdropFilter: "blur(8px)" }}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.18 } }}>
      <motion.div className="relative flex flex-col items-center gap-3 px-8 py-7 rounded-3xl text-center"
        style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(167,139,250,0.25)", boxShadow: "0 20px 60px -10px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.06) inset", backdropFilter: "blur(24px)" }}
        initial={{ y: 48, opacity: 0, scale: 0.94 }} animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: -16, opacity: 0, scale: 0.97, transition: { duration: 0.18 } }}
        transition={{ type: "spring", stiffness: 340, damping: 26 }}>
        <motion.div className="w-12 h-12 rounded-full flex items-center justify-center shrink-0"
          style={{ background: "linear-gradient(135deg, #7c3aed, #5b21b6)" }}
          initial={{ scale: 0 }} animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 420, damping: 18, delay: 0.08 }}>
          <motion.svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <motion.path d="M5 13l4 4L19 7" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.35, delay: 0.18 }} />
          </motion.svg>
        </motion.div>
        <div>
          <motion.p className="text-lg font-bold tracking-tight"
            style={{ background: "linear-gradient(135deg,#4c1d95,#7c3aed,#a78bfa)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.16, duration: 0.3 }}>
            Welcome back{firstName ? `, ${firstName}` : ""}!
          </motion.p>
          <motion.p className="text-xs text-white/40 mt-0.5"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.24, duration: 0.3 }}>
            Taking you to your dashboard…
          </motion.p>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────────
interface PublicStats {
  projects: number;
  workOrders: number;
  workOrderCompletionPct: number;
  grns: number;
  activeSuppliers: number;
  quotations: number;
}

export default function Login() {
  const { appVersion } = useAppVersion();
  const [showPass, setShowPass] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [loginSuccess, setLoginSuccess] = useState(false);
  const [loginName, setLoginName] = useState("");
  const [stats, setStats] = useState<PublicStats | null>(null);

  // Cycles the headline metric shown in the two simpler hero cards so the
  // strip isn't the same 3 numbers forever — Work Orders keeps its gauge
  // static since that one's tied to a specific completion-% ring.
  const [spotlight, setSpotlight] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setSpotlight((i) => (i + 1) % 2), 4000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    fetch("/api/public-stats")
      .then((r) => { if (!r.ok) throw new Error("stats unavailable"); return r.json(); })
      .then((d) => setStats(d))
      .catch(() => {/* keep null, cards show skeleton */});
  }, []);

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
          else if (role === "supplier") navigate("/supplier", { replace: true });
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
    <div className="min-h-screen w-full flex items-center justify-center px-4 py-8 overflow-x-hidden overflow-y-auto relative"
      style={{ background: "#0d0a1a" }}>

      {/* Subtle full-page grid — no crane here */}
      <div className="absolute inset-0 z-0 pointer-events-none"
        style={{ backgroundImage: "radial-gradient(circle, rgba(167,139,250,0.07) 1px, transparent 1px)", backgroundSize: "28px 28px" }} />
      <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
        <ScanLine />
      </div>
      <FloatingParticles />

      {/* Animated blobs */}
      <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
        <motion.div className="absolute top-[-12%] left-[-8%] w-[45%] h-[45%] rounded-full blur-[100px]"
          style={{ background: "rgba(124,58,237,0.28)" }}
          animate={{ scale: [1, 1.12, 1], opacity: [0.28, 0.42, 0.28] }}
          transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }} />
        <motion.div className="absolute bottom-[-12%] right-[-8%] w-[45%] h-[45%] rounded-full blur-[100px]"
          style={{ background: "rgba(79,70,229,0.22)" }}
          animate={{ scale: [1, 1.15, 1], opacity: [0.22, 0.34, 0.22] }}
          transition={{ duration: 10, repeat: Infinity, ease: "easeInOut", delay: 2 }} />
      </div>

      {/* Welcome overlay */}
      <AnimatePresence>
        {loginSuccess && <WelcomeBackCard name={loginName} />}
      </AnimatePresence>

      {/* Split layout */}
      <div className="relative z-10 w-full max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">

        {/* LEFT: Hero copy + floating preview cards */}
        <motion.div className="hidden lg:flex flex-col gap-6 relative"
          initial={{ opacity: 0, x: -40 }} animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}>

          {/* Crane scene anchored behind the text */}
          <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden">
            <div className="absolute bottom-0 left-0 right-0" style={{ height: "110%", opacity: 0.65 }}>
              <CivilScene />
            </div>
            {/* Fade top so crane doesn't compete with headline */}
            <div className="absolute inset-0" style={{ background: "linear-gradient(to bottom, rgba(13,10,26,0.72) 0%, rgba(13,10,26,0.18) 40%, rgba(13,10,26,0.10) 70%, rgba(13,10,26,0.55) 100%)" }} />
          </div>

          {/* All text/cards sit above the crane */}
          <div className="relative z-10 flex flex-col gap-6">
          <motion.div className="inline-flex items-center gap-2 self-start px-3 py-1.5 rounded-full text-xs font-medium"
            style={{ background: "rgba(124,58,237,0.15)", border: "1px solid rgba(167,139,250,0.30)", color: "#c4b5fd" }}
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
            <span className="w-1.5 h-1.5 rounded-full animate-pulse bg-purple-500" />
            New: L1 Chart &amp; Supplier Portal just launched
          </motion.div>

          <div>
            <motion.h1 className="text-4xl sm:text-5xl lg:text-[3.25rem] font-bold leading-[1.12] tracking-tight text-white"
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25, duration: 0.7 }}>
              CivilierERP —{" "}
              <span style={{ background: "linear-gradient(135deg, #7c3aed, #a78bfa, #c4b5fd)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                Manage Smarter,
              </span>
              <br />Build Better.
            </motion.h1>
            <motion.div className="mt-3 h-5 flex items-center gap-2 text-sm text-white/50 overflow-hidden"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}>
              <span className="w-1 h-1 rounded-full bg-purple-400 inline-block shrink-0" />
              <span className="whitespace-nowrap">{tagline}</span>
              <motion.span className="inline-block w-0.5 h-3.5 bg-purple-400 ml-0.5 shrink-0"
                animate={{ opacity: [1, 0] }} transition={{ duration: 0.5, repeat: Infinity }} />
            </motion.div>
          </div>

          <motion.p className="text-sm text-white/40 max-w-md leading-relaxed"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }}>
            From procurement and material tracking to contractor management and live project dashboards — CivilierERP gives your team total visibility and control.
          </motion.p>

          <motion.div className="flex items-center gap-3"
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.55 }}>

            {/* Card 1 — rotates Projects <-> Active Suppliers */}
            <div className="flex flex-col gap-2 px-4 py-3 rounded-2xl overflow-hidden"
              style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(167,139,250,0.18)", backdropFilter: "blur(12px)", minWidth: 110 }}>
              <div className="flex items-center justify-between">
                <AnimatePresence mode="wait">
                  <motion.span key={`c1-label-${spotlight}`} className="text-[10px] font-semibold uppercase tracking-widest text-white/35"
                    initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.3 }}>
                    {spotlight === 0 ? "Projects" : "Active Suppliers"}
                  </motion.span>
                </AnimatePresence>
                <motion.span className="w-1.5 h-1.5 rounded-full bg-emerald-400"
                  animate={{ opacity: [1, 0.2, 1] }} transition={{ duration: 1.4, repeat: Infinity }} />
              </div>
              {stats ? (
                <AnimatePresence mode="wait">
                  <motion.span key={`c1-val-${spotlight}`} className="text-2xl font-bold text-white leading-none"
                    initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.3 }}>
                    {((spotlight === 0 ? stats.projects : stats.activeSuppliers) ?? 0).toLocaleString("en-IN")}
                  </motion.span>
                </AnimatePresence>
              ) : (
                <div className="h-7 w-12 rounded bg-white/10 animate-pulse" />
              )}
              <div className="flex gap-1 items-end">
                {[40, 65, 50, 80, 60, 75, 55].map((h, i) => (
                  <div key={i} className="flex-1 rounded-sm"
                    style={{ height: h * 0.28, background: i >= 5 ? "rgba(167,139,250,0.7)" : "rgba(167,139,250,0.2)" }} />
                ))}
              </div>
            </div>

            {/* Card 2 — rotates GRNs Received <-> Quotations */}
            <div className="flex flex-col gap-2 px-4 py-3 rounded-2xl overflow-hidden"
              style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(167,139,250,0.18)", backdropFilter: "blur(12px)", minWidth: 120 }}>
              <AnimatePresence mode="wait">
                <motion.span key={`c2-label-${spotlight}`} className="text-[10px] font-semibold uppercase tracking-widest text-white/35"
                  initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.3 }}>
                  {spotlight === 0 ? "GRNs Received" : "Quotations"}
                </motion.span>
              </AnimatePresence>
              {stats ? (
                <AnimatePresence mode="wait">
                  <motion.span key={`c2-val-${spotlight}`} className="text-2xl font-bold text-white leading-none"
                    initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.3 }}>
                    {((spotlight === 0 ? stats.grns : stats.quotations) ?? 0).toLocaleString("en-IN")}
                  </motion.span>
                </AnimatePresence>
              ) : (
                <div className="h-7 w-16 rounded bg-white/10 animate-pulse" />
              )}
              <div className="space-y-1.5">
                {[
                  { label: "Suppliers", val: stats?.activeSuppliers },
                  { label: "Quotations", val: stats?.quotations },
                ].map((m) => (
                  <div key={m.label} className="flex justify-between text-[9px] text-white/30">
                    <span>{m.label}</span>
                    {m.val !== undefined ? <span className="text-white/50 font-medium">{m.val}</span> : <span className="w-6 h-2.5 rounded bg-white/10 animate-pulse inline-block" />}
                  </div>
                ))}
              </div>
            </div>

            {/* Card 3 — Work orders */}
            <div className="flex flex-col gap-2 px-4 py-3 rounded-2xl"
              style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(167,139,250,0.18)", backdropFilter: "blur(12px)", minWidth: 108 }}>
              <span className="text-[10px] font-semibold uppercase tracking-widest text-white/35">Work Orders</span>
              {stats ? (
                <span className="text-2xl font-bold text-white leading-none">{(stats.workOrders ?? 0).toLocaleString("en-IN")}</span>
              ) : (
                <div className="h-7 w-14 rounded bg-white/10 animate-pulse" />
              )}
              <div className="flex items-center gap-2">
                <svg width="36" height="36" viewBox="0 0 36 36">
                  <circle cx="18" cy="18" r="14" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="4" />
                  <motion.circle cx="18" cy="18" r="14" fill="none" stroke="rgba(167,139,250,0.75)" strokeWidth="4"
                    strokeLinecap="round" strokeDasharray="87.96" strokeDashoffset="87.96"
                    initial={{ strokeDashoffset: 87.96 }}
                    animate={{ strokeDashoffset: stats ? 87.96 * (1 - stats.workOrderCompletionPct / 100) : 87.96 }}
                    transition={{ duration: 1.2, delay: 0.9, ease: "easeOut" }}
                    transform="rotate(-90 18 18)" />
                </svg>
                <div>
                  {stats ? (
                    <p className="text-xs font-bold text-white/80">{stats.workOrderCompletionPct ?? 0}%</p>
                  ) : (
                    <div className="h-3 w-8 rounded bg-white/10 animate-pulse mb-1" />
                  )}
                  <p className="text-[9px] text-white/30">Completed</p>
                </div>
              </div>
            </div>

          </motion.div>

          <div className="relative h-64 mt-2">
            <HeroCards stats={stats} />
          </div>
          </div>{/* end z-10 wrapper */}
        </motion.div>

        {/* RIGHT: Login card */}
        <motion.div className="flex justify-center lg:justify-end"
          initial={{ opacity: 0, y: 32, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}>
          <div className="w-full max-w-md">
            <TiltCard>
              {/* Blueprint corner accents */}
              {["top-0 left-0 border-t-2 border-l-2 rounded-tl-2xl", "top-0 right-0 border-t-2 border-r-2 rounded-tr-2xl", "bottom-0 left-0 border-b-2 border-l-2 rounded-bl-2xl", "bottom-0 right-0 border-b-2 border-r-2 rounded-br-2xl"].map((cls, i) => (
                <motion.div key={i} className={`absolute w-5 h-5 border-violet-400/60 z-20 ${cls}`}
                  initial={{ opacity: 0, scale: 0.5 }} animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.4 + i * 0.08, duration: 0.4, ease: "backOut" }} />
              ))}

              <div className="p-6 sm:p-8 rounded-2xl"
                style={{
                  background: "linear-gradient(145deg, rgba(255,255,255,0.05) 0%, rgba(124,58,237,0.04) 100%)",
                  border: "1px solid rgba(167,139,250,0.18)",
                  boxShadow: "0 24px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(124,58,237,0.08) inset, inset 0 1px 0 rgba(255,255,255,0.07)",
                  backdropFilter: "blur(28px) saturate(150%)",
                }}>

                {/* Header */}
                <div className="text-center mb-6 sm:mb-8">
                  <motion.div initial={{ scale: 0.7, opacity: 0, y: 10 }} animate={{ scale: 1, opacity: 1, y: 0 }}
                    transition={{ delay: 0.2, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                    className="flex flex-col items-center gap-3">
                    <LogoRing size={80} />
                    <motion.h1 className="text-2xl sm:text-3xl font-bold tracking-tight"
                      style={{ background: "linear-gradient(135deg,#4c1d95,#7c3aed,#a78bfa)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}
                      initial={{ letterSpacing: "0.2em", opacity: 0 }} animate={{ letterSpacing: "-0.01em", opacity: 1 }}
                      transition={{ delay: 0.35, duration: 0.7 }}>
                      CivilierERP
                    </motion.h1>
                  </motion.div>
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}
                    className="mt-2 text-xs sm:text-sm text-white/40 h-5 flex items-center justify-center gap-1.5">
                    <motion.span className="w-1.5 h-1.5 rounded-full bg-purple-400 inline-block"
                      animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1.2, repeat: Infinity }} />
                    <span>{tagline}</span>
                    <motion.span className="inline-block w-0.5 h-3.5 bg-purple-400 ml-0.5"
                      animate={{ opacity: [1, 0] }} transition={{ duration: 0.6, repeat: Infinity }} />
                  </motion.div>
                </div>

                {/* Form */}
                <motion.form className="space-y-4" onSubmit={handleSubmit}
                  initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.4, duration: 0.5 }}>
                  <AnimatedInput label="Email Address" type="email" value={email}
                    onChange={(e) => { setEmail(e.target.value); setError(""); }}
                    placeholder="name@company.com" />

                  <div>
                    <AnimatedInput label="Password" type={showPass ? "text" : "password"} value={password}
                      onChange={(e) => { setPassword(e.target.value); setError(""); }}
                      placeholder="••••••••">
                      <motion.button type="button" onClick={() => setShowPass(!showPass)}
                        className="absolute right-3 bottom-2.5 text-white/30 hover:text-violet-300 transition-colors p-1"
                        whileTap={{ scale: 0.85, rotate: 15 }}>
                        <AnimatePresence mode="wait">
                          <motion.span key={showPass ? "off" : "on"}
                            initial={{ opacity: 0, rotate: -10, scale: 0.8 }} animate={{ opacity: 1, rotate: 0, scale: 1 }}
                            exit={{ opacity: 0, rotate: 10, scale: 0.8 }} transition={{ duration: 0.15 }}>
                            {showPass ? <EyeOff size={17} /> : <Eye size={17} />}
                          </motion.span>
                        </AnimatePresence>
                      </motion.button>
                    </AnimatedInput>
                    <AnimatePresence>
                      {password && <PasswordStrength password={password} />}
                    </AnimatePresence>
                  </div>

                  <AnimatePresence>
                    {error && (
                      <motion.div initial={{ opacity: 0, y: -6, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -6, scale: 0.97 }}
                        transition={{ type: "spring", stiffness: 400, damping: 25 }}
                        className="px-4 py-2.5 rounded-xl text-sm text-red-600 flex items-center gap-2"
                        style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.25)", color: "#fca5a5" }}>
                        <motion.div animate={{ rotate: [0, -8, 8, -4, 4, 0] }} transition={{ duration: 0.4 }} className="shrink-0">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                          </svg>
                        </motion.div>
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
                    ) : (
                      <motion.span initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6 }}>
                        Sign In →
                      </motion.span>
                    )}
                  </ShimmerButton>
                </motion.form>

                <p className="text-center text-[10px] text-white/20 mt-5">
                  Secure access · Role-based permissions · v{appVersion}
                </p>

                {/* Get the Android app — moved out of the floating top-right
                    corner (looked orphaned, unrelated to the sign-in card)
                    into a plain footer link near the other portal links, so
                    it's reachable before signing in without competing for
                    attention with the form itself. */}
                <button
                  type="button"
                  onClick={() => navigate("/download-android-app")}
                  className="group flex items-center justify-center gap-1.5 mx-auto mt-3 text-[11px] font-medium text-white/35 hover:text-violet-300 transition-colors"
                >
                  <Smartphone size={12} className="text-violet-300/70 group-hover:text-violet-300 transition-colors" />
                  Get the Android app
                </button>

                {/* Other portals */}
                <div className="mt-5 pt-5" style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                  <p className="text-center text-[10px] font-semibold tracking-wider uppercase text-white/25 mb-3">
                    Looking for a different portal?
                  </p>
                  <div className="grid grid-cols-2 gap-2.5">
                    <motion.button
                      type="button"
                      onClick={() => navigate("/supplier-login")}
                      whileHover={{ y: -2 }}
                      whileTap={{ scale: 0.97 }}
                      className="group relative flex flex-col items-start gap-2 rounded-xl p-3 text-left overflow-hidden transition-colors"
                      style={{
                        background: "rgba(139,92,246,0.06)",
                        border: "1px solid rgba(139,92,246,0.18)",
                      }}
                    >
                      <div className="flex items-center justify-between w-full">
                        <span className="flex items-center justify-center w-7 h-7 rounded-lg shrink-0"
                          style={{ background: "rgba(139,92,246,0.15)" }}>
                          <Truck size={14} className="text-violet-300" />
                        </span>
                        <ArrowUpRight size={13} className="text-white/20 group-hover:text-violet-300 transition-colors" />
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-white/80">Supplier</p>
                        <p className="text-[10px] text-white/35">Vendor &amp; order portal</p>
                      </div>
                    </motion.button>

                    <motion.button
                      type="button"
                      onClick={() => navigate("/crm-client-portal/login")}
                      whileHover={{ y: -2 }}
                      whileTap={{ scale: 0.97 }}
                      className="group relative flex flex-col items-start gap-2 rounded-xl p-3 text-left overflow-hidden transition-colors"
                      style={{
                        background: "rgba(139,92,246,0.06)",
                        border: "1px solid rgba(139,92,246,0.18)",
                      }}
                    >
                      <div className="flex items-center justify-between w-full">
                        <span className="flex items-center justify-center w-7 h-7 rounded-lg shrink-0"
                          style={{ background: "rgba(139,92,246,0.15)" }}>
                          <Building2 size={14} className="text-violet-300" />
                        </span>
                        <ArrowUpRight size={13} className="text-white/20 group-hover:text-violet-300 transition-colors" />
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-white/80">Customer</p>
                        <p className="text-[10px] text-white/35">Booking &amp; owner portal</p>
                      </div>
                    </motion.button>
                  </div>
                </div>
              </div>
            </TiltCard>
          </div>
        </motion.div>

      </div>
    </div>
  );
}
