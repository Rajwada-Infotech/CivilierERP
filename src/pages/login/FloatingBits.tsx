// Small shapes bobbing around the sign-in form: dots, rounded squares and rings in the brand green and the sand of the
// sky, each bouncing at its own pace behind the form. Decoration only; they hold still under reduced motion.
import React from "react";
import { motion } from "framer-motion";

type Bit = { top: string; left: string; size: number; shape: "dot" | "square" | "ring"; color: string; dur: number; delay: number; lift: number };

const GREEN = "rgba(28, 77, 53, 0.22)";
const SAND = "rgba(214, 170, 110, 0.38)";
const SKY = "rgba(120, 160, 180, 0.3)";

// Kept to the edges and corners so they never sit under a field.
const BITS: Bit[] = [
  { top: "6%", left: "8%", size: 14, shape: "dot", color: SAND, dur: 2.4, delay: 0, lift: 16 },
  { top: "14%", left: "88%", size: 18, shape: "ring", color: GREEN, dur: 2.9, delay: 0.4, lift: 20 },
  { top: "34%", left: "3%", size: 10, shape: "square", color: GREEN, dur: 2.2, delay: 0.9, lift: 14 },
  { top: "48%", left: "93%", size: 12, shape: "dot", color: SKY, dur: 2.6, delay: 0.2, lift: 18 },
  { top: "70%", left: "5%", size: 16, shape: "ring", color: SAND, dur: 3.1, delay: 0.7, lift: 22 },
  { top: "84%", left: "90%", size: 12, shape: "square", color: SAND, dur: 2.5, delay: 1.1, lift: 16 },
  { top: "92%", left: "16%", size: 9, shape: "dot", color: GREEN, dur: 2.1, delay: 0.5, lift: 12 },
  { top: "4%", left: "60%", size: 8, shape: "dot", color: SKY, dur: 2.7, delay: 1.3, lift: 12 },
];

export function FloatingBits() {
  return (
    <div className="ls-bits absolute inset-0 z-0 pointer-events-none" aria-hidden>
      {BITS.map((b, i) => (
        <motion.span
          key={i}
          className="absolute"
          style={{
            top: b.top,
            left: b.left,
            width: b.size,
            height: b.size,
            borderRadius: b.shape === "square" ? 4 : 999,
            background: b.shape === "ring" ? "transparent" : b.color,
            border: b.shape === "ring" ? `2.5px solid ${b.color}` : undefined,
          }}
          initial={{ opacity: 0, scale: 0 }}
          animate={{ opacity: 1, scale: 1, y: [0, -b.lift, 0], rotate: b.shape === "square" ? [0, 25, 0] : 0 }}
          transition={{
            opacity: { delay: 0.6 + b.delay * 0.3, duration: 0.3 },
            scale: { delay: 0.6 + b.delay * 0.3, type: "spring", stiffness: 400, damping: 12 },
            // up quickly-ish, a bouncy drop back down, then round again
            y: { duration: b.dur, delay: 1 + b.delay, repeat: Infinity, ease: [0.33, 0, 0.2, 1], times: [0, 0.45, 1] },
            rotate: { duration: b.dur * 1.6, delay: 1 + b.delay, repeat: Infinity, ease: "easeInOut" },
          }}
        />
      ))}
    </div>
  );
}
