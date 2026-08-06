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

// ── Rising skyline: buildings self-construct floor by floor, tower crane
// swings and lowers a load — the site's own "under construction" motif. ──────
function ConstructionSkyline() {
  // Each building: [x, width, floors, floorHeight]. Heights are derived so
  // the silhouette reads as a real skyline instead of uniform bars.
  const buildings: { x: number; w: number; floors: number; fh: number; delay: number }[] = [
    { x: 40, w: 46, floors: 4, fh: 16, delay: 0 },
    { x: 96, w: 60, floors: 7, fh: 15, delay: 0.15 },
    { x: 168, w: 42, floors: 5, fh: 14, delay: 0.35 },
    { x: 222, w: 70, floors: 9, fh: 16, delay: 0.05 },
    { x: 306, w: 50, floors: 6, fh: 15, delay: 0.25 },
    { x: 1560, w: 54, floors: 6, fh: 15, delay: 0.1 },
    { x: 1626, w: 40, floors: 4, fh: 16, delay: 0.3 },
    { x: 1678, w: 66, floors: 8, fh: 15, delay: 0 },
    { x: 1756, w: 44, floors: 5, fh: 14, delay: 0.2 },
  ];

  return (
    <div className="absolute inset-x-0 bottom-0 pointer-events-none overflow-hidden" style={{ height: 220 }}>
      <svg
        viewBox="0 0 1920 220"
        preserveAspectRatio="xMidYMax slice"
        className="absolute inset-0 w-full h-full"
      >
        {/* Ground / foundation line */}
        <motion.line x1="0" y1="219" x2="1920" y2="219"
          stroke="rgba(167,139,250,0.18)" strokeWidth="1"
          initial={{ pathLength: 0 }} animate={{ pathLength: 1 }}
          transition={{ duration: 1.6, ease: "easeOut" }} />

        {buildings.map((b, bi) => {
          const total = b.floors * b.fh;
          const top = 220 - total;
          return (
            <g key={bi}>
              {/* Building rises up from the ground, then settles */}
              <motion.rect
                x={b.x} width={b.w} y={220} height={total}
                fill="rgba(124,58,237,0.10)"
                stroke="rgba(167,139,250,0.28)" strokeWidth="1"
                initial={{ y: 220, height: 0 }}
                animate={{ y: top, height: total }}
                transition={{ duration: 1.1, delay: 0.6 + b.delay, ease: [0.16, 1, 0.3, 1] }}
              />
              {/* Floor divider lines, drawn in sequence after the shell settles */}
              {Array.from({ length: b.floors - 1 }).map((_, fi) => (
                <motion.line key={fi}
                  x1={b.x} x2={b.x + b.w}
                  y1={top + (fi + 1) * b.fh} y2={top + (fi + 1) * b.fh}
                  stroke="rgba(167,139,250,0.14)" strokeWidth="1"
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  transition={{ delay: 1.5 + b.delay + fi * 0.04, duration: 0.3 }} />
              ))}
              {/* A handful of lit windows blink on after construction finishes */}
              {Array.from({ length: b.floors }).map((_, fi) =>
                fi % 2 === 0 ? (
                  <motion.rect key={fi}
                    x={b.x + b.w / 2 - 3} width={6}
                    y={top + fi * b.fh + b.fh / 2 - 3} height={6}
                    fill="rgba(196,181,253,0.5)"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: [0, 0.9, 0.5] }}
                    transition={{ delay: 1.9 + b.delay + fi * 0.06, duration: 1.2 }} />
                ) : null,
              )}
            </g>
          );
        })}

        {/* ── Tower crane, mid-right, swinging its jib over the skyline ── */}
        <g transform="translate(430,0)">
          <motion.line x1="0" y1="220" x2="0" y2="30" stroke="rgba(167,139,250,0.35)" strokeWidth="2"
            initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1, delay: 0.3, ease: "easeOut" }} />
          {/* Cross-bracing on the mast */}
          {[60, 100, 140, 180].map((y, i) => (
            <motion.line key={i} x1="-6" y1={220 - y + 14} x2="6" y2={220 - y}
              stroke="rgba(167,139,250,0.18)" strokeWidth="1"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 + i * 0.08 }} />
          ))}
          {/* Jib arm + counter-jib, gently swinging about the mast top */}
          <motion.g
            style={{ transformOrigin: "0px 30px" }}
            initial={{ opacity: 0, rotate: -6 }}
            animate={{ opacity: 1, rotate: [-6, 6, -6] }}
            transition={{
              opacity: { delay: 1.1, duration: 0.5 },
              rotate: { duration: 9, repeat: Infinity, ease: "easeInOut", delay: 1.1 },
            }}>
            <line x1="-40" y1="30" x2="160" y2="30" stroke="rgba(167,139,250,0.4)" strokeWidth="2" />
            <line x1="-40" y1="30" x2="0" y2="6" stroke="rgba(167,139,250,0.28)" strokeWidth="1.5" />
            <line x1="160" y1="30" x2="0" y2="6" stroke="rgba(167,139,250,0.28)" strokeWidth="1.5" />
            <line x1="0" y1="6" x2="0" y2="30" stroke="rgba(167,139,250,0.28)" strokeWidth="1.5" />
            {/* Trolley riding the jib, and the pulley the cable runs through —
                both stay pinned to the arm; only the cable/hook below move,
                so the rope never visually detaches from the crane. */}
            <rect x="126" y="26" width="8" height="6" rx="1" fill="rgba(167,139,250,0.35)" />
            <circle cx="130" cy="32" r="2" fill="none" stroke="rgba(167,139,250,0.5)" strokeWidth="1" />
            {/* Hoist cable — top end fixed at the pulley (130,32); bottom end
                (and the hook/load riding it) animate together so the rope
                always spans the full gap, rather than the whole assembly
                sliding away from its anchor. */}
            <motion.line x1="130" y1="32" x2="130"
              animate={{ y2: [70, 84, 70] }}
              transition={{ duration: 3.4, repeat: Infinity, ease: "easeInOut", delay: 1.4 }}
              stroke="rgba(167,139,250,0.35)" strokeWidth="1" />
            <motion.g
              animate={{ y: [70, 84, 70], rotate: [-3, 3, -3] }}
              style={{ transformOrigin: "130px 0px" }}
              transition={{
                y: { duration: 3.4, repeat: Infinity, ease: "easeInOut", delay: 1.4 },
                rotate: { duration: 2.6, repeat: Infinity, ease: "easeInOut", delay: 1.6 },
              }}>
              {/* Hook */}
              <path d="M126,0 L126,6 Q126,10 130,10 Q134,10 134,6 L134,0"
                fill="none" stroke="rgba(167,139,250,0.4)" strokeWidth="1" />
              {/* Load block, slung from two chain lines */}
              <line x1="124" y1="4" x2="120" y2="14" stroke="rgba(167,139,250,0.3)" strokeWidth="0.8" />
              <line x1="136" y1="4" x2="140" y2="14" stroke="rgba(167,139,250,0.3)" strokeWidth="0.8" />
              <rect x="118" y="14" width="24" height="14" rx="2" fill="rgba(124,58,237,0.28)" stroke="rgba(167,139,250,0.55)" strokeWidth="1" />
              <line x1="118" y1="21" x2="142" y2="21" stroke="rgba(167,139,250,0.35)" strokeWidth="0.8" />
            </motion.g>
          </motion.g>
        </g>
      </svg>
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
      <ConstructionSkyline />

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
            entire business !
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
