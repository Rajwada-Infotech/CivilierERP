import { motion } from "framer-motion";

interface ErrorPageProps {
  error: Error | null;
}

export function ErrorPage({ error }: ErrorPageProps) {
  const isDev = import.meta.env.DEV;
  const errorMessage = error?.message || "An unknown error occurred.";

  return (
    <div className="min-h-screen bg-background flex items-center justify-center overflow-hidden relative font-sans select-none">
      {/* Blueprint grid — identical to NotFound */}
      <svg
        className="absolute inset-0 w-full h-full opacity-[0.07] pointer-events-none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <pattern
            id="epSmallGrid"
            width="20"
            height="20"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M 20 0 L 0 0 0 20"
              fill="none"
              stroke="hsl(239,84%,67%)"
              strokeWidth="0.4"
            />
          </pattern>
          <pattern
            id="epBigGrid"
            width="100"
            height="100"
            patternUnits="userSpaceOnUse"
          >
            <rect width="100" height="100" fill="url(#epSmallGrid)" />
            <path
              d="M 100 0 L 0 0 0 100"
              fill="none"
              stroke="hsl(239,84%,67%)"
              strokeWidth="0.8"
            />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#epBigGrid)" />
      </svg>

      {/* Radial glow — red tint signals a harder failure than the 404 blue */}
      <div
        className="absolute pointer-events-none"
        style={{
          width: 600,
          height: 600,
          left: "50%",
          top: "50%",
          transform: "translate(-50%, -50%)",
          background:
            "radial-gradient(ellipse at center, hsl(0 84% 60% / 0.06) 0%, transparent 70%)",
          borderRadius: "50%",
        }}
      />

      {/* Blueprint scan line */}
      <motion.div
        className="absolute left-0 right-0 h-32 pointer-events-none"
        style={{
          background:
            "linear-gradient(to bottom, transparent, hsl(0 84% 60% / 0.04), transparent)",
        }}
        initial={{ top: "-10%" }}
        animate={{ top: "110%" }}
        transition={{
          duration: 6,
          repeat: Infinity,
          ease: "linear",
          repeatDelay: 2,
        }}
      />

      {/* Broken circuit — top left, replaces the compass */}
      <motion.svg
        className="absolute pointer-events-none opacity-25 hidden md:block"
        style={{ top: "8%", left: "6%" }}
        width="90"
        height="90"
        viewBox="0 0 90 90"
        fill="none"
        animate={{ opacity: [0.25, 0.1, 0.25] }}
        transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
      >
        {/* Horizontal trace with a break */}
        <line x1="8" y1="45" x2="34" y2="45" stroke="hsl(239 84% 67%)" strokeWidth="1.5" strokeLinecap="round" />
        <line x1="56" y1="45" x2="82" y2="45" stroke="hsl(239 84% 67%)" strokeWidth="1.5" strokeLinecap="round" />
        {/* Break gap with red spark */}
        <line x1="34" y1="45" x2="42" y2="34" stroke="hsl(0 84% 60%)" strokeWidth="1.5" strokeLinecap="round" />
        <line x1="42" y1="34" x2="48" y2="56" stroke="hsl(0 84% 60%)" strokeWidth="1.5" strokeLinecap="round" />
        <line x1="48" y1="56" x2="56" y2="45" stroke="hsl(0 84% 60%)" strokeWidth="1.5" strokeLinecap="round" />
        {/* Component nodes */}
        <circle cx="8" cy="45" r="3" fill="none" stroke="hsl(239 84% 67%)" strokeWidth="1.2" />
        <circle cx="82" cy="45" r="3" fill="none" stroke="hsl(239 84% 67%)" strokeWidth="1.2" />
        <circle cx="45" cy="45" r="2" fill="hsl(0 84% 60%)" />
        <text x="45" y="68" textAnchor="middle" fontSize="7" fill="hsl(0 84% 60%)" fontFamily="monospace" letterSpacing="1">BREAK</text>
      </motion.svg>

      {/* Set-square — bottom right, same as NotFound */}
      <motion.svg
        className="absolute pointer-events-none opacity-20 hidden md:block"
        style={{ bottom: "10%", right: "7%" }}
        width="100"
        height="100"
        viewBox="0 0 100 100"
        fill="none"
        animate={{ y: [0, -10, 0], rotate: [0, 3, 0] }}
        transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }}
      >
        <path
          d="M5 95 L5 15 L85 95 Z"
          stroke="hsl(239 84% 67%)"
          strokeWidth="1.5"
          fill="hsl(0 84% 60% / 0.03)"
        />
        <line x1="5" y1="30" x2="20" y2="30" stroke="hsl(239 84% 67%)" strokeWidth="1" />
        <line x1="5" y1="45" x2="20" y2="45" stroke="hsl(239 84% 67%)" strokeWidth="1" />
        <line x1="5" y1="60" x2="20" y2="60" stroke="hsl(239 84% 67%)" strokeWidth="1" />
        <line x1="5" y1="75" x2="20" y2="75" stroke="hsl(239 84% 67%)" strokeWidth="1" />
      </motion.svg>

      {/* ── Main card ── */}
      <div className="relative z-10 flex flex-col items-center gap-10 px-6 max-w-xl w-full">

        {/* Drawing sheet header */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="w-full flex items-center justify-between border border-border/50 px-4 py-2 rounded-md bg-card/40 backdrop-blur-sm"
        >
          <span className="font-mono text-[10px] text-muted-foreground tracking-widest uppercase">
            Civilier ERP
          </span>
          <span className="font-mono text-[10px] text-muted-foreground tracking-widest uppercase">
            DWG-ERR · REV 0
          </span>
          <span className="font-mono text-[10px] text-muted-foreground tracking-widest uppercase">
            Fault Sheet
          </span>
        </motion.div>

        {/* Central error display */}
        <div
          className="relative flex items-center justify-center w-full"
          style={{ height: 180 }}
        >
          {/* Left dimension line */}
          <motion.div
            className="absolute flex flex-col items-center"
            style={{ left: "8%", top: 0, bottom: 0 }}
            initial={{ opacity: 0, scaleY: 0 }}
            animate={{ opacity: 1, scaleY: 1 }}
            transition={{ duration: 0.8, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="w-px flex-1 bg-primary/40" />
            <div className="w-3 h-px bg-primary/60" />
            <div
              className="font-mono text-[9px] text-primary/60 my-1 tracking-widest"
              style={{ writingMode: "vertical-rl" }}
            >
              STATUS: CRASH
            </div>
            <div className="w-3 h-px bg-primary/60" />
            <div className="w-px flex-1 bg-primary/40" />
          </motion.div>

          {/* Right dimension line */}
          <motion.div
            className="absolute flex flex-col items-center"
            style={{ right: "8%", top: 0, bottom: 0 }}
            initial={{ opacity: 0, scaleY: 0 }}
            animate={{ opacity: 1, scaleY: 1 }}
            transition={{ duration: 0.8, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="w-px flex-1 bg-primary/40" />
            <div className="w-3 h-px bg-primary/60" />
            <div
              className="font-mono text-[9px] text-primary/60 my-1 tracking-widest"
              style={{ writingMode: "vertical-rl" }}
            >
              RENDER: NULL
            </div>
            <div className="w-3 h-px bg-primary/60" />
            <div className="w-px flex-1 bg-primary/40" />
          </motion.div>

          {/* Top dimension line */}
          <motion.div
            className="absolute flex items-center"
            style={{ top: 10, left: "16%", right: "16%" }}
            initial={{ opacity: 0, scaleX: 0 }}
            animate={{ opacity: 1, scaleX: 1 }}
            transition={{ duration: 0.8, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="h-px flex-1 bg-primary/40" />
            <span className="font-mono text-[9px] text-primary/60 mx-2 tracking-widest whitespace-nowrap">
              APP.ERR
            </span>
            <div className="h-px flex-1 bg-primary/40" />
          </motion.div>

          {/* The error code — same weight as 404 but smaller, "ERR" */}
          <motion.h1
            className="text-[96px] md:text-[120px] font-black tracking-[-0.04em] leading-none relative"
            style={{
              fontFamily: "'Sora', sans-serif",
              color: "hsl(var(--foreground))",
              letterSpacing: "-0.05em",
            }}
            initial={{ opacity: 0, y: 30, scale: 0.92 }}
            animate={{
              opacity: 1,
              y: 0,
              scale: 1,
              textShadow: [
                "0 0 80px hsl(0 84% 60% / 0.2)",
                "0 0 110px hsl(0 84% 60% / 0.38)",
                "0 0 80px hsl(0 84% 60% / 0.2)",
              ],
            }}
            transition={{
              opacity: { duration: 0.7, ease: [0.16, 1, 0.3, 1] },
              y: { duration: 0.7, ease: [0.16, 1, 0.3, 1] },
              scale: { duration: 0.7, ease: [0.16, 1, 0.3, 1] },
              textShadow: { duration: 3.5, repeat: Infinity, ease: "easeInOut" },
            }}
          >
            ERR
          </motion.h1>

          {/* Cracked foundation — red fault lines */}
          <motion.svg
            className="absolute pointer-events-none"
            style={{ bottom: 28, left: "50%", transform: "translateX(-50%)" }}
            width="320"
            height="40"
            viewBox="0 0 320 40"
            fill="none"
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.35 }}
            transition={{ duration: 1.4, delay: 1 }}
          >
            <motion.path
              d="M10 8 L70 8 L90 28 L150 4 L175 30 L230 10 L260 26 L310 12"
              stroke="hsl(0 84% 60%)"
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeDasharray="3 4"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 1.4, delay: 0.8, ease: "easeOut" }}
            />
          </motion.svg>

          {/* Bottom dimension line */}
          <motion.div
            className="absolute flex items-center"
            style={{ bottom: 10, left: "16%", right: "16%" }}
            initial={{ opacity: 0, scaleX: 0 }}
            animate={{ opacity: 1, scaleX: 1 }}
            transition={{ duration: 0.8, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="h-px flex-1 bg-primary/40" />
            <span className="font-mono text-[9px] text-primary/60 mx-2 tracking-widest whitespace-nowrap">
              UNEXPECTED ERROR
            </span>
            <div className="h-px flex-1 bg-primary/40" />
          </motion.div>
        </div>

        {/* Message block */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="w-full border border-border/60 rounded-md bg-card/50 backdrop-blur-sm p-5 space-y-2"
        >
          <div className="flex items-center gap-2 mb-3">
            <motion.div
              className="w-2 h-2 rounded-full"
              style={{ background: "hsl(0 84% 60%)" }}
              animate={{ scale: [1, 1.4, 1], opacity: [1, 0.6, 1] }}
              transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
            />
            <span className="font-mono text-[10px] text-muted-foreground tracking-widest uppercase">
              Render Error · Site Notice
            </span>
          </div>
          <p className="text-foreground font-semibold text-xl leading-snug">
            Something crashed while rendering this page.
          </p>
          <p className="text-muted-foreground text-sm leading-relaxed">
            An unexpected error stopped the page from loading. This is usually a
            temporary fault — refreshing fixes it in most cases.
          </p>

          {/* Dev-only error detail — same pattern as original */}
          {isDev && (
            <div className="mt-3 border border-border/50 rounded bg-muted/40 p-3">
              <p className="font-mono text-[11px] text-muted-foreground break-all">
                {errorMessage}
              </p>
            </div>
          )}
        </motion.div>

        {/* Actions */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.7, ease: [0.16, 1, 0.3, 1] }}
          className="flex items-center gap-3"
        >
          <motion.button
            onClick={() => window.location.reload()}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            className="group inline-flex items-center gap-3 px-7 py-3 font-semibold rounded-xl text-base transition-shadow duration-200"
            style={{
              background: "hsl(239 84% 67%)",
              color: "#fff",
              boxShadow: "0 4px 24px hsl(239 84% 67% / 0.28)",
              fontFamily: "'DM Sans', sans-serif",
            }}
          >
            <motion.span
              className="text-white/70 group-hover:text-white transition-colors duration-200"
              style={{ fontSize: 16, lineHeight: 1 }}
              animate={{ rotate: [0, 360] }}
              transition={{
                duration: 2,
                repeat: Infinity,
                ease: "linear",
                repeatDelay: 3,
              }}
            >
              ↻
            </motion.span>
            Refresh page
          </motion.button>

          <motion.button
            onClick={() => (window.location.href = "/")}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            className="inline-flex items-center gap-2 px-6 py-3 font-semibold rounded-xl text-base border border-border/60 bg-card/50 text-foreground hover:bg-muted/60 transition-colors duration-200"
            style={{ fontFamily: "'DM Sans', sans-serif" }}
          >
            ← Dashboard
          </motion.button>
        </motion.div>

        {/* Drawing sheet footer */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.9 }}
          className="w-full flex items-center justify-between border-t border-border/30 pt-3"
        >
          <span className="font-mono text-[9px] text-muted-foreground/50 tracking-widest uppercase">
            Scale: N/A
          </span>
          <span className="font-mono text-[9px] text-muted-foreground/50 tracking-widest uppercase">
            Checked: System
          </span>
          <span className="font-mono text-[9px] text-muted-foreground/50 tracking-widest uppercase">
            Status: Crashed
          </span>
        </motion.div>
      </div>
    </div>
  );
}
