import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Eye, EyeOff, ShieldCheck } from "lucide-react";
import {
  motion,
  AnimatePresence,
  useMotionValue,
  useTransform,
  useSpring,
} from "framer-motion";

const ROLE_HINTS = import.meta.env.DEV
  ? [
      {
        role: "Super Admin",
        email: "superadmin@civilier.com",
        password: "super123",
        color: "#7c3aed",
      },
      {
        role: "Admin",
        email: "admin@civilier.com",
        password: "admin123",
        color: "#2563eb",
      },
      {
        role: "DB Admin",
        email: "dba@civilier.com",
        password: "dba123",
        color: "#8b5cf6",
      },
      {
        role: "Engineer",
        email: "engineer@civilier.com",
        password: "engineer123",
        color: "#14b8a6",
      },
      {
        role: "Customer",
        email: "customer@civilier.com",
        password: "customer123",
        color: "#f59e0b",
      },
    ]
  : [];

// ── Typewriter hook ────────────────────────────────────────────────────────────
function useTypewriter(words: string[], speed = 80, pause = 2000) {
  const [display, setDisplay] = useState("");
  const [wordIdx, setWordIdx] = useState(0);
  const [charIdx, setCharIdx] = useState(0);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const word = words[wordIdx % words.length];
    let timeout: ReturnType<typeof setTimeout>;

    if (!deleting && charIdx < word.length) {
      timeout = setTimeout(() => setCharIdx((c) => c + 1), speed);
    } else if (!deleting && charIdx === word.length) {
      timeout = setTimeout(() => setDeleting(true), pause);
    } else if (deleting && charIdx > 0) {
      timeout = setTimeout(() => setCharIdx((c) => c - 1), speed / 2);
    } else {
      setDeleting(false);
      setWordIdx((i) => i + 1);
    }

    return () => clearTimeout(timeout);
  }, [charIdx, deleting, wordIdx, words, speed, pause]);

  return display.length === 0
    ? words[wordIdx % words.length].slice(0, charIdx)
    : words[wordIdx % words.length].slice(0, charIdx);
}

// ── Blueprint SVG scene ────────────────────────────────────────────────────────
function CivilScene() {
  return (
    <svg
      viewBox="0 0 800 420"
      xmlns="http://www.w3.org/2000/svg"
      className="w-full h-full"
      style={{ overflow: "visible" }}
    >
      <defs>
        <pattern id="grid" width="30" height="30" patternUnits="userSpaceOnUse">
          <path
            d="M 30 0 L 0 0 0 30"
            fill="none"
            stroke="rgba(124,58,237,0.12)"
            strokeWidth="0.8"
          />
        </pattern>
        <pattern
          id="gridBig"
          width="90"
          height="90"
          patternUnits="userSpaceOnUse"
        >
          <path
            d="M 90 0 L 0 0 0 90"
            fill="none"
            stroke="rgba(124,58,237,0.18)"
            strokeWidth="1.2"
          />
        </pattern>
        <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id="softShadow">
          <feDropShadow
            dx="0"
            dy="4"
            stdDeviation="8"
            floodColor="rgba(124,58,237,0.2)"
          />
        </filter>
      </defs>
      <rect width="800" height="420" fill="url(#grid)" opacity="0.6" />
      <rect width="800" height="420" fill="url(#gridBig)" opacity="0.8" />
      <line
        x1="0"
        y1="370"
        x2="800"
        y2="370"
        stroke="rgba(124,58,237,0.3)"
        strokeWidth="1.5"
        strokeDasharray="8 4"
      />
      <g opacity="0.55">
        <rect
          x="20"
          y="290"
          width="60"
          height="80"
          fill="none"
          stroke="rgba(124,58,237,0.5)"
          strokeWidth="1.2"
        />
        {[300, 320, 340, 360].map((y) => (
          <g key={y}>
            <rect
              x="28"
              y={y}
              width="10"
              height="12"
              fill="none"
              stroke="rgba(124,58,237,0.4)"
              strokeWidth="0.8"
            />
            <rect
              x="44"
              y={y}
              width="10"
              height="12"
              fill="none"
              stroke="rgba(124,58,237,0.4)"
              strokeWidth="0.8"
            />
            <rect
              x="60"
              y={y}
              width="10"
              height="12"
              fill="none"
              stroke="rgba(124,58,237,0.4)"
              strokeWidth="0.8"
            />
          </g>
        ))}
      </g>
      <g opacity="0.6">
        <rect
          x="100"
          y="210"
          width="80"
          height="160"
          fill="none"
          stroke="rgba(124,58,237,0.55)"
          strokeWidth="1.4"
        />
        {[220, 240, 260, 280, 300, 320, 340, 360].map((y) => (
          <g key={y}>
            <rect
              x="108"
              y={y}
              width="12"
              height="14"
              fill="none"
              stroke="rgba(124,58,237,0.35)"
              strokeWidth="0.8"
            />
            <rect
              x="126"
              y={y}
              width="12"
              height="14"
              fill="none"
              stroke="rgba(124,58,237,0.35)"
              strokeWidth="0.8"
            />
            <rect
              x="144"
              y={y}
              width="12"
              height="14"
              fill="none"
              stroke="rgba(124,58,237,0.35)"
              strokeWidth="0.8"
            />
            <rect
              x="162"
              y={y}
              width="12"
              height="14"
              fill="none"
              stroke="rgba(124,58,237,0.35)"
              strokeWidth="0.8"
            />
          </g>
        ))}
        <line
          x1="100"
          y1="210"
          x2="180"
          y2="210"
          stroke="rgba(124,58,237,0.5)"
          strokeWidth="2"
        />
        <rect
          x="120"
          y="198"
          width="40"
          height="12"
          fill="none"
          stroke="rgba(124,58,237,0.4)"
          strokeWidth="1"
        />
      </g>
      <g opacity="0.5">
        <rect
          x="610"
          y="250"
          width="70"
          height="120"
          fill="none"
          stroke="rgba(124,58,237,0.5)"
          strokeWidth="1.2"
        />
        {[260, 278, 296, 314, 332, 350].map((y) => (
          <g key={y}>
            <rect
              x="618"
              y={y}
              width="10"
              height="13"
              fill="none"
              stroke="rgba(124,58,237,0.35)"
              strokeWidth="0.8"
            />
            <rect
              x="634"
              y={y}
              width="10"
              height="13"
              fill="none"
              stroke="rgba(124,58,237,0.35)"
              strokeWidth="0.8"
            />
            <rect
              x="650"
              y={y}
              width="10"
              height="13"
              fill="none"
              stroke="rgba(124,58,237,0.35)"
              strokeWidth="0.8"
            />
            <rect
              x="666"
              y={y}
              width="10"
              height="13"
              fill="none"
              stroke="rgba(124,58,237,0.35)"
              strokeWidth="0.8"
            />
          </g>
        ))}
      </g>
      <g opacity="0.55">
        <rect
          x="700"
          y="200"
          width="85"
          height="170"
          fill="none"
          stroke="rgba(124,58,237,0.55)"
          strokeWidth="1.4"
        />
        {[210, 228, 246, 264, 282, 300, 318, 336, 354].map((y) => (
          <g key={y}>
            <rect
              x="708"
              y={y}
              width="11"
              height="13"
              fill="none"
              stroke="rgba(124,58,237,0.3)"
              strokeWidth="0.8"
            />
            <rect
              x="725"
              y={y}
              width="11"
              height="13"
              fill="none"
              stroke="rgba(124,58,237,0.3)"
              strokeWidth="0.8"
            />
            <rect
              x="742"
              y={y}
              width="11"
              height="13"
              fill="none"
              stroke="rgba(124,58,237,0.3)"
              strokeWidth="0.8"
            />
            <rect
              x="759"
              y={y}
              width="11"
              height="13"
              fill="none"
              stroke="rgba(124,58,237,0.3)"
              strokeWidth="0.8"
            />
            <rect
              x="776"
              y={y}
              width="11"
              height="13"
              fill="none"
              stroke="rgba(124,58,237,0.3)"
              strokeWidth="0.8"
            />
          </g>
        ))}
        <rect
          x="720"
          y="186"
          width="45"
          height="14"
          fill="none"
          stroke="rgba(124,58,237,0.45)"
          strokeWidth="1"
        />
      </g>
      <g filter="url(#softShadow)">
        <rect
          x="378"
          y="80"
          width="10"
          height="290"
          fill="none"
          stroke="rgba(124,58,237,0.8)"
          strokeWidth="2"
        />
        {[80, 120, 160, 200, 240, 280, 320].map((y, i) => (
          <line
            key={y}
            x1={i % 2 === 0 ? 378 : 388}
            y1={y}
            x2={i % 2 === 0 ? 388 : 378}
            y2={y + 40}
            stroke="rgba(124,58,237,0.5)"
            strokeWidth="1"
          />
        ))}
        <rect
          x="388"
          y="82"
          width="200"
          height="8"
          fill="none"
          stroke="rgba(124,58,237,0.8)"
          strokeWidth="1.8"
        />
        {[0, 40, 80, 120, 160].map((x) => (
          <line
            key={x}
            x1={388 + x}
            y1="82"
            x2={388 + x + 40}
            y2="90"
            stroke="rgba(124,58,237,0.45)"
            strokeWidth="1"
          />
        ))}
        <rect
          x="298"
          y="82"
          width="80"
          height="8"
          fill="none"
          stroke="rgba(124,58,237,0.7)"
          strokeWidth="1.8"
        />
        <rect
          x="288"
          y="78"
          width="20"
          height="20"
          fill="none"
          stroke="rgba(124,58,237,0.6)"
          strokeWidth="1.5"
        />
        <rect
          x="372"
          y="68"
          width="22"
          height="18"
          fill="none"
          stroke="rgba(124,58,237,0.9)"
          strokeWidth="1.8"
        />
        <rect
          x="376"
          y="72"
          width="6"
          height="8"
          fill="rgba(124,58,237,0.15)"
          stroke="rgba(124,58,237,0.5)"
          strokeWidth="0.8"
        />
        <rect
          x="384"
          y="72"
          width="6"
          height="8"
          fill="rgba(124,58,237,0.15)"
          stroke="rgba(124,58,237,0.5)"
          strokeWidth="0.8"
        />
        <line
          x1="560"
          y1="90"
          x2="560"
          y2="200"
          stroke="rgba(124,58,237,0.7)"
          strokeWidth="1.5"
          strokeDasharray="4 3"
        >
          <animate
            attributeName="y2"
            values="200;240;200"
            dur="4s"
            repeatCount="indefinite"
            calcMode="spline"
            keySplines="0.4 0 0.6 1;0.4 0 0.6 1"
          />
        </line>
        <g>
          <animateTransform
            attributeName="transform"
            type="translate"
            values="0,0;0,40;0,0"
            dur="4s"
            repeatCount="indefinite"
            calcMode="spline"
            keySplines="0.4 0 0.6 1;0.4 0 0.6 1"
            additive="sum"
          />
          <rect
            x="554"
            y="200"
            width="12"
            height="10"
            fill="none"
            stroke="rgba(124,58,237,0.8)"
            strokeWidth="1.5"
          />
          <path
            d="M 558 210 Q 560 218 562 210"
            fill="none"
            stroke="rgba(124,58,237,0.8)"
            strokeWidth="1.5"
          />
        </g>
        <rect
          x="549"
          y="88"
          width="18"
          height="10"
          fill="rgba(124,58,237,0.1)"
          stroke="rgba(124,58,237,0.7)"
          strokeWidth="1.2"
        >
          <animate
            attributeName="x"
            values="549;440;549"
            dur="8s"
            repeatCount="indefinite"
            calcMode="spline"
            keySplines="0.4 0 0.6 1;0.4 0 0.6 1"
          />
        </rect>
        <line
          x1="383"
          y1="82"
          x2="440"
          y2="140"
          stroke="rgba(124,58,237,0.35)"
          strokeWidth="1"
        />
        <line
          x1="383"
          y1="82"
          x2="500"
          y2="140"
          stroke="rgba(124,58,237,0.3)"
          strokeWidth="1"
        />
        <line
          x1="383"
          y1="82"
          x2="340"
          y2="140"
          stroke="rgba(124,58,237,0.3)"
          strokeWidth="1"
        />
        <rect
          x="358"
          y="368"
          width="50"
          height="8"
          fill="none"
          stroke="rgba(124,58,237,0.7)"
          strokeWidth="2"
        />
        <rect
          x="350"
          y="374"
          width="66"
          height="6"
          fill="none"
          stroke="rgba(124,58,237,0.6)"
          strokeWidth="1.5"
        />
      </g>
      <g opacity="0.4">
        <line
          x1="695"
          y1="200"
          x2="695"
          y2="370"
          stroke="rgba(124,58,237,0.6)"
          strokeWidth="1.5"
        />
        <line
          x1="707"
          y1="200"
          x2="707"
          y2="370"
          stroke="rgba(124,58,237,0.6)"
          strokeWidth="1.5"
        />
        {[200, 230, 260, 290, 320, 350].map((y) => (
          <line
            key={y}
            x1="695"
            y1={y}
            x2="707"
            y2={y}
            stroke="rgba(124,58,237,0.5)"
            strokeWidth="1.2"
          />
        ))}
      </g>
      {[
        [220, 185],
        [560, 60],
        [650, 230],
        [80, 260],
      ].map(([cx, cy], i) => (
        <circle
          key={i}
          cx={cx}
          cy={cy}
          r="3"
          fill="none"
          stroke="rgba(124,58,237,0.5)"
          strokeWidth="1"
        >
          <animate
            attributeName="opacity"
            values="0.3;0.9;0.3"
            dur={`${2.5 + i * 0.7}s`}
            repeatCount="indefinite"
          />
        </circle>
      ))}
    </svg>
  );
}

// ── Scan line ──────────────────────────────────────────────────────────────────
function ScanLine() {
  return (
    <motion.div
      className="absolute left-0 right-0 h-px pointer-events-none z-0"
      style={{
        background:
          "linear-gradient(90deg, transparent 0%, rgba(124,58,237,0.25) 30%, rgba(167,139,250,0.5) 50%, rgba(124,58,237,0.25) 70%, transparent 100%)",
      }}
      initial={{ top: "0%" }}
      animate={{ top: ["0%", "100%", "0%"] }}
      transition={{ duration: 14, repeat: Infinity, ease: "linear" }}
    />
  );
}

// ── Floating particles ─────────────────────────────────────────────────────────
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
    if (type === "bolt")
      return (
        <svg width="12" height="12" viewBox="0 0 12 12">
          <polygon
            points="6,1 10.2,3.5 10.2,8.5 6,11 1.8,8.5 1.8,3.5"
            fill="none"
            stroke="rgba(124,58,237,0.55)"
            strokeWidth="1"
          />
          <circle
            cx="6"
            cy="6"
            r="2"
            fill="none"
            stroke="rgba(124,58,237,0.4)"
            strokeWidth="0.8"
          />
        </svg>
      );
    if (type === "triangle")
      return (
        <svg width="13" height="12" viewBox="0 0 13 12">
          <polygon
            points="6.5,1 12,11 1,11"
            fill="none"
            stroke="rgba(124,58,237,0.5)"
            strokeWidth="1"
          />
          <line
            x1="6.5"
            y1="6"
            x2="6.5"
            y2="11"
            stroke="rgba(124,58,237,0.35)"
            strokeWidth="0.7"
          />
        </svg>
      );
    return (
      <svg width="14" height="10" viewBox="0 0 14 10">
        <rect
          width="14"
          height="10"
          rx="1"
          fill="none"
          stroke="rgba(124,58,237,0.6)"
          strokeWidth="1.2"
        />
        <line
          x1="7"
          y1="0"
          x2="7"
          y2="10"
          stroke="rgba(124,58,237,0.4)"
          strokeWidth="0.8"
        />
        <line
          x1="0"
          y1="5"
          x2="14"
          y2="5"
          stroke="rgba(124,58,237,0.4)"
          strokeWidth="0.8"
        />
      </svg>
    );
  };
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {particles.map((p, i) => (
        <motion.div
          key={i}
          className="absolute bottom-0"
          style={{ left: p.x }}
          initial={{ y: 0, opacity: 0 }}
          animate={{ y: [0, -220, -440], opacity: [0, 0.5, 0] }}
          transition={{
            duration: p.dur,
            delay: p.delay,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        >
          {renderIcon(p.type)}
        </motion.div>
      ))}
    </div>
  );
}

// ── Animated input field ───────────────────────────────────────────────────────
function AnimatedInput({
  label,
  type,
  value,
  onChange,
  placeholder,
  children,
}: {
  label: string;
  type: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder: string;
  children?: React.ReactNode;
}) {
  const [focused, setFocused] = useState(false);
  const hasValue = value.length > 0;

  return (
    <div className="relative group">
      <motion.label
        className="absolute left-4 pointer-events-none font-medium z-10 origin-left"
        style={{
          color: focused ? "rgba(124,58,237,0.9)" : "rgba(100,116,139,0.8)",
        }}
        animate={{
          top: focused || hasValue ? "6px" : "50%",
          y: focused || hasValue ? "0%" : "-50%",
          fontSize: focused || hasValue ? "9px" : "13px",
          letterSpacing: focused || hasValue ? "0.08em" : "0",
          textTransform: focused || hasValue ? "uppercase" : "none",
        }}
        transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
      >
        {label}
      </motion.label>

      {/* animated border */}
      <motion.div
        className="absolute inset-0 rounded-xl pointer-events-none"
        animate={{
          boxShadow: focused
            ? "0 0 0 2px rgba(124,58,237,0.35), 0 0 20px rgba(124,58,237,0.12)"
            : "0 0 0 1.5px rgba(196,181,253,0.5)",
        }}
        transition={{ duration: 0.2 }}
      />

      {/* sweep line on focus */}
      <AnimatePresence>
        {focused && (
          <motion.div
            className="absolute bottom-0 left-4 right-4 h-px rounded-full pointer-events-none"
            style={{
              background:
                "linear-gradient(90deg, transparent, rgba(124,58,237,0.8), transparent)",
            }}
            initial={{ scaleX: 0, opacity: 0 }}
            animate={{ scaleX: 1, opacity: 1 }}
            exit={{ scaleX: 0, opacity: 0 }}
            transition={{ duration: 0.35 }}
          />
        )}
      </AnimatePresence>

      <input
        type={type}
        value={value}
        onChange={onChange}
        placeholder={focused ? placeholder : ""}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className="w-full rounded-xl px-4 pt-6 pb-2.5 text-sm text-slate-800 outline-none transition-colors"
        style={{
          background: focused
            ? "rgba(255,255,255,0.95)"
            : "rgba(255,255,255,0.7)",
          border: "none",
        }}
      />
      {children}
    </div>
  );
}

// ── Shimmer button ─────────────────────────────────────────────────────────────
function ShimmerButton({
  children,
  onClick,
  disabled,
  type = "button",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  const [shimmerX, setShimmerX] = useState(-100);
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    if (!hovered) return;
    let x = -100;
    const interval = setInterval(() => {
      x += 8;
      if (x > 200) x = -100;
      setShimmerX(x);
    }, 16);
    return () => clearInterval(interval);
  }, [hovered]);

  return (
    <motion.button
      type={type}
      disabled={disabled}
      onClick={onClick}
      onHoverStart={() => setHovered(true)}
      onHoverEnd={() => {
        setHovered(false);
        setShimmerX(-100);
      }}
      whileHover={disabled ? {} : { scale: 1.015, y: -2 }}
      whileTap={disabled ? {} : { scale: 0.97, y: 0 }}
      className="relative w-full overflow-hidden rounded-xl py-3.5 font-semibold text-sm text-white disabled:opacity-70 disabled:cursor-not-allowed"
      style={{
        background: "linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%)",
        boxShadow:
          hovered && !disabled
            ? "0 8px 30px rgba(124,58,237,0.45), 0 2px 8px rgba(124,58,237,0.3)"
            : "0 4px 16px rgba(124,58,237,0.3)",
        transition: "box-shadow 0.3s ease",
      }}
    >
      {/* shimmer sweep */}
      {hovered && !disabled && (
        <motion.div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: `linear-gradient(105deg, transparent ${shimmerX - 20}%, rgba(255,255,255,0.18) ${shimmerX}%, rgba(255,255,255,0.08) ${shimmerX + 10}%, transparent ${shimmerX + 30}%)`,
          }}
        />
      )}
      {/* ripple on tap */}
      <span className="relative z-10 flex items-center justify-center gap-2">
        {children}
      </span>
    </motion.button>
  );
}

// ── Password strength bar ──────────────────────────────────────────────────────
function PasswordStrength({ password }: { password: string }) {
  const strength = !password
    ? 0
    : password.length < 4
      ? 1
      : password.length < 7
        ? 2
        : /[A-Z]/.test(password) && /[0-9]/.test(password)
          ? 4
          : 3;

  const colors = ["", "#ef4444", "#f97316", "#eab308", "#22c55e"];
  const labels = ["", "Weak", "Fair", "Good", "Strong"];

  if (!password) return null;

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      className="px-1 pt-1.5"
    >
      <div className="flex gap-1 mb-1">
        {[1, 2, 3, 4].map((i) => (
          <motion.div
            key={i}
            className="h-1 flex-1 rounded-full"
            animate={{
              backgroundColor:
                i <= strength ? colors[strength] : "rgba(203,213,225,0.5)",
            }}
            transition={{ duration: 0.3, delay: i * 0.05 }}
          />
        ))}
      </div>
      <motion.p
        className="text-[10px] font-medium text-right"
        style={{ color: colors[strength] }}
        animate={{ opacity: [0, 1] }}
        key={strength}
      >
        {labels[strength]}
      </motion.p>
    </motion.div>
  );
}

// ── Tilt card wrapper ──────────────────────────────────────────────────────────
function TiltCard({ children }: { children: React.ReactNode }) {
  const cardRef = useRef<HTMLDivElement>(null);
  const rawX = useMotionValue(0);
  const rawY = useMotionValue(0);
  const springConfig = { stiffness: 200, damping: 30 };
  const rotateX = useSpring(
    useTransform(rawY, [-0.5, 0.5], [4, -4]),
    springConfig,
  );
  const rotateY = useSpring(
    useTransform(rawX, [-0.5, 0.5], [-4, 4]),
    springConfig,
  );
  const glareX = useSpring(
    useTransform(rawX, [-0.5, 0.5], [0, 100]),
    springConfig,
  );
  const glareY = useSpring(
    useTransform(rawY, [-0.5, 0.5], [0, 100]),
    springConfig,
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = cardRef.current?.getBoundingClientRect();
      if (!rect) return;
      rawX.set((e.clientX - rect.left) / rect.width - 0.5);
      rawY.set((e.clientY - rect.top) / rect.height - 0.5);
    },
    [rawX, rawY],
  );

  const handleMouseLeave = useCallback(() => {
    rawX.set(0);
    rawY.set(0);
  }, [rawX, rawY]);

  return (
    <motion.div
      ref={cardRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{
        rotateX,
        rotateY,
        transformStyle: "preserve-3d",
        perspective: 1000,
      }}
      className="relative w-full"
    >
      {/* glare overlay */}
      <motion.div
        className="absolute inset-0 rounded-2xl pointer-events-none z-20 overflow-hidden"
        style={{ opacity: 0.06 }}
      >
        <motion.div
          className="absolute w-32 h-32 rounded-full blur-2xl"
          style={{
            background:
              "radial-gradient(circle, rgba(255,255,255,1), transparent)",
            left: useTransform(glareX, (v) => `${v}%`),
            top: useTransform(glareY, (v) => `${v}%`),
            transform: "translate(-50%, -50%)",
          }}
        />
      </motion.div>
      {children}
    </motion.div>
  );
}

// ── Pulsing logo ring ──────────────────────────────────────────────────────────
function LogoRing({ size }: { size: number }) {
  return (
    <div className="relative" style={{ width: size, height: size }}>
      {/* outer pulse rings */}
      {[1, 2, 3].map((i) => (
        <motion.div
          key={i}
          className="absolute inset-0 rounded-full"
          style={{ border: "1px solid rgba(124,58,237,0.3)" }}
          animate={{ scale: [1, 1.3 + i * 0.15], opacity: [0.5, 0] }}
          transition={{
            duration: 2.5,
            delay: i * 0.6,
            repeat: Infinity,
            ease: "easeOut",
          }}
        />
      ))}
      {/* rotating dashed ring */}
      <motion.div
        className="absolute inset-0 rounded-full"
        style={{ border: "1.5px dashed rgba(124,58,237,0.3)" }}
        animate={{ rotate: 360 }}
        transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
      />
      {/* counter rotating dots ring */}
      <motion.div
        className="absolute inset-[-6px] rounded-full"
        style={{ border: "1px dotted rgba(167,139,250,0.4)" }}
        animate={{ rotate: -360 }}
        transition={{ duration: 15, repeat: Infinity, ease: "linear" }}
      />
      <img
        src="/CivilierERP.png"
        alt="CivilierERP"
        className="w-full h-full rounded-full object-contain"
        style={{ filter: "drop-shadow(0 8px 20px rgba(124,58,237,0.4))" }}
      />
    </div>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────────
export default function Login() {
  const [showPass, setShowPass] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [showHints, setShowHints] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loginSuccess, setLoginSuccess] = useState(false);

  const { login } = useAuth();
  const navigate = useNavigate();
  const tagline = useTypewriter(
    [
      "Built for Civil Contractors",
      "Project Insights at a Glance",
      "One Platform. Total Control.",
    ],
    60,
    2400,
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;
    setError("");
    setIsLoading(true);
    try {
      const result = await login(email, password);
      if (result.success) {
        setLoginSuccess(true);
        setTimeout(() => {
          const role = result.role;
          const uid = result.userId ?? "";
          if (role === "customer") navigate(`/customer-portal/${uid}`, { replace: true });
          else if (role === "dba") navigate(`/dba/${uid}`, { replace: true });
          else if (role === "super_admin" || role === "admin")
            navigate(`/admin/dashboard/${uid}`, { replace: true });
          else navigate(`/home/${uid}`, { replace: true });
        }, 700);
      } else {
        setError(result.error || "Invalid email or password.");
        setIsLoading(false);
      }
    } catch {
      setError(
        "Unable to connect. Please check your connection and try again.",
      );
      setIsLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen w-full flex items-center justify-center px-4 py-8 overflow-auto relative"
      style={{
        background:
          "linear-gradient(160deg, #f3e8ff 0%, #ede9fe 30%, #ffffff 65%, #f8f4ff 100%)",
      }}
    >
      {/* Scene */}
      <div className="absolute inset-0 z-0 pointer-events-none">
        <div className="absolute inset-0 flex items-end pb-0">
          <CivilScene />
        </div>
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 60% 70% at 50% 50%, transparent 20%, rgba(243,232,255,0.75) 100%)",
          }}
        />
      </div>
      <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
        <ScanLine />
      </div>
      <FloatingParticles />

      {/* Blobs */}
      <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
        <motion.div
          className="absolute top-[-12%] left-[-8%] w-[45%] h-[45%] rounded-full blur-[100px]"
          style={{ background: "rgba(168,85,247,0.18)" }}
          animate={{ scale: [1, 1.12, 1], opacity: [0.18, 0.28, 0.18] }}
          transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          className="absolute bottom-[-12%] right-[-8%] w-[45%] h-[45%] rounded-full blur-[100px]"
          style={{ background: "rgba(139,92,246,0.14)" }}
          animate={{ scale: [1, 1.15, 1], opacity: [0.14, 0.24, 0.14] }}
          transition={{
            duration: 10,
            repeat: Infinity,
            ease: "easeInOut",
            delay: 2,
          }}
        />
      </div>

      {/* Success overlay */}
      <AnimatePresence>
        {loginSuccess && (
          <motion.div
            className="absolute inset-0 z-50 flex items-center justify-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            style={{
              background: "rgba(243,232,255,0.6)",
              backdropFilter: "blur(8px)",
            }}
          >
            <motion.div
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 300, damping: 20 }}
              className="flex flex-col items-center gap-3"
            >
              <motion.div
                className="w-16 h-16 rounded-full flex items-center justify-center"
                style={{
                  background: "linear-gradient(135deg, #7c3aed, #5b21b6)",
                }}
                animate={{
                  boxShadow: [
                    "0 0 0px rgba(124,58,237,0)",
                    "0 0 40px rgba(124,58,237,0.6)",
                    "0 0 0px rgba(124,58,237,0)",
                  ],
                }}
                transition={{ duration: 1, repeat: Infinity }}
              >
                <motion.svg
                  width="28"
                  height="28"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="white"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  initial={{ pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: 0.5, delay: 0.2 }}
                >
                  <motion.path
                    d="M5 13l4 4L19 7"
                    initial={{ pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ duration: 0.4, delay: 0.1 }}
                  />
                </motion.svg>
              </motion.div>
              <p className="text-sm font-semibold text-purple-700">
                Welcome back!
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Card */}
      <motion.div
        initial={{ opacity: 0, y: 32, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        className="relative z-10 w-full max-w-md"
      >
        <TiltCard>
          {/* Blueprint corners */}
          {[
            "top-0 left-0 border-t-2 border-l-2 rounded-tl-2xl",
            "top-0 right-0 border-t-2 border-r-2 rounded-tr-2xl",
            "bottom-0 left-0 border-b-2 border-l-2 rounded-bl-2xl",
            "bottom-0 right-0 border-b-2 border-r-2 rounded-br-2xl",
          ].map((cls, i) => (
            <motion.div
              key={i}
              className={`absolute w-5 h-5 border-purple-400/40 z-20 ${cls}`}
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{
                delay: 0.4 + i * 0.08,
                duration: 0.4,
                ease: "backOut",
              }}
            />
          ))}

          <div
            className="p-6 sm:p-8 rounded-2xl"
            style={{
              background:
                "linear-gradient(145deg, rgba(255,255,255,0.93) 0%, rgba(248,244,255,0.96) 100%)",
              border: "1px solid rgba(196,181,253,0.4)",
              boxShadow:
                "0 20px 60px rgba(124,58,237,0.1), 0 4px 20px rgba(124,58,237,0.08), inset 0 1px 0 rgba(255,255,255,0.8)",
              backdropFilter: "blur(24px)",
            }}
          >
            {/* Header */}
            <div className="text-center mb-6 sm:mb-8">
              <motion.div
                initial={{ scale: 0.7, opacity: 0, y: 10 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                transition={{
                  delay: 0.2,
                  duration: 0.6,
                  ease: [0.16, 1, 0.3, 1],
                }}
                className="flex flex-col items-center gap-3"
              >
                <LogoRing size={80} />
                <motion.h1
                  className="text-2xl sm:text-3xl font-bold tracking-tight"
                  style={{
                    background:
                      "linear-gradient(135deg,#4c1d95,#7c3aed,#a78bfa)",
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                  }}
                  initial={{ letterSpacing: "0.2em", opacity: 0 }}
                  animate={{ letterSpacing: "-0.01em", opacity: 1 }}
                  transition={{ delay: 0.35, duration: 0.7 }}
                >
                  CivilierERP
                </motion.h1>
              </motion.div>

              {/* Typewriter tagline */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.5 }}
                className="mt-2 text-xs sm:text-sm text-slate-500 h-5 flex items-center justify-center gap-1.5"
              >
                <motion.span
                  className="w-1.5 h-1.5 rounded-full bg-purple-400 inline-block"
                  animate={{ opacity: [1, 0.3, 1] }}
                  transition={{ duration: 1.2, repeat: Infinity }}
                />
                <span>{tagline}</span>
                <motion.span
                  className="inline-block w-0.5 h-3.5 bg-purple-400 ml-0.5"
                  animate={{ opacity: [1, 0] }}
                  transition={{ duration: 0.6, repeat: Infinity }}
                />
              </motion.div>
            </div>

            {/* Form */}
            <motion.form
              className="space-y-4"
              onSubmit={handleSubmit}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4, duration: 0.5 }}
            >
              <AnimatedInput
                label="Email Address"
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setError("");
                }}
                placeholder="name@company.com"
              />

              <div>
                <AnimatedInput
                  label="Password"
                  type={showPass ? "text" : "password"}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setError("");
                  }}
                  placeholder="••••••••"
                >
                  <motion.button
                    type="button"
                    onClick={() => setShowPass(!showPass)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-purple-700 transition-colors p-1"
                    whileTap={{ scale: 0.85, rotate: 15 }}
                  >
                    <AnimatePresence mode="wait">
                      <motion.span
                        key={showPass ? "off" : "on"}
                        initial={{ opacity: 0, rotate: -10, scale: 0.8 }}
                        animate={{ opacity: 1, rotate: 0, scale: 1 }}
                        exit={{ opacity: 0, rotate: 10, scale: 0.8 }}
                        transition={{ duration: 0.15 }}
                      >
                        {showPass ? <EyeOff size={17} /> : <Eye size={17} />}
                      </motion.span>
                    </AnimatePresence>
                  </motion.button>
                </AnimatedInput>
                <AnimatePresence>
                  {password && <PasswordStrength password={password} />}
                </AnimatePresence>
              </div>

              {/* Error */}
              <AnimatePresence>
                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: -6, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -6, scale: 0.97 }}
                    transition={{ type: "spring", stiffness: 400, damping: 25 }}
                    className="px-4 py-2.5 rounded-xl text-sm text-red-600 flex items-center gap-2"
                    style={{
                      background: "rgba(254,226,226,0.7)",
                      border: "1px solid rgba(252,165,165,0.5)",
                    }}
                  >
                    <motion.div
                      animate={{ rotate: [0, -8, 8, -4, 4, 0] }}
                      transition={{ duration: 0.4 }}
                      className="shrink-0"
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                      >
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="8" x2="12" y2="12" />
                        <line x1="12" y1="16" x2="12.01" y2="16" />
                      </svg>
                    </motion.div>
                    {error}
                  </motion.div>
                )}
              </AnimatePresence>

              <ShimmerButton type="submit" disabled={isLoading || loginSuccess}>
                {isLoading ? (
                  <>
                    <motion.div
                      className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white"
                      animate={{ rotate: 360 }}
                      transition={{
                        duration: 0.7,
                        repeat: Infinity,
                        ease: "linear",
                      }}
                    />
                    Signing in…
                  </>
                ) : (
                  <motion.span
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.6 }}
                  >
                    Sign In →
                  </motion.span>
                )}
              </ShimmerButton>
            </motion.form>

            {/* Dev hints */}
            {import.meta.env.DEV && (
              <div className="mt-5">
                <motion.button
                  type="button"
                  onClick={() => setShowHints(!showHints)}
                  className="w-full flex items-center justify-center gap-2 text-xs text-slate-500 hover:text-purple-700 transition-colors"
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <motion.div
                    animate={{ rotate: showHints ? 180 : 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <ShieldCheck size={14} />
                  </motion.div>
                  {showHints
                    ? "Hide demo credentials"
                    : "Show demo credentials"}
                </motion.button>

                <AnimatePresence>
                  {showHints && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="mt-3 space-y-1.5 overflow-hidden"
                    >
                      {ROLE_HINTS.map((h, i) => (
                        <motion.button
                          key={h.email}
                          type="button"
                          onClick={() => {
                            setEmail(h.email);
                            setPassword(h.password);
                            setShowHints(false);
                            setError("");
                          }}
                          initial={{ opacity: 0, x: -12 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: i * 0.06 }}
                          whileHover={{
                            x: 3,
                            backgroundColor: "rgba(255,255,255,0.95)",
                          }}
                          className="w-full flex items-center gap-3 px-3 py-2 rounded-xl border border-slate-200 bg-white/60 transition-colors text-left"
                        >
                          <motion.span
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{ background: h.color }}
                            animate={{ scale: [1, 1.3, 1] }}
                            transition={{
                              duration: 2,
                              delay: i * 0.3,
                              repeat: Infinity,
                            }}
                          />
                          <span className="text-xs font-medium text-slate-700 w-24 sm:w-28 shrink-0">
                            {h.role}
                          </span>
                          <span className="text-xs text-slate-500 truncate flex-1 min-w-0">
                            {h.email}
                          </span>
                          <span className="text-xs font-medium text-slate-400 shrink-0 tracking-widest">
                            {"•".repeat(h.password.length)}
                          </span>
                        </motion.button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}
          </div>
        </TiltCard>
      </motion.div>
    </div>
  );
}
