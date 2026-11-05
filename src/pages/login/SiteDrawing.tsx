// Right of the sign-in page: a construction drawing on blueprint that draws itself. The ground and the earth hatch go
// in, the footings, then the columns rise and the floors are cast one above another, each with its level mark; the
// tower crane goes up beside it and hoists the three girders waiting in the yard onto the roof one by one, then parks;
// then the view zooms out to the board the sheet is pinned on (two engineers in front of it), pans to the next sheet —
// the typical floor plan of a residential tower — and zooms into it while it draws itself (walls, the lift and stair
// core, each flat's rooms, doors, windows and names) and its flats are booked one by one; then it keeps moving between
// the two. The crane's warning lights blink and the building's windows light up. A gyrocompass
// gives north. The sheet has a drawing border with zone marks and a title block holding the company's figures.
// On phones the same drawing fills the screen behind the form (SiteBackdrop). Everything is still under reduced
// motion (MotionConfig on the page) apart from the line drawing, which just completes.
import React, { useEffect, useRef, useState } from "react";
import { animate, motion, useMotionValue, useReducedMotion } from "framer-motion";
import type { PublicStats } from "./config";
import { FLOW, cascade, pop } from "./motion";

// ── Geometry (viewBox 800 × 900) ──────────────────────────────────────────────
const GL = 700;                      // ground level
const FLOORS = 6;
const FH = 62;                       // floor height
const COLS = [300, 365, 430, 495, 560];
const TOP = GL - FLOORS * FH;        // roof
const MAST = 650;                    // crane mast x
const JIB_Y = 172;                   // crane jib
const PICK_X = 196;                  // where beams wait in the yard
const DROP_X = 430;                  // where they land on the roof

const LINE = "#dcecff";
const SOFT = "rgba(190, 220, 255, 0.45)";
const FAINT = "rgba(190, 220, 255, 0.22)";
const SAFETY = "#f4b400";            // the crane, like the real thing

const T0 = 0.5;                      // when the drawing starts
const FLOOR_AT = (i: number) => T0 + 1.5 + i * 0.32;
const BUILT = FLOOR_AT(FLOORS) + 0.2;
const CRANE_AT = T0 + 1.1;
const LIFT_AT = BUILT + 0.6;

const draw = (delay: number, duration = 0.7) => ({
  initial: { pathLength: 0, opacity: 0 },
  animate: { pathLength: 1, opacity: 1 },
  transition: { pathLength: { delay, duration, ease: "easeInOut" as const }, opacity: { delay, duration: 0.01 } },
});
const appear = (delay: number, duration = 0.35) => ({
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  transition: { delay, duration },
});

/** The crane's three lifts, one after another: lower onto the top girder of the pile, take it (only then does it leave
 *  the pile), hoist, trolley across, set it on the roof where it stays, return for the next; after the last it parks by
 *  the mast. One timeline drives trolley, cable and load so they stay together. */
const LIFT = 9;                                  // seconds per lift
const GIRDERS = 3;
const TOTAL = LIFT * GIRDERS;
const END = LIFT_AT + TOTAL;                     // when the last girder is set and the crane parks
// Girder i of the pile (0 at the bottom) has its top at GL-9-9i; the load hangs 26 below the hook.
const pileTop = (i: number) => GL - 9 - 9 * i;
const atPile = (i: number) => pileTop(i) - 26;
// Set on the parapet (its top at TOP-17), side by side across the roof.
const ROOF_X = [DROP_X - 72, DROP_X, DROP_X + 72];
const AT_ROOF = TOP - 17 - 35;
const HOIST_Y = 250;
const PARK_X = MAST - 46;
const PARK_Y = JIB_Y + 40;
// Within a lift (0..1): over the pile, down, take it, hoist, across, down, let go, up, back (or park).
const SEG = [0, 0.12, 0.2, 0.34, 0.52, 0.64, 0.72, 0.8, 0.92, 1];
const PICK_T = 0.2;
const DROP_T = 0.72;

function liftTimeline() {
  const times: number[] = [], trolley: number[] = [], hook: number[] = [];
  for (let k = 0; k < GIRDERS; k++) {
    const g = GIRDERS - 1 - k;                   // the top girder goes first
    const last = k === GIRDERS - 1;
    const x = ROOF_X[k];
    const tx = [PICK_X, PICK_X, PICK_X, PICK_X, x, x, x, x, last ? PARK_X : PICK_X, last ? PARK_X : PICK_X];
    const hy = [GL - 130, atPile(g), atPile(g), HOIST_Y, HOIST_Y, AT_ROOF, AT_ROOF, TOP - 90, last ? PARK_Y : TOP - 90, last ? PARK_Y : GL - 130];
    SEG.forEach((t, j) => {
      if (k > 0 && j === 0) return;              // the previous lift ended where this one starts
      times.push((k + t) / GIRDERS); trolley.push(tx[j]); hook.push(hy[j]);
    });
  }
  return { times, trolley, hook };
}
const TL = liftTimeline();
/** A 0/1 switch at the given fractions of the lifts' timeline (on at `on`, off at `off`). */
const step = (on: number | null, off: number | null) => {
  const values: number[] = [], times: number[] = [];
  const startOn = on == null;
  values.push(startOn ? 1 : 0); times.push(0);
  if (on != null) { values.push(0, 1); times.push(on, on + 0.0005); }
  if (off != null) { values.push(1, 0); times.push(off, off + 0.0005); }
  values.push(off != null ? 0 : 1); times.push(1);
  return { values, times };
};
const pickAt = (k: number) => (k + PICK_T) / GIRDERS;
const dropAt = (k: number) => (k + DROP_T) / GIRDERS;
const once = (times: number[], ease: "linear" | "easeInOut" = "linear") => ({ duration: TOTAL, times, ease, delay: LIFT_AT });

function Crane() {
  const still = useReducedMotion();
  const hook = useMotionValue(still ? PARK_Y : GL - 130);
  useEffect(() => {
    if (still) return;
    const c = animate(hook, TL.hook, once(TL.times, "easeInOut"));
    return () => c.stop();
  }, [still, hook]);
  const lattice: string[] = [];
  for (let y = GL; y > JIB_Y + 14; y -= 22) lattice.push(`M${MAST - 9} ${y} L${MAST + 9} ${y - 22} M${MAST + 9} ${y} L${MAST - 9} ${y - 22}`);
  const jibLattice: string[] = [];
  for (let x = MAST - 12; x > 150; x -= 24) jibLattice.push(`M${x} ${JIB_Y} L${x - 12} ${JIB_Y + 12} L${x - 24} ${JIB_Y}`);
  // The load on the hook: on between taking each girder and letting it go.
  const load = (() => {
    const values: number[] = [0], times: number[] = [0];
    for (let k = 0; k < GIRDERS; k++) { values.push(0, 1, 1, 0); times.push(pickAt(k), pickAt(k) + 0.0005, dropAt(k), dropAt(k) + 0.0005); }
    values.push(0); times.push(1);
    return { values, times };
  })();
  const girderRect = (x: number, y: number, strong = false) => (
    <rect x={x - 36} y={y} width={72} height={9} fill={strong ? "rgba(244,180,0,0.35)" : "rgba(244,180,0,0.18)"} stroke={SAFETY} strokeOpacity={strong ? 1 : 0.7} strokeWidth={strong ? 1.2 : 1} />
  );

  return (
    <g>
      {/* Base, mast and its lattice */}
      <motion.rect x={MAST - 26} y={GL - 10} width={52} height={10} fill="none" stroke={SAFETY} strokeWidth={1.5} {...draw(CRANE_AT, 0.4)} />
      <motion.path d={`M${MAST - 9} ${GL} V${JIB_Y + 14} M${MAST + 9} ${GL} V${JIB_Y + 14}`} stroke={SAFETY} strokeWidth={2} fill="none" {...draw(CRANE_AT + 0.2, 1.1)} />
      <motion.path d={lattice.join(" ")} stroke={SAFETY} strokeOpacity={0.55} strokeWidth={1} fill="none" {...draw(CRANE_AT + 0.5, 1.2)} />
      {/* Cab, apex and ties */}
      <motion.rect x={MAST - 14} y={JIB_Y + 14} width={28} height={20} fill="rgba(244,180,0,0.15)" stroke={SAFETY} strokeWidth={1.5} {...appear(CRANE_AT + 1.3)} />
      <motion.path d={`M${MAST} ${JIB_Y - 52} L${MAST - 10} ${JIB_Y} M${MAST} ${JIB_Y - 52} L${MAST + 10} ${JIB_Y}`} stroke={SAFETY} strokeWidth={1.8} fill="none" {...draw(CRANE_AT + 1.3, 0.4)} />
      <motion.path d={`M${MAST} ${JIB_Y - 52} L160 ${JIB_Y} M${MAST} ${JIB_Y - 52} L748 ${JIB_Y}`} stroke={SAFETY} strokeOpacity={0.7} strokeWidth={1} fill="none" {...draw(CRANE_AT + 1.6, 0.7)} />
      {/* Jib and counter-jib with its weights */}
      <motion.path d={`M748 ${JIB_Y} H160 M748 ${JIB_Y + 12} H160 L160 ${JIB_Y}`} stroke={SAFETY} strokeWidth={1.8} fill="none" {...draw(CRANE_AT + 1.4, 0.9)} />
      <motion.path d={jibLattice.join(" ")} stroke={SAFETY} strokeOpacity={0.5} strokeWidth={1} fill="none" {...draw(CRANE_AT + 1.8, 0.9)} />
      <motion.rect x={712} y={JIB_Y + 12} width={30} height={26} fill="rgba(244,180,0,0.22)" stroke={SAFETY} strokeWidth={1.2} {...appear(CRANE_AT + 2.2)} />

      {/* The girders: three in the yard, each leaving the pile only when the hook takes it, and staying on the roof
          where it's set */}
      <motion.g {...appear(CRANE_AT + 2.4)}>
        {Array.from({ length: GIRDERS }, (_, g) => {
          const k = GIRDERS - 1 - g;               // lift that takes it
          const sw = step(null, pickAt(k));
          return (
            <motion.g key={`pile-${g}`} animate={still ? { opacity: 0 } : { opacity: sw.values }} transition={still ? { duration: 0 } : once(sw.times)}>
              {girderRect(PICK_X, pileTop(g))}
            </motion.g>
          );
        })}
      </motion.g>
      {ROOF_X.map((x, k) => {
        const sw = step(dropAt(k), null);
        return (
          <motion.g key={`roof-${k}`} initial={{ opacity: still ? 1 : 0 }} animate={still ? { opacity: 1 } : { opacity: sw.values }} transition={still ? { duration: 0 } : once(sw.times)}>
            {girderRect(x, TOP - 26, true)}
          </motion.g>
        );
      })}

      {/* Trolley, cable, hook and the girder it carries */}
      <motion.g {...appear(LIFT_AT - 0.3)}>
        <motion.g initial={{ x: still ? PARK_X : PICK_X }} animate={still ? { x: PARK_X } : { x: TL.trolley }} transition={still ? { duration: 0 } : once(TL.times, "easeInOut")}>
          <rect x={-9} y={JIB_Y + 12} width={18} height={7} fill={SAFETY} />
          <motion.line x1={0} y1={JIB_Y + 19} x2={0} y2={hook} stroke={LINE} strokeWidth={1} />
          <motion.g style={{ y: hook }}>
            <path d="M-5 0 H5 L3 7 H-3 Z M0 7 V12 a4 4 0 1 0 4 -2" stroke={LINE} strokeWidth={1.4} fill="none" />
            {!still && (
              <motion.g initial={{ opacity: 0 }} animate={{ opacity: load.values }} transition={once(load.times)}>
                <path d="M0 14 L-26 26 M0 14 L26 26" stroke={SOFT} strokeWidth={1} />
                <rect x={-36} y={26} width={72} height={9} fill="rgba(244,180,0,0.35)" stroke={SAFETY} strokeWidth={1.2} />
                <path d="M-36 30.5 H36" stroke={SAFETY} strokeOpacity={0.6} strokeWidth={0.8} />
              </motion.g>
            )}
          </motion.g>
        </motion.g>
      </motion.g>

      {/* Once it's parked: the aircraft-warning lights at the apex and the jib tip blink */}
      {[[MAST, JIB_Y - 57], [160, JIB_Y - 5], [748, JIB_Y - 5]].map(([cx, cy], i) => (
        <motion.circle key={i} cx={cx} cy={cy} r={3.2} fill="#ff4d4d"
          initial={{ opacity: 0 }}
          animate={still ? { opacity: 0.9 } : { opacity: [0, 1, 0.15, 1, 0.15] }}
          transition={still ? { duration: 0 } : { delay: END + 0.4 + i * 0.35, duration: 2.4, times: [0, 0.1, 0.5, 0.6, 1], repeat: Infinity, ease: "easeInOut" }} />
      ))}
    </g>
  );
}

function Building() {
  const still = useReducedMotion();
  const width = COLS[COLS.length - 1] - COLS[0];
  return (
    <g>
      {/* Footings and the column stubs below ground */}
      {COLS.map((x, i) => (
        <motion.path key={x} d={`M${x - 14} ${GL + 34} h28 v-12 h-28 Z M${x} ${GL + 22} V${GL}`} stroke={LINE} strokeWidth={1.4} fill="rgba(220,236,255,0.06)" {...draw(T0 + 0.8 + i * 0.08, 0.5)} />
      ))}
      {/* Columns rising */}
      {COLS.map((x, i) => (
        <motion.line key={x} x1={x} y1={GL} x2={x} y2={TOP} stroke={LINE} strokeWidth={2} {...draw(T0 + 1.3 + i * 0.06, FLOORS * 0.32 + 0.2)} />
      ))}
      {/* Floors: slab, then the windows of each bay; once the crane has parked they light up in a wave, and some keep
          going on and off */}
      {Array.from({ length: FLOORS }, (_, f) => {
        const y = GL - (f + 1) * FH;
        const at = FLOOR_AT(f);
        return (
          <g key={f}>
            <motion.rect x={COLS[0] - 6} y={y - 3} width={width + 12} height={6} fill="rgba(220,236,255,0.18)" stroke={LINE} strokeWidth={1.2}
              initial={{ scaleX: 0, opacity: 0 }} animate={{ scaleX: 1, opacity: 1 }} style={{ originX: 0 }}
              transition={{ delay: at, duration: 0.3, ease: "easeOut" }} />
            {COLS.slice(0, -1).map((x, b) => {
              const seed = (f * 7 + b * 11) % 10;
              const lit = seed < 4;                     // stay lit
              const flicker = seed >= 4 && seed < 7;    // go on and off
              const DARK = "rgba(140,200,255,0.10)", ON = "rgba(255,206,110,0.55)";
              const fill = still ? (lit || flicker ? ON : DARK) : lit ? [DARK, ON] : flicker ? [DARK, DARK, ON, ON, DARK] : DARK;
              const fillT = still ? { duration: 0 }
                : lit ? { delay: END + 0.6 + (FLOORS - f) * 0.18 + b * 0.07, duration: 0.6 }
                : flicker ? { delay: END + 2 + seed * 0.9 + b * 0.4, duration: 5 + seed, times: [0, 0.3, 0.38, 0.75, 0.82], repeat: Infinity, ease: "linear" as const }
                : { duration: 0 };
              return (
                <motion.rect key={b} x={x + 14} y={y + 16} width={37} height={32} stroke={SOFT} strokeWidth={1}
                  initial={{ opacity: 0, fill: DARK }}
                  animate={{ opacity: 1, fill }}
                  transition={{ opacity: { delay: at + 0.15 + b * 0.04, duration: 0.25 }, fill: fillT }} />
              );
            })}
            {/* Level mark on the right: ▽ +3.30 */}
            <motion.g {...appear(at + 0.2)}>
              <path d={`M574 ${y - 9} h12 l-6 9 Z`} fill="none" stroke={SOFT} strokeWidth={1} />
              <line x1={568} y1={y} x2={620} y2={y} stroke={FAINT} strokeWidth={1} />
              <text x={590} y={y - 3} fill={SOFT} fontSize={10} fontFamily="Sora, sans-serif">+{((f + 1) * 3.3).toFixed(2)}</text>
            </motion.g>
          </g>
        );
      })}
      {/* Ground floor mark and the roof parapet */}
      <motion.g {...appear(T0 + 1.2)}>
        <path d={`M574 ${GL - 9} h12 l-6 9 Z`} fill="none" stroke={SOFT} strokeWidth={1} />
        <text x={590} y={GL - 3} fill={SOFT} fontSize={10} fontFamily="Sora, sans-serif">±0.00 GL</text>
      </motion.g>
      <motion.path d={`M${COLS[0] - 6} ${TOP - 3} v-14 h${width + 12} v14`} stroke={LINE} strokeWidth={1.2} fill="none" {...draw(BUILT, 0.5)} />

      {/* Overall height on the left, bays below ground */}
      <motion.g {...appear(BUILT + 0.3)}>
        <path d={`M272 ${GL} V${TOP} M266 ${GL} h12 M266 ${TOP} h12`} stroke={SOFT} strokeWidth={1} />
        <path d={`M272 ${GL} l-3 -8 h6 Z M272 ${TOP} l-3 8 h6 Z`} fill={SOFT} />
        <text x={262} y={(GL + TOP) / 2} fill={SOFT} fontSize={10.5} fontFamily="Sora, sans-serif" textAnchor="middle" transform={`rotate(-90 262 ${(GL + TOP) / 2})`}>19.80 m</text>
      </motion.g>
      <motion.g {...appear(BUILT + 0.4)}>
        <path d={`M${COLS[0]} ${TOP - 34} H${COLS[COLS.length - 1]}`} stroke={SOFT} strokeWidth={1} />
        {COLS.map((x) => <path key={x} d={`M${x - 4} ${TOP - 30} L${x + 4} ${TOP - 38} M${x} ${TOP - 42} V${TOP - 26}`} stroke={SOFT} strokeWidth={1} />)}
        {COLS.slice(0, -1).map((x) => <text key={x} x={x + 20} y={TOP - 40} fill={SOFT} fontSize={9.5} fontFamily="Sora, sans-serif" textAnchor="middle">6.50</text>)}
      </motion.g>
    </g>
  );
}

// ── The camera: after the crane parks it zooms out to the board, pans to the bridge sheet and zooms in, then keeps
// moving between the two sheets. World: sheet A (the building) at 0..800, sheet B (the floor plan) at 900..1700.
const ZOOM_AT = END + 0.8;
const MOVE = 2.6;                       // one zoom or pan
const HOLD = 1;                         // a beat at the overview
const B_X = 900;
const K_OUT = 0.44;                     // the overview scale: both sheets in view
const OVER = { k: K_OUT, x: (800 - 1700 * K_OUT) / 2, y: (900 - 900 * K_OUT) / 2 };
const VIEW_A = { k: 1, x: 0, y: 0 };
const VIEW_B = { k: 1, x: -B_X, y: 0 };
const B_AT = ZOOM_AT + MOVE * 2 + HOLD; // the camera reaches the floor plan: it starts drawing
const STAY = 11;                        // seconds on a sheet before moving on

// ── Two engineers in front of the board ──────────────────────────────────────
/** Two engineers seen from behind, drawn as an architect's scale figures: plain silhouettes in the sheet's pale ink,
 *  hard hats and a reflective band the only colour. They stand in front of the board below the sheets, so they're in
 *  view only when the camera pulls back: the one on the right points up at the building sheet and taps now and then,
 *  the other holds a rolled-up drawing and turns to look. Drawn at 1:1 around a floor at y 884, placed by the caller. */
function Engineers() {
  const still = useReducedMotion();
  const INK = "rgba(214,232,255,0.92)";
  const SHADOW = "rgba(214,232,255,0.5)";
  const IN = ZOOM_AT + MOVE - 0.8;              // they rise as the camera first pulls back
  const arm = (d: string, w = 19) => <path d={d} stroke={INK} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" fill="none" />;
  const person = (cx: number, pointing: boolean, i: number) => {
    const F = 884;
    const sh = F - 254;
    const torso = `M${cx - 44} ${sh} Q${cx - 47} ${sh - 6} ${cx - 36} ${sh - 10} L${cx - 10} ${sh - 14} L${cx + 10} ${sh - 14} L${cx + 36} ${sh - 10}
      Q${cx + 47} ${sh - 6} ${cx + 44} ${sh} L${cx + 35} ${F - 150} L${cx - 35} ${F - 150} Z`;
    return (
      <motion.g key={i}
        initial={{ y: still ? 0 : 300, opacity: still ? 1 : 0 }} animate={{ y: 0, opacity: 1 }}
        transition={still ? { duration: 0 } : { delay: IN + i * 0.35, type: "spring", stiffness: 70, damping: 16 }}>
        <rect x={cx - 31} y={F - 156} width={27} height={150} rx={11} fill={INK} />
        <rect x={cx + 4} y={F - 156} width={27} height={150} rx={11} fill={INK} />
        <ellipse cx={cx - 18} cy={F - 4} rx={17} ry={6} fill={INK} />
        <ellipse cx={cx + 18} cy={F - 4} rx={17} ry={6} fill={INK} />
        {!pointing && (
          <g transform={`rotate(-12 ${cx - 52} ${sh + 60})`}>
            <rect x={cx - 112} y={sh + 52} width={84} height={15} rx={3} fill={SHADOW} />
            <ellipse cx={cx - 112} cy={sh + 59.5} rx={4} ry={7.5} fill={INK} />
          </g>
        )}
        {arm(`M${cx - 42} ${sh + 4} Q${cx - 54} ${sh + 56} ${cx - 50} ${sh + 104}`)}
        {pointing ? (
          <motion.g style={{ originX: "0%", originY: "100%" }}
            animate={still ? undefined : { rotate: [0, -5, 0, 0] }}
            transition={{ delay: IN + 1.5, duration: 2.2, times: [0, 0.25, 0.5, 1], repeat: Infinity, ease: "easeInOut" }}>
            {arm(`M${cx + 40} ${sh + 4} L${cx + 70} ${sh - 46} L${cx + 84} ${sh - 112}`)}
            {arm(`M${cx + 85} ${sh - 115} L${cx + 88} ${sh - 134}`, 6)}
          </motion.g>
        ) : arm(`M${cx + 42} ${sh + 4} Q${cx + 54} ${sh + 56} ${cx + 50} ${sh + 104}`)}
        <path d={torso} fill={INK} />
        <rect x={cx - 39} y={F - 205} width={78} height={7} fill={SAFETY} />
        <rect x={cx - 41} y={sh + 26} width={82} height={5} fill={SAFETY} opacity={0.85} />
        <rect x={cx - 8} y={sh - 28} width={16} height={18} fill={INK} />
        <motion.g style={{ originX: "50%", originY: "100%" }}
          animate={still || pointing ? undefined : { rotate: [0, 8, 8, 0, 0] }}
          transition={{ delay: IN + 3, duration: 6, times: [0, 0.15, 0.55, 0.7, 1], repeat: Infinity, ease: "easeInOut" }}>
          <ellipse cx={cx} cy={sh - 44} rx={16} ry={19} fill={INK} />
          <path d={`M${cx - 19} ${sh - 50} C${cx - 19} ${sh - 76} ${cx + 19} ${sh - 76} ${cx + 19} ${sh - 50} Z`} fill={SAFETY} />
          <rect x={cx - 25} y={sh - 52} width={50} height={5} rx={2.5} fill={SAFETY} />
        </motion.g>
      </motion.g>
    );
  };
  return <g>{person(132, false, 0)}{person(262, true, 1)}</g>;
}

// ── Sheet B: the typical floor plan of a residential tower ───────────────────
// Four 2 BHK flats around a central core (two lifts, the lobby, a dog-leg stair and a service shaft). The walls go in,
// then the core, each flat's rooms, doors with their swings, windows and room names; then the flats are booked one
// by one. Content kept clear of the note box (top left) and the title block (bottom right).
const PX0 = 70, PY0 = 290;               // the slab's top-left
const FW = 275, FD = 200;                // one flat: from the outside wall to the core, and to the middle line
const PX1 = PX0 + FW * 2 + 110;          // the core is 110 wide between the flats
const PY1 = PY0 + FD * 2;
const CORE_X = PX0 + FW;

/** The four flats: A1 top left, A2 top right, A3 bottom left, A4 bottom right. Each is the same flat drawn in its own
 *  local frame (x from its outside wall toward the core, y from its outside wall toward the middle) and mirrored. */
const FLATS = [
  { name: "A1", sx: 1, sy: 1, ox: PX0, oy: PY0 },
  { name: "A2", sx: -1, sy: 1, ox: PX1, oy: PY0 },
  { name: "A3", sx: 1, sy: -1, ox: PX0, oy: PY1 },
  { name: "A4", sx: -1, sy: -1, ox: PX1, oy: PY1 },
];
// The order they're booked in; the one not listed stays available.
const FLAT_BOOK_ORDER = ["A2", "A4", "A1"];

// One flat's rooms in its local frame (1 unit ≈ 3.27 cm: a 110-unit bedroom is 3.60 m).
const ROOMS: { x: number; y: number; w: number; h: number; name: string; size: string; small?: boolean }[] = [
  { x: 0, y: 0, w: 110, h: 115, name: "M. BED", size: "3.60 × 3.80" },
  { x: 0, y: 115, w: 110, h: 85, name: "BED 2", size: "3.60 × 2.80" },
  { x: 110, y: 0, w: 165, h: 115, name: "LIVING / DINING", size: "5.40 × 3.80" },
  { x: 110, y: 115, w: 55, h: 85, name: "TOILET", size: "1.80 × 2.80", small: true },
  { x: 165, y: 115, w: 110, h: 85, name: "KITCHEN", size: "3.60 × 2.80" },
];
// Doors: the leaf and its swing, from the hinge (all open away from the core or the living room).
const DOORS = [
  "M275 30 H253 A22 22 0 0 0 275 52",     // entry, from the lobby into the living room
  "M110 80 H88 A22 22 0 0 0 110 102",     // master bedroom
  "M110 150 H88 A22 22 0 0 0 110 172",    // bedroom 2
  "M125 115 V137 A22 22 0 0 0 147 115",   // toilet
];
// Windows on the two outside walls: [along the top wall, x from..to] and [down the side wall, y from..to].
const WIN_TOP: [number, number][] = [[25, 85], [148, 252]];
const WIN_SIDE: [number, number][] = [[30, 85], [132, 182]];

function FloorPlan() {
  const still = useReducedMotion();
  const at = (d: number) => (still ? 0 : B_AT + d);
  // A point of a flat's local frame on the sheet.
  const place = (f: (typeof FLATS)[number], x: number, y: number) => ({ x: f.ox + f.sx * x, y: f.oy + f.sy * y });
  const label = (s: string, x: number, y: number, size: number, fill: string, weight = 500) => (
    <text x={x} y={y} fill={fill} fontSize={size} fontWeight={weight} fontFamily="Sora, sans-serif" textAnchor="middle" letterSpacing="0.06em">{s}</text>
  );
  return (
    <g>
      {/* Outside walls: the slab drawn as a double line */}
      <motion.rect x={PX0} y={PY0} width={PX1 - PX0} height={PY1 - PY0} fill="none" stroke={LINE} strokeWidth={2.4} {...draw(at(0), 1.4)} />
      <motion.rect x={PX0 + 6} y={PY0 + 6} width={PX1 - PX0 - 12} height={PY1 - PY0 - 12} fill="none" stroke={SOFT} strokeWidth={1} {...draw(at(0.3), 1.4)} />
      <motion.line x1={PX0} y1={PY0 + FD} x2={PX1} y2={PY0 + FD} stroke={LINE} strokeWidth={1.6} {...draw(at(0.5), 0.9)} />

      {/* The core: two lifts, the lobby, a dog-leg stair and a service shaft */}
      <motion.g {...appear(at(0.7), 0.5)}>
        <path d={`M${CORE_X} ${PY0} V${PY1} M${CORE_X + 110} ${PY0} V${PY1}`} stroke={LINE} strokeWidth={1.6} />
        {[CORE_X + 12, CORE_X + 58].map((x) => (
          <g key={x}>
            <rect x={x} y={PY0 + 14} width={40} height={46} fill="rgba(220,236,255,0.04)" stroke={LINE} strokeWidth={1.2} />
            <path d={`M${x} ${PY0 + 14} L${x + 40} ${PY0 + 60} M${x + 40} ${PY0 + 14} L${x} ${PY0 + 60}`} stroke={SOFT} strokeWidth={1} />
          </g>
        ))}
        {label("LIFTS", CORE_X + 55, PY0 + 76, 9, SOFT)}
        {label("LOBBY", CORE_X + 55, PY0 + 168, 10, LINE, 600)}
        <rect x={CORE_X + 70} y={PY0 + 228} width={28} height={28} fill="none" stroke={SOFT} strokeWidth={1} />
        <path d={`M${CORE_X + 70} ${PY0 + 228} l28 28 m0 -28 l-28 28`} stroke={FAINT} strokeWidth={1} />
        {label("SHAFT", CORE_X + 84, PY0 + 270, 7.5, SOFT)}
        {/* Stair: two flights either side of the mid wall, a landing at the top, and the way up */}
        <rect x={CORE_X + 12} y={PY0 + 280} width={86} height={110} fill="none" stroke={LINE} strokeWidth={1.2} />
        <line x1={CORE_X + 55} y1={PY0 + 296} x2={CORE_X + 55} y2={PY0 + 390} stroke={LINE} strokeWidth={1.2} />
        {Array.from({ length: 10 }, (_, i) => PY0 + 300 + i * 9).map((y) => (
          <path key={y} d={`M${CORE_X + 12} ${y} H${CORE_X + 53} M${CORE_X + 57} ${y} H${CORE_X + 98}`} stroke={SOFT} strokeWidth={0.9} />
        ))}
        <path d={`M${CORE_X + 33} ${PY0 + 384} V${PY0 + 302} M${CORE_X + 29} ${PY0 + 309} L${CORE_X + 33} ${PY0 + 302} L${CORE_X + 37} ${PY0 + 309}`}
          stroke={SAFETY} strokeWidth={1.3} fill="none" />
        {label("UP", CORE_X + 77, PY0 + 292, 7.5, SOFT)}
      </motion.g>

      {FLATS.map((f, fi) => {
        const k = FLAT_BOOK_ORDER.indexOf(f.name);
        const booked = k >= 0;
        const bookAt = at(3.4 + k * 0.7);
        const box = { x: Math.min(f.ox, f.ox + f.sx * FW), y: Math.min(f.oy, f.oy + f.sy * FD) };
        const tag = place(f, 192, 92);
        const tick = place(f, 258, 14);
        const balcony = place(f, 200, -9);
        return (
          <g key={f.name}>
            {/* Booked: the flat takes a wash of the crane's yellow */}
            <motion.rect x={box.x} y={box.y} width={FW} height={FD}
              initial={{ fill: "rgba(244,180,0,0)" }} animate={{ fill: booked ? "rgba(244,180,0,0.2)" : "rgba(244,180,0,0)" }}
              transition={still ? { duration: 0 } : { delay: bookAt, duration: 0.5 }} />
            {/* Walls, doors, windows and the balcony, drawn in the flat's own frame */}
            <g transform={`translate(${f.ox} ${f.oy}) scale(${f.sx} ${f.sy})`}>
              {ROOMS.map((r, ri) => (
                <motion.rect key={ri} x={r.x} y={r.y} width={r.w} height={r.h} fill="none" stroke={LINE} strokeWidth={1.2}
                  {...draw(at(0.9 + fi * 0.25 + ri * 0.08), 0.8)} />
              ))}
              {DOORS.map((d, di) => (
                <motion.path key={di} d={d} stroke={SOFT} strokeWidth={1.1} fill="none" {...draw(at(1.9 + fi * 0.1 + di * 0.06), 0.5)} />
              ))}
              <motion.g {...appear(at(2.1 + fi * 0.1))}>
                {WIN_TOP.map(([a, b]) => (
                  <g key={a}><rect x={a} y={-1} width={b - a} height={8} fill="#0f3354" stroke={LINE} strokeWidth={1} /><line x1={a} y1={3} x2={b} y2={3} stroke={SOFT} strokeWidth={1} /></g>
                ))}
                {WIN_SIDE.map(([a, b]) => (
                  <g key={a}><rect x={-1} y={a} width={8} height={b - a} fill="#0f3354" stroke={LINE} strokeWidth={1} /><line x1={3} y1={a} x2={3} y2={b} stroke={SOFT} strokeWidth={1} /></g>
                ))}
                <rect x={140} y={-24} width={120} height={23} fill="none" stroke={SOFT} strokeWidth={1} strokeDasharray="5 3" />
                {/* Kitchen counter along two walls, with the sink */}
                <path d="M175 188 H263 V125" stroke={SOFT} strokeWidth={1} fill="none" />
                <rect x={225} y={181} width={18} height={12} rx={3} fill="none" stroke={SOFT} strokeWidth={1} />
              </motion.g>
            </g>
            {/* Room names and sizes, upright whichever way the flat is mirrored */}
            <motion.g {...appear(at(2.4 + fi * 0.1))}>
              {ROOMS.map((r, ri) => {
                const c = place(f, r.x + r.w / 2, r.y + (r.small ? r.h * 0.62 : r.h * 0.42));
                return (
                  <g key={ri}>
                    {label(r.name, c.x, c.y, r.small ? 7.5 : 9, LINE, 600)}
                    {label(r.size, c.x, c.y + 12, r.small ? 7 : 8, SOFT)}
                  </g>
                );
              })}
              {label("BALCONY", balcony.x, balcony.y + 3, 7.5, SOFT)}
              {label(`FLAT ${f.name} · 2 BHK`, tag.x, tag.y, 9.5, LINE, 700)}
            </motion.g>
            {booked && (
              <motion.g initial={{ opacity: 0, scale: still ? 1 : 0 }} animate={{ opacity: 1, scale: 1 }} style={{ originX: "50%", originY: "50%" }}
                transition={still ? { duration: 0 } : { delay: bookAt + 0.15, type: "spring", stiffness: 420, damping: 14 }}>
                <circle cx={tick.x} cy={tick.y} r={8} fill="#0b2742" stroke={SAFETY} strokeWidth={1} />
                <path d={`M${tick.x - 4} ${tick.y} l3 3 l6 -6`} stroke={SAFETY} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </motion.g>
            )}
          </g>
        );
      })}

      {/* Overall sizes, the legend and the sheet's name */}
      <motion.g {...appear(at(2.9))}>
        <path d={`M${PX0} 732 H${PX1} M${PX0} 726 V738 M${PX1} 726 V738 M${PX0 - 4} 736 L${PX0 + 4} 728 M${PX1 - 4} 736 L${PX1 + 4} 728`} stroke={SOFT} strokeWidth={1} />
        {label("21.60 m", (PX0 + PX1) / 2, 727, 9, SOFT)}
        <path d={`M48 ${PY0} V${PY1} M42 ${PY0} H54 M42 ${PY1} H54 M44 ${PY0 + 4} L52 ${PY0 - 4} M44 ${PY1 + 4} L52 ${PY1 - 4}`} stroke={SOFT} strokeWidth={1} />
        <text x={0} y={0} transform={`translate(43 ${(PY0 + PY1) / 2}) rotate(-90)`} fill={SOFT} fontSize={9} fontFamily="Sora, sans-serif" textAnchor="middle">13.10 m</text>
        <g transform={`translate(${PX0 - 20} 760)`}>
          <rect width={14} height={10} fill="rgba(244,180,0,0.45)" stroke={LINE} strokeWidth={1} />
          <text x={20} y={9} fill={SOFT} fontSize={10} fontFamily="Sora, sans-serif">BOOKED</text>
          <rect x={90} width={14} height={10} fill="rgba(220,236,255,0.03)" stroke={LINE} strokeWidth={1} />
          <text x={110} y={9} fill={SOFT} fontSize={10} fontFamily="Sora, sans-serif">AVAILABLE</text>
        </g>
        <text x={PX0 - 20} y={810} fill={LINE} fillOpacity={0.8} fontSize={12} fontWeight={600} letterSpacing="0.16em" fontFamily="Sora, sans-serif">TP-02 · TYPICAL FLOOR PLAN · TOWER A · 4 FLATS PER FLOOR</text>
      </motion.g>
    </g>
  );
}

function Drawing() {
  // Ids of its own: the page holds two copies (the panel, and the phone backdrop, hidden on wide screens), and a
  // shared id resolves to the hidden copy's clip, which clips nothing.
  const uid = React.useId().replace(/:/g, "");
  const id = (n: string) => `ls-${uid}-${n}`;
  const still = useReducedMotion();
  const worldRef = useRef<SVGGElement>(null);
  const boardRef = useRef<SVGGElement>(null);
  const k = useMotionValue(1);
  const tx = useMotionValue(0);
  const ty = useMotionValue(0);
  // The camera writes straight to the world's transform: re-rendering the drawing every frame for it would be wasteful.
  useEffect(() => {
    const apply = () => {
      worldRef.current?.setAttribute("transform", `translate(${tx.get()} ${ty.get()}) scale(${k.get()})`);
      boardRef.current?.setAttribute("opacity", String(Math.min(1, (1 - k.get()) / (1 - K_OUT))));
    };
    apply();
    const offs = [k.on("change", apply), tx.on("change", apply), ty.on("change", apply)];
    if (still) return () => offs.forEach((o) => o());
    let stopped = false;
    const running: { stop: () => void }[] = [];
    const ease = [0.65, 0, 0.35, 1] as const;
    /** Moves the camera through views, a move between each and holds where asked. */
    const go = (views: { k: number; x: number; y: number }[], holds: number[], delay: number) => {
      const times: number[] = [0];
      let t = 0;
      const steps: number[] = [];
      views.forEach((_, i) => { if (i === 0) return; t += MOVE; times.push(t); steps.push(t); if (holds[i]) { t += holds[i]; times.push(t); } });
      const kk: number[] = [], xx: number[] = [], yy: number[] = [];
      views.forEach((v, i) => {
        kk.push(v.k); xx.push(v.x); yy.push(v.y);
        if (i > 0 && holds[i]) { kk.push(v.k); xx.push(v.x); yy.push(v.y); }
      });
      const opts = { delay, duration: t, times: times.map((x) => x / t), ease: ease as any };
      const anims = [animate(k, kk, opts), animate(tx, xx, opts), animate(ty, yy, opts)];
      running.push(...anims);
      return Promise.all(anims);
    };
    (async () => {
      // A → overview → B, then back and forth: B → overview → A → overview → B, staying on each sheet a while.
      await go([VIEW_A, OVER, VIEW_B], [0, HOLD, 0], ZOOM_AT);
      while (!stopped) {
        await go([VIEW_B, OVER, VIEW_A], [0, HOLD, 0], STAY);
        if (stopped) break;
        await go([VIEW_A, OVER, VIEW_B], [0, HOLD, 0], STAY);
      }
    })();
    return () => { stopped = true; running.forEach((r) => r.stop()); offs.forEach((o) => o()); };
  }, [still, k, tx, ty]);

  const sheetFrame = (x: number) => (
    <g key={x}>
      <rect x={x} y={0} width={800} height={900} fill="#0f3354" />
      {[[18, 18], [782, 18], [18, 882], [782, 882]].map(([px, py], i) => (
        <circle key={i} cx={x + px} cy={py} r={9} fill={SAFETY} stroke="#0b2742" strokeWidth={2} />
      ))}
    </g>
  );

  return (
    <svg viewBox="0 0 800 900" preserveAspectRatio="xMidYMax slice" className="absolute inset-0 w-full h-full" aria-hidden>
      <defs>
        <pattern id={id("grid-s")} width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" stroke="rgba(170,210,255,0.07)" strokeWidth="1" /></pattern>
        <pattern id={id("grid-l")} width="100" height="100" patternUnits="userSpaceOnUse"><rect width="100" height="100" fill={`url(#${id("grid-s")})`} /><path d="M100 0H0V100" fill="none" stroke="rgba(170,210,255,0.13)" strokeWidth="1" /></pattern>
        <pattern id={id("earth")} width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="12" stroke="rgba(190,220,255,0.18)" strokeWidth="1.2" /></pattern>
        <clipPath id={id("sheet-a")}><rect x="0" y="0" width="800" height="900" /></clipPath>
        <clipPath id={id("sheet-b")}><rect x={B_X} y="0" width="800" height="900" /></clipPath>
      </defs>
      <motion.rect x="-400" y="-200" width="1600" height="1400" fill={`url(#${id("grid-l")})`} {...appear(0.1, 0.8)} />
      <g ref={worldRef}>
        {/* The board both sheets are pinned to: it shows as the camera pulls back */}
        <g ref={boardRef} opacity={0}>
          <rect x={-60} y={-60} width={1820} height={1020} fill="rgba(4,18,32,0.8)" stroke={SOFT} strokeWidth={4} />
          {sheetFrame(0)}
          {sheetFrame(B_X)}
        </g>
        <g clipPath={`url(#${id("sheet-a")})`}>
          {/* Ground line and the earth below it */}
          <motion.line x1={-200} y1={GL} x2={1000} y2={GL} stroke={LINE} strokeWidth={1.6} {...draw(T0, 0.8)} />
          <motion.rect x={-200} y={GL} width={1200} height={300} fill={`url(#${id("earth")})`} {...appear(T0 + 0.5, 0.6)} />
          <Building />
          <Crane />
          {/* Gyrocompass: north */}
          <motion.g {...appear(T0 + 0.6)} transform="translate(736 84)">
            <Gyro />
          </motion.g>
        </g>
        {!still && (
          <g transform="translate(0 -150) scale(1.9)"><Engineers /></g>
        )}
        {!still && (
          <g clipPath={`url(#${id("sheet-b")})`}>
            <g transform={`translate(${B_X} 0)`}><FloorPlan /></g>
          </g>
        )}
      </g>
    </svg>
  );
}

/** A gyrocompass: an eight-point compass rose (north inked, the other cardinals half-shaded, the intercardinals short)
 *  in a ticked bezel, two gimbal rings turning on their own axes around it (an ellipse that narrows and widens reads as
 *  a ring turning edge-on), and the rose swinging out and settling on north before it precesses gently. */
function Gyro() {
  const still = useReducedMotion();
  const spin = (dur: number, delay: number) => (still ? { duration: 0 } : { duration: dur, delay, repeat: Infinity, ease: "easeInOut" as const });
  // One point of the rose: a kite from the centre, its left half filled and right half lighter, like a drafted rose.
  const point = (len: number, w: number, a: number, dark: string, light: string) => (
    <g key={a} transform={`rotate(${a})`}>
      <path d={`M0 0 L0 ${-len} L${-w} ${-w * 1.1} Z`} fill={dark} />
      <path d={`M0 0 L0 ${-len} L${w} ${-w * 1.1} Z`} fill={light} />
    </g>
  );
  const ticks: React.ReactNode[] = [];
  for (let i = 0; i < 32; i++) {
    const long = i % 4 === 0;
    ticks.push(<line key={i} x1={0} y1={-31} x2={0} y2={long ? -26.5 : -29} stroke={SOFT} strokeWidth={long ? 1.1 : 0.7} transform={`rotate(${i * 11.25})`} />);
  }
  return (
    <g>
      {/* Bezel */}
      <circle r={31} fill="none" stroke={SOFT} strokeWidth={1} />
      {ticks}
      {/* Outer gimbal: turns about the north–south axis */}
      <motion.ellipse cx={0} cy={0} ry={24} fill="none" stroke={LINE} strokeOpacity={0.5} strokeWidth={1}
        initial={{ rx: 24 }} animate={still ? { rx: 24 } : { rx: [24, 2, 24, 2, 24] }} transition={spin(5, 1)} />
      {/* Inner gimbal: turns about the east–west axis */}
      <motion.ellipse cx={0} cy={0} rx={20} fill="none" stroke={SAFETY} strokeOpacity={0.65} strokeWidth={1}
        initial={{ ry: 20 }} animate={still ? { ry: 20 } : { ry: [20, 2, 20, 2, 20] }} transition={spin(3.6, 1.4)} />
      {/* The rose: swings out, settles on north, then precesses a little. The clear circle centres its box on the pivot. */}
      <motion.g initial={{ rotate: still ? 0 : -70 }}
        animate={still ? { rotate: 0 } : { rotate: [-70, 38, -22, 12, -6, 3, 0] }}
        transition={still ? { duration: 0 } : { delay: T0 + 0.8, duration: 3.2, ease: "easeOut" }}>
        <circle r={31} fill="none" />
        <motion.g animate={still ? undefined : { rotate: [0, 2.5, 0, -2.5, 0] }}
          transition={{ delay: T0 + 4.2, duration: 6, repeat: Infinity, ease: "easeInOut" }}>
          <circle r={31} fill="none" />
          {[45, 135, 225, 315].map((a) => point(12, 3.2, a, "rgba(190,220,255,0.55)", "rgba(190,220,255,0.22)"))}
          {[90, 180, 270].map((a) => point(21, 4.6, a, "rgba(220,236,255,0.75)", "rgba(220,236,255,0.3)"))}
          {point(24, 5.2, 0, SAFETY, "rgba(244,180,0,0.45)")}
        </motion.g>
      </motion.g>
      <circle r={2.4} fill="#0a2540" stroke={LINE} strokeWidth={1} />
      <text y={-35} fill={LINE} fontSize={10} fontWeight={600} fontFamily="Sora, sans-serif" textAnchor="middle">N</text>
    </g>
  );
}

const num = (n: number) => Math.round(n).toLocaleString("en-IN");

/** A figure that counts up from 0 when it first appears. */
function CountUp({ to, suffix = "" }: { to: number; suffix?: string }) {
  const still = useReducedMotion();
  const [v, setV] = useState(still ? to : 0);
  useEffect(() => {
    if (still) { setV(to); return; }
    const c = animate(0, to, { duration: 1.4, delay: 0.9, ease: [0.16, 1, 0.3, 1], onUpdate: setV });
    return () => c.stop();
  }, [to, still]);
  return <>{num(v)}{suffix}</>;
}

/** Phones and tablets: the same drawing fills the screen behind the form. */
export function SiteBackdrop() {
  return (
    <div className="ls-blueprint lg:hidden fixed inset-0 z-0 overflow-hidden" aria-hidden>
      <Drawing />
    </div>
  );
}

export function SiteDrawing({ stats }: { stats: PublicStats | null }) {
  const figures: [number, string, string][] = stats
    ? [
        [stats.projects ?? 0, "", "Projects"],
        [stats.activeSuppliers ?? 0, "", "Suppliers"],
        [stats.workOrders ?? 0, "", "Work orders"],
        [Math.min(100, Math.max(0, stats.workOrderCompletionPct ?? 0)), "%", "Work done"],
      ]
    : [];

  return (
    <motion.div
      className="ls-blueprint relative h-full min-h-[520px] overflow-hidden"
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ ...FLOW, delay: 0.1 }}
    >
      <Drawing />

      {/* The drawing border with its zone marks */}
      <div className="ls-border" aria-hidden>
        {["1", "2", "3", "4"].map((z, i) => <span key={z} className="ls-zone" style={{ top: 2, left: `${12.5 + i * 25}%` }}>{z}</span>)}
        {["A", "B", "C"].map((z, i) => <span key={z} className="ls-zone" style={{ left: 3, top: `${16.6 + i * 33.3}%` }}>{z}</span>)}
      </div>

      {/* The line, top left, in a solid note box so the crane and the grid never run through it */}
      <motion.div className="ls-note absolute z-[3]" variants={cascade(0.4, 0.12)} initial="hidden" animate="show">
        <motion.p className="ls-eyebrow" variants={pop}>Built for civil contractors</motion.p>
        <motion.p
          className="font-heading font-semibold mt-2"
          style={{ fontSize: "clamp(18px, 1.5vw, 24px)", lineHeight: 1.22, color: "#ffffff", textWrap: "balance" }}
          variants={{ hidden: { opacity: 0, x: -24 }, show: { opacity: 1, x: 0, transition: FLOW } }}
        >
          From footing to handover, every site on one sheet.
        </motion.p>
      </motion.div>

      {/* Title block, bottom right: the drawing's details and the company's figures */}
      <motion.div
        className="ls-titleblock absolute z-[3]"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...FLOW, delay: 0.8 }}
      >
        <div className="ls-tb-head">
          <span>CivilierERP</span>
          <span>DRG CV-001 · REV A</span>
        </div>
        {figures.length > 0 ? (
          <div className="ls-tb-grid">
            {figures.map(([v, suffix, label]) => (
              <div key={label}>
                <p className="ls-tb-fig"><CountUp to={v} suffix={suffix} /></p>
                <p className="ls-tb-lbl">{label}</p>
              </div>
            ))}
          </div>
        ) : (
          <div className="ls-tb-grid">
            {["Projects", "Suppliers", "Work orders", "Work done"].map((l) => (
              <div key={l}><p className="ls-tb-fig">—</p><p className="ls-tb-lbl">{l}</p></div>
            ))}
          </div>
        )}
        <div className="ls-tb-foot">
          <span>Scale 1:100</span>
          <span>Sheet 1 of 1</span>
        </div>
      </motion.div>
    </motion.div>
  );
}
