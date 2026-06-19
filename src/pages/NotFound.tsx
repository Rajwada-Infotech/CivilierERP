import { useLocation, useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { motion } from "framer-motion";
import { useAuth } from "@/contexts/AuthContext";

const NotFound = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { currentUser } = useAuth();

  useEffect(() => {
    console.error(
      "404 Error: User attempted to access non-existent route:",
      location.pathname,
    );
  }, [location.pathname]);

  const handleGoBack = () => {
    if (currentUser) {
      navigate(-1);
    } else {
      navigate("/");
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center overflow-hidden relative font-sans select-none">
      {/* Blueprint grid — tight engineering paper */}
      <svg
        className="absolute inset-0 w-full h-full opacity-[0.07] pointer-events-none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <pattern
            id="smallGrid"
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
            id="bigGrid"
            width="100"
            height="100"
            patternUnits="userSpaceOnUse"
          >
            <rect width="100" height="100" fill="url(#smallGrid)" />
            <path
              d="M 100 0 L 0 0 0 100"
              fill="none"
              stroke="hsl(239,84%,67%)"
              strokeWidth="0.8"
            />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#bigGrid)" />
      </svg>

      {/* Faint radial glow behind center */}
      <div
        className="absolute pointer-events-none"
        style={{
          width: 600,
          height: 600,
          left: "50%",
          top: "50%",
          transform: "translate(-50%, -50%)",
          background:
            "radial-gradient(ellipse at center, hsl(239 84% 67% / 0.08) 0%, transparent 70%)",
          borderRadius: "50%",
        }}
      />

      {/* ── Blueprint scan line sweeping vertically ── */}
      <motion.div
        className="absolute left-0 right-0 h-32 pointer-events-none"
        style={{
          background:
            "linear-gradient(to bottom, transparent, hsl(239 84% 67% / 0.06), transparent)",
        }}
        initial={{ top: "-10%" }}
        animate={{ top: "110%" }}
        transition={{
          duration: 6,
          repeat: Infinity,
          ease: "linear",
          repeatDelay: 1.5,
        }}
      />

      {/* ── Drafting compass, top-left ── */}
      <motion.svg
        className="absolute pointer-events-none opacity-30 hidden md:block"
        style={{ top: "8%", left: "6%" }}
        width="90"
        height="90"
        viewBox="0 0 90 90"
        fill="none"
        animate={{ rotate: 360 }}
        transition={{ duration: 40, repeat: Infinity, ease: "linear" }}
      >
        <circle cx="45" cy="45" r="3" fill="hsl(239 84% 67%)" />
        <line
          x1="45"
          y1="45"
          x2="78"
          y2="20"
          stroke="hsl(239 84% 67%)"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <line
          x1="45"
          y1="45"
          x2="20"
          y2="80"
          stroke="hsl(239 84% 67%)"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <circle cx="20" cy="80" r="2" fill="hsl(239 84% 67%)" />
      </motion.svg>

      {/* ── Set-square / triangle ruler, bottom-right ── */}
      <motion.svg
        className="absolute pointer-events-none opacity-25 hidden md:block"
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
          fill="hsl(239 84% 67% / 0.04)"
        />
        <line
          x1="5"
          y1="30"
          x2="20"
          y2="30"
          stroke="hsl(239 84% 67%)"
          strokeWidth="1"
        />
        <line
          x1="5"
          y1="45"
          x2="20"
          y2="45"
          stroke="hsl(239 84% 67%)"
          strokeWidth="1"
        />
        <line
          x1="5"
          y1="60"
          x2="20"
          y2="60"
          stroke="hsl(239 84% 67%)"
          strokeWidth="1"
        />
        <line
          x1="5"
          y1="75"
          x2="20"
          y2="75"
          stroke="hsl(239 84% 67%)"
          strokeWidth="1"
        />
      </motion.svg>

      {/* ── Crane swinging the "4" block, top-right ── */}
      <div
        className="absolute pointer-events-none hidden lg:block"
        style={{ top: "4%", right: "12%", width: 160, height: 200 }}
      >
        <svg width="160" height="200" viewBox="0 0 160 200" fill="none">
          {/* Mast */}
          <line
            x1="20"
            y1="10"
            x2="20"
            y2="190"
            stroke="hsl(239 84% 67% / 0.35)"
            strokeWidth="2"
          />
          {/* Jib */}
          <line
            x1="20"
            y1="14"
            x2="150"
            y2="14"
            stroke="hsl(239 84% 67% / 0.35)"
            strokeWidth="2"
          />
          {/* Counter jib */}
          <line
            x1="20"
            y1="14"
            x2="0"
            y2="22"
            stroke="hsl(239 84% 67% / 0.35)"
            strokeWidth="2"
          />
          {/* Support cables */}
          <line
            x1="20"
            y1="40"
            x2="120"
            y2="14"
            stroke="hsl(239 84% 67% / 0.2)"
            strokeWidth="1"
          />
          <line
            x1="20"
            y1="40"
            x2="5"
            y2="22"
            stroke="hsl(239 84% 67% / 0.2)"
            strokeWidth="1"
          />

          {/* Swinging hoist + block group */}
          <motion.g
            initial={{ x: 130 }}
            animate={{ x: [130, 70, 130] }}
            transition={{
              duration: 8,
              repeat: Infinity,
              ease: "easeInOut",
            }}
          >
            <line
              x1="0"
              y1="14"
              x2="0"
              y2="70"
              stroke="hsl(239 84% 67% / 0.35)"
              strokeWidth="1.5"
            />
            <motion.g
              animate={{ y: [0, 6, 0] }}
              transition={{
                duration: 2.4,
                repeat: Infinity,
                ease: "easeInOut",
              }}
            >
              <rect
                x="-16"
                y="70"
                width="32"
                height="32"
                rx="4"
                fill="hsl(239 84% 67% / 0.12)"
                stroke="hsl(239 84% 67% / 0.5)"
                strokeWidth="1.5"
              />
              <text
                x="0"
                y="92"
                textAnchor="middle"
                fontSize="18"
                fontWeight="900"
                fill="hsl(239 84% 67% / 0.8)"
                fontFamily="'Sora', sans-serif"
              >
                4
              </text>
            </motion.g>
          </motion.g>
        </svg>
      </div>

      <div className="relative z-10 flex flex-col items-center gap-10 px-6 max-w-xl w-full">
        {/* Drawing sheet header strip */}
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
            DWG-000 · REV 0
          </span>
          <span className="font-mono text-[10px] text-muted-foreground tracking-widest uppercase">
            Error Sheet
          </span>
        </motion.div>

        {/* 404 with dimension lines */}
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
              HEIGHT: ??
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
              ROUTE: NULL
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
              404.00mm
            </span>
            <div className="h-px flex-1 bg-primary/40" />
          </motion.div>

          {/* The 404 itself */}
          <motion.h1
            className="text-[120px] md:text-[150px] font-black tracking-[-0.04em] leading-none relative"
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
                "0 0 80px hsl(239 84% 67% / 0.25)",
                "0 0 110px hsl(239 84% 67% / 0.4)",
                "0 0 80px hsl(239 84% 67% / 0.25)",
              ],
            }}
            transition={{
              opacity: { duration: 0.7, ease: [0.16, 1, 0.3, 1] },
              y: { duration: 0.7, ease: [0.16, 1, 0.3, 1] },
              scale: { duration: 0.7, ease: [0.16, 1, 0.3, 1] },
              textShadow: {
                duration: 3.5,
                repeat: Infinity,
                ease: "easeInOut",
              },
            }}
          >
            404
          </motion.h1>

          {/* Cracked-foundation lines under the 404 */}
          <motion.svg
            className="absolute pointer-events-none"
            style={{ bottom: 28, left: "50%", transform: "translateX(-50%)" }}
            width="320"
            height="40"
            viewBox="0 0 320 40"
            fill="none"
            initial={{ opacity: 0, pathLength: 0 }}
            animate={{ opacity: 0.35, pathLength: 1 }}
            transition={{ duration: 1.4, delay: 1, ease: "easeOut" }}
          >
            <motion.path
              d="M10 8 L70 8 L90 28 L150 4 L175 30 L230 10 L260 26 L310 12"
              stroke="hsl(0 84% 60%)"
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeDasharray="3 4"
            />
          </motion.svg>

          {/* Bottom dimension arrow line */}
          <motion.div
            className="absolute flex items-center"
            style={{ bottom: 10, left: "16%", right: "16%" }}
            initial={{ opacity: 0, scaleX: 0 }}
            animate={{ opacity: 1, scaleX: 1 }}
            transition={{ duration: 0.8, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="h-px flex-1 bg-primary/40" />
            <span className="font-mono text-[9px] text-primary/60 mx-2 tracking-widest whitespace-nowrap">
              NOT FOUND
            </span>
            <div className="h-px flex-1 bg-primary/40" />
          </motion.div>
        </div>

        {/* Message block — styled like a drawing note box */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="w-full border border-border/60 rounded-md bg-card/50 backdrop-blur-sm p-5 space-y-2"
        >
          <div className="flex items-center gap-2 mb-3">
            <motion.div
              className="w-2 h-2 rounded-full bg-primary"
              animate={{ scale: [1, 1.4, 1], opacity: [1, 0.6, 1] }}
              transition={{
                duration: 1.8,
                repeat: Infinity,
                ease: "easeInOut",
              }}
            />
            <span className="font-mono text-[10px] text-muted-foreground tracking-widest uppercase">
              Navigation Error · Site Notice
            </span>
          </div>
          <p className="text-foreground font-semibold text-xl leading-snug">
            This page doesn't exist in the project.
          </p>
          <p className="text-muted-foreground text-sm leading-relaxed">
            The route{" "}
            <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded text-primary">
              {location.pathname}
            </code>{" "}
            wasn't found. It may have been removed, renamed, or you may not have
            access.
          </p>
        </motion.div>

        {/* Action */}
        <motion.button
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.7, ease: [0.16, 1, 0.3, 1] }}
          onClick={handleGoBack}
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
            style={{ fontSize: 18, lineHeight: 1 }}
            animate={{ x: [0, -3, 0] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
          >
            ←
          </motion.span>
          {currentUser ? "Back to Dashboard" : "Go to Login"}
        </motion.button>

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
            Status: Error
          </span>
        </motion.div>
      </div>
    </div>
  );
};

export default NotFound;
