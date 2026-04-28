import { useEffect, useRef } from "react";

/** Reads a CSS HSL variable and returns an "r,g,b" string for canvas usage. */
function hslVarToRgb(variable: string): string {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(variable)
    .trim();
  if (!raw) return "99,102,241";
  const [h, s, l] = raw.split(" ").map(parseFloat);
  const sN = s / 100;
  const lN = l / 100;
  const a = sN * Math.min(lN, 1 - lN);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (lN - a * Math.max(Math.min(k - 3, 9 - k, 1), -1)));
  };
  return `${f(0)},${f(8)},${f(4)}`;
}

function watchTheme(cb: () => void): MutationObserver {
  const obs = new MutationObserver(cb);
  obs.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  return obs;
}

// ── Layer 0 — Ambient colour blobs ────────────────────────────────────────────

function AtmosphereCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    let raf: number;
    let t = 0;

    let c1 = hslVarToRgb("--accent-1");
    let c2 = hslVarToRgb("--accent-2");
    let c3 = hslVarToRgb("--accent-3");
    const obs = watchTheme(() => {
      c1 = hslVarToRgb("--accent-1");
      c2 = hslVarToRgb("--accent-2");
      c3 = hslVarToRgb("--accent-3");
    });

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    const blob = (x: number, y: number, r: number, col: string, a: number) => {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(${col},${a})`);
      g.addColorStop(0.5, `rgba(${col},${a * 0.3})`);
      g.addColorStop(1, `rgba(${col},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    };

    const draw = () => {
      const W = canvas.width;
      const H = canvas.height;
      ctx.clearRect(0, 0, W, H);
      blob(
        W * 0.08 + Math.sin(t * 0.19) * W * 0.05,
        H * 0.15 + Math.cos(t * 0.14) * H * 0.06,
        W * 0.45,
        c1,
        0.18,
      );
      blob(
        W * 0.88 + Math.cos(t * 0.16) * W * 0.04,
        H * 0.18 + Math.sin(t * 0.21) * H * 0.05,
        W * 0.35,
        c2,
        0.14,
      );
      blob(
        W * 0.5 + Math.sin(t * 0.12) * W * 0.06,
        H * 0.85 + Math.cos(t * 0.17) * H * 0.04,
        W * 0.38,
        c3,
        0.12,
      );
      t += 0.006;
      raf = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      obs.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={ref}
      className="fixed inset-0 pointer-events-none"
      style={{ zIndex: 0 }}
    />
  );
}

// ── Layer 1 — Blueprint grid ───────────────────────────────────────────────────

function BlueprintCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    let accent = hslVarToRgb("--accent-1");

    const draw = () => {
      const W = canvas.width;
      const H = canvas.height;
      ctx.clearRect(0, 0, W, H);

      // Fine grid — barely-there
      ctx.beginPath();
      for (let x = 0; x <= W; x += 40) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, H);
      }
      for (let y = 0; y <= H; y += 40) {
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
      }
      ctx.strokeStyle = `rgba(${accent},0.055)`;
      ctx.lineWidth = 0.5;
      ctx.stroke();

      // Major grid — slightly more visible but not harsh
      ctx.beginPath();
      for (let x = 0; x <= W; x += 200) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, H);
      }
      for (let y = 0; y <= H; y += 200) {
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
      }
      ctx.strokeStyle = `rgba(${accent},0.13)`;
      ctx.lineWidth = 0.8;
      ctx.stroke();

      // Elevation ticks — left edge, major intervals only
      for (let y = 200; y < H; y += 200) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(12, y);
        ctx.strokeStyle = `rgba(${accent},0.25)`;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.font = "9px monospace";
        ctx.textAlign = "left";
        ctx.fillStyle = `rgba(${accent},0.30)`;
        ctx.fillText(`EL +${Math.round(y / 10)}`, 16, y + 3);
      }

      // Column circles — top edge, major intervals only
      ctx.textAlign = "center";
      for (let x = 200; x < W; x += 200) {
        ctx.beginPath();
        ctx.arc(x, 20, 7, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${accent},0.20)`;
        ctx.lineWidth = 0.8;
        ctx.stroke();
        ctx.font = "bold 7px monospace";
        ctx.fillStyle = `rgba(${accent},0.28)`;
        ctx.fillText(String.fromCharCode(64 + Math.round(x / 200)), x, 24);
      }
      ctx.textAlign = "left";

      // Dashed centre datum
      ctx.save();
      ctx.setLineDash([5, 10]);
      ctx.beginPath();
      ctx.moveTo(0, Math.round(H / 2));
      ctx.lineTo(W, Math.round(H / 2));
      ctx.strokeStyle = `rgba(${accent},0.08)`;
      ctx.lineWidth = 0.8;
      ctx.stroke();
      ctx.restore();
    };

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      draw();
    };
    const obs = watchTheme(() => {
      accent = hslVarToRgb("--accent-1");
      draw();
    });
    resize();
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      obs.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={ref}
      className="fixed inset-0 pointer-events-none"
      style={{ zIndex: 1 }}
    />
  );
}

// ── Layer 2 — Floating dust motes ─────────────────────────────────────────────

function SiteParticleCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    let raf: number;
    let accent = hslVarToRgb("--accent-1");
    const obs = watchTheme(() => {
      accent = hslVarToRgb("--accent-1");
    });

    type Mote = {
      x: number;
      y: number;
      vx: number;
      vy: number;
      r: number;
      op: number;
      opDir: number;
    };
    let W = window.innerWidth;
    let H = window.innerHeight;
    const motes: Mote[] = [];

    const spawn = (): Mote => ({
      x: Math.random() * W,
      y: Math.random() * H,
      vx: (Math.random() - 0.5) * 0.2,
      vy: -Math.random() * 0.1 - 0.03,
      r: Math.random() * 1.2 + 0.4,
      op: Math.random() * 0.25 + 0.05,
      opDir: Math.random() > 0.5 ? 1 : -1,
    });

    const resize = () => {
      W = window.innerWidth;
      H = window.innerHeight;
      canvas.width = W;
      canvas.height = H;
    };
    resize();
    window.addEventListener("resize", resize);
    for (let i = 0; i < 20; i++) motes.push(spawn());

    const draw = () => {
      ctx.clearRect(0, 0, W, H);
      for (const m of motes) {
        m.x = (m.x + m.vx + W) % W;
        m.y = (m.y + m.vy + H) % H;
        m.op += m.opDir * 0.001;
        if (m.op > 0.3 || m.op < 0.04) m.opDir *= -1;
        ctx.fillStyle = `rgba(${accent},${m.op})`;
        ctx.beginPath();
        ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
        ctx.fill();
      }
      for (let i = 0; i < motes.length; i++) {
        for (let j = i + 1; j < motes.length; j++) {
          const d = Math.hypot(
            motes[i].x - motes[j].x,
            motes[i].y - motes[j].y,
          );
          if (d < 120) {
            ctx.beginPath();
            ctx.moveTo(motes[i].x, motes[i].y);
            ctx.lineTo(motes[j].x, motes[j].y);
            ctx.strokeStyle = `rgba(${accent},${0.06 * (1 - d / 120)})`;
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }
      }
      raf = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      obs.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={ref}
      className="fixed inset-0 pointer-events-none"
      style={{ zIndex: 2 }}
    />
  );
}

// ── Layer 3 — Crane silhouette ─────────────────────────────────────────────────

function CraneSilhouetteSVG() {
  return (
    <svg
      className="fixed pointer-events-none select-none"
      style={{
        zIndex: 3,
        right: 0,
        bottom: 0,
        width: "38vw",
        maxWidth: 520,
        height: "90vh",
        opacity: 0.045,
      }}
      viewBox="0 0 520 900"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <line
        x1="220"
        y1="0"
        x2="220"
        y2="860"
        stroke="hsl(var(--primary))"
        strokeWidth="5"
      />
      <line
        x1="220"
        y1="55"
        x2="490"
        y2="55"
        stroke="hsl(var(--primary))"
        strokeWidth="4"
      />
      <line
        x1="220"
        y1="55"
        x2="80"
        y2="55"
        stroke="hsl(var(--primary))"
        strokeWidth="3"
      />
      <line
        x1="220"
        y1="18"
        x2="490"
        y2="55"
        stroke="hsl(var(--primary))"
        strokeWidth="1.2"
      />
      <line
        x1="220"
        y1="18"
        x2="80"
        y2="55"
        stroke="hsl(var(--primary))"
        strokeWidth="1.2"
      />
      <line
        x1="220"
        y1="18"
        x2="360"
        y2="55"
        stroke="hsl(var(--primary))"
        strokeWidth="0.8"
      />
      <line
        x1="375"
        y1="55"
        x2="375"
        y2="240"
        stroke="hsl(var(--primary))"
        strokeWidth="1"
        strokeDasharray="5 4"
      />
      <path
        d="M367 240 Q367 258 375 258 Q383 258 383 240"
        stroke="hsl(var(--primary))"
        strokeWidth="1.5"
        fill="none"
      />
      <rect
        x="55"
        y="420"
        width="285"
        height="440"
        stroke="hsl(var(--primary))"
        strokeWidth="2.5"
      />
      {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
        <line
          key={i}
          x1="55"
          y1={420 + i * 55}
          x2="340"
          y2={420 + i * 55}
          stroke="hsl(var(--primary))"
          strokeWidth="0.7"
        />
      ))}
      {[0, 1, 2, 3, 4].map((row) =>
        [0, 1, 2].map((col) => (
          <rect
            key={`w${row}${col}`}
            x={75 + col * 82}
            y={432 + row * 55}
            width={50}
            height={32}
            stroke="hsl(var(--primary))"
            strokeWidth="0.6"
          />
        )),
      )}
      <rect
        x="340"
        y="560"
        width="130"
        height="300"
        stroke="hsl(var(--primary))"
        strokeWidth="1.8"
      />
      {[0, 1, 2, 3].map((i) => (
        <line
          key={i}
          x1="340"
          y1={560 + i * 74}
          x2="470"
          y2={560 + i * 74}
          stroke="hsl(var(--primary))"
          strokeWidth="0.6"
        />
      ))}
      <line
        x1="0"
        y1="860"
        x2="520"
        y2="860"
        stroke="hsl(var(--primary))"
        strokeWidth="3"
      />
      <line
        x1="38"
        y1="420"
        x2="38"
        y2="860"
        stroke="hsl(var(--primary))"
        strokeWidth="1.5"
      />
      <line
        x1="18"
        y1="420"
        x2="18"
        y2="860"
        stroke="hsl(var(--primary))"
        strokeWidth="1.2"
      />
      {[0, 1, 2, 3, 4, 5, 6].map((i) => (
        <line
          key={i}
          x1="16"
          y1={428 + i * 62}
          x2="58"
          y2={428 + i * 62}
          stroke="hsl(var(--primary))"
          strokeWidth="0.8"
        />
      ))}
    </svg>
  );
}

// ── Layer 4 — Drawing stamp ────────────────────────────────────────────────────

function DrawingStamp() {
  return (
    <div
      className="fixed bottom-4 left-4 pointer-events-none select-none font-mono"
      style={{ zIndex: 4, opacity: 0.12 }}
    >
      <div
        className="border border-current px-3 py-2 text-[9px] leading-relaxed uppercase tracking-widest"
        style={{ color: "hsl(var(--primary))" }}
      >
        <div className="font-bold">CivilierERP</div>
        <div>DWG No. CE-001</div>
        <div>Scale 1:100 · NTS</div>
        <div className="mt-1 border-t border-current pt-1">
          Rev A — Construction Issue
        </div>
      </div>
    </div>
  );
}

// ── Exported component ─────────────────────────────────────────────────────────

export function DashboardBackground() {
  return (
    <>
      <AtmosphereCanvas />
      <BlueprintCanvas />
      <SiteParticleCanvas />
      <CraneSilhouetteSVG />
      <DrawingStamp />
      {/* Soft edge-only vignette — centre stays fully transparent */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          zIndex: 5,
          background: `radial-gradient(ellipse 120% 120% at 50% 50%, transparent 60%, hsl(var(--background) / 0.35) 100%)`,
        }}
      />
    </>
  );
}
