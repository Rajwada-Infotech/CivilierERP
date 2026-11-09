// The colour theme in use — the web's five (Dark, Light, Glass, BW, Sage), chosen on Profile → Settings and kept on
// this phone (SecureStore "ui_theme"). The saved theme is applied before anything draws, so the app opens in it.
// Switching rewrites the palette in theme/colors.ts and remounts <ThemedTree> — everything that reads a colour — under a
// new key; the navigator restores the page that was open (RootNavigator keeps its state), so the switch just repaints.
import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import * as SecureStore from "expo-secure-store";
import { applyTheme, isLightTheme, type ThemeName } from "./colors";

const KEY = "ui_theme";
const NAMES: ThemeName[] = ["dark", "light", "glass", "bw", "sage"];

type ThemeCtx = { theme: ThemeName; setTheme: (t: ThemeName) => void; light: boolean; version: number };
const Ctx = createContext<ThemeCtx>({ theme: "dark", setTheme: () => {}, light: false, version: 0 });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeName>("dark");
  const [ready, setReady] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    SecureStore.getItemAsync(KEY)
      .then((v) => {
        const t = NAMES.includes(v as ThemeName) ? (v as ThemeName) : "dark";
        applyTheme(t);
        setThemeState(t);
      })
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);

  const setTheme = useCallback((t: ThemeName) => {
    applyTheme(t);
    setThemeState(t);
    setVersion((v) => v + 1);
    SecureStore.setItemAsync(KEY, t).catch(() => {});
  }, []);

  if (!ready) return null;
  return <Ctx.Provider value={{ theme, setTheme, light: isLightTheme(theme), version }}>{children}</Ctx.Provider>;
}

export const useTheme = () => useContext(Ctx);

/** Everything that draws with the palette. Remounted on a theme switch so every colour is read again. */
export function ThemedTree({ children }: { children: React.ReactNode }) {
  const { version } = useTheme();
  return <React.Fragment key={version}>{children}</React.Fragment>;
}
