import { motion } from "framer-motion";

interface PageLoadErrorProps {
  /** Human-readable reason, e.g. error.message from useQuery */
  message?: string;
  /** Called when the user clicks "Try again" */
  onRetry?: () => void;
}

/**
 * Drop-in replacement for inline loading/error states.
 *
 * Usage with @tanstack/react-query:
 *
 *   const { data, isError, error, refetch } = useQuery(…)
 *   if (isError) return <PageLoadError message={error?.message} onRetry={refetch} />
 *
 * Usage with plain fetch / useState:
 *
 *   if (error) return <PageLoadError message={error} onRetry={loadData} />
 */
const PageLoadError = ({ message, onRetry }: PageLoadErrorProps) => {
  return (
    <div className="min-h-[60vh] bg-background flex items-center justify-center overflow-hidden relative font-sans select-none rounded-2xl">
      {/* Blueprint grid — same as NotFound */}
      <svg
        className="absolute inset-0 w-full h-full opacity-[0.07] pointer-events-none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <pattern
            id="plSmallGrid"
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
            id="plBigGrid"
            width="100"
            height="100"
            patternUnits="userSpaceOnUse"
          >
            <rect width="100" height="100" fill="url(#plSmallGrid)" />
            <path
              d="M 100 0 L 0 0 0 100"
              fill="none"
              stroke="hsl(239,84%,67%)"
              strokeWidth="0.8"
            />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#plBigGrid)" />
      </svg>

      {/* Radial glow — amber tint for "fault" rather than the 404 blue */}
      <div
        className="absolute pointer-events-none"
        style={{
          width: 500,
          height: 500,
          left: "50%",
          top: "50%",
          transform: "translate(-50%, -50%)",
          background:
            "radial-gradient(ellipse at center, hsl(38 92% 60% / 0.07) 0%, transparent 70%)",
          borderRadius: "50%",
        }}
      />

      {/* Sweep scan line */}
      <motion.div
        className="absolute left-0 right-0 h-32 pointer-events-none"
        style={{
          background:
            "linear-gradient(to bottom, transparent, hsl(38 92% 60% / 0.05), transparent)",
        }}
        initial={{ top: "-10%" }}
        animate={{ top: "110%" }}
        transition={{
          duration: 5,
          repeat: Infinity,
          ease: "linear",
          repeatDelay: 2,
        }}
      />

      {/* Broken signal icon — top left, replaces the compass */}
      <motion.svg
        className="absolute pointer-events-none opacity-25 hidden md:block"
        style={{ top: "10%", left: "6%" }}
        width="80"
        height="80"
        viewBox="0 0 80 80"
        fill="none"
        animate={{ opacity: [0.25, 0.12, 0.25] }}
        transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
      >
        {/* Three signal arcs, outermost broken */}
        <path
          d="M15 55 Q40 20 65 55"
          stroke="hsl(38 92% 60%)"
          strokeWidth="2"
          strokeLinecap="round"
          fill="none"
          opacity="0.4"
          strokeDasharray="4 6"
        />
        <path
          d="M22 62 Q40 35 58 62"
          stroke="hsl(38 92% 60%)"
          strokeWidth="2"
          strokeLinecap="round"
          fill="none"
          opacity="0.65"
        />
        <path
          d="M30 68 Q40 52 50 68"
          stroke="hsl(38 92% 60%)"
          strokeWidth="2"
          strokeLinecap="round"
          fill="none"
        />
        <circle cx="40" cy="72" r="3" fill="hsl(38 92% 60%)" />
        {/* Slash through the outer arc — "broken" */}
        <line
          x1="55"
          y1="22"
          x2="68"
          y2="35"
          stroke="hsl(0 84% 60%)"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <line
          x1="68"
          y1="22"
          x2="55"
          y2="35"
          stroke="hsl(0 84% 60%)"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </motion.svg>

      {/* Fault-line diagram — bottom right, replaces the set-square */}
      <motion.svg
        className="absolute pointer-events-none opacity-20 hidden md:block"
        style={{ bottom: "8%", right: "6%" }}
        width="90"
        height="90"
        viewBox="0 0 90 90"
        fill="none"
        animate={{ y: [0, -8, 0] }}
        transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
      >
        <line
          x1="10"
          y1="45"
          x2="35"
          y2="45"
          stroke="hsl(239 84% 67%)"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        {/* Gap = break in the signal */}
        <line
          x1="45"
          y1="45"
          x2="80"
          y2="45"
          stroke="hsl(239 84% 67%)"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <line
          x1="35"
          y1="45"
          x2="45"
          y2="30"
          stroke="hsl(0 84% 60%)"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <line
          x1="45"
          y1="30"
          x2="45"
          y2="45"
          stroke="hsl(0 84% 60%)"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <circle cx="35" cy="45" r="2.5" fill="hsl(239 84% 67%)" />
        <circle cx="45" cy="45" r="2.5" fill="hsl(239 84% 67%)" />
        <text
          x="45"
          y="20"
          textAnchor="middle"
          fontSize="8"
          fill="hsl(0 84% 60%)"
          fontFamily="monospace"
          letterSpacing="1"
        >
          BREAK
        </text>
      </motion.svg>

      {/* ── Main card ── */}
      <div className="relative z-10 flex flex-col items-center gap-8 px-6 max-w-xl w-full">
        {/* Drawing sheet header — same as NotFound */}
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

        {/* Central fault display — replaces the 404 number */}
        <div
          className="relative flex items-center justify-center w-full"
          style={{ height: 160 }}
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
              STATUS: FAULT
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
              DATA: NULL
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
              LOAD.ERR
            </span>
            <div className="h-px flex-1 bg-primary/40" />
          </motion.div>

          {/* Central warning glyph */}
          <motion.div
            className="flex flex-col items-center gap-2"
            initial={{ opacity: 0, y: 20, scale: 0.9 }}
            animate={{
              opacity: 1,
              y: 0,
              scale: 1,
            }}
            transition={{
              opacity: { duration: 0.6, ease: [0.16, 1, 0.3, 1] },
              y: { duration: 0.6, ease: [0.16, 1, 0.3, 1] },
              scale: { duration: 0.6, ease: [0.16, 1, 0.3, 1] },
            }}
          >
            <motion.svg
              width="72"
              height="72"
              viewBox="0 0 72 72"
              fill="none"
              animate={{
                filter: [
                  "drop-shadow(0 0 8px hsl(38 92% 60% / 0.2))",
                  "drop-shadow(0 0 20px hsl(38 92% 60% / 0.5))",
                  "drop-shadow(0 0 8px hsl(38 92% 60% / 0.2))",
                ],
              }}
              transition={{ duration: 2.8, repeat: Infinity, ease: "easeInOut" }}
            >
              <motion.path
                d="M36 8 L64 58 H8 Z"
                stroke="hsl(38 92% 60%)"
                strokeWidth="2"
                fill="hsl(38 92% 60% / 0.08)"
                strokeLinejoin="round"
                initial={{ pathLength: 0, opacity: 0 }}
                animate={{ pathLength: 1, opacity: 1 }}
                transition={{ duration: 1, delay: 0.2, ease: "easeOut" }}
              />
              <motion.line
                x1="36"
                y1="26"
                x2="36"
                y2="44"
                stroke="hsl(38 92% 60%)"
                strokeWidth="2.5"
                strokeLinecap="round"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.8 }}
              />
              <motion.circle
                cx="36"
                cy="50"
                r="2"
                fill="hsl(38 92% 60%)"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.9 }}
              />
            </motion.svg>
          </motion.div>

          {/* Cracked fault line under — red instead of 404's red, same style */}
          <motion.svg
            className="absolute pointer-events-none"
            style={{ bottom: 10, left: "50%", transform: "translateX(-50%)" }}
            width="280"
            height="30"
            viewBox="0 0 280 30"
            fill="none"
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.3 }}
            transition={{ duration: 1.2, delay: 1 }}
          >
            <motion.path
              d="M10 15 L55 15 L70 5 L110 22 L140 8 L190 18 L220 10 L270 15"
              stroke="hsl(38 92% 60%)"
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
            style={{ bottom: 2, left: "16%", right: "16%" }}
            initial={{ opacity: 0, scaleX: 0 }}
            animate={{ opacity: 1, scaleX: 1 }}
            transition={{ duration: 0.8, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="h-px flex-1 bg-primary/40" />
            <span className="font-mono text-[9px] text-primary/60 mx-2 tracking-widest whitespace-nowrap">
              FAILED TO LOAD
            </span>
            <div className="h-px flex-1 bg-primary/40" />
          </motion.div>
        </div>

        {/* Message block — same "drawing note box" style as NotFound */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="w-full border border-border/60 rounded-md bg-card/50 backdrop-blur-sm p-5 space-y-2"
        >
          <div className="flex items-center gap-2 mb-3">
            <motion.div
              className="w-2 h-2 rounded-full"
              style={{ background: "hsl(38 92% 60%)" }}
              animate={{ scale: [1, 1.4, 1], opacity: [1, 0.5, 1] }}
              transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
            />
            <span className="font-mono text-[10px] text-muted-foreground tracking-widest uppercase">
              Data Error · Site Notice
            </span>
          </div>
          <p className="text-foreground font-semibold text-xl leading-snug">
            This section couldn't load its data.
          </p>
          <p className="text-muted-foreground text-sm leading-relaxed">
            {message
              ? "The server returned an error: "
              : "There was a problem reaching the server. Check your connection and try again."}
            {message && (
              <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded text-primary">
                {message}
              </code>
            )}
          </p>
        </motion.div>

        {/* Actions */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.7, ease: [0.16, 1, 0.3, 1] }}
          className="flex items-center gap-3"
        >
          {onRetry && (
            <motion.button
              onClick={onRetry}
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
              Try again
            </motion.button>
          )}
          <motion.button
            onClick={() => window.history.back()}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            className="inline-flex items-center gap-2 px-6 py-3 font-semibold rounded-xl text-base border border-border/60 bg-card/50 text-foreground transition-colors duration-200 hover:bg-muted/60"
            style={{ fontFamily: "'DM Sans', sans-serif" }}
          >
            ← Go back
          </motion.button>
        </motion.div>

        {/* Drawing sheet footer — same as NotFound */}
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
            Status: Load Failed
          </span>
        </motion.div>
      </div>
    </div>
  );
};

export default PageLoadError;
