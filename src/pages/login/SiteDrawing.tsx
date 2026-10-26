// Right of the sign-in page: a construction drawing on blueprint that draws itself. The ground and the earth hatch go
// in, the footings, then the columns rise and the floors are cast one above another, each with its level mark; the
// tower crane goes up beside it and keeps hoisting steel beams from the yard onto the roof, and at the end a few
// windows light up. The sheet has a drawing border with zone marks and a title block holding the company's figures.
// On phones the same drawing fills the screen behind the form (SiteBackdrop). Everything is still under reduced
// motion (MotionConfig on the page) apart from the line drawing, which just completes.
import React, { useEffect, useState } from "react";
import { animate, motion, useMotionValue, useReducedMotion, useSpring, type MotionValue } from "framer-motion";
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

/** The crane's lift, on a loop: lower onto the top girder of the pile, take it, hoist, trolley across, lower it onto
 *  the roof, let go, return. One timeline shared by trolley, cable and load so they stay together. The hook carries
 *  the girder only between touching it on the pile (PICKED) and setting it down on the roof (PLACED); the pile is
 *  restocked while the crane is over the roof. */
const LOOP = 11;
const TIMES = [0, 0.1, 0.2, 0.32, 0.5, 0.62, 0.7, 0.8, 0.92, 1];
// The load hangs 26–35 below the hook: so the hook sits 53 above the ground over the pile's top girder (GL-27) and
// 52 above the roof slab to set it on the parapet (TOP-17).
const AT_PILE = GL - 53;
const AT_ROOF = TOP - 52;
const TROLLEY = [PICK_X, PICK_X, PICK_X, PICK_X, DROP_X, DROP_X, DROP_X, DROP_X, PICK_X, PICK_X];
const HOOK_Y = [GL - 130, AT_PILE, AT_PILE, 250, 250, AT_ROOF, AT_ROOF, TOP - 90, TOP - 90, GL - 130];
const PICKED = 0.1;
const PLACED = 0.66;
const LOAD = { values: [0, 0, 1, 1, 0, 0], times: [0, PICKED, PICKED + 0.001, PLACED, PLACED + 0.001, 1] };
const PILE_TOP = { values: [1, 1, 0, 0, 1, 1], times: [0, PICKED, PICKED + 0.001, 0.72, 0.86, 1] };
const ON_ROOF = { values: [0, 0, 1, 1, 0], times: [0, PLACED, PLACED + 0.001, 0.86, 1] };
const loop = (delay: number, times: number[] = TIMES) => ({ duration: LOOP, times, repeat: Infinity, ease: "easeInOut" as const, delay });
const linear = (delay: number, times: number[]) => ({ duration: LOOP, times, repeat: Infinity, ease: "linear" as const, delay });

function Crane() {
  const still = useReducedMotion();
  const hook = useMotionValue(still ? 250 : GL - 130);
  useEffect(() => {
    if (still) return;
    const c = animate(hook, HOOK_Y, loop(LIFT_AT));
    return () => c.stop();
  }, [still, hook]);
  const lattice: string[] = [];
  for (let y = GL; y > JIB_Y + 14; y -= 22) lattice.push(`M${MAST - 9} ${y} L${MAST + 9} ${y - 22} M${MAST + 9} ${y} L${MAST - 9} ${y - 22}`);
  const jibLattice: string[] = [];
  for (let x = MAST - 12; x > 150; x -= 24) jibLattice.push(`M${x} ${JIB_Y} L${x - 12} ${JIB_Y + 12} L${x - 24} ${JIB_Y}`);

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

      {/* Trolley, cable, hook and the beam it carries */}
      <motion.g {...appear(LIFT_AT - 0.3)}>
        <motion.g initial={{ x: PICK_X }} animate={still ? { x: DROP_X } : { x: TROLLEY }} transition={still ? { duration: 0 } : loop(LIFT_AT)}>
          <rect x={-9} y={JIB_Y + 12} width={18} height={7} fill={SAFETY} />
          <motion.line x1={0} y1={JIB_Y + 19} x2={0} y2={hook} stroke={LINE} strokeWidth={1} />
          <motion.g style={{ y: hook }}>
            <path d="M-5 0 H5 L3 7 H-3 Z M0 7 V12 a4 4 0 1 0 4 -2" stroke={LINE} strokeWidth={1.4} fill="none" />
            <motion.g initial={{ opacity: 0 }} animate={still ? { opacity: 1 } : { opacity: LOAD.values }} transition={still ? { duration: 0 } : linear(LIFT_AT, LOAD.times)}>
              <path d="M0 14 L-26 26 M0 14 L26 26" stroke={SOFT} strokeWidth={1} />
              <rect x={-36} y={26} width={72} height={9} fill="rgba(244,180,0,0.35)" stroke={SAFETY} strokeWidth={1.2} />
              <path d="M-36 30.5 H36" stroke={SAFETY} strokeOpacity={0.6} strokeWidth={0.8} />
            </motion.g>
          </motion.g>
        </motion.g>
      </motion.g>

      {/* Girders stacked in the yard: the top one goes with the hook and comes back while the crane is away */}
      <motion.g {...appear(CRANE_AT + 2.4)}>
        {[0, 1].map((i) => (
          <rect key={i} x={PICK_X - 36} y={GL - 9 - i * 9} width={72} height={9} fill="rgba(244,180,0,0.18)" stroke={SAFETY} strokeOpacity={0.7} strokeWidth={1} />
        ))}
        <motion.rect x={PICK_X - 36} y={GL - 27} width={72} height={9} fill="rgba(244,180,0,0.18)" stroke={SAFETY} strokeOpacity={0.7} strokeWidth={1}
          animate={still ? { opacity: 0 } : { opacity: PILE_TOP.values }} transition={still ? { duration: 0 } : linear(LIFT_AT, PILE_TOP.times)} />
      </motion.g>
      {/* The girder once it's set down on the roof */}
      {!still && (
        <motion.rect x={DROP_X - 36} y={TOP - 26} width={72} height={9} fill="rgba(244,180,0,0.35)" stroke={SAFETY} strokeWidth={1.2}
          initial={{ opacity: 0 }} animate={{ opacity: ON_ROOF.values }} transition={linear(LIFT_AT, ON_ROOF.times)} />
      )}
    </g>
  );
}

function Building() {
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
      {/* Floors: slab, then the windows of each bay; a few light up once the frame is complete */}
      {Array.from({ length: FLOORS }, (_, f) => {
        const y = GL - (f + 1) * FH;
        const at = FLOOR_AT(f);
        return (
          <g key={f}>
            <motion.rect x={COLS[0] - 6} y={y - 3} width={width + 12} height={6} fill="rgba(220,236,255,0.18)" stroke={LINE} strokeWidth={1.2}
              initial={{ scaleX: 0, opacity: 0 }} animate={{ scaleX: 1, opacity: 1 }} style={{ originX: 0 }}
              transition={{ delay: at, duration: 0.3, ease: "easeOut" }} />
            {COLS.slice(0, -1).map((x, b) => {
              const lit = (f * 3 + b * 5) % 7 === 2;
              return (
                <motion.rect key={b} x={x + 14} y={y + 16} width={37} height={32} stroke={SOFT} strokeWidth={1}
                  initial={{ opacity: 0, fill: "rgba(140,200,255,0.10)" }}
                  animate={{ opacity: 1, fill: lit ? ["rgba(140,200,255,0.10)", "rgba(255,206,110,0.55)"] : "rgba(140,200,255,0.10)" }}
                  transition={{ opacity: { delay: at + 0.15 + b * 0.04, duration: 0.25 }, fill: { delay: BUILT + 1.2 + (f + b) * 0.12, duration: 0.6 } }} />
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

function Drawing({ lean }: { lean?: { x: MotionValue<number>; y: MotionValue<number> } }) {
  return (
    <svg viewBox="0 0 800 900" preserveAspectRatio="xMidYMax slice" className="absolute inset-0 w-full h-full" aria-hidden>
      <defs>
        <pattern id="ls-grid-s" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" stroke="rgba(170,210,255,0.07)" strokeWidth="1" /></pattern>
        <pattern id="ls-grid-l" width="100" height="100" patternUnits="userSpaceOnUse"><rect width="100" height="100" fill="url(#ls-grid-s)" /><path d="M100 0H0V100" fill="none" stroke="rgba(170,210,255,0.13)" strokeWidth="1" /></pattern>
        <pattern id="ls-earth" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="12" stroke="rgba(190,220,255,0.18)" strokeWidth="1.2" /></pattern>
      </defs>
      <motion.rect x="-400" y="-200" width="1600" height="1400" fill="url(#ls-grid-l)" {...appear(0.1, 0.8)} />
      <Layer lean={lean} depth={10}>
        {/* Ground line and the earth below it */}
        <motion.line x1={-200} y1={GL} x2={1000} y2={GL} stroke={LINE} strokeWidth={1.6} {...draw(T0, 0.8)} />
        <motion.rect x={-200} y={GL} width={1200} height={300} fill="url(#ls-earth)" {...appear(T0 + 0.5, 0.6)} />
        <Building />
        <Crane />
      </Layer>
      {/* North arrow */}
      <motion.g {...appear(T0 + 0.6)} transform="translate(742 74)">
        <circle r={20} fill="none" stroke={SOFT} strokeWidth={1} />
        <path d="M0 -26 L7 6 L0 1 L-7 6 Z" fill={LINE} fillOpacity={0.85} />
        <text y={-31} fill={SOFT} fontSize={10} fontFamily="Sora, sans-serif" textAnchor="middle">N</text>
      </motion.g>
    </svg>
  );
}

/** Moves its contents against the pointer by up to `depth` px (the drawing sits a touch off the sheet). */
function Layer({ lean, depth, children }: { lean?: { x: MotionValue<number>; y: MotionValue<number> }; depth: number; children: React.ReactNode }) {
  const tx = useSpring(0, { stiffness: 80, damping: 20 });
  const ty = useSpring(0, { stiffness: 80, damping: 20 });
  useEffect(() => {
    if (!lean) return;
    const a = lean.x.on("change", (v) => tx.set(-v * depth));
    const b = lean.y.on("change", (v) => ty.set(-v * depth * 0.6));
    return () => { a(); b(); };
  }, [lean, depth, tx, ty]);
  return <motion.g style={{ x: tx, y: ty }}>{children}</motion.g>;
}

function usePointerLean() {
  const still = useReducedMotion();
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const x = useSpring(mx, { stiffness: 60, damping: 18 });
  const y = useSpring(my, { stiffness: 60, damping: 18 });
  const onMouseMove = (e: React.MouseEvent<HTMLElement>) => {
    if (still) return;
    const r = e.currentTarget.getBoundingClientRect();
    mx.set((e.clientX - r.left) / r.width - 0.5);
    my.set((e.clientY - r.top) / r.height - 0.5);
  };
  const onMouseLeave = () => { mx.set(0); my.set(0); };
  return { x, y, onMouseMove, onMouseLeave };
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
  const lean = usePointerLean();
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
      onMouseMove={lean.onMouseMove}
      onMouseLeave={lean.onMouseLeave}
    >
      <Drawing lean={lean} />

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
