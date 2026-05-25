import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
} from "react";

export type Theme = "dark" | "light" | "midnight" | "root";

const themes: Theme[] = ["dark", "light", "midnight", "root"];

// Dot colors that represent each theme visually
export const THEME_DOTS: Record<Theme, { bg: string; label: string }> = {
  dark: { bg: "#4f46e5", label: "Dark" },
  light: { bg: "#a78bfa", label: "Light" },
  midnight: { bg: "#2dd4bf", label: "Midnight" },
  root: { bg: "#f0a500", label: "Root" },
};

interface ThemeContextType {
  theme: Theme;
  setTheme: (t: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType | null>(null);

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
  const [theme, setThemeState] = useState<Theme>(() => {
    const initial = getInitialTheme();
    // Apply synchronously before first paint to avoid flash
    applyTheme(initial);
    return initial;
  });

  useEffect(() => {
    applyTheme(theme);
    localStorage.setItem("civilier-theme", theme);
  }, [theme]);

  const setTheme = useCallback((t: Theme) => setThemeState(t), []);

  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
};
