import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Bot, X, ArrowLeft, ArrowRight, Sparkles } from "lucide-react";
import { useModule } from "@/contexts/ModuleContext";
import {
  type SuggestedQuery,
  getSuggestedQueries,
  getContextLabel,
} from "@/constants/askCivilierQueries";

// ─── Genie Lamp SVG ────────────────────────────────────────────────────────
function GenieLamp({ size = 32 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* smoke wisps */}
      <motion.path
        d="M32 18 Q28 10 32 4 Q36 10 32 18"
        stroke="rgba(167,139,250,0.8)"
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: [0, 1, 0] }}
        transition={{ duration: 1, delay: 0.1, ease: "easeOut" }}
      />
      <motion.path
        d="M28 20 Q22 12 26 5 Q31 13 28 20"
        stroke="rgba(196,181,253,0.6)"
        strokeWidth="1.2"
        fill="none"
        strokeLinecap="round"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: [0, 0.8, 0] }}
        transition={{ duration: 1.1, delay: 0.2, ease: "easeOut" }}
      />
      <motion.path
        d="M36 20 Q42 12 38 5 Q33 13 36 20"
        stroke="rgba(196,181,253,0.6)"
        strokeWidth="1.2"
        fill="none"
        strokeLinecap="round"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: [0, 0.8, 0] }}
        transition={{ duration: 1.1, delay: 0.15, ease: "easeOut" }}
      />
      {/* lamp body */}
      <motion.path
        d="M14 38 Q12 30 20 28 L44 28 Q52 28 50 36 L46 48 Q44 52 40 52 L24 52 Q20 52 18 48 Z"
        fill="url(#lampGrad)"
        stroke="rgba(124,58,237,0.6)"
        strokeWidth="1.5"
        initial={{ scale: 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.4, delay: 0.05, ease: [0.16, 1, 0.3, 1] }}
      />
      {/* spout */}
      <motion.path
        d="M14 38 Q8 36 6 30 Q10 26 16 30 L20 28"
        fill="url(#lampGrad)"
        stroke="rgba(124,58,237,0.6)"
        strokeWidth="1.5"
        strokeLinejoin="round"
        initial={{ scale: 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.4, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
      />
      {/* handle */}
      <motion.path
        d="M46 36 Q58 34 58 44 Q58 52 48 50"
        fill="none"
        stroke="rgba(124,58,237,0.6)"
        strokeWidth="2"
        strokeLinecap="round"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ duration: 0.45, delay: 0.2, ease: "easeOut" }}
      />
      {/* shine */}
      <motion.ellipse
        cx="26"
        cy="36"
        rx="5"
        ry="3"
        fill="rgba(255,255,255,0.25)"
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, 1, 0.6] }}
        transition={{ duration: 0.5, delay: 0.35 }}
      />
      <defs>
        <linearGradient
          id="lampGrad"
          x1="6"
          y1="28"
          x2="58"
          y2="56"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#a78bfa" />
          <stop offset="50%" stopColor="#7c3aed" />
          <stop offset="100%" stopColor="#4c1d95" />
        </linearGradient>
      </defs>
    </svg>
  );
}

// ─── Genie burst particles ─────────────────────────────────────────────────
function GenieBurst({ onDone }: { onDone: () => void }) {
  const particles = [
    { angle: 0, dist: 52, color: "#a78bfa", size: 5, delay: 0 },
    { angle: 45, dist: 44, color: "#c4b5fd", size: 4, delay: 0.04 },
    { angle: 90, dist: 56, color: "#7c3aed", size: 6, delay: 0.02 },
    { angle: 135, dist: 40, color: "#e879f9", size: 4, delay: 0.06 },
    { angle: 180, dist: 50, color: "#a78bfa", size: 5, delay: 0.01 },
    { angle: 225, dist: 42, color: "#c4b5fd", size: 3, delay: 0.05 },
    { angle: 270, dist: 54, color: "#7c3aed", size: 5, delay: 0.03 },
    { angle: 315, dist: 46, color: "#f0abfc", size: 4, delay: 0.07 },
    // stars
    { angle: 22, dist: 36, color: "#fde68a", size: 3, delay: 0.08 },
    { angle: 112, dist: 38, color: "#fde68a", size: 3, delay: 0.09 },
    { angle: 202, dist: 34, color: "#fde68a", size: 3, delay: 0.1 },
    { angle: 292, dist: 36, color: "#fde68a", size: 2, delay: 0.11 },
  ];

  useEffect(() => {
    const t = setTimeout(onDone, 900);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <div
      className="absolute inset-0 pointer-events-none"
      style={{ zIndex: 60 }}
    >
      {/* lamp flash */}
      <motion.div
        className="absolute inset-0 rounded-full"
        initial={{ opacity: 0.8, scale: 0.8 }}
        animate={{ opacity: 0, scale: 2.2 }}
        transition={{ duration: 0.45, ease: "easeOut" }}
        style={{
          background:
            "radial-gradient(circle, rgba(167,139,250,0.7) 0%, transparent 70%)",
        }}
      />
      {/* lamp icon */}
      <motion.div
        className="absolute inset-0 flex items-center justify-center"
        initial={{ scale: 0.3, opacity: 0 }}
        animate={{ scale: [0.3, 1.3, 1.1], opacity: [0, 1, 0] }}
        transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
      >
        <GenieLamp size={36} />
      </motion.div>
      {/* burst particles */}
      {particles.map((p, i) => {
        const rad = (p.angle * Math.PI) / 180;
        const tx = Math.cos(rad) * p.dist;
        const ty = Math.sin(rad) * p.dist;
        return (
          <motion.div
            key={i}
            className="absolute rounded-full"
            style={{
              width: p.size,
              height: p.size,
              background: p.color,
              top: "50%",
              left: "50%",
              marginTop: -p.size / 2,
              marginLeft: -p.size / 2,
              boxShadow: `0 0 ${p.size * 2}px ${p.color}`,
            }}
            initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
            animate={{ x: tx, y: ty, opacity: 0, scale: 0.3 }}
            transition={{ duration: 0.65, delay: p.delay, ease: "easeOut" }}
          />
        );
      })}
      {/* trailing smoke wisps upward */}
      {["-6px", "0px", "6px"].map((x, i) => (
        <motion.div
          key={`smoke-${i}`}
          className="absolute rounded-full"
          style={{
            width: 6,
            height: 6,
            background: "rgba(167,139,250,0.5)",
            left: "50%",
            top: "30%",
            marginLeft: x,
          }}
          initial={{ y: 0, opacity: 0.8, scale: 1 }}
          animate={{ y: -28 - i * 8, opacity: 0, scale: 2.5 }}
          transition={{ duration: 0.7, delay: 0.1 + i * 0.08, ease: "easeOut" }}
        />
      ))}
    </div>
  );
}

// ─── Context-aware suggestions ─────────────────────────────────────────────
// AskCivilierAI is mounted once, globally (see AppLayout), so the queries it
// surfaces are resolved per page/module from src/constants/askCivilierQueries.ts
// rather than hardcoded here. Once the in-house LLM is wired up these will
// also be informed by recent context, role, and live module data — but
// `route` is real today, so "Open <module>" always works.

type Stage = "idle" | "teaser" | "list" | "answer";

// ─── Mascot ────────────────────────────────────────────────────────────────
// Tablet pose = assistant "thinking / browsing your data".
// Thumbs-up pose = assistant "got it" confirmation after a query is picked.

function Mascot({ pose, size }: { pose: "tablet" | "thumbsup"; size: number }) {
  return (
    <motion.img
      key={pose}
      src={pose === "tablet" ? "/mascot-tablet.png" : "/mascot-thumbsup.png"}
      alt=""
      initial={{ opacity: 0, scale: 0.8, y: 8 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      style={{ height: size, width: "auto" }}
      className="object-contain drop-shadow-md select-none pointer-events-none"
      draggable={false}
    />
  );
}

// ─── Drag helpers ──────────────────────────────────────────────────────────

const ORB_SIZE = 48; // w-12 h-12
const STORAGE_KEY = "civilierAI_orb_pos";

function clampPos(x: number, y: number) {
  const maxX = window.innerWidth - ORB_SIZE - 8;
  const maxY = window.innerHeight - ORB_SIZE - 8;
  return {
    x: Math.max(8, Math.min(x, maxX)),
    y: Math.max(8, Math.min(y, maxY)),
  };
}

function loadPos() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      return clampPos(p.x, p.y);
    }
  } catch {}
  // default: bottom-right
  return clampPos(
    window.innerWidth - ORB_SIZE - 28,
    window.innerHeight - ORB_SIZE - 20,
  );
}

// ─── Floating launcher ─────────────────────────────────────────────────────

export default function AskCivilierAI() {
  const navigate = useNavigate();
  const location = useLocation();
  const { activeModule } = useModule();
  const [stage, setStage] = useState<Stage>("idle");
  const [selected, setSelected] = useState<SuggestedQuery | null>(null);
  const [bursting, setBursting] = useState(false);

  // ── Drag state ──
  const [orbPos, setOrbPos] = useState<{ x: number; y: number }>(loadPos);
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef<{
    px: number;
    py: number;
    ox: number;
    oy: number;
  } | null>(null);
  const hasMoved = useRef(false);

  // Persist position
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(orbPos));
    } catch {}
  }, [orbPos]);

  // Re-clamp on resize
  useEffect(() => {
    const onResize = () => setOrbPos((p) => clampPos(p.x, p.y));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Pointer drag handlers
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStart.current = {
      px: e.clientX,
      py: e.clientY,
      ox: orbPos.x,
      oy: orbPos.y,
    };
    hasMoved.current = false;
    setIsDragging(false);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragStart.current) return;
    const dx = e.clientX - dragStart.current.px;
    const dy = e.clientY - dragStart.current.py;
    if (!hasMoved.current && Math.hypot(dx, dy) < 4) return;
    hasMoved.current = true;
    setIsDragging(true);
    setOrbPos(clampPos(dragStart.current.ox + dx, dragStart.current.oy + dy));
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const wasClick = !hasMoved.current;
    dragStart.current = null;
    setIsDragging(false);
    if (wasClick) toggleOrb();
  };

  const open = stage !== "idle";

  // Resolved fresh per page/module — see src/constants/askCivilierQueries.ts.
  const suggestedQueries = useMemo(
    () => getSuggestedQueries(location.pathname, activeModule),
    [location.pathname, activeModule],
  );
  const contextLabel = useMemo(
    () => getContextLabel(location.pathname, activeModule),
    [location.pathname, activeModule],
  );

  const toggleOrb = () => {
    if (open) {
      setStage("idle");
      setSelected(null);
    } else {
      setBursting(true);
      // panel opens after burst peaks (~400ms)
      setTimeout(() => setStage("teaser"), 380);
    }
  };

  const goToModule = (q: SuggestedQuery) => {
    setStage("idle");
    setSelected(null);
    navigate(q.route);
  };

  // If the user navigates away (e.g. via the sidebar) while the panel is
  // open, collapse back to the teaser rather than leaving a stale list/
  // answer from the page they just left.
  useEffect(() => {
    setStage((prev) => (prev === "idle" ? prev : "teaser"));
    setSelected(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  return (
    <>
      {/* ── Panel — anchored near the orb ── */}
      <AnimatePresence>
        {open &&
          (() => {
            // Decide whether to open panel above or below, left or right of orb
            const spaceAbove = orbPos.y;
            const spaceLeft = orbPos.x;
            const panelW = Math.min(window.innerWidth * 0.9, 360);
            const panelH = 420; // approximate max panel height
            const above = spaceAbove > panelH + 12;
            const alignRight = spaceLeft + ORB_SIZE / 2 > window.innerWidth / 2;
            return (
              <motion.div
                key="panel"
                initial={{ opacity: 0, y: above ? 16 : -16, scale: 0.93 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: above ? 8 : -8, scale: 0.95 }}
                transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                className="fixed z-[56] w-[min(90vw,360px)] rounded-2xl border border-border/60 bg-card/95 backdrop-blur-xl shadow-2xl shadow-black/20 overflow-hidden font-body"
                style={{
                  ...(above
                    ? { bottom: window.innerHeight - orbPos.y + 8 }
                    : { top: orbPos.y + ORB_SIZE + 8 }),
                  ...(alignRight
                    ? { right: window.innerWidth - orbPos.x - ORB_SIZE }
                    : { left: orbPos.x }),
                }}
              >
                {/* header */}
                <div className="relative flex items-center gap-3 px-4 pt-4 pb-3 border-b border-border/50 bg-gradient-to-br from-primary/6 via-transparent to-cyan-400/6">
                  {stage === "list" && (
                    <button
                      onClick={() => setStage("teaser")}
                      className="absolute left-2 top-2 p-1.5 rounded-lg hover:bg-muted/50 transition-colors"
                      title="Back"
                    >
                      <ArrowLeft
                        size={13}
                        className="text-muted-foreground/50"
                      />
                    </button>
                  )}
                  {stage === "answer" && (
                    <button
                      onClick={() => setStage("list")}
                      className="absolute left-2 top-2 p-1.5 rounded-lg hover:bg-muted/50 transition-colors"
                      title="Back to queries"
                    >
                      <ArrowLeft
                        size={13}
                        className="text-muted-foreground/50"
                      />
                    </button>
                  )}
                  <button
                    onClick={toggleOrb}
                    className="absolute right-2 top-2 p-1.5 rounded-lg hover:bg-muted/50 transition-colors"
                    title="Close"
                  >
                    <X size={13} className="text-muted-foreground/50" />
                  </button>

                  <div className="flex-1 flex items-center gap-3 pl-5 pr-5">
                    <div className="min-w-0">
                      <p className="font-heading font-bold text-[13px] text-foreground tracking-tight">
                        CivilierAI
                      </p>
                      <p className="text-[10px] text-muted-foreground/55 font-medium leading-tight">
                        {stage === "answer"
                          ? "Noted — thanks!"
                          : "In-house assistant · preview"}
                      </p>
                    </div>
                    <div className="shrink-0 -my-1">
                      <AnimatePresence mode="wait">
                        <Mascot
                          pose={stage === "answer" ? "thumbsup" : "tablet"}
                          size={
                            stage === "teaser" ? 44 : stage === "list" ? 52 : 60
                          }
                        />
                      </AnimatePresence>
                    </div>
                  </div>
                </div>

                {/* body */}
                <AnimatePresence mode="wait">
                  {stage === "teaser" && (
                    <motion.div
                      key="teaser"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="px-4 py-4"
                    >
                      <p className="text-xs text-muted-foreground/70 leading-relaxed mb-3.5">
                        {contextLabel
                          ? `Hi! I'll soon be able to answer questions about your live ${contextLabel} data — right here, wherever you are in CivilierERP.`
                          : "Hi! I'll soon be able to answer questions about your live Finance, Material, Engineering and Followup data — right here, wherever you are in CivilierERP."}
                      </p>
                      <button
                        onClick={() => setStage("list")}
                        className="w-full flex items-center justify-center gap-2 rounded-xl bg-primary text-primary-foreground text-xs font-heading font-bold tracking-tight py-2.5 hover:opacity-90 transition-opacity"
                      >
                        <Sparkles size={13} />
                        Show smart queries
                      </button>
                    </motion.div>
                  )}

                  {stage === "list" && (
                    <motion.div
                      key="list"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="px-3 py-3 max-h-[340px] overflow-y-auto"
                    >
                      <p className="px-1.5 pb-2 text-[10px] font-heading font-bold uppercase tracking-[0.18em] text-muted-foreground/45">
                        {contextLabel
                          ? `Try asking · ${contextLabel}`
                          : "Try asking"}
                      </p>
                      <div className="flex flex-col gap-1.5">
                        {suggestedQueries.map((q, i) => (
                          <motion.button
                            key={q.id}
                            initial={{ opacity: 0, y: -14 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{
                              duration: 0.4,
                              delay: i * 0.08,
                              ease: [0.16, 1, 0.3, 1],
                            }}
                            onClick={() => {
                              setSelected(q);
                              setStage("answer");
                            }}
                            className="group flex items-center gap-2.5 rounded-xl border border-border/50 bg-muted/20 hover:bg-muted/40 hover:border-border px-3 py-2.5 text-left transition-colors"
                          >
                            <div
                              className="p-1.5 rounded-lg shrink-0"
                              style={{ background: `${q.accent}18` }}
                            >
                              <q.icon size={12} style={{ color: q.accent }} />
                            </div>
                            <span className="text-[11.5px] font-medium text-foreground/85 leading-snug">
                              {q.label}
                            </span>
                          </motion.button>
                        ))}
                      </div>
                    </motion.div>
                  )}

                  {stage === "answer" && selected && (
                    <motion.div
                      key="answer"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="px-4 py-4"
                    >
                      <div className="flex items-start gap-2.5 mb-3">
                        <div
                          className="p-1.5 rounded-lg shrink-0 mt-0.5"
                          style={{ background: `${selected.accent}18` }}
                        >
                          <selected.icon
                            size={12}
                            style={{ color: selected.accent }}
                          />
                        </div>
                        <p className="text-[11.5px] font-semibold text-foreground/80 leading-snug">
                          {selected.label}
                        </p>
                      </div>
                      <div className="rounded-xl border border-border/50 bg-muted/20 px-3.5 py-3">
                        <p className="text-[11px] text-muted-foreground/75 leading-relaxed">
                          Got it. CivilierAI is still warming up — once
                          connected, it'll pull this straight from your live
                          data instead of a canned reply. For now, here's where
                          that data lives:
                        </p>
                      </div>
                      <button
                        onClick={() => goToModule(selected)}
                        style={{ background: selected.accent }}
                        className="mt-3 w-full flex items-center justify-center gap-1.5 rounded-xl text-white text-[11.5px] font-heading font-bold tracking-tight py-2.5 hover:opacity-90 transition-opacity"
                      >
                        Open {selected.module}
                        <ArrowRight size={13} />
                      </button>
                      <button
                        onClick={() => setStage("list")}
                        className="mt-2 w-full rounded-xl border border-border/60 text-[11px] font-heading font-bold tracking-tight py-2 text-muted-foreground/70 hover:bg-muted/30 transition-colors"
                      >
                        Ask another
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })()}
      </AnimatePresence>

      {/* ── Orb — draggable ── */}
      <motion.div
        className="fixed z-[57]"
        style={{ left: orbPos.x, top: orbPos.y, touchAction: "none" }}
        animate={{ scale: isDragging ? 1.08 : 1 }}
        transition={{ duration: 0.15 }}
      >
        {!open && !isDragging && (
          <motion.div
            className="absolute -inset-1 rounded-full border border-primary/20"
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 0.6, 0] }}
            transition={{ duration: 3, repeat: Infinity, delay: 4 }}
          />
        )}
        <motion.button
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          whileTap={{ scale: isDragging ? 1 : 0.92 }}
          className="relative w-12 h-12 rounded-full flex items-center justify-center shrink-0 select-none"
          title="CivilierAI — drag to move"
          style={{ cursor: isDragging ? "grabbing" : "grab" }}
        >
          <AnimatePresence>
            {bursting && <GenieBurst onDone={() => setBursting(false)} />}
          </AnimatePresence>

          {!open && (
            <>
              <motion.span
                className="absolute inset-0 rounded-full bg-gradient-to-br from-primary/50 to-cyan-400/50"
                animate={{ scale: [1, 1.55, 1], opacity: [0.55, 0, 0.55] }}
                transition={{
                  duration: 2.6,
                  repeat: Infinity,
                  ease: "easeOut",
                }}
              />
              <motion.span
                className="absolute inset-0 rounded-full bg-gradient-to-br from-primary/40 to-violet-400/40"
                animate={{ scale: [1, 1.55, 1], opacity: [0.45, 0, 0.45] }}
                transition={{
                  duration: 2.6,
                  repeat: Infinity,
                  ease: "easeOut",
                  delay: 1.0,
                }}
              />
            </>
          )}
          <motion.span
            animate={!open ? { scale: [1, 1.06, 1] } : { scale: 1 }}
            transition={{
              duration: 2.6,
              repeat: open ? 0 : Infinity,
              ease: "easeInOut",
            }}
            className="relative w-full h-full rounded-full flex items-center justify-center bg-gradient-to-br from-primary via-violet-500 to-cyan-400 shadow-lg shadow-primary/30 border border-white/10"
          >
            <AnimatePresence mode="wait" initial={false}>
              {open ? (
                <motion.span
                  key="x"
                  initial={{ opacity: 0, rotate: -45 }}
                  animate={{ opacity: 1, rotate: 0 }}
                  exit={{ opacity: 0, rotate: 45 }}
                  transition={{ duration: 0.2 }}
                >
                  <X size={20} className="text-white" />
                </motion.span>
              ) : (
                <motion.span
                  key="bot"
                  initial={{ opacity: 0, rotate: 45 }}
                  animate={{ opacity: 1, rotate: 0 }}
                  exit={{ opacity: 0, rotate: -45 }}
                  transition={{ duration: 0.2 }}
                >
                  <Bot size={20} className="text-white" />
                </motion.span>
              )}
            </AnimatePresence>
          </motion.span>
        </motion.button>
      </motion.div>
    </>
  );
}
