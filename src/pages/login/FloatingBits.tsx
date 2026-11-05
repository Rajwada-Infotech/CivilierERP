// Small drafting marks bobbing around the sign-in form: a level triangle, a grid bubble, a survey cross, a section
// arrow and a dimension tick, in the blueprint blue and the crane's yellow, each at its own pace behind the form.
// Decoration only; they hold still under reduced motion.
import React from "react";
import { motion } from "framer-motion";

type Mark = "level" | "bubble" | "survey" | "section" | "tick";
type Bit = { top: string; left: string; size: number; mark: Mark; color: string; dur: number; delay: number; lift: number };

const BLUE = "rgba(15, 51, 84, 0.32)";
const SAFETY = "rgba(244, 180, 0, 0.7)";
const GREEN = "rgba(28, 77, 53, 0.3)";

// Kept to the edges and corners so they never sit under a field.
const BITS: Bit[] = [
  { top: "6%", left: "8%", size: 18, mark: "level", color: SAFETY, dur: 2.6, delay: 0, lift: 14 },
  { top: "14%", left: "88%", size: 20, mark: "bubble", color: BLUE, dur: 3.0, delay: 0.4, lift: 18 },
  { top: "34%", left: "3%", size: 16, mark: "survey", color: GREEN, dur: 2.4, delay: 0.9, lift: 12 },
  { top: "50%", left: "93%", size: 18, mark: "tick", color: BLUE, dur: 2.8, delay: 0.2, lift: 16 },
  { top: "70%", left: "5%", size: 20, mark: "section", color: BLUE, dur: 3.2, delay: 0.7, lift: 18 },
  { top: "84%", left: "90%", size: 16, mark: "level", color: GREEN, dur: 2.5, delay: 1.1, lift: 14 },
  { top: "93%", left: "16%", size: 14, mark: "survey", color: SAFETY, dur: 2.2, delay: 0.5, lift: 10 },
  { top: "4%", left: "60%", size: 14, mark: "tick", color: GREEN, dur: 2.7, delay: 1.3, lift: 10 },
];

function MarkSvg({ mark, color }: { mark: Mark; color: string }) {
  const p = { fill: "none", stroke: color, strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg viewBox="0 0 20 20" width="100%" height="100%">
      {mark === "level" && <><path d="M4 6 H16 L10 15 Z" {...p} /><path d="M1 15 H19" {...p} /></>}
      {mark === "bubble" && <><circle cx="10" cy="10" r="7.5" {...p} /><path d="M7.5 13 L10 6.5 L12.5 13 M8.4 11 H11.6" {...p} /></>}
      {mark === "survey" && <><circle cx="10" cy="10" r="5" {...p} /><path d="M10 1 V19 M1 10 H19" {...p} /></>}
      {mark === "section" && <><circle cx="8" cy="10" r="6" {...p} /><path d="M2 10 H14 M14 10 L19 10 L16 6" {...p} /></>}
      {mark === "tick" && <path d="M2 10 H18 M5 13 L8 7 M12 13 L15 7" {...p} />}
    </svg>
  );
}

export function FloatingBits() {
  return (
    <div className="ls-bits absolute inset-0 z-0 pointer-events-none" aria-hidden>
      {BITS.map((b, i) => (
        <motion.span
          key={i}
          className="absolute"
          style={{ top: b.top, left: b.left, width: b.size, height: b.size }}
          initial={{ opacity: 0, scale: 0 }}
          animate={{ opacity: 1, scale: 1, y: [0, -b.lift, 0], rotate: b.mark === "tick" || b.mark === "survey" ? [0, 20, 0] : 0 }}
          transition={{
            opacity: { delay: 0.6 + b.delay * 0.3, duration: 0.3 },
            scale: { delay: 0.6 + b.delay * 0.3, type: "spring", stiffness: 400, damping: 12 },
            y: { duration: b.dur, delay: 1 + b.delay, repeat: Infinity, ease: [0.33, 0, 0.2, 1], times: [0, 0.45, 1] },
            rotate: { duration: b.dur * 1.6, delay: 1 + b.delay, repeat: Infinity, ease: "easeInOut" },
          }}
        >
          <MarkSvg mark={b.mark} color={b.color} />
        </motion.span>
      ))}
    </div>
  );
}
