import React, { useState, useRef, useEffect } from "react";
import { ChromeIcons } from "@/components/icons/moduleIcons";
import { useTheme, THEME_DOTS, type Theme } from "@/contexts/ThemeContext";
import { NAV_PANEL_CSS } from "./navPanelStyles";

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

// The themes as numbered rows on the sheet, each with a square swatch of its colour; the one in use is tagged.
const ThemeOptions: React.FC<{
  currentTheme: Theme;
  setTheme: (t: Theme) => void;
  onClose: () => void;
}> = ({ currentTheme, setTheme, onClose }) => (
  <>
    <div className="np-head">
      <div className="min-w-0">
        <p className="np-label">CivilierERP · Appearance</p>
        <p className="np-title">Theme</p>
      </div>
    </div>
    <div className="np-list">
      {(Object.entries(THEME_DOTS) as [Theme, { bg: string; label: string }][]).map(([t, { bg, label }], i) => {
        const current = currentTheme === t;
        return (
          <button
            key={t}
            type="button"
            onClick={() => {
              setTheme(t);
              onClose();
            }}
            aria-pressed={current}
            className="np-row center"
          >
            <span className="np-num">{String(i + 1).padStart(2, "0")}</span>
            <span className="np-swatch" style={{ backgroundColor: bg }} />
            <span className="np-name">{label}</span>
            {current ? <span className="np-tag">In use</span> : <span />}
          </button>
        );
      })}
    </div>
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
      <style dangerouslySetInnerHTML={{ __html: NAV_PANEL_CSS }} />
      {/* Trigger */}
      <button
        onClick={onToggle}
        className="w-8 h-8 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
        title="Change theme"
      >
        <ChromeIcons.theme size={18} />
      </button>

      {/* Panel */}
      <div
        className={`np-sheet absolute top-full mt-3 z-50 transition-opacity duration-200 right-0 w-56
          ${open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}
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
