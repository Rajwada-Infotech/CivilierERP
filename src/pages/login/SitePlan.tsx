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

/** A building footprint as the plan shows it: its outline (an L, a U, a stepped block…), a hatched service core, and
 *  a dot at each column of its grid that falls inside it. `cells` marks which cells of a cols × rows grid it covers. */
function Footprint({ x, y, cell, cells, core, at }: { x: number; y: number; cell: number; cells: string[]; core: [number, number]; at: number }) {
  const rows = cells.length, cols = cells[0].length;
  const on = (c: number, r: number) => r >= 0 && r < rows && c >= 0 && c < cols && cells[r][c] === "#";
  // The outline: every edge of a filled cell that borders an empty one.
  const edges: string[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (!on(c, r)) continue;
    const X = x + c * cell, Y = y + r * cell;
    if (!on(c, r - 1)) edges.push(`M${X} ${Y} H${X + cell}`);
    if (!on(c, r + 1)) edges.push(`M${X} ${Y + cell} H${X + cell}`);
    if (!on(c - 1, r)) edges.push(`M${X} ${Y} V${Y + cell}`);
    if (!on(c + 1, r)) edges.push(`M${X + cell} ${Y} V${Y + cell}`);
  }
  // Column dots at the grid points touching a filled cell.
  const dots: [number, number][] = [];
  for (let r = 0; r <= rows; r++) for (let c = 0; c <= cols; c++) {
    if (on(c, r) || on(c - 1, r) || on(c, r - 1) || on(c - 1, r - 1)) dots.push([x + c * cell, y + r * cell]);
  }
  const [cc, cr] = core;
  return (
    <g>
      {cells.map((row, r) => row.split("").map((ch, c) => ch === "#" && (
        <motion.rect key={`${r}-${c}`} x={x + c * cell} y={y + r * cell} width={cell} height={cell} fill="rgba(15,51,84,0.04)" {...fade(at)} />
      )))}
      <motion.path d={edges.join(" ")} stroke={INK} strokeWidth={1.5} fill="none" {...draw(at, 1)} />
      <motion.rect x={x + cc * cell + 4} y={y + cr * cell + 4} width={cell - 8} height={cell - 8} fill="url(#ls-plan-hatch)" stroke={INK_2} strokeWidth={1} {...fade(at + 0.6)} />
      <motion.g {...fade(at + 0.8)}>
        {dots.map(([dx, dy], i) => <rect key={i} x={dx - 2} y={dy - 2} width={4} height={4} fill={INK} />)}
      </motion.g>
    </g>
  );
}

/** A tree as the plan draws it: a scalloped canopy around its trunk point. */
function Tree({ x, y, r, at }: { x: number; y: number; r: number; at: number }) {
  const n = 9, pts: string[] = [];
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
    const p0 = [x + r * Math.cos(a0), y + r * Math.sin(a0)], p1 = [x + r * Math.cos(a1), y + r * Math.sin(a1)];
    if (i === 0) pts.push(`M${p0[0].toFixed(1)} ${p0[1].toFixed(1)}`);
    pts.push(`A${(r * 0.36).toFixed(1)} ${(r * 0.36).toFixed(1)} 0 0 1 ${p1[0].toFixed(1)} ${p1[1].toFixed(1)}`);
  }
  return (
    <motion.g {...fade(at)}>
      <path d={pts.join(" ") + " Z"} fill="rgba(28,77,53,0.05)" stroke="rgba(28,77,53,0.26)" strokeWidth={1} />
      <circle cx={x} cy={y} r={1.6} fill="rgba(28,77,53,0.35)" />
    </motion.g>
  );
}

export function SitePlan() {
  return (
    <div className="ls-siteplan absolute inset-0 z-0 pointer-events-none hidden lg:block" aria-hidden>
      <svg viewBox="0 0 600 900" preserveAspectRatio="xMidYMid slice" className="w-full h-full">
        <defs>
          <pattern id="ls-plan-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" stroke="rgba(15,51,84,0.22)" strokeWidth="1" />
          </pattern>
        </defs>
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

        {/* Footprints in the corners: an L-shaped tower and a U-shaped block at the top, a stepped clubhouse and a
            courtyard block at the bottom */}
        <Footprint x={70} y={104} cell={30} cells={["####", "#...", "#..."]} core={[0, 0]} at={0.9} />
        <Footprint x={414} y={92} cell={30} cells={["#.#", "#.#", "###"]} core={[1, 2]} at={1.1} />
        <Footprint x={74} y={606} cell={28} cells={["##..", "###.", "####"]} core={[1, 1]} at={1.3} />
        <Footprint x={428} y={598} cell={28} cells={["###", "#.#", "###"]} core={[0, 0]} at={1.5} />

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
        {[[232, 96, 13], [266, 124, 10], [330, 82, 12], [216, 700, 12], [270, 676, 9], [358, 708, 13], [392, 664, 10]].map(([x, y, r], i) => (
          <Tree key={i} x={x} y={y} r={r} at={1.8 + i * 0.08} />
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
