// Behind the sign-in form: a faint site plan on the drafting film that draws itself in — the plot boundary with its
// survey stations, the road with its centre line, building footprints with their column grids, contour lines, trees,
// a section callout and a scale bar. It fades out toward the middle so the form stays clean. Decoration only.
import React from "react";
import { motion } from "framer-motion";

const INK = "rgba(15, 51, 84, 0.2)";
const INK_2 = "rgba(15, 51, 84, 0.12)";
const SAFETY = "rgba(214, 150, 0, 0.45)";

const draw = (delay: number, duration = 1.2) => ({
  initial: { pathLength: 0, opacity: 0 },
  animate: { pathLength: 1, opacity: 1 },
  transition: { pathLength: { delay, duration, ease: "easeInOut" as const }, opacity: { delay, duration: 0.01 } },
});
const fade = (delay: number) => ({ initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { delay, duration: 0.6 } });

/** A footprint with its column grid: outline, then the grid inside it. */
function Footprint({ x, y, w, h, cols, rows, at }: { x: number; y: number; w: number; h: number; cols: number; rows: number; at: number }) {
  const grid: string[] = [];
  for (let c = 1; c < cols; c++) grid.push(`M${x + (w / cols) * c} ${y} V${y + h}`);
  for (let r = 1; r < rows; r++) grid.push(`M${x} ${y + (h / rows) * r} H${x + w}`);
  return (
    <g>
      <motion.rect x={x} y={y} width={w} height={h} fill="rgba(15,51,84,0.035)" stroke={INK} strokeWidth={1.4} {...draw(at, 0.9)} />
      <motion.path d={grid.join(" ")} stroke={INK_2} strokeWidth={1} strokeDasharray="5 4" fill="none" {...draw(at + 0.5, 0.9)} />
      <motion.path d={`M${x} ${y} L${x + w} ${y + h} M${x + w} ${y} L${x} ${y + h}`} stroke={INK_2} strokeWidth={0.8} fill="none" {...draw(at + 0.8, 0.7)} />
    </g>
  );
}

export function SitePlan() {
  return (
    <div className="ls-siteplan absolute inset-0 z-0 pointer-events-none hidden lg:block" aria-hidden>
      <svg viewBox="0 0 600 900" preserveAspectRatio="xMidYMid slice" className="w-full h-full">
        {/* Plot boundary with survey stations at its corners */}
        <motion.path d="M36 64 L560 40 L574 418 L548 868 L52 846 L24 452 Z" stroke={INK} strokeWidth={1.6} strokeDasharray="14 5 3 5" fill="none" {...draw(0.3, 2.2)} />
        {[[36, 64], [560, 40], [574, 418], [548, 868], [52, 846], [24, 452]].map(([x, y], i) => (
          <motion.g key={i} {...fade(1 + i * 0.15)}>
            <circle cx={x} cy={y} r={5} fill="none" stroke={SAFETY} strokeWidth={1.2} />
            <path d={`M${x - 9} ${y} H${x + 9} M${x} ${y - 9} V${y + 9}`} stroke={SAFETY} strokeWidth={1} />
            <text x={x + 9} y={y - 8} fill={INK} fontSize={9} fontFamily="Sora, sans-serif">SS{i + 1}</text>
          </motion.g>
        ))}

        {/* Road along the bottom, with its centre line */}
        <motion.path d="M-20 760 C 160 730, 420 790, 640 748" stroke={INK} strokeWidth={1.3} fill="none" {...draw(0.6, 1.6)} />
        <motion.path d="M-20 812 C 160 782, 420 842, 640 800" stroke={INK} strokeWidth={1.3} fill="none" {...draw(0.7, 1.6)} />
        <motion.path d="M-20 786 C 160 756, 420 816, 640 774" stroke={INK_2} strokeWidth={1} strokeDasharray="16 10" fill="none" {...draw(0.9, 1.6)} />
        <motion.text x={470} y={826} fill={INK} fontSize={10} fontFamily="Sora, sans-serif" letterSpacing="0.12em" {...fade(2.2)}>9.00 M ROAD</motion.text>

        {/* Footprints in the corners: towers top left and right, a clubhouse bottom left */}
        <Footprint x={70} y={110} w={120} h={86} cols={4} rows={3} at={0.9} />
        <Footprint x={420} y={96} w={110} h={120} cols={3} rows={4} at={1.1} />
        <Footprint x={78} y={612} w={104} h={74} cols={3} rows={2} at={1.3} />
        <Footprint x={430} y={600} w={96} h={90} cols={3} rows={3} at={1.5} />

        {/* Contours sweeping down the sides */}
        {[0, 1, 2].map((i) => (
          <motion.path key={i} d={`M${-10 + i * 16} ${260 + i * 26} C ${60 + i * 18} ${300 + i * 20}, ${30 + i * 14} ${420 + i * 18}, ${90 + i * 12} ${540 + i * 10}`}
            stroke={INK_2} strokeWidth={1} fill="none" {...draw(1.4 + i * 0.2, 1.6)} />
        ))}
        {[0, 1, 2].map((i) => (
          <motion.path key={i} d={`M${610 - i * 16} ${250 + i * 24} C ${540 - i * 16} ${300 + i * 20}, ${570 - i * 14} ${430 + i * 18}, ${510 - i * 12} ${550 + i * 10}`}
            stroke={INK_2} strokeWidth={1} fill="none" {...draw(1.5 + i * 0.2, 1.6)} />
        ))}

        {/* Trees */}
        {[[230, 92], [262, 118], [330, 80], [218, 700], [268, 676], [360, 706], [392, 664]].map(([x, y], i) => (
          <motion.g key={i} {...fade(1.8 + i * 0.08)}>
            <circle cx={x} cy={y} r={11} fill="rgba(28,77,53,0.05)" stroke="rgba(28,77,53,0.22)" strokeWidth={1} />
            <path d={`M${x - 4} ${y} H${x + 4} M${x} ${y - 4} V${y + 4}`} stroke="rgba(28,77,53,0.22)" strokeWidth={0.8} />
          </motion.g>
        ))}

        {/* A dimension along the top, a section callout and the scale bar */}
        <motion.g {...fade(2)}>
          <path d="M70 232 H190 M70 226 V238 M190 226 V238 M66 236 L74 228 M186 236 L194 228" stroke={INK} strokeWidth={1} />
          <text x={130} y={226} fill={INK} fontSize={9.5} fontFamily="Sora, sans-serif" textAnchor="middle">24.00</text>
          <circle cx={540} cy={300} r={14} fill="none" stroke={INK} strokeWidth={1} />
          <path d="M526 300 H554" stroke={INK} strokeWidth={1} />
          <text x={540} y={296} fill={INK} fontSize={9} fontFamily="Sora, sans-serif" textAnchor="middle">A</text>
          <text x={540} y={310} fill={INK} fontSize={8} fontFamily="Sora, sans-serif" textAnchor="middle">S-2</text>
          <path d="M484 300 H526" stroke={INK} strokeWidth={1} strokeDasharray="6 4" />
        </motion.g>
        <motion.g {...fade(2.3)}>
          {[0, 1, 2, 3].map((i) => <rect key={i} x={72 + i * 24} y={880} width={24} height={5} fill={i % 2 ? "none" : INK} stroke={INK} strokeWidth={1} />)}
          <text x={72} y={874} fill={INK} fontSize={8.5} fontFamily="Sora, sans-serif">0</text>
          <text x={168} y={874} fill={INK} fontSize={8.5} fontFamily="Sora, sans-serif" textAnchor="end">20 m</text>
        </motion.g>
      </svg>
    </div>
  );
}
