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

// ── Layer 0 — Deep ambient colour wash ────────────────────────────────────────

function AmbientCanvas() {
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
      g.addColorStop(0.45, `rgba(${col},${a * 0.25})`);
      g.addColorStop(1, `rgba(${col},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    };

    const draw = () => {
      const W = canvas.width;
      const H = canvas.height;
      ctx.clearRect(0, 0, W, H);

      blob(
        W * 0.06 + Math.sin(t * 0.11) * W * 0.04,
        H * 0.08 + Math.cos(t * 0.09) * H * 0.05,
        W * 0.55,
        c1,
        0.13,
      );
      blob(
        W * 0.92 + Math.cos(t * 0.13) * W * 0.03,
        H * 0.12 + Math.sin(t * 0.15) * H * 0.04,
        W * 0.42,
        c2,
        0.1,
      );
      blob(
        W * 0.48 + Math.sin(t * 0.08) * W * 0.05,
        H * 0.88 + Math.cos(t * 0.1) * H * 0.03,
        W * 0.5,
        c3,
        0.07,
      );

      t += 0.004;
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

// ── Layer 1 — Floating orb particles ─────────────────────────────────────────

function ParticleCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    let raf: number;
    let accent1 = hslVarToRgb("--accent-1");
    let accent2 = hslVarToRgb("--accent-2");
    const obs = watchTheme(() => {
      accent1 = hslVarToRgb("--accent-1");
      accent2 = hslVarToRgb("--accent-2");
    });

    type Particle = {
      x: number;
      y: number;
      vx: number;
      vy: number;
      r: number;
      op: number;
      opDir: number;
      col: number;
    };

    let W = window.innerWidth;
    let H = window.innerHeight;
    const COUNT = 28;
    const particles: Particle[] = [];

    const spawn = (): Particle => ({
      x: Math.random() * W,
      y: Math.random() * H,
      vx: (Math.random() - 0.5) * 0.15,
      vy: (Math.random() - 0.5) * 0.12,
      r: Math.random() * 1.4 + 0.5,
      op: Math.random() * 0.18 + 0.04,
      opDir: Math.random() > 0.5 ? 1 : -1,
      col: Math.random() > 0.6 ? 1 : 0,
    });

    const resize = () => {
      W = window.innerWidth;
      H = window.innerHeight;
      canvas.width = W;
      canvas.height = H;
    };
    resize();
    window.addEventListener("resize", resize);
    for (let i = 0; i < COUNT; i++) particles.push(spawn());

    const draw = () => {
      ctx.clearRect(0, 0, W, H);
      for (const p of particles) {
        p.x = (p.x + p.vx + W) % W;
        p.y = (p.y + p.vy + H) % H;
        p.op += p.opDir * 0.0008;
        if (p.op > 0.22 || p.op < 0.03) p.opDir *= -1;

        const col = p.col === 0 ? accent1 : accent2;

        const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 3.5);
        glow.addColorStop(0, `rgba(${col},${p.op})`);
        glow.addColorStop(1, `rgba(${col},0)`);
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * 3.5, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = `rgba(${col},${p.op * 1.8})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }

      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < 160) {
            const alpha = 0.04 * (1 - d / 160);
            ctx.beginPath();
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.strokeStyle = `rgba(${accent1},${alpha})`;
            ctx.lineWidth = 0.4;
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
      style={{ zIndex: 1 }}
    />
  );
}

// ── Layer 2 — Noise grain texture ─────────────────────────────────────────────

function GrainOverlay() {
  return (
    <div
      className="fixed inset-0 pointer-events-none"
      style={{
        zIndex: 2,
        opacity: 0.022,
        backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
        backgroundRepeat: "repeat",
        backgroundSize: "160px 160px",
      }}
    />
  );
}

// ── Layer 3 — Edge vignette ────────────────────────────────────────────────────

function VignetteOverlay() {
  return (
    <div
      className="fixed inset-0 pointer-events-none"
      style={{
        zIndex: 3,
        background: `radial-gradient(ellipse 110% 110% at 50% 50%, transparent 55%, hsl(var(--background) / 0.55) 100%)`,
      }}
    />
  );
}

// ── Exported component ─────────────────────────────────────────────────────────

export function DashboardBackground() {
  return (
    <>
      <AmbientCanvas />
      <ParticleCanvas />
      <GrainOverlay />
      <VignetteOverlay />
    </>
  );
}
