import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { motion, useInView } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import {
  Hammer,
  ShieldCheck,
  IndianRupee,
  Package,
  FileCheck,
  Ticket,
  TriangleAlert,
  Wrench,
  ShoppingCart,
  Pickaxe,
  HeartHandshake,
  Table,
  Activity,
  Cpu,
} from "lucide-react";
import {
  fetchHomeDashboard,
  type HomeDashboardData,
  type ApprovalInboxItem,
} from "@/api/homeDashboardApi";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { LazyWhenVisible } from "@/components/LazyWhenVisible";
import { SHEET_CSS, Detail, Dimension, Skel } from "@/components/sheet/Sheet";
import { getModuleRanking } from "@/api/homeWidgetsApi";
import { moduleOfPath } from "@/lib/moduleOfPath";
import { getFixedAssets } from "@/api/fixedAssetApi";
import {
  HOME_TILES,
  MODULE_LABELS,
  orderTiles,
  pickHeroTiles,
  rankedModuleOrder,
  type HomeModuleId,
  type HomeTileData,
} from "@/pages/home/homeTiles";

// ─── Role helpers ─────────────────────────────────────────────────────────────
// These mirror the logic in TopNavbar / auth.utils so the home page
// shows exactly the same modules a user can actually navigate to.

type UserRoleStr = string;

function isPrivileged(role: UserRoleStr) {
  return ["super_admin", "admin", "dba"].includes(role);
}

// ─── Universal activity feed ──────────────────────────────────────────────────
interface LiveActivityItem {
  Kind: string;
  Module: string;
  DocNo: string | null;
  Title: string;
  Subtitle: string | null;
  Actor: string | null;
  Amount: number | null;
  Status: string | null;
  At: string;
  Href: string;
}

const MODULE_META: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  finance:     { label: "Finance",     color: "#3b82f6", icon: IndianRupee },
  material:    { label: "Material",    color: "#8b5cf6", icon: Package },
  engineering: { label: "Engineering", color: "#ec4899", icon: Wrench },
  sales:       { label: "Sales",       color: "#7c3aed", icon: ShoppingCart },
  crm:         { label: "CRM",         color: "#e11d48", icon: HeartHandshake },
  ticket:      { label: "Tickets",     color: "#ef4444", icon: Ticket },
  followup:    { label: "Follow-Up",   color: "#0d9488", icon: Table },
  fixedasset:  { label: "Fixed Asset", color: "#eab308", icon: Cpu },
  admin:       { label: "Admin",       color: "#a855f7", icon: ShieldCheck },
};
const moduleMeta = (m: string) => MODULE_META[m] ?? { label: m, color: "#64748b", icon: Activity };

function relTime(iso: string): string {
  const d = new Date(iso).getTime();
  if (!d || d < 946684800000) return ""; // pre-2000 sentinel = unknown
  const s = Math.floor((Date.now() - d) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

const compactINR = (n: number) =>
  n >= 1e7 ? `₹${(n / 1e7).toFixed(2)}Cr`
  : n >= 1e5 ? `₹${(n / 1e5).toFixed(1)}L`
  : n >= 1e3 ? `₹${(n / 1e3).toFixed(1)}K`
  : `₹${Math.round(n)}`;



// ─── Animated Counter ─────────────────────────────────────────────────────────
function AnimatedCounter({
  target,
  prefix = "",
  suffix = "",
  duration = 1.6,
}: {
  target: number;
  prefix?: string;
  suffix?: string;
  duration?: number;
}) {
  const [count, setCount] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });

  useEffect(() => {
    if (!inView) return;
    const start = Date.now();
    const tick = () => {
      const t = Math.min((Date.now() - start) / 1000 / duration, 1);
      const eased = 1 - Math.pow(1 - t, 4);
      setCount(Math.round(eased * target));
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [inView, target, duration]);

  return (
    <span ref={ref}>
      {prefix}
      {count.toLocaleString("en-IN")}
      {suffix}
    </span>
  );
}


interface Attention {
  severity: "high" | "med" | "low";
  label: string;
  count: number;
  hint: string;
  href: string;
  icon: React.ElementType;
}






// ─── Project Network ──────────────────────────────────────────────────────────
// A force-directed map of the real company → project structure.
//
// Two earlier orbital/map attempts were rejected here for reading as empty,
// and both failed the same way: they scattered project dots alone across a
// fixed, wide canvas. Both causes are addressed:
//
//  1. The graph carries real edges. Every project links to its owning company,
//     plus dashed links to any co-owning companies (MultiCompanyIds), so even
//     a handful of projects renders as a connected structure rather than loose
//     points — edges, not dot count, are what make a graph read as a network.
//  2. The viewBox is fitted to the laid-out nodes' own bounding box (clamped to
//     a floor so a 2-node graph doesn't balloon), so the canvas always hugs its
//     content instead of stretching thin data across space it doesn't have.
//
// Layout is a deterministic force simulation solved once per dataset — stable
// positions, no rAF loop, no re-layout on hover/filter/zoom.

type ProjectNode = {
  id: number;
  name: string;
  active: boolean;
  code?: string | null;
  companyId?: number | null;
  company?: string | null;
  type?: string | null;
  teamSize?: number;
  startDate?: string | null;
  coCompanyIds?: number[];
};

// Hues borrowed from the reference palette, lifted to stay legible on both a
// light and a dark card surface (the panel is theme-aware; only these accents
// are fixed).
const NET = {
  active: "hsl(var(--primary))",
  idle: "hsl(var(--muted-foreground) / 0.55)",
  jv: "hsl(var(--primary) / 0.5)",
  company: "hsl(var(--foreground))",
};

type NetNode = {
  key: string;
  kind: "company" | "project";
  label: string;
  r: number;
  active: boolean;
  jv: boolean;
  count: number;
  activeCount: number;
  project?: ProjectNode;
  x: number;
  y: number;
};
type NetLink = { a: string; b: string; jv: boolean };

const netShort = (s: string, n = 15) =>
  s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;

// Half the horizontal room a node's caption needs, in layout units. Captions
// are wide and short, so the separation test below is elliptical: without it
// two discs can sit clear of each other while their labels still overlap.
// Caption budget. A narrow canvas can't seat full-length uppercase hub names
// side by side — without trimming them the fit below just keeps expanding to
// make room and shrinks the whole graph instead.
const netLabelSpec = (boxW: number) =>
  boxW < 520
    ? { coChars: 10, prChars: 9, coPx: 9, prPx: 8 }
    : { coChars: 16, prChars: 14, coPx: 10, prPx: 9 };

const netLabelHalf = (n: NetNode) => {
  const chars = Math.min(n.label.length, n.kind === "company" ? 16 : 14);
  return Math.max(n.r, (chars * (n.kind === "company" ? 3.2 : 2.7)) / 2);
};

function buildProjectNetwork(projects: ProjectNode[]) {
  const nodes: NetNode[] = [];
  const links: NetLink[] = [];
  if (projects.length === 0) return { nodes, links };

  // ── Company hubs ───────────────────────────────────────────────────────────
  const companies = new Map<string, { name: string; count: number; active: number }>();
  const companyKey = (id: number | null | undefined) =>
    id != null ? `c${id}` : "c_none";

  projects.forEach((p) => {
    const key = companyKey(p.companyId);
    const entry = companies.get(key) ?? {
      name: p.company || "Unassigned",
      count: 0,
      active: 0,
    };
    entry.count += 1;
    if (p.active) entry.active += 1;
    if (p.company) entry.name = p.company;
    companies.set(key, entry);
  });

  const maxCount = Math.max(...[...companies.values()].map((c) => c.count), 1);
  companies.forEach((c, key) => {
    nodes.push({
      key,
      kind: "company",
      label: c.name,
      r: 11 + (c.count / maxCount) * 6,
      active: c.active > 0,
      jv: false,
      count: c.count,
      activeCount: c.active,
      x: 0,
      y: 0,
    });
  });

  // ── Project nodes, sized by team size ──────────────────────────────────────
  const maxTeam = Math.max(...projects.map((p) => p.teamSize ?? 0), 1);
  projects.forEach((p) => {
    const key = `p${p.id}`;
    const co = (p.coCompanyIds ?? []).filter((id) => id !== p.companyId);
    nodes.push({
      key,
      kind: "project",
      label: p.name,
      r: 6 + ((p.teamSize ?? 0) / maxTeam) * 5,
      active: p.active,
      jv: co.length > 0,
      count: p.teamSize ?? 0,
      activeCount: 0,
      project: p,
      x: 0,
      y: 0,
    });
    links.push({ a: key, b: companyKey(p.companyId), jv: false });
    co.forEach((id) => {
      if (companies.has(companyKey(id))) {
        links.push({ a: key, b: companyKey(id), jv: true });
      }
    });
  });

  layoutProjectNetwork(nodes, links);
  return { nodes, links };
}

// Deterministic force solve — golden-angle seeding, then repulsion + collision,
// link springs and a light centering pull, annealed over a fixed iteration
// count. Same input always yields the same map.
function layoutProjectNetwork(nodes: NetNode[], links: NetLink[]) {
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  const N = nodes.length;

  nodes.forEach((n, i) => {
    const ang = i * 2.3999632297;
    const ring = n.kind === "company" ? 30 : 84 + (i % 3) * 18;
    n.x = Math.cos(ang) * ring;
    n.y = Math.sin(ang) * ring;
  });

  const ITER = 420;
  for (let step = 0; step < ITER; step++) {
    const alpha = Math.pow(1 - step / ITER, 1.4);

    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        const a = nodes[i];
        const b = nodes[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 0.01) {
          dx = i % 2 ? 0.7 : -0.7;
          dy = j % 2 ? 0.7 : -0.7;
          d2 = dx * dx + dy * dy;
        }
        const d = Math.sqrt(d2);
        const ux = dx / d;
        const uy = dy / d;

        const bothHubs = a.kind === "company" && b.kind === "company";
        const charge =
          (bothHubs ? 9000 : a.kind === "company" || b.kind === "company" ? 2600 : 1500) /
          d2;
        const push = Math.min(charge, 18) * alpha;
        a.x -= ux * push;
        a.y -= uy * push;
        b.x += ux * push;
        b.y += uy * push;

        // Elliptical, label-aware separation — wide berth horizontally (where
        // captions live), tighter vertically. Runs at full strength regardless
        // of anneal state so nothing ever ends up overlapping.
        // Hubs claim far wider territory than leaf nodes so each company's
        // cluster stays legibly separate instead of stacking in the middle.
        const needX = netLabelHalf(a) + netLabelHalf(b) + (bothHubs ? 150 : 14);
        const needY = a.r + b.r + (bothHubs ? 95 : 24);
        const ex = dx / needX;
        const ey = dy / needY;
        const e = Math.hypot(ex, ey);
        if (e < 1 && e > 1e-6) {
          const fix = (1 - e) * 0.5;
          const sx = (ex / e) * needX * fix;
          const sy = (ey / e) * needY * fix;
          a.x -= sx;
          a.y -= sy;
          b.x += sx;
          b.y += sy;
        }
      }
    }

    for (const l of links) {
      const a = byKey.get(l.a);
      const b = byKey.get(l.b);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy) || 0.001;
      const ideal = (l.jv ? 138 : 72) + a.r + b.r;
      const k = (d - ideal) * (l.jv ? 0.03 : 0.08) * alpha;
      const ux = dx / d;
      const uy = dy / d;
      a.x += ux * k;
      a.y += uy * k;
      b.x -= ux * k;
      b.y -= uy * k;
    }

    // Anisotropic centering: a weaker horizontal pull than vertical lets the
    // graph settle into a wide ellipse roughly matching the panel's aspect,
    // so it fills the canvas instead of balling up with dead space either side.
    for (const n of nodes) {
      n.x -= n.x * 0.006 * alpha;
      n.y -= n.y * 0.021 * alpha;
    }
  }
}

function ProjectNetworkMap({
  projects,
  total,
}: {
  projects: ProjectNode[];
  total: number;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [lens, setLens] = useState<"all" | "active" | "idle">("all");
  const [zoom, setZoom] = useState(1);

  // The viewBox is fitted to the graph, so a unit is not a pixel — and the
  // ratio changes with the data. Measuring the canvas lets captions and
  // strokes be specified in real pixels and stay legible at any graph size,
  // while node radii stay in layout units so a small graph still fills space.
  const canvasRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 520, h: 290 });
  useEffect(() => {
    const el = canvasRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setBox({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Layout is solved once per dataset. Filtering and zoom are presentation
  // only — they never re-solve, so nodes never jump under the cursor.
  const { nodes, links } = useMemo(
    () => buildProjectNetwork(projects),
    [projects],
  );

  const byKey = useMemo(
    () => Object.fromEntries(nodes.map((n) => [n.key, n])),
    [nodes],
  );

  // Fit the viewBox to the content's own bounds, with a floor so a very small
  // graph scales up sanely instead of rendering as giant discs.
  const view = useMemo(() => {
    if (nodes.length === 0) return { x: -180, y: -120, w: 360, h: 240 };
    const MIN_W = 340;
    const MIN_H = 230;

    const grow = (
      seed: { minX: number; maxX: number; minY: number; maxY: number },
      u: number,
    ) => {
      // Captions render at a size derived from `unit`, so how much room they
      // need in layout units depends on the fit itself. Solved in two passes:
      // discs first, then re-grown to cover the captions at that fit. Without
      // this the outermost labels clip off the edge on a narrow canvas.
      let { minX, maxX, minY, maxY } = seed;
      const spec = netLabelSpec(box.w);
      for (const n of nodes) {
        const isCo = n.kind === "company";
        const fs = (isCo ? spec.coPx : spec.prPx) * u;
        const chars = netShort(n.label, isCo ? spec.coChars : spec.prChars).length;
        const halfW = (chars * fs * (isCo ? 0.58 : 0.5)) / 2;
        minX = Math.min(minX, n.x - halfW);
        maxX = Math.max(maxX, n.x + halfW);
        maxY = Math.max(maxY, n.y + n.r + 11 * u + fs);
      }
      return { minX, maxX, minY, maxY };
    };

    const discs = {
      minX: Math.min(...nodes.map((n) => n.x - n.r)),
      maxX: Math.max(...nodes.map((n) => n.x + n.r)),
      minY: Math.min(...nodes.map((n) => n.y - n.r)),
      maxY: Math.max(...nodes.map((n) => n.y + n.r)),
    };

    const fit = (b: typeof discs) => {
      const pad = 16;
      let minX = b.minX - pad;
      let maxX = b.maxX + pad;
      let minY = b.minY - pad;
      let maxY = b.maxY + pad;
      const w = maxX - minX;
      const h = maxY - minY;
      if (w < MIN_W) {
        const g = (MIN_W - w) / 2;
        minX -= g;
        maxX += g;
      }
      if (h < MIN_H) {
        const g = (MIN_H - h) / 2;
        minY -= g;
        maxY += g;
      }
      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    };

    // Fit → measure → refit. Each pass feeds the previous fit's scale back in;
    // three is comfortably past the point it stops moving.
    let v = fit(discs);
    for (let i = 0; i < 3; i++) {
      const u = 1 / Math.max(Math.min(box.w / v.w, box.h / v.h), 1e-6);
      v = fit(grow(discs, u));
    }
    return v;
  }, [nodes, box]);

  // Layout units per rendered CSS pixel (preserveAspectRatio="meet" fits the
  // smaller axis, and the zoom transform multiplies it). Anything sized with
  // this keeps a constant on-screen size no matter how the graph is fitted.
  const unit = useMemo(() => {
    const scale = Math.min(box.w / view.w, box.h / view.h) * zoom;
    return scale > 0 ? 1 / scale : 1;
  }, [box, view, zoom]);

  const labelSpec = netLabelSpec(box.w);
  const focus = hovered ?? selected;

  // Everything one hop from the focused node stays lit; the rest recedes.
  const lit = useMemo(() => {
    if (!focus) return null;
    const s = new Set<string>([focus]);
    links.forEach((l) => {
      if (l.a === focus) s.add(l.b);
      if (l.b === focus) s.add(l.a);
    });
    return s;
  }, [focus, links]);

  const dimmedByLens = (n: NetNode) => {
    if (lens === "all" || n.kind === "company") return false;
    return lens === "active" ? !n.active : n.active;
  };
  const nodeDim = (n: NetNode) =>
    dimmedByLens(n) || (lit ? !lit.has(n.key) : false);

  const nodeFill = (n: NetNode) =>
    n.kind === "company"
      ? NET.company
      : n.jv
        ? NET.jv
        : n.active
          ? NET.active
          : NET.idle;

  const activeCount = projects.filter((p) => p.active).length;
  const companyCount = nodes.filter((n) => n.kind === "company").length;
  const sel = selected ? byKey[selected] : null;

  const hubs = useMemo(
    () =>
      nodes
        .filter((n) => n.kind === "company")
        .sort((a, b) => b.count - a.count)
        .slice(0, 3),
    [nodes],
  );
  const hubMax = Math.max(...hubs.map((h) => h.count), 1);

  const cx = view.x + view.w / 2;
  const cy = view.y + view.h / 2;

  if (projects.length === 0) {
    return (
      <div className="flex flex-col">
        <div className="px-4 py-12 text-center text-xs text-muted-foreground">
          No projects yet
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <style>{`
        @keyframes netFloat { 0%,100%{transform:translate(0,0)} 50%{transform:translate(0,-3px)} }
        @keyframes netDash  { to { stroke-dashoffset: calc(var(--net-dash, 8) * -2) } }
        .net-float { animation-name:netFloat; animation-iteration-count:infinite; animation-timing-function:ease-in-out }
        .net-flow  { animation:netDash .9s linear infinite }
        @media (prefers-reduced-motion: reduce) {
          .net-float, .net-flow { animation: none }
        }
      `}</style>

      {/* ── Lens + zoom ───────────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", paddingBottom: 12 }}>
        <div className="seg">
          {(["all", "active", "idle"] as const).map((k) => (
            <button key={k} onClick={() => setLens(k)} className={lens === k ? "on" : undefined}>
              {k === "idle" ? "Dormant" : k}
            </button>
          ))}
        </div>
        <div className="seg" style={{ marginLeft: "auto" }}>
          <button onClick={() => setZoom((z) => Math.max(0.7, z - 0.2))} aria-label="Zoom out">−</button>
          <button onClick={() => setZoom((z) => Math.min(2, z + 0.2))} aria-label="Zoom in">+</button>
          <button onClick={() => { setZoom(1); setSelected(null); }}>Reset</button>
        </div>
      </div>

      <div className="flex min-h-0" style={{ border: "1px solid var(--ink)" }}>
        {/* ── Map ─────────────────────────────────────────────────────────── */}
        <div ref={canvasRef} className="relative flex-1 min-w-0">

          <svg
            viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
            preserveAspectRatio="xMidYMid meet"
            className="relative w-full h-[265px] sm:h-[310px] select-none"
            onClick={() => setSelected(null)}
          >
            <defs>
              <filter id="netGlow" x="-70%" y="-70%" width="240%" height="240%">
                <feGaussianBlur stdDeviation="4" result="b" />
                <feMerge>
                  <feMergeNode in="b" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            <g
              transform={`translate(${cx} ${cy}) scale(${zoom}) translate(${-cx} ${-cy})`}
              style={{ transition: "transform .35s cubic-bezier(.16,1,.3,1)" }}
            >
              {/* Links behind nodes. The group handles the mount fade so each
                  line's own opacity stays free for instant hover response —
                  and so framer never takes over stroke-dasharray, which the
                  dashed co-ownership links and the flow animation both use. */}
              <motion.g
                strokeLinecap="round"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.15, duration: 0.7, ease: "easeOut" }}
              >
                {links.map((l, i) => {
                  const a = byKey[l.a];
                  const b = byKey[l.b];
                  if (!a || !b) return null;
                  const hot = focus === l.a || focus === l.b;
                  const dim = lit ? !hot : false;
                  return (
                    <line
                      key={`${l.a}-${l.b}-${i}`}
                      x1={a.x}
                      y1={a.y}
                      x2={b.x}
                      y2={b.y}
                      stroke={hot ? (l.jv ? NET.jv : NET.company) : "currentColor"}
                      strokeWidth={(hot ? 1.7 : l.jv ? 1.15 : 1.05) * unit}
                      strokeDasharray={l.jv ? `${4 * unit} ${4.5 * unit}` : undefined}
                      className={`text-muted-foreground ${hot && l.jv ? "net-flow" : ""}`}
                      style={{
                        opacity: hot ? 0.95 : dim ? 0.07 : 0.38,
                        transition: "opacity .25s ease, stroke-width .25s ease",
                        ["--net-dash" as string]: `${8.5 * unit}`,
                      }}
                    />
                  );
                })}
              </motion.g>

              {/* Nodes */}
              {nodes.map((n, i) => {
                const dim = nodeDim(n);
                const isSel = selected === n.key;
                const fill = nodeFill(n);
                const showLabel =
                  n.kind === "company" ||
                  isSel ||
                  hovered === n.key ||
                  nodes.length <= 14;

                return (
                  <g
                    key={n.key}
                    className="net-float"
                    style={{
                      animationDelay: `${(i % 7) * 0.8}s`,
                      animationDuration: `${7 + (i % 5)}s`,
                    }}
                  >
                    <motion.g
                      initial={{ opacity: 0, scale: 0.3 }}
                      animate={{ opacity: dim ? 0.2 : 1, scale: 1 }}
                      transition={{
                        opacity: { duration: 0.25 },
                        scale: {
                          delay: 0.2 + i * 0.025,
                          duration: 0.55,
                          ease: [0.16, 1, 0.3, 1],
                        },
                      }}
                      style={{ transformBox: "fill-box", transformOrigin: "center" }}
                      className="cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelected(isSel ? null : n.key);
                      }}
                      onMouseEnter={() => setHovered(n.key)}
                      onMouseLeave={() => setHovered(null)}
                    >
                      {/* Halo */}
                      <circle
                        cx={n.x}
                        cy={n.y}
                        r={n.r + (isSel ? 11 : 7)}
                        fill={fill}
                        style={{
                          opacity: isSel ? 0.22 : hovered === n.key ? 0.16 : 0.08,
                          transition: "all .25s ease",
                        }}
                      />
                      {/* Disc */}
                      <circle
                        cx={n.x}
                        cy={n.y}
                        r={n.r}
                        fill={n.kind === "company" ? "transparent" : fill}
                        stroke={fill}
                        strokeWidth={(n.kind === "company" ? 2.1 : 1.2) * unit}
                        strokeOpacity={n.kind === "company" ? 0.9 : 0.55}
                        filter={isSel ? "url(#netGlow)" : undefined}
                      />
                      {/* Company hubs get an inner pip so they read as a ring */}
                      {n.kind === "company" && (
                        <circle cx={n.x} cy={n.y} r={n.r * 0.26} fill={fill} opacity={0.95} />
                      )}
                      {/* Selection ring */}
                      {isSel && (
                        <circle
                          cx={n.x}
                          cy={n.y}
                          r={n.r + 6 * unit}
                          fill="none"
                          stroke={fill}
                          strokeWidth={1 * unit}
                          strokeOpacity={0.7}
                          strokeDasharray={`${3 * unit} ${3 * unit}`}
                          className="net-flow"
                          style={{ ["--net-dash" as string]: `${6 * unit}` }}
                        />
                      )}

                      {showLabel && (
                        <text
                          x={n.x}
                          y={n.y + n.r + 11 * unit}
                          textAnchor="middle"
                          className={
                            n.kind === "company"
                              ? "fill-current text-foreground"
                              : "fill-current text-muted-foreground"
                          }
                          style={{
                            fontSize:
                              (n.kind === "company" ? labelSpec.coPx : labelSpec.prPx) *
                              unit,
                            fontWeight: n.kind === "company" ? 700 : 500,
                            letterSpacing: n.kind === "company" ? "0.06em" : 0,
                            textTransform:
                              n.kind === "company" ? "uppercase" : "none",
                            opacity: dim ? 0.25 : 1,
                            transition: "opacity .25s ease",
                            pointerEvents: "none",
                          }}
                        >
                          {netShort(
                            n.label,
                            n.kind === "company" ? labelSpec.coChars : labelSpec.prChars,
                          )}
                        </text>
                      )}
                    </motion.g>
                  </g>
                );
              })}
            </g>
          </svg>

          {/* Legend */}
          <div className="label" style={{ position: "absolute", left: 12, bottom: 8, display: "flex", gap: 14, pointerEvents: "none" }}>
            <span><i style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", border: "1.5px solid var(--ink)", marginRight: 5 }} />Company</span>
            <span><i style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: "var(--blue)", marginRight: 5 }} />Active</span>
            <span><i style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: "var(--blue-mid)", marginRight: 5 }} />Co-owned</span>
          </div>

          {/* Mobile context chip — the rail is desktop-only */}
          {sel && (
            <div className="md:hidden absolute right-2 bottom-2 max-w-[62%] px-2.5 py-1.5" style={{ border: "1px solid var(--ink)", background: "var(--sheet)" }}>
              <p className="font-heading text-[0.6875rem] font-semibold text-foreground truncate">
                {sel.label}
              </p>
              <p className="text-[0.5625rem] text-muted-foreground truncate">
                {sel.kind === "company"
                  ? `${sel.count} project${sel.count === 1 ? "" : "s"}`
                  : sel.project?.company || "Unassigned"}
              </p>
            </div>
          )}
        </div>

        {/* ── Context rail ────────────────────────────────────────────────── */}
        <aside className="hidden md:flex w-[190px] shrink-0 flex-col" style={{ borderLeft: "1px solid var(--ink)", padding: "12px 14px" }}>
          {sel ? (
            <div key={sel.key}>
              <p className="label">{sel.kind === "company" ? "Company" : sel.project?.type || "Project"}</p>
              <p style={{ fontFamily: "Sora, sans-serif", fontWeight: 600, fontSize: 14, margin: "6px 0 10px", lineHeight: 1.25, overflowWrap: "anywhere" }}>{sel.label}</p>
              {(sel.kind === "company"
                ? [{ l: "Projects", v: String(sel.count) }, { l: "Active", v: String(sel.activeCount) }]
                : [
                    { l: "Company", v: sel.project?.company || "Unassigned" },
                    { l: "Team", v: String(sel.project?.teamSize || "—") },
                    { l: "Status", v: sel.active ? "Active" : "Dormant" },
                    ...(sel.jv ? [{ l: "Co-owned by", v: `${(sel.project?.coCompanyIds?.length ?? 0) + 1} companies` }] : []),
                  ]
              ).map((row) => (
                <div key={row.l} style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, padding: "7px 0", borderTop: "1px solid var(--rule-soft)" }}>
                  <span className="label">{row.l}</span>
                  <span style={{ fontSize: 12.5, fontWeight: 600, textAlign: "right", overflowWrap: "anywhere" }}>{row.v}</span>
                </div>
              ))}
            </div>
          ) : (
            <>
              <p className="label" style={{ marginBottom: 8 }}>Busiest hubs</p>
              {hubs.map((h) => (
                <button
                  key={h.key}
                  onClick={() => setSelected(h.key)}
                  onMouseEnter={() => setHovered(h.key)}
                  onMouseLeave={() => setHovered(null)}
                  style={{ display: "block", width: "100%", padding: "6px 0" }}
                >
                  <span style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
                    <span style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.label}</span>
                    <span className="figure" style={{ fontSize: 14 }}>{h.count}</span>
                  </span>
                  <span style={{ display: "block", height: 3, marginTop: 5, background: "var(--rule-soft)" }}>
                    <span className="grow" style={{ display: "block", height: 3, width: `${(h.count / hubMax) * 100}%`, background: "var(--blue)" }} />
                  </span>
                </button>
              ))}
              <p style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: "auto", paddingTop: 10 }}>Select a node to inspect it.</p>
            </>
          )}
        </aside>
      </div>

      {/* ── Totals ─────────────────────────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", marginTop: 14 }}>
        {[
          { l: "Active projects", v: activeCount },
          { l: "Companies", v: companyCount },
          { l: "Projects in all", v: total },
        ].map((x, i) => (
          <div key={x.l} style={{ paddingLeft: i ? 16 : 0, borderLeft: i ? "1px solid var(--rule)" : 0 }}>
            <span className="figure" style={{ fontSize: 26 }}><AnimatedCounter target={x.v} /></span>
            <span className="label" style={{ display: "block", marginTop: 6 }}>{x.l}</span>
          </div>
        ))}
      </div>
    </div>
  );
}


// ─── HomePage ─────────────────────────────────────────────────────────────────
// Seven days: bars for how many documents were made, a line for their rupee value.
function WeekPlot({ rows }: { rows: Array<{ day: string; count: number; amount: number }> }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 760, H = 220, pad = 8, top = 22, base = 178;
  const n = Math.max(1, rows.length);
  const slot = (W - pad * 2) / n;
  const maxCount = Math.max(1, ...rows.map((r) => r.count));
  const maxAmount = Math.max(1, ...rows.map((r) => r.amount));
  const y = (v: number, max: number) => base - (v / max) * (base - top);
  const cx = (i: number) => pad + slot * i + slot / 2;
  const line = rows.map((r, i) => `${i ? "L" : "M"}${cx(i).toFixed(1)},${y(r.amount, maxAmount).toFixed(1)}`).join(" ");
  const active = hover != null ? rows[hover] : null;
  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "baseline", minHeight: 22, marginBottom: 6 }}>
        <span className="label" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><i style={{ width: 10, height: 10, background: "var(--blue)", display: "inline-block" }} /> Documents</span>
        <span className="label" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><i style={{ width: 14, height: 2, background: "var(--ink)", display: "inline-block" }} /> Value</span>
        <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--ink-2)" }}>
          {active ? `${active.day} · ${active.count.toLocaleString("en-IN")} document${active.count === 1 ? "" : "s"} · ${compactINR(active.amount)}` : "Hover a day for its figures"}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label="Documents created and their value, last seven days" onMouseLeave={() => setHover(null)}>
        <line x1={pad} x2={W - pad} y1={base} y2={base} stroke="var(--rule)" />
        <line x1={pad} x2={W - pad} y1={top} y2={top} stroke="var(--rule)" strokeDasharray="2 5" />
        <text x={pad + 2} y={top - 6} fontFamily="DM Sans, sans-serif" fontSize="10" fill="var(--graphite)">{maxCount.toLocaleString("en-IN")} documents · {compactINR(maxAmount)}</text>
        {rows.map((r, i) => {
          const h = base - y(r.count, maxCount);
          const w = Math.min(46, slot * 0.5);
          return (
            <g key={i} onMouseEnter={() => setHover(i)}>
              <rect x={pad + slot * i} y={0} width={slot} height={H} fill={hover === i ? "var(--blue-wash)" : "transparent"} />
              <rect x={cx(i) - w / 2} y={base - h} width={w} height={Math.max(0, h)} fill="var(--blue)" fillOpacity={hover == null || hover === i ? 0.9 : 0.4} />
              {r.count > 0 && <text x={cx(i)} y={base - h - 6} textAnchor="middle" fontFamily="Sora, sans-serif" fontWeight="600" fontSize="11" fill="var(--ink)">{r.count}</text>}
              <text x={cx(i)} y={base + 20} textAnchor="middle" fontFamily="Sora, sans-serif" fontWeight="600" fontSize="10" letterSpacing="1" fill={hover === i ? "var(--ink)" : "var(--graphite)"}>{r.day.toUpperCase()}</text>
            </g>
          );
        })}
        {rows.length > 1 && (
          <>
            <path className="draw" d={line} fill="none" stroke="var(--ink)" strokeWidth="2" strokeLinejoin="round" pointerEvents="none" />
            {rows.map((r, i) => (
              <circle key={i} cx={cx(i)} cy={y(r.amount, maxAmount)} r={hover === i ? 4.5 : 3} fill="var(--sheet)" stroke="var(--ink)" strokeWidth="1.6" pointerEvents="none" />
            ))}
          </>
        )}
      </svg>
    </div>
  );
}

export default function HomePage() {
  const { currentUser, canAccessPage } = useAuth();
  const navigate = useNavigate();

  const role: UserRoleStr = currentUser?.role ?? "";
  const firstName = currentUser?.name?.split(" ")[0] ?? "there";

  // Customer portal redirect
  if (role === "customer") return <Navigate to="/customer-portal" replace />;

  const privileged = isPrivileged(role);
  const isDba = role === "dba";
  const isAdmin = privileged;

  // Compute which modules this user can see.
  // Uses canAccessPage (same source as ModuleStrip) so all roles — including
  // "engineer", custom roles, etc. — get the correct tile set based on their
  // actual DB-assigned pagePermissions rather than hardcoded role strings.
  const MODULE_PAGES: Record<string, string[]> = {
    finance: [
      "finance-dashboard",
      "new-payment",
      "received-payment",
      "brs",
      "transactions",
    ],
    material: [
      "material-dashboard",
      "purchase-orders",
      "grn-master",
      "material-request",
      "material-issues",
      "stock-ledger",
    ],
    followup: [
      "followup-dashboard",
      "followup-applications",
      "followup-bookings",
      "followup-agreements",
      "followup-demands",
    ],
    engineering: [
      "engineering-dashboard",
      "boq",
      "engineering-work-order",
      "work-done",
      "dpr",
    ],
    ticket: ["ticket-dashboard", "tickets"],
    sales: ["sale-order", "sale-invoice", "sales-payment"],
    salesAutomation: ["sa-leads", "sa-inquiry", "sa-site-visits", "sa-campaigns", "sa-ads"],
    civilworkdpr: [
      "civilworkdpr-dashboard",
      "civilworkdpr-dependency",
      "civilworkdpr-work-done",
      "civilworkdpr-activity-reporting",
      "civilworkdpr-quality-check",
      "civilworkdpr-work-transfer",
      "civilworkdpr-worker-attendance",
      "civilworkdpr-daily-labour",
      "civilworkdpr-amendment",
      "civilworkdpr-query",
      "civilworkdpr-room-master",
    ],
    crm: [
      "crm-dashboard",
      "crm-customers",
      "crm-applications",
      "crm-bookings",
      "crm-payments",
    ],
    fixedasset: [
      "fixed-asset-record",
      "fixed-asset-tagging",
      "fixed-asset-assignment",
      "asset-transfer",
      "fixed-asset-quality-check",
      "fixed-asset-maintenance",
      "fixed-asset-depreciation-generate",
    ],
  };

  const hasModuleAccess = (moduleId: string): boolean => {
    if (privileged) return true;
    return (MODULE_PAGES[moduleId] ?? []).some((pk) =>
      canAccessPage(pk as any),
    );
  };

  const access = {
    finance: hasModuleAccess("finance"),
    material: hasModuleAccess("material"),
    engineering: hasModuleAccess("engineering"),
    followup: hasModuleAccess("followup"),
    ticket: hasModuleAccess("ticket"),
    sales: hasModuleAccess("sales"),
    salesAutomation: hasModuleAccess("salesAutomation"),
    civilworkdpr: hasModuleAccess("civilworkdpr"),
    crm: hasModuleAccess("crm"),
    fixedasset: hasModuleAccess("fixedasset"),
    approvals: privileged,
    admin: privileged && !isDba,
    dba: isDba,
  };

  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  const { data, isLoading, isError, refetch, isFetching, dataUpdatedAt } =
    useQuery<HomeDashboardData>({
      // Include access flags in key so the query refires when permissions change
      queryKey: [
        "home-dashboard",
        role,
        access.finance,
        access.material,
        access.engineering,
      ],
      queryFn: () => fetchHomeDashboard(isAdmin, access),
      staleTime: 5 * 60 * 1000,      // 5 min — aggregate stats don't need sub-2-min freshness
      refetchInterval: 10 * 60 * 1000, // 10 min background poll
      retry: 2,
    });

  // Real project list for the "Project Network" panel — /api/project-master
  // has no engineering permission gate (same reason fetchHomeDashboard
  // itself uses it for the active-project-count fallback), so every role
  // that reaches Home can resolve real project names for the map's nodes.
  const { data: projectListData } = useQuery({
    queryKey: ["home-project-list"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/project-master");
      if (!res.ok) throw new Error("Failed to fetch project list");
      return res.json().catch(() => []);
    },
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
    retry: 1,
  });
  // Memoised on the raw payload: ProjectNetworkMap solves a force layout from
  // this array's identity, so rebuilding it on every Home render (this page
  // re-renders on each poll) would re-run that solve for nothing.
  const projectList: ProjectNode[] = useMemo(() => {
    const raw = Array.isArray(projectListData)
      ? projectListData
      : Array.isArray((projectListData as any)?.data)
        ? (projectListData as any).data
        : [];
    return raw.map((p: any) => ({
      id: p.Id ?? p.id,
      name: p.Name ?? p.name ?? `Project #${p.Id ?? p.id}`,
      active: p.IsActive === 1 || p.IsActive === true,
      code: p.ShortName || p.Code || null,
      companyId: p.CompanyId ?? null,
      company: p.CompanyName ?? null,
      type: p.Type ?? null,
      teamSize: Number(p.TeamSize) || 0,
      startDate: p.StartDate ?? null,
      // Co-owning companies (JV / multi-company projects) — these become the
      // cross-links that make the map read as a network and not a plain tree.
      coCompanyIds: String(p.MultiCompanyIds ?? "")
        .split(",")
        .map((x: string) => parseInt(x, 10))
        .filter((x: number) => Number.isFinite(x)),
    }));
  }, [projectListData]);

  // Civil Work DPR isn't part of the main home-dashboard aggregator yet —
  // it has its own lightweight stats endpoint, so the tile queries that
  // directly instead of growing the shared backend aggregation.
  const { data: civilDpr } = useQuery({
    queryKey: ["home-civilworkdpr"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/civilworkdpr-dashboard");
      if (!res.ok) throw new Error("Failed to fetch Civil Work DPR stats");
      return res.json().catch(() => ({}));
    },
    enabled: access.civilworkdpr,
    staleTime: 2 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
    retry: 1,
  });

  // CRM dashboard stats
  const { data: crmData } = useQuery({
    queryKey: ["home-crm"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/crm/dashboard");
      if (!res.ok) throw new Error("CRM stats unavailable");
      return res.json().catch(() => ({}));
    },
    enabled: access.crm,
    staleTime: 2 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
    retry: 1,
  });

  // Sales Automation marketing totals and the Fixed Asset register — fetched
  // only for users who can open those modules, tolerating a failure (a missing
  // sub-right just leaves that module's tiles at zero).
  const { data: saData } = useQuery({
    queryKey: ["home-sa-marketing"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/sa/dashboard/marketing");
      if (!res.ok) throw new Error("Sales Automation stats unavailable");
      return res.json().catch(() => ({}));
    },
    enabled: access.salesAutomation,
    staleTime: 2 * 60 * 1000,
    retry: 0,
  });
  const { data: faList } = useQuery({
    queryKey: ["home-fixed-assets"],
    queryFn: () => getFixedAssets(),
    enabled: access.fixedasset,
    staleTime: 5 * 60 * 1000,
    retry: 0,
  });
  const faSummary = useMemo(() => {
    if (!faList) return null;
    const live = faList.filter((a) => a.AssetStatus !== "Sold" && a.AssetStatus !== "Scrapped" && (a as any).Status !== "Deleted");
    return {
      count: live.length,
      active: live.filter((a) => a.AssetStatus === "Active").length,
      pending: live.filter((a) => a.AssetStatus === "Pending").length,
      totalCost: live.reduce((s, a) => s + Number(a.PurchaseCost || 0), 0),
    };
  }, [faList]);

  // How much and how recently this user works in each module — decides which
  // module's tiles lead the page. Ids match the access flags above.
  const accessibleModules = useMemo(
    () =>
      (
        [
          access.finance && "finance",
          access.material && "material",
          access.engineering && "engineering",
          access.followup && "followup",
          access.ticket && "ticket",
          access.sales && "sales",
          access.salesAutomation && "salesAutomation",
          access.civilworkdpr && "civilworkdpr",
          access.crm && "crm",
          access.fixedasset && "fixedasset",
        ] as const
      ).filter(Boolean) as HomeModuleId[],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [access.finance, access.material, access.engineering, access.followup, access.ticket, access.sales, access.salesAutomation, access.civilworkdpr, access.crm, access.fixedasset],
  );
  const { data: ranking } = useQuery({
    queryKey: ["home-module-ranking", accessibleModules.join(",")],
    queryFn: () => getModuleRanking(accessibleModules),
    enabled: accessibleModules.length > 0,
    staleTime: 2 * 60 * 1000,
    retry: 0,
  });

  // ── Universal recent-activity feed (server-side UNION across every module) ──
  const feedModules = privileged
    ? ""
    : Object.entries(access)
        .filter(([, v]) => v)
        .map(([k]) => (k === "approvals" ? "" : k))
        .filter(Boolean)
        .join(",");
  const { data: liveFeed } = useQuery<{ items: LiveActivityItem[] }>({
    queryKey: ["home-activity-feed", feedModules],
    queryFn: async () => {
      const qs = feedModules ? `?modules=${encodeURIComponent(feedModules)}&limit=50` : "?limit=50";
      const res = await fetchWithAuth(`/api/home/activity-feed${qs}`);
      if (!res.ok) throw new Error("activity feed unavailable");
      return res.json();
    },
    staleTime: 60 * 1000,
    refetchInterval: 90 * 1000,
    retry: 1,
  });

  // Per-day totals for the last 7 days (counts + rupee value), aggregated on
  // the server. The charts used to be bucketed from the 50-item feed above,
  // which on a busy site only reaches back a day or two — so every earlier day
  // read zero.
  const { data: weekActivity } = useQuery<{ days: Array<{ date: string; count: number; amount: number }> }>({
    queryKey: ["home-activity-week", feedModules],
    queryFn: async () => {
      const qs = feedModules ? `?modules=${encodeURIComponent(feedModules)}` : "";
      const res = await fetchWithAuth(`/api/home/activity-week${qs}`);
      if (!res.ok) throw new Error("activity totals unavailable");
      return res.json();
    },
    staleTime: 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
    retry: 1,
  });

  const fin  = data?.finance;
  const mat  = data?.material;
  const adm  = data?.admin;
  const tick = data?.tickets;
  const eng  = data?.engineering;
  const fol  = data?.followup;
  const sal  = data?.sales;
  const pendingApprovals = data?.pendingApprovals ?? [];

  // Derive handy CRM scalars from the grouped recordsets
  const crmBookings     = (crmData?.bookings     ?? []) as { Status: string; Count: number; TotalValue: number }[];
  const crmApps         = (crmData?.applications ?? []) as { Status: string; Count: number }[];
  const crmTickets      = (crmData?.serviceTickets ?? []) as { Status: string; Count: number }[];
  const crmPendingApps  = crmApps.find(a => a.Status === "Pending")?.Count ?? 0;
  const crmOverdue      = crmData?.payments?.OverdueCount ?? 0;

  const lastUpdated = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  // ── Actionable insights — "needs your attention" ─────────────────────────
  type Sev = "high" | "med" | "low";
  const rawAttn: Array<Attention | false> = [
    access.approvals && { severity: "high" as Sev, label: "Approvals awaiting you", count: pendingApprovals.length, hint: `${new Set(pendingApprovals.map((a: ApprovalInboxItem) => a.Module)).size} module(s) affected`, href: "/admin/approval/inbox", icon: FileCheck },
    access.followup && { severity: "high" as Sev, label: "Follow-ups overdue", count: fol?.overdue ?? 0, hint: "Past their due date", href: "/followup", icon: Table },
    access.ticket && { severity: "high" as Sev, label: "Urgent tickets open", count: tick?.urgent ?? 0, hint: "High-priority, unresolved", href: "/ticket", icon: TriangleAlert },
    access.crm && { severity: "high" as Sev, label: "CRM payments overdue", count: crmOverdue, hint: "Milestones past due", href: "/crm/dashboard", icon: IndianRupee },
    access.sales && { severity: "med" as Sev, label: "Sale orders pending approval", count: sal?.pendingApproval ?? 0, hint: "Waiting in the approval queue", href: "/sales/sale-order", icon: ShoppingCart },
    access.engineering && { severity: "med" as Sev, label: "Work done pending certification", count: eng?.workDone?.pending ?? 0, hint: "Awaiting engineer sign-off", href: "/engineering", icon: Hammer },
    access.civilworkdpr && { severity: "med" as Sev, label: "DPR entries pending review", count: civilDpr?.progress?.pendingReviewCount ?? 0, hint: "Daily progress awaiting review", href: "/civilworkdpr", icon: Pickaxe },
    access.followup && { severity: "med" as Sev, label: "Follow-ups due today", count: fol?.dueToday ?? 0, hint: "Scheduled for today", href: "/followup", icon: Table },
    access.crm && { severity: "med" as Sev, label: "CRM applications pending", count: crmPendingApps, hint: "Not yet processed", href: "/crm/dashboard", icon: HeartHandshake },
    access.ticket && { severity: "low" as Sev, label: "Tickets open", count: (tick?.pending ?? 0) + (tick?.inProgress ?? 0), hint: "Pending + in progress", href: "/ticket", icon: Ticket },
    access.material && { severity: "low" as Sev, label: "Purchase orders open", count: mat?.purchaseOrders?.open ?? 0, hint: "Not yet closed / cancelled", href: "/material/purchase-order", icon: Package },
  ];
  const sevRank: Record<Sev, number> = { high: 0, med: 1, low: 2 };
  const attentionRaw: Attention[] = (rawAttn.filter(Boolean) as Attention[]).filter((a) => a.count > 0);

  // ── Tiles — every module offers a few (see pages/home/homeTiles.ts); which
  // ones lead the page follows the user's own usage. Admin tiles sit last.
  const tileData: HomeTileData = {
    loading: isLoading,
    fin, mat, eng, adm, tick, fol, sal,
    crm: crmData
      ? { bookings: crmBookings, applications: crmApps, serviceTickets: crmTickets, overdue: crmOverdue }
      : null,
    dpr: civilDpr ?? null,
    sa: saData ?? null,
    fa: faSummary,
  };
  const moduleOrder = rankedModuleOrder(
    ranking?.modules.map((m) => m.module),
    [...accessibleModules, ...(access.admin || access.dba ? (["admin"] as HomeModuleId[]) : [])],
    ["finance", "material", "engineering", "followup", "ticket", "sales", "salesAutomation", "civilworkdpr", "crm", "fixedasset", "admin"],
  );
  const orderedTiles = orderTiles(HOME_TILES, moduleOrder);
  const kpis = orderedTiles.map((t) => {
    const v = t.compute(tileData);
    return { id: t.id, module: t.module, label: t.label, value: isLoading ? null : v.value, prefix: v.prefix, suffix: v.suffix, color: t.color, icon: t.icon };
  });
  const heroIds = new Set(pickHeroTiles(orderedTiles, moduleOrder).map((t) => t.id));
  const heroKpis = kpis.filter((k) => heroIds.has(k.id));
  const restKpis = kpis.filter((k) => !heroIds.has(k.id));
  const spotlightModules = moduleOrder.filter((m) => m !== "admin").slice(0, 3);
  // Share of the user's recorded module visits, across every module they can open.
  const totalModuleVisits = (ranking?.modules ?? []).reduce((a, m) => a + m.visits, 0);
  const moduleSharePct = (m: string): string | null => {
    const v = ranking?.modules.find((x) => x.module === m)?.visits ?? 0;
    if (!totalModuleVisits || !v) return null;
    const pct = (v / totalModuleVisits) * 100;
    return pct < 1 ? "<1%" : `${Math.round(pct)}%`;
  };

  // Within the same urgency, items from the modules this user works in come
  // first; module-less items (the approval queue) lead their urgency band.
  const modulePos = new Map(moduleOrder.map((m, i) => [m as string, i]));
  const attnPos = (a: Attention) => {
    const m = moduleOfPath(a.href);
    return m == null ? -1 : (modulePos.get(m) ?? 99);
  };
  const attention: Attention[] = [...attentionRaw].sort(
    (a, b) => sevRank[a.severity] - sevRank[b.severity] || attnPos(a) - attnPos(b) || b.count - a.count,
  );

  const feedItems: LiveActivityItem[] = liveFeed?.items ?? [];

  // ── Last-7-days activity series — real per-day totals from the server
  // (India days), not bucketed from the short live feed. Until they load, the
  // axis still shows the last 7 days (all zero).
  const dayLabel = (isoDate: string) =>
    new Date(`${isoDate}T12:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", timeZone: "UTC" });
  const fallbackDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(Date.now() + 330 * 60_000);
    d.setUTCDate(d.getUTCDate() - (6 - i));
    return { date: d.toISOString().slice(0, 10), count: 0, amount: 0 };
  });
  const activitySeries = (weekActivity?.days?.length ? weekActivity.days : fallbackDays).map((d) => ({
    day: dayLabel(d.date),
    count: d.count,
    amount: d.amount,
  }));

  // ── Work Order completion — the one genuinely percentage-shaped metric
  // available, given the hero gauge (mirrors "Profit Analysis" in the
  // reference layout).
  const woTotal = eng?.workOrders?.total ?? 0;
  const woOpen = eng?.workOrders?.open ?? 0;
  const woCompletionPct = woTotal > 0 ? Math.round(((woTotal - woOpen) / woTotal) * 100) : 0;

  // Always show at least something
  const hasAnyAccess = Object.values(access).some(Boolean);


  // Explicit, clean ticks for both charts — see niceTicks' comment.

  const kpiText = (k: { value: number | string | null; prefix?: string; suffix?: string }) =>
    k.value == null ? null : `${k.prefix ?? ""}${typeof k.value === "number" ? k.value.toLocaleString("en-IN") : k.value}${k.suffix ?? ""}`;
  const attnMax = Math.max(1, ...attention.map((x) => x.count));
  const woDonePct = woTotal > 0 ? ((woTotal - woOpen) / woTotal) * 100 : 0;
  const today = new Date();

  return (
    <div className="font-body flex flex-col -m-4 md:-m-6" /* cancels the layout's page padding: the sheet's border runs right round the screen */ style={{ minHeight: "calc(100vh - 3.5rem)" }}>
      <style>{SHEET_CSS}</style>
      <div className="crm-sheet sheet-in" style={{ flex: 1, margin: 6 }}>
        {/* Title block */}
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "stretch" }}>
          <div style={{ flex: "1 1 320px", padding: "28px 22px 26px", minWidth: 0 }}>
            <p className="label">CivilierERP · {role.replace(/_/g, " ") || "user"}</p>
            <h1 className="title" style={{ fontSize: "clamp(40px, 6.6vw, 104px)", margin: "10px 0 0", lineHeight: 1, overflowWrap: "anywhere" }}>
              {greeting}, <span style={{ color: "var(--blue)" }}>{firstName}.</span>
            </h1>
            {spotlightModules.length > 0 && (
              <p style={{ margin: "12px 0 0", fontSize: 13, color: "var(--ink-2)" }}>
                <span className="label" style={{ marginRight: 8 }}>You work most in</span>
                {spotlightModules.map((m, i) => (
                  <span key={m}>
                    {i > 0 && " · "}
                    <b style={{ color: "var(--ink)" }}>{MODULE_LABELS[m]}</b>
                    {moduleSharePct(m) && <span style={{ color: "var(--graphite)" }}> {moduleSharePct(m)}</span>}
                  </span>
                ))}
              </p>
            )}
          </div>
          <div className="mono titleblock" style={{ flex: "1 1 280px", maxWidth: 380, minWidth: 240, display: "grid", gridTemplateColumns: "1fr 1fr", borderLeft: "1px solid var(--ink)", fontSize: 13 }}>
            <div style={{ gridColumn: "1 / -1", padding: "10px 14px", borderBottom: "1px solid var(--ink)" }}>
              <span className="label" style={{ display: "block", marginBottom: 3 }}>Day</span>
              {today.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
            </div>
            <div style={{ padding: "10px 14px", borderRight: "1px solid var(--ink)" }}>
              <span className="label" style={{ display: "block", marginBottom: 3 }}>Read at</span>
              {lastUpdated ?? "—"}
            </div>
            <div style={{ padding: "10px 14px", display: "flex", alignItems: "flex-end" }}>
              <button onClick={() => refetch()} disabled={isFetching} className="label link" style={{ color: "var(--blue)" }}>
                {isFetching ? "Reading…" : "Re-read"}
              </button>
            </div>
          </div>
        </div>

        {isError && (
          <div className="cell" style={{ color: "var(--red)", fontSize: 13 }}>Could not reach the server — showing the last figures read.</div>
        )}

        {!hasAnyAccess ? (
          <div className="cell" style={{ textAlign: "center", padding: "48px 22px" }}>
            <p style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>No module access assigned.</p>
            <p style={{ fontSize: 13, color: "var(--graphite)", margin: "6px 0 0" }}>Contact your administrator to get module permissions.</p>
          </div>
        ) : (
          <>
            {/* A: key numbers */}
            {heroKpis.length > 0 && (
              <Detail tag="A" title="Key numbers" note="From the modules you use most">
                <div className="grid4" style={{ gap: "18px 0" }}>
                  {heroKpis.map((k, i) => (
                    <div key={k.id} style={{ padding: "0 18px", borderLeft: i % 4 ? "1px solid var(--rule)" : 0, minWidth: 0 }}>
                      <div className="label" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{k.label}</div>
                      <div className="figure" style={{ fontSize: "clamp(26px, 3vw, 42px)", marginTop: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {typeof k.value === "number" ? <AnimatedCounter target={k.value} prefix={k.prefix} suffix={k.suffix} duration={1.2} /> : kpiText(k) ?? <span className="skel" style={{ display: "inline-block", height: 30, width: 90 }} />}
                      </div>
                      <div style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: 8 }}>{MODULE_LABELS[k.module as HomeModuleId] ?? k.module}</div>
                    </div>
                  ))}
                </div>
              </Detail>
            )}

            {/* B + C */}
            <div className="grid2">
              <Detail tag="B" title="Seven days of work" note="Documents on the bars, their value on the line">
                <WeekPlot rows={activitySeries} />
              </Detail>

              <Detail tag="C" title="Work orders" note="Completed against open">
                <div style={{ display: "flex", alignItems: "flex-end", gap: 10, flexWrap: "wrap" }}>
                  <span className="figure" style={{ fontSize: "clamp(40px, 5vw, 64px)" }}>{woCompletionPct}<span style={{ fontSize: "0.4em", fontWeight: 500, marginLeft: 3 }}>%</span></span>
                  <span style={{ paddingBottom: 6, fontSize: 13.5, color: "var(--ink-2)" }}>
                    <b style={{ color: "var(--ink)" }}>{(woTotal - woOpen).toLocaleString("en-IN")}</b> of {woTotal.toLocaleString("en-IN")} completed
                  </span>
                </div>
                <div style={{ marginTop: 18 }}>
                  <div style={{ display: "flex", height: 26, border: "1.5px solid var(--ink)", background: "var(--sheet)" }}>
                    <div className="grow" style={{ width: `${woDonePct}%`, background: "var(--blue)" }} />
                    <div className="hatch" style={{ flex: 1 }} />
                  </div>
                  <div style={{ display: "flex" }}>
                    <div style={{ width: `${Math.min(Math.max(woDonePct, 22), 78)}%`, minWidth: 0 }}><Dimension from={0} to={100} text={`${(woTotal - woOpen).toLocaleString("en-IN")} done`} color="var(--blue)" /></div>
                    <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}><Dimension from={0} to={100} text={`${woOpen.toLocaleString("en-IN")} open`} /></div>
                  </div>
                </div>
                <button onClick={() => navigate("/engineering")} className="label link" style={{ marginTop: 18, display: "inline-block" }}>Open Engineering</button>
              </Detail>
            </div>

            {/* D + E */}
            <div className="grid2">
              <Detail tag="D" title="Waiting on you" note={attention.length ? `${attention.length} open` : "All clear"}>
                {isLoading ? (<><Skel h={30} /><Skel h={30} /><Skel h={30} /></>) : attention.length === 0 ? (
                  <p style={{ fontSize: 14, color: "var(--ink-2)", margin: 0 }}>Nothing needs your action right now.</p>
                ) : attention.slice(0, 10).map((x, i) => {
                  const hot = x.severity === "high";
                  return (
                    <button key={x.label} onClick={() => navigate(x.href)} className={`row${hot ? " hot" : ""}`}>
                      <span style={{ fontSize: 10, color: hot ? "var(--red)" : "var(--graphite)" }}>{String(i + 1).padStart(2, "0")}</span>
                      <span style={{ minWidth: 0 }}>
                        <span style={{ display: "block", fontSize: 13.5, fontWeight: 600, color: hot ? "var(--red)" : "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.label}</span>
                        <span style={{ display: "block", height: 3, marginTop: 6, background: "var(--rule-soft)" }}>
                          <span className="grow" style={{ display: "block", height: 3, width: `${(x.count / attnMax) * 100}%`, background: hot ? "var(--red)" : "var(--blue)" }} />
                        </span>
                        <span style={{ display: "block", fontSize: 11.5, color: "var(--graphite)", marginTop: 5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.hint}</span>
                      </span>
                      <span className="figure" style={{ fontSize: 22, textAlign: "right", color: hot ? "var(--red)" : "var(--ink)" }}>{x.count.toLocaleString("en-IN")}</span>
                    </button>
                  );
                })}
              </Detail>

              <Detail tag="E" title="More numbers">
                {restKpis.length === 0 ? (
                  <p style={{ fontSize: 13, color: "var(--graphite)", margin: 0 }}>Nothing else to show.</p>
                ) : (
                  <div className="noscroll" style={{ maxHeight: 420, overflowY: "auto", display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", columnGap: 22 }}>
                    {restKpis.map((k) => (
                      <div key={k.id} style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, padding: "9px 0", borderBottom: "1px solid var(--rule-soft)", minWidth: 0 }}>
                        <span style={{ fontSize: 12, color: "var(--ink-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{k.label}</span>
                        <span className="figure" style={{ fontSize: 15, whiteSpace: "nowrap" }}>{kpiText(k) ?? "…"}</span>
                      </div>
                    ))}
                  </div>
                )}
              </Detail>
            </div>

            {/* F: project network (kept as it was) */}
            <Detail tag="F" title="Project network" note="Companies and the projects they hold">
              <LazyWhenVisible minHeight={400}>
                <ProjectNetworkMap projects={projectList} total={eng?.projects?.total ?? projectList.length} />
              </LazyWhenVisible>
            </Detail>

            {/* G: recent activity */}
            <Detail tag="G" title="Recent activity" note="Latest across every module you can open">
              {feedItems.length === 0 ? (
                <p style={{ fontSize: 13, color: "var(--graphite)", margin: 0 }}>{isLoading ? "Reading…" : "No recent activity."}</p>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ minWidth: 620 }}>
                    <thead><tr><th>Module</th><th>Item</th><th>By</th><th className="num">Amount</th><th className="num">When</th></tr></thead>
                    <tbody>
                      {feedItems.slice(0, 8).map((it, i) => (
                        <tr key={`${it.Kind}-${it.DocNo ?? i}-${it.At}`} className="go" onClick={() => navigate(it.Href)}>
                          <td className="label" style={{ whiteSpace: "nowrap", color: "var(--ink-2)" }}>{moduleMeta(it.Module).label}</td>
                          <td style={{ maxWidth: 320 }}>
                            <span style={{ display: "block", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.Title}</span>
                            {it.Subtitle && <span style={{ display: "block", fontSize: 11.5, color: "var(--graphite)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.Subtitle}</span>}
                          </td>
                          <td style={{ color: "var(--ink-2)", whiteSpace: "nowrap" }}>{it.Actor ?? "—"}</td>
                          <td className="num figure" style={{ fontSize: 13 }}>{it.Amount != null && it.Amount > 0 ? compactINR(it.Amount) : "—"}</td>
                          <td className="num" style={{ color: "var(--graphite)" }}>{relTime(it.At)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Detail>

            {/* H: approvals, or the user's own tasks */}
            {access.approvals ? (
              <Detail tag="H" title="Approval inbox" note={pendingApprovals.length ? `${pendingApprovals.length} waiting` : undefined}>
                {pendingApprovals.length === 0 ? (
                  <p style={{ fontSize: 13, color: "var(--graphite)", margin: 0 }}>{isLoading ? "Reading…" : "Nothing waiting on approval."}</p>
                ) : (
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ minWidth: 620 }}>
                      <thead><tr><th>Module</th><th>Reference</th><th>Date</th><th>Status</th><th className="num">Amount</th></tr></thead>
                      <tbody>
                        {pendingApprovals.slice(0, 8).map((x, i) => (
                          <tr key={`${x.Module}-${x.RecordId}-${i}`} className="go" onClick={() => navigate("/admin/approval/inbox")}>
                            <td style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{x.ModuleLabel}</td>
                            <td style={{ color: "var(--ink-2)" }}>{x.Reference}</td>
                            <td style={{ color: "var(--ink-2)", whiteSpace: "nowrap" }}>{x.RecordDate ? new Date(x.RecordDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "—"}</td>
                            <td className="label">{x.Status}</td>
                            <td className="num figure" style={{ fontSize: 13 }}>{x.Amount != null ? compactINR(x.Amount) : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Detail>
            ) : data?.recentTasks && data.recentTasks.length > 0 ? (
              <Detail tag="H" title="My tasks">
                <div style={{ overflowX: "auto" }}>
                  <table style={{ minWidth: 540 }}>
                    <thead><tr><th>Task</th><th>Priority</th><th>Status</th><th className="num">Due</th></tr></thead>
                    <tbody>
                      {data.recentTasks.slice(0, 8).map((task) => (
                        <tr key={task.id}>
                          <td style={{ fontWeight: 600 }}>{task.title}</td>
                          <td style={{ color: "var(--ink-2)" }}>{task.priority}</td>
                          <td className="label">{task.status}</td>
                          <td className="num" style={{ color: "var(--ink-2)" }}>{task.dueDate ? new Date(task.dueDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Detail>
            ) : null}
          </>
        )}

        <div className="cell label" style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, padding: "12px 22px" }}>
          <span>Civilier ERP · {today.getFullYear()}</span>
          <span>Crafted by Rajwada Infotech</span>
        </div>
      </div>
    </div>
  );
}
