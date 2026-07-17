import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { useAppVersion } from "@/hooks/useAppVersion";

// ── Animated background orbs ──────────────────────────────────────────────────
function BackgroundOrbs() {
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {/* Large slow-drifting blobs */}
      <motion.div className="absolute rounded-full blur-[120px]"
        style={{ width: 500, height: 500, top: "-10%", left: "-8%", background: "rgba(124,58,237,0.22)" }}
        animate={{ x: [0, 40, 0], y: [0, 30, 0], scale: [1, 1.1, 1] }}
        transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }} />
      <motion.div className="absolute rounded-full blur-[100px]"
        style={{ width: 400, height: 400, bottom: "-8%", right: "-6%", background: "rgba(79,70,229,0.20)" }}
        animate={{ x: [0, -30, 0], y: [0, -25, 0], scale: [1, 1.12, 1] }}
        transition={{ duration: 10, repeat: Infinity, ease: "easeInOut", delay: 2 }} />
      <motion.div className="absolute rounded-full blur-[80px]"
        style={{ width: 260, height: 260, top: "40%", right: "20%", background: "rgba(139,92,246,0.14)" }}
        animate={{ x: [0, 20, -10, 0], y: [0, -20, 10, 0] }}
        transition={{ duration: 8, repeat: Infinity, ease: "easeInOut", delay: 1 }} />

      {/* Dot grid */}
      <div className="absolute inset-0"
        style={{ backgroundImage: "radial-gradient(circle, rgba(167,139,250,0.07) 1px, transparent 1px)", backgroundSize: "28px 28px" }} />

      {/* Scan line */}
      <motion.div className="absolute left-0 right-0 h-px"
        style={{ background: "linear-gradient(90deg,transparent,rgba(167,139,250,0.4) 50%,transparent)" }}
        initial={{ top: "0%" }}
        animate={{ top: ["0%", "100%", "0%"] }}
        transition={{ duration: 14, repeat: Infinity, ease: "linear" }} />

      {/* Floating construction icons */}
      {[
        { x: "7%",  delay: 0,   dur: 7,   type: "brick" },
        { x: "20%", delay: 2,   dur: 9,   type: "bolt" },
        { x: "38%", delay: 4,   dur: 6,   type: "triangle" },
        { x: "62%", delay: 1,   dur: 8,   type: "brick" },
        { x: "80%", delay: 3,   dur: 7,   type: "bolt" },
        { x: "93%", delay: 0.5, dur: 6.5, type: "triangle" },
      ].map((p, i) => (
        <motion.div key={i} className="absolute bottom-0" style={{ left: p.x }}
          animate={{ y: [0, -500], opacity: [0, 0.45, 0] }}
          transition={{ duration: p.dur, delay: p.delay, repeat: Infinity, ease: "easeInOut" }}>
          {p.type === "bolt" ? (
            <svg width="12" height="12" viewBox="0 0 12 12">
              <polygon points="6,1 10.2,3.5 10.2,8.5 6,11 1.8,8.5 1.8,3.5" fill="none" stroke="rgba(167,139,250,0.55)" strokeWidth="1" />
              <circle cx="6" cy="6" r="2" fill="none" stroke="rgba(167,139,250,0.4)" strokeWidth="0.8" />
            </svg>
          ) : p.type === "triangle" ? (
            <svg width="13" height="12" viewBox="0 0 13 12">
              <polygon points="6.5,1 12,11 1,11" fill="none" stroke="rgba(167,139,250,0.5)" strokeWidth="1" />
            </svg>
          ) : (
            <svg width="14" height="10" viewBox="0 0 14 10">
              <rect width="14" height="10" rx="1" fill="none" stroke="rgba(167,139,250,0.6)" strokeWidth="1.2" />
              <line x1="7" y1="0" x2="7" y2="10" stroke="rgba(167,139,250,0.4)" strokeWidth="0.8" />
              <line x1="0" y1="5" x2="14" y2="5" stroke="rgba(167,139,250,0.4)" strokeWidth="0.8" />
            </svg>
          )}
        </motion.div>
      ))}

      {/* Pulsing ring accents */}
      {[[15, 25], [80, 70], [50, 85]].map(([lp, tp], i) => (
        <motion.div key={i} className="absolute rounded-full border"
          style={{ width: 120, height: 120, left: `${lp}%`, top: `${tp}%`, borderColor: "rgba(167,139,250,0.08)" }}
          animate={{ scale: [1, 1.5, 1], opacity: [0.4, 0, 0.4] }}
          transition={{ duration: 4 + i, repeat: Infinity, delay: i * 1.2, ease: "easeOut" }} />
      ))}
    </div>
  );
}

export default function Landing() {
  const navigate = useNavigate();
  const [exiting, setExiting] = useState(false);
  const { appVersion } = useAppVersion();

  function handleEnter() {
    setExiting(true);
    setTimeout(() => navigate("/login"), 500);
  }

  return (
    <motion.div
      key="landing"
      initial={{ opacity: 0 }}
      animate={{ opacity: exiting ? 0 : 1 }}
      transition={{ duration: 0.5 }}
      className="relative w-full overflow-hidden"
      style={{ height: "100dvh", background: "#0d0a1a", color: "#e5e7eb", fontFamily: '"DM Sans","Noto Sans",system-ui,sans-serif', display: "flex", flexDirection: "column" }}
    >
      <BackgroundOrbs />

      {/* ── Main content ── */}
      <div className="relative z-10 flex flex-col items-center justify-center flex-1 px-6 text-center">
        {/* Badge */}
        <motion.div
          initial={{ opacity: 0, y: 16, filter: "blur(6px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{ delay: 0.1, duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium mb-6"
          style={{ background: "rgba(124,58,237,0.15)", border: "1px solid rgba(167,139,250,0.30)", color: "#c4b5fd" }}>
          <motion.span className="w-1.5 h-1.5 rounded-full bg-purple-400"
            animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1.4, repeat: Infinity }} />
          ERP for Real Estate &amp; Civil Construction
        </motion.div>

        {/* Headline — words stagger in */}
        <motion.h1
          className="font-black leading-[1.06] tracking-tight mb-4"
          style={{ fontSize: "clamp(2.6rem,6.5vw,5rem)" }}
          initial={{ opacity: 0, y: 28 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}>
          <span className="text-white">One platform for your</span>
          <br />
          <motion.span
            style={{ background: "linear-gradient(135deg,#7c3aed,#a78bfa,#c4b5fd)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", display: "inline-block" }}
            animate={{ backgroundPosition: ["0% 50%", "100% 50%", "0% 50%"] }}
            transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}>
            entire project
          </motion.span>
        </motion.h1>

        {/* Sub-copy */}
        <motion.p
          className="max-w-lg text-base leading-relaxed mb-10"
          style={{ color: "rgba(255,255,255,0.38)" }}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}>
          Finance, material, engineering, CRM, and sales — unified in a single ERP built for construction companies.
        </motion.p>

        {/* CTA */}
        <motion.div
          initial={{ opacity: 0, y: 10, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ delay: 0.48, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}>
          <motion.button onClick={handleEnter}
            whileHover={{ scale: 1.04, borderColor: "rgba(167,139,250,0.75)", color: "#ddd6fe" }}
            whileTap={{ scale: 0.96 }}
            className="px-7 py-2.5 rounded-xl text-sm font-semibold transition-colors"
            style={{ border: "1.5px solid rgba(167,139,250,0.45)", color: "#c4b5fd", background: "transparent" }}>
            Enter CivilierERP →
          </motion.button>
        </motion.div>
      </div>

      {/* ── Footer strip ── */}
      <motion.div
        className="relative z-10 flex items-center justify-between px-8 py-3"
        style={{ borderTop: "1px solid rgba(167,139,250,0.08)" }}
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.65, duration: 0.6 }}>
        <span className="text-[11px]" style={{ color: "rgba(167,139,250,0.30)" }}>© {new Date().getFullYear()} CivilierERP · Rajwada Infotech</span>
        <span className="text-[11px]" style={{ color: "rgba(167,139,250,0.22)" }}>v{appVersion}</span>
      </motion.div>
    </motion.div>
  );
}
