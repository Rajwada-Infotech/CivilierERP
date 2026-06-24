import React, { useEffect, useState, useRef } from "react";
import { useAppVersion } from "@/hooks/useAppVersion";

// ─── Matrix version scramble ──────────────────────────────────────────────────
const CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789@#$%&";
const rand = () => CHARS[Math.floor(Math.random() * CHARS.length)];

function useMatrixCycle(targets: string[]) {
  const [display, setDisplay] = useState(targets[0] ?? "");
  const [activeIdx, setActiveIdx] = useState(0);
  const frameRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cycleRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const scrambleTo = (target: string, onDone?: () => void) => {
    const steps = 8;
    let step = 0;

    const tick = () => {
      step++;
      setDisplay(
        target
          .split("")
          .map((char, i) => {
            if (i < Math.floor((step / steps) * target.length)) return char;
            if (char === "." || char === " " || char === "/") return char;
            return rand();
          })
          .join(""),
      );

      if (step < steps + target.length) {
        frameRef.current = setTimeout(tick, 45);
      } else {
        setDisplay(target);
        onDone?.();
      }
    };

    tick();
  };

  useEffect(() => {
    const allReady = targets.every((t) => t && t !== "…");
    if (!allReady) return;

    // Set initial display
    setDisplay(targets[0]);
    setActiveIdx(0);

    // Initial scramble
    const init = setTimeout(() => scrambleTo(targets[0]), 800);

    // Cycle: every 5 s switch to next target with a scramble
    let currentIdx = 0;
    cycleRef.current = setInterval(() => {
      const nextIdx = (currentIdx + 1) % targets.length;
      currentIdx = nextIdx;
      setActiveIdx(nextIdx);
      scrambleTo(targets[nextIdx]);
    }, 5000);

    return () => {
      clearTimeout(init);
      if (frameRef.current) clearTimeout(frameRef.current);
      if (cycleRef.current) clearInterval(cycleRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targets.join("|")]);

  return { display, activeIdx };
}

// ─── Components ───────────────────────────────────────────────────────────────

export function LogoIcon({ size = 32 }: { size?: number }) {
  return (
    <img
      src="/Civilier.png"
      alt="CivilierERP"
      width={size}
      height={size}
      className="object-contain"
      loading="eager"
      decoding="sync"
    />
  );
}

export function LogoFull({ className }: { className?: string }) {
  const { dbVersion, appVersion } = useAppVersion();

  // Normalise labels — prefix "v" if not present
  const normalise = (v: string) =>
    v === "…" || v === "—" ? v : v.startsWith("v") ? v : `v${v}`;

  const dbLabel = normalise(dbVersion);
  const appLabel = normalise(appVersion ?? "…");

  // Labels shown in the cycle: "APP v1.0 / DB v2.3"
  const targets = [
    appLabel === "…" || dbLabel === "…" ? "…" : `APP ${appLabel}`,
    appLabel === "…" || dbLabel === "…" ? "…" : `DB  ${dbLabel}`,
  ];

  const { display, activeIdx } = useMatrixCycle(targets);

  // Tooltip shows both
  const tooltip =
    appLabel !== "…" && dbLabel !== "…"
      ? `App: ${appLabel}  |  DB: ${dbLabel}`
      : "Loading version…";

  return (
    <div className={`flex items-center gap-2 ${className || ""}`}>
      <LogoIcon size={32} />
      <div className="flex flex-col leading-none">
        <span className="font-heading font-bold text-lg gradient-text">
          CivilierERP
        </span>
        <span
          className="text-[10px] text-emerald-500/80 font-mono tracking-wider select-none tabular-nums"
          title={tooltip}
          aria-label={tooltip}
        >
          {display}
          {/* tiny dot indicator: first dot = app, second = db */}
          <span className="ml-1 inline-flex gap-[3px] align-middle">
            {targets.map((_, i) => (
              <span
                key={i}
                className="inline-block w-[4px] h-[4px] rounded-full transition-all duration-300"
                style={{
                  background:
                    i === activeIdx
                      ? "rgba(52,211,153,0.9)"
                      : "rgba(52,211,153,0.25)",
                  transform: i === activeIdx ? "scale(1.4)" : "scale(1)",
                }}
              />
            ))}
          </span>
        </span>
      </div>
    </div>
  );
}

export default LogoFull;
