import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from "react";

type Theme = "dark" | "light" | "midnight";
const themes: Theme[] = ["dark", "light", "midnight"];
const themeLabels: Record<Theme, string> = { dark: "Dark", light: "Light", midnight: "Midnight Slate" };

interface ThemeContextType {
  theme: Theme;
  themeLabel: string;
  cycleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | null>(null);

export const useTheme = () => {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be inside ThemeProvider");
  return ctx;
};

// Read initial theme synchronously (matches the inline script in index.html)
const getInitialTheme = (): Theme => {
  const stored = localStorage.getItem("civilier-theme") as Theme | null;
  return stored && themes.includes(stored) ? stored : "dark";
};

export const ThemeProvider = ({ children }: { children: React.ReactNode }) => {
  const [theme, setTheme] = useState<Theme>(getInitialTheme);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("civilier-theme", theme);
  }, [theme]);

  const cycleTheme = useCallback(() => {
    setTheme((prev) => themes[(themes.indexOf(prev) + 1) % themes.length]);
  }, []);

  const value = useMemo(() => ({
    theme,
    themeLabel: themeLabels[theme],
    cycleTheme,
  }), [theme, cycleTheme]);

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
};
