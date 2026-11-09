// Port of src/components/Logo.tsx's useMatrixCycle (web): the version line "matrix-scrambles" between its labels every
// 5s — each character runs through random glyphs, resolving left to right, before it lands. Holds the first label until
// every label has loaded, and stays still when the phone's "remove animations" setting is on.
import { useEffect, useRef, useState } from "react";
import { motionOff } from "@/components/sheet/Sheet";

const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%&";
const rand = () => CHARS[Math.floor(Math.random() * CHARS.length)];

export function useMatrixCycle(targets: string[]) {
  const [display, setDisplay] = useState(targets[0] ?? "");
  const frame = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setDisplay(targets[0] ?? "");
    const ready = targets.length > 0 && targets.every((t) => t && t !== "…");
    if (!ready || motionOff()) return;

    const scrambleTo = (target: string) => {
      if (frame.current) clearTimeout(frame.current);
      const steps = 8;
      let step = 0;
      const tick = () => {
        step++;
        setDisplay(
          target
            .split("")
            .map((ch, i) => (i < Math.floor((step / steps) * target.length) || ch === "." || ch === " " || ch === "/" ? ch : rand()))
            .join(""),
        );
        if (step < steps + target.length) frame.current = setTimeout(tick, 45);
        else setDisplay(target);
      };
      tick();
    };

    const init = setTimeout(() => scrambleTo(targets[0]), 800);
    let i = 0;
    const cycle = setInterval(() => {
      i = (i + 1) % targets.length;
      scrambleTo(targets[i]);
    }, 5000);
    return () => {
      clearTimeout(init);
      clearInterval(cycle);
      if (frame.current) clearTimeout(frame.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targets.join("|")]);

  return display;
}
