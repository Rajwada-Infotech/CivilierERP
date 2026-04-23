import React, { useEffect, useState, useRef } from "react";

// ─── Matrix version scramble ──────────────────────────────────────────────────
const VERSION = "v2.1.4";
const CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789@#$%&";
const rand = () => CHARS[Math.floor(Math.random() * CHARS.length)];

function useMatrixVersion(target: string) {
  const [display, setDisplay] = useState(target);
  const frameRef = useRef<NodeJS.Timeout | null>(null);
  const cycleRef = useRef<NodeJS.Timeout | null>(null);

  const scramble = () => {
    // How many steps to reveal each char
    const steps = 8;
    let step = 0;

    const tick = () => {
      step++;
      setDisplay(
        target
          .split("")
          .map((char, i) => {
            // Already resolved chars (left-to-right reveal)
            if (i < Math.floor((step / steps) * target.length)) return char;
            // Dot stays dot
            if (char === ".") return char;
            // Scramble
            return rand();
          })
          .join(""),
      );

      if (step < steps + target.length) {
        frameRef.current = setTimeout(tick, 45);
      } else {
        setDisplay(target);
      }
    };

    tick();
  };

  useEffect(() => {
    // Initial scramble on mount after a short delay
    const init = setTimeout(scramble, 800);

    // Periodic re-scramble every 8 seconds
    cycleRef.current = setInterval(scramble, 8000);

    return () => {
      clearTimeout(init);
      if (frameRef.current) clearTimeout(frameRef.current);
      if (cycleRef.current) clearInterval(cycleRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return display;
}

// ─── Exports ──────────────────────────────────────────────────────────────────

export const LogoIcon = ({ size = 32 }: { size?: number }) => (
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

export const LogoFull = ({ className }: { className?: string }) => {
  const matrixVersion = useMatrixVersion(VERSION);

  return (
    <div className={`flex items-center gap-2 ${className || ""}`}>
      <LogoIcon size={32} />
      <div className="flex flex-col leading-none">
        <span className="font-heading font-bold text-lg gradient-text">
          CivilierERP
        </span>
        <span
          className="text-[10px] text-emerald-500/80 font-mono tracking-wider select-none tabular-nums"
          aria-label={VERSION}
        >
          {matrixVersion}
        </span>
      </div>
    </div>
  );
};
