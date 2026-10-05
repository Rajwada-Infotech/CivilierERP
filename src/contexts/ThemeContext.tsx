import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import { useAuth } from "@/contexts/AuthContext";

export type Theme =
  | "dark"
  | "light"
  | "midnight"
  | "root"
  | "glass"
  | "bw"
  | "cyberpunk";

const themes: Theme[] = [
  "dark",
  "light",
  "midnight",
  "root",
  "glass",
  "bw",
  "cyberpunk",
];

/** Themes offered (and applied) only to super admins. */
export const SUPER_ADMIN_ONLY_THEMES: readonly Theme[] = ["cyberpunk"];

export const isThemeAllowed = (t: Theme, isSuperAdmin: boolean): boolean =>
  isSuperAdmin || !SUPER_ADMIN_ONLY_THEMES.includes(t);

/**
 * Themes whose surface is light (white/near-white background). Components that
 * branch on light vs dark for decorative fills / glass cards should use this
 * instead of `theme === "light"` so the BW theme (light background, black
 * accents) is treated correctly.
 */
export const isLightTheme = (t: Theme): boolean => t === "light" || t === "bw";

/**
 * Fixed 3-tone chart palette for the BW theme: maroon / green / orange.
 * Dashboard charts (status pies, trend-line series) cycle through this
 * instead of each chart's own module-accent hex when theme === "bw", so
 * every chart across every module reads the same deliberate palette
 * rather than a grab-bag of per-module accent colours.
 */
export const BW_CHART_PALETTE = ["#800000", "#008000", "#FFA500"] as const;

/** Pick the BW palette colour for a data point index, else fall back to `color`. */
export const bwChartColor = (
  theme: Theme,
  index: number,
  color: string,
): string =>
  theme === "bw" ? BW_CHART_PALETTE[index % BW_CHART_PALETTE.length] : color;

// Dot colors that represent each theme visually
export const THEME_DOTS: Record<Theme, { bg: string; label: string }> = {
  dark: { bg: "#4f46e5", label: "Dark" },
  light: { bg: "#a78bfa", label: "Light" },
  midnight: { bg: "#2dd4bf", label: "Midnight" },
  root: { bg: "#f0a500", label: "Root" },
  glass: { bg: "#a5b4fc", label: "Glass" },
  bw: { bg: "#111111", label: "BW" },
  cyberpunk: { bg: "#00f0ff", label: "Cyberpunk" },
};

interface ThemeContextType {
  theme: Theme;
  setTheme: (t: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType | null>(null);

/** The theme picker's entries for the signed-in user (restricted themes only for super admins). */
export const useThemeOptions = (): [Theme, { bg: string; label: string }][] => {
  const { currentUser } = useAuth();
  const isSuperAdmin = currentUser?.role === "super_admin";
  return (
    Object.entries(THEME_DOTS) as [Theme, { bg: string; label: string }][]
  ).filter(([t]) => isThemeAllowed(t, isSuperAdmin));
};

export const useTheme = () => {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be inside ThemeProvider");
  return ctx;
};

const getInitialTheme = (): Theme => {
  const stored = localStorage.getItem("civilier-theme") as Theme | null;
  return stored && themes.includes(stored) ? stored : "dark";
};

// Apply theme to <html> element.
// "dark" is the CSS :root default — no data-theme attribute needed.
// All other themes use [data-theme="X"] selectors in index.css.
function applyTheme(theme: Theme) {
  if (theme === "dark") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", theme);
  }
}

export const ThemeProvider = ({ children }: { children: React.ReactNode }) => {
  const { currentUser } = useAuth();
  const isSuperAdmin = currentUser?.role === "super_admin";

  const [chosen, setChosen] = useState<Theme>(() => {
    const initial = getInitialTheme();
    // Apply synchronously before first paint to avoid flash
    applyTheme(isThemeAllowed(initial, isSuperAdmin) ? initial : "dark");
    return initial;
  });

  // A restricted theme that's stored for someone who may not use it (a different
  // role signed in on this browser, or logged out) renders as the default. The
  // stored choice is kept, so the super admin gets it back on their next sign-in.
  const theme: Theme = isThemeAllowed(chosen, isSuperAdmin) ? chosen : "dark";

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const setTheme = useCallback(
    (t: Theme) => {
      if (!isThemeAllowed(t, isSuperAdmin)) return;
      setChosen(t);
      localStorage.setItem("civilier-theme", t);
    },
    [isSuperAdmin],
  );

  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
};
