import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Eye, EyeOff, ShieldCheck } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const ROLE_HINTS = [
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
    role: "User",
    email: "shivam123@gmail.com",
    password: "user123",
    color: "#059669",
  },
  {
    role: "User",
    email: "rahul123@gmail.com",
    password: "user123",
    color: "#d97706",
  },
  {
    role: "User",
    email: "rahul@gmail.com",
    password: "user123",
    color: "#0ea5e9",
  },
];

// ── SVG Scene: crane + buildings + blueprint grid ─────────────────────────────
function CivilScene() {
  return (
    <svg
      viewBox="0 0 800 420"
      xmlns="http://www.w3.org/2000/svg"
      className="w-full h-full"
      style={{ overflow: "visible" }}
    >
      <defs>
        {/* Blueprint grid pattern */}
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

        {/* Glow filter */}
        <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>

        {/* Soft shadow */}
        <filter id="softShadow">
          <feDropShadow
            dx="0"
            dy="4"
            stdDeviation="8"
            floodColor="rgba(124,58,237,0.2)"
          />
        </filter>
      </defs>

      {/* Blueprint grid background */}
      <rect width="800" height="420" fill="url(#grid)" opacity="0.6" />
      <rect width="800" height="420" fill="url(#gridBig)" opacity="0.8" />

      {/* ── Ground line ── */}
      <line
        x1="0"
        y1="370"
        x2="800"
        y2="370"
        stroke="rgba(124,58,237,0.3)"
        strokeWidth="1.5"
        strokeDasharray="8 4"
      />

      {/* ── Building 1 — far left, short ── */}
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

      {/* ── Building 2 — mid left, tall ── */}
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
        {/* Rooftop details */}
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

      {/* ── Building 3 — right side, medium ── */}
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

      {/* ── Building 4 — far right, tall ── */}
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

      {/* ── CRANE — centre stage ── */}
      <g filter="url(#softShadow)">
        {/* Mast */}
        <rect
          x="378"
          y="80"
          width="10"
          height="290"
          fill="none"
          stroke="rgba(124,58,237,0.8)"
          strokeWidth="2"
        />
        {/* Mast cross-bracing */}
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

        {/* Horizontal jib — right */}
        <rect
          x="388"
          y="82"
          width="200"
          height="8"
          fill="none"
          stroke="rgba(124,58,237,0.8)"
          strokeWidth="1.8"
        />
        {/* Jib cross-bracing */}
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

        {/* Counter jib — left */}
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

        {/* Operator cab */}
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

        {/* Hook cable — animated via CSS */}
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

        {/* Hook block */}
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

        {/* Trolley on jib */}
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

        {/* Stay cables */}
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

        {/* Base platform */}
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

      {/* ── Scaffold on right building ── */}
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

      {/* ── Dimension annotation lines ── */}
      <g opacity="0.3">
        <line
          x1="100"
          y1="395"
          x2="180"
          y2="395"
          stroke="rgba(124,58,237,0.6)"
          strokeWidth="1"
          markerEnd="url(#arr)"
        />
        <line
          x1="100"
          y1="390"
          x2="100"
          y2="400"
          stroke="rgba(124,58,237,0.6)"
          strokeWidth="1"
        />
        <line
          x1="180"
          y1="390"
          x2="180"
          y2="400"
          stroke="rgba(124,58,237,0.6)"
          strokeWidth="1"
        />
        <text
          x="140"
          y="408"
          textAnchor="middle"
          fontSize="8"
          fill="rgba(124,58,237,0.6)"
          fontFamily="monospace"
        >
          24.0m
        </text>
      </g>

      {/* ── Floating measurement dots ── */}
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

      {/* ── Corner bracket marks ── */}
      {[
        [10, 10],
        [790, 10],
        [10, 410],
        [790, 410],
      ].map(([x, y], i) => {
        const dx = x < 400 ? 1 : -1;
        const dy = y < 210 ? 1 : -1;
        return (
          <g key={i} opacity="0.4">
            <line
              x1={x}
              y1={y}
              x2={x + dx * 16}
              y2={y}
              stroke="rgba(124,58,237,0.7)"
              strokeWidth="1.5"
            />
            <line
              x1={x}
              y1={y}
              x2={x}
              y2={y + dy * 16}
              stroke="rgba(124,58,237,0.7)"
              strokeWidth="1.5"
            />
          </g>
        );
      })}
    </svg>
  );
}

// ── Blueprint scan line ───────────────────────────────────────────────────────
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

// ── Animated hard hat particles ───────────────────────────────────────────────
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
    { x: "5%", delay: 2.2, dur: 8.5, type: "bolt" },
    { x: "58%", delay: 1.8, dur: 5.5, type: "brick" },
  ];

  const renderIcon = (type: string) => {
    if (type === "bolt") {
      // hex bolt / nut shape
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
    }
    if (type === "triangle") {
      // surveyor triangle / set square
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
          <line
            x1="6.5"
            y1="6"
            x2="12"
            y2="11"
            stroke="rgba(124,58,237,0.35)"
            strokeWidth="0.7"
          />
        </svg>
      );
    }
    // default: brick
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

// ── Main component ─────────────────────────────────────────────────────────────
export default function Login() {
  const [showPass, setShowPass] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [showHints, setShowHints] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

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
        const role = result.role;
        if (role === "dba") {
          navigate("/dba", { replace: true });
        } else if (role === "super_admin" || role === "admin") {
          navigate("/admin/dashboard", { replace: true });
        } else {
          navigate("/home", { replace: true });
        }
      } else {
        setError(result.error || "Invalid email or password.");
      }
    } catch {
      setError(
        "Unable to connect. Please check your connection and try again.",
      );
    } finally {
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
      {/* ── Blueprint scene — fills background ── */}
      <div className="absolute inset-0 z-0 pointer-events-none">
        <div className="absolute inset-0 flex items-end pb-0">
          <CivilScene />
        </div>
        {/* Soft vignette so the form stays readable */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 60% 70% at 50% 50%, transparent 20%, rgba(243,232,255,0.75) 100%)",
          }}
        />
      </div>

      {/* ── Blueprint scan line ── */}
      <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
        <ScanLine />
      </div>

      {/* ── Floating particles ── */}
      <FloatingParticles />

      {/* ── Ambient blobs ── */}
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
        <motion.div
          className="absolute top-[40%] left-[60%] w-[30%] h-[30%] rounded-full blur-[80px]"
          style={{ background: "rgba(109,40,217,0.1)" }}
          animate={{ scale: [1, 1.2, 1], opacity: [0.1, 0.18, 0.1] }}
          transition={{
            duration: 7,
            repeat: Infinity,
            ease: "easeInOut",
            delay: 1,
          }}
        />
        <motion.div
          className="absolute top-[10%] right-[20%] w-[20%] h-[20%] rounded-full blur-[60px]"
          style={{ background: "rgba(196,181,253,0.12)" }}
          animate={{ scale: [1, 1.3, 1], opacity: [0.12, 0.22, 0.12] }}
          transition={{
            duration: 9,
            repeat: Infinity,
            ease: "easeInOut",
            delay: 4,
          }}
        />
      </div>

      {/* ── Login card ── */}
      <motion.div
        initial={{ opacity: 0, y: 28, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.65, ease: [0.16, 1, 0.3, 1] }}
        className="relative z-10 w-full max-w-md"
      >
        {/* Blueprint corner accents on card */}
        {[
          "top-0 left-0 border-t-2 border-l-2 rounded-tl-2xl",
          "top-0 right-0 border-t-2 border-r-2 rounded-tr-2xl",
          "bottom-0 left-0 border-b-2 border-l-2 rounded-bl-2xl",
          "bottom-0 right-0 border-b-2 border-r-2 rounded-br-2xl",
        ].map((cls, i) => (
          <div
            key={i}
            className={`absolute w-5 h-5 border-purple-400/40 ${cls}`}
          />
        ))}

        <div
          className="p-6 sm:p-8 rounded-2xl"
          style={{
            background:
              "linear-gradient(145deg, rgba(255,255,255,0.92) 0%, rgba(248,244,255,0.95) 100%)",
            border: "1px solid rgba(196,181,253,0.4)",
            boxShadow:
              "0 20px 60px rgba(124,58,237,0.1), 0 4px 20px rgba(124,58,237,0.08), inset 0 1px 0 rgba(255,255,255,0.8)",
            backdropFilter: "blur(20px)",
          }}
        >
          {/* Logo + title */}
          <div className="text-center mb-6 sm:mb-8">
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{
                delay: 0.2,
                duration: 0.5,
                ease: [0.16, 1, 0.3, 1],
              }}
              className="flex flex-col items-center gap-3"
            >
              <div className="relative">
                <img
                  src="/CivilierERP.png"
                  alt="CivilierERP Logo"
                  className="w-20 h-20 sm:w-28 sm:h-28 rounded-full object-contain"
                  style={{
                    filter: "drop-shadow(0 10px 24px rgba(124,58,237,0.35))",
                  }}
                />
                {/* Rotating ring */}
                <motion.div
                  className="absolute inset-0 rounded-full"
                  style={{ border: "1.5px dashed rgba(124,58,237,0.3)" }}
                  animate={{ rotate: 360 }}
                  transition={{
                    duration: 20,
                    repeat: Infinity,
                    ease: "linear",
                  }}
                />
              </div>
              <h1
                className="text-2xl sm:text-3xl font-bold font-heading tracking-tight"
                style={{
                  background: "linear-gradient(135deg,#4c1d95,#7c3aed,#a78bfa)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                }}
              >
                CivilierERP
              </h1>
            </motion.div>
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4 }}
              className="mt-2 text-xs sm:text-sm text-slate-500"
            >
              Enterprise Resource Planning — Built for Civil Contractors
            </motion.p>
          </div>

          {/* Form */}
          <motion.form
            className="space-y-4"
            onSubmit={handleSubmit}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35, duration: 0.5 }}
          >
            <div>
              <label className="block text-xs font-medium uppercase tracking-wide mb-1.5 ml-1 text-slate-600">
                Email Address
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setError("");
                }}
                required
                placeholder="name@company.com"
                className="w-full rounded-lg px-4 py-2.5 border border-purple-200 focus:border-purple-400 focus:ring-2 focus:ring-purple-300/50 transition-all bg-white/70 text-slate-800 placeholder:text-slate-400 text-sm outline-none"
              />
            </div>

            <div className="relative">
              <label className="block text-xs font-medium uppercase tracking-wide mb-1.5 ml-1 text-slate-600">
                Password
              </label>
              <input
                type={showPass ? "text" : "password"}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setError("");
                }}
                required
                placeholder="••••••••"
                className="w-full rounded-lg px-4 py-2.5 pr-11 border border-purple-200 focus:border-purple-400 focus:ring-2 focus:ring-purple-300/50 transition-all bg-white/70 text-slate-800 placeholder:text-slate-400 text-sm outline-none"
              />
              <button
                type="button"
                onClick={() => setShowPass(!showPass)}
                className="absolute right-3 top-8 text-slate-400 hover:text-purple-700 transition-colors"
              >
                {showPass ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>

            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className="px-4 py-2.5 rounded-lg bg-red-50 border border-red-200 text-sm text-red-600"
                >
                  {error}
                </motion.div>
              )}
            </AnimatePresence>

            <motion.button
              type="submit"
              disabled={isLoading}
              whileHover={isLoading ? {} : { scale: 1.01, y: -1 }}
              whileTap={isLoading ? {} : { scale: 0.98 }}
              className="w-full py-3 rounded-lg font-semibold text-sm sm:text-base text-white shadow-md transition-shadow duration-200 flex items-center justify-center gap-2 disabled:opacity-80 disabled:cursor-not-allowed"
              style={{
                background: "linear-gradient(135deg,#7c3aed 0%,#5b21b6 100%)",
                boxShadow: "0 4px 16px rgba(124,58,237,0.3)",
              }}
            >
              {isLoading ? (
                <>
                  <svg
                    className="animate-spin h-4 w-4 text-white"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8v8H4z"
                    />
                  </svg>
                  Signing in…
                </>
              ) : (
                "Sign In"
              )}
            </motion.button>
          </motion.form>

          {/* Demo credentials */}
          <div className="mt-5">
            <button
              type="button"
              onClick={() => setShowHints(!showHints)}
              className="w-full flex items-center justify-center gap-2 text-xs text-slate-500 hover:text-purple-700 transition-colors"
            >
              <ShieldCheck size={14} />
              {showHints ? "Hide demo credentials" : "Show demo credentials"}
            </button>

            <AnimatePresence>
              {showHints && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mt-3 space-y-1.5 overflow-hidden"
                >
                  {ROLE_HINTS.map((h) => (
                    <button
                      key={h.email}
                      type="button"
                      onClick={() => {
                        setEmail(h.email);
                        setPassword(h.password);
                        setShowHints(false);
                        setError("");
                      }}
                      className="w-full flex items-center gap-3 px-3 py-2 rounded-lg border border-slate-200 bg-white/60 hover:bg-white/90 transition-all text-left"
                    >
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ background: h.color }}
                      />
                      <span className="text-xs font-medium text-slate-700 w-28 shrink-0">
                        {h.role}
                      </span>
                      <span className="text-xs text-slate-500 truncate">
                        {h.email}
                      </span>
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
