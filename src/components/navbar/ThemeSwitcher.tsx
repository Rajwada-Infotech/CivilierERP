import React, { useState, useRef, useEffect } from "react";
import { Brush } from "iconsax-react";
import { useTheme, THEME_DOTS, type Theme } from "@/contexts/ThemeContext";

// ─── useClickOutside ──────────────────────────────────────────────────────────

function useClickOutside(
  ref: React.RefObject<HTMLElement>,
  onClose: () => void,
  open: boolean,
) {
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [ref, open, onClose]);
}

// ─── ThemeOptions ─────────────────────────────────────────────────────────────

const ThemeOptions: React.FC<{
  currentTheme: Theme;
  setTheme: (t: Theme) => void;
  onClose: () => void;
}> = ({ currentTheme, setTheme, onClose }) => (
  <>
    <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-heading px-2 py-1.5 mb-0.5">
      Appearance
    </p>
    {(
      Object.entries(THEME_DOTS) as [Theme, { bg: string; label: string }][]
    ).map(([t, { bg, label }]) => (
      <button
        key={t}
        onClick={() => {
          setTheme(t);
          onClose();
        }}
        className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-heading transition-all ${
          currentTheme === t
            ? "bg-primary/10 text-primary"
            : "text-foreground hover:bg-muted"
        }`}
      >
        <span
          className="w-3.5 h-3.5 rounded-full shrink-0 border border-border/50"
          style={{ backgroundColor: bg }}
        />
        {label}
        {currentTheme === t && (
          <span className="ml-auto text-primary text-xs">✓</span>
        )}
      </button>
    ))}
  </>
);

// ─── ThemeSwitcher ────────────────────────────────────────────────────────────

interface ThemeSwitcherProps {
  /** Controlled mode: parent manages open state */
  open?: boolean;
  onToggle?: () => void;
  onClose?: () => void;
}

export const ThemeSwitcher: React.FC<ThemeSwitcherProps> = ({
  open: openProp,
  onToggle: onToggleProp,
  onClose: onCloseProp,
}) => {
  const { theme, setTheme } = useTheme();
  const ref = useRef<HTMLDivElement>(null);

  // Support both controlled and uncontrolled usage
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = openProp !== undefined;
  const open = isControlled ? openProp! : internalOpen;
  const onClose = onCloseProp ?? (() => setInternalOpen(false));
  const onToggle = onToggleProp ?? (() => setInternalOpen((p) => !p));

  useClickOutside(ref, onClose, open);

  return (
    <div ref={ref} className="relative shrink-0">
      {/* Trigger */}
      <button
        onClick={onToggle}
        className="p-2 rounded-md hover:bg-muted transition-all text-foreground"
        title="Change theme"
      >
        <Brush size={17} variant="Outline" color="hsl(var(--foreground))" />
      </button>

      {/* Panel */}
      <div
        className={`absolute top-full mt-2 z-50 rounded-xl border border-border bg-card shadow-2xl transition-all duration-200 origin-top-right right-0 w-48 p-1.5
          ${open ? "opacity-100 scale-100 pointer-events-auto" : "opacity-0 scale-95 pointer-events-none"}`}
      >
        <ThemeOptions
          currentTheme={theme}
          setTheme={setTheme}
          onClose={onClose}
        />
      </div>
    </div>
  );
};

export default ThemeSwitcher;
