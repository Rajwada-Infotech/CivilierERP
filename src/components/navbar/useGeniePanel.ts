import { useCallback, useEffect, useRef, useState } from "react";
import { menuAnimationsOn } from "@/lib/uiPrefs";

// The top bar's drop-down panels leave their icon like a genie out of a bottle (and go back in when closed). Opening is a CSS
// animation on the panel; closing needs the panel to stay on screen until the animation has played, which is what this hook
// does: close() plays it, then hides the panel. With the menu animations switched off in Settings (or "reduce motion" on), close()
// hides it at once.
export const GENIE_CLOSE_MS = 300;

export function useGeniePanel(open: boolean, setOpen: (value: boolean) => void) {
  const [closing, setClosing] = useState(false);
  const timer = useRef<number>();

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const close = useCallback(() => {
    if (!open || closing) return;
    if (!menuAnimationsOn()) {
      setOpen(false);
      return;
    }
    setClosing(true);
    timer.current = window.setTimeout(() => {
      setOpen(false);
      setClosing(false);
    }, GENIE_CLOSE_MS);
  }, [open, closing, setOpen]);

  return { closing, close };
}

// For panels that stay mounted and are switched on and off by an "open" flag from their parent (the theme and the avatar menus): the
// panel is shown from the moment it opens until its closing animation has played. "className" is the genie class to put on the panel.
export function useGenieVisibility(open: boolean) {
  const [phase, setPhase] = useState<"closed" | "open" | "closing">(open ? "open" : "closed");

  useEffect(() => {
    if (open) {
      setPhase("open");
      return;
    }
    if (!menuAnimationsOn()) {
      setPhase("closed");
      return;
    }
    setPhase((p) => (p === "open" ? "closing" : p));
    const id = window.setTimeout(() => setPhase("closed"), GENIE_CLOSE_MS);
    return () => window.clearTimeout(id);
  }, [open]);

  return {
    shown: phase !== "closed",
    className: phase === "open" ? "genie-open" : phase === "closing" ? "genie-close" : "",
  };
}
