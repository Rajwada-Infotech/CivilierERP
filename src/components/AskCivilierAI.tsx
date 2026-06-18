import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Bot, X, ArrowLeft, ArrowRight, Sparkles } from "lucide-react";
import { useModule } from "@/contexts/ModuleContext";
import {
  type SuggestedQuery,
  getSuggestedQueries,
  getContextLabel,
} from "@/constants/askCivilierQueries";

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

// ─── Floating launcher ─────────────────────────────────────────────────────

export default function AskCivilierAI() {
  const navigate = useNavigate();
  const location = useLocation();
  const { activeModule } = useModule();
  const [stage, setStage] = useState<Stage>("idle");
  const [selected, setSelected] = useState<SuggestedQuery | null>(null);

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
      setStage("teaser");
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
    <div className="fixed left-5 md:left-auto md:right-7 z-[55] flex flex-col items-start md:items-end gap-3" style={{ bottom: "max(1.25rem, env(safe-area-inset-bottom, 1.25rem))" }}>
      {/* ── Panel ── */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 26, scale: 0.93 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 18, scale: 0.95 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="w-[min(90vw,360px)] rounded-2xl border border-border/60 bg-card/95 backdrop-blur-xl shadow-2xl shadow-black/20 overflow-hidden font-body"
          >
            {/* header */}
            <div className="relative flex items-center gap-3 px-4 pt-4 pb-3 border-b border-border/50 bg-gradient-to-br from-primary/6 via-transparent to-cyan-400/6">
              {stage === "list" && (
                <button
                  onClick={() => setStage("teaser")}
                  className="absolute left-2 top-2 p-1.5 rounded-lg hover:bg-muted/50 transition-colors"
                  title="Back"
                >
                  <ArrowLeft size={13} className="text-muted-foreground/50" />
                </button>
              )}
              {stage === "answer" && (
                <button
                  onClick={() => setStage("list")}
                  className="absolute left-2 top-2 p-1.5 rounded-lg hover:bg-muted/50 transition-colors"
                  title="Back to queries"
                >
                  <ArrowLeft size={13} className="text-muted-foreground/50" />
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
                    {contextLabel ? `Try asking · ${contextLabel}` : "Try asking"}
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
                      Got it. CivilierAI is still warming up — once connected,
                      it'll pull this straight from your live data instead of a
                      canned reply. For now, here's where that data lives:
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
        )}
      </AnimatePresence>

      {/* ── Orb ── */}
      <motion.button
        onClick={toggleOrb}
        whileTap={{ scale: 0.92 }}
        className="relative w-12 h-12 rounded-full flex items-center justify-center shrink-0"
        title="CivilierAI"
      >
        {!open && (
          <>
            <motion.span
              className="absolute inset-0 rounded-full bg-gradient-to-br from-primary/50 to-cyan-400/50"
              animate={{ scale: [1, 1.55, 1], opacity: [0.55, 0, 0.55] }}
              transition={{ duration: 2.6, repeat: Infinity, ease: "easeOut" }}
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
    </div>
  );
}
